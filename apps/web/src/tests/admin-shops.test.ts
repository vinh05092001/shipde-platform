// ============================================================================
// Ship Dễ — Admin Shops Route & View Test Suite (FEAT-AUTH-02)
// Comprehensive acceptance testing: Auth, Role Enforcement, Upstream Errors,
// Creation Flow, and Real Component State Rendering (AC-ADMIN-14, AC-ADMIN-15)
// ============================================================================

import * as assert from 'node:assert';
import { createHmac, randomUUID } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { GET, POST, verifyAdminAuthorization } from '../app/api/admin/shops/route';
import {
  AdminShopsView,
  validateShopForm,
  ShopRecord,
  CreatedShopSuccessData,
} from '../app/admin/shops/page';
import { AdminNewShopView } from '../app/admin/shops/new/page';

/**
 * Generates a signed v1 token format (v1.<payload>.<signature>) for testing
 */
function generateTestV1Token(
  claims: {
    sub?: string;
    sid?: string;
    mid?: string;
    role?: string;
    exp?: number;
  },
  secret: string
): string {
  const now = Math.floor(Date.now() / 1000);
  const payloadData = {
    sub: claims.sub || 'u-admin-test',
    sid: claims.sid || 's-admin-test',
    mid: claims.mid || 'm-admin-test',
    role: claims.role || 'BACKOFFICE',
    st: 'active',
    iat: now,
    exp: claims.exp !== undefined ? claims.exp : now + 3600,
    jti: randomUUID(),
  };

  const payload = Buffer.from(JSON.stringify(payloadData)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`v1.${payload}`).digest('base64url');

  return `v1.${payload}.${signature}`;
}

async function runAdminShopsFrontendSuite() {
  console.log('================================================================');
  console.log('SHIP DỄ — ADMIN SHOPS UI & API ACCEPTANCE TEST SUITE (FEAT-AUTH-02)');
  console.log('================================================================\n');

  const TEST_ADMIN_KEY = `test-admin-key-${randomUUID()}`;
  const TEST_AUTH_SECRET = 'test-token-secret-must-be-long-32-chars-at-least';

  process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;
  process.env.AUTH_TOKEN_SECRET = TEST_AUTH_SECRET;

  // ---------------------------------------------------------------------------
  // 1. AC-ADMIN-15: Signed-out access to /api/admin/shops returns 403 Forbidden
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing AC-ADMIN-15: Signed-out requests reach forbidden state immediately...');
  const unauthGetReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const unauthGetRes = await GET(unauthGetReq);
  assert.strictEqual(unauthGetRes.status, 403, 'Signed-out GET must return 403 Forbidden');
  const unauthGetJson = await unauthGetRes.json();
  assert.strictEqual(unauthGetJson?.error?.code, 'FORBIDDEN');

  const unauthPostReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ merchant_name: 'Shop Unauth' }),
  });
  const unauthPostRes = await POST(unauthPostReq);
  assert.strictEqual(unauthPostRes.status, 403, 'Signed-out POST must return 403 Forbidden');
  const unauthPostJson = await unauthPostRes.json();
  assert.strictEqual(unauthPostJson?.error?.code, 'FORBIDDEN');
  console.log('✅ AC-ADMIN-15: Signed-out requests rejected with 403 Forbidden');

  // ---------------------------------------------------------------------------
  // 2. Finding 1 / Security: Arbitrary Authorization headers & cookies are rejected
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing Finding 1: Arbitrary or fabricated tokens are rejected...');
  const arbitraryTokens = [
    'Bearer invalid-random-token-string',
    'Bearer v1.invalidjson.invalidsignature',
    'Bearer some-jwt-header.payload.signature',
  ];

  for (const authHeader of arbitraryTokens) {
    const fakeReq = new NextRequest('http://localhost:3000/api/admin/shops', {
      method: 'GET',
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    const fakeRes = await GET(fakeReq);
    assert.strictEqual(
      fakeRes.status,
      403,
      `Arbitrary Authorization header "${authHeader}" must return 403 Forbidden`
    );
  }

  // Arbitrary cookie
  const fakeCookieReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: {
      Cookie: 'token=arbitrary-token-cookie',
      Accept: 'application/json',
    },
  });
  const fakeCookieRes = await GET(fakeCookieReq);
  assert.strictEqual(fakeCookieRes.status, 403, 'Arbitrary cookie must return 403 Forbidden');

  // Finding 3: Cookie-only POST must NOT be authorized (CSRF defense)
  const validTokenForCookie = generateTestV1Token({ role: 'BACKOFFICE' }, TEST_AUTH_SECRET);
  const cookieOnlyPostReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'POST',
    headers: {
      Cookie: `token=${validTokenForCookie}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchant_name: 'Cookie Alone Post' }),
  });
  const cookieOnlyPostRes = await POST(cookieOnlyPostReq);
  assert.strictEqual(
    cookieOnlyPostRes.status,
    403,
    'Finding 3: State-changing POST must not be authorized by cookies alone'
  );

  // Finding 3: Origin mismatch on POST must return 403 (CSRF defense)
  const originMismatchReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${validTokenForCookie}`,
      Origin: 'https://attacker.evil.com',
      Host: 'localhost:3000',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchant_name: 'Origin Mismatch Post' }),
  });
  const originMismatchRes = await POST(originMismatchReq);
  assert.strictEqual(
    originMismatchRes.status,
    403,
    'Finding 3: Origin mismatch on state-changing request must return 403'
  );

  // Tampered signature on valid payload
  const validToken = generateTestV1Token({ role: 'BACKOFFICE' }, TEST_AUTH_SECRET);
  const [ver, pay] = validToken.split('.');
  const tamperedToken = `${ver}.${pay}.tampered_signature_bytes`;
  const tamperedReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: { Authorization: `Bearer ${tamperedToken}`, Accept: 'application/json' },
  });
  const tamperedRes = await GET(tamperedReq);
  assert.strictEqual(tamperedRes.status, 403, 'Tampered token signature must return 403 Forbidden');

  // Expired token
  const expiredToken = generateTestV1Token(
    { role: 'BACKOFFICE', exp: Math.floor(Date.now() / 1000) - 100 },
    TEST_AUTH_SECRET
  );
  const expiredReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: { Authorization: `Bearer ${expiredToken}`, Accept: 'application/json' },
  });
  const expiredRes = await GET(expiredReq);
  assert.strictEqual(expiredRes.status, 403, 'Expired token must return 403 Forbidden');
  console.log('✅ Finding 1: Arbitrary, tampered, and expired tokens fail closed');

  // ---------------------------------------------------------------------------
  // 3. Finding 1 / Role Enforcement: Non-platform-admin roles are rejected
  // ---------------------------------------------------------------------------
  console.log(
    '🧪 Testing Finding 1: Non-platform-admin roles (OWNER, OPS_CSKH, etc.) are rejected...'
  );
  const tenantRoles = ['OWNER', 'OPS_CSKH', 'WAREHOUSE', 'ACCOUNTANT'];
  for (const role of tenantRoles) {
    const tenantToken = generateTestV1Token({ role }, TEST_AUTH_SECRET);
    const tenantReq = new NextRequest('http://localhost:3000/api/admin/shops', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tenantToken}`, Accept: 'application/json' },
    });
    const tenantRes = await GET(tenantReq);
    assert.strictEqual(
      tenantRes.status,
      403,
      `User with tenant role "${role}" must be rejected with 403 Forbidden from admin endpoints`
    );
    const tenantJson = await tenantRes.json();
    assert.strictEqual(tenantJson?.error?.code, 'FORBIDDEN');
  }

  // Platform admin roles are authorized
  const backofficeToken = generateTestV1Token({ role: 'BACKOFFICE' }, TEST_AUTH_SECRET);
  const backofficeReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    headers: { Authorization: `Bearer ${backofficeToken}` },
  });
  const backofficeAuth = verifyAdminAuthorization(backofficeReq);
  assert.strictEqual(backofficeAuth.authorized, true, 'BACKOFFICE role must be authorized');

  const platformAdminToken = generateTestV1Token({ role: 'PLATFORM_ADMIN' }, TEST_AUTH_SECRET);
  const platformAdminReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    headers: { Authorization: `Bearer ${platformAdminToken}` },
  });
  const platformAdminAuth = verifyAdminAuthorization(platformAdminReq);
  assert.strictEqual(platformAdminAuth.authorized, true, 'PLATFORM_ADMIN role must be authorized');
  console.log('✅ Finding 1: Platform-admin role enforcement strictly verified');

  // ---------------------------------------------------------------------------
  // 4. ADMIN_API_KEY Path Removal: x-admin-key alone is rejected, requires session
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing ADMIN_API_KEY path removal: static key rejected without session...');
  const keyOnlyReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    headers: { 'x-admin-key': TEST_ADMIN_KEY },
  });
  assert.strictEqual(verifyAdminAuthorization(keyOnlyReq).authorized, false);
  console.log('✅ ADMIN_API_KEY path removed, session authorization required');

  // ---------------------------------------------------------------------------
  // 5. Finding 4 / AC-ADMIN-14: Upstream Failure Preservation (Never fabricated 200)
  // ---------------------------------------------------------------------------
  console.log(
    '🧪 Testing Finding 4: Upstream list failures are preserved as canonical errors (502)...'
  );
  // With API backend offline on port 3001, GET /api/admin/shops must return 502 UPSTREAM_ERROR, NOT 200
  const authGetReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${platformAdminToken}`,
      Accept: 'application/json',
    },
  });
  const authGetRes = await GET(authGetReq);
  assert.notStrictEqual(
    authGetRes.status,
    200,
    'AC-ADMIN-14: Failed upstream request must NEVER return a fabricated 200 empty state'
  );
  assert.strictEqual(
    authGetRes.status,
    502,
    'Upstream network failure must return 502 Bad Gateway'
  );
  const authGetJson = await authGetRes.json();
  assert.strictEqual(authGetJson?.error?.code, 'UPSTREAM_ERROR');

  // POST upstream failure also returns 502
  const authPostReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${platformAdminToken}`,
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchant_name: 'Shop Upstream Test' }),
  });
  const authPostRes = await POST(authPostReq);
  assert.strictEqual(authPostRes.status, 502, 'POST upstream network failure must return 502');
  console.log(
    '✅ Finding 4: Upstream failures preserved as canonical errors (status 502, UPSTREAM_ERROR)'
  );

  // ---------------------------------------------------------------------------
  // 6. Form Validation Logic: Complete field and format coverage
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing Creation Flow: Form validation logic...');
  // Missing both email and phone
  const errNoContact = validateShopForm('Shop Valid', '', '');
  assert.ok(errNoContact.email, 'Must require email when phone is missing');
  assert.ok(errNoContact.phone, 'Must require phone when email is missing');

  // Name too short (< 2)
  const errShortName = validateShopForm('A', 'test@example.com', '');
  assert.ok(errShortName.merchant_name, 'Name < 2 chars must produce error');

  // Name too long (> 255)
  const errLongName = validateShopForm('A'.repeat(256), 'test@example.com', '');
  assert.ok(errLongName.merchant_name, 'Name > 255 chars must produce error');

  // Invalid email format
  const errBadEmail = validateShopForm('Shop Valid', 'not-an-email', '');
  assert.ok(errBadEmail.email, 'Malformed email must produce error');

  // Invalid phone format
  const errBadPhone = validateShopForm('Shop Valid', '', '12345');
  assert.ok(errBadPhone.phone, 'Malformed phone must produce error');

  // Password shorter than 8 chars
  const errShortPass = validateShopForm('Shop Valid', 'test@example.com', '', 'short');
  assert.ok(errShortPass.password, 'Password < 8 chars must produce error');

  // Finding 5: Rejects non-numeric phone with pipe (0|87654321)
  const errPipePhone = validateShopForm('Shop Valid', '', '0|87654321');
  assert.ok(errPipePhone.phone, 'Phone with pipe character must produce error');

  // Valid email only
  const validEmailOnly = validateShopForm('Shop Valid', 'test@example.com', '');
  assert.strictEqual(Object.keys(validEmailOnly).length, 0, 'Valid email-only must have 0 errors');

  // Valid phone only
  const validPhoneOnly = validateShopForm('Shop Valid', '', '0987654321');
  assert.strictEqual(Object.keys(validPhoneOnly).length, 0, 'Valid phone-only must have 0 errors');

  // Valid custom password >= 8
  const validWithPass = validateShopForm('Shop Valid', 'test@example.com', '', 'ValidPass123!');
  assert.strictEqual(
    Object.keys(validWithPass).length,
    0,
    'Valid password >= 8 must have 0 errors'
  );
  console.log('✅ Form validation logic: All validation constraints verified');

  // ---------------------------------------------------------------------------
  // 7. Finding 5 / AC-ADMIN-14 / AC-ADMIN-15: Real Component State Rendering
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing Finding 5: Real UI Component rendering across all states...');

  // State 1: Forbidden State (Signed out, regardless of isHydrating)
  const forbiddenHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: false,
      user: null,
      isPlatformAdmin: false,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="state-forbidden"'),
    'Signed-out view must render state-forbidden'
  );
  assert.ok(
    forbiddenHtml.includes('Truy cập bị từ chối (403 Forbidden)'),
    'Forbidden state must show 403 Forbidden heading'
  );

  // Finding 1 / AC-ADMIN-15: Signed-out user during isHydrating=true must still render forbidden on first paint
  const hydratingForbiddenHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: false,
      user: null,
      isPlatformAdmin: false,
      isHydrating: true,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(
    hydratingForbiddenHtml.includes('data-testid="state-forbidden"'),
    'Signed-out view during hydration must render state-forbidden immediately on first paint'
  );
  assert.ok(
    !hydratingForbiddenHtml.includes('animate-spin') &&
      !hydratingForbiddenHtml.includes('animate-pulse'),
    'Signed-out view must not render any spinner or skeleton while hydrating'
  );

  // State 2: Forbidden State (Signed in as merchant OWNER)
  const ownerForbiddenHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'OWNER', full_name: 'Shop Owner' },
      isPlatformAdmin: false,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(
    ownerForbiddenHtml.includes('data-testid="state-forbidden"'),
    'Signed-in non-platform-admin view must render state-forbidden'
  );

  // State 3: Loading State
  const loadingHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [],
      isLoading: true,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(loadingHtml.includes('data-testid="state-loading"'), 'Must render state-loading');

  // State 4: Empty State
  const emptyHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(emptyHtml.includes('data-testid="state-empty"'), 'Must render state-empty');
  assert.ok(emptyHtml.includes('Chưa có cửa hàng nào được khởi tạo'));

  // State 5: Error State (Upstream Failure Rendering)
  const errorHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: 'Không thể kết nối đến máy chủ quản trị (HTTP 502)',
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(errorHtml.includes('data-testid="state-error"'), 'Must render state-error');
  assert.ok(
    errorHtml.includes('Không thể kết nối đến máy chủ quản trị (HTTP 502)'),
    'Error state must display upstream error message'
  );
  // Finding 8: Error state must not also render state-empty
  assert.ok(
    !errorHtml.includes('data-testid="state-empty"'),
    'Error state must not also render state-empty'
  );
  assert.ok(
    !errorHtml.includes('Chưa có cửa hàng nào được khởi tạo'),
    'Error state must not render empty shop guidance'
  );

  // State 6: Success State (Shop Listing rendered from exact API payload shape - Finding 2)
  const mockShopFromApi: ShopRecord = {
    id: 'm-shop-1',
    name: 'GUMAC Flagship Store',
    code: 'GUMAC_STORE_001',
    status: 'active',
    created_at: new Date().toISOString(),
    user_count: 1,
    owner: {
      id: 'u-owner-1',
      full_name: 'Nguyen Van A',
      email: 'owner@gumac.vn',
      phone: '0987654321',
    },
  };
  const successListHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [mockShopFromApi],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: false,
    })
  );
  assert.ok(
    successListHtml.includes('data-testid="state-success"'),
    'Must render state-success table'
  );
  assert.ok(successListHtml.includes('GUMAC Flagship Store'), 'Must render shop name');
  assert.ok(successListHtml.includes('GUMAC_STORE_001'), 'Must render merchant code');
  assert.ok(
    successListHtml.includes('Nguyen Van A'),
    'Must render owner full_name from API payload owner object'
  );
  assert.ok(
    successListHtml.includes('owner@gumac.vn'),
    'Must render owner email from API payload owner object'
  );
  assert.ok(
    !successListHtml.includes('Chưa gán'),
    'Must not render Chưa gán when owner is provided by API payload'
  );

  // State 7: Validation State (Create Shop Modal)
  const validationModalHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: true,
      formErrors: { merchant_name: 'Tên cửa hàng phải có ít nhất 2 ký tự' },
    })
  );
  assert.ok(
    validationModalHtml.includes('data-testid="state-validation"'),
    'Must render state-validation in modal'
  );
  assert.ok(validationModalHtml.includes('Tên cửa hàng phải có ít nhất 2 ký tự'));

  // State 8: Creation Success State (Without Plaintext Password - BR-AUTH-05)
  const mockCreatedSuccess: CreatedShopSuccessData = {
    merchant: {
      id: 'm-new-1',
      name: 'Tiệm Bánh Mì Sài Gòn',
      code: 'TIEM_BANH_MI_123',
      status: 'active',
      created_at: new Date().toISOString(),
    },
    user: {
      id: 'u-new-1',
      merchant_id: 'm-new-1',
      full_name: 'Chủ Tiệm',
      email: 'banhmi@saigon.vn',
      phone: null,
      role: 'OWNER',
      status: 'active',
      email_verified_at: new Date().toISOString(),
      phone_verified_at: null,
    },
    password_is_temporary: true,
  };
  const creationSuccessHtml = renderToStaticMarkup(
    React.createElement(AdminShopsView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE', full_name: 'Platform Operator' },
      isPlatformAdmin: true,
      isHydrating: false,
      shops: [],
      isLoading: false,
      listError: null,
      searchQuery: '',
      showCreateModal: true,
      createdSuccess: mockCreatedSuccess,
    })
  );
  assert.ok(
    creationSuccessHtml.includes('data-testid="state-success"'),
    'Creation success modal must render state-success'
  );
  assert.ok(
    creationSuccessHtml.includes('Thiết lập mật khẩu lần đầu'),
    'Must display password setup notification'
  );
  assert.strictEqual(
    creationSuccessHtml.includes('Mật khẩu đăng nhập tạm thời'),
    false,
    'BR-AUTH-05: Plaintext password must NEVER be rendered in UI'
  );

  // State 9: AdminNewShopView (Page view) renders required states
  const newShopForbiddenHtml = renderToStaticMarkup(
    React.createElement(AdminNewShopView, {
      isAuthenticated: false,
      user: null,
      isPlatformAdmin: false,
      isHydrating: false,
      merchantName: '',
      fullName: '',
      email: '',
      phone: '',
      password: '',
      isSubmitting: false,
      formErrors: {},
      createError: null,
      createdSuccess: null,
    })
  );
  assert.ok(
    newShopForbiddenHtml.includes('data-testid="state-forbidden"'),
    'AdminNewShopView must render state-forbidden when unauthenticated'
  );

  const newShopSuccessHtml = renderToStaticMarkup(
    React.createElement(AdminNewShopView, {
      isAuthenticated: true,
      user: { role: 'BACKOFFICE' },
      isPlatformAdmin: true,
      isHydrating: false,
      merchantName: '',
      fullName: '',
      email: '',
      phone: '',
      password: '',
      isSubmitting: false,
      formErrors: {},
      createError: null,
      createdSuccess: mockCreatedSuccess,
    })
  );
  assert.ok(
    newShopSuccessHtml.includes('data-testid="state-success"'),
    'AdminNewShopView must render state-success'
  );
  assert.strictEqual(
    newShopSuccessHtml.includes('Mật khẩu đăng nhập tạm thời'),
    false,
    'BR-AUTH-05: AdminNewShopView must never render plaintext password'
  );

  console.log('✅ Finding 5: All UI component states rendered and verified directly to HTML');

  console.log('\n🎉 ALL FEAT-AUTH-02 FRONTEND, ROUTE & STATE AUDIT TESTS PASSED 100%!');
}

if (process.argv[1] && process.argv[1].endsWith('admin-shops.test.ts')) {
  runAdminShopsFrontendSuite().catch((err) => {
    console.error('❌ Admin shops frontend test suite failed:', err);
    process.exit(1);
  });
}
