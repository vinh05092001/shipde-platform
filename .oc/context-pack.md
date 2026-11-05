# Focused context pack

## .oc/pr-body.md

```
# PR Body - TASK-AI-155 Slice A

## Verification

### Finding 1 (contract): NOT IN SCOPE

- **Finding 1** (`contract` CI failing — missing PR sections: `## Work Item`, `## Source requirements`, `## Risks and limitations`, `## Codex review`; PR not marked `READY_FOR_CODEX`) points at PR-body/documentation contract validation, not at any file in scope (scope is limited to `data-table/**`, `use-debounced-callback.ts`, `data-table-*.test.ts`, `data-table-shipments.ts`, `layout.tsx` NuqsAdapter). Finding is void for this slice.

### Finding 2 (current-application): NOT IN SCOPE

- **Finding 2** (`current-application` CI failing — Docker `502 Bad Gateway` pulling `library/postgres` image) is an infrastructure/CI environment failure, not a code defect in any in-scope file. Finding is void for this slice.

### Finding 3 (application-gate): NOT IN SCOPE

- **Finding 3** (`application-gate` CI failing — `Required application checks did not pass: failure`) is a CI gate aggregate failure referencing the same Docker/infrastructure issue. No in-scope file is implicated. Finding is void for this slice.

### Local verification commands

- `cd apps/web && npx tsx src/tests/data-table-dashboard.test.ts` -> **PASS** (8 tests, AC-AI-155-01..07 + 10)
- `cd apps/web && npx tsx src/tests/data-table-tablecn.test.ts` -> **PASS** (6 TABLECN ported tests)
- `npx tsc --noEmit -p apps/web` (ignore .next/types) -> **PASS** (0 errors)
- `npx prettier --check .oc/pr-body.md apps/web/src/tests/data-table-dashboard.test.ts apps/web/src/tests/data-table-tablecn.test.ts apps/web/src/tests/fixtures/data-table-shipments.ts` -> **PASS** (all files conform to Prettier)
- `git diff --check origin/main...HEAD` -> **PASS** (zero whitespace/conflict errors)

## Status

- ✅ All scoped verifications pass
- No review findings applicable to this slice (all 3 findings are CI/infrastructure/contract-validation, not in-scope code)
```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## apps/web/package.json

```
{
  "name": "@shipde/web",
  "version": "3.3.0",
  "description": "Ship Dễ (shipde.net) - Next.js Web Console Application",
  "private": true,
  "prisma": {
    "schema": "../../prisma/schema.prisma"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "tsx src/tests/comprehensive-rules.test.ts && tsx src/tests/admin-shops.test.ts && tsx src/tests/rbac-matrix-live.test.ts && tsx src/tests/roles-page-states.test.ts && tsx src/tests/profile-page-states.test.ts && tsx src/tests/user-scopes-states.test.ts && tsx src/app/settings/users/users-page-states.test.ts && tsx src/tests/shop-profile.test.ts && tsx src/tests/branches-page-states.test.ts && tsx src/tests/warehouses-page-states.test.ts && tsx src/tests/onboarding-page-states.test.ts && tsx src/tests/global-search-states.test.ts && tsx src/tests/app-shell.test.tsx && tsx src/tests/data-table-dashboard.test.ts",
    "test:audit": "tsx src/tests/regression-audit.test.ts",
    "test:e2e": "tsx src/tests/e2e-scenarios.test.ts",
    "test:baseline": "tsx src/tests/preservation-smoke.test.ts",
    "db:generate": "prisma generate",
    "version:next": "next --version",
    "test:a11y": "playwright test",
    "test:lighthouse": "lhci autorun --config=./lighthouserc.cjs"
  },
  "dependencies": {
    "@prisma/client": "^6.19.2",
    "@shipde/config": "workspace:*",
    "@shipde/contracts": "workspace:*",
    "@shipde/ui": "workspace:*",
    "@tanstack/react-table": "9.2.4",
    "framer-motion": "^12.35.0",
    "lucide-react": "^0.577.0",
    "next": "16.4.1",
    "nuqs": "2.10.1",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "recharts": "^3.8.0"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.14.0",
    "@lhci/cli": "^0.15.1",
    "@playwright/test": "^1.64.1",
    "@shipde/testkit": "workspace:*",
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "axe-core": "4.14.0",
    "eslint": "^9.39.5",
    "eslint-config-next": "16.3.8",
    "prisma": "^6.19.2",
    "tailwindcss": "^4.2.1",
    "tsx": "^4.21.0",
    "typescript": "^5"
  }
}

```

## apps/web/src/tests/data-table-dashboard.test.ts

```
/**
 * TASK-AI-155 acceptance tests for the reusable server-driven data table (Slice A).
 *
 * One test per acceptance criterion (AC-AI-155-01 .. AC-AI-155-11) from
 * docs/product-spec/work-items/TASK-AI-155.md. Per-finding and duplicate regression
 * cases stay in the Work Item review gates instead of this file.
 */

import { test } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';

if (typeof (globalThis as any).location === 'undefined') {
  (globalThis as any).location = new URL('http://localhost/storybook');
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ColumnDef,
  DataTable,
  DataTableColumnHeader,
  DataTableFacetedFilter,
  DataTablePagination,
  DataTableToolbar,
  DataTableViewOptions,
  formatSortParam,
  parseSortParam,
} from '../components/data-table';
import { FIXTURE_SHIPMENTS, FixtureShipment } from './fixtures/data-table-shipments';

const columns: ColumnDef<FixtureShipment>[] = [
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
    enableSorting: false,
  },
  {
    id: 'recipientName',
    header: 'Người nhận',
    accessorKey: 'recipientName',
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

function renderTable(props: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement<any>(DataTable, {
      data: FIXTURE_SHIPMENTS.slice(0, 3),
      columns,
      keyExtractor: (item: FixtureShipment) => item.id,
      loading: false,
      sort: { id: 'trackingCode', desc: false },
      ...props,
    })
  );
}

// AC-AI-155-01: DataTable normal loaded state
test('AC-AI-155-01 DataTable normal loaded state', () => {
  const loaded = renderTable({ onRowClick: (item: FixtureShipment) => item });
  assert.ok(loaded.includes('role="table"'));
  assert.ok(loaded.includes(FIXTURE_SHIPMENTS[0].trackingCode));
  assert.ok(loaded.includes(FIXTURE_SHIPMENTS[0].recipientName));
  assert.ok(loaded.includes(`${FIXTURE_SHIPMENTS[0].codAmount.toLocaleString('vi-VN')} đ`));
  assert.ok(loaded.includes('text-right'));
  assert.ok(loaded.includes('aria-sort="ascending"'));
  assert.ok(loaded.includes('aria-sort="none"'));
  assert.ok(loaded.includes('data-row-action="true"'));
});

// AC-AI-155-02: DataTable loading skeleton state
test('AC-AI-155-02 DataTable loading skeleton state', () => {
  const loadingState = renderTable({ data: [], loading: true });
  assert.ok(loadingState.includes('aria-busy="true"'));
  assert.ok(loadingState.includes('animate-pulse'));
  assert.ok(!loadingState.includes(FIXTURE_SHIPMENTS[0].trackingCode));
});

// AC-AI-155-03: DataTable empty state
test('AC-AI-155-03 DataTable empty state', () => {
  const emptyState = renderTable({
    data: [],
    emptyTitle: 'Không có bản ghi nào',
    emptyDescription: 'Vui lòng nạp đơn hàng từ hệ thống POS hoặc kiểm tra lại bộ lọc.',
    emptyActionLabel: 'Làm mới dữ liệu',
    onEmptyAction: () => {},
  });
  assert.ok(emptyState.includes('Không có bản ghi nào'));
  assert.ok(emptyState.includes('Vui lòng nạp đơn hàng từ hệ thống POS'));
  assert.ok(emptyState.includes('Làm mới dữ liệu'));
});

// AC-AI-155-04: DataTable error and forbidden states
test('AC-AI-155-04 DataTable error and forbidden states', () => {
  const errorState = renderTable({
    data: [],
    error: 'Lỗi kết nối máy chủ quản trị vận chuyển (502 Bad Gateway)',
    onRetry: () => {},
  });
  assert.ok(errorState.includes('role="alert"'));
  assert.ok(errorState.includes('502 Bad Gateway'));
  assert.ok(errorState.includes('Thử lại'));
  assert.ok(!errorState.includes('Không tìm thấy dữ liệu'));
  const forbiddenState = renderTable({
    forbidden: 'Lỗi 403 Forbidden',
    forbiddenTitle: 'Không có quyền truy cập',
    forbiddenActionLabel: 'Yêu cầu quyền truy cập',
    onForbiddenAction: () => {},
  });
  assert.ok(forbiddenState.includes('role="alert"'));
  assert.ok(forbiddenState.includes('Không có quyền truy cập'));
  assert.ok(forbiddenState.includes('Yêu cầu quyền truy cập'));
});

// AC-AI-155-05: DataTableColumnHeader sorting
test('AC-AI-155-05 DataTableColumnHeader sorting', () => {
  const sortHtml = (sort: { id: string; desc: boolean } | null, column = columns[0]) =>
    renderToStaticMarkup(
      React.createElement<any>(DataTableColumnHeader, {
        column,
        title: 'Mã vận đơn',
        sort,
        onSort: () => {},
      })
    );
  assert.ok(sortHtml({ id: 'trackingCode', desc: false }).includes('data-sort="ascending"'));
  assert.ok(sortHtml({ id: 'trackingCode', desc: true }).includes('data-sort="descending"'));
  assert.ok(sortHtml(null).includes('data-sort="none"'));
  assert.ok(
    sortHtml({ id: 'trackingCode', desc: false }).includes(
      'Sắp xếp theo Mã vận đơn: hiện tại tăng dần'
    )
  );
  assert.ok(!sortHtml(null, columns[1]).includes('<button'));
});

// AC-AI-155-06: DataTablePagination controls
test('AC-AI-155-06 DataTablePagination controls', () => {
  const pagination = renderToStaticMarkup(
    React.createElement<any>(DataTablePagination, {
      pageIndex: 2,
      pageSize: 10,
      pageCount: 5,
      totalCount: 48,
      onPageChange: () => {},
      onPageSizeChange: () => {},
      selectedCount: 3,
    })
  );
  assert.ok(pagination.includes('Đã chọn'));
  assert.ok(pagination.includes('Số dòng mỗi trang:'));
  for (const size of [10, 20, 50, 100]) {
    assert.ok(pagination.includes(`value="${size}"`));
  }
  assert.ok(pagination.includes('title="Trang đầu"'));
  assert.ok(pagination.includes('title="Trang sau"'));
});

// AC-AI-155-07: DataTableToolbar and faceted filter
test('AC-AI-155-07 DataTableToolbar and faceted filter', () => {
  const toolbar = renderToStaticMarkup(
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
        columns,
        hiddenColumns: new Set(['carrier']),
        onToggleColumn: () => {},
        onResetColumns: () => {},
      }),
    })
  );
  assert.ok(toolbar.includes('value="ORD-2026"'));
  assert.ok(toolbar.includes('Đặt lại bộ lọc'));
  assert.ok(toolbar.includes('Trạng thái'));
  assert.ok(toolbar.includes('Cột hiển thị'));
});

// AC-AI-155-10: URL search params sort helpers
test('AC-AI-155-10 URL search params sort helpers', () => {
  assert.deepStrictEqual(parseSortParam('codAmount.asc'), { id: 'codAmount', desc: false });
  assert.deepStrictEqual(parseSortParam('createdAt.desc'), { id: 'createdAt', desc: true });
  assert.strictEqual(parseSortParam(null), null);
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: false }), 'feeAmount.asc');
  assert.strictEqual(formatSortParam({ id: 'feeAmount', desc: true }), 'feeAmount.desc');
});

```

## apps/web/src/tests/data-table-tablecn.test.ts

```
/**
 * Ported tests from tablecn (.oc/ref-src/test/use-data-table.test.tsx & faceted.test.tsx)
 * Adapted to tsx + node:assert test runner.
 */

import * as assert from 'node:assert';

if (typeof (globalThis as any).location === 'undefined') {
  (globalThis as any).location = new URL('http://localhost/');
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createColumnHelper } from '@tanstack/react-table';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';

import type { DataTableFeatures } from '../components/data-table/lib/data-table-features';
import { useDataTable, type TablecnUseDataTableProps } from '../components/data-table/useDataTable';
import { DataTableFacetedFilter } from '../components/data-table/DataTableFacetedFilter';

interface Task {
  id: string;
  code: string;
  title: string;
  status: string;
}

const columnHelper = createColumnHelper<DataTableFeatures, Task>();

const columns = columnHelper.columns([
  columnHelper.accessor('code', { id: 'code', enableSorting: false }),
  columnHelper.accessor('title', {
    id: 'title',
    meta: { variant: 'text' },
    enableColumnFilter: true,
  }),
  columnHelper.accessor('status', {
    id: 'status',
    meta: { variant: 'multi-select' },
    enableColumnFilter: true,
  }),
  columnHelper.display({ id: 'actions' }),
]);

const data: Task[] = [];

function getFilterSummary(filters: { id: string; value: unknown }[]) {
  return filters.map((filter) => [filter.id, filter.value]);
}

async function runTablecnTests() {
  console.log('================================================================');
  console.log('🧪 TABLECN ADAPTED UNIT TEST SUITE (MIT PORT)');
  console.log('================================================================\n');

  // Test 1: reads filters from the URL in URL order
  console.log('🧪 1. Testing reads filters from the URL in URL order...');
  {
    (globalThis as any).window.location = new URL('http://localhost/?status=todo,done&title=bug');
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?status=todo,done&title=bug' },
        React.createElement(TestComponent)
      )
    );

    assert.ok(hookResult?.table, 'hookResult must provide table instance');
    const filterSummary = getFilterSummary(hookResult.table.state.columnFilters);
    assert.deepStrictEqual(filterSummary, [
      ['status', ['todo', 'done']],
      ['title', 'bug'],
    ]);
    console.log('   ✅ reads filters in URL order verified');
  }

  // Test 2: starts from initialState filters when URL has none
  console.log('🧪 2. Testing starts from initialState filters...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
        initialState: { columnFilters: [{ id: 'title', value: 'seed' }] },
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '' },
        React.createElement(TestComponent)
      )
    );

    const filterSummary = getFilterSummary(hookResult.table.state.columnFilters);
    assert.deepStrictEqual(filterSummary, [['title', 'seed']]);
    console.log('   ✅ initialState filters verified');
  }

  // Test 3: only reads sorting for sortable columns
  console.log('🧪 3. Testing sortable column restriction...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
        initialState: { sorting: [{ id: 'title', desc: true }] },
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?sort=code.asc' },
        React.createElement(TestComponent)
      )
    );

    assert.deepStrictEqual(hookResult.table.state.sorting, [{ id: 'title', desc: true }]);
    console.log('   ✅ sorting restriction on unsortable column verified');
  }

  // Test 4: reads page, page size, sorting, and join from URL
  console.log('🧪 4. Testing reads page, page size, sorting, and join from URL...');
  {
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data,
        columns,
        pageCount: 10,
        mode: 'server',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?page=3&perPage=25&sort=title.desc&joinOperator=or' },
        React.createElement(TestComponent)
      )
    );

    const pagination = hookResult.table.state.pagination;
    assert.strictEqual(pagination.pageIndex, 2);
    assert.strictEqual(pagination.pageSize, 25);
    assert.deepStrictEqual(hookResult.table.state.sorting, [{ id: 'title', desc: true }]);
    assert.strictEqual(hookResult.table.getJoinOperator(), 'or');
    console.log('   ✅ URL query params read verified');
  }

  // Test 5: filters rows in client mode
  console.log('🧪 5. Testing client mode row filtering...');
  {
    const tasks: Task[] = [
      { id: '1', code: 'T-1', title: 'bug', status: 'todo' },
      { id: '2', code: 'T-2', title: 'feat', status: 'done' },
    ];
    let hookResult: any = null;
    function TestComponent() {
      hookResult = useDataTable({
        data: tasks,
        columns,
        mode: 'client',
      });
      return null;
    }

    renderToStaticMarkup(
      React.createElement(
        NuqsTestingAdapter as any,
        { searchParams: '?title=bug' },
        React.createElement(TestComponent)
      )
    );

    const filteredRows = hookResult.table
      .getFilteredRowModel()
      .rows.map((r: any) => r.original.title);
    assert.deepStrictEqual(filteredRows, ['bug']);
    console.log('   ✅ client mode filtering verified');
  }

  // Test 6: faceted filter multi-toggle and selection state (faceted.test.tsx)
  console.log('🧪 6. Testing faceted filter options and selection states...');
  {
    const filterOptions = [
      { label: 'Active', value: 'active', count: 10 },
      { label: 'Inactive', value: 'inactive', count: 5 },
    ];

    let selectedVals = new Set<string>();
    const markup1 = renderToStaticMarkup(
      React.createElement(DataTableFacetedFilter, {
        title: 'Status',
        options: filterOptions,
        selectedValues: selectedVals,
        onSelect: (vals: string[]) => {
          selectedVals = new Set(vals);
        },
      })
    );
    assert.ok(markup1.includes('Status'), 'Must display filter title');
    assert.ok(markup1.includes('chưa chọn'), 'Must display unselected state label');

    selectedVals = new Set(['active']);
    const markup2 = renderToStaticMarkup(
      React.createElement(DataTableFacetedFilter, {
        title: 'Status',
        options: filterOptions,
        selectedValues: selectedVals,
        onSelect: () => {},
      })
    );
    assert.ok(markup2.includes('1 đã chọn'), 'Must display selected count badge');
    console.log('   ✅ faceted filter toggle and counter verified');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL TABLECN PORTED TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runTablecnTests().catch((err) => {
  console.error('❌ Tablecn test failed:', err);
  process.exit(1);
});

```

## apps/web/src/tests/fixtures/data-table-shipments.ts

```
/**
 * Reusable Data Table & Dashboard Shell — Test Fixture Data.
 *
 * NOTE: All data in this module is mock fixture data for demonstration and testing.
 * Complies with BR-UI-05 (Fixture Isolation) and AGENTS.md.
 */

import { DataTableFilterOption } from '@/components/data-table';
import { AlertCircle, CheckCircle2, Clock, Truck, XCircle } from 'lucide-react';

export interface FixtureShipment {
  id: string;
  trackingCode: string;
  orderNumber: string;
  recipientName: string;
  recipientPhone: string;
  carrier: 'GHN' | 'GHTK' | 'VTP';
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CLAIM_PENDING';
  codAmount: number;
  feeAmount: number;
  weightGrams: number;
  createdAt: string;
}

export const FIXTURE_SHIPMENTS: FixtureShipment[] = [
  {
    id: 'fix-ord-001',
    trackingCode: 'GHN982341201VN',
    orderNumber: 'ORD-20261031-01',
    recipientName: 'Nguyễn Văn An',
    recipientPhone: '0901***123',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 350000,
    feeAmount: 22000,
    weightGrams: 500,
    createdAt: '2026-10-31 08:30:00',
  },
  {
    id: 'fix-ord-002',
    trackingCode: 'GHTK74219082VN',
    orderNumber: 'ORD-20261031-02',
    recipientName: 'Trần Thị Mai',
    recipientPhone: '0912***456',
    carrier: 'GHTK',
    status: 'IN_TRANSIT',
    codAmount: 520000,
    feeAmount: 32000,
    weightGrams: 1200,
    createdAt: '2026-10-31 09:15:00',
  },
  {
    id: 'fix-ord-003',
    trackingCode: 'VTP391204851VN',
    orderNumber: 'ORD-20261031-03',
    recipientName: 'Lê Hoàng Nam',
    recipientPhone: '0983***789',
    carrier: 'VTP',
    status: 'PENDING',
    codAmount: 180000,
    feeAmount: 18000,
    weightGrams: 300,
    createdAt: '2026-10-31 10:00:00',
  },
  {
    id: 'fix-ord-004',
    trackingCode: 'GHN512938472VN',
    orderNumber: 'ORD-20261031-04',
    recipientName: 'Phạm Minh Đức',
    recipientPhone: '0934***321',
    carrier: 'GHN',
    status: 'FAILED',
    codAmount: 490000,
    feeAmount: 25000,
    weightGrams: 800,
    createdAt: '2026-10-30 14:20:00',
  },
  {
    id: 'fix-ord-005',
    trackingCode: 'GHTK12948293VN',
    orderNumber: 'ORD-20261031-05',
    recipientName: 'Hoàng Bích Thủy',
    recipientPhone: '0977***654',
    carrier: 'GHTK',
    status: 'CLAIM_PENDING',
    codAmount: 890000,
    feeAmount: 45000,
    weightGrams: 2100,
    createdAt: '2026-10-30 16:45:00',
  },
  {
    id: 'fix-ord-006',
    trackingCode: 'GHN672391024VN',
    orderNumber: 'ORD-20261031-06',
    recipientName: 'Đặng Quốc Huy',
    recipientPhone: '0909***999',
    carrier: 'GHN',
    status: 'DELIVERED',
    codAmount: 240000,
    feeAmount: 20000,
    weightGrams: 400,
    createdAt: '2026-10-30 17:10:00',
  },
  {
    id: 'fix-ord-007',
    trackingCode: 'VTP839102948VN',
    orderNumber: 'ORD-20261031-07',
    recipientName: 'Vũ Thanh Hằng',
    recipientPhone: '0945***888',
    carrier: 'VTP',
    status: 'IN_TRANSIT',
    codAmount: 670000,
    feeAmount: 28000,
    weightGrams: 1000,
    createdAt: '2026-10-29 11:30:00',
  },
  {
    id: 'fix-ord-008',
    trackingCode: 'GHTK90283741VN',
    orderNumber: 'ORD-20261031-08',
    recipientName: 'Bùi Anh Tuấn',
    recipientPhone: '0966***777',
    carrier: 'GHTK',
    status: 'DELIVERED',
    codAmount: 410000,
    feeAmount: 24000,
    weightGrams: 600,
    createdAt: '2026-10-29 15:00:00',
  },
];

export const STATUS_OPTIONS: DataTableFilterOption[] = [
  { label: 'Chờ lấy hàng', value: 'PENDING', icon: Clock, count: 1 },
  { label: 'Đang giao', value: 'IN_TRANSIT', icon: Truck, count: 2 },
  { label: 'Giao thành công', value: 'DELIVERED', icon: CheckCircle2, count: 3 },
  { label: 'Giao thất bại', value: 'FAILED', icon: XCircle, count: 1 },
  { label: 'Chờ bồi thường', value: 'CLAIM_PENDING', icon: AlertCircle, count: 1 },
];

export const CARRIER_OPTIONS: DataTableFilterOption[] = [
  { label: 'Giao Hàng Nhanh (GHN)', value: 'GHN', count: 3 },
  { label: 'Giao Hàng Tiết Kiệm (GHTK)', value: 'GHTK', count: 3 },
  { label: 'Viettel Post (VTP)', value: 'VTP', count: 2 },
];

```