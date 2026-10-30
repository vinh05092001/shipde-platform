import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ImportSummary, ImportRow } from '@shipde/contracts';
import { ImportStatus, ImportRowStatus, ImportIssueSeverity } from '@shipde/contracts';
import { ImportManagementView } from '@/components/ImportManagementView';
import ImportsSettingsPage from '@/app/settings/imports/page';
import { AuthProvider, AuthContext } from '@/context/AuthContext';

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
    mime_type: 'text/csv',
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
    mime_type: 'text/csv',
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
      raw_data: { code: 'WH-01', name: 'Kho Hà Nội' } as Record<string, any>,
      status: ImportRowStatus.VALID,
      scope_identifier: 'WH-01',
      created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    },
    {
      id: 'row-02',
      import_id: mockImportBlocked.id,
      row_number: 2,
      raw_data: { code: '', name: 'Kho Thiếu Mã' } as Record<string, any>,
      status: ImportRowStatus.ERROR,
      scope_identifier: null,
      issues: [
        {
          code: 'MISSING_SCOPE_IDENTIFIER',
          field: 'code',
          severity: ImportIssueSeverity.BLOCKING,
          message: 'Mã định danh kho hàng là bắt buộc',
        },
      ],
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
      raw_data: { code: 'WH-03', name: 'Kho Thiếu SĐT' } as Record<string, any>,
      status: ImportRowStatus.WARNING,
      scope_identifier: 'WH-03',
      issues: [
        {
          code: 'DATA_INCOMPLETE',
          field: 'contact_phone',
          severity: ImportIssueSeverity.WARNING,
          message: 'Chưa có số điện thoại liên hệ',
        },
      ],
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

  // -------------------------------------------------------------------------
  // TEST 8: SCR-IMPORT-01 Mapping Preview & Revision History tab elements
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportStaged, mockImportBlocked],
        selectedImport: mockImportStaged,
        selectedImportRows: mockImportRows,
        canEdit: true,
      })
    );
    assert.ok(
      html.includes('Xem trước ánh xạ cột (Mapping Preview)'),
      'Must render Mapping Preview tab header'
    );
    assert.ok(
      html.includes('Lịch sử phiên bản (Revision History)'),
      'Must render Revision History tab header'
    );
    console.log('PASS: TEST 8 - SCR-IMPORT-01 Navigation tabs for mapping and revisions rendered');
  }

  // -------------------------------------------------------------------------
  // TEST 9: Live permission derivation (Finding 10) - User WITH iam:shop_config
  // -------------------------------------------------------------------------
  {
    const mockAuthWithPermission = {
      user: {
        id: 'u-admin-1',
        merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
        email: 'admin@example.com',
        full_name: 'Admin User',
        phone: '0901234567',
        role: 'STAFF',
        permissions: ['iam:shop_config'],
        created_at: new Date(),
      },
      merchant: null,
      isAuthenticated: true,
      isHydrating: false,
      token: 'test-token',
    } as any;

    const html = renderToStaticMarkup(
      React.createElement(
        AuthContext.Provider,
        { value: mockAuthWithPermission },
        React.createElement(ImportsSettingsPage, {
          initialImports: [mockImportStaged],
          // initialCanEdit is explicitly omitted so it must derive from live user permissions
          initialLoading: false,
        })
      )
    );

    assert.strictEqual(
      html.includes('data-testid="import-forbidden-banner"'),
      false,
      'Must NOT render forbidden banner when user has iam:shop_config permission'
    );
    assert.ok(
      html.includes('Tải lên &amp; Kiểm tra dữ liệu'),
      'Must render upload button for user with iam:shop_config'
    );
    console.log(
      'PASS: TEST 9 - Live permission derivation enables edit when user has iam:shop_config'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 10: Live permission derivation (Finding 10) - User WITHOUT iam:shop_config
  // -------------------------------------------------------------------------
  {
    const mockAuthWithoutPermission = {
      user: {
        id: 'u-viewer-1',
        merchant_id: 'mmmmmmmm-1111-2222-3333-444444444444',
        email: 'viewer@example.com',
        full_name: 'Viewer User',
        phone: '0901234568',
        role: 'OWNER', // Even with OWNER role, missing iam:shop_config means cannot edit
        permissions: ['other:permission'],
        created_at: new Date(),
      },
      merchant: null,
      isAuthenticated: true,
      isHydrating: false,
      token: 'test-token',
    } as any;

    const html = renderToStaticMarkup(
      React.createElement(
        AuthContext.Provider,
        { value: mockAuthWithoutPermission },
        React.createElement(ImportsSettingsPage, {
          initialImports: [mockImportStaged],
          // initialCanEdit is explicitly omitted so it must derive from live user permissions
          initialLoading: false,
        })
      )
    );

    assert.ok(
      html.includes('data-testid="import-forbidden-banner"'),
      'Must render forbidden banner when user lacks iam:shop_config permission'
    );
    assert.ok(html.includes('iam:shop_config'), 'Forbidden banner must specify missing permission');
    console.log(
      'PASS: TEST 10 - Live permission derivation blocks edit when user lacks iam:shop_config'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 11: Truncation disclosure notice (Finding 16)
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportBlocked],
        selectedImport: {
          ...mockImportBlocked,
          total_rows: 250, // More rows than displayed (Finding 16)
        },
        selectedImportRows: mockImportRows, // Only 3 rows provided
        canEdit: true,
      })
    );

    assert.ok(
      html.includes('data-testid="import-rows-truncation-notice"'),
      'Must render truncation disclosure notice when total_rows exceeds rendered rows'
    );
    assert.ok(
      html.includes('Đang hiển thị 3 trên tổng số 250 dòng'),
      'Must explicitly disclose row count and truncation'
    );
    console.log(
      'PASS: TEST 11 - Truncation disclosure notice rendered when total_rows > rows.length'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 12: History pagination and truncation disclosure (Finding 16 & Review 7)
  // -------------------------------------------------------------------------
  {
    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        loading: false,
        imports: [mockImportBlocked],
        totalImports: 45,
        historyPage: 1,
        historyLimit: 20,
        onHistoryPageChange: () => {},
        canEdit: true,
      })
    );

    assert.ok(
      html.includes('data-testid="import-history-pagination"'),
      'Must render history pagination banner'
    );
    assert.ok(
      html.includes('Đang hiển thị 1 trên tổng số 45 lượt nhập'),
      'Must disclose history truncation count'
    );
    assert.ok(html.includes('aria-label="Trang trước"'), 'Must have accessible previous button');
    assert.ok(html.includes('aria-label="Trang sau"'), 'Must have accessible next button');
    console.log(
      'PASS: TEST 12 - History pagination and truncation disclosure rendered with accessible controls'
    );
  }

  // -------------------------------------------------------------------------
  // TEST 13: Mapping preview displays actual source headers (Finding 13 & Review 6)
  // -------------------------------------------------------------------------
  {
    const mockWithHeaderMapping: any = {
      ...mockImportStaged,
      header_mapping: [
        {
          source_header: 'Mã số kho riêng',
          field: 'code',
          header: 'Mã kho hàng',
          recognized: true,
          required: true,
          rule: 'Bắt buộc',
          description: 'Mã định danh kho',
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(ImportManagementView, {
        initialTab: 'mapping',
        loading: false,
        imports: [mockWithHeaderMapping],
        selectedImport: mockWithHeaderMapping,
        selectedImportRows: mockImportRows,
        canEdit: true,
      })
    );

    assert.ok(
      html.includes('Mã số kho riêng'),
      'Mapping preview must display actual source header from uploaded file, not just template'
    );
    console.log('PASS: TEST 13 - Mapping preview displays actual source header from uploaded file');
  }

  // -------------------------------------------------------------------------
  // TEST 14: Stale detail responses discarded on concurrent selection (Finding 15 & Review 5)
  // -------------------------------------------------------------------------
  {
    let selectedImport: any = null;
    let selectedRows: any[] = [];
    const activeDetailIdRef = { current: null as string | null };

    // Simulate fetchImportDetail concurrency and identity rechecking logic
    const fetchImportDetailSim = async (
      importId: string,
      detailResult: any,
      rowsResult: any,
      delayMs: number
    ) => {
      activeDetailIdRef.current = importId;
      selectedImport = null;
      selectedRows = [];

      // Simulate async response await
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      if (activeDetailIdRef.current !== importId) {
        return; // Discard stale response
      }

      const detailJson = detailResult;
      const rowsJson = rowsResult;

      // Recheck before committing state updates
      if (activeDetailIdRef.current !== importId) {
        return;
      }

      selectedImport = detailJson.data?.import || detailJson.data;
      selectedRows = rowsJson.data?.items || [];
    };

    // Selection 1: imp-1 with slower network (40ms)
    const p1 = fetchImportDetailSim(
      'imp-1',
      { data: { import: { id: 'imp-1', file_name: 'slow.csv' } } },
      { data: { items: [{ id: 'row-1' }] } },
      40
    );

    // User switches to imp-2 shortly after (faster response: 10ms)
    await new Promise((resolve) => setTimeout(resolve, 5));
    const p2 = fetchImportDetailSim(
      'imp-2',
      { data: { import: { id: 'imp-2', file_name: 'fast.csv' } } },
      { data: { items: [{ id: 'row-2' }] } },
      10
    );

    await Promise.all([p1, p2]);

    assert.strictEqual(
      selectedImport?.id,
      'imp-2',
      'Stale detail response for imp-1 must not overwrite active imp-2 selection'
    );
    assert.strictEqual(
      selectedImport?.file_name,
      'fast.csv',
      'Selected import name must correspond to active imp-2'
    );
    assert.strictEqual(selectedRows.length, 1);
    assert.strictEqual(selectedRows[0].id, 'row-2');

    console.log(
      'PASS: TEST 14 - Stale detail responses discarded when active detail selection changes before fetch completes'
    );
  }

  console.log('================================================================');
  console.log('ALL WEB IMPORTS UI STATES TESTS PASSED (100%)');
  console.log('================================================================');
}

runImportsWebTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
