import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Warehouse, WarehouseFormState } from '@shipde/contracts';
import {
  validateWarehouseForm,
  isValidWarehouseCode,
  isValidWarehousePhone,
  isValidCutoffTime,
  ALLOWED_WAREHOUSE_PAPER_SIZES,
  ALLOWED_WAREHOUSE_DPIS,
} from '@shipde/contracts';
import { WarehouseManagementView } from '@/components/WarehouseManagementView';
import WarehousesSettingsPage from '@/app/settings/warehouses/page';
import { AuthProvider } from '@/context/AuthContext';

async function runWarehousesWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB WAREHOUSES UI STATES TEST SUITE (FEAT-WH-01)');
  console.log('================================================================');

  const mockWarehouseHcmDefault: Warehouse = {
    id: '22222222-aaaa-bbbb-cccc-000000000001',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Kho Tổng TP.HCM',
    code: 'WH-HCM-01',
    status: 'active',
    is_default: true,
    contact_name: 'Nguyễn Văn Kho',
    contact_phone: '0901234567',
    contact_email: 'kho.hcm@shipde.vn',
    address_line: '128 Nguyễn Trãi',
    ward: 'Phường 3',
    district: 'Quận 5',
    city: 'Hồ Chí Minh',
    postal_code: '700000',
    address_json: {},
    use_different_return_address: false,
    return_contact_name: null,
    return_contact_phone: null,
    return_address_line: null,
    return_ward: null,
    return_district: null,
    return_city: null,
    return_address_json: null,
    operating_hours: null,
    cutoff_time: '16:00',
    schedule_notes: 'Kho có cổng sau cho xe tải 2.5T vào bốc hàng',
    contacts_json: null,
    printer_paper_size: 'A6',
    printer_dpi: 203,
    printer_name: 'Xprinter XP-420B',
    printer_auto_print: true,
    printer_config: null,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const mockWarehouseHanoi: Warehouse = {
    id: '22222222-aaaa-bbbb-cccc-000000000002',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Kho Hà Nội - Cầu Giấy',
    code: 'WH-HN-02',
    status: 'active',
    is_default: false,
    contact_name: 'Trần Thị Hà',
    contact_phone: '0987654321',
    contact_email: 'kho.hn@shipde.vn',
    address_line: '88 Cầu Giấy',
    ward: 'Phường Dịch Vọng',
    district: 'Quận Cầu Giấy',
    city: 'Hà Nội',
    postal_code: '100000',
    address_json: {},
    use_different_return_address: true,
    return_contact_name: 'Bộ phận nhận hoàn HN',
    return_contact_phone: '0912345678',
    return_address_line: '100 Cầu Giấy (Kho phụ số 2)',
    return_ward: 'Phường Dịch Vọng',
    return_district: 'Quận Cầu Giấy',
    return_city: 'Hà Nội',
    return_address_json: null,
    operating_hours: null,
    cutoff_time: '17:30',
    schedule_notes: 'Bấm chuông kho 2 khi giao trả hàng',
    contacts_json: null,
    printer_paper_size: 'A5',
    printer_dpi: 300,
    printer_name: 'HPRT N41',
    printer_auto_print: false,
    printer_config: null,
    created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
  };

  const mockWarehouseDanangInactive: Warehouse = {
    id: '22222222-aaaa-bbbb-cccc-000000000003',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    name: 'Kho Đà Nẵng (Tạm ngưng)',
    code: 'WH-DN-03',
    status: 'inactive',
    is_default: false,
    contact_name: 'Lê Văn Miền Trung',
    contact_phone: '+84905111222',
    contact_email: null,
    address_line: '15 Lê Duẩn',
    ward: 'P. Hải Châu 1',
    district: 'Quận Hải Châu',
    city: 'Đà Nẵng',
    postal_code: '550000',
    address_json: {},
    use_different_return_address: false,
    return_contact_name: null,
    return_contact_phone: null,
    return_address_line: null,
    return_ward: null,
    return_district: null,
    return_city: null,
    return_address_json: null,
    operating_hours: null,
    cutoff_time: null,
    schedule_notes: null,
    contacts_json: null,
    printer_paper_size: 'A6',
    printer_dpi: 203,
    printer_name: null,
    printer_auto_print: false,
    printer_config: null,
    created_at: new Date('2026-01-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-03T00:00:00Z').toISOString(),
  };

  const allWarehouses = [mockWarehouseHcmDefault, mockWarehouseHanoi, mockWarehouseDanangInactive];

  // 1. Validation Logic Unit Tests
  console.log('🧪 1. Testing Validation Logic: validateWarehouseForm & regex helpers...');
  const validState: WarehouseFormState = {
    name: 'Kho Bình Thạnh',
    code: 'WH-BT-01',
    status: 'active',
    is_default: false,
    contact_name: 'Nguyễn Văn Thủ Kho',
    contact_phone: '0909888999',
    contact_email: 'kho@example.com',
    address_line: '45 Điện Biên Phủ',
    ward: 'Phường 15',
    district: 'Quận Bình Thạnh',
    city: 'Hồ Chí Minh',
    postal_code: '700000',
    use_different_return_address: false,
    return_contact_name: '',
    return_contact_phone: '',
    return_address_line: '',
    return_ward: '',
    return_district: '',
    return_city: '',
    cutoff_time: '16:00',
    schedule_notes: 'Lối vào hẻm rộng 8m',
    printer_paper_size: 'A6',
    printer_dpi: 203,
    printer_name: 'XP-420B',
    printer_auto_print: true,
  };

  const validRes = validateWarehouseForm(validState);
  assert.strictEqual(validRes.isValid, true);
  assert.strictEqual(Object.keys(validRes.errors).length, 0);

  // Validate Code helper
  assert.strictEqual(isValidWarehouseCode('WH-HCM-01'), true);
  assert.strictEqual(isValidWarehouseCode('WAREHOUSE_02'), true);
  assert.strictEqual(isValidWarehouseCode('W'), false); // Too short
  assert.strictEqual(isValidWarehouseCode('wh@01'), false); // Invalid character

  // Validate Phone helper
  assert.strictEqual(isValidWarehousePhone('0901234567'), true);
  assert.strictEqual(isValidWarehousePhone('+84901234567'), true);
  assert.strictEqual(isValidWarehousePhone('0381112222'), true);
  assert.strictEqual(isValidWarehousePhone('0123456789'), false); // Obsolete prefix
  assert.strictEqual(isValidWarehousePhone('abc'), false);

  // Validate Cutoff Time helper
  assert.strictEqual(isValidCutoffTime('16:00'), true);
  assert.strictEqual(isValidCutoffTime('00:00'), true);
  assert.strictEqual(isValidCutoffTime('23:59'), true);
  assert.strictEqual(isValidCutoffTime('24:00'), false);
  assert.strictEqual(isValidCutoffTime('16:60'), false);
  assert.strictEqual(isValidCutoffTime('abc'), false);

  // Invalid Name (< 2 chars)
  const invalidNameRes = validateWarehouseForm({ ...validState, name: 'A' });
  assert.strictEqual(invalidNameRes.isValid, false);
  assert.ok(invalidNameRes.errors.name);

  // Invalid Contact Phone
  const invalidPhoneRes = validateWarehouseForm({ ...validState, contact_phone: '012345' });
  assert.strictEqual(invalidPhoneRes.isValid, false);
  assert.ok(invalidPhoneRes.errors.contact_phone);

  // Invalid Address Line (< 3 chars)
  const invalidAddrRes = validateWarehouseForm({ ...validState, address_line: 'X' });
  assert.strictEqual(invalidAddrRes.isValid, false);
  assert.ok(invalidAddrRes.errors.address_line);

  // Invalid District & City (empty)
  const invalidDistCityRes = validateWarehouseForm({ ...validState, district: '', city: '' });
  assert.strictEqual(invalidDistCityRes.isValid, false);
  assert.ok(invalidDistCityRes.errors.district);
  assert.ok(invalidDistCityRes.errors.city);

  // When use_different_return_address is true, validate return fields
  const invalidReturnRes = validateWarehouseForm({
    ...validState,
    use_different_return_address: true,
    return_contact_name: '',
    return_contact_phone: 'bad_phone',
    return_address_line: '',
    return_district: '',
    return_city: '',
  });
  assert.strictEqual(invalidReturnRes.isValid, false);
  assert.ok(invalidReturnRes.errors.return_contact_name);
  assert.ok(invalidReturnRes.errors.return_contact_phone);
  assert.ok(invalidReturnRes.errors.return_address_line);
  assert.ok(invalidReturnRes.errors.return_district);
  assert.ok(invalidReturnRes.errors.return_city);

  console.log('  PASS: Warehouse validation logic verified.');

  // 2. Loading State Skeleton
  console.log('🧪 2. Testing UI State: Loading skeleton...');
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, { loading: true })
  );
  assert.ok(loadingMarkup.includes('data-testid="warehouse-loading-state"'));
  assert.ok(loadingMarkup.includes('Đang tải danh sách kho hàng...'));
  console.log('  PASS: Loading state skeleton verified.');

  // 3. Empty State
  console.log('🧪 3. Testing UI State: Empty state when no warehouses...');
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: [],
      loading: false,
      canEdit: true,
    })
  );
  assert.ok(emptyMarkup.includes('data-testid="warehouse-empty-state"'));
  assert.ok(emptyMarkup.includes('Chưa có kho hàng nào được thiết lập'));
  assert.ok(emptyMarkup.includes('data-testid="empty-create-warehouse-button"'));
  console.log('  PASS: Empty state verified.');

  // 4. View Mode / List Cards
  console.log('🧪 4. Testing UI State: View mode with list of warehouse cards...');
  const viewMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      loading: false,
      canEdit: true,
    })
  );
  assert.ok(viewMarkup.includes('data-testid="warehouse-list-state"'));
  assert.ok(viewMarkup.includes('Kho Tổng TP.HCM'));
  assert.ok(viewMarkup.includes('WH-HCM-01'));
  assert.ok(
    viewMarkup.includes(
      'data-testid="badge-default-warehouse-22222222-aaaa-bbbb-cccc-000000000001"'
    )
  );
  assert.ok(viewMarkup.includes('Kho mặc định'));
  assert.ok(viewMarkup.includes('Nguyễn Văn Kho'));
  assert.ok(viewMarkup.includes('0901234567'));
  assert.ok(viewMarkup.includes('128 Nguyễn Trãi'));
  assert.ok(viewMarkup.includes('16:00'));
  assert.ok(viewMarkup.includes('Xprinter XP-420B'));

  // Second warehouse with return address
  assert.ok(viewMarkup.includes('Kho Hà Nội - Cầu Giấy'));
  assert.ok(viewMarkup.includes('WH-HN-02'));
  assert.ok(viewMarkup.includes('Bộ phận nhận hoàn HN'));
  assert.ok(viewMarkup.includes('100 Cầu Giấy (Kho phụ số 2)'));

  // Action buttons
  assert.ok(
    viewMarkup.includes('data-testid="edit-warehouse-button-22222222-aaaa-bbbb-cccc-000000000001"')
  );
  assert.ok(
    viewMarkup.includes(
      'data-testid="set-default-warehouse-button-22222222-aaaa-bbbb-cccc-000000000002"'
    )
  );
  assert.ok(
    viewMarkup.includes(
      'data-testid="deactivate-warehouse-button-22222222-aaaa-bbbb-cccc-000000000001"'
    )
  );
  assert.ok(
    viewMarkup.includes(
      'data-testid="activate-warehouse-button-22222222-aaaa-bbbb-cccc-000000000003"'
    )
  );
  console.log('  PASS: View mode cards verified.');

  // 5. Create Modal / Form Open
  console.log('🧪 5. Testing UI State: Create modal dialog open...');
  const createModalMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      initialEditingWarehouse: null,
      canEdit: true,
    })
  );
  assert.ok(createModalMarkup.includes('data-testid="warehouse-modal"'));
  assert.ok(createModalMarkup.includes('Thêm mới kho hàng'));
  assert.ok(createModalMarkup.includes('data-testid="input-warehouse-name"'));
  assert.ok(createModalMarkup.includes('data-testid="input-warehouse-code"'));
  assert.ok(createModalMarkup.includes('data-testid="input-warehouse-contact-name"'));
  assert.ok(createModalMarkup.includes('data-testid="input-warehouse-contact-phone"'));
  assert.ok(createModalMarkup.includes('data-testid="input-warehouse-address-line"'));
  assert.ok(createModalMarkup.includes('data-testid="checkbox-warehouse-default"'));
  assert.ok(createModalMarkup.includes('data-testid="submit-warehouse-button"'));
  assert.ok(createModalMarkup.includes('Thêm kho hàng'));
  console.log('  PASS: Create modal dialog verified.');

  // 6. Edit Modal / Form Open with prefilled data
  console.log('🧪 6. Testing UI State: Edit modal dialog open...');
  const editModalMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      initialEditingWarehouse: mockWarehouseHcmDefault,
      canEdit: true,
    })
  );
  assert.ok(editModalMarkup.includes('data-testid="warehouse-modal"'));
  assert.ok(editModalMarkup.includes('Chỉnh sửa kho hàng'));
  assert.ok(editModalMarkup.includes('Kho Tổng TP.HCM'));
  assert.ok(editModalMarkup.includes('WH-HCM-01'));
  assert.ok(editModalMarkup.includes('Nguyễn Văn Kho'));
  assert.ok(editModalMarkup.includes('Lưu thay đổi'));
  console.log('  PASS: Edit modal dialog verified.');

  // 7. Modal Tabs: Return Address Tab
  console.log('🧪 7. Testing UI State: Modal Return Address tab...');
  const returnTabMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      initialActiveTab: 'return',
      initialFormState: {
        use_different_return_address: true,
        return_contact_name: 'Quản lý Hoàn Hàng',
        return_contact_phone: '0909999888',
        return_address_line: '99 Lê Duẩn',
      },
      canEdit: true,
    })
  );
  assert.ok(returnTabMarkup.includes('data-testid="checkbox-warehouse-different-return"'));
  assert.ok(returnTabMarkup.includes('data-testid="input-warehouse-return-contact-name"'));
  assert.ok(returnTabMarkup.includes('data-testid="input-warehouse-return-contact-phone"'));
  assert.ok(returnTabMarkup.includes('data-testid="input-warehouse-return-address-line"'));
  assert.ok(returnTabMarkup.includes('Quản lý Hoàn Hàng'));
  console.log('  PASS: Modal Return Address tab verified.');

  // 8. Modal Tabs: Schedule & Printer Tabs
  console.log('🧪 8. Testing UI State: Modal Schedule and Printer tabs...');
  const scheduleTabMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      initialActiveTab: 'schedule',
      initialFormState: {
        cutoff_time: '16:30',
        schedule_notes: 'Ghi chú tài xế',
      },
      canEdit: true,
    })
  );
  assert.ok(scheduleTabMarkup.includes('data-testid="input-warehouse-cutoff-time"'));
  assert.ok(scheduleTabMarkup.includes('data-testid="textarea-warehouse-schedule-notes"'));
  assert.ok(scheduleTabMarkup.includes('16:30'));

  const printerTabMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      initialActiveTab: 'printer',
      initialFormState: {
        printer_paper_size: 'A6',
        printer_dpi: 300,
        printer_name: 'Printer-X1',
        printer_auto_print: true,
      },
      canEdit: true,
    })
  );
  assert.ok(printerTabMarkup.includes('data-testid="select-warehouse-printer-paper-size"'));
  assert.ok(printerTabMarkup.includes('data-testid="select-warehouse-printer-dpi"'));
  assert.ok(printerTabMarkup.includes('data-testid="input-warehouse-printer-name"'));
  assert.ok(printerTabMarkup.includes('data-testid="checkbox-warehouse-printer-auto-print"'));
  console.log('  PASS: Modal Schedule & Printer tabs verified.');

  // 9. Inline Validation Errors Display
  console.log('🧪 9. Testing UI State: Inline validation errors display...');
  const validationMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      initialFormOpen: true,
      canEdit: true,
      initialValidationErrors: {
        name: 'Tên kho hàng là bắt buộc và phải có ít nhất 2 ký tự',
        code: 'Mã kho hàng phải từ 2 đến 64 ký tự',
        contact_phone: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
        address_line: 'Địa chỉ lấy hàng phải từ 3 đến 500 ký tự',
      },
    })
  );
  assert.ok(validationMarkup.includes('data-testid="error-warehouse-name"'));
  assert.ok(validationMarkup.includes('Tên kho hàng là bắt buộc và phải có ít nhất 2 ký tự'));
  assert.ok(validationMarkup.includes('data-testid="error-warehouse-code"'));
  assert.ok(validationMarkup.includes('Mã kho hàng phải từ 2 đến 64 ký tự'));
  assert.ok(validationMarkup.includes('data-testid="error-warehouse-contact-phone"'));
  assert.ok(validationMarkup.includes('Số điện thoại không hợp lệ theo định dạng Việt Nam'));
  assert.ok(validationMarkup.includes('data-testid="error-warehouse-address-line"'));
  assert.ok(validationMarkup.includes('Địa chỉ lấy hàng phải từ 3 đến 500 ký tự'));
  console.log('  PASS: Inline validation errors verified.');

  // 10. Server Error Banner with Recovery Retry
  console.log('🧪 10. Testing UI State: Server error banner with retry...');
  const serverErrorMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      error: 'Lỗi kết nối máy chủ quản lý kho hàng. Vui lòng thử lại.',
      onRefresh: () => {},
    })
  );
  assert.ok(serverErrorMarkup.includes('data-testid="warehouse-error-banner"'));
  assert.ok(serverErrorMarkup.includes('Lỗi kết nối máy chủ quản lý kho hàng'));
  assert.ok(serverErrorMarkup.includes('data-testid="retry-error-button"'));
  assert.ok(serverErrorMarkup.includes('data-testid="dismiss-error-button"'));
  console.log('  PASS: Server error banner with retry verified.');

  // 11. Forbidden State (View-Only / Unauthorized Role)
  console.log('🧪 11. Testing UI State: Forbidden banner for unauthorized roles...');
  const forbiddenMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      canEdit: false,
    })
  );
  assert.ok(forbiddenMarkup.includes('data-testid="warehouse-forbidden-banner"'));
  assert.ok(forbiddenMarkup.includes('Giới hạn quyền cấu hình kho hàng'));
  // Mutation buttons must NOT exist
  assert.ok(!forbiddenMarkup.includes('data-testid="create-warehouse-button"'));
  assert.ok(
    !forbiddenMarkup.includes(
      'data-testid="edit-warehouse-button-22222222-aaaa-bbbb-cccc-000000000001"'
    )
  );
  assert.ok(
    !forbiddenMarkup.includes(
      'data-testid="set-default-warehouse-button-22222222-aaaa-bbbb-cccc-000000000002"'
    )
  );
  console.log('  PASS: Forbidden state verified.');

  // 12. Scoped Access (Partial view / restricted warehouse_scopes)
  console.log('🧪 12. Testing UI State: Scoped access banner...');
  const scopedMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: [mockWarehouseHcmDefault],
      scopedWarehouses: ['WH-HCM-01'],
      canEdit: true,
    })
  );
  assert.ok(scopedMarkup.includes('data-testid="warehouse-scoped-banner"'));
  assert.ok(scopedMarkup.includes('Phạm vi kho hàng theo phân quyền'));
  assert.ok(scopedMarkup.includes('WH-HCM-01'));
  console.log('  PASS: Scoped access banner verified.');

  // 13. Success Notification Banner
  console.log('🧪 13. Testing UI State: Success notification banner...');
  const successMarkup = renderToStaticMarkup(
    React.createElement(WarehouseManagementView, {
      warehouses: allWarehouses,
      success: 'Đã thêm mới kho hàng Kho Bình Thạnh thành công',
    })
  );
  assert.ok(successMarkup.includes('data-testid="warehouse-success-banner"'));
  assert.ok(successMarkup.includes('Đã thêm mới kho hàng Kho Bình Thạnh thành công'));
  console.log('  PASS: Success notification banner verified.');

  // 14. Full Page Container: WarehousesSettingsPage
  console.log('🧪 14. Testing Full Page Container: WarehousesSettingsPage...');
  const pageMarkup = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(WarehousesSettingsPage, {
        initialWarehouses: allWarehouses,
        initialLoading: false,
        initialCanEdit: true,
      })
    )
  );
  assert.ok(pageMarkup.includes('Chi nhánh &amp; Kho hàng (SCR-WH-01 / FEAT-WH-01)'));
  assert.ok(pageMarkup.includes('Quay lại Bảng Điều Khiển'));
  assert.ok(pageMarkup.includes('Hồ sơ Shop'));
  assert.ok(pageMarkup.includes('Nhân sự'));
  assert.ok(pageMarkup.includes('Phân quyền'));
  assert.ok(pageMarkup.includes('Kho Tổng TP.HCM'));
  assert.ok(pageMarkup.includes('WH-HCM-01'));
  console.log('  PASS: WarehousesSettingsPage full container verified.');

  console.log('================================================================');
  console.log('🎉 ALL WEB WAREHOUSES UI STATES VERIFIED 100%!');
  console.log('================================================================');
}

runWarehousesWebTestSuite().catch((err) => {
  console.error('❌ Warehouses web test suite failed:', err);
  process.exit(1);
});
