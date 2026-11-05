## Round 40 review (pl-task-ai-155-40, writer was agy05:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: f81b8169f0c2eaed8569f9211bfd00ffeeb489f7

TASK-AI-155 should deliver reusable URL-driven tables and a responsive dashboard shell with Vietnamese localization, accessible states and isolated fixtures.
The delta touches AC-AI-155-01–11: table states, sorting, pagination, search/facets, dashboard composition, URL helpers and fixture isolation.

Phase 1 checklist:

- (a) N/A: no tenant-owned server reads or writes introduced.
- (b) N/A: no endpoint authorization changes; navigation filtering is presentation logic.
- (c) N/A for cross-tenant endpoint tests; malformed URL, forbidden rendering and denied navigation tests are present.
- (d) NEW P1: `useDataTable.ts:202` and `DataTableToolbar.tsx:116`; findings 1–2.
- (e) N/A: fixture VND amounts are integers; no financial calculations introduced.
- (f) N/A: no external operational effects requiring reconciliation.
- (g) N/A: no auditable server mutations or secrets introduced; fixture phones and displayed emails are masked.
- (h) N/A for additional blockers: normal, loading, empty, error/retry and forbidden branches exist.
- (i) Previous P1 **NOT FIXED overall**: the brittle request-count assertion is **FIXED** at `apps/web/e2e/storybook-data-table.spec.ts:544`, but the subsequent search assertion at line 547 remains unsatisfied by the implementation, as finding 2 explains. Supplied exact-head CI entries contain no success conclusions.

1. WHERE: apps/web/src/components/data-table/useDataTable.ts:202 (`createQueryString`) — NEW P1  
   WRONG: Hold navigation after selecting `status=FAILED`, then select `carrier=GHN` before either navigation commits → the carrier request contains only `carrier=GHN`, dropping the pending status selection.  
   GOAL: BR-UI-01 and AC-AI-155-07 require consistent URL filter state; successive edits must preserve earlier pending intent until acknowledged or explicitly cancelled.  
   VERIFY: Add `pending facet edits compose before commit`: hold RSC requests, select FAILED then GHN, and assert the second request and settled URL contain both parameters.

2. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:116 (`computeToolbarDraftOnPropChange`) — NEW P1; previous CI blocker NOT FIXED  
   WRONG: Hold searches `N` then `Ng`, then commit the external Link navigation to `search=N` → the toolbar treats `N` as an older acknowledgment and retains draft `Ng`. Storybook supplies no `historyEpoch`, and `useDataTable` no longer produces that signal.  
   GOAL: BR-UI-01 and AC-AI-155-07 require external navigation to restore the selected URL’s search value and discard cancelled drafts.  
   VERIFY: Add `external Link cancels pending search draft`: perform those held navigations through the real Link, release its request, and assert the textbox and settled URL both contain `N`.

Phase 2 open sweep:

3. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:195 (`DataTableToolbar`) — NEW P1  
   WRONG: Type `An`, toggle the Storybook loading simulator before the debounce expires, then clear search → the parent rerender replaces the debounce object without cancelling its timer; the abandoned timer subsequently sends `An` and restores the cleared search.  
   GOAL: BR-UI-01 and AC-AI-155-07 require clear to cancel pending search updates across parent rerenders.  
   VERIFY: Add `clear cancels debounce across callback replacement`: schedule `An`, rerender with a new callback, clear, advance 300 ms, and assert only the empty search is emitted.

4. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:212 (`DataTableToolbar`) — NEW P1  
   WRONG: With committed search `N` and a stable search callback, type `Ng`, then navigate Back to an empty search before 300 ms → draft synchronization clears the textbox but leaves the timer running; it subsequently emits `Ng`, overriding Back.  
   GOAL: BR-UI-01 requires authoritative navigation to cancel unsent edits as well as restore displayed state.  
   VERIFY: Add `Back cancels unsent debounced search`: mount with a stable callback, type `Ng`, restore empty committed search through Back, advance 300 ms, and assert no `Ng` navigation occurs.

Follow-up (non-blocking): expanded sidebar width is 256px versus the specified 260px; pagination instances reuse `page-size-select`; the fixture feedback close button lacks the required `aria-label`.

## Round 41 review (pl-task-ai-155-41, writer was agy04:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 46eca7517300d1dce630685b50ba24092953b3be

TASK-AI-155 should deliver reusable URL-driven tables and a responsive Vietnamese dashboard shell with accessible states and isolated fixtures.
The delta touches AC-AI-155-01–11: table rendering, sorting, pagination, search/facets, dashboard composition, URL helpers and fixture isolation.

Phase 1 checklist:

- (a) N/A: no tenant-owned server reads or writes introduced.
- (b) N/A: no endpoint changes; navigation filtering is presentation logic.
- (c) N/A for cross-tenant endpoint tests; malformed URL, forbidden rendering and denied navigation tests are present.
- (d) NEW P1: findings 1–2 violate BR-UI-01 and AC-AI-155-07.
- (e) N/A: fixture VND values are integers; no financial calculations introduced.
- (f) N/A: no external operational effects requiring reconciliation.
- (g) N/A: no auditable server mutations or secrets introduced; fixture phones and displayed emails are masked.
- (h) NEW P1: finding 3 leaves facet controls inconsistent with authoritative navigation. Loading, empty, error/retry and forbidden branches exist.
- (i) Previous P1 #1 **FIXED** for the specified two edits before any commit: `useDataTable.ts:141–142` composes onto pending intent. Previous P1 #2 **FIXED** for the specified external `N` commit after dispatched `Ng`: `DataTableToolbar.tsx:133–135` restores `N`. Previous P1 #3 **FIXED**: `DataTableToolbar.tsx:207–214` retains one debounce instance across callback replacement. Previous P1 #4 **FIXED**: `DataTableToolbar.tsx:219–224` cancels the timer when Back changes committed search. Previous non-blocking items remain **NOT FIXED**, listed below.

1. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:220 (`DataTableToolbar`) — NEW P1  
   WRONG: Dispatch `N`, type newer unsent `Ngu`, then acknowledge `search=N` before the debounce expires → the effect cancels the `Ngu` timer, leaving textbox `Ngu` and URL `N` indefinitely.  
   GOAL: BR-UI-01 and AC-AI-155-07 require an acknowledgment of the toolbar’s own request to preserve and dispatch newer unsent text.  
   VERIFY: Add `mounted own acknowledgment preserves newer debounce`: dispatch `N`, type `Ngu`, commit `N`, advance the debounce, and assert emissions equal `['N', 'Ngu']` and the settled URL contains `search=Ngu`.

2. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:89 (`computeToolbarDraftOnPropChange`) — NEW P1  
   WRONG: Dispatch `N` then `Ng`; external navigation commits `N`, marking `Ng` stale; a subsequent authoritative navigation selects `search=Ng` → the stale branch retains textbox `N` while committed URL and table search become `Ng`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require subsequent authoritative navigation to restore its selected search value, including a previously cancelled value.  
   VERIFY: Add `authoritative navigation can revisit cancelled search`: dispatch both values, commit external `N`, then commit authoritative `Ng`, and assert the textbox equals `Ng`.

3. WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:121 (`computeOptimisticFacetSelection`) — NEW P1  
   WRONG: With committed empty status, queue `FAILED` then `DELIVERED.FAILED`; Back commits an existing `status=FAILED` entry → acknowledgment matching retains both selections because Storybook supplies no `historyEpoch`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require Back to discard cancelled facet intent and display exactly the selected URL’s filters.  
   VERIFY: Add `mounted Back cancels overlapping facet selections`: create the existing FAILED history entry, queue both edits under held navigation, navigate Back, and assert only FAILED is selected and the badge reports one selection.

Phase 2 open sweep:

4. WHERE: apps/web/src/components/data-table/useDataTable.ts:141 (`getNextQueryBase`) — NEW P1  
   WRONG: Queue `status=FAILED`, then `carrier=GHN`; acknowledge only the first request while the second remains pending; call `setSearch('Ng')` → committed parameters differ from the stored baseline, so the third request drops `carrier=GHN`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require intermediate acknowledgments to preserve newer pending intent when composing subsequent edits.  
   VERIFY: Add `pending facets survive intermediate acknowledgment`: mount with controlled search parameters and captured navigation, queue both facets, commit the first captured query, set search, and assert the third query contains FAILED, GHN and Ng.

Follow-up (non-blocking): previous sidebar width, repeated `page-size-select` ID and feedback-button `aria-label` issues remain; the new external-Link test’s final `/N/` and `/^N/` assertions also accept `Ng`. Supplied exact-head CI entries contain no success conclusions.

## Round 42 review (pl-task-ai-155-42, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: eb0e9494a5be1262ee75a60b0edc8993cade82a6

TASK-AI-155 should deliver reusable URL-driven tables and an accessible Vietnamese dashboard shell, with isolated fixtures and existing feature screens preserved.
The delta touches AC-AI-155-01–11: table states, sorting, pagination, search/facets, dashboard composition, URL helpers and fixture isolation.

Phase 1 checklist:

- (a) N/A: no tenant-owned server reads or writes introduced.
- (b) N/A: no endpoint authorization changes; the AppShell delta removes a comment.
- (c) N/A for cross-tenant endpoint tests. Malformed URL, forbidden rendering and denied navigation tests are present. The toolbar harness skips effect cleanup, concealing finding 1.
- (d) P1: findings 1, 2, 4, 5 and 6 violate BR-UI-01 and AC-AI-155-07.
- (e) N/A: fixture currency values are integer VND; no financial processing introduced.
- (f) N/A: no external operational effects requiring idempotency or reconciliation.
- (g) N/A: no auditable server mutations or secrets introduced; fixture phones and displayed emails are masked.
- (h) P1: findings 2–3 leave controls inconsistent with authoritative navigation. Loading, empty, error/retry and forbidden branches are present.
- (i) Previous open P1 #1 **NOT FIXED**: `apps/web/src/components/data-table/DataTableToolbar.tsx:206` still cancels the newer timer through effect cleanup. Previous P1 #2 **FIXED**: `DataTableToolbar.tsx:113` restores a revisited cancelled value, with `DataTableToolbar.tsx:225` updating the last-sent state. Previous P1 #3 **FIXED** for the specified Back scenario: `DataTableFacetedFilter.tsx:169` clears pending selections and its popstate signal bypasses acknowledgment matching. Previous P1 #4 **FIXED** for the specified additive intermediate acknowledgment: `useDataTable.ts:165` preserves pending carrier intent. Earlier closed P1 scenarios remain **FIXED**. Previous non-blocking items remain **NOT FIXED**.

1. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:206 (`DataTableToolbar`) — P1, previous #1 NOT FIXED  
   WRONG: Dispatch `N`, type unsent `Ngu`, then acknowledge `search=N` before the debounce expires → React runs the previous effect’s cleanup and cancels the `Ngu` timer; textbox stays `Ngu` while URL stays `N`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require acknowledgment of the toolbar’s own request to preserve and dispatch newer unsent text.  
   VERIFY: `real mounted own acknowledgment preserves newer debounce`: use a real React mount with effect cleanup, dispatch `N`, type `Ngu`, commit `N`, advance timers, and assert emissions equal `['N', 'Ngu']`.

2. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:214 (`DataTableToolbar`) — NEW P1  
   WRONG: Commit `search=N&sort=codAmount.desc`, navigate to ascending sort, type unsent `Ng`, then Back to descending sort while search remains `N` → neither synchronization nor debounce cancellation runs; the timer dispatches `Ng` and overwrites Back’s selected search.  
   GOAL: BR-UI-01 and AC-AI-155-07 require authoritative Back navigation to discard unsent search intent even when the selected search value is unchanged.  
   VERIFY: `mounted Back with unchanged search cancels debounce`: create both sort history entries with `search=N`, type `Ng`, navigate Back before debounce expiry, advance timers, and assert textbox and URL remain exactly `N` with descending sort.

3. WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:101 (`computeOptimisticFacetSelection`) — NEW P1  
   WRONG: From committed empty status, queue `FAILED` under held navigation, then commit the external Storybook Link to `?search=N` → no popstate occurs and incoming status still equals previous empty status, so the cancelled `FAILED` selection and badge remain displayed.  
   GOAL: BR-UI-01 and AC-AI-155-07 require external navigation to display exactly its selected filters and discard cancelled optimistic selections.  
   VERIFY: `mounted external Link clears unchanged committed facet`: hold the FAILED request, commit the external Link, and assert URL status is absent, FAILED has `aria-selected="false"`, and the status trigger reports no selections.

Phase 2 open sweep — NEW P0: none; additional NEW P1: findings 4–6.

4. WHERE: apps/web/src/components/data-table/useDataTable.ts:165 (`getNextQueryBase`) — NEW P1  
   WRONG: Commit `status=FAILED`, queue `carrier=GHN`, then Back to the existing empty URL; call `setSearch('Ng')` → empty committed parameters qualify as a compatible subset, so the new request resurrects cancelled FAILED and GHN filters.  
   GOAL: BR-UI-01 and AC-AI-155-07 require subsequent edits after Back to compose from the authoritative history entry.  
   VERIFY: `pending facets are discarded on Back to subset URL`: commit FAILED, hold GHN, navigate Back to empty, set search, and assert the captured query contains `search=Ng` with neither status nor carrier.

5. WHERE: apps/web/src/components/data-table/useDataTable.ts:170 (`getNextQueryBase`) — NEW P1  
   WRONG: Queue `status=FAILED`, then `status=FAILED.DELIVERED`; acknowledge the first query while the second remains pending, then select `carrier=GHN` → exact-value subset matching rejects the acknowledgment and the third query drops DELIVERED.  
   GOAL: BR-UI-01 and AC-AI-155-07 require intermediate acknowledgments to preserve newer pending selections within the same facet.  
   VERIFY: `same-facet intent survives intermediate acknowledgment`: capture both status queries, commit the first, select GHN, and assert the third query contains both FAILED and DELIVERED plus GHN.

6. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:113 (`computeToolbarDraftOnPropChange`) — NEW P1  
   WRONG: Dispatch `N`, dispatch `Ng`, type newer unsent `Ngu`, then acknowledge the toolbar’s first `N` request while `Ng` remains pending → the helper classifies its own intermediate acknowledgment as external, restores textbox `N`, and discards `Ngu`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require acknowledgments of earlier owned requests to preserve newer search intent while authoritative external navigation cancels it.  
   VERIFY: `owned intermediate search acknowledgment preserves newer draft`: mount the toolbar with controlled owned navigation acknowledgments, dispatch N and Ng, type Ngu, acknowledge N, advance timers, and assert textbox remains Ngu and emissions equal `['N', 'Ng', 'Ngu']`.

Follow-up (non-blocking): sidebar expanded width, repeated `page-size-select` ID and feedback-button `aria-label` remain NOT FIXED; the external-Link test’s `/N/` and `/^N/` assertions still accept `Ng`; supplied exact-head CI entries contain no success conclusions.

## Round 43 review (pl-task-ai-155-43, writer was agy02:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 45b50430a664ea2e0bcae64c2dce8bd6ed7cdc8b

TASK-AI-155 should deliver reusable URL-driven Vietnamese tables and an accessible dashboard shell with isolated fixtures, while preserving existing feature screens.
The delta touches AC-AI-155-01–11. The blocking findings concern URL synchronization and filter controls under BR-UI-01 and AC-AI-155-07.

Phase 1 checklist:

- (a) N/A: no tenant-owned server reads or writes introduced.
- (b) N/A: no endpoint authorization changes; AppShell changes only a comment.
- (c) N/A for cross-tenant/API negative tests. Malformed URL, forbidden rendering and denied navigation tests are present.
- (d) P1: findings #1–6 violate authoritative navigation or preservation of newer owned intent.
- (e) N/A: fixture currency values are integer VND; no financial processing introduced.
- (f) N/A: no external operational effects requiring idempotency, timeout reconciliation or retries.
- (g) N/A: no auditable server mutations or secrets introduced; fixture phones and displayed emails are masked.
- (h) P1: findings #1–4 leave displayed controls inconsistent with navigation. Loading, empty, error/retry and forbidden branches are present.
- (i) Previous numbered P1 #1 **FIXED** for its specified scenario: `apps/web/src/components/data-table/DataTableToolbar.tsx:248` cancels on authoritative commits; cleanup cancellation is confined to unmount at line 255.
- (i) Previous numbered P1 #2 **FIXED**: `apps/web/src/components/data-table/DataTableToolbar.tsx:266` cancels the debounce on popstate and restores authoritative text at line 270.
- (i) Previous numbered P1 #3 **FIXED** for the supplied Storybook scenario: `apps/web/src/components/data-table/DataTableFacetedFilter.tsx:241` detects the URL change; line 113 clears unchanged committed facets.
- (i) Previous numbered P1 #4 **FIXED**: `apps/web/src/components/data-table/useDataTable.ts:200` clears pending intent on popstate.
- (i) Previous numbered P1 #5 **FIXED** for the specified additive same-facet acknowledgment: `apps/web/src/components/data-table/useDataTable.ts:105` compares selection segments, and line 183 preserves the pending target.
- (i) Previous numbered P1 #6 **FIXED** for its specified newer-unsent-draft scenario: `apps/web/src/components/data-table/DataTableToolbar.tsx:230` records owned dispatches; line 120 recognizes the earlier acknowledgment.
- (i) Earlier named closed scenarios remain **FIXED**: cancelled-value revisit at `DataTableToolbar.tsx:304`; Back facet cancellation at `DataTableFacetedFilter.tsx:100`; additive intermediate composition at `useDataTable.ts:183`.

Phase 2 open sweep: NEW P0: none. NEW P1: findings #4–6, in addition to Phase 1 findings #1–3.

1. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:120 (`computeToolbarDraftOnPropChange`) — NEW P1  
   WRONG: Dispatch held searches `N` and `Ng`, type newer unsent `Ngu`, then commit the external Storybook Link to `?search=N` before debounce expiry → `N` matches the owned log, so the textbox stays `Ngu` and its timer subsequently overwrites the external navigation with `search=Ngu`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require external navigation to discard cancelled search intent, including values that collide with earlier owned requests.  
   VERIFY: `mounted external Link cancels unsent draft after owned dispatches`: hold N and Ng, type Ngu, commit the Link to N, expire the debounce, and assert textbox and URL equal N with emissions exactly `['N', 'Ng']`.

2. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:120 (`computeToolbarDraftOnPropChange`) — NEW P1  
   WRONG: Dispatch owned requests `N` and `Ng` with textbox exactly `Ng`, then acknowledge the first request while `Ng` remains pending → `currentDraft === lastSent`, so the owned-log branch is skipped and the textbox is restored to `N`, discarding the newer displayed intent.  
   GOAL: BR-UI-01 and AC-AI-155-07 require earlier owned acknowledgments to preserve newer pending search intent even when there is no additional unsent text.  
   VERIFY: `owned intermediate acknowledgment preserves latest dispatched draft`: mount with controlled owned acknowledgments, dispatch N then Ng, acknowledge N while Ng remains held, and assert the textbox remains exactly Ng.

3. WHERE: apps/web/src/components/data-table/DataTableFacetedFilter.tsx:113 (`computeOptimisticFacetSelection`) — NEW P1  
   WRONG: From empty filters, queue `status=FAILED`, then `carrier=GHN`; acknowledge the status request while the carrier request remains held → any changed URL is classified as external for the unchanged carrier facet, clearing GHN. Selecting GHTK then sends only `carrier=GHTK`, losing the earlier GHN selection.  
   GOAL: BR-UI-01 and AC-AI-155-07 require acknowledgment of another table control’s request to preserve newer pending facet selections.  
   VERIFY: `mounted status acknowledgment preserves pending carrier selection`: hold both requests, release status only, assert GHN remains selected, select GHTK, and assert the next request contains both GHN and GHTK plus FAILED.

4. WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:104 (`computeToolbarDraftOnPropChange`) — NEW P1  
   WRONG: Create descending and ascending sort history entries with `search=GHTK`; dispatch held search N, then Back while search remains GHTK. Popstate clears the log but leaves `lastSentSearch=N`; subsequently committing the external Link to `?search=N` matches that stale marker → URL shows N while the textbox remains GHTK.  
   GOAL: BR-UI-01 and AC-AI-155-07 require Back to invalidate cancelled ownership markers so subsequent authoritative navigation restores its selected search value.  
   VERIFY: `mounted unchanged-search Back invalidates last owned dispatch`: dispatch held N from the ascending GHTK entry, Back to descending GHTK, commit the external Link to N, and assert textbox and URL both equal N.

5. WHERE: apps/web/src/components/data-table/useDataTable.ts:178 (`getNextQueryBase`) — NEW P1  
   WRONG: Start at `?search=N`, select FAILED and wait for its URL commit, then commit the external Storybook Link back to `?search=N`. Selecting carrier GHN afterward reuses the old pending target because the URL equals its baseline → the request resurrects cancelled `status=FAILED`.  
   GOAL: BR-UI-01 and AC-AI-155-07 require subsequent edits after authoritative external navigation to compose from that navigation’s committed filters.  
   VERIFY: `mounted external Link after settled facet does not resurrect filters`: commit FAILED, navigate through the external Link to N, select GHN, and assert the captured query has search=N and carrier=GHN with no status parameter.

6. WHERE: apps/web/src/components/data-table/useDataTable.ts:188 (`getNextQueryBase`) — NEW P1  
   WRONG: From committed `status=FAILED.DELIVERED`, queue `status=FAILED`, then queue removal of status entirely; acknowledge the first request while the removal remains pending, then select carrier GHN → subset matching rejects the acknowledgment against the empty target and the next request resurrects FAILED.  
   GOAL: BR-UI-01 and AC-AI-155-07 require newer owned removals to survive intermediate acknowledgments, just as newer additions must survive them.  
   VERIFY: `pending facet removal survives intermediate acknowledgment`: hold both deselection requests, commit the first, select GHN, and assert the next query contains carrier=GHN with no status parameter.

Follow-up (non-blocking): Previous sidebar-width, repeated pagination-ID, feedback-button aria-label and loose external-Link assertions remain NOT FIXED; the supplied CI conclusions are empty and real mounted repair acceptance remains unverified.

## Round 44 review (pl-task-ai-155-44, writer was agy01:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 9ac0ed273c3e548707456942c20f7849d52ac435

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126270252788) — failing log lines

```
  ✘  30 [chromium] › e2e/storybook-data-table.spec.ts:595:5 › external Link cancels pending search draft (6.1s)
  ✓  31 [chromium] › e2e/storybook-data-table.spec.ts:628:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment (504ms)
  1) [chromium] › e2e/storybook-data-table.spec.ts:176:5 › mounted pagination remains synchronized after Back then Next
    Error: expect(locator).toBeVisible() failed
    Locator: getByText('GHN672391024VN')
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found
    Call log:
      - Expect "toBeVisible" getByText('GHN672391024VN') with timeout 5000ms
--
      201 |
      202 | test('mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment', async ({
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:199:50
    Error Context: test-results/storybook-data-table-mount-ee6bb-onized-after-Back-then-Next-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-mount-ee6bb-onized-after-Back-then-Next-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-mount-ee6bb-onized-after-Back-then-Next-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2) [chromium] › e2e/storybook-data-table.spec.ts:518:5 › review 12 P1: external same-page navigation to an older pending search cancels the newer draft
    Error: expect(locator).toHaveValue(expected) failed
    Locator:  getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
    Expected: "N"
    Received: "Ng"
    Timeout:  5000ms
--
      - Expect "toHaveValue" getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' }) with timeout 5000ms
      - waiting for getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
        14 × locator resolved to <input value="Ng" type="text" aria-label="Tìm theo mã vận đơn, mã đơn, khách hàng..." placeholder="Tìm theo mã vận đơn, mã đơn, khách hàng..." class="w-full h-8 pl-8 pr-7 text-xs rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"/>
           - unexpected value "Ng"
      545 |     held.releaseLatest();
      546 |     held.releaseOne((url) => url.searchParams.get('search') === 'N');
--
      549 |     await page.getByRole('button', { name: /^Bộ lọc Trạng thái:/ }).click();
      550 |     await page.getByRole('option', { name: /Giao thất bại/ }).click();
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:547:26
    Error Context: test-results/storybook-data-table-revie-dccab-rch-cancels-the-newer-draft-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-dccab-rch-cancels-the-newer-draft-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-dccab-rch-cancels-the-newer-draft-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  3) [chromium] › e2e/storybook-data-table.spec.ts:595:5 › external Link cancels pending search draft
    Error: expect(locator).toHaveValue(expected) failed
    Locator:  getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
    Expected: "N"
    Received: "Ng"
    Timeout:  5000ms
--
      - Expect "toHaveValue" getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' }) with timeout 5000ms
      - waiting for getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
        14 × locator resolved to <input value="Ng" type="text" aria-label="Tìm theo mã vận đơn, mã đơn, khách hàng..." placeholder="Tìm theo mã vận đơn, mã đơn, khách hàng..." class="w-full h-8 pl-8 pr-7 text-xs rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"/>
           - unexpected value "Ng"
      618 |     held.releaseLatest();
      619 |     held.releaseOne((url) => url.searchParams.get('search') === 'N');
--
      622 |     await held.finish();
      623 |   }
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:620:26
```

### application-gate (job 126271951273) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```
