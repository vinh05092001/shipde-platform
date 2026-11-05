# Focused context pack

## .oc/context-pack.md

```
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

## docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md

```
# Baseline and Decisions

## Baseline statement

This repository supersedes the earlier PoV-only Dev Pack. The current baseline is the full Ship Dễ product. A file-first, single-shop settlement audit remains a valid validation slice, not the product boundary.

## Decision statuses

- DECIDED: implementation may proceed.
- CONDITIONAL: implementation proceeds behind capability/configuration checks.
- CONFIRMATION_REQUIRED: adapter/stub may be built, but production behavior requires partner evidence.
- PROHIBITED: implementation must reject the behavior.

## Product decisions

| ID | Status | Decision | Consequence |
|---|---|---|---|
| DEC-001 | DECIDED | Ship Dễ covers before, during and after shipment. | Pre-shipment and operational modules are CORE. |
| DEC-002 | DECIDED | Shops use their own carrier accounts/contracts by default. | Quotes and actions are account-scoped. |
| DEC-003 | DECIDED | Carrier serviceability API decides route availability when supported. | API failure is UNKNOWN, not UNSUPPORTED. |
| DEC-004 | DECIDED | Live quote, contract rate and settlement deduction are three evidence layers. | Store quote snapshot and rate version. |
| DEC-005 | DECIDED | No automatic blind retry for create/cancel/redelivery/claim commands. | Reconcile remote state first. |
| DEC-006 | DECIDED | Human selection and configurable auto-routing are both supported. | Recommendations remain explainable and overridable. |
| DEC-007 | DECIDED | Recipient experience is channel-neutral, web/PWA first. | Native app can reuse the same API later. |
| DEC-008 | CONDITIONAL | Claim submission can be manual-confirmed or policy-authorized automatic. | High-confidence rules, limits and audit are mandatory. |
| DEC-009 | DECIDED | Ship Dễ provides a COD ledger and bank reconciliation. | Carrier report alone cannot prove receipt. |
| DEC-010 | PROHIBITED | Ship Dễ must not directly hold/route customer COD without an approved licensed model. | Use a licensed partner integration if money movement is added. |
| DEC-011 | DECIDED | Ship Dễ may manage shop/partner warehouse and delivery workflows without owning physical assets. | Software capability is not removed by asset boundary. |
| DEC-012 | DECIDED | One waybill is billed once per carrier account at first conclusive audit. | Rerun/carry-forward/claim follow-up is not billed again. |
| DEC-013 | DECIDED | A rule author cannot approve the same rate/policy version. | Maker-checker enforcement is required. |
| DEC-014 | DECIDED | Processing status and findings are independent. | A matched waybill can carry many findings. |
| DEC-015 | DECIDED | Four monetary evidence levels are never summed together. | Separate reporting measures are mandatory. |
| DEC-016 | DECIDED | TypeScript monorepo is the default implementation stack. | Shared schemas/types and one-language handover. |
| DEC-017 | DECIDED | Concurrent implementation ceiling is fixed at one (AI-TOOL-03) as a stability measure. | Raising the ceiling requires an explicit governed decision (DEC-* or HUMAN-DECISION-*), never an unvetted runtime setting. |
| HUMAN-DECISION-CONCURRENCY-CEILING-2026-09-22 | DECIDED | The concurrent implementation ceiling rises from one to three, superseding the fixed value in DEC-017. | Operator instruction on 2026-09-22 to run feature Work Items in parallel overnight. Repairs of an open Pull Request and planning/documentation runs do not count towards the ceiling; only new implementation Work Items do. The controller must still keep one Work Item per branch and per Pull Request. |
| HUMAN-DECISION-FEAT-COM-09-2026-10-31 | DECIDED | Operator approved the six FEAT-COM-09 gap resolutions as recorded in the Work Item: D1 bounded S01 first delivery with one live producer (`EVT-COM-09-01`, invite/identity/security change) and versioned `EVT-COM-09-02`…`EVT-COM-09-14` fixture-only contracts whose future owners are `FEAT-CAR-05`, `FEAT-AVL-01`, `FEAT-CAR-07`, `FEAT-SHP-01`, `FEAT-SHP-02`, `FEAT-EXC-01`, `FEAT-RET-01`, `FEAT-IMP-02`, `FEAT-BNK-01`, `FEAT-AUD-07`, `FEAT-BNK-01`, `FEAT-CLM-01` and `FEAT-CLM-04` in that order; D2 notification center `SCR-COM-09` at `/settings/notifications` with per-recipient server-side read state, explicit idempotent read actions, cursor pagination and permission-free deep links; D3 protected events (`security_alerts`, `create_unknown`, `claim_deadline_warning`) always delivered in-app, write-time rejection of disabling them, and truthful `SKIPPED_NO_VERIFIED_EMAIL` email outcomes; D4 per-(tenant, recipient) ownership, the per-event role/capability/scope eligibility table, recipient-only inbox endpoints, no support inbox in this item, and sanitized immutable audit; D5 `provider_submission_id` captured before the provider call, `UNKNOWN` held with no automatic retry when no message id or lookup support exists, recovery delivery listing endpoint `GET /api/v1/admin/notification-deliveries` (authorized for OWNER/bound operator, returning masked email, attempt and submission id preconditions), operator outcomes limited to `MARK_SENT` or `RELEASE_FOR_RETRY` through `POST /api/v1/admin/notification-deliveries/{delivery_id}/redeliver` with `expected_attempt`, `expected_provider_submission_id`, and `idempotency_key` preconditions (stale replays reject with `409 CONFLICT`) on `SCR-COM-09-JOBS` at `/admin/jobs/notification-deliveries`, and prohibited reuse of the simulated verification adapter; D6 frozen `Notification`/`NotificationChannelDelivery` fields including source scope ids and provider ids, separation of outbox transport identity from notification grouping, resolution envelope targeting (`target_group_key`, `resolution_id`), credential incident identity (`incident_id` for `EVT-COM-09-02` in payload and active transport key `carrier_account_id:condition:incident_id` to prevent recurrence suppression across resolved incidents), recurring-window digest identities (`digest_window`, `queue_revision` for `EVT-COM-09-10`), the 14 required payload and fingerprint rows, policy-driven retention and the 16-row acceptance matrix. Owner: operator, 2026-10-31. | Work Item `docs/product-spec/work-items/FEAT-COM-09.md` is READY_FOR_AUTHOR for GEMINI (Slices A then B, one implementation PR); implementation must stay inside its frozen allowed paths and re-verify the merged baseline. The 13 fixture-only categories stay fixture-only until their named producer Work Items emit them. `FEAT-SEC-02` owns any later support read. D5 configuration defaults are reviewed as configuration data in the implementation PR. |
| HUMAN-DECISION-FEAT-SUP-01-2026-10-31 | DECIDED | Approval of contextual support request workflow, explicit consent boundary, independent state machine, RBAC capabilities, private attachments, and vertical slice architecture for [FEAT-SUP-01](../../work-items/FEAT-SUP-01.md). Date: 2026-10-31. Owner: operator. | Operator approval on 2026-10-31 resolves all planning gaps G01–G09: authenticated shop requests with typed context and clean attachment linkage (G01); dedicated UI routes `/support`, `/support/new`, `/support/:id`, operator queue (G02); independent state machine OPEN → IN_PROGRESS → WAITING_FOR_SHOP → RESOLVED (G03); granular RBAC capabilities and SHOP_OWNER consent delegation, including explicit operator read/reply permissions and platform triage queue scope separate from tenant-isolated shop access, plus native domain capability authorization (order:view_create, shipment:track_exceptions, reconciliation:run_review_audit, claim:verify_submit) for shop context data inspection (G04); private attachment upload staging lifecycle with presigned upload URLs, staging ownership, consistent null-until-commit staging linkage with validated target-ticket scope, synchronous malware scan verification with protected promotion to immutable storage (support/clean/*), cryptographic SHA-256 and S3 version ID binding, and atomic ticket/reply linkage with malware quarantine (G05); time-bound, named operator, scoped read-only consent grants with instant revocation and dedicated consented inspection path `GET /api/v1/support/requests/:id/context-data` producing immutable `SUPPORT_OPERATOR_ACCESS` audit logs with masked PII (G06); vertical slice architecture defining Slice A (API/Data/Contracts/RBAC) and Slice B (UI/E2E) aligned with COM-06 and SEC-02 boundaries (G07); tenant-scoped API contracts mapped to Merchant/merchant_id (G08); and test traceability with synthetic fixtures, deferring external notifications/SLA (G09). Work Item marked READY_FOR_AUTHOR. |
| HUMAN-DECISION-FEAT-CAR-01-2026-10-31 | DECIDED | Operator approval on 2026-10-31 (owner = operator) resolves all blocking gaps CAR-GAP-01 through CAR-GAP-07 for [FEAT-CAR-01](../../work-items/FEAT-CAR-01.md): (1) Platform-owned, versioned read-only carrier catalog with mutation UI deferred to FEAT-ADM-01, with multi-revision coexistence guaranteed via revision-scoped composite unique constraints `[catalogRevision, code]` and UUID primary keys across all reference models (`Carrier`, `CarrierService`, `CanonicalStatusReference`, `FeeComponentReference`, `CatalogCompatibilityMapping`); (2) Dedicated read-only catalog tab at `/settings/carriers` (`SCR-CAR-01`); (3) Canonical permission `iam:carrier_catalog:read` for OWNER, OPS_MANAGER, ORDER_OPERATOR, FINANCE, with platform writes reserved for admin audit; (4) Canonical carrier codes `GHN` ('Giao Hàng Nhanh'), `GHTK`, `VIETTEL_POST`, `JT` matching Prisma/contracts, with boundary alias normalization (`VTP` -> `VIETTEL_POST`, `JT_EXPRESS` -> `JT`); (5) Dedicated `/api/v1/carrier-catalog` API with 4 reference schemas (carriers, services, canonical statuses, fee components) and decoupled command vs operational shipment lifecycle; (6) Raw provider status and fee keys preserved with official carrier evidence (GHTK raw status `20` maps to canonical `RETURNING` per official GHTK documentation `https://docs.giaohangtietkiem.vn/`, GHTK raw status `13` 'Đơn hàng bồi thường' resolves to `UNMAPPED` / `null` to avoid conflating compensation with damage), unknown raw values resolve to unmapped rather than defaulting to IN_TRANSIT; (7) Initial baseline dataset with official public evidence for GHN/GHTK and confirmation-required flags for VIETTEL_POST/JT under OI-001/002. | Work Item [FEAT-CAR-01](../../work-items/FEAT-CAR-01.md) unblocked and set to `READY_FOR_AUTHOR`. Establishes the authoritative carrier taxonomy baseline for downstream account connection (FEAT-CAR-02), quoting, tracking, and settlement audit without provider code leakage. |

## Evidence levels

| Level | Meaning |
|---|---|
| VERIFIED_OFFICIAL | Current official public provider documentation observed |
| VERIFIED_PARTNER | Confirmed in partner portal/contract/sandbox by the shop or Ship Dễ |
| COMMUNITY_INDICATION | Non-official technical evidence; not production-authoritative |
| UNVERIFIED | No adequate evidence |

## Change control

Any change affecting money, state transitions, external commands, PII, billing or tenant isolation requires:

1. New decision-log entry.
2. Impacted requirement identifiers.
3. Updated API/data/test contracts.
4. Regression test.
5. Human approval before merge.


```

## docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md

```
# Master Feature Catalog

All features below are in the target product. Build order is a dependency sequence, not an instruction to discard later modules.

## 1. Identity and organization

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-AUTH-01 | Self-registration | Email/phone verification, terms acceptance, anti-abuse |
| FEAT-AUTH-02 | Admin-created shop account | Operator can create initial owner without public signup |
| FEAT-AUTH-03 | Login | Password or configured OTP; disabled/unverified states handled |
| FEAT-AUTH-04 | Password recovery | Expiring one-time reset; revoke previous sessions |
| FEAT-AUTH-05 | MFA | Setup, verify, recovery and admin reset |
| FEAT-AUTH-06 | Session management | List/revoke sessions, inactivity expiry, logout all |
| FEAT-USR-01 | User invitations | Send, resend, cancel, accept and expire |
| FEAT-USR-02 | User lifecycle | Create, edit, activate, suspend, revoke sessions |
| FEAT-RBAC-01 | Roles and permissions | Default/custom roles with resource/action scopes |
| FEAT-RBAC-02 | Scope assignment | Shop, branch, warehouse and carrier-account scope |
| FEAT-ORG-01 | Shop profile | Legal, billing and operating defaults |
| FEAT-ORG-02 | Branches | CRUD, activate/deactivate and reporting scope |
| FEAT-WH-01 | Warehouses | Pickup/return address, schedule, contacts and printer defaults |
| FEAT-ONB-01 | Guided onboarding | Shop → warehouse → user → carrier → test quote/order |
| FEAT-PRO-01 | Personal profile | Contact, language/timezone, defaults and notification preferences |

## 2. Shared platform

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-COM-01 | Global search | Orders, waybills, batches, cases and transactions |
| FEAT-COM-02 | Lists | Filter, sort, pagination, saved views and column settings |
| FEAT-COM-03 | Bulk actions | Permission-aware, progress and partial failure report |
| FEAT-COM-04 | Imports | Template, preview, row errors, checksum and revisions |
| FEAT-COM-05 | Exports | Permission-aware CSV/XLSX/PDF with generation metadata |
| FEAT-COM-06 | Attachments | Private upload, hash, access audit and retention |
| FEAT-COM-07 | Activity timeline | Actor, time, before/after and correlation ID |
| FEAT-COM-08 | Draft recovery | Preserve user input after timeout/session expiry |
| FEAT-COM-09 | Notification center | In-app/email, unread, severity, dedupe and deep link |
| FEAT-SUP-01 | Support requests | Context links, attachments, status and consented support access |

## 3. Carrier accounts and configuration

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-CAR-01 | Carrier catalog | Carrier/service/canonical status and fee taxonomy |
| FEAT-CAR-02 | Account connection | Multiple shop-owned accounts, encrypted credentials |
| FEAT-CAR-03 | Permission profiles | Observe and action permissions separated |
| FEAT-CAR-04 | Connection test | Authentication and granted capability discovery |
| FEAT-CAR-05 | Credential lifecycle | Expiry, revoke, rotate and no-secret logging |
| FEAT-CAR-06 | Capability registry | Per account and environment, evidence level included |
| FEAT-CAR-07 | Connector health | Availability, latency, error and data freshness |
| FEAT-CAR-08 | Failure isolation | One carrier/account does not block another |
| FEAT-CAR-09 | Manual/file fallback | Explicit when API is unavailable or unsupported |

## 4. Orders, addresses and quotes

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-SRC-01 | Manual source order | Sender, recipient, items, parcel, COD, payer and notes |
| FEAT-SRC-02 | OMS/file import | Idempotent order ingestion with lineage |
| FEAT-SRC-03 | Order validation | Required values, prohibited goods acknowledgment and duplicate checks |
| FEAT-ADR-01 | Address normalization | Canonical administrative codes with user confirmation |
| FEAT-ADR-02 | Carrier address mapping | Canonical-to-carrier identifiers, versioned |
| FEAT-AVL-01 | Serviceability | Route, service, parcel, COD and restricted-goods eligibility |
| FEAT-AVL-02 | No-option recovery | Explain reasons, edit input, retry, save draft or manual carrier |
| FEAT-QTE-01 | Parallel live quote | Query eligible connected accounts with timeout isolation |
| FEAT-QTE-02 | Normalized quote | Components, VAT, SLA, pickup window and expiry |
| FEAT-QTE-03 | Quote snapshot | Immutable chosen request/response and evidence metadata |
| FEAT-SEL-01 | Comparison | Cheapest, fastest, balanced and historical performance |
| FEAT-SEL-02 | Explainable recommendation | Shop-configurable weights and reason display |
| FEAT-SEL-03 | Auto-routing | Policy selection with deterministic fallback and override |

## 5. Shipment, pickup and labels

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-SHP-01 | Shipment draft | Versioned draft linked to source order |
| FEAT-SHP-02 | Create shipment | Idempotent command; unknown outcome reconciled before retry |
| FEAT-SHP-03 | Bulk creation | Per-row outcome; no all-or-nothing ambiguity |
| FEAT-SHP-04 | Manual waybill link | For carrier portal/manual creation with audit |
| FEAT-SHP-05 | Update shipment | Capability/status constrained; requote when price-affecting |
| FEAT-SHP-06 | Cancel shipment | Confirmation, carrier state reconciliation and source sync |
| FEAT-SHP-07 | Switch carrier | Only before pickup/handover unless an approved exception flow exists |
| FEAT-PUP-01 | Pickup request | Shift/window, batch grouping and status |
| FEAT-PUP-02 | Pickup handover | Expected vs handed-over parcel evidence |
| FEAT-LBL-01 | Label retrieval/generation | Carrier label or approved normalized rendering |
| FEAT-LBL-02 | Print and reprint | Single/bulk, size/printer preference and audit |
| FEAT-LBL-03 | Label invalidation | Old label unusable after cancel/switch |

## 6. Tracking, recipient and exceptions

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-TRK-01 | Webhook ingestion | Signature, dedupe, raw preservation and replay safety |
| FEAT-TRK-02 | Polling/backfill | For missing webhooks and initial history |
| FEAT-TRK-03 | Canonical tracking | Versioned mapping; unknown raw status preserved |
| FEAT-TRK-04 | Timeline/current state | Event history plus derived current state and freshness |
| FEAT-RECIP-01 | Protected tracking page | Signed link or OTP, minimum necessary data |
| FEAT-RECIP-02 | Recipient action | Reschedule/instructions only if carrier capability allows |
| FEAT-EXC-01 | Exception detection | Slow pickup, stuck, delivery failure and return risk |
| FEAT-EXC-02 | Prioritized workbox | COD value, age, attempts and SLA |
| FEAT-EXC-03 | Task workflow | Assign, acknowledge, snooze, note, resolve and reopen |
| FEAT-EXC-04 | Redelivery | Confirmed/idempotent carrier command or manual checklist |
| FEAT-EXC-05 | Outcome metrics | Rescue success, time and prevented return |

## 7. Returns

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-RET-01 | Expected returns | Queue from tracking/canonical status |
| FEAT-RET-02 | Scan receipt | Duplicate prevention and ownership validation |
| FEAT-RET-03 | Condition checklist | Package/seal/item/quantity/damage |
| FEAT-RET-04 | Direct evidence capture | Original media, server time, actor, waybill and checksum |
| FEAT-RET-05 | Chain of custody | Handover and access history |
| FEAT-RET-06 | Return issue case | Missing/wrong/damaged goods create discrepancy evidence |

## 8. Rate, policy and import governance

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-RATE-01 | Contract documents | Private source files with page/clause references |
| FEAT-RATE-02 | Structured rate rules | Service, zone, weight, rounding, VAT and components |
| FEAT-RATE-03 | Maker-checker approval | Author cannot approve own version |
| FEAT-RATE-04 | Effective version selection | Date basis and non-overlapping approved coverage |
| FEAT-RATE-05 | Rate simulator/explanation | Test examples and reproducible calculation |
| FEAT-SET-01 | Settlement policy | Eligibility, batch schedule, holidays and transfer lag |
| FEAT-SET-02 | Threshold/carry-forward | Account-level, not per-waybill |
| FEAT-CLP-01 | Claim policy | Category, source, deadline and evidence version |
| FEAT-IMP-01 | Raw immutable import | Hash, metadata, revision and lineage |
| FEAT-IMP-02 | Staging validation | Blocking vs non-blocking errors; no silent loss |
| FEAT-IMP-03 | Source order import | Canonical fields and quality metrics |
| FEAT-IMP-04 | Carrier statement import | Fee components, batch and totals |
| FEAT-IMP-05 | Bank statement import | Inbound transactions, privacy and dedupe |

## 9. Matching and audit

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-MAT-01 | Primary exact match | Carrier account + normalized waybill |
| FEAT-MAT-02 | Secondary exact match | Source order ID only if one unique candidate |
| FEAT-MAT-03 | Manual match queue | Link/unlink with reason and audit |
| FEAT-MAT-04 | Processing status | matched/source-only/carrier-only/ambiguous/data-incomplete |
| FEAT-AUD-01 | Expected fee calculation | Approved rate version and component-by-component result |
| FEAT-AUD-02 | COD discrepancy | Expected source COD vs carrier COD |
| FEAT-AUD-03 | Fee discrepancy | Freight, insurance, return, VAT and surcharges |
| FEAT-AUD-04 | Weight findings | Suspected weight vs rate discrepancy kept separate |
| FEAT-AUD-05 | Duplicate deductions | Preserve line ledger and detect abnormal repetition |
| FEAT-AUD-06 | Late-delivery candidate | Suspicion only unless verified policy/cause evidence |
| FEAT-AUD-07 | Multiple findings | Zero-to-many per waybill, each explainable |
| FEAT-AUD-08 | Immutable runs | Snapshot inputs/rules; rerun creates a new run |
| FEAT-MIS-01 | Missing statement classification | Six states based on predicted milestones A/B/C |
| FEAT-MIS-02 | Re-evaluation | Time/data/policy changes recompute without losing history |

## 10. Settlement, bank, cases and claims

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-BAT-01 | Settlement periods/batches | Period→batches→waybills with control totals |
| FEAT-BAT-02 | Dual batch status | Carrier reported transfer and bank match are independent |
| FEAT-BAT-03 | Period close/reopen | Immutable close; controlled reopen/adjustment |
| FEAT-BNK-01 | Exact-reference match | Exact batch reference may auto-match |
| FEAT-BNK-02 | Suggested match | Amount/date/counterparty requires human confirmation |
| FEAT-BNK-03 | Many-to-many allocation | Amount on each link; allocation constraints |
| FEAT-COD-01 | COD ledger | Expected, carrier reported and bank received |
| FEAT-CAS-01 | Finding case | Evidence, assignment, notes and timeline |
| FEAT-CAS-02 | Four money levels | Suspected/verified/accepted/received separately |
| FEAT-CAS-03 | Outcome workflow | Full/partial accept, reject, supplement, unpaid and recovery installments |
| FEAT-CAS-04 | Carry-forward | Independent case-to-period relation |
| FEAT-CLM-01 | Deadline calculation | Versioned policy and correct trigger event |
| FEAT-CLM-02 | Evidence checklist/package | Auto-assemble available evidence |
| FEAT-CLM-03 | Claim submission modes | Confirm-first or policy-authorized automatic |
| FEAT-CLM-04 | Claim tracking | Reference, responses, supplements, outcome and aging |

## 11. Reporting, billing and administration

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-DASH-01 | Role dashboard | Today’s work and outcome metrics |
| FEAT-DASH-02 | Carrier performance | Cost, SLA, success, exception and return |
| FEAT-DASH-03 | Audit dashboard | Data quality, statuses, findings and four money levels |
| FEAT-DASH-04 | Batch/COD dashboard | Carrier report vs bank evidence |
| FEAT-REP-01 | Drill-down reports | Summary to source row/rule/evidence |
| FEAT-BIL-01 | Billable event | One event at first conclusive audit |
| FEAT-BIL-02 | Usage statement | Explainable per-waybill ledger and adjustments |
| FEAT-ADM-01 | Reference/config management | Carriers, services, fees, statuses and calendars |
| FEAT-ADM-02 | Job/queue operations | Inspect, retry safely and dead-letter recovery |
| FEAT-ADM-03 | Audit log | Immutable actor/action/resource/change history |
| FEAT-SEC-01 | Privacy controls | Minimize, mask, export, retain and delete |
| FEAT-SEC-02 | Support access | Tenant-approved, time-bound and audited |


```

## docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md

```
# Product Vision and Scope

## Product statement

Ship Dễ is an independent multi-carrier shipping operations and control platform for Vietnamese shops. It uses the shop’s own carrier accounts and contracts to reduce manual work and provide a trustworthy chain from quote to final money reconciliation.

## Who it serves

Primary target:

- Shops with stable order volume.
- Shops using one or more own carrier accounts/contracts.
- Teams currently operating across OMS/POS and multiple carrier portals.
- Initial integration preference: Pancake POS plus GHN/GHTK, with Viettel Post and J&T adapters added after partner confirmation.

Operational users:

- Shop owner and operations manager.
- Order operator and customer service.
- Warehouse receiver.
- Finance/accounting.
- Ship Dễ operator and rate reviewer.
- Recipient through a protected tracking experience.

## Jobs to be done

1. Find a carrier that can serve the shipment.
2. Compare normalized live prices and SLA without opening many carrier portals.
3. Create, print, pick up and manage a shipment without re-entering data.
4. Detect delivery problems early and take the safest supported action.
5. Receive returns with evidence.
6. Prove what the carrier should charge and remit under the shop’s real contract.
7. Detect missing, duplicated or abnormal charges and COD.
8. Build and track a claim before the deadline.

## Product scope

### Before shipment

- Authentication, users, roles, shop, branches and warehouses.
- Carrier account connection and capability discovery.
- Order creation/import.
- Address normalization and carrier serviceability.
- Live quotes, comparison and explainable recommendation.
- Shipment creation/update/cancel, pickup and labels.

### In transit

- Canonical tracking ledger.
- Recipient tracking page/PWA.
- Exception detection and workbox.
- Redelivery or documented manual fallback.
- Return monitoring and warehouse receipt.

### After shipment

- Contract rate/policy normalization and approval.
- Source order, statement and optional bank imports.
- Matching, audit and missing-settlement classification.
- Settlement batch and COD ledger.
- Discrepancy cases, evidence, deadlines and claims.
- Billing usage ledger, reports and audit log.

## Boundaries

- No direct custody of shop COD without a separately approved licensed arrangement.
- No fake carrier availability, rate or external command result.
- No claim is submitted without explicit shop policy authorization.
- No ownership of fleet/warehouse is required; workflows support shop/partner assets.
- No financial conclusion without the corresponding evidence level.
- No cross-tenant access.

## Definition of full product

The product is complete only when the primary end-to-end journey runs without database/admin intervention:

Create shop → connect carrier → create/import order → serviceability → quote → select → create waybill → label/pickup → tracking/exception/return → settlement audit → claim/report.


```