import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  type OnboardingStateResponseDto,
} from '@shipde/contracts';
import {
  OnboardingFlow,
  validateWarehouseInput,
  type WarehouseFormData,
} from '@/components/OnboardingFlow';
import OnboardingPage from '@/app/onboarding/page';
import { AuthProvider } from '@/context/AuthContext';

/**
 * FEAT-ONB-01 Web Component & AGENTS.md States Proving Test Suite
 * Tests loading, empty, partial, validation, error, forbidden, success,
 * blocked dependencies, and overall completed celebration states.
 */
async function runOnboardingWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - GUIDED ONBOARDING WEB UI STATES TEST SUITE (FEAT-ONB-01)');
  console.log('================================================================');

  // --- 1. Form Validation Unit Tests ---
  console.log('🧪 1. Testing Warehouse Form Validation: validateWarehouseInput...');
  const validWh: WarehouseFormData = {
    name: 'Kho Tân Bình',
    phone: '0901234567',
    address: '128 Nguyễn Trãi, P.3, Q.5',
    city: 'Hồ Chí Minh',
  };
  const validRes = validateWarehouseInput(validWh);
  assert.strictEqual(validRes.isValid, true);
  assert.strictEqual(Object.keys(validRes.errors).length, 0);

  // Invalid warehouse name
  const invalidNameRes = validateWarehouseInput({ ...validWh, name: 'A' });
  assert.strictEqual(invalidNameRes.isValid, false);
  assert.ok(invalidNameRes.errors.name, 'Warehouse name < 2 chars must produce error');

  // Invalid phone numbers
  const invalidPhone1 = validateWarehouseInput({ ...validWh, phone: '123' });
  assert.strictEqual(invalidPhone1.isValid, false);
  assert.ok(invalidPhone1.errors.phone, 'Phone 123 must produce error');

  const invalidPhone2 = validateWarehouseInput({ ...validWh, phone: '0123456789' }); // 01 is not valid VN prefix
  assert.strictEqual(invalidPhone2.isValid, false);
  assert.ok(invalidPhone2.errors.phone, 'Non-VN prefix phone must produce error');

  // Valid +84 format phone
  const validPhonePlus84 = validateWarehouseInput({ ...validWh, phone: '+84901234567' });
  assert.strictEqual(validPhonePlus84.isValid, true);

  // Invalid warehouse address
  const invalidAddressRes = validateWarehouseInput({ ...validWh, address: '  ' });
  assert.strictEqual(invalidAddressRes.isValid, false);
  assert.ok(invalidAddressRes.errors.address, 'Empty address must produce error');

  console.log('  PASS: Warehouse validation rules correctly enforced');

  // --- Mock Payloads for Component States ---
  const mockInitialState: OnboardingStateResponseDto = {
    merchant_id: 'merchant-test-111',
    status: OnboardingOverallStatus.IN_PROGRESS,
    current_step: OnboardingStepId.SHOP_PROFILE,
    progress_percentage: 0,
    completed_count: 0,
    total_required_steps: 4,
    completed_required_steps: 0,
    completed_at: null,
    updated_at: new Date().toISOString(),
    can_edit: true,
    steps: [
      {
        id: OnboardingStepId.SHOP_PROFILE,
        order: 1,
        title: 'Hồ sơ Cửa hàng & Pháp lý',
        description:
          'Cấu hình tên thương hiệu, tên pháp nhân, mã số thuế và thông tin thanh toán mặc định.',
        required: true,
        status: OnboardingStepStatus.IN_PROGRESS,
        is_blocking: false,
        blocking_reasons: [],
        completed_at: null,
      },
      {
        id: OnboardingStepId.WAREHOUSE,
        order: 2,
        title: 'Kho hàng đầu tiên',
        description: 'Thiết lập địa chỉ lấy hàng và trả hàng chính cho các đơn vận chuyển.',
        required: true,
        status: OnboardingStepStatus.BLOCKED,
        is_blocking: true,
        blocking_reasons: [
          'Cần hoàn thành bước "Hồ sơ Cửa hàng & Pháp lý" trước khi thực hiện bước này',
        ],
        completed_at: null,
      },
      {
        id: OnboardingStepId.INVITE_USERS,
        order: 3,
        title: 'Mời thành viên & Phân quyền',
        description:
          'Mời nhân viên vận hành, kế toán hoặc thủ kho vào hệ thống và phân quyền phạm vi.',
        required: false,
        status: OnboardingStepStatus.PENDING,
        is_blocking: false,
        blocking_reasons: [],
        completed_at: null,
      },
      {
        id: OnboardingStepId.CARRIER_ACCOUNT,
        order: 4,
        title: 'Kết nối Hãng vận chuyển',
        description:
          'Kết nối tài khoản nhà vận chuyển (GHN, GHTK, Viettel Post, v.v.) và kiểm tra kết nối dịch vụ.',
        required: true,
        status: OnboardingStepStatus.BLOCKED,
        is_blocking: true,
        blocking_reasons: [
          'Cần hoàn thành bước "Hồ sơ Cửa hàng & Pháp lý" trước khi thực hiện bước này',
        ],
        completed_at: null,
      },
      {
        id: OnboardingStepId.OPERATING_DEFAULTS,
        order: 5,
        title: 'Cấu hình Vận hành Mặc định',
        description: 'Thiết lập người trả cước mặc định, đơn vị đo lường và cài đặt thông báo.',
        required: false,
        status: OnboardingStepStatus.PENDING,
        is_blocking: false,
        blocking_reasons: [],
        completed_at: null,
      },
      {
        id: OnboardingStepId.TEST_ORDER,
        order: 6,
        title: 'Tạo đơn thử nghiệm & Kiểm tra cước',
        description:
          'Kiểm tra khả năng phục vụ tuyến đường, tra cứu bảng giá cước và tạo vận đơn thử nghiệm an toàn.',
        required: true,
        status: OnboardingStepStatus.BLOCKED,
        is_blocking: true,
        blocking_reasons: [
          'Cần hoàn thành bước "Hồ sơ Cửa hàng & Pháp lý" trước khi thực hiện bước này',
          'Cần hoàn thành bước "Kho hàng đầu tiên" trước khi thực hiện bước này',
          'Cần hoàn thành bước "Kết nối Hãng vận chuyển" trước khi thực hiện bước này',
        ],
        completed_at: null,
      },
    ],
  };

  const renderPage = (props?: any) => {
    return renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(OnboardingPage, props || {}))
    );
  };

  const renderFlow = (props?: any) => {
    return renderToStaticMarkup(React.createElement(OnboardingFlow, props || {}));
  };

  // --- 2. State: LOADING ---
  console.log('🧪 2. Testing UI State: LOADING...');
  const loadingHtml = renderFlow({ initialLoading: true, initialState: null });
  assert.ok(loadingHtml.includes('role="status"'), 'Loading state must have role="status"');
  assert.ok(
    loadingHtml.includes('animate-pulse'),
    'Loading state must render pulse animation skeletons'
  );
  assert.ok(
    !loadingHtml.includes('Chế độ Chỉ Xem'),
    'Loading must not show premature forbidden alert'
  );
  console.log('  PASS: Loading state correctly rendered');

  // --- 3. State: EMPTY ---
  console.log('🧪 3. Testing UI State: EMPTY...');
  const emptyHtml = renderFlow({ initialLoading: false, initialState: null, initialError: null });
  assert.ok(
    emptyHtml.includes('Chưa Khởi Tạo Quy Trình Thiết Lập'),
    'Empty state must render setup initialization notice'
  );
  assert.ok(
    emptyHtml.includes('Khởi tạo thiết lập ban đầu'),
    'Empty state must render initial setup CTA button'
  );
  console.log('  PASS: Empty state correctly rendered');

  // --- 4. State: PARTIAL / IN-PROGRESS WITH BLOCKED DEPENDENCY ---
  console.log('🧪 4. Testing UI State: PARTIAL & BLOCKED DEPENDENCIES...');
  const partialHtml = renderFlow({
    initialLoading: false,
    initialState: mockInitialState,
    initialCanEdit: true,
  });
  assert.ok(partialHtml.includes('Tiến độ hoàn thành:'), 'Must show progress indicator');
  assert.ok(partialHtml.includes('role="progressbar"'), 'Must have accessible progressbar');
  assert.ok(partialHtml.includes('Đang Thực Hiện'), 'Step 1 must be marked Đang Thực Hiện');
  assert.ok(
    partialHtml.includes('Bị Khóa (Thiếu Tiền Đề)'),
    'Blocked steps must show warning badge'
  );
  assert.ok(
    partialHtml.includes(
      'Cần hoàn thành bước &quot;Hồ sơ Cửa hàng &amp; Pháp lý&quot; trước khi thực hiện bước này'
    ) ||
      partialHtml.includes(
        'Cần hoàn thành bước "Hồ sơ Cửa hàng & Pháp lý" trước khi thực hiện bước này'
      ),
    'Must display exact blocking prerequisite reason'
  );
  assert.ok(
    partialHtml.includes('Bắt buộc') && partialHtml.includes('Tùy chọn'),
    'Must badge required vs optional steps'
  );
  assert.ok(partialHtml.includes('Bỏ qua'), 'Must offer skip action for optional step');
  console.log('  PASS: Partial and dependency blocking states verified');

  // --- 5. State: INLINE WAREHOUSE FORM ---
  console.log('🧪 5. Testing UI State: INLINE WAREHOUSE FORM...');
  const whFormHtml = renderFlow({
    initialLoading: false,
    initialState: mockInitialState,
    initialCanEdit: true,
    initialWarehouseFormOpen: true,
  });
  assert.ok(whFormHtml.includes('id="wh-name"'), 'Must render warehouse name input');
  assert.ok(whFormHtml.includes('id="wh-phone"'), 'Must render warehouse phone input');
  assert.ok(whFormHtml.includes('id="wh-address"'), 'Must render warehouse address input');
  assert.ok(
    whFormHtml.includes('Lưu Kho &amp; Hoàn Thành Bước') ||
      whFormHtml.includes('Lưu Kho & Hoàn Thành Bước'),
    'Must render submit action'
  );
  console.log('  PASS: Inline warehouse form rendered with accessible fields');

  // --- 6. State: FORBIDDEN / VIEW-ONLY (Permissions from API) ---
  console.log('🧪 6. Testing UI State: FORBIDDEN / VIEW-ONLY (Server-Authoritative)...');
  const forbiddenHtml = renderFlow({
    initialLoading: false,
    initialState: { ...mockInitialState, can_edit: false },
    initialCanEdit: false,
  });
  assert.ok(
    forbiddenHtml.includes('Chế độ Chỉ Xem (View-Only)'),
    'Must render view-only callout banner'
  );
  assert.ok(
    forbiddenHtml.includes('iam:shop_config'),
    'Must state iam:shop_config capability requirement'
  );
  assert.ok(
    !forbiddenHtml.includes('Khởi tạo lại'),
    'Must not display Reset action for view-only user'
  );
  console.log('  PASS: Server-authoritative view-only mode verified without hardcoded roles');

  // --- 7. State: ERROR WITH RECOVERY ---
  console.log('🧪 7. Testing UI State: ERROR WITH RECOVERY...');
  const errorHtml = renderFlow({
    initialLoading: false,
    initialState: mockInitialState,
    initialError: 'Lỗi kết nối máy chủ khi thực hiện yêu cầu',
  });
  assert.ok(errorHtml.includes('role="alert"'), 'Must render role="alert"');
  assert.ok(errorHtml.includes('Lỗi kết nối máy chủ'), 'Must show error message');
  assert.ok(errorHtml.includes('Thử lại'), 'Must provide retry button for error recovery');
  console.log('  PASS: Error state with retry recovery verified');

  // --- 8. State: SUCCESS BANNER ---
  console.log('🧪 8. Testing UI State: SUCCESS BANNER...');
  const successHtml = renderFlow({
    initialLoading: false,
    initialState: mockInitialState,
    initialSuccess: 'Đã hoàn thành bước SHOP_PROFILE!',
  });
  assert.ok(successHtml.includes('role="status"'), 'Must render role="status"');
  assert.ok(successHtml.includes('Đã hoàn thành bước SHOP_PROFILE!'), 'Must show success message');
  console.log('  PASS: Success notification banner verified');

  // --- 9. State: OVERALL COMPLETED & CELEBRATION ---
  console.log('🧪 9. Testing UI State: OVERALL COMPLETED CELEBRATION...');
  const completedState: OnboardingStateResponseDto = {
    ...mockInitialState,
    status: OnboardingOverallStatus.COMPLETED,
    progress_percentage: 100,
    completed_count: 6,
    completed_required_steps: 4,
    completed_at: new Date().toISOString(),
    steps: mockInitialState.steps.map((s) => ({
      ...s,
      status: OnboardingStepStatus.COMPLETED,
      is_blocking: false,
      blocking_reasons: [],
      completed_at: new Date().toISOString(),
    })),
  };
  const completedHtml = renderFlow({
    initialLoading: false,
    initialState: completedState,
    initialCanEdit: true,
  });
  assert.ok(
    completedHtml.includes('Chúc Mừng! Cửa Hàng Đã Sẵn Sàng Vận Hành'),
    'Must render celebration banner when 100% completed'
  );
  assert.ok(
    completedHtml.includes('Tạo Đơn Ngay'),
    'Must offer primary action link to create order'
  );
  assert.ok(
    completedHtml.includes('Đóng Hướng Dẫn'),
    'Must offer dismiss action for completed flow'
  );
  console.log('  PASS: 100% completed celebration banner verified');

  // --- 10. State: RESET CONFIRMATION MODAL ---
  console.log('🧪 10. Testing UI State: RESET CONFIRMATION MODAL...');
  const resetModalHtml = renderFlow({
    initialLoading: false,
    initialState: mockInitialState,
    initialCanEdit: true,
    initialResetConfirmOpen: true,
  });
  assert.ok(resetModalHtml.includes('role="dialog"'), 'Must render dialog role');
  assert.ok(resetModalHtml.includes('aria-modal="true"'), 'Must have aria-modal="true"');
  assert.ok(
    resetModalHtml.includes('Khởi tạo lại Quy trình Thiết lập?'),
    'Must render modal title'
  );
  assert.ok(
    resetModalHtml.includes('Xác nhận Đặt lại') && resetModalHtml.includes('Hủy bỏ'),
    'Must render modal actions'
  );
  console.log('  PASS: Reset confirmation dialog verified');

  // --- 11. Full Page Integration Test ---
  console.log('🧪 11. Testing OnboardingPage Full Component...');
  const pageHtml = renderPage({
    initialState: mockInitialState,
    initialLoading: false,
    initialCanEdit: true,
  });
  assert.ok(
    pageHtml.includes('Thiết Lập Ban Đầu (SCR-ONB-01)'),
    'Must render page header & breadcrumb'
  );
  assert.ok(pageHtml.includes('Quay lại Bảng Điều Khiển'), 'Must provide navigation back link');
  console.log('  PASS: OnboardingPage integration verified');

  console.log('\n================================================================');
  console.log('🎉 ALL 11 FEAT-ONB-01 WEB UI STATE TESTS PASSED 100%!');
  console.log('================================================================\n');
}

void runOnboardingWebTestSuite();
