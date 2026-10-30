import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExportModal } from '@/components/ExportModal';
import ExportsSettingsPage from '@/app/settings/exports/page';
import {
  ExportResource,
  ExportFormat,
  ExportJobStatus,
  type ExportJobItem,
} from '@shipde/contracts';

async function runExportsWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB EXPORTS UI STATES TEST SUITE (FEAT-COM-05)');
  console.log('================================================================');

  // Test 1: Idle / Configuration Form State
  console.log('1. Testing Idle / Configuration Form State');
  const idleHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      defaultResource: ExportResource.WAREHOUSES,
      defaultFormat: ExportFormat.CSV,
    })
  );

  assert.strictEqual(
    idleHtml.includes('role="dialog"'),
    true,
    'Must render accessible dialog role'
  );
  assert.strictEqual(
    idleHtml.includes('aria-modal="true"'),
    true,
    'Must have aria-modal attribute'
  );
  assert.strictEqual(idleHtml.includes('Xuất Dữ Liệu Hệ Thống'), true, 'Must render modal title');
  assert.strictEqual(
    idleHtml.includes('Danh sách kho hàng (Warehouses)'),
    true,
    'Must include Warehouses option'
  );
  assert.strictEqual(
    idleHtml.includes('Danh sách nhân viên (Users / Staff)'),
    true,
    'Must include Users option'
  );
  assert.strictEqual(
    idleHtml.includes('Báo cáo 3 sổ đối soát (Ledgers)'),
    true,
    'Must include Ledgers option'
  );
  assert.strictEqual(
    idleHtml.includes('Nhật ký kiểm toán hệ thống (Audit Logs)'),
    true,
    'Must include Audit Logs option'
  );
  assert.strictEqual(idleHtml.includes('CSV (.csv)'), true, 'Must include CSV format button');
  assert.strictEqual(idleHtml.includes('Excel (.xlsx)'), true, 'Must include XLSX format button');
  assert.strictEqual(idleHtml.includes('PDF (.pdf)'), true, 'Must include PDF format button');
  assert.strictEqual(
    idleHtml.includes('Bắt Đầu Xuất Dữ Liệu'),
    true,
    'Must have primary submit action'
  );

  // Test 2: Loading State
  console.log('2. Testing Loading State (aria-busy, spinner)');
  const loadingHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'loading',
    })
  );

  assert.strictEqual(
    loadingHtml.includes('aria-busy="true"'),
    true,
    'Loading state must declare aria-busy="true"'
  );
  assert.strictEqual(
    loadingHtml.includes('Đang xử lý xuất dữ liệu...'),
    true,
    'Must display loading heading'
  );
  assert.strictEqual(
    loadingHtml.includes('animate-spin'),
    true,
    'Must render spinning loader icon'
  );

  // Test 3: Empty State (No records matched)
  console.log('3. Testing Empty State (0 records matched, recovery button)');
  const emptyHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'empty',
    })
  );

  assert.strictEqual(
    emptyHtml.includes('Không tìm thấy dữ liệu để xuất'),
    true,
    'Must inform user when no records match'
  );
  assert.strictEqual(
    emptyHtml.includes('Điều chỉnh bộ lọc'),
    true,
    'Must offer recovery action to adjust filters'
  );

  // Test 4: Validation Error State
  console.log('4. Testing Validation Error State (role="alert", aria-invalid)');
  const validationHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'validation_error',
      forcedErrorMessage: 'Khoảng thời gian không hợp lệ: Ngày bắt đầu phải trước ngày kết thúc.',
    })
  );

  assert.strictEqual(
    validationHtml.includes('role="alert"'),
    true,
    'Validation error must be announced with role="alert"'
  );
  assert.strictEqual(
    validationHtml.includes(
      'Khoảng thời gian không hợp lệ: Ngày bắt đầu phải trước ngày kết thúc.'
    ),
    true,
    'Must display specific validation error message'
  );
  assert.strictEqual(
    validationHtml.includes('aria-invalid="true"'),
    true,
    'Inputs must reflect aria-invalid="true"'
  );

  // Test 5: Forbidden State (RBAC / Scope rejection)
  console.log('5. Testing Forbidden State (403 without capability or out-of-scope)');
  const forbiddenHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'forbidden',
      forcedErrorMessage:
        'Tài khoản không có quyền thực hiện xuất dữ liệu cho tài nguyên users (yêu cầu quyền: iam:manage_users)',
    })
  );

  assert.strictEqual(
    forbiddenHtml.includes('Quyền truy cập bị từ chối'),
    true,
    'Must render forbidden header'
  );
  assert.strictEqual(
    forbiddenHtml.includes('iam:manage_users'),
    true,
    'Must communicate missing capability or scope boundary'
  );
  assert.strictEqual(
    forbiddenHtml.includes('Chọn tài nguyên khác'),
    true,
    'Must offer recovery path to pick permitted resource'
  );

  // Test 6: Partial / Clamped State
  console.log('6. Testing Partial / Clamped State (truncation note alert, download allowed)');
  const mockPartialJob: ExportJobItem = {
    id: 'export-partial-123',
    merchant_id: 'tenant-alpha',
    user_id: 'user-1',
    resource: ExportResource.WAREHOUSES,
    format: ExportFormat.CSV,
    status: ExportJobStatus.COMPLETED,
    total_rows: 5000,
    processed_rows: 5000,
    succeeded_rows: 5000,
    failed_rows: 0,
    file_name: 'warehouses_partial.csv',
    file_size_bytes: 124500,
    checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    metadata: {
      export_id: 'export-partial-123',
      generated_at: new Date().toISOString(),
      merchant_id: 'tenant-alpha',
      requested_by: 'user-1',
      user_role: 'ADMIN',
      resource: ExportResource.WAREHOUSES,
      format: ExportFormat.CSV,
      filters: { clamp: true },
      rule_version: '2026.09.08',
      total_rows: 5000,
      succeeded_rows: 5000,
      failed_rows: 0,
      checksum_sha256: 'mock-payload-checksum',
      truncation_note:
        'Kết quả xuất đã được giới hạn ở 5000 bản ghi đầu tiên do vượt quá số lượng tối đa cho phép',
    },
    created_at: new Date().toISOString(),
  };

  const partialHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'partial',
      forcedJob: mockPartialJob,
    })
  );

  assert.strictEqual(
    partialHtml.includes('role="alert"'),
    true,
    'Partial state must alert user of truncation'
  );
  assert.strictEqual(
    partialHtml.includes('Kết quả xuất đã được giới hạn ở 5000 bản ghi đầu tiên'),
    true,
    'Must display truncation note from metadata'
  );
  assert.strictEqual(
    partialHtml.includes('Tải Xuống Tệp Dữ Liệu'),
    true,
    'Must still allow downloading the truncated dataset'
  );
  assert.strictEqual(
    partialHtml.includes('/api/v1/exports/export-partial-123/download'),
    true,
    'Must link to direct download route'
  );

  // Test 7: Success State
  console.log('7. Testing Success State (metadata card, direct download action)');
  const mockSuccessJob: ExportJobItem = {
    id: 'export-success-456',
    merchant_id: 'tenant-alpha',
    user_id: 'user-1',
    resource: ExportResource.LEDGERS,
    format: ExportFormat.PDF,
    status: ExportJobStatus.COMPLETED,
    total_rows: 1500,
    processed_rows: 1500,
    succeeded_rows: 1500,
    failed_rows: 0,
    file_name: 'ledgers_reconciliation_2026.pdf',
    file_size_bytes: 245000,
    checksum_sha256: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    metadata: {
      export_id: 'export-success-456',
      generated_at: new Date().toISOString(),
      merchant_id: 'tenant-alpha',
      requested_by: 'user-1',
      user_role: 'OWNER',
      resource: ExportResource.LEDGERS,
      format: ExportFormat.PDF,
      filters: {},
      rule_version: '2026.09.08',
      total_rows: 1500,
      succeeded_rows: 1500,
      failed_rows: 0,
      checksum_sha256: 'payload-sha-456',
    },
    created_at: new Date().toISOString(),
  };

  const successHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'success',
      forcedJob: mockSuccessJob,
    })
  );

  assert.strictEqual(
    successHtml.includes('Tệp xuất dữ liệu đã sẵn sàng!'),
    true,
    'Must display success heading'
  );
  assert.strictEqual(
    successHtml.includes('1,500'),
    true,
    'Must format succeeded rows with locale formatting'
  );
  assert.strictEqual(
    successHtml.includes('ledgers_reconciliation_2026.pdf'),
    true,
    'Must display exported file name'
  );
  assert.strictEqual(
    successHtml.includes('a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0'),
    true,
    'Must display SHA-256 integrity checksum'
  );
  assert.strictEqual(
    successHtml.includes('/api/v1/exports/export-success-456/download'),
    true,
    'Must link to direct download route'
  );

  // Test 8: Error & Recovery State
  console.log('8. Testing Error State (server error with retry recovery action)');
  const errorHtml = renderToStaticMarkup(
    React.createElement(ExportModal, {
      isOpen: true,
      onClose: () => {},
      forcedState: 'error',
      forcedErrorMessage: 'Hệ thống đang quá tải, vui lòng thử lại sau giây lát.',
    })
  );

  assert.strictEqual(
    errorHtml.includes('Đã xảy ra lỗi khi xuất dữ liệu'),
    true,
    'Must display error title'
  );
  assert.strictEqual(
    errorHtml.includes('Hệ thống đang quá tải, vui lòng thử lại sau giây lát.'),
    true,
    'Must display error explanation'
  );
  assert.strictEqual(errorHtml.includes('Thử lại'), true, 'Must provide actionable retry button');

  // Test 9: Exports Settings Page Render
  console.log('9. Testing Exports Settings Page View');
  const pageHtml = renderToStaticMarkup(React.createElement(ExportsSettingsPage));

  assert.strictEqual(pageHtml.includes('Lịch Sử Xuất Dữ Liệu'), true, 'Must render page title');
  assert.strictEqual(
    pageHtml.includes('Xuất Dữ Liệu Mới'),
    true,
    'Must offer trigger to launch ExportModal'
  );
  assert.strictEqual(
    pageHtml.includes('Lọc theo tài nguyên:'),
    true,
    'Must provide resource filter toolbar'
  );

  console.log('🎉 All 9 Web Exports UI States tests passed successfully!');
}

runExportsWebTestSuite().catch((err) => {
  console.error('Web Exports UI States test suite failed:', err);
  process.exit(1);
});
