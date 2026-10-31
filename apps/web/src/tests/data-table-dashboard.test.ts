/**
 * Unit Test Suite for Reusable Server-Driven Data Table & Dashboard Shell.
 *
 * Verifies:
 * - DataTable rendering across Normal, Loading, Empty, and Error states
 * - Column sorting controls and ARIA sort attributes
 * - Pagination controls, page size selector, and record range calculation
 * - Toolbar, search input, and faceted filter controls
 * - DashboardLayout, DashboardSidebar, DashboardHeader, and PageHeader
 * - Keyboard accessibility (roles, aria-label, aria-sort, aria-busy)
 * - URL search params query helpers (parseSortParam, formatSortParam)
 * - Fixture isolation
 */

import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  ColumnDef,
  parseSortParam,
  formatSortParam,
} from '../components/data-table';
import {
  DashboardHeader,
  DashboardLayout,
  DashboardSidebar,
  PageHeader,
  Heading,
  DEFAULT_NAV_SECTIONS,
} from '../components/dashboard';
import { FIXTURE_SHIPMENTS, FixtureShipment } from '../app/storybook/page';

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 SHIP DỄ — DATA TABLE & DASHBOARD SHELL UNIT TEST SUITE');
  console.log('================================================================\n');

  // Test Columns Definition
  const testColumns: ColumnDef<FixtureShipment>[] = [
    {
      id: 'trackingCode',
      header: 'Mã vận đơn',
      cell: ({ row }) =>
        React.createElement<any>('span', { className: 'font-mono' }, row.trackingCode),
      enableSorting: true,
    },
    {
      id: 'carrier',
      header: 'Hãng vận chuyển',
      accessorKey: 'carrier',
    },
    {
      id: 'recipientName',
      header: 'Người nhận',
      accessorKey: 'recipientName',
    },
    {
      id: 'status',
      header: 'Trạng thái',
      cell: ({ row }) => React.createElement<any>('span', { className: 'status' }, row.status),
    },
    {
      id: 'codAmount',
      header: 'Tiền COD',
      align: 'right',
      cell: ({ row }) =>
        React.createElement<any>(
          'span',
          { className: 'tabular-nums' },
          `${row.codAmount.toLocaleString('vi-VN')} đ`
        ),
      enableSorting: true,
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. DATA TABLE — NORMAL LOADED STATE
  // ---------------------------------------------------------------------------
  console.log('🧪 1. Testing DataTable: Normal Loaded State...');
  const normalHtml = renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: FIXTURE_SHIPMENTS.slice(0, 3),
      columns: testColumns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: false,
    })
  );

  assert.ok(normalHtml.includes('role="table"'), 'Table must have semantic role="table"');
  assert.ok(normalHtml.includes('GHN982341201VN'), 'Must render first shipment tracking code');
  assert.ok(normalHtml.includes('Nguyễn Văn An'), 'Must render first recipient name');
  assert.ok(normalHtml.includes('350.000 đ'), 'Must render formatted COD amount with VND format');
  assert.ok(
    normalHtml.includes('text-right'),
    'Must apply text-right alignment for numeric COD column'
  );
  console.log(
    '   ✅ Normal loaded state verified with correct data, currency formatting, and alignment'
  );

  // ---------------------------------------------------------------------------
  // 2. DATA TABLE — LOADING SKELETON STATE
  // ---------------------------------------------------------------------------
  console.log('🧪 2. Testing DataTable: Loading Skeleton State...');
  const loadingHtml = renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: [],
      columns: testColumns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: true,
    })
  );

  assert.ok(
    loadingHtml.includes('aria-busy="true"'),
    'Tbody must indicate aria-busy="true" when loading'
  );
  assert.ok(loadingHtml.includes('animate-pulse'), 'Skeleton rows must include pulse animation');
  assert.ok(
    !loadingHtml.includes('GHN982341201VN'),
    'Must not render real data rows during loading'
  );
  console.log(
    '   ✅ Loading skeleton state verified with aria-busy="true" and animated placeholders'
  );

  // ---------------------------------------------------------------------------
  // 3. DATA TABLE — EMPTY STATE
  // ---------------------------------------------------------------------------
  console.log('🧪 3. Testing DataTable: Empty State...');
  const emptyHtml = renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: [],
      columns: testColumns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: false,
      emptyTitle: 'Không có bản ghi nào',
      emptyDescription: 'Vui lòng nạp đơn hàng từ hệ thống POS hoặc kiểm tra lại bộ lọc.',
      emptyActionLabel: 'Làm mới dữ liệu',
      onEmptyAction: () => {},
    })
  );

  assert.ok(emptyHtml.includes('Không có bản ghi nào'), 'Must display empty state title');
  assert.ok(
    emptyHtml.includes('Vui lòng nạp đơn hàng từ hệ thống POS'),
    'Must display actionable explanation in empty state'
  );
  assert.ok(emptyHtml.includes('Làm mới dữ liệu'), 'Must render empty state action button');
  console.log(
    '   ✅ Empty state verified with clear Vietnamese copy and actionable recovery button'
  );

  // ---------------------------------------------------------------------------
  // 4. DATA TABLE — ERROR STATE & RETRY ACTION
  // ---------------------------------------------------------------------------
  console.log('🧪 4. Testing DataTable: Error State with Retry Button...');
  const errorHtml = renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: [],
      columns: testColumns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: false,
      error: 'Lỗi kết nối máy chủ quản trị vận chuyển (502 Bad Gateway)',
      onRetry: () => {},
    })
  );

  assert.ok(errorHtml.includes('role="alert"'), 'Error banner must have role="alert"');
  assert.ok(
    errorHtml.includes('aria-live="assertive"'),
    'Error banner must have aria-live="assertive"'
  );
  assert.ok(
    errorHtml.includes('Lỗi kết nối máy chủ quản trị vận chuyển (502 Bad Gateway)'),
    'Must display exact error message'
  );
  assert.ok(errorHtml.includes('Thử lại'), 'Must render retry button in Vietnamese');
  console.log('   ✅ Error state verified with role="alert", error explanation, and retry button');

  // ---------------------------------------------------------------------------
  // 5. DATA TABLE — COLUMN HEADER & SORTING
  // ---------------------------------------------------------------------------
  console.log('🧪 5. Testing DataTableColumnHeader: Sort Controls & ARIA Attributes...');
  // Ascending sort
  const headerAscHtml = renderToStaticMarkup(
    React.createElement<any>(DataTableColumnHeader, {
      column: testColumns[0],
      title: 'Mã vận đơn',
      sort: { id: 'trackingCode', desc: false },
      onSort: () => {},
    })
  );
  assert.ok(
    headerAscHtml.includes('Sắp xếp theo Mã vận đơn: hiện tại tăng dần'),
    'Button must have descriptive aria-label indicating ascending sort'
  );
  assert.ok(
    headerAscHtml.includes('text-[var(--primary)]'),
    'Must highlight active sort direction'
  );

  // Descending sort
  const headerDescHtml = renderToStaticMarkup(
    React.createElement<any>(DataTableColumnHeader, {
      column: testColumns[0],
      title: 'Mã vận đơn',
      sort: { id: 'trackingCode', desc: true },
      onSort: () => {},
    })
  );
  assert.ok(
    headerDescHtml.includes('Sắp xếp theo Mã vận đơn: hiện tại giảm dần'),
    'Button must have descriptive aria-label indicating descending sort'
  );

  // Unsorted
  const headerUnsortedHtml = renderToStaticMarkup(
    React.createElement<any>(DataTableColumnHeader, {
      column: testColumns[0],
      title: 'Mã vận đơn',
      sort: null,
      onSort: () => {},
    })
  );
  assert.ok(
    headerUnsortedHtml.includes('Sắp xếp theo Mã vận đơn: hiện tại chưa sắp xếp'),
    'Button must have descriptive aria-label when unsorted'
  );
  console.log(
    '   ✅ Column header sorting verified with ascending, descending, and unsorted states'
  );

  // ---------------------------------------------------------------------------
  // 6. DATA TABLE — PAGINATION CONTROLS
  // ---------------------------------------------------------------------------
  console.log('🧪 6. Testing DataTablePagination: Page Size, Range, and Navigation...');
  const paginationHtml = renderToStaticMarkup(
    React.createElement<any>(DataTablePagination, {
      pageIndex: 2,
      pageSize: 10,
      pageCount: 5,
      totalCount: 48,
      pageSizeOptions: [10, 20, 50],
      onPageChange: () => {},
      onPageSizeChange: () => {},
      selectedCount: 3,
    })
  );

  assert.ok(
    paginationHtml.includes('Số dòng mỗi trang:'),
    'Must render page size label in Vietnamese'
  );
  assert.ok(paginationHtml.includes('Đã chọn'), 'Must render selected rows counter');
  assert.ok(paginationHtml.includes('3'), 'Must indicate 3 selected rows');
  assert.ok(paginationHtml.includes('48'), 'Must indicate 48 total records');
  assert.ok(
    paginationHtml.includes('Trang <span class="font-semibold">2</span> / <span>5</span>'),
    'Must show current page 2/5'
  );
  assert.ok(paginationHtml.includes('title="Trang đầu"'), 'Must have accessible first page button');
  assert.ok(paginationHtml.includes('title="Trang sau"'), 'Must have accessible next page button');
  console.log(
    '   ✅ Pagination verified with record range, page size options, and navigation buttons'
  );

  // ---------------------------------------------------------------------------
  // 7. DATA TABLE — TOOLBAR, FACETED FILTER & VIEW OPTIONS
  // ---------------------------------------------------------------------------
  console.log('🧪 7. Testing DataTableToolbar & Faceted Filter Controls...');
  const toolbarHtml = renderToStaticMarkup(
    React.createElement<any>(DataTableToolbar, {
      searchValue: 'ORD-2026',
      onSearchChange: () => {},
      searchPlaceholder: 'Tìm kiếm vận đơn...',
      isFiltered: true,
      onResetFilters: () => {},
      filtersSlot: React.createElement<any>(DataTableFacetedFilter, {
        title: 'Trạng thái',
        options: [
          { label: 'Chờ lấy hàng', value: 'PENDING', count: 5 },
          { label: 'Giao thành công', value: 'DELIVERED', count: 12 },
        ],
        selectedValues: new Set(['DELIVERED']),
        onSelect: () => {},
      }),
      viewOptionsSlot: React.createElement<any>(DataTableViewOptions, {
        columns: testColumns,
        hiddenColumns: new Set(['recipientName']),
        onToggleColumn: () => {},
      }),
    })
  );

  assert.ok(
    toolbarHtml.includes('placeholder="Tìm kiếm vận đơn..."'),
    'Must render search input with placeholder'
  );
  assert.ok(toolbarHtml.includes('value="ORD-2026"'), 'Must render current search value');
  assert.ok(
    toolbarHtml.includes('Đặt lại bộ lọc'),
    'Must display Reset filters button when isFiltered is true'
  );
  assert.ok(toolbarHtml.includes('Trạng thái'), 'Must display faceted filter title');
  assert.ok(toolbarHtml.includes('Cột hiển thị'), 'Must display column view options button');
  console.log('   ✅ Toolbar, faceted filters, and view options verified');

  // ---------------------------------------------------------------------------
  // 8. DASHBOARD — PAGE HEADER & HEADING
  // ---------------------------------------------------------------------------
  console.log('🧪 8. Testing PageHeader & Heading: Breadcrumbs & Actions Slot...');
  const pageHeaderHtml = renderToStaticMarkup(
    React.createElement<any>(PageHeader, {
      title: 'Quản lý vận đơn',
      description: 'Theo dõi toàn bộ luồng giao nhận và đối soát cước phí.',
      breadcrumbs: [
        { label: 'Điều hành', href: '/shipments' },
        { label: 'Danh sách vận đơn', active: true },
      ],
      actions: React.createElement<any>('button', { className: 'btn-primary' }, 'Tạo đơn mới'),
    })
  );

  assert.ok(
    pageHeaderHtml.includes('aria-label="Đường dẫn trang"'),
    'Must have accessible breadcrumb navigation'
  );
  assert.ok(pageHeaderHtml.includes('Quản lý vận đơn'), 'Must render page title in h1');
  assert.ok(
    pageHeaderHtml.includes('Theo dõi toàn bộ luồng giao nhận'),
    'Must render page description'
  );
  assert.ok(pageHeaderHtml.includes('Tạo đơn mới'), 'Must render action button slot');
  assert.ok(
    pageHeaderHtml.includes('aria-current="page"'),
    'Current breadcrumb must have aria-current="page"'
  );
  console.log('   ✅ PageHeader verified with accessible breadcrumbs, hierarchy, and action slots');

  // ---------------------------------------------------------------------------
  // 9. DASHBOARD — SIDEBAR & HEADER SHELL
  // ---------------------------------------------------------------------------
  console.log('🧪 9. Testing DashboardSidebar & DashboardHeader Shell...');
  const sidebarHtml = renderToStaticMarkup(
    React.createElement<any>(DashboardSidebar, {
      navSections: DEFAULT_NAV_SECTIONS,
      isCollapsed: false,
    })
  );

  assert.ok(
    sidebarHtml.includes('aria-label="Thanh điều hướng chính"'),
    'Sidebar must have aria-label'
  );
  assert.ok(sidebarHtml.includes('Ship Dễ'), 'Must render Ship Dễ brand name');
  assert.ok(sidebarHtml.includes('TỔNG QUAN'), 'Must render navigation group headers');
  assert.ok(sidebarHtml.includes('Quản lý vận đơn'), 'Must render navigation link');
  assert.ok(
    sidebarHtml.includes('Cứu đơn giao thất bại'),
    'Must render exception handling nav link'
  );

  const headerHtml = renderToStaticMarkup(
    React.createElement<any>(DashboardHeader, {
      shopName: 'Shop Dễ Dàng — Chi Nhánh 1',
      currentUser: {
        name: 'Nguyễn Văn Chủ Shop',
        email: 'owner@shipde.net',
        role: 'Chủ Shop',
      },
    })
  );

  assert.ok(headerHtml.includes('Shop Dễ Dàng — Chi Nhánh 1'), 'Must render current shop name');
  assert.ok(headerHtml.includes('Nguyễn Văn Chủ Shop'), 'Must render user full name');
  assert.ok(headerHtml.includes('Chủ Shop'), 'Must render user role badge');
  assert.ok(
    headerHtml.includes('aria-label="Menu tài khoản cá nhân"'),
    'Must have accessible user menu button'
  );
  console.log(
    '   ✅ DashboardSidebar and DashboardHeader verified with branding, sections, and user info'
  );

  // ---------------------------------------------------------------------------
  // 10. URL SEARCH PARAMS HELPER FUNCTIONS
  // ---------------------------------------------------------------------------
  console.log('🧪 10. Testing URL search params parsing & formatting helpers...');
  const parsedAsc = parseSortParam('codAmount.asc');
  assert.deepStrictEqual(parsedAsc, { id: 'codAmount', desc: false });

  const parsedDesc = parseSortParam('createdAt.desc');
  assert.deepStrictEqual(parsedDesc, { id: 'createdAt', desc: true });

  const parsedNull = parseSortParam(null);
  assert.strictEqual(parsedNull, null);

  const formattedAsc = formatSortParam({ id: 'feeAmount', desc: false });
  assert.strictEqual(formattedAsc, 'feeAmount.asc');

  const formattedDesc = formatSortParam({ id: 'feeAmount', desc: true });
  assert.strictEqual(formattedDesc, 'feeAmount.desc');
  console.log('   ✅ Sort query helpers verified (parseSortParam, formatSortParam)');

  // ---------------------------------------------------------------------------
  // 11. STORYBOOK FIXTURE INTEGRITY & ISOLATION
  // ---------------------------------------------------------------------------
  console.log('🧪 11. Testing Fixture Data Isolation...');
  assert.strictEqual(FIXTURE_SHIPMENTS.length, 8, 'Must have 8 test fixture shipments');
  for (const item of FIXTURE_SHIPMENTS) {
    assert.ok(item.id.startsWith('fix-'), `Fixture id ${item.id} must be prefixed with 'fix-'`);
    assert.ok(
      item.trackingCode.length > 5,
      `Tracking code ${item.trackingCode} must be valid format`
    );
    assert.ok(item.codAmount > 0, `COD amount ${item.codAmount} must be positive`);
    assert.ok(item.feeAmount > 0, `Fee amount ${item.feeAmount} must be positive`);
  }
  console.log('   ✅ Fixture data verified: 8 isolated test fixtures cleanly prefixed with fix-');

  console.log('\n================================================================');
  console.log('🎉 ALL 11 DATA TABLE & DASHBOARD SHELL TEST SUITES PASSED 100%!');
  console.log('================================================================');
}

runTestSuite().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
