## Round 5 review (pl-task-ai-155-5, writer was agy07:gemini-3.8-flash-low)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 05010d778c1519c99797b7bc7151fcf4d4eb3c60

Phase 1 — checklist

1. **(a) Tenant scope — N/A.** The delta introduces fixture-backed presentation components; no tenant-owned server reads or writes.

2. **(b) Endpoint authorization/RBAC, empty scope denies — N/A.** No endpoints or server authorization logic change. This does not establish authorization coverage for future consumers.

3. **(c) Negative tests — P2: mobile focus tests do not exercise production behavior.** `apps/web/src/tests/data-table-dashboard.test.ts:1078` constructs fake focusables and manually implements wrapping/restoration. Those assertions still pass if `DashboardLayout` loses its focus trap or restoration effect. Add a mounted interaction test. Cross-tenant and endpoint-forbidden tests are N/A for this delta; malformed URL tests are present.

4. **(d) Work Item/specification behavior:**

   - **P1 — Overlapping selections within one facet still lose changes.** `apps/web/src/components/data-table/DataTableFacetedFilter.tsx:83` builds each selection from committed `selectedValues`; `apps/web/src/components/data-table/useDataTable.ts:313` then replaces that filter key. With navigation held, select `FAILED`, then `DELIVERED`: both handlers start from the same committed selection, so the second request contains only `DELIVERED`. The pending query accumulator preserves different keys, but cannot recover the discarded same-key selection. Preserve optimistic facet selections and test two selections in the same dropdown before either commits.
   - **P2 — Showcase primary actions are disconnected.** `apps/web/src/app/storybook/page.tsx:315` renders enabled export/create buttons without handlers. Implement explicitly identified fixture interactions or disable them with an explanation.
   - **P2 — Header invents an owner identity when user data is absent.** `apps/web/src/components/dashboard/DashboardHeader.tsx:251` falls back to an email and `Chủ Shop` badge. This contradicts the Work Item requirement that the profile menu respect authentication state. Render an explicit unavailable/unauthenticated state instead.

5. **(e) Integer VND — N/A to transactional arithmetic.** Fixture amounts are integers and display formatting introduces no fractional money calculation.

6. **(f) External-effect idempotency/timeouts/reconciliation — N/A.** No external commands or mutations are introduced.

7. **(g) Audit and PII/secret masking — N/A to operational audit.** No audited mutation, credential handling, or real customer data appears in the supplied delta; fixture phone numbers are masked.

8. **(h) UI states — P1: required forbidden state remains absent.** `apps/web/src/components/data-table/types.ts:79` exposes loading/error/empty inputs but no forbidden state; `apps/web/src/components/data-table/DataTable.tsx:195` proceeds from loading to empty/data rendering. Permission denial therefore has no dedicated presentation or recovery path. The Work Item’s residual limitations explicitly identify this as a shared-screen contract requirement. Loading, empty, error and retry implementations are present.

9. **(i) Previous-review findings:**

   - **#1 application accessibility gate — FIXED for the identified scanner violations.** The offending icon attributes are removed at `apps/web/src/components/data-table/DataTable.tsx:90` and `apps/web/src/components/data-table/DataTableColumnHeader.tsx:110`. Exact-head CI success is **unverified**: the supplied conclusions are blank.
   - **#2 simulated browser acceptance — FIXED in test implementation.** `apps/web/e2e/storybook-data-table.spec.ts:40` uses the mounted Next.js page and real Back/Forward; delayed-navigation cases hold actual RSC requests. Passing execution evidence is not supplied.
   - **#3 history/acknowledgment collision — FIXED in the supplied implementation.** `apps/web/src/components/data-table/useDataTable.ts:109` signals `popstate`; `apps/web/src/components/data-table/DataTableToolbar.tsx:79` clears pending edits for navigation. The mounted collision case begins at `apps/web/e2e/storybook-data-table.spec.ts:143`.
   - **#8 overlapping updates — NOT FIXED completely.** See finding 4’s P1 at `DataTableFacetedFilter.tsx:83`. The new browser test covers different facets, leaving same-facet accumulation broken.
   - **#6 unrelated handoff removal — FIXED in the supplied delta.** No unrelated handoff documents are changed, and the register hunk adds only the TASK-AI-155 row.
   - **#5 gate changes — N/A.** No workflow or allowlist changes appear in this delta.

Phase 2 — open sweep

10. **P2 — Select-all compares counts instead of current-page membership.** `apps/web/src/app/storybook/page.tsx:274` clears selection whenever `selectedIds.size === paginatedData.length`. Select three rows on page 1, then visit the three-row page 2: clicking its unchecked select-all clears selection instead of selecting page 2. Determine whether every current-page ID is selected.

11. **P2 — Selection-cell padding also activates the row.** `apps/web/src/components/data-table/DataTable.tsx:259` toggles selection when the cell itself is clicked, then allows the event to bubble into the row handler. A consumer supplying `onRowClick` receives both actions. Stop propagation for the selection cell.

12. **P2 — Column visibility exposes internal English identifiers.** `apps/web/src/components/data-table/DataTableViewOptions.tsx:106` falls back to `column.id` for functional headers. The showcase consequently displays `trackingCode`, `recipientName`, and `codAmount`, violating BR-UI-04. Supply a localized column label.

13. **P2 — Required sticky table header is missing.** `apps/web/src/components/data-table/DataTable.tsx:117` renders a regular `<thead>` without sticky positioning. Implement the Work Item’s specified sticky header.

14. **P2 — Dropdown accessibility remains incomplete.** `apps/web/src/components/data-table/DataTableColumnHeader.tsx:66` closes its menu without restoring trigger focus; its menu also lacks arrow-key navigation. `DataTableFacetedFilter.tsx:166` likewise provides no listbox arrow-key navigation. Icon controls also omit required titles, for example `DashboardSidebar.tsx:117`.

**Open P0/P1:** previous #8 remains P1; the additional P1 is the missing forbidden state. No P0 found. Review was limited to the supplied delta; no commands or files were accessed.

## Round 6 review (pl-task-ai-155-6, writer was agy01:gemini-3.8-flash-medium)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 95492a20ad8f8c9c9fd286315a543941dbb77fa4

1. **Phase 1 (a) Tenant scope — N/A.** No tenant-owned server reads or writes are introduced.

2. **(b) Endpoint authorization/RBAC, empty scope denies — N/A.** No endpoints change. This does not establish authorization coverage for future consumers.

3. **(c) Negative tests — P2: mounted focus-wrap coverage remains missing.** `apps/web/e2e/storybook-data-table.spec.ts:269` tests drawer dismissal and focus restoration through Escape, but never presses Tab or Shift+Tab. The unit tests now exercise the production handler, improving coverage, but cannot detect its removal from the mounted listener. Add mounted assertions for both wrapping directions. Forbidden-rendering and malformed-URL negative tests are present; cross-tenant endpoint tests are N/A.

4. **(d) Work Item/specification behavior — findings:**

   **P1 — Reset can leave pending facet selections active.** `apps/web/src/components/data-table/DataTableFacetedFilter.tsx:74` preserves optimistic selections whenever incoming and previous committed selections match, without recognizing an external reset. Reproduction: open `/storybook?search=GHN`, hold navigation, select `FAILED`, then click the toolbar’s reset button and allow that navigation to commit. Committed status remains empty, so the facet still displays `FAILED` as selected while the URL and rows are unfiltered. Selecting another status then reintroduces `FAILED`. Explicitly signal resets and discard pending selections even when the committed facet value is unchanged.

   **P2 — Permission-filtered navigation is not implemented.** `apps/web/src/components/dashboard/DashboardLayout.tsx:188` defaults to the complete navigation list, and `apps/web/src/components/dashboard/DashboardSidebar.tsx:136` renders every supplied item without a permission decision. An absent user still receives administrative navigation. This contradicts the Work Item’s checked constitution requirement that navigation filter by active-role permissions. Provide an explicit permission-filtered navigation contract and verify denied/empty permissions.

5. **(e) Integer VND — N/A to transactional arithmetic.** Supplied fixture amounts are integers; formatting introduces no fractional monetary calculation.

6. **(f) External-effect idempotency/timeouts/reconciliation — N/A.** Fixture creation is local, and export is a browser download. No carrier or other remote mutation is introduced.

7. **(g) Audit and PII/secret masking — N/A to operational audit.** No audited server mutation, credentials, or real customer records appear in the supplied delta. Fixture phone numbers are masked.

8. **(h) UI states — P2: sticky header repair is ineffective for page scrolling.** `apps/web/src/components/data-table/DataTable.tsx:117` places the sticky header inside overflow containers, including an `overflow-x-auto` ancestor without a bounded vertical viewport. Sticky positioning attaches to that ancestor rather than the page’s scrolling viewport; adding `sticky top-0` alone does not deliver the required scrolling behavior. Provide an appropriate vertical scroll container or restructure the ancestors, then verify by scrolling a mounted table. Loading, empty, error/retry, and dedicated forbidden presentation are implemented.

9. **(i) Prior-review findings — dispositions:**

   | Prior finding                                        | Status and evidence                                                                                                                                                                                                                                                                                     |
   | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Same-facet overlapping selections, P1                | **FIXED for the reported two-selection sequence.** `DataTableFacetedFilter.tsx:193` derives toggles from optimistic selections; acknowledgment handling preserves newer selections. The new reset defect is finding 4.                                                                                  |
   | Missing forbidden state, P1                          | **FIXED.** `apps/web/src/components/data-table/types.ts:87` exposes forbidden inputs; `DataTable.tsx:205` renders a dedicated denial message and recovery action instead of data rows.                                                                                                                  |
   | Mobile focus tests, P2                               | **NOT FIXED completely.** Production-handler coverage and mounted restoration were added; mounted wrapping remains absent, as described in finding 3.                                                                                                                                                   |
   | Disconnected showcase actions, P2                    | **FIXED.** `apps/web/src/app/storybook/page.tsx:315` implements fixture export and subsequent demo creation handlers, wired to the buttons.                                                                                                                                                             |
   | Invented owner identity, P2                          | **FIXED.** `DashboardHeader.tsx:251` displays an unavailable/unauthenticated identity; profile content is conditional on `currentUser`.                                                                                                                                                                 |
   | Select-all count comparison, P2                      | **FIXED.** `page.tsx:299` checks current-page membership and adds/removes that page’s IDs.                                                                                                                                                                                                              |
   | Selection-cell bubbling, P2                          | **FIXED.** `DataTable.tsx:302` stops propagation before toggling from cell padding.                                                                                                                                                                                                                     |
   | English column identifiers, P2                       | **FIXED for the showcase.** `DataTableViewOptions.tsx:106` prefers `column.title`; showcase column definitions supply Vietnamese titles.                                                                                                                                                                |
   | Sticky header, P2                                    | **NOT FIXED behaviorally.** See finding 8.                                                                                                                                                                                                                                                              |
   | Dropdown accessibility, P2                           | **NOT FIXED completely.** Column-header and facet navigation/restoration were added, but `DataTableViewOptions.tsx:54` still lacks trigger-focus restoration and its menu items lack arrow-key navigation. The search-clear icon button at `DataTableToolbar.tsx:201` still lacks the required `title`. |
   | Earlier application accessibility scanner violations | **FIXED for the identified attributes.** `DataTable.tsx:97` and `DataTableColumnHeader.tsx:155` remove the offending icon attributes. Exact-head CI success remains unverified.                                                                                                                         |
   | Earlier simulated browser acceptance                 | **FIXED in implementation.** `storybook-data-table.spec.ts:40` uses the mounted page and real browser history. The new same-facet test has a separate blocking defect in finding 11.                                                                                                                    |
   | Earlier history/acknowledgment collision             | **FIXED for the reported search collision.** `useDataTable.ts:109` signals history navigation; `DataTableToolbar.tsx:79` discards pending edits on that signal.                                                                                                                                         |
   | Earlier broad overlapping-update finding             | **NOT FIXED completely.** The same-facet case is repaired, but intermediate commits can still discard outstanding query changes; see finding 10.                                                                                                                                                        |
   | Earlier unrelated handoff removal                    | **FIXED.** The supplied delta contains no such removals; the register hunk only adds the TASK-AI-155 row.                                                                                                                                                                                               |
   | Earlier gate changes                                 | **N/A.** No workflow or allowlist changes appear in the supplied delta.                                                                                                                                                                                                                                 |

   Component filenames abbreviated in this table refer to their supplied dashboard/data-table paths.

10. **Phase 2 — P1: an intermediate commit discards newer pending query changes.** `apps/web/src/components/data-table/useDataTable.ts:210` uses pending intent only while the committed-params object remains identical. Starting from committed query C, request A with `status=FAILED`, then B with that status plus `carrier=GHN`. If A commits while B remains pending, a subsequent search composes from A because the identity changed, dropping the outstanding carrier selection. Retain outstanding intent across acknowledgments of earlier requests; invalidate it separately for external navigation. Test this with one continuously mounted hook and staggered commits.

11. **P1 — The added same-facet browser test cannot select its second option.** `apps/web/e2e/storybook-data-table.spec.ts:245` requests an option named `/Đã giao hàng/`, but `apps/web/src/app/storybook/fixtures.ts:136` labels the `DELIVERED` option **“Giao thành công.”** “Đã giao hàng” is table-cell text, not an option’s accessible name. The test times out before proving accumulation. Correct the selector and execute the mounted acceptance suite at this SHA.

12. **P2 — Out-of-range deep links present false empty results and invalid pagination.** `apps/web/src/app/storybook/page.tsx:130` slices using an unchecked page index, while `apps/web/src/components/data-table/DataTablePagination.tsx:45` calculates the range directly from it. `/storybook?page=3` therefore shows an empty-result explanation despite eight existing fixtures, with “Trang 3 / 1” and a reversed record range. Clamp or redirect the page against the available count.

13. **P2 — The reusable shell supplies a fabricated operational badge.** `apps/web/src/components/dashboard/DashboardLayout.tsx:76` hardcodes `badge: 3` for failed-delivery recovery in the default navigation. Consumers inherit a purported operational count without supplying data. Move that count into explicitly marked showcase fixtures and omit it from reusable defaults.

14. **Open severity summary:** No P0 found. **NEW P1:** reset preserving pending facets (4), intermediate commits losing pending query changes (10), and the nonmatching browser-test selector (11). The previous missing-forbidden P1 and specific same-facet selection P1 are repaired in code.

Review is limited to the supplied `origin/main...HEAD` delta. No commands or files were accessed. The supplied CI entries have blank conclusions, so they do not establish successful exact-head checks.

## Round 7 review (pl-task-ai-155-7, writer was agy02:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 4afbe4d8816101ab0bda7c90abf2beb217307973

1. **P1 — CI failing:** ai-brain-tests, application-gate, contract, current-application, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125720554139) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.522596ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.327365ms)
✔ the add path writes only the entry the registry accepts (6.15358ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (0.534464ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (0.688592ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.43452ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.368859ms)
✔ the validator is the gate and names every failing field (2.319337ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.224636ms)
--
  ✔ the secret never appears in the registry file (0.966941ms)
  ✔ the secret is not stored in plaintext anywhere (0.835268ms)
  ✔ listAccounts reports presence but never the value (1.064552ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.675962ms)
  ✔ a secret for an unknown account is refused (0.295806ms)
  ✔ removing an account destroys its secret (1.047626ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.287172ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.380928ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.419697ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.293083ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.275756ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.274263ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.140998ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.166997ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.313764ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.644399ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.195411ms)
  ✔ audit flags missing source URL or checked_on as error (0.17554ms)
  ✔ audit flags model version mismatch with offerings as warning (0.15533ms)
  ✔ production benchmarks.json passes audit with zero errors (0.11652ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (0.859926ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.308513ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.41381ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.169351ms)
  ✔ summary.pass counts records with no findings (0.30503ms)
  ✔ the audit prints the operator-console state lines (0.196954ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (5.15146ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (1.403915ms)
--
  ✔ shared-quota defaults to unknown (0.653768ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.172356ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (10.239381ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.142061ms)
  ✔ cross-account: success on one account is not inherited as verified by another (0.518099ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.079455ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.309397ms)
✔ evidence store (23.113066ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (50.637446ms)
    ✔ login-required excluded (37.189556ms)
    ✔ the adapter writes the expected job.json and maps each result state (2.028708ms)
```

### contract (job 125720555122) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### validate (job 125720554434) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### current-application (job 125720601164) — failing log lines

```
✨ SHIP DỄ — BỘ KIỂM TOÁN ĐỊNH DẠNG TĂNG TRƯỞNG (INCREMENTAL PRETTIER CHECK)
================================================================
Đã phát hiện và quét 21 tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:
❌ PHÁT HIỆN 11 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - apps/web/e2e/storybook-data-table.spec.ts
 - apps/web/e2e/support/review-gates.mjs
--
 - apps/web/src/components/data-table/types.ts
 - apps/web/src/components/data-table/useDataTable.ts
 - apps/web/src/tests/data-table-dashboard.test.ts
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 125721421744) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 8 review (pl-task-ai-155-8, writer was agy04:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 4b19380854322618a2b60ef38db267e1bc3f1832

1. **P1 — CI failing:** application-gate, contract, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 125740062715) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```

### current-application (job 125740103920) — failing log lines

```
  ✓  21 [chromium] › e2e/storybook-data-table.spec.ts:286:5 › review 3 P2: mobile drawer focus trap wraps focus and restores focus to hamburger trigger (562ms)
  ✓  22 [chromium] › e2e/storybook-data-table.spec.ts:326:5 › review 6 / finding 8 P2: table thead remains sticky at top during vertical scrolling (468ms)
  1) [chromium] › e2e/storybook-data-table.spec.ts:119:5 › mounted column sorting updates URL and preserves filters
    Error: expect(locator).toBeVisible() failed
    Locator: getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ })
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found
    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ }) with timeout 5000ms
--
      128 |
      129 |   // Click Tăng dần
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:126:27
    Error Context: test-results/storybook-data-table-mount-313bb-s-URL-and-preserves-filters-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-mount-313bb-s-URL-and-preserves-filters-chromium/trace.zip
--
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2) [chromium] › e2e/storybook-data-table.spec.ts:156:5 › mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment
    Test timeout of 30000ms exceeded.
    Error: locator.click: Test timeout of 30000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: /^Sắp xếp theo Thu hộ COD:/ })
--
      175 |   await page.waitForURL((url) => url.searchParams.get('sort') === 'codAmount.asc');
      176 |
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:173:73
    Error Context: test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/trace.zip
    Usage:
        pnpm exec playwright show-trace test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2 failed
    [chromium] › e2e/storybook-data-table.spec.ts:119:5 › mounted column sorting updates URL and preserves filters
    [chromium] › e2e/storybook-data-table.spec.ts:156:5 › mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment
  20 passed (53.2s)
/home/runner/work/shipde-platform/shipde-platform/apps/web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @shipde/web@3.3.0 test:a11y: `playwright test`
Exit status 1
##[error]Process completed with exit code 1.
```

### application-gate (job 125742517269) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 9 review (pl-task-ai-155-9, writer was agy06:gemini-3.8-flash-low)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: f51473f8bc76f21f6b5805535778d6b47f311691

1. **P1 — CI failing:** contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 125751291203) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```
