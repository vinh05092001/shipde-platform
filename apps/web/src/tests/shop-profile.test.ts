import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShopProfile } from '@shipde/contracts';
import {
  ShopProfileForm,
  validateShopProfileForm,
  ShopProfileFormState,
} from '@/components/ShopProfileForm';
import ShopSettingsPage from '@/app/settings/shop/page';
import { AuthProvider } from '@/context/AuthContext';

async function runShopProfileWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB SHOP PROFILE UI STATES TEST SUITE (FEAT-ORG-01)');
  console.log('================================================================');

  const mockProfile: ShopProfile = {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Gumac Fashion Flagship',
    code: 'GUMAC_HCM',
    status: 'active',
    legal_name: 'Công ty Cổ phần Thời trang Gumac',
    tax_code: '0312345678',
    contact_email: 'support@gumac.vn',
    contact_phone: '0901234567',
    legal_address: '128 Nguyễn Trãi, P.3, Q.5, TP.HCM',
    billing_email: 'ketoan@gumac.vn',
    billing_address: '128 Nguyễn Trãi, P.3, Q.5, TP.HCM',
    bank_name: 'Vietcombank',
    bank_account_number: '0071001234567',
    bank_account_name: 'CTY CP GUMAC',
    bank_branch: 'Chi nhánh Nam Sài Gòn',
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
    default_fee_payer: 'SHOP',
    default_weight_unit: 'g',
    auto_routing_enabled: false,
    operating_notes: 'Giao hàng giờ hành chính',
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  // 1. Form Validation Unit Tests
  console.log('🧪 Testing Form Validation: validateShopProfileForm...');
  const validState: ShopProfileFormState = {
    name: 'Gumac Saigon',
    legal_name: 'CTY GUMAC',
    tax_code: '0312345678',
    contact_email: 'contact@gumac.vn',
    contact_phone: '0901234567',
    legal_address: 'HCM',
    billing_email: 'bill@gumac.vn',
    billing_address: 'HCM',
    bank_name: 'VCB',
    bank_account_number: '1234567890',
    bank_account_name: 'CTY GUMAC',
    bank_branch: 'HCM',
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
    default_fee_payer: 'SHOP',
    default_weight_unit: 'g',
    auto_routing_enabled: false,
    operating_notes: 'Notes',
  };

  const validRes = validateShopProfileForm(validState);
  assert.strictEqual(validRes.isValid, true);
  assert.strictEqual(Object.keys(validRes.errors).length, 0);

  // Invalid name
  const invalidNameRes = validateShopProfileForm({ ...validState, name: 'A' });
  assert.strictEqual(invalidNameRes.isValid, false);
  assert.ok(invalidNameRes.errors.name);

  // Invalid tax code
  const invalidTaxRes = validateShopProfileForm({ ...validState, tax_code: '12345' });
  assert.strictEqual(invalidTaxRes.isValid, false);
  assert.ok(invalidTaxRes.errors.tax_code);

  // Valid 13-digit branch tax code
  const branchTaxRes = validateShopProfileForm({ ...validState, tax_code: '0312345678-001' });
  assert.strictEqual(branchTaxRes.isValid, true);

  // Invalid email and phone
  const invalidEmailPhone = validateShopProfileForm({
    ...validState,
    contact_email: 'bad-email',
    contact_phone: '123',
  });
  assert.strictEqual(invalidEmailPhone.isValid, false);
  assert.ok(invalidEmailPhone.errors.contact_email);
  assert.ok(invalidEmailPhone.errors.contact_phone);

  // Invalid bank account number
  const invalidBankRes = validateShopProfileForm({ ...validState, bank_account_number: '12' });
  assert.strictEqual(invalidBankRes.isValid, false);
  assert.ok(invalidBankRes.errors.bank_account_number);

  console.log('  PASS: Form validation logic verified.');

  // 2. React Static Markup: Loading State
  console.log('🧪 Testing UI State: Loading skeleton...');
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, { initialLoading: true })
  );
  assert.ok(loadingMarkup.includes('data-testid="shop-profile-loading"'));
  assert.ok(loadingMarkup.includes('Đang tải hồ sơ cửa hàng...'));
  console.log('  PASS: Loading state skeleton rendered.');

  // 3. React Static Markup: View Mode
  console.log('🧪 Testing UI State: View mode with full cards...');
  const viewMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialMode: 'view',
      initialCanEdit: true,
    })
  );
  assert.ok(viewMarkup.includes('Gumac Fashion Flagship'));
  assert.ok(viewMarkup.includes('GUMAC_HCM'));
  assert.ok(viewMarkup.includes('Công ty Cổ phần Thời trang Gumac'));
  assert.ok(viewMarkup.includes('0312345678'));
  assert.ok(viewMarkup.includes('0071001234567'));
  assert.ok(viewMarkup.includes('Vietcombank'));
  assert.ok(viewMarkup.includes('CTY CP GUMAC'));
  assert.ok(viewMarkup.includes('data-testid="edit-shop-button"'));
  assert.ok(viewMarkup.includes('Chỉnh sửa hồ sơ'));
  console.log('  PASS: View mode rendered all 3 sections.');

  // 4. React Static Markup: Edit Mode
  console.log('🧪 Testing UI State: Edit mode with interactive form...');
  const editMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialMode: 'edit',
      initialCanEdit: true,
    })
  );
  assert.ok(editMarkup.includes('data-testid="shop-profile-edit-form"'));
  assert.ok(editMarkup.includes('data-testid="input-name"'));
  assert.ok(editMarkup.includes('data-testid="input-legal-name"'));
  assert.ok(editMarkup.includes('data-testid="input-tax-code"'));
  assert.ok(editMarkup.includes('data-testid="input-bank-account-number"'));
  assert.ok(editMarkup.includes('data-testid="save-shop-button"'));
  assert.ok(editMarkup.includes('data-testid="cancel-edit-button"'));
  assert.ok(editMarkup.includes('Lưu thay đổi'));
  console.log('  PASS: Edit form rendered with input controls.');

  // 5. React Static Markup: Validation Errors Display
  console.log('🧪 Testing UI State: Validation errors display...');
  const validationMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialMode: 'edit',
      initialValidationErrors: {
        tax_code: 'Mã số thuế không hợp lệ theo chuẩn Việt Nam',
        contact_email: 'Email liên hệ không hợp lệ',
      },
    })
  );
  assert.ok(validationMarkup.includes('Mã số thuế không hợp lệ theo chuẩn Việt Nam'));
  assert.ok(validationMarkup.includes('Email liên hệ không hợp lệ'));
  console.log('  PASS: Validation errors rendered inline.');

  // 6. React Static Markup: Persistent Server Error with Retry
  console.log('🧪 Testing UI State: Server error banner with retry...');
  const errorMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialError: 'Lỗi kết nối máy chủ backend. Vui lòng thử lại.',
      onRefresh: () => {},
    })
  );
  assert.ok(errorMarkup.includes('data-testid="shop-profile-error-banner"'));
  assert.ok(errorMarkup.includes('Lỗi kết nối máy chủ backend'));
  assert.ok(errorMarkup.includes('data-testid="retry-error-button"'));
  console.log('  PASS: Error banner with retry action rendered.');

  // 7. React Static Markup: Forbidden State (Unauthorized Role)
  console.log('🧪 Testing UI State: Forbidden banner for unauthorized roles...');
  const forbiddenMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialCanEdit: false,
    })
  );
  assert.ok(forbiddenMarkup.includes('data-testid="shop-profile-forbidden-banner"'));
  assert.ok(forbiddenMarkup.includes('Giới hạn quyền cấu hình cửa hàng'));
  assert.ok(!forbiddenMarkup.includes('data-testid="edit-shop-button"'));
  console.log('  PASS: Forbidden banner rendered, edit action suppressed.');

  // 8. React Static Markup: Success Notification
  console.log('🧪 Testing UI State: Success toast notification...');
  const successMarkup = renderToStaticMarkup(
    React.createElement(ShopProfileForm, {
      initialProfile: mockProfile,
      initialSuccess: 'Đã cập nhật hồ sơ shop thành công',
    })
  );
  assert.ok(successMarkup.includes('data-testid="shop-profile-success-banner"'));
  assert.ok(successMarkup.includes('Đã cập nhật hồ sơ shop thành công'));
  console.log('  PASS: Success banner rendered.');

  // 9. React Static Markup: Page Container & Breadcrumbs
  console.log('🧪 Testing Page Container: ShopSettingsPage...');
  const pageMarkup = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(ShopSettingsPage, {
        initialProfile: mockProfile,
        initialLoading: false,
        initialCanEdit: true,
      })
    )
  );
  assert.ok(pageMarkup.includes('Hồ sơ Cửa hàng (SCR-SHOP-01)'));
  assert.ok(pageMarkup.includes('Quay lại Bảng Điều Khiển'));
  assert.ok(pageMarkup.includes('Gumac Fashion Flagship'));
  console.log('  PASS: ShopSettingsPage full container verified.');

  console.log('================================================================');
  console.log('🎉 ALL WEB SHOP PROFILE UI STATES VERIFIED 100%!');
  console.log('================================================================');
}

runShopProfileWebTestSuite().catch((err) => {
  console.error('❌ Shop profile web test suite failed:', err);
  process.exit(1);
});
