# TASK-AI-155 — Reusable Server-Driven Data Table and Dashboard Shell

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-155` |
| Feature ID | `N/A — reusable UI data table components and dashboard shell pattern` |
| Status | `IN_PROGRESS` |
| Delivery order | `270` |
| Dependencies | `TASK-AI-151` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `apps/web/src/components/data-table/**`; `apps/web/src/components/dashboard/**`; `apps/web/src/app/storybook/page.tsx`; `apps/web/src/tests/data-table-dashboard.test.ts`; `apps/web/package.json`; `docs/product-spec/work-items/TASK-AI-155.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-155-web-data-table` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Provide `apps/web` with a unified, reusable server-driven data table and responsive dashboard shell architecture ported from MIT open-source references (`sadmann7/shadcn-table` and `Kiranism/next-shadcn-dashboard-starter`, no Clerk). This establishes canonical UI primitives for order lists, reconciliation statement tables, exception workboxes, and administrative grids, ensuring consistent URL search parameter state synchronization (pagination, sorting, search, faceted filters), Vietnamese localization, WCAG AA accessibility, and full state coverage (loading skeleton, empty, error with retry, and interactive normal states) while strictly preserving existing feature screens untouched in this Pull Request.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` (Product UX principles, Visual foundation, Canonical components, Tables and Accessibility)
- `AGENTS.md` (Definition of a complete feature, UI quality rule, Third-party MIT code licensing preservation)
- Third-party MIT reference repositories:
  - `sadmann7/shadcn-table` (MIT License; sort, filter, faceted filter, pagination via URL search params)
  - `Kiranism/next-shadcn-dashboard-starter` (MIT License; dashboard layout, collapsible sidebar, page-header patterns without Clerk)

## Preconditions and dependencies

- Operator approval granted on 2026-10-31 for porting server-driven data table and dashboard shell patterns under MIT license.
- Clean Next.js 16 / React 19 workspace baseline in `apps/web` with Tailwind CSS and Lucide icons.
- No new external runtime dependencies added; components built with native accessible HTML and workspace tokens.

## Author boundary

GEMINI is assigned as author for porting and crafting the data-table components/hooks, dashboard shell layout, sidebar, header, page-header patterns, Storybook fixture test page, unit tests, Work Item documentation, and delivery register tracking. The author is prohibited from modifying existing feature screens (`apps/web/src/components/ShipmentListTab.tsx`, `ReconciliationTab.tsx`, etc.), gate configurations, allowlists, baselines, semgrep rules, or `.github/` workflows.

## In scope

- Port data-table components and hooks from `sadmann7/shadcn-table` (MIT) into `apps/web/src/components/data-table/`:
  - `useDataTable.ts`: URL search parameter synchronization hook (`page`, `per_page`, `sort`, `search`, faceted filter keys) with React transition.
  - `DataTable.tsx`: Server-driven table wrapper with loading skeleton (`aria-busy`), accessible empty state with call-to-action, error banner (`role="alert"`) with retry button, row selection checkboxes, and sticky header.
  - `DataTableColumnHeader.tsx`: Accessible column header with `aria-sort` ('none' | 'ascending' | 'descending'), sort toggle, and options dropdown.
  - `DataTablePagination.tsx`: Pagination controls with Vietnamese labels, records range calculation (`Hiển thị X-Y trên Z bản ghi`), page size dropdown (10, 20, 50, 100), and accessible navigation buttons.
  - `DataTableToolbar.tsx`: Search input with clear button, filter slots, and reset button (`Đặt lại bộ lọc`).
  - `DataTableFacetedFilter.tsx`: Multi-select faceted filter with count badges and checkbox list.
  - `DataTableViewOptions.tsx`: Column visibility toggle menu.
- Port dashboard layout and navigation patterns from `Kiranism/next-shadcn-dashboard-starter` (MIT, no Clerk) into `apps/web/src/components/dashboard/`:
  - `DashboardLayout.tsx`: Responsive shell with desktop collapsible sidebar, mobile drawer overlay with accessible dismissal, sticky header, and main container.
  - `DashboardSidebar.tsx`: Collapsible navigation sidebar (width 260px expanded, 72px collapsed) with Ship Dễ branding, uppercase section headers, active route styling, notification badges, and collapse button.
  - `DashboardHeader.tsx`: Top application bar with mobile hamburger trigger, current shop context indicator, global search shortcut trigger, and user profile navigation menu.
  - `PageHeader.tsx` (and `Heading`): Breadcrumb navigation, bold page title (`h1`), description, and action button slots.
- Storybook / Showcase test preview page in `apps/web/src/app/storybook/page.tsx`:
  - Demonstrates full composition with isolated `FIXTURE_SHIPMENTS` data clearly marked with `[FIXTURE DATA]`.
  - Interactive simulator toolbar allowing manual or automated verification of Normal, Loading Skeleton, Empty, and Error states.
- Comprehensive unit tests in `apps/web/src/tests/data-table-dashboard.test.ts` integrated into `pnpm test`.
- All ported files contain third-party MIT license notices citing upstream repositories.

## Out of scope

- Modifying existing feature screens or tab views in `apps/web/src/components/` (ShipmentListTab, ReconciliationTab, SettingsWorkspace, etc.).
- Modifying backend NestJS APIs, database schema, or Prisma migrations.
- Adding third-party authentication services like Clerk (plain Ship Dễ session model is preserved).
- Altering CI/CD gate configurations, allowlists, or security baselines.

## Business rules and edge cases

- `BR-UI-01`: URL State Synchronization — Table pagination (`page`, `per_page`), sorting (`sort=col.desc`), and filter parameters must reflect in URL search parameters to support shareable and reproducible URLs (`SCREEN-SPECIFICATIONS.md`).
- `BR-UI-02`: State Completeness — Data table must support all four primary states: Loading (skeleton placeholder rows without layout shift), Empty (actionable reason and reset button), Error (clear message and retry action), and Normal (tabular data with selection).
- `BR-UI-03`: Accessibility (a11y) — Table headers must declare `scope="col"`, sorted columns must reflect `aria-sort`, loading tbody must declare `aria-busy="true"`, error banners must use `role="alert"`, and all icon buttons must have accessible `aria-label` and `title` attributes.
- `BR-UI-04`: Vietnamese Localization — All user-facing text, button labels, page size labels, and status summaries must be in Vietnamese.
- `BR-UI-05`: Fixture Isolation — All Storybook demonstration data must be explicitly labeled as fixtures and prefixed with `fix-` to avoid confusion with live operational records.

## UI states

- **Loading State**: Table body renders 6 animated skeleton rows with gray placeholders; `aria-busy="true"` set on `tbody`.
- **Empty State**: Centered illustration icon, descriptive title ("Không tìm thấy dữ liệu nào"), explanation copy, and optional action button ("Đặt lại bộ lọc").
- **Error State**: Prominent error banner with `role="alert"`, `aria-live="assertive"`, descriptive error message, and "Thử lại" retry button.
- **Partial / Filtered State**: Active filters reflected in badges; "Đặt lại bộ lọc" button appears in toolbar to reset search and facet criteria.
- **Success / Normal State**: Rendered table rows with responsive columns, formatted tabular numbers, hover effect, selection checkboxes, and pagination bar.

## API, event and data impact

- Zero backend database migrations, schemas, or API routes modified.
- Added client-side component modules under `apps/web/src/components/data-table/` and `apps/web/src/components/dashboard/`.
- Added Storybook test page at `apps/web/src/app/storybook/page.tsx`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-155-01` | DataTable normal loaded state | Table renders semantic role="table", columns, rows, formatted currency, and text-right numeric alignment | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 1) |
| `AC-AI-155-02` | DataTable loading skeleton state | Renders animated skeleton rows, sets `aria-busy="true"`, no data rows shown | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 2) |
| `AC-AI-155-03` | DataTable empty state | Displays clear Vietnamese empty title, explanation, and action button | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 3) |
| `AC-AI-155-04` | DataTable error state & retry | Displays error banner with `role="alert"` and "Thử lại" retry button | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 4) |
| `AC-AI-155-05` | DataTableColumnHeader sorting | Sets `aria-sort` to ascending, descending, or none; toggle sort on click | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 5) |
| `AC-AI-155-06` | DataTablePagination controls | Renders record range, page size options (10, 20, 50, 100), selection count, and navigation buttons | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 6) |
| `AC-AI-155-07` | DataTableToolbar & Faceted Filter | Renders search input, faceted filter buttons with active count badges, and reset button | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 7) |
| `AC-AI-155-08` | PageHeader & Heading pattern | Renders breadcrumbs with `aria-label`, bold h1 title, description, and action button slots | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 8) |
| `AC-AI-155-09` | DashboardSidebar & DashboardHeader | Renders Ship Dễ brand, sections, active nav items, shop badge, search trigger, and user profile menu | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 9) |
| `AC-AI-155-10` | URL search params helpers | `parseSortParam` and `formatSortParam` parse and format sort parameters correctly | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 10) |
| `AC-AI-155-11` | Fixture isolation & Storybook | Storybook page uses 8 isolated fixtures tagged with `fix-` and clearly marked notice banner | `apps/web/src/tests/data-table-dashboard.test.ts` (Test 11) |

## Verification commands

```bash
pnpm --filter @shipde/web typecheck
tsx apps/web/src/tests/data-table-dashboard.test.ts
pnpm --filter @shipde/web lint
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `19c7c192` | `CHANGES_REQUIRED` | Initial implementation of reusable data table and dashboard shell |
| 2 | `b5d977be` | `CHANGES_REQUIRED` | Addressed round 1 review: isolated fixtures, wired URL table state, complete MIT notices, and accessibility fixes |
| 3 | `HEAD` | `READY_FOR_CODEX` | Fixed all review findings: (Finding 1) Prettier formatting gate fixed across all changed files passing `pnpm format:check`; (Finding 2) Added stateful browser history navigation test with real push/back/forward stack exercising hook navigation and parameter restoration; (Finding 4) Passed boolean `inert` attribute to background desktop sidebar and main content containers when mobile drawer is open, and verified mounted drawer dialog; (Finding 5) Verified header search shortcut activation with real production `createGlobalShortcutHandler` covering positive, negative (input, textarea, contenteditable, missing modifier), and disabled states; (Finding 6) Added semantic row-action button and excluded descendant controls (checkboxes, cell buttons) from row activation, preventing keyboard Space hijacking on selection checkboxes, with tests executing against real production elements; (Finding 7) Maintained immediately updated search input draft, preserved spaces during editing in `useDataTable`, and synchronized committed search state with URL. |

## Residual limitations

None.
