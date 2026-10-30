import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportSummary, ImportRow } from '@shipde/contracts';
import { ImportStatus, ImportRowStatus, ImportIssueSeverity } from '@shipde/contracts';
import { ImportManagementView } from '@/components/ImportManagementView';
import ImportsSettingsPage from '@/app/settings/imports/page';
import { AuthProvider } from '@/context/AuthContext';

async function runImportsWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB IMPORTS UI STATES TEST SUITE (FEAT-COM-04 / SCR-IMPORT-01)');
  console.log('================================================================');

  const mockImportStaged: ImportSummary = {
    id: '11111111-aaaa-bbbb-cccc-000000000001',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    template_type: 'branches',
    file_name: 'branches_upload.csv',
    file_size: 2048,
    file_hash: 'abc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890',
    status: ImportStatus.STAGED,
    revision: 1,
    total_rows: 10,
    valid_rows: 10,
    error_rows: 0,
    warning_rows: 0,
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const mockImportBlocked: ImportSummary = {
    id: '11111111-aaaa-bbbb-cccc-000000000002',
    merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
    template_type: 'warehouses',
    file_name: 'warehouses_invalid.csv',
    file_size: 4096,
    file_hash: 'def4567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    status: ImportStatus.BLOCKED,
    revision: 2,
    total_rows: 5,
    valid_rows: 3,
    error_rows: 2,
    warning_rows: 1,
    created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
  };

  const mockImportRows: ImportRow[] = [
    {
      id: 'row-01',
      import_id: mockImportBlocked.id,
      row_number: 1,
      raw_data: { code: 'WH-01', name: 'Kho Hà Nội' },
      status: ImportRowStatus.VALID,
      scope_identifier: 'WH-01',
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    },
    {
      id: 'row-02',
      import_id: mockImportBlocked.id,
      row_number: 2,
      raw_data: { code: '', name: 'Kho Thiếu Mã' },
      status: ImportRowStatus.ERROR,
      scope_identifier: null,
      issues_json: [
        {
          code: 'MISSING_SCOPE_IDENTIFIER',
          field: 'code',
          severity: ImportIssueSeverity.BLOCKING,
          message: 'Mã định danh kho hàng là bắt buộc',
        },
      ],
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    },
    {
      id: 'row-03',
      import_id: mockImportBlocked.id,
      row_number: 3,
      raw_data: { code: 'WH-03', name: 'Kho Thiếu SĐT' },
      status: ImportRowStatus.WARNING,
      scope_identifier: 'WH-03',
      issues_json: [
        {
          code: 'DATA_INCOMPLETE',
          field: 'contact_phone',
          severity: ImportIssueSeverity.WARNING,
          message: 'Chưa có số điện thoại liên hệ',
        },
      ],
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    },
  ];

  // -------------------------------------------------------------------------
  // TEST 1: Loading state
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: true,
        imports: [],
      })
    );
    assert.ok(html.includes('data-testid="import-loading-state"'), 'Must render loading indicator');
    assert.ok(html.includes('Đang tải lịch sử nhập liệu'), 'Must show loading text');
    console.log('PASS: TEST 1 - Loading state rendered properly');
  }

  // -------------------------------------------------------------------------
  // TEST 2: Empty state
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [],
        canEdit: true,
      })
    );
    assert.ok(html.includes('data-testid="import-empty-state"'), 'Must render empty state');
    assert.ok(html.includes('Chưa có lượt nhập nào'), 'Must show empty description');
    console.log('PASS: TEST 2 - Empty state rendered properly');
  }

  // -------------------------------------------------------------------------
  // TEST 3: Forbidden state for non-editor
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportStaged],
        canEdit: false,
      })
    );
    assert.ok(
      html.includes('data-testid="import-forbidden-banner"'),
      'Must render forbidden banner'
    );
    assert.ok(html.includes('iam:shop_config'), 'Must mention permission, not hardcoded roles');
    console.log('PASS: TEST 3 - Forbidden banner rendered without hardcoded roles');
  }

  // -------------------------------------------------------------------------
  // TEST 4: Error state with message
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [],
        error: 'Lỗi kết nối máy chủ dữ liệu nhập',
      })
    );
    assert.ok(html.includes('data-testid="import-error-banner"'), 'Must render error banner');
    assert.ok(html.includes('Lỗi kết nối máy chủ dữ liệu nhập'), 'Must display error message');
    console.log('PASS: TEST 4 - Error banner rendered with message');
  }

  // -------------------------------------------------------------------------
  // TEST 5: Success state
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportStaged],
        success: 'Dữ liệu đã được áp dụng thành công',
      })
    );
    assert.ok(html.includes('data-testid="import-success-banner"'), 'Must render success banner');
    assert.ok(html.includes('Dữ liệu đã được áp dụng thành công'), 'Must display success message');
    console.log('PASS: TEST 5 - Success banner rendered');
  }

  // -------------------------------------------------------------------------
  // TEST 6: Selected import detail with Control Totals & Rows breakdown
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportBlocked],
        selectedImport: mockImportBlocked,
        selectedImportRows: mockImportRows,
        canEdit: true,
        onExportIssues: () => {},
      })
    );
    assert.ok(html.includes('data-testid="import-detail-panel"'), 'Must render detail panel');
    assert.ok(html.includes('warehouses_invalid.csv'), 'Must display file name');
    assert.ok(html.includes('BLOCKED'), 'Must show BLOCKED status');
    assert.ok(html.includes('MISSING_SCOPE_IDENTIFIER'), 'Must show row issue code');
    assert.ok(html.includes('Mã định danh kho hàng là bắt buộc'), 'Must show issue message');
    assert.ok(html.includes('DATA_INCOMPLETE'), 'Must show warning issue code');
    assert.ok(html.includes('Tải báo cáo lỗi'), 'Must offer issues export button');
    console.log('PASS: TEST 6 - Detail panel with control totals and row issues rendered');
  }

  // -------------------------------------------------------------------------
  // TEST 7: Page render with settings wrapper
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(ImportsSettingsPage, {
          initialImports: [mockImportStaged],
          initialCanEdit: true,
          initialLoading: false,
        })
      )
    );
    assert.ok(html.includes('Nhập Dữ Liệu Hệ Thống'), 'Page header must render');
    assert.ok(html.includes('Quay lại Bảng điều khiển'), 'Breadcrumbs must render');
    console.log('PASS: TEST 7 - ImportsSettingsPage rendered properly');
  }

  console.log('================================================================');
  console.log('ALL WEB IMPORTS UI STATES TESTS PASSED (100%)');
  console.log('================================================================');
}

runImportsWebTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
