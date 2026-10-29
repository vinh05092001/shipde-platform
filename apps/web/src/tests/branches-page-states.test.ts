import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Branch } from '@shipde/contracts';
import {
  validateBranchForm,
  type BranchFormState,
  isValidBranchCode,
  isValidBranchPhone,
} from '@shipde/contracts';
import { BranchManagementView } from '@/components/BranchManagementView';
import BranchesSettingsPage from '@/app/settings/branches/page';
import { AuthProvider } from '@/context/AuthContext';

async function runBranchesWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB BRANCHES UI STATES TEST SUITE (FEAT-ORG-02)');
  console.log('================================================================');

  const mockBranchDefault: Branch = {
    id: '11111111-aaaa-bbbb-cccc-000000000001',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Kho Tổng TP.HCM',
    code: 'HCM-MAIN-01',
    address: '128 Nguyễn Trãi, Phường 3, Quận 5, TP.HCM',
    phone: '0901234567',
    is_default: true,
    status: 'ACTIVE',
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const mockBranchHanoi: Branch = {
    id: '11111111-aaaa-bbbb-cccc-000000000002',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Chi nhánh Hà Nội - Cầu Giấy',
    code: 'HN-CG-02',
    address: '88 Cầu Giấy, P. Dịch Vọng, Q. Cầu Giấy, Hà Nội',
    phone: '0987654321',
    is_default: false,
    status: 'ACTIVE',
    created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
  };

  const mockBranchDanangInactive: Branch = {
    id: '11111111-aaaa-bbbb-cccc-000000000003',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Điểm gửi hàng Đà Nẵng',
    code: 'DN-HUB-03',
    address: '15 Lê Duẩn, Q. Hải Châu, Đà Nẵng',
    phone: '+84912345678',
    is_default: false,
    status: 'INACTIVE',
    created_at: new Date('2026-01-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-03T00:00:00Z').toISOString(),
  };

  const allBranches = [mockBranchDefault, mockBranchHanoi, mockBranchDanangInactive];

  // 1. Form Validation Unit Tests
  console.log('🧪 1. Testing Validation Logic: validateBranchForm & regex helpers...');
  const validState: BranchFormState = {
    name: 'Kho Bình Thạnh',
    code: 'HCM-BT-01',
    address: '45 Điện Biên Phủ, P.15, Bình Thạnh',
    phone: '0909888999',
    is_default: false,
    status: 'ACTIVE',
  };

  const validRes = validateBranchForm(validState);
  assert.strictEqual(validRes.isValid, true);
  assert.strictEqual(Object.keys(validRes.errors).length, 0);

  // Validate Code helper
  assert.strictEqual(isValidBranchCode('HCM-KHO-01'), true);
  assert.strictEqual(isValidBranchCode('BRANCH_02'), true);
  assert.strictEqual(isValidBranchCode('B'), false); // Too short
  assert.strictEqual(isValidBranchCode('branch@01'), false); // Invalid char @

  // Validate Phone helper
  assert.strictEqual(isValidBranchPhone('0901234567'), true);
  assert.strictEqual(isValidBranchPhone('+84901234567'), true);
  assert.strictEqual(isValidBranchPhone('0381112222'), true);
  assert.strictEqual(isValidBranchPhone('0123456789'), false); // 01 is obsolete 11-digit
  assert.strictEqual(isValidBranchPhone('abcd'), false);

  // Invalid Name (< 2 chars)
  const invalidNameRes = validateBranchForm({ ...validState, name: 'A' });
  assert.strictEqual(invalidNameRes.isValid, false);
  assert.ok(invalidNameRes.errors.name);

  // Invalid Code
  const invalidCodeRes = validateBranchForm({ ...validState, code: 'bad code with space' });
  assert.strictEqual(invalidCodeRes.isValid, false);
  assert.ok(invalidCodeRes.errors.code);

  // Invalid Phone
  const invalidPhoneRes = validateBranchForm({ ...validState, phone: '012345' });
  assert.strictEqual(invalidPhoneRes.isValid, false);
  assert.ok(invalidPhoneRes.errors.phone);

  // Invalid Address (> 1000 chars)
  const invalidAddrRes = validateBranchForm({ ...validState, address: 'x'.repeat(1001) });
  assert.strictEqual(invalidAddrRes.isValid, false);
  assert.ok(invalidAddrRes.errors.address);

  console.log('  PASS: Branch form validation passed.');

  // 2. Loading State Skeleton
  console.log('🧪 2. Testing UI State: Loading skeleton...');
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, { loading: true })
  );
  assert.ok(loadingMarkup.includes('data-testid="branch-loading-state"'));
  assert.ok(loadingMarkup.includes('Đang tải danh sách chi nhánh...'));
  console.log('  PASS: Loading state skeleton verified.');

  // 3. Empty State
  console.log('🧪 3. Testing UI State: Empty state when no branches...');
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: [],
      loading: false,
      canEdit: true,
    })
  );
  assert.ok(emptyMarkup.includes('data-testid="branch-empty-state"'));
  assert.ok(emptyMarkup.includes('Chưa có chi nhánh nào'));
  assert.ok(emptyMarkup.includes('data-testid="empty-create-branch-button"'));
  assert.ok(emptyMarkup.includes('Tạo chi nhánh đầu tiên'));
  console.log('  PASS: Empty state verified.');

  // 4. Branch List Grid with multiple branches
  console.log('🧪 4. Testing UI State: Branch list grid rendering...');
  const listMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      loading: false,
      canEdit: true,
    })
  );
  assert.ok(listMarkup.includes('data-testid="branch-list-grid"'));
  assert.ok(listMarkup.includes('data-testid="branch-item-11111111-aaaa-bbbb-cccc-000000000001"'));
  assert.ok(listMarkup.includes('data-testid="branch-item-11111111-aaaa-bbbb-cccc-000000000002"'));
  assert.ok(listMarkup.includes('data-testid="branch-item-11111111-aaaa-bbbb-cccc-000000000003"'));
  // Default badge
  assert.ok(
    listMarkup.includes('data-testid="default-badge-11111111-aaaa-bbbb-cccc-000000000001"')
  );
  assert.ok(listMarkup.includes('Mặc định'));
  // Monospace code badges
  assert.ok(listMarkup.includes('HCM-MAIN-01'));
  assert.ok(listMarkup.includes('HN-CG-02'));
  assert.ok(listMarkup.includes('DN-HUB-03'));
  // Names & Addresses
  assert.ok(listMarkup.includes('Kho Tổng TP.HCM'));
  assert.ok(listMarkup.includes('Chi nhánh Hà Nội - Cầu Giấy'));
  assert.ok(listMarkup.includes('128 Nguyễn Trãi, Phường 3, Quận 5, TP.HCM'));
  // Action buttons
  assert.ok(
    listMarkup.includes('data-testid="edit-branch-button-11111111-aaaa-bbbb-cccc-000000000001"')
  );
  assert.ok(
    listMarkup.includes('data-testid="set-default-button-11111111-aaaa-bbbb-cccc-000000000002"')
  );
  assert.ok(
    listMarkup.includes(
      'data-testid="deactivate-branch-button-11111111-aaaa-bbbb-cccc-000000000001"'
    )
  );
  assert.ok(
    listMarkup.includes('data-testid="activate-branch-button-11111111-aaaa-bbbb-cccc-000000000003"')
  );
  console.log('  PASS: Branch list grid rendering verified.');

  // 5. Create Branch Modal
  console.log('🧪 5. Testing UI State: Create Branch modal dialog...');
  const createModalMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      initialFormOpen: true,
      initialEditingBranch: null,
      canEdit: true,
    })
  );
  assert.ok(createModalMarkup.includes('data-testid="branch-form-modal"'));
  assert.ok(createModalMarkup.includes('Thêm chi nhánh mới'));
  assert.ok(createModalMarkup.includes('data-testid="input-branch-name"'));
  assert.ok(createModalMarkup.includes('data-testid="input-branch-code"'));
  assert.ok(createModalMarkup.includes('data-testid="input-branch-phone"'));
  assert.ok(createModalMarkup.includes('data-testid="input-branch-address"'));
  assert.ok(createModalMarkup.includes('data-testid="input-branch-default"'));
  assert.ok(createModalMarkup.includes('data-testid="submit-branch-button"'));
  assert.ok(createModalMarkup.includes('Tạo chi nhánh'));
  console.log('  PASS: Create Branch modal verified.');

  // 6. Edit Branch Modal
  console.log('🧪 6. Testing UI State: Edit Branch modal dialog...');
  const editModalMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      initialFormOpen: true,
      initialEditingBranch: mockBranchHanoi,
      canEdit: true,
    })
  );
  assert.ok(editModalMarkup.includes('data-testid="branch-form-modal"'));
  assert.ok(editModalMarkup.includes('Chỉnh sửa thông tin chi nhánh'));
  assert.ok(editModalMarkup.includes('value="Chi nhánh Hà Nội - Cầu Giấy"'));
  assert.ok(editModalMarkup.includes('value="HN-CG-02"'));
  assert.ok(editModalMarkup.includes('Lưu thay đổi'));
  console.log('  PASS: Edit Branch modal verified.');

  // 7. Inline Validation Errors Display in Modal
  console.log('🧪 7. Testing UI State: Inline validation errors in modal...');
  const validationMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      initialFormOpen: true,
      canEdit: true,
      initialValidationErrors: {
        name: 'Tên chi nhánh là bắt buộc và phải có ít nhất 2 ký tự',
        code: 'Mã chi nhánh là bắt buộc, từ 2 đến 64 ký tự',
        phone: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
      },
    })
  );
  assert.ok(validationMarkup.includes('data-testid="error-branch-name"'));
  assert.ok(validationMarkup.includes('Tên chi nhánh là bắt buộc và phải có ít nhất 2 ký tự'));
  assert.ok(validationMarkup.includes('data-testid="error-branch-code"'));
  assert.ok(validationMarkup.includes('Mã chi nhánh là bắt buộc, từ 2 đến 64 ký tự'));
  assert.ok(validationMarkup.includes('data-testid="error-branch-phone"'));
  assert.ok(validationMarkup.includes('Số điện thoại không hợp lệ theo định dạng Việt Nam'));
  console.log('  PASS: Inline validation errors verified.');

  // 8. Server Error Banner with Recovery Retry
  console.log('🧪 8. Testing UI State: Server error banner with retry...');
  const serverErrorMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      error: 'Lỗi kết nối máy chủ quản lý chi nhánh. Vui lòng thử lại.',
      onRefresh: () => {},
    })
  );
  assert.ok(serverErrorMarkup.includes('data-testid="branch-error-banner"'));
  assert.ok(serverErrorMarkup.includes('Lỗi kết nối máy chủ quản lý chi nhánh'));
  assert.ok(serverErrorMarkup.includes('data-testid="retry-error-button"'));
  assert.ok(serverErrorMarkup.includes('data-testid="dismiss-error-button"'));
  console.log('  PASS: Server error banner with recovery verified.');

  // 9. Forbidden State (View-only / Unauthorized Role)
  console.log('🧪 9. Testing UI State: Forbidden banner for unauthorized role...');
  const forbiddenMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      canEdit: false,
    })
  );
  assert.ok(forbiddenMarkup.includes('data-testid="branch-forbidden-banner"'));
  assert.ok(forbiddenMarkup.includes('Giới hạn quyền cấu hình chi nhánh'));
  // Mutation buttons must NOT exist
  assert.ok(!forbiddenMarkup.includes('data-testid="create-branch-button"'));
  assert.ok(
    !forbiddenMarkup.includes(
      'data-testid="edit-branch-button-11111111-aaaa-bbbb-cccc-000000000001"'
    )
  );
  console.log('  PASS: Forbidden state verified.');

  // 10. Scoped Access (Partial view / restricted store_scopes)
  console.log('🧪 10. Testing UI State: Scoped access info banner...');
  const scopedMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: [mockBranchDefault],
      scopedStores: ['HCM-MAIN-01'],
      canEdit: true,
    })
  );
  assert.ok(scopedMarkup.includes('data-testid="branch-scoped-banner"'));
  assert.ok(scopedMarkup.includes('Phạm vi truy cập theo phân quyền'));
  assert.ok(scopedMarkup.includes('HCM-MAIN-01'));
  console.log('  PASS: Scoped access info banner verified.');

  // 11. Success Notification Banner
  console.log('🧪 11. Testing UI State: Success notification banner...');
  const successMarkup = renderToStaticMarkup(
    React.createElement(BranchManagementView, {
      branches: allBranches,
      success: 'Đã tạo mới chi nhánh Kho Miền Trung thành công',
    })
  );
  assert.ok(successMarkup.includes('data-testid="branch-success-banner"'));
  assert.ok(successMarkup.includes('Đã tạo mới chi nhánh Kho Miền Trung thành công'));
  console.log('  PASS: Success notification verified.');

  // 12. Full Page Container: BranchesSettingsPage
  console.log('🧪 12. Testing Full Page Container: BranchesSettingsPage...');
  const pageMarkup = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(BranchesSettingsPage, {
        initialBranches: allBranches,
        initialLoading: false,
        initialCanEdit: true,
      })
    )
  );
  assert.ok(pageMarkup.includes('Chi nhánh &amp; Điểm gửi hàng (SCR-WH-01 / FEAT-ORG-02)'));
  assert.ok(pageMarkup.includes('Quay lại Bảng Điều Khiển'));
  assert.ok(pageMarkup.includes('Hồ sơ Shop'));
  assert.ok(pageMarkup.includes('Nhân sự'));
  assert.ok(pageMarkup.includes('Phân quyền'));
  assert.ok(pageMarkup.includes('Kho Tổng TP.HCM'));
  assert.ok(pageMarkup.includes('HCM-MAIN-01'));
  console.log('  PASS: BranchesSettingsPage full container verified.');

  console.log('================================================================');
  console.log('🎉 ALL WEB BRANCHES UI STATES VERIFIED 100%!');
  console.log('================================================================');
}

runBranchesWebTestSuite().catch((err) => {
  console.error('❌ Branches web test suite failed:', err);
  process.exit(1);
});
