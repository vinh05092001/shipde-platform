# TASK-AI-155 — Reusable server-driven data table and dashboard shell

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-155` |
| Feature ID | `FEAT-COM-02` |
| Status | `IN_PROGRESS` |
| Delivery order | `272` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `apps/web/src/components/data-table/**`; `apps/web/src/components/dashboard-shell/**`; `apps/web/src/app/storybook/page.tsx`; `apps/web/src/tests/data-table-dashboard-shell.test.ts`; `apps/web/package.json`; `docs/product-spec/work-items/TASK-AI-155.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-155-data-table-dashboard-shell` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Provide `apps/web` with one canonical, reusable server-driven data table (`ServerDataTable` + `useDataTable`) and one reusable operational dashboard shell (`DashboardShell`, `AppSidebar`, `PageHeader`, `DashboardBreadcrumbs`, `DashboardUserNav`) so all downstream operational and financial screens share URL-synchronized sorting, text filtering, multi-select faceted filtering, pagination, keyboard navigation, and complete Vietnamese UI state coverage (`loading`, `empty`, `error`, `forbidden`, `validation`, `partial`, `success`) without duplicating table or layout chrome.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — UI quality and operational console foundation
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — Dense operational console for Vietnamese online shops
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-COM-02` (Lists: server-driven filter, sort, pagination, saved view and bulk action bar)
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Visual foundation (restrained palette, WCAG AA contrast, 8px spacing, sticky headers, compact/comfortable density, horizontal overflow), Canonical components (App shell, side navigation, top context selector, Data table, filter bar, bulk action bar, skeleton/empty/forbidden/error states), Content rules, and Accessibility rules
- `apps/web/AGENTS.md` — Mandatory UI state gates and Next.js App Router rules
- Upstream MIT reference 1: `sadmann7/shadcn-table` (MIT License, Copyright (c) 2023 Sadman Sakib)
- Upstream MIT reference 2: `Kiranism/next-shadcn-dashboard-starter` (MIT License, Copyright (c) 2024 Kiran; Clerk omitted)
- Business rules: `BR-UI-155-01`, `BR-UI-155-02`, `BR-UI-155-03`, `BR-UI-155-04`, `BR-UI-155-05`
- Acceptance criteria: `AC-AI-155-01`, `AC-AI-155-02`, `AC-AI-155-03`, `AC-AI-155-04`, `AC-AI-155-05`, `AC-AI-155-06`, `AC-AI-155-07`

## Preconditions and dependencies

- Operator approval granted on `2026-10-31` for porting `sadmann7/shadcn-table` (MIT) and `Kiranism/next-shadcn-dashboard-starter` (MIT, no Clerk) into `apps/web/src/components`.
- `TASK-FOUND-04` UI quality gates (`verify-a11y.ts`, `verify-visual.ts`, `verify-perf.ts`) are merged on `origin/main`.
- Existing feature screens remain untouched in this Pull Request.

## Ambiguity and clarification markers

None. All requirements, upstream MIT sources, state coverage rules, and file boundaries are explicitly specified.

## Author boundary

`GEMINI` is assigned because this Work Item introduces reusable UI architecture across `apps/web/src/components`, URL search parameter state synchronization, WCAG AA keyboard accessibility, and a fixture-backed Storybook verification route. Prohibited: modifying existing feature screens, installing Clerk or non-MIT/Apache third-party code, or touching gate configs, allowlists, baselines, semgrep rules, or `.github/`.

## Slice sizing rule

Single vertical UI foundation delivery scoped strictly to the reusable `data-table` and `dashboard-shell` component packages, one `/storybook` fixture showcase page, unit/state tests, and Work Item documentation without touching any existing feature screen.

## In scope

- Port `sadmann7/shadcn-table` (MIT) server-driven data table components and hooks into `apps/web/src/components/data-table/` (`useDataTable`, `parseSortParam`, `serializeSortParam`, `parsePaginationParams`, `parseFilterParams`, `createQueryString`, `applyServerDataTableQuery`, `ServerDataTable`, `DataTableColumnHeader`, `DataTableToolbar`, `DataTableFacetedFilter`, `DataTableViewOptions`, `DataTablePagination`) with MIT license notice retained.
- Port `Kiranism/next-shadcn-dashboard-starter` (MIT, no Clerk) layout, collapsible sidebar, breadcrumbs, user menu, top context selector, and page header patterns into `apps/web/src/components/dashboard-shell/` (`DashboardShell`, `AppSidebar`, `PageHeader`, `DashboardBreadcrumbs`, `DashboardUserNav`) with MIT license notice retained.
- Full Vietnamese labels and `DESIGN-SYSTEM-UX-RULES.md` compliance (`loading`, `empty`, `error`, `forbidden`, `validation`, `partial`, `success` states, sticky header, compact/comfortable density toggle, VND integer tabular numerals, and actionable recovery buttons).
- Keyboard accessibility (skip-to-content link, `aria-sort`, `aria-current="page"`, `aria-live="polite"`, `ArrowUp`/`ArrowDown`/`Home`/`End` row and sidebar navigation, `Enter` activation, `Space` selection, `Escape` popover dismissal, `Ctrl+B` sidebar toggle).
- One Storybook/test showcase page (`apps/web/src/app/storybook/page.tsx`) using fixture data explicitly marked as `FIXTURE` both in code (`isFixture: true`, `FIXTURE-` IDs) and in a prominent visual banner.
- Unit and component state test suite in `apps/web/src/tests/data-table-dashboard-shell.test.ts`.

## Out of scope

- Modifying any existing feature screen (`apps/web/src/app/page.tsx`, `ShipmentListTab.tsx`, `ReconciliationTab.tsx`, etc.).
- Installing Clerk or any new npm dependencies.
- Modifying gate configs, allowlists, baselines, semgrep rules, or `.github/`.

## Business rules and edge cases

- `BR-UI-155-01` (URL search param authority): Sorting (`sort=<col>.<asc|desc>`), pagination (`page`, `per_page`), text search, and multi-select faceted filters (`<col>=<v1>.<v2>`) synchronize deterministically with URL search params; changing any filter or page size resets `page` to `1`.
- `BR-UI-155-02` (Fail-safe parameter validation): Malformed or disallowed `sort`, `page`, `per_page`, or faceted filter values in the URL surface an actionable Vietnamese `validation` alert with a `"Đặt lại tham số hợp lệ"` recovery button while falling back to safe defaults without crashing.
- `BR-UI-155-03` (Complete UI state coverage): Both `ServerDataTable` and `DashboardShell` implement distinct `loading`, `empty`, `error`, `forbidden` (403), `validation`, `partial`, and `success` states with recovery actions stating what happened, why, that existing data was not altered, and what to do next.
- `BR-UI-155-04` (Explicit fixture marking): The `/storybook` test page marks every sample record with `isFixture: true` and `FIXTURE-` prefixes and renders a prominent fixture notice banner so fixture data is never presented as live production data.
- `BR-UI-155-05` (License & zero-Clerk compliance): Only MIT-licensed code from `sadmann7/shadcn-table` and `Kiranism/next-shadcn-dashboard-starter` is ported, retaining copyright notices and omitting Clerk completely.

## Constitution check

- [x] **Tenant scope**: Reusable UI primitives and fixture-only `/storybook` showcase; top context selector (`contextOptions`/`selectedContextId`) surfaces tenant/branch/warehouse scope selection without trusting client-only ownership for backend mutations.
- [x] **RBAC & permissions**: Dedicated `forbidden` (403) state implemented on both `ServerDataTable` and `DashboardShell` with explicit permission messaging and recovery actions.
- [x] **Audit & sensitive data**: No secrets or raw PII are logged or rendered; fixture recipient phones on `/storybook` are masked (`0901****111`).
- [x] **VND integer arithmetic**: All monetary values (`codAmountVnd`, `shippingFeeVnd`) use integer VND arithmetic and `tabular-nums` formatting via `<Money />`.
- [x] **Carrier reconciliation**: N/A — UI component library and fixture showcase; no carrier mutation is executed.
- [x] **Tests at the lowest useful level, test-first where executable**: All acceptance rows have executable unit/component tests in `apps/web/src/tests/data-table-dashboard-shell.test.ts` plus repository A11y/visual/lint/typecheck gates.

## UI states

- **Loading**: Skeleton rows (`data-testid="data-table-loading-state"`, `aria-busy="true"`) and shell loading skeleton (`data-testid="dashboard-shell-loading"`).
- **Empty**: Dedicated empty state (`data-testid="data-table-empty-state"`, `data-testid="dashboard-shell-empty"`) with `"Xóa bộ lọc hiện tại"` when filtered and custom primary action support.
- **Validation**: URL query parameter validation banner (`data-testid="data-table-validation-state"`, `role="alert"`) with `"Đặt lại tham số hợp lệ"` button.
- **Error**: Actionable error state (`data-testid="data-table-error-state"`, `data-testid="dashboard-shell-error"`, `role="alert"`) confirming data was not changed and providing a `"Thử lại"` button.
- **Forbidden (403)**: Dedicated 403 callout (`data-testid="data-table-forbidden-state"`, `data-testid="dashboard-shell-forbidden"`, `role="alert"`) naming the required permission and offering scope recovery.
- **Partial**: Partial data notice banner (`data-testid="data-table-partial-state"`, `data-testid="dashboard-shell-partial"`) showing displayed vs total records.
- **Success & Recovery**: Populated table (`data-testid="data-table-success-state"`) with sticky headers, compact/comfortable density toggle, column visibility menu, bulk selection bar, and URL pagination.

## API, event and data impact

None. No Prisma schema, migration, or backend API route is modified.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-155-01` | Port `sadmann7/shadcn-table` URL search param hooks & query evaluator | `parseSortParam`, `parsePaginationParams`, `parseFilterParams`, `createQueryString`, `applyServerDataTableQuery`, and `useDataTable` handle sort, text filter, faceted multi-select filter, pagination, and invalid param validation | `unit` test in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-02` | `ServerDataTable` renders all required UI states in Vietnamese | `loading`, `empty` (filtered & unfiltered), `error`, `forbidden` (403), `validation`, `partial`, and `success` states render with actionable recovery controls | `unit` test in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-03` | Port `Kiranism/next-shadcn-dashboard-starter` shell without Clerk | `DashboardShell`, `AppSidebar`, `PageHeader`, `DashboardBreadcrumbs`, and `DashboardUserNav` render Vietnamese labels, context selector, collapsible rail, and shell states with zero Clerk dependencies | `unit` test in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-04` | Keyboard accessibility and WCAG AA semantics | Skip link, `aria-sort`, `aria-current="page"`, `aria-live="polite"`, `tabIndex={0}` rows, accessible button/input labels pass `pnpm test:a11y` | `unit` test + `pnpm test:a11y` |
| `AC-AI-155-05` | Storybook/test page (`/storybook`) uses explicitly marked fixtures | `/storybook` renders `FIXTURE ONLY` badge, `data-testid="storybook-fixture-banner"`, state switcher, and `FIXTURE_SHIPMENT_ROWS` (`isFixture: true`) without touching existing feature screens | `unit` test in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-06` | MIT license notices retained | Ported files in `data-table/` and `dashboard-shell/` retain upstream MIT copyright and license notices | `unit` test in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-07` | Repository quality gates pass | `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `git diff --check origin/main...HEAD` pass with LF line endings | Command execution logs |

## Task breakdown

- [x] `T01` [P] Write unit and component state tests in `apps/web/src/tests/data-table-dashboard-shell.test.ts` covering `AC-AI-155-01` through `AC-AI-155-06`.
- [x] `T02` [P] Port URL search param state hooks and query helpers (`use-data-table.ts`) and `ServerDataTable` components (`data-table.tsx`, `index.ts`) from `sadmann7/shadcn-table` (MIT).
- [x] `T03` [P] Port `DashboardShell`, `AppSidebar`, `PageHeader`, `DashboardBreadcrumbs`, and `DashboardUserNav` (`dashboard-shell.tsx`, `index.ts`) from `Kiranism/next-shadcn-dashboard-starter` (MIT, no Clerk).
- [x] `T04` Implement `/storybook` fixture showcase page (`apps/web/src/app/storybook/page.tsx`) and wire `data-table-dashboard-shell.test.ts` into `apps/web/package.json`.
- [x] `T05` Record `TASK-AI-155` in `FEATURE-DELIVERY-REGISTER.csv`, update `.oc/pr-body.md`, and run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `git diff --check origin/main...HEAD`.

## Verification commands

```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | `READY_FOR_CODEX` | Initial implementation ready for independent Codex review |

## Residual limitations

None
