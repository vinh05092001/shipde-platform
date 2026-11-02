import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  applyServerDrivenTableOperations,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableSkeleton,
  DataTableToolbar,
  DataTableViewOptions,
  parseTableSearchParams,
  serializeTableSearchParams,
  ServerDataTable,
  SHIPMENT_STATUS_FACET_OPTIONS,
  SHIPMENT_TABLE_FILTER_FIELDS,
  SHIPMENT_TABLE_FIXTURE_ROWS,
  useDataTable,
  type ServerDataTableColumnDef,
  type ShipmentTableFixtureRow,
} from '@/components/data-table';
import {
  AppSidebar,
  DashboardBreadcrumbs,
  DashboardHeader,
  DashboardShell,
  DashboardUserNav,
  DEFAULT_SHIPDE_NAV_GROUPS,
  PageContainer,
  PageHeader,
} from '@/components/dashboard-shell';
import { DataTableShellShowcase } from '@/app/storybook/data-table-shell/page';

const TEST_COLUMNS: ServerDataTableColumnDef<ShipmentTableFixtureRow>[] = [
  {
    id: 'trackingCode',
    header: 'Mã vận đơn',
    accessorKey: 'trackingCode',
    enableSorting: true,
    enableHiding: false,
    tabularNums: true,
  },
  {
    id: 'carrierId',
    header: 'Hãng vận chuyển',
    accessorKey: 'carrierName',
    enableSorting: true,
  },
  {
    id: 'status',
    header: 'Trạng thái vận hành',
    accessorKey: 'status',
    enableSorting: true,
  },
  {
    id: 'codAmountVnd',
    header: 'Tiền thu hộ (COD)',
    accessorKey: 'codAmountVnd',
    enableSorting: true,
    align: 'right',
    tabularNums: true,
  },
];

function TableHarness(props: {
  searchParams?: string;
  rows?: ShipmentTableFixtureRow[];
  totalCount?: number;
  pageCount?: number;
  isLoading?: boolean;
  isForbidden?: boolean;
  error?: { title?: string; message: string; code?: string } | null;
  partialWarning?: { message: string; detail?: string } | null;
  validationError?: string | null;
}) {
  const parsed = parseTableSearchParams(props.searchParams ?? '', {
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
    allowedSortIds: TEST_COLUMNS.map((c) => c.id),
  });
  const computed = applyServerDrivenTableOperations(
    props.rows ?? SHIPMENT_TABLE_FIXTURE_ROWS,
    parsed,
    TEST_COLUMNS,
    SHIPMENT_TABLE_FILTER_FIELDS
  );
  const table = useDataTable({
    data: props.rows !== undefined ? props.rows : computed.rows,
    columns: TEST_COLUMNS,
    pageCount: props.pageCount ?? computed.pageCount,
    totalCount: props.totalCount ?? computed.totalCount,
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
    searchParams: props.searchParams ?? '',
    syncWithBrowserHistory: false,
  });

  return React.createElement(ServerDataTable<ShipmentTableFixtureRow>, {
    table,
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
    facetCounts: computed.facetCounts,
    enableRowSelection: true,
    isLoading: props.isLoading,
    isForbidden: props.isForbidden,
    error: props.error,
    onRetry: () => {},
    partialWarning: props.partialWarning,
    validationError: props.validationError,
    emptyActionLabel: 'Tạo vận đơn mẫu',
    onEmptyAction: () => {},
  });
}

async function runDataTableAndDashboardShellTests() {
  console.log('================================================================');
  console.log('SHIP DỄ — SERVER DATA TABLE & DASHBOARD SHELL TEST SUITE (TASK-AI-155)');
  console.log('================================================================');

  // -------------------------------------------------------------------------
  // 1. URL Search Params Parsing, Validation & Serialization
  // -------------------------------------------------------------------------
  const defaultState = parseTableSearchParams('', {
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
    allowedSortIds: ['trackingCode', 'codAmountVnd', 'status'],
  });
  assert.strictEqual(defaultState.page, 1, 'Default page must be 1');
  assert.strictEqual(defaultState.perPage, 10, 'Default perPage must be 10');
  assert.strictEqual(defaultState.density, 'compact', 'Default density must be compact');
  assert.strictEqual(defaultState.sorting.length, 0, 'Default sorting must be empty');
  assert.strictEqual(defaultState.columnFilters.length, 0, 'Default filters must be empty');
  assert.strictEqual(
    defaultState.validationErrors.length,
    0,
    'Default state must have 0 validation errors'
  );

  const complexState = parseTableSearchParams(
    'page=2&per_page=20&sort=codAmountVnd.desc,trackingCode.asc&status=DELIVERY_FAILED,RETURNING&carrierId=GHN&search=GUMAC&density=comfortable&hide=carrierId',
    {
      filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
      allowedSortIds: ['trackingCode', 'codAmountVnd', 'status'],
    }
  );
  assert.strictEqual(complexState.page, 2, 'Parsed page must be 2');
  assert.strictEqual(complexState.perPage, 20, 'Parsed perPage must be 20');
  assert.strictEqual(complexState.density, 'comfortable', 'Parsed density must be comfortable');
  assert.strictEqual(complexState.sorting.length, 2, 'Parsed multi-sort must have 2 entries');
  assert.deepStrictEqual(complexState.sorting[0], { id: 'codAmountVnd', desc: true });
  assert.deepStrictEqual(complexState.sorting[1], { id: 'trackingCode', desc: false });
  assert.strictEqual(
    complexState.columnVisibility.carrierId,
    false,
    'carrierId column must be marked hidden'
  );
  const statusFilter = complexState.columnFilters.find((f) => f.id === 'status');
  assert.deepStrictEqual(statusFilter?.value, ['DELIVERY_FAILED', 'RETURNING']);

  const serialized = serializeTableSearchParams(complexState, {
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
  });
  assert.ok(serialized.includes('page=2'), 'Serialized URL must include page=2');
  assert.ok(serialized.includes('per_page=20'), 'Serialized URL must include per_page=20');
  assert.ok(
    serialized.includes('sort=codAmountVnd.desc%2CtrackingCode.asc') ||
      serialized.includes('sort=codAmountVnd.desc,trackingCode.asc'),
    'Serialized URL must preserve sort order'
  );
  assert.ok(
    serialized.includes('density=comfortable'),
    'Serialized URL must include non-default density'
  );

  // Validation error detection on malformed URL params
  const invalidUrlState = parseTableSearchParams(
    'page=-5&per_page=999&sort=unknownCol.downwards&status=INVALID_STATUS_CODE&density=ultra',
    {
      filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
      allowedSortIds: ['trackingCode', 'codAmountVnd'],
    }
  );
  assert.strictEqual(invalidUrlState.page, 1, 'Invalid page must fall back to 1');
  assert.strictEqual(invalidUrlState.perPage, 10, 'Invalid per_page must fall back to 10');
  assert.strictEqual(
    invalidUrlState.density,
    'compact',
    'Invalid density must fall back to compact'
  );
  assert.ok(
    invalidUrlState.validationErrors.length >= 4,
    `Expected >= 4 validation errors for invalid URL params, got ${invalidUrlState.validationErrors.length}`
  );
  console.log('✅ PASS: 1. URL Search Params parser, validator & serializer verified');

  // -------------------------------------------------------------------------
  // 2. Server-Driven Filter, Facet Count, Sort & Pagination Engine
  // -------------------------------------------------------------------------
  const failedFilterState = parseTableSearchParams('status=DELIVERY_FAILED', {
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
  });
  const failedResult = applyServerDrivenTableOperations(
    SHIPMENT_TABLE_FIXTURE_ROWS,
    failedFilterState,
    TEST_COLUMNS,
    SHIPMENT_TABLE_FILTER_FIELDS
  );
  assert.strictEqual(
    failedResult.totalCount,
    2,
    'Fixture dataset must have exactly 2 DELIVERY_FAILED rows'
  );
  assert.ok(
    failedResult.rows.every((r) => r.status === 'DELIVERY_FAILED'),
    'All filtered rows must have status DELIVERY_FAILED'
  );
  assert.strictEqual(
    failedResult.facetCounts.status.DELIVERED,
    3,
    'Facet count for DELIVERED across fixture dataset must be 3'
  );

  const sortedDescState = parseTableSearchParams('sort=codAmountVnd.desc&per_page=10&page=1', {
    filterFields: SHIPMENT_TABLE_FILTER_FIELDS,
  });
  const sortedDescResult = applyServerDrivenTableOperations(
    SHIPMENT_TABLE_FIXTURE_ROWS,
    sortedDescState,
    TEST_COLUMNS,
    SHIPMENT_TABLE_FILTER_FIELDS
  );
  assert.strictEqual(
    sortedDescResult.rows[0].codAmountVnd,
    1580000,
    'Highest COD fixture row must be 1,580,000 VND when sorted descending'
  );
  assert.strictEqual(
    sortedDescResult.pageCount,
    2,
    '12 fixture rows at 10 per_page must yield 2 pages'
  );
  console.log('✅ PASS: 2. Server-driven filtering, facet counting, sorting & pagination verified');

  // -------------------------------------------------------------------------
  // 3. ServerDataTable UI States (Loading, Empty, No-Results, Out-of-Range,
  //    Validation Error, Partial, Error, Forbidden, Populated Success)
  // -------------------------------------------------------------------------
  // 3a. Loading state
  const loadingHtml = renderToStaticMarkup(React.createElement(TableHarness, { isLoading: true }));
  assert.ok(loadingHtml.includes('aria-busy="true"'), 'Loading state must set aria-busy="true"');
  assert.ok(
    loadingHtml.includes('Đang tải dữ liệu vận hành'),
    'Loading state must include screen-reader loading status in Vietnamese'
  );

  // 3b. Unfiltered Empty state
  const emptyHtml = renderToStaticMarkup(
    React.createElement(TableHarness, { rows: [], totalCount: 0, pageCount: 1 })
  );
  assert.ok(
    emptyHtml.includes('Chưa có dữ liệu vận hành'),
    'Empty state must render Vietnamese empty title'
  );
  assert.ok(
    emptyHtml.includes('Tạo vận đơn mẫu'),
    'Empty state must render primary recovery CTA button'
  );

  // 3c. Filtered No-Results state
  const noResultsHtml = renderToStaticMarkup(
    React.createElement(TableHarness, {
      searchParams: 'search=MA_VAN_DON_KHONG_TON_TAI_999',
    })
  );
  assert.ok(
    noResultsHtml.includes('Không tìm thấy kết quả phù hợp với bộ lọc'),
    'Filtered empty state must explain no filter match'
  );
  assert.ok(
    noResultsHtml.includes('Xóa bộ lọc để xem toàn bộ'),
    'Filtered empty state must offer filter reset button'
  );

  // 3d. Out-of-range page recovery state
  const outOfRangeHtml = renderToStaticMarkup(
    React.createElement(TableHarness, {
      searchParams: 'page=9',
      rows: [],
      totalCount: 12,
      pageCount: 2,
    })
  );
  assert.ok(
    outOfRangeHtml.includes('vượt quá số trang hiện có'),
    'Out-of-range page state must explain page overflow'
  );
  assert.ok(
    outOfRangeHtml.includes('Quay về trang 1'),
    'Out-of-range page state must offer page 1 reset button'
  );

  // 3e. Validation error banner state
  const validationHtml = renderToStaticMarkup(
    React.createElement(TableHarness, {
      searchParams: 'page=-1&per_page=888',
    })
  );
  assert.ok(
    validationHtml.includes('Tham số truy vấn URL cần điều chỉnh'),
    'Validation error banner must render when URL params are invalid'
  );
  assert.ok(
    validationHtml.includes('Đặt lại tham số mặc định'),
    'Validation error banner must provide recovery action'
  );

  // 3f. Server / Gateway Error state
  const errorHtml = renderToStaticMarkup(
    React.createElement(TableHarness, {
      error: {
        title: 'Lỗi kết nối máy chủ vận đơn',
        message: 'Không thể tải danh sách vận đơn do cổng API phản hồi chậm.',
        code: 'ERR_GATEWAY_502',
      },
    })
  );
  assert.ok(errorHtml.includes('Lỗi kết nối máy chủ vận đơn'), 'Error state must render title');
  assert.ok(errorHtml.includes('ERR_GATEWAY_502'), 'Error state must render error code');
  assert.ok(errorHtml.includes('Thử tải lại'), 'Error state must render retry button');

  // 3g. Forbidden 403 state
  const forbiddenHtml = renderToStaticMarkup(
    React.createElement(TableHarness, { isForbidden: true })
  );
  assert.ok(
    forbiddenHtml.includes('Không đủ quyền truy cập dữ liệu (403 Forbidden)'),
    'Forbidden state must render 403 heading'
  );

  // 3h. Partial data warning banner + Populated Success state
  const successAndPartialHtml = renderToStaticMarkup(
    React.createElement(TableHarness, {
      searchParams: 'sort=codAmountVnd.desc',
      partialWarning: {
        message: 'Dữ liệu đồng bộ một phần từ ĐVVC',
        detail: 'Webhook J&T đang trễ 5 phút.',
      },
    })
  );
  assert.ok(
    successAndPartialHtml.includes('Dữ liệu đồng bộ một phần từ ĐVVC'),
    'Partial state banner must render message'
  );
  assert.ok(
    successAndPartialHtml.includes('aria-sort="descending"'),
    'Sorted column header must render aria-sort="descending"'
  );
  assert.ok(
    successAndPartialHtml.includes('GHN-FIX-884150'),
    'Success state must render fixture tracking code'
  );
  assert.ok(
    successAndPartialHtml.includes('Trang 1 / 2'),
    'Pagination bar must display current page and page count in Vietnamese'
  );
  console.log('✅ PASS: 3. ServerDataTable full state matrix & ARIA semantics verified');

  // -------------------------------------------------------------------------
  // 4. Individual Data Table Subcomponents (ColumnHeader, FacetedFilter,
  //    ViewOptions, Toolbar, Pagination, Skeleton)
  // -------------------------------------------------------------------------
  const colHeaderHtml = renderToStaticMarkup(
    React.createElement(DataTableColumnHeader, {
      columnId: 'codAmountVnd',
      title: 'Tiền thu hộ (COD)',
      canSort: true,
      canHide: true,
      sortDirection: 'asc',
      align: 'right',
    })
  );
  assert.ok(
    colHeaderHtml.includes('đang sắp xếp tăng dần'),
    'DataTableColumnHeader must announce ascending sort in aria-label'
  );

  const facetedFilterHtml = renderToStaticMarkup(
    React.createElement(DataTableFacetedFilter, {
      columnId: 'status',
      title: 'Trạng thái vận đơn',
      options: SHIPMENT_STATUS_FACET_OPTIONS,
      selectedValues: ['DELIVERY_FAILED', 'RETURNING'],
      facetCounts: { DELIVERY_FAILED: 2, RETURNING: 1 },
      onChange: () => {},
    })
  );
  assert.ok(
    facetedFilterHtml.includes('Giao thất bại (Cần xử lý)'),
    'DataTableFacetedFilter must display selected option labels'
  );

  const viewOptionsHtml = renderToStaticMarkup(
    React.createElement(DataTableViewOptions<ShipmentTableFixtureRow>, {
      columns: TEST_COLUMNS,
      columnVisibility: {},
      density: 'compact',
      onToggleColumnVisibility: () => {},
      onChangeDensity: () => {},
    })
  );
  assert.ok(viewOptionsHtml.includes('Thu gọn'), 'DataTableViewOptions must render compact toggle');
  assert.ok(
    viewOptionsHtml.includes('Hiển thị cột'),
    'DataTableViewOptions must render column visibility button'
  );

  const skeletonHtml = renderToStaticMarkup(
    React.createElement(DataTableSkeleton, { columnCount: 5, rowCount: 4 })
  );
  assert.ok(skeletonHtml.includes('role="status"'), 'DataTableSkeleton must have role="status"');
  assert.ok(
    skeletonHtml.includes('aria-busy="true"'),
    'DataTableSkeleton must have aria-busy="true"'
  );
  assert.ok(
    typeof DataTableToolbar === 'function' && typeof DataTablePagination === 'function',
    'DataTableToolbar and DataTablePagination must be exported functions'
  );
  console.log('✅ PASS: 4. Data table subcomponents verified');

  // -------------------------------------------------------------------------
  // 5. DashboardShell, AppSidebar, DashboardHeader, PageHeader, PageContainer
  // -------------------------------------------------------------------------
  const shellHtml = renderToStaticMarkup(
    React.createElement(
      DashboardShell,
      {
        navGroups: DEFAULT_SHIPDE_NAV_GROUPS,
        activePath: '/shipments',
        breadcrumbs: [{ label: 'Ship Dễ Ops', href: '/' }, { label: 'Quản lý Vận đơn' }],
        tenants: [
          {
            tenantId: 'TENANT-1',
            shopId: 'SHOP-1',
            shopName: 'Cửa hàng Thời trang GUMAC [FIXTURE]',
            warehouseLabel: 'Kho Quận 12',
          },
        ],
        activeTenant: {
          tenantId: 'TENANT-1',
          shopId: 'SHOP-1',
          shopName: 'Cửa hàng Thời trang GUMAC [FIXTURE]',
          warehouseLabel: 'Kho Quận 12',
        },
        user: {
          id: 'USR-1',
          fullName: 'Trần Vận Hành',
          email: 'ops@shipde.vn',
          roleLabel: 'Quản lý vận hành',
        },
      },
      React.createElement(
        PageContainer,
        null,
        React.createElement(PageHeader, {
          title: 'Quản lý Vận đơn',
          description: 'Theo dõi hành trình và xử lý sự cố giao hàng tập trung.',
        })
      )
    )
  );
  assert.ok(
    shellHtml.includes('Chuyển đến nội dung chính'),
    'DashboardShell must include skip-to-content accessibility link'
  );
  assert.ok(
    shellHtml.includes('id="dashboard-main-content"'),
    'DashboardShell must include main landmark with id="dashboard-main-content"'
  );
  assert.ok(
    shellHtml.includes('aria-label="Breadcrumb"'),
    'DashboardHeader must render accessible Breadcrumb navigation'
  );
  assert.ok(
    shellHtml.includes('Cửa hàng Thời trang GUMAC [FIXTURE]'),
    'DashboardShell must render active tenant context'
  );
  assert.ok(
    shellHtml.includes('aria-current="page"'),
    'AppSidebar & Breadcrumbs must mark active route with aria-current="page"'
  );

  // Shell loading, error, and forbidden states
  const shellLoadingHtml = renderToStaticMarkup(
    React.createElement(DashboardShell, { isLoading: true }, React.createElement('div'))
  );
  assert.ok(
    shellLoadingHtml.includes('Đang tải không gian làm việc...'),
    'DashboardShell loading state must render skeleton and status text'
  );

  const shellErrorHtml = renderToStaticMarkup(
    React.createElement(
      DashboardShell,
      {
        error: {
          title: 'Lỗi tải cấu hình cửa hàng',
          message: 'Không thể kết nối dịch vụ cấu hình.',
          code: 'SHELL_ERR_500',
        },
        onRetry: () => {},
      },
      React.createElement('div')
    )
  );
  assert.ok(
    shellErrorHtml.includes('SHELL_ERR_500') && shellErrorHtml.includes('Thử tải lại trang'),
    'DashboardShell error state must render error code and retry button'
  );

  const shellForbiddenHtml = renderToStaticMarkup(
    React.createElement(
      DashboardShell,
      { isForbidden: true, forbiddenMessage: 'Cần quyền Quản trị viên.' },
      React.createElement('div')
    )
  );
  assert.ok(
    shellForbiddenHtml.includes('Không có quyền truy cập khu vực này (403)'),
    'DashboardShell forbidden state must render 403 message'
  );
  assert.ok(
    typeof AppSidebar === 'function' &&
      typeof DashboardHeader === 'function' &&
      typeof DashboardBreadcrumbs === 'function' &&
      typeof DashboardUserNav === 'function',
    'All dashboard-shell subcomponents must be exported functions'
  );
  console.log('✅ PASS: 5. DashboardShell, AppSidebar, DashboardHeader & PageHeader verified');

  // -------------------------------------------------------------------------
  // 6. Storybook / Test Showcase Page & Fixture Marking Verification
  // -------------------------------------------------------------------------
  const showcaseModes = [
    'success',
    'loading',
    'empty',
    'no-results',
    'validation-error',
    'partial',
    'error',
    'forbidden',
  ] as const;

  for (const mode of showcaseModes) {
    const html = renderToStaticMarkup(
      React.createElement(DataTableShellShowcase, { initialMode: mode })
    );
    assert.ok(
      html.includes('[DỮ LIỆU MẪU / FIXTURE — TRANG KIỂM THỬ STORYBOOK]'),
      `Storybook showcase mode "${mode}" must prominently display fixture banner`
    );
  }
  assert.ok(
    SHIPMENT_TABLE_FIXTURE_ROWS.every(
      (row) => row.isFixture === true && row.fixtureBannerTag === '[DỮ LIỆU MẪU / FIXTURE]'
    ),
    'Every fixture row must have isFixture=true and explicit fixtureBannerTag'
  );
  console.log('✅ PASS: 6. Storybook showcase page & explicit fixture labeling verified');

  // -------------------------------------------------------------------------
  // 7. License Notice & No-Clerk Compliance Audit
  // -------------------------------------------------------------------------
  const webRoot = path.resolve(__dirname, '../..');
  const dataTableDir = path.join(webRoot, 'src/components/data-table');
  const dashboardShellDir = path.join(webRoot, 'src/components/dashboard-shell');

  for (const file of fs.readdirSync(dataTableDir)) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(path.join(dataTableDir, file), 'utf8');
      assert.ok(
        content.includes('MIT License') && content.includes('sadmann7/shadcn-table'),
        `File data-table/${file} must retain MIT License notice for sadmann7/shadcn-table`
      );
    }
  }

  for (const file of fs.readdirSync(dashboardShellDir)) {
    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(path.join(dashboardShellDir, file), 'utf8');
      assert.ok(
        content.includes('MIT License') &&
          content.includes('Kiranism/next-shadcn-dashboard-starter'),
        `File dashboard-shell/${file} must retain MIT License notice for Kiranism/next-shadcn-dashboard-starter`
      );
      assert.ok(
        !content.toLowerCase().includes('@clerk/nextjs') &&
          !content.toLowerCase().includes('clerkprovider'),
        `File dashboard-shell/${file} must not import or depend on Clerk`
      );
    }
  }
  console.log('✅ PASS: 7. MIT license notices & zero-Clerk compliance verified');

  console.log('\n🎉 ALL TASK-AI-155 DATA TABLE & DASHBOARD SHELL TESTS PASSED!');
}

runDataTableAndDashboardShellTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
