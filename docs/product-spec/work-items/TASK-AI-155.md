# TASK-AI-155 — Reusable server-driven data table and dashboard shell in apps/web

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-155` |
| Feature ID | `N/A — reusable web UI foundation for server-driven data tables and dashboard shell` |
| Status | `IN_PROGRESS` |
| Delivery order | `269` |
| Dependencies | `TASK-FOUND-02;TASK-AI-146` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `apps/web/src/components/data-table/**`; `apps/web/src/components/dashboard-shell/**`; `apps/web/src/app/storybook/data-table-shell/page.tsx`; `apps/web/src/tests/data-table-dashboard-shell.test.ts`; `apps/web/package.json`; `docs/product-spec/work-items/TASK-AI-155.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-155-data-table-dashboard-shell` |
| Pull Request | `N/A — local authoring stage` |
| Operator approval | `2026-10-31` |

## Business outcome

Give `apps/web` one reusable server-driven data table (`ServerDataTable`, `useDataTable`, and URL search parameter parser/serializer adapted from `sadmann7/shadcn-table` under MIT License) and one reusable operational dashboard shell (`DashboardShell`, `AppSidebar`, `DashboardHeader`, `PageHeader`, `PageContainer` adapted from `Kiranism/next-shadcn-dashboard-starter` under MIT License without Clerk) so that Ship Dễ operations, reconciliation, and incident screens can share a single URL-synchronized, keyboard-accessible, Vietnamese-localized table and shell foundation without modifying existing feature screens in this Pull Request.

## Source references

- `AGENTS.md` (Definition of a complete feature, UI quality rule, Code review rules)
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` (§2 Tone & Aesthetic Direction, §3 Color Palette, §4 Typography & Scannability, §5 Layout & 8px Spacing System, §6 Core Components, §10 Loading/Empty/Error States, §12 Navigation & Shell Architecture, §13 Accessibility & Keyboard Rules)
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` (§2 Global Navigation Structure, §3 Global Header & Utility Bar)
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` (§1 Global Shell & Navigation, §5 Shipment List & Operations Table)
- Third-party MIT reference sources:
  - `sadmann7/shadcn-table` (`https://github.com/sadmann7/shadcn-table`, MIT License)
  - `Kiranism/next-shadcn-dashboard-starter` (`https://github.com/Kiranism/next-shadcn-dashboard-starter`, MIT License, ported without Clerk)
- Operator approval: `2026-10-31`

## Preconditions and dependencies

- `TASK-FOUND-02` monorepo foundation and `@shipde/web` Next.js 16 / React 19 / Tailwind CSS v4 workspace are merged.
- Operator approval recorded on `2026-10-31` to introduce reusable `data-table` and `dashboard-shell` components plus a dedicated Storybook/test showcase page using explicitly marked fixture data while leaving existing feature screens untouched.

## Author boundary

`GEMINI` is assigned because this Work Item establishes cross-component UI architecture, URL state synchronization, keyboard accessibility, and multi-state operational table and shell primitives in `apps/web`.
- Allowed paths are strictly bounded to `apps/web/src/components/data-table/**`, `apps/web/src/components/dashboard-shell/**`, `apps/web/src/app/storybook/data-table-shell/page.tsx`, `apps/web/src/tests/data-table-dashboard-shell.test.ts`, `apps/web/package.json`, `docs/product-spec/work-items/TASK-AI-155.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, and `.oc/pr-body.md`.
- Existing feature screens (`apps/web/src/app/page.tsx`, `ShipmentListTab.tsx`, `ReconciliationTab.tsx`, etc.) must not be modified in this PR.
- Gate configurations, allowlists, baselines, semgrep rules, and `.github/` must not be modified.
- All adapted third-party code must come exclusively from MIT-licensed `sadmann7/shadcn-table` and `Kiranism/next-shadcn-dashboard-starter` (no Clerk) and retain their MIT license notices.

## In scope

- Port server-driven data-table components and hooks from `sadmann7/shadcn-table` (MIT) into `apps/web/src/components/data-table/`:
  - `types.ts`: typed column definitions, filter fields (`text` and `faceted`), sorting, pagination, column visibility, density (`compact` / `comfortable`), and parsed URL state.
  - `use-data-table.ts`: `parseTableSearchParams`, `serializeTableSearchParams`, `applyServerDrivenTableOperations`, and `useDataTable` hook synchronizing `page`, `per_page`, `sort`, text filters, faceted multi-select filters, `density`, and `hide` via URL search params.
  - `data-table-column-header.tsx`: accessible sortable/hideable column header with Vietnamese labels and keyboard menu support.
  - `data-table-faceted-filter.tsx`: multi-select faceted filter popover with option search, `tabular-nums` facet counts, selected badges, and keyboard Escape/navigation support.
  - `data-table-view-options.tsx`: density toggle (`Thu gọn` / `Tiêu chuẩn`) and column visibility menu (`Hiển thị cột`).
  - `data-table-toolbar.tsx`: search inputs with explicit `<label>`, faceted filters, active filter reset (`Xóa bộ lọc`), and toolbar actions slot.
  - `data-table-pagination.tsx`: page size selector, total record & selected row counters (`tabular-nums`), and first/previous/next/last page controls with Vietnamese `aria-label`s.
  - `data-table-skeleton.tsx`: structural table skeleton (`role="status"`, `aria-busy="true"`).
  - `data-table.tsx`: `ServerDataTable` covering sticky header, row selection, bulk actions bar, keyboard row navigation, and all required UI states.
  - `fixtures.ts`: deterministic fixture dataset explicitly tagged with `isFixture: true` and `[DỮ LIỆU MẪU / FIXTURE]`.
- Port dashboard layout, collapsible sidebar, header, breadcrumb, and page header patterns from `Kiranism/next-shadcn-dashboard-starter` (MIT, no Clerk) into `apps/web/src/components/dashboard-shell/`:
  - `app-sidebar.tsx`: collapsible desktop rail (`w-64` / `w-16`) and mobile drawer (`role="dialog"`, Escape to close), `TenantContextSwitcher`, grouped navigation with collapsible sub-items, semantic count badges, and native user footer.
  - `dashboard-header.tsx`: sticky top bar with sidebar toggle (`Ctrl+B`), mobile menu button, `DashboardBreadcrumbs` (`aria-label="Breadcrumb"`), quick search trigger (`⌘K`), active tenant pill, and native `DashboardUserNav` menu (no Clerk).
  - `page-header.tsx`: `PageHeader` and `PageContainer` following Ship Dễ 8px spacing and typography hierarchy.
  - `dashboard-shell.tsx`: `DashboardShell` with skip-to-content link (`#dashboard-main-content`), `Ctrl+B` shortcut, and shell-level loading, error, and 403 forbidden states.
- Create one Storybook/test showcase page at `apps/web/src/app/storybook/data-table-shell/page.tsx` using fixture data clearly marked with `[DỮ LIỆU MẪU / FIXTURE]` and an interactive state switcher.
- Create unit and state tests in `apps/web/src/tests/data-table-dashboard-shell.test.ts` and wire into `apps/web/package.json`.

## Out of scope

- Modifying any existing production/feature screens in `apps/web`.
- Adding Clerk or any third-party authentication provider.
- Modifying backend API routes, database schema, or gate configuration files.

## Business rules and edge cases

- `BR-UI-DT-01` (URL Search Params Authority): `page`, `per_page`, `sort`, `density`, `hide`, and filter fields are parsed deterministically from URL search params. Changing any filter, sort, or `per_page` resets `page` to `1` to prevent stranded out-of-range pages.
- `BR-UI-DT-02` (Malformed URL Parameter Recovery): Invalid URL parameters (e.g., negative `page`, unsupported `per_page`, malformed `sort`, unknown faceted option) must never crash the table; they fall back to safe defaults and surface an explicit Vietnamese validation warning banner with a 1-click reset action.
- `BR-UI-DT-03` (Tabular Financial & Operational Numbers): All monetary (`VND`), weight, badge count, and pagination counters use `font-mono tabular-nums` and integer formatting (`toLocaleString('vi-VN')`).
- `BR-UI-SHELL-01` (Zero Clerk & Native Tenant Scope): The ported dashboard shell must have zero Clerk dependencies and must display the active Ship Dễ tenant/shop/warehouse scope clearly in both the sidebar and header.
- `BR-UI-FIX-01` (Explicit Fixture Marking): Fixture records used by the Storybook/test page must carry `isFixture: true` and visible `[DỮ LIỆU MẪU / FIXTURE]` banners/badges so fixture data is never presented as live production data.

## UI states

- **Loading (`isLoading`)**: `DataTableSkeleton` and `DashboardShell` skeleton with `role="status"` and `aria-busy="true"` matching real layout structure.
- **Empty (`data.length === 0 && !isFiltered`)**: Vietnamese empty state with explanation and primary action button.
- **Filtered No-Results (`data.length === 0 && isFiltered`)**: Vietnamese no-results message with `Xóa bộ lọc để xem toàn bộ` recovery button.
- **Out-of-Range Page (`page > pageCount && totalCount > 0`)**: Recovery view explaining page overflow with `Quay về trang 1` button.
- **Validation Error (`validationErrors.length > 0`)**: Alert banner (`role="alert"`) listing invalid URL search params with `Đặt lại tham số mặc định` button.
- **Partial Data (`partialWarning`)**: Non-blocking status banner (`role="status"`) explaining delayed carrier/upstream data with optional `Đồng bộ lại` button.
- **Error (`error`)**: Alert card (`role="alert"`) with error title, message, error code, and `Thử tải lại` button.
- **Forbidden (`isForbidden`)**: 403 alert card (`role="alert"`) explaining insufficient role/tenant permission with context switch / access request action.
- **Success**: Sticky header, `aria-sort` column headers, `tabular-nums` cells, row selection + bulk action bar, and URL-synchronized pagination.

## API, event and data impact

- Frontend-only reusable component library (`apps/web/src/components/data-table` and `apps/web/src/components/dashboard-shell`) and Storybook showcase route (`/storybook/data-table-shell`).
- No database migrations, Prisma schema changes, or backend API contract changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-155-01` | Parse & serialize URL search params (`page`, `per_page`, `sort`, text filter, faceted filter, `density`, `hide`) | Valid params parse into `ParsedTableUrlState` and serialize canonically; invalid params fall back safely and populate `validationErrors` | Unit test 1 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-02` | Server-driven filter, multi-select faceted filter, facet counts, sort & pagination | `applyServerDrivenTableOperations` filters, counts facets, sorts, and paginates accurately | Unit test 2 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-03` | `ServerDataTable` full UI state coverage (loading, empty, no-results, out-of-range, validation error, partial, error, 403 forbidden, success) | Every state renders deterministic Vietnamese UI, ARIA roles (`status`, `alert`, `aria-sort`, `aria-busy`), and recovery actions | Unit test 3 & 4 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-04` | `DashboardShell`, `AppSidebar`, `DashboardHeader`, `PageHeader`, `PageContainer` layout & states | Renders skip link, collapsible sidebar, active route `aria-current="page"`, breadcrumbs, tenant switcher, native user nav, and shell loading/error/403 states | Unit test 5 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-05` | Storybook/test showcase page with explicitly marked fixture data | `/storybook/data-table-shell` renders `[DỮ LIỆU MẪU / FIXTURE]` banner and badges across all 8 UI state modes without touching existing feature screens | Unit test 6 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |
| `AC-AI-155-06` | MIT license notice preservation & zero Clerk dependencies | All files in `data-table/` and `dashboard-shell/` retain MIT license headers and contain zero Clerk references | Unit test 7 in `apps/web/src/tests/data-table-dashboard-shell.test.ts` |

## Verification commands

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `git diff --check origin/main...HEAD`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `PENDING` | `PENDING` | `N/A — awaiting initial Codex review` |

## Residual limitations

None
