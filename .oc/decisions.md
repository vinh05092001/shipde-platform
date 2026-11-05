# Decision ledger — p-task-ai-155 (seeded 11-04_08:33 from earlier review rounds)

- seen: WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:101 (`computeOptimisticFacetSelection`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:113 (`computeOptimisticFacetSelection`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:121 (`computeOptimisticFacetSelection`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:246 (DataTableFacetedFilter)
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:103 (computeToolbarDraftOnPropChange)
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:104 (`computeToolbarDraftOnPropChange`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:113 (`computeToolbarDraftOnPropChange`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:116 (`computeToolbarDraftOnPropChange`) — NEW P1; previous CI blocker NOT FIXED
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:118 (computeToolbarDraftOnPropChange)
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:120 (`computeToolbarDraftOnPropChange`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:195 (`DataTableToolbar`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:206 (`DataTableToolbar`) — P1, previous #1 NOT FIXED
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:212 (`DataTableToolbar`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:214 (`DataTableToolbar`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:220 (`DataTableToolbar`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:271 (DataTableToolbar)
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:89 (`computeToolbarDraftOnPropChange`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:141 (`getNextQueryBase`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:165 (`getNextQueryBase`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:170 (`getNextQueryBase`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:178 (`getNextQueryBase`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:188 (`getNextQueryBase`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:202 (`createQueryString`) — NEW P1
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:210 (getNextQueryBase)
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:215 (getNextQueryBase)
- seen: WHERE: docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv:274 (TASK-AI-155 register row)

## round 46 11-04_09:16 VERDICT: CHANGES_REQUIRED

- Resolved: FEATURE-DELIVERY-REGISTER.csv deduplicated, removing colliding TASK-AI-167 row at delivery order 293.
- Resolved: DataTableToolbar.tsx resetEpoch draft clearing ensures search input clears immediately on filter reset.
- Resolved: apps/web/e2e/storybook-data-table.spec.ts releases held navigation sequentially to match pure URL router state commit.

## round 47 11-04_10:22 VERDICT: CHANGES_REQUIRED

- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:130 (getNextQueryBase)
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:120 (DataTableToolbar synchronization effect)
- seen: Follow-up (non-blocking): Several pending-navigation tests release the first request before the second interaction; settled search assertions accept “Ng” when expecting “N”; review-gates.mjs still requires an abs

## coordinator decision 04/11 11:30 (operator: reuse community repos)

- REQUIRED: table URL state uses nuqs (apps/web/package.json has nuqs; useDataTable.ts imports from "nuqs"), adapted from tablecn (MIT). Any remaining hand-written pending-edit / acknowledgment / getNextQueryBase machinery = prior finding NOT FIXED (P1, BR-UI-01), whatever the tests say.

## round 49 11-04_11:30 VERDICT: CHANGES_REQUIRED

- 12:00: verbatim tablecn sources staged in .oc/ref-src; diff should be mostly copied tablecn lines + import/label edits.

## round 50 11-04_12:24 VERDICT: CHANGES_REQUIRED

- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.

## round 51 11-04_15:04 VERDICT: CHANGES_REQUIRED

- seen: WHERE: `apps/web/e2e/storybook-data-table.spec.ts:202` and `:674` (previously reported regression tests) — PRIOR P1: NOT FIXED — closure unverified.
- seen: WHERE: `apps/web/src/components/data-table/useDataTable.ts:192` (`useTablecnDataTable`) — NEW P1, AC/spec match.
- seen: WHERE: `apps/web/src/components/data-table/useDataTable.ts:572` (`useShipdeDataTable.createQueryString`) — NEW P1, AC/spec match.
- seen: Follow-up (non-blocking): Give pagination selectors unique IDs when multiple tables share a page; reconcile out-of-range pagination with the requested data instead of clamping only the displayed page.VERDICT: CHANGES_REQ
- seen: WHERE: apps/web/e2e/storybook-data-table.spec.ts:234 and :692 (Back-navigation and reset/facet tests) — PRIOR FINDINGS: P1 NOT FIXED, verification outstanding.
- seen: WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:100 and :135 (DataTableToolbar popstate handler and synchronization effect) — NEW P1, AC/spec match.
- seen: Follow-up (non-blocking): apps/web/e2e/storybook-data-table.spec.ts:670–671 accepts `Ng`/`Ngu` through `/N/` and `/^N/`; Link-cancellation evidence should assert exactly `N`.VERDICT: CHANGES_REQUIRED
- seen: WHERE: `docs/product-spec/work-items/TASK-AI-155.md:191` (Repair verification); `apps/web/e2e/support/review-gates.mjs:188` (`review 37`).
- seen: Follow-up (non-blocking): Align showcase page-size choices with AC-AI-155-06 and place `use-debounced-callback.ts` within the Work Item’s allowed paths.VERDICT: CHANGES_REQUIRED
- seen: WHERE: `apps/web/e2e/storybook-data-table.spec.ts:234` (mounted popstate Back test), `:692` (facet-after-reset test); locations from the previous failure logs.
- seen: Follow-up (non-blocking): Reconcile the new runtime dependencies with the explicit no-new-dependencies precondition; remove the header’s fabricated default shop context; replace simulated React lifecycle harnesses with

## round 52 11-04_16:12 VERDICT: CHANGES_REQUIRED

- seen: WHERE: apps/web/e2e/storybook-data-table.spec.ts:234 (mounted popstate Back test; previous-review location), :692 (reset/facet test; previous-review location)
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:194 (useTablecnDataTable)
- seen: WHERE: apps/web/src/components/data-table/useDataTable.ts:572 (useShipdeDataTable/createQueryString)
- seen: Follow-up (non-blocking): give pagination selectors per-instance IDs when composing multiple tables.VERDICT: CHANGES_REQUIRED
- seen: WHERE: `apps/web/e2e/storybook-data-table.spec.ts:234,692` (Back-navigation and reset/facet tests) — PRIOR FINDINGS: P1 NOT FIXED — unverified.
- seen: WHERE: `apps/web/src/components/data-table/DataTableToolbar.tsx:98` (`DataTableToolbar.handlePopstate`; synchronization effect at line 108) — BLOCKING NEW FINDINGS: P1, AC/spec match.
- seen: Follow-up (non-blocking): `storybook-data-table.spec.ts:670` accepts `Ng`/`Ngu` through loose final matchers despite requiring exactly `N`; tighten the verification evidence.VERDICT: CHANGES_REQUIRED
- seen: WHERE: apps/web/e2e/support/review-gates.mjs:191 (`review 37` test).
- seen: Follow-up (non-blocking): Align showcase page-size choices `[5, 10, 20]` with AC-AI-155-06’s `[10, 20, 50, 100]`.
- seen: WHERE: apps/web/e2e/storybook-data-table.spec.ts:234 and :692 (Back-restoration and post-reset facet tests; locations from the supplied previous logs).
- seen: Follow-up (non-blocking): Reconcile the added `@tanstack/react-table` and `nuqs` runtime dependencies with the Work Item’s explicit no-new-runtime-dependencies constraint.
## round 57 11-04_21:17 VERDICT: CHANGES_REQUIRED
## round 59 11-04_23:52 VERDICT: CHANGES_REQUIRED
## round 60 11-05_00:21 VERDICT: CHANGES_REQUIRED
## round 61 11-05_00:45 VERDICT: CHANGES_REQUIRED
## round 62 11-05_01:09 VERDICT: CHANGES_REQUIRED
