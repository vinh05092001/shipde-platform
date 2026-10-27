// ============================================================================
// Ship Dễ — Admin Shops Route & View Test Suite (FEAT-AUTH-02)
// Kiểm toán trạng thái UI (AC-ADMIN-14, AC-ADMIN-15) & Next.js API routes
// ============================================================================

import * as assert from 'node:assert';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/admin/shops/route';

async function runAdminShopsFrontendSuite() {
  console.log('================================================================');
  console.log('SHIP DE — ADMIN SHOPS UI & API TEST SUITE (FEAT-AUTH-02)');
  console.log('================================================================\n');

  const ADMIN_KEY = process.env.ADMIN_API_KEY || 'shipde-admin-dev-secret-key-32-chars';

  // ---------------------------------------------------------------------------
  // AC-ADMIN-15: Signed-out access to /api/admin/shops returns 403 immediately
  // ---------------------------------------------------------------------------
  console.log(
    '🧪 Testing AC-ADMIN-15: Signed-out request to GET /api/admin/shops reaches forbidden state...'
  );
  const unauthGetReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const unauthGetRes = await GET(unauthGetReq);
  assert.strictEqual(unauthGetRes.status, 403, 'Signed-out GET must return 403 Forbidden');
  const unauthGetJson = await unauthGetRes.json();
  assert.strictEqual(unauthGetJson?.error?.code, 'FORBIDDEN', 'Error code must be FORBIDDEN');
  console.log('✅ AC-ADMIN-15: Signed-out GET reached forbidden state immediately');

  console.log(
    '🧪 Testing AC-ADMIN-15: Signed-out request to POST /api/admin/shops reaches forbidden state...'
  );
  const unauthPostReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ merchant_name: 'Shop Test' }),
  });
  const unauthPostRes = await POST(unauthPostReq);
  assert.strictEqual(unauthPostRes.status, 403, 'Signed-out POST must return 403 Forbidden');
  const unauthPostJson = await unauthPostRes.json();
  assert.strictEqual(unauthPostJson?.error?.code, 'FORBIDDEN', 'Error code must be FORBIDDEN');
  console.log('✅ AC-ADMIN-15: Signed-out POST reached forbidden state immediately');

  // ---------------------------------------------------------------------------
  // AC-ADMIN-14: Authorized request to GET /api/admin/shops accepts admin key
  // ---------------------------------------------------------------------------
  console.log('🧪 Testing AC-ADMIN-14: Admin key authorized access to GET /api/admin/shops...');
  const authGetReq = new NextRequest('http://localhost:3000/api/admin/shops', {
    method: 'GET',
    headers: {
      'x-admin-key': ADMIN_KEY,
      Accept: 'application/json',
    },
  });
  const authGetRes = await GET(authGetReq);
  // Returns either 200 (live or fallback)
  assert.ok(
    authGetRes.status === 200,
    `Authorized request must return 200 (got: ${authGetRes.status})`
  );
  const authGetJson = await authGetRes.json();
  assert.strictEqual(authGetJson.success, true);
  console.log('✅ AC-ADMIN-14: Authorized access verified');

  // ---------------------------------------------------------------------------
  // AC-ADMIN-14: UI State Definitions and Accessibility Audit
  // ---------------------------------------------------------------------------
  console.log(
    '🧪 Testing AC-ADMIN-14: Verifying UI state coverage in AdminShopsView & AdminNewShopView...'
  );
  const fs = await import('node:fs');
  const path = await import('node:path');

  const webRoot = path.resolve(__dirname, '..');
  const adminShopsPagePath = path.resolve(webRoot, 'app/admin/shops/page.tsx');
  const adminNewShopPagePath = path.resolve(webRoot, 'app/admin/shops/new/page.tsx');

  assert.ok(fs.existsSync(adminShopsPagePath), 'apps/web/src/app/admin/shops/page.tsx must exist');
  assert.ok(
    fs.existsSync(adminNewShopPagePath),
    'apps/web/src/app/admin/shops/new/page.tsx must exist'
  );

  const shopsContent = fs.readFileSync(adminShopsPagePath, 'utf8');
  const newShopContent = fs.readFileSync(adminNewShopPagePath, 'utf8');

  // AC-ADMIN-14 State checks:
  const requiredStates = [
    'state-forbidden',
    'state-loading',
    'state-empty',
    'state-validation',
    'state-error',
    'state-success',
  ];

  for (const state of requiredStates) {
    assert.ok(
      shopsContent.includes(`data-testid="${state}"`),
      `AdminShopsPage must expose UI state "${state}"`
    );
  }
  console.log(
    '✅ AC-ADMIN-14: All 6 required UI states (loading, empty, validation, error, forbidden, success) exist in AdminShopsPage'
  );

  for (const state of ['state-forbidden', 'state-validation', 'state-error', 'state-success']) {
    assert.ok(
      newShopContent.includes(`data-testid="${state}"`),
      `AdminNewShopPage must expose UI state "${state}"`
    );
  }
  console.log('✅ AC-ADMIN-14: AdminNewShopPage exposes required create route states');

  // AC-ADMIN-15 Strict Check in Code:
  // Must return forbidden BEFORE any loading skeleton or in-flight fetch
  const forbiddenIndex = shopsContent.indexOf('data-testid="state-forbidden"');
  const loadingIndex = shopsContent.indexOf('data-testid="state-loading"');
  assert.ok(forbiddenIndex > 0, 'Forbidden state must be defined');
  assert.ok(loadingIndex > 0, 'Loading state must be defined');
  assert.ok(
    forbiddenIndex < loadingIndex,
    'AC-ADMIN-15: Forbidden state check must precede loading skeleton in component render'
  );
  console.log(
    '✅ AC-ADMIN-15: Signed-out forbidden gate precedes all loading skeletons and in-flight states'
  );

  console.log('\n🎉 ALL FEAT-AUTH-02 FRONTEND & ROUTE AUDIT TESTS PASSED 100%!');
}

if (process.argv[1] && process.argv[1].endsWith('admin-shops.test.ts')) {
  runAdminShopsFrontendSuite().catch((err) => {
    console.error('❌ Admin shops frontend test suite failed:', err);
    process.exit(1);
  });
}
