import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ServerDataTable,
  applyServerDataTableQuery,
  createQueryString,
  parseFilterParams,
  parsePaginationParams,
  parseSortParam,
  serializeSortParam,
  toUrlSearchParams,
} from '@/components/data-table';
import {
  AppSidebar,
  DashboardBreadcrumbs,
  DashboardShell,
  DashboardUserNav,
  PageHeader,
  formatRoleLabelVi,
} from '@/components/dashboard-shell';
import {
  FIXTURE_COLUMNS,
  FIXTURE_CONTEXT_OPTIONS,
  FIXTURE_DATA_NOTICE,
  FIXTURE_FILTER_FIELDS,
  FIXTURE_NAV_GROUPS,
  FIXTURE_SHIPMENT_ROWS,
  StorybookShowcaseContent,
} from '@/app/storybook/page';

async function runDataTableAndDashboardShellTests() {
  console.log('================================================================');
  console.log('SHIP DỄ — SERVER DATA TABLE & DASHBOARD SHELL TEST SUITE (TASK-AI-155)');
  console.log('================================================================');

  // 1. MIT License Attribution & No-Clerk Invariant
  console.log('🧪 1. Checking MIT License Notices & Zero-Clerk Invariant...');
  const webRoot = path.resolve(__dirname, '../..');
  const hookSource = fs.readFileSync(
    path.join(webRoot, 'src/components/data-table/use-data-table.ts'),
    'utf-8'
  );
  const tableSource = fs.readFileSync(
    path.join(webRoot, 'src/components/data-table/data-table.tsx'),
    'utf-8'
  );
  const shellSource = fs.readFileSync(
    path.join(webRoot, 'src/components/dashboard-shell/dashboard-shell.tsx'),
    'utf-8'
  );

  assert.ok(
    hookSource.includes('sadmann7/shadcn-table') && hookSource.includes('MIT License'),
    'use-data-table.ts must retain sadmann7/shadcn-table MIT license notice'
  );
  assert.ok(
    tableSource.includes('sadmann7/shadcn-table') && tableSource.includes('MIT License'),
    'data-table.tsx must retain sadmann7/shadcn-table MIT license notice'
  );
  assert.ok(
    shellSource.includes('Kiranism/next-shadcn-dashboard-starter') &&
      shellSource.includes('MIT License'),
    'dashboard-shell.tsx must retain Kiranism/next-shadcn-dashboard-starter MIT license notice'
  );
  assert.ok(
    !shellSource.includes('@clerk/') && !tableSource.includes('@clerk/'),
    'Ported components must not import or depend on Clerk'
  );
  console.log('   ✅ MIT license notices and zero-Clerk invariant verified');

  // 2. Pure URL Search Params Parsing, Validation & Query Evaluation
  console.log('🧪 2. Testing URL Search Params Helpers & Server Query Evaluator...');
  const allowedCols = FIXTURE_COLUMNS.map((c) => c.id);

  const validSort = parseSortParam('codAmountVnd.desc', allowedCols);
  assert.deepStrictEqual(validSort.sort, { id: 'codAmountVnd', desc: true });
  assert.strictEqual(validSort.validationError, null);
  assert.strictEqual(serializeSortParam(validSort.sort), 'codAmountVnd.desc');

  const invalidSortFormat = parseSortParam('invalid_sort_token', allowedCols);
  assert.ok(
    invalidSortFormat.validationError?.includes('không đúng định dạng'),
    'Malformed sort param must return Vietnamese validation error'
  );

  const disallowedSortCol = parseSortParam('secretInternalField.asc', allowedCols);
  assert.ok(
    disallowedSortCol.validationError?.includes('không được phép'),
    'Disallowed sort column must return Vietnamese validation error'
  );

  const validPaging = parsePaginationParams(new URLSearchParams('page=2&per_page=20'), 10);
  assert.strictEqual(validPaging.page, 2);
  assert.strictEqual(validPaging.perPage, 20);
  assert.strictEqual(validPaging.validationError, null);

  const invalidPaging = parsePaginationParams(new URLSearchParams('page=0&per_page=15'), 10);
  assert.strictEqual(invalidPaging.page, 1);
  assert.strictEqual(invalidPaging.perPage, 10);
  assert.ok(
    invalidPaging.validationError?.includes('page=0') &&
      invalidPaging.validationError?.includes('per_page=15'),
    'Invalid page and per_page must report validation errors and fallback safely'
  );

  const parsedFilters = parseFilterParams(
    new URLSearchParams('q=FIXTURE_GHN&carrier=GHN.GHTK&status=DELIVERED,IN_TRANSIT'),
    FIXTURE_FILTER_FIELDS
  );
  assert.strictEqual(parsedFilters.textFilters.q, 'FIXTURE_GHN');
  assert.deepStrictEqual(parsedFilters.facetedFilters.carrier, ['GHN', 'GHTK']);
  assert.deepStrictEqual(parsedFilters.facetedFilters.status, ['DELIVERED', 'IN_TRANSIT']);
  assert.strictEqual(parsedFilters.validationError, null);

  const invalidFacet = parseFilterParams(
    new URLSearchParams('carrier=UNKNOWN_CARRIER'),
    FIXTURE_FILTER_FIELDS
  );
  assert.ok(
    invalidFacet.validationError?.includes('UNKNOWN_CARRIER'),
    'Unknown faceted filter option must report Vietnamese validation error'
  );

  const nextQs = createQueryString(new URLSearchParams('page=2&q=abc'), {
    page: 1,
    q: null,
    sort: 'codAmountVnd.desc',
  });
  assert.strictEqual(nextQs, 'page=1&sort=codAmountVnd.desc');

  // Evaluate sorting + faceted filter + pagination on fixture dataset
  const evalResult = applyServerDataTableQuery(
    FIXTURE_SHIPMENT_ROWS,
    {
      page: 1,
      perPage: 2,
      sort: { id: 'codAmountVnd', desc: true },
      textFilters: {},
      facetedFilters: { carrier: ['GHN', 'GHTK'] },
    },
    { searchKeys: ['trackingCode', 'orderCode'] }
  );
  assert.strictEqual(evalResult.totalRows, 4, '4 fixture rows belong to GHN or GHTK');
  assert.strictEqual(evalResult.pageCount, 2, '4 rows at 2 per page = 2 pages');
  assert.strictEqual(evalResult.rows.length, 2, 'First page returns 2 rows');
  assert.strictEqual(
    evalResult.rows[0].id,
    'FIXTURE-SHP-005',
    'Highest COD amount (920,000 VND) must be sorted first when codAmountVnd.desc is active'
  );
  assert.strictEqual(
    evalResult.rows[1].id,
    'FIXTURE-SHP-002',
    'Second highest COD amount (780,000 VND) must be sorted second'
  );
  console.log('   ✅ URL search param helpers and server query evaluator verified');

  // 3. ServerDataTable UI States (Loading, Empty, Error, Forbidden, Validation, Partial, Success)
  console.log('🧪 3. Testing ServerDataTable UI States & Keyboard Accessibility...');

  // 3a. Loading state
  const loadingHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [],
      columns: FIXTURE_COLUMNS as any,
      pageCount: 1,
      loading: true,
    })
  );
  assert.ok(
    loadingHtml.includes('data-testid="data-table-loading-state"') &&
      loadingHtml.includes('data-testid="data-table-skeleton-row"') &&
      loadingHtml.includes('aria-busy="true"'),
    'Loading state must render skeleton rows and aria-busy="true"'
  );

  // 3b. Empty state (with active filter reset recovery)
  const emptyFilteredHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [],
      columns: FIXTURE_COLUMNS as any,
      filterFields: FIXTURE_FILTER_FIELDS as any,
      pageCount: 1,
      initialSearchParams: 'q=NONEXISTENT_QUERY',
      emptyActionLabel: 'Tạo vận đơn mẫu',
      onEmptyAction: () => {},
    })
  );
  assert.ok(
    emptyFilteredHtml.includes('data-testid="data-table-empty-state"') &&
      emptyFilteredHtml.includes('data-testid="data-table-empty-reset-filters"') &&
      emptyFilteredHtml.includes('data-testid="data-table-reset-filters"') &&
      emptyFilteredHtml.includes('data-testid="data-table-empty-action"'),
    'Empty filtered state must render empty state, reset filters button, and custom empty action'
  );

  // 3c. Error state
  const errorHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [],
      columns: FIXTURE_COLUMNS as any,
      pageCount: 1,
      error: 'Mất kết nối tới máy chủ vận đơn.',
      onRetry: () => {},
    })
  );
  assert.ok(
    errorHtml.includes('data-testid="data-table-error-state"') &&
      errorHtml.includes('role="alert"') &&
      errorHtml.includes('Dữ liệu hiện tại không bị thay đổi') &&
      errorHtml.includes('data-testid="data-table-retry-button"'),
    'Error state must explain what happened, confirm data unchanged, and render retry button'
  );

  // 3d. Forbidden (403) state
  const forbiddenHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [],
      columns: FIXTURE_COLUMNS as any,
      pageCount: 1,
      forbidden: true,
      forbiddenMessage: 'Thiếu quyền shipments:read trên chi nhánh này.',
      onForbiddenRecovery: () => {},
    })
  );
  assert.ok(
    forbiddenHtml.includes('data-testid="data-table-forbidden-state"') &&
      forbiddenHtml.includes('Quyền truy cập bị từ chối (403)') &&
      forbiddenHtml.includes('data-testid="data-table-forbidden-recovery"'),
    'Forbidden state must render dedicated 403 alert and recovery action'
  );

  // 3e. Validation error state (from invalid URL search param)
  const validationHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [...FIXTURE_SHIPMENT_ROWS],
      columns: FIXTURE_COLUMNS as any,
      pageCount: 1,
      initialSearchParams: 'sort=invalid_column.asc',
    })
  );
  assert.ok(
    validationHtml.includes('data-testid="data-table-validation-state"') &&
      validationHtml.includes('data-testid="data-table-validation-reset"'),
    'Invalid URL sort parameter must render validation alert banner and reset button'
  );

  // 3f. Partial state + Success state + A11y attributes
  const successHtml = renderToStaticMarkup(
    React.createElement(ServerDataTable, {
      data: [...FIXTURE_SHIPMENT_ROWS],
      columns: FIXTURE_COLUMNS as any,
      filterFields: FIXTURE_FILTER_FIELDS as any,
      pageCount: 2,
      totalRows: 12,
      isPartial: true,
      initialSearchParams: toUrlSearchParams({
        page: '1',
        per_page: '10',
        sort: 'codAmountVnd.desc',
      }),
    })
  );
  assert.ok(
    successHtml.includes('data-testid="data-table-success-state"') &&
      successHtml.includes('data-testid="data-table-partial-state"') &&
      successHtml.includes('aria-sort="descending"') &&
      successHtml.includes('aria-sort="none"') &&
      successHtml.includes('tabindex="0"') &&
      successHtml.includes('data-testid="data-table-pagination"') &&
      successHtml.includes('Trang 1 / 2'),
    'Success state must render rows, aria-sort attributes, keyboard tabIndex, partial banner, and pagination'
  );
  console.log('   ✅ ServerDataTable UI states and keyboard/ARIA attributes verified');

  // 4. DashboardShell, AppSidebar, PageHeader, Breadcrumbs & UserNav
  console.log('🧪 4. Testing DashboardShell, AppSidebar, PageHeader & UserNav...');
  assert.strictEqual(formatRoleLabelVi('OWNER'), 'Chủ shop');
  assert.strictEqual(formatRoleLabelVi('ACCOUNTANT'), 'Kế toán đối soát');

  const shellSuccessHtml = renderToStaticMarkup(
    React.createElement(
      DashboardShell,
      {
        navGroups: FIXTURE_NAV_GROUPS,
        activeHref: '/storybook',
        breadcrumbs: [{ title: 'Trang chủ', href: '/' }, { title: 'Vận đơn mẫu' }],
        pageTitle: 'Tiêu Đề Trang Kiểm Thử',
        pageDescription: 'Mô tả trang theo chuẩn DESIGN-SYSTEM-UX-RULES.md',
        pageBadge: 'FIXTURE',
        contextOptions: FIXTURE_CONTEXT_OPTIONS,
        selectedContextId: 'fixture-shop-all',
        onOpenQuickSearch: () => {},
      },
      React.createElement('div', { 'data-testid': 'child-content' }, 'Nội dung bảng')
    )
  );
  assert.ok(
    shellSuccessHtml.includes('data-testid="dashboard-skip-link"') &&
      shellSuccessHtml.includes('Chuyển đến nội dung chính') &&
      shellSuccessHtml.includes('data-testid="dashboard-sidebar"') &&
      shellSuccessHtml.includes('aria-current="page"') &&
      shellSuccessHtml.includes('data-testid="dashboard-breadcrumbs"') &&
      shellSuccessHtml.includes('data-testid="dashboard-context-selector"') &&
      shellSuccessHtml.includes('data-testid="dashboard-quick-search-button"') &&
      shellSuccessHtml.includes('data-testid="dashboard-user-nav"') &&
      shellSuccessHtml.includes('data-testid="dashboard-page-header"') &&
      shellSuccessHtml.includes('data-testid="child-content"'),
    'DashboardShell must render skip link, sidebar, breadcrumbs, context selector, quick search, user nav, page header, and children'
  );

  // Shell-level error & forbidden states
  const shellErrorHtml = renderToStaticMarkup(
    React.createElement(DashboardShell, {
      navGroups: FIXTURE_NAV_GROUPS,
      activeHref: '/storybook',
      pageTitle: 'Lỗi Không Gian Làm Việc',
      state: 'error',
      onRetry: () => {},
    })
  );
  assert.ok(
    shellErrorHtml.includes('data-testid="dashboard-shell-error"') &&
      shellErrorHtml.includes('data-testid="dashboard-shell-retry"'),
    'DashboardShell error state must render error alert and retry button'
  );

  const shellForbiddenHtml = renderToStaticMarkup(
    React.createElement(DashboardShell, {
      navGroups: FIXTURE_NAV_GROUPS,
      activeHref: '/storybook',
      pageTitle: 'Khu Vực Giới Hạn',
      state: 'forbidden',
      onForbiddenRecovery: () => {},
    })
  );
  assert.ok(
    shellForbiddenHtml.includes('data-testid="dashboard-shell-forbidden"') &&
      shellForbiddenHtml.includes('data-testid="dashboard-shell-forbidden-recovery"'),
    'DashboardShell forbidden state must render 403 alert and recovery button'
  );

  // Standalone subcomponents check
  const standaloneHeaderHtml = renderToStaticMarkup(
    React.createElement(PageHeader, {
      title: 'Tiêu Đề Độc Lập',
      description: 'Mô tả chi tiết',
      badge: 'MỚI',
      badgeTone: 'ok',
    })
  );
  assert.ok(
    standaloneHeaderHtml.includes('Tiêu Đề Độc Lập') && standaloneHeaderHtml.includes('badge-ok')
  );

  const standaloneSidebarHtml = renderToStaticMarkup(
    React.createElement(AppSidebar, {
      navGroups: FIXTURE_NAV_GROUPS,
      activeHref: '/storybook',
      isCollapsed: true,
    })
  );
  assert.ok(standaloneSidebarHtml.includes('data-collapsed="true"'));

  const standaloneBreadcrumbsHtml = renderToStaticMarkup(
    React.createElement(DashboardBreadcrumbs, {
      items: [{ title: 'Cấp 1', href: '/' }, { title: 'Cấp 2' }],
    })
  );
  assert.ok(standaloneBreadcrumbsHtml.includes('aria-current="page"'));

  const standaloneUserNavHtml = renderToStaticMarkup(
    React.createElement(DashboardUserNav, {
      user: { name: 'Lê Kế Toán', email: 'kt@shipde.vn', roleLabel: 'ACCOUNTANT' },
    })
  );
  assert.ok(standaloneUserNavHtml.includes('Kế toán đối soát'));
  console.log('   ✅ DashboardShell and subcomponents verified');

  // 5. Storybook / Test Page with Fixture Data Clearly Marked as Fixtures
  console.log('🧪 5. Testing Storybook Page (/storybook) & Explicit Fixture Marking...');
  assert.ok(
    FIXTURE_SHIPMENT_ROWS.length === 6 &&
      FIXTURE_SHIPMENT_ROWS.every((r) => r.isFixture === true && r.id.startsWith('FIXTURE-')),
    'Every row in FIXTURE_SHIPMENT_ROWS must be explicitly marked with isFixture: true and FIXTURE- prefix'
  );

  const storybookHtml = renderToStaticMarkup(
    React.createElement(StorybookShowcaseContent, {
      initialState: 'success',
      initialSearchParams: 'carrier=GHN&sort=codAmountVnd.desc',
    })
  );
  assert.ok(
    storybookHtml.includes('data-testid="storybook-fixture-banner"') &&
      storybookHtml.includes(FIXTURE_DATA_NOTICE) &&
      storybookHtml.includes('FIXTURE ONLY') &&
      storybookHtml.includes('data-testid="storybook-state-switcher"') &&
      storybookHtml.includes('FIXTURE_GHN_1004') &&
      storybookHtml.includes('FIXTURE_GHN_1001') &&
      !storybookHtml.includes('FIXTURE_VTP_1003'),
    'Storybook page must display prominent fixture banner and filter rows by URL search params (carrier=GHN)'
  );
  console.log('   ✅ Storybook fixture page and URL-driven filtering verified');

  console.log('\n================================================================');
  console.log('🎉 ALL TASK-AI-155 DATA TABLE & DASHBOARD SHELL TESTS PASSED');
  console.log('================================================================');
}

runDataTableAndDashboardShellTests().catch((err) => {
  console.error('❌ TASK-AI-155 test suite failed:', err);
  process.exit(1);
});
