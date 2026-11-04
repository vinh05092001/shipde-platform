## Round 46 review (pl-task-ai-155-46, writer was agy03:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 607be516170b498eec480e8edbf3a9c383b53d55

1. **P1 — CI failing:** ai-brain-tests, application-gate, contract, current-application, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126341581543) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.445599ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.348834ms)
✔ the add path writes only the entry the registry accepts (6.882495ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (1.424509ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (0.71936ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.863166ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.394973ms)
✔ the validator is the gate and names every failing field (3.724523ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.775945ms)
--
  ✔ the secret never appears in the registry file (1.549407ms)
  ✔ the secret is not stored in plaintext anywhere (1.044208ms)
  ✔ listAccounts reports presence but never the value (1.375305ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.663527ms)
  ✔ a secret for an unknown account is refused (0.237897ms)
  ✔ removing an account destroys its secret (0.993302ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (2.314115ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.247361ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.17961ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.409445ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.324217ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.250295ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.11373ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.134682ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.105228ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.070699ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.148302ms)
  ✔ audit flags missing source URL or checked_on as error (0.143405ms)
  ✔ audit flags model version mismatch with offerings as warning (0.1197ms)
  ✔ production benchmarks.json passes audit with zero errors (0.09333ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (0.674933ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.792091ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.732161ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.149935ms)
  ✔ summary.pass counts records with no findings (0.318639ms)
  ✔ the audit prints the operator-console state lines (0.170866ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (6.064546ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (1.555956ms)
--
  ✔ shared-quota defaults to unknown (0.546171ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.144136ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (7.477458ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.362756ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.359582ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.086311ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.931199ms)
✔ evidence store (21.979704ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (26.257698ms)
    ✔ login-required excluded (27.514595ms)
    ✔ the adapter writes the expected job.json and maps each result state (2.065802ms)
```

### contract (job 126341582435) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### validate (job 126341582215) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### current-application (job 126341630414) — failing log lines

```
  ✓  30 [chromium] › e2e/storybook-data-table.spec.ts:595:5 › external Link cancels pending search draft (1.3s)
  ✘  31 [chromium] › e2e/storybook-data-table.spec.ts:628:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment (5.5s)
  1) [chromium] › e2e/storybook-data-table.spec.ts:251:5 › review 4: mounted successive facets retain earlier changes during delayed navigation
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: "FAILED"
    Received: null
      268 |       .toBe(true);
      269 |     const carrierRequest = held.requests.find((url) => url.searchParams.get('carrier') === 'GHN')!;
    > 270 |     expect(carrierRequest.searchParams.get('status')).toBe('FAILED');
          |                                                       ^
      271 |     // A third edit must preserve both prior intents, before any request commits.
      272 |     await search.fill('Ng');
      273 |     await expect
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:270:55
    Error Context: test-results/storybook-data-table-revie-6e701-s-during-delayed-navigation-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-6e701-s-during-delayed-navigation-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-6e701-s-during-delayed-navigation-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2) [chromium] › e2e/storybook-data-table.spec.ts:295:5 › review 4 / finding 4 P1: mounted overlapping selections in the same facet dropdown accumulate without losing prior selections
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: true
    Received: false
    Call Log:
--
      321 |     await held.finish();
      322 |   }
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:319:8
    Error Context: test-results/storybook-data-table-revie-a38fc-out-losing-prior-selections-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-a38fc-out-losing-prior-selections-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-a38fc-out-losing-prior-selections-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  3) [chromium] › e2e/storybook-data-table.spec.ts:460:5 › review 10 / finding 11 P2: reset filters applies empty search immediately even when reset navigation is held
    Error: expect(locator).toHaveValue(expected) failed
    Locator:  getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
    Expected: ""
    Received: "An"
    Timeout:  5000ms
--
      - Expect "toHaveValue" getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' }) with timeout 5000ms
      - waiting for getByRole('textbox', { name: 'Tìm theo mã vận đơn, mã đơn, khách hàng...' })
        14 × locator resolved to <input value="An" type="text" aria-label="Tìm theo mã vận đơn, mã đơn, khách hàng..." placeholder="Tìm theo mã vận đơn, mã đơn, khách hàng..." class="w-full h-8 pl-8 pr-7 text-xs rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"/>
           - unexpected value "An"
      475 |
      476 |     // Target value must be applied immediately, not temporarily restoring 'An' while reset navigation is in-flight
--
      479 |     await held.finish();
      480 |   }
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:477:26
    Error Context: test-results/storybook-data-table-revie-2f842-en-reset-navigation-is-held-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-2f842-en-reset-navigation-is-held-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-2f842-en-reset-navigation-is-held-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  4) [chromium] › e2e/storybook-data-table.spec.ts:490:5 › review 12 P1: page navigation keeps a pending page-size change while navigation is held
    Error: expect(received).toBe(expected) // Object.is equality
```

### application-gate (job 126343364076) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 47 review (pl-task-ai-155-47, writer was agy05:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 3e93b75211ec85779b04d555b594bf9b043f8730

TASK-AI-155 provides reusable URL-driven tables and a responsive dashboard shell, preserving existing feature screens.
This delta touches AC-AI-155-01–11: table states, sorting, pagination, filters, dashboard composition, accessibility, and fixture isolation.

1. **PRIOR FINDINGS — P1 #1: NOT FIXED (AC/spec match)**

   WHERE: apps/web/src/components/data-table/useDataTable.ts:130 (getNextQueryBase)

   WRONG: On `/storybook`, hold the navigation selecting status=FAILED, then select carrier=GHN before the first commit. The second request builds from the unchanged committed parameters and drops status=FAILED. The previously failing overlapping-facet path remains reachable; the supplied exact-head CI entries also contain no SUCCESS verdicts.

   GOAL: BR-UI-01 and AC-AI-155-07 require preserving successive filter selections. Reuse the maintained URL-state implementation from `sadmann7/shadcn-table`. Close the prior aggregate CI finding with SUCCESS evidence for all five previously failing checks at this SHA.

   VERIFY: `pending facet edits compose before commit`: keep the status request held throughout the carrier selection; assert both the carrier request and settled URL contain status=FAILED and carrier=GHN.

2. **BLOCKING NEW FINDINGS — P1 (UI states / AC/spec match)**

   WHERE: apps/web/src/components/data-table/DataTableToolbar.tsx:120 (DataTableToolbar synchronization effect)

   WRONG: Starting with empty search, type “N” and hold its dispatched navigation. Type “Ng”, then release the “N” response before the newer 300 ms debounce expires. The acknowledgment changes searchValue to “N”; the effect overwrites “Ng” and cancels its timer. The user’s latest search disappears and never reaches the URL.

   GOAL: BR-UI-01 requires preserving the latest search intent while URL updates settle. Reuse `sadmann7/shadcn-table`’s maintained debounced URL-state implementation so an earlier owned acknowledgment preserves newer typing.

   VERIFY: `own search acknowledgment preserves newer draft`: reproduce that sequence; assert the textbox retains “Ng” and subsequently dispatches search=Ng.

Follow-up (non-blocking): Several pending-navigation tests release the first request before the second interaction; settled search assertions accept “Ng” when expecting “N”; review-gates.mjs still requires an absent reset-release source string, so its documented PASS claim needs correction.

## Round 49 review (pl-task-ai-155-49, writer was agy05:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: c4cb2e120a425cc857fd62439ccee500d9742a5e

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126383967428) — failing log lines

```
  ✓  32 [chromium] › e2e/storybook-data-table.spec.ts:676:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment (524ms)
  1) [chromium] › e2e/storybook-data-table.spec.ts:495:5 › review 12 P1: page navigation keeps a pending page-size change while navigation is held
    Test timeout of 30000ms exceeded.
    Error: page.unrouteAll: Target page, context or browser has been closed
      53 |         if (target) target.resolve();
      54 |       }
--
      58 | }
        at Object.finish (/home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:55:7)
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:517:5
    Error Context: test-results/storybook-data-table-revie-57851-ge-while-navigation-is-held-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-57851-ge-while-navigation-is-held-chromium/trace.zip
    Usage:
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-57851-ge-while-navigation-is-held-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  1 failed
    [chromium] › e2e/storybook-data-table.spec.ts:495:5 › review 12 P1: page navigation keeps a pending page-size change while navigation is held
  31 passed (52.8s)
/home/runner/work/shipde-platform/shipde-platform/apps/web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @shipde/web@3.3.0 test:a11y: `playwright test`
Exit status 1
##[error]Process completed with exit code 1.
```

### application-gate (job 126385256271) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 50 review (pl-task-ai-155-50, writer was agy03:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 830f3c4a258a6410bba7b728801187c469c37e14

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126404060973) — failing log lines

```
  ✓  31 [chromium] › e2e/storybook-data-table.spec.ts:641:5 › external Link cancels pending search draft (909ms)
  ✘  32 [chromium] › e2e/storybook-data-table.spec.ts:674:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment (5.6s)
  1) [chromium] › e2e/storybook-data-table.spec.ts:202:5 › mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: "N"
    Received: "Ngu"
      232 |       .toBe(true);
--
      236 |     // Back two entries to the existing "Ng" value, which also appears in
      237 |     // pending edits ["Ng", "Ngu"]. Equality alone cannot identify this event.
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:234:60
    Error Context: test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/trace.zip
--
        pnpm exec playwright show-trace test-results/storybook-data-table-mount-de0df-ropped-as-an-acknowledgment-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2) [chromium] › e2e/storybook-data-table.spec.ts:674:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment
    Error: expect(received).toBe(expected) // Object.is equality
    Expected: true
    Received: false
    Call Log:
--
      694 |
      695 |     await expect(page.getByRole('button', { name: 'Bộ lọc Trạng thái: 1 đã chọn' })).toBeVisible();
        at /home/runner/work/shipde-platform/shipde-platform/apps/web/e2e/storybook-data-table.spec.ts:692:8
    Error Context: test-results/storybook-data-table-revie-61bb8--empty-reset-acknowledgment-chromium/error-context.md
    attachment #2: trace (application/zip) ─────────────────────────────────────────────────────────
    test-results/storybook-data-table-revie-61bb8--empty-reset-acknowledgment-chromium/trace.zip
    Usage:
        pnpm exec playwright show-trace test-results/storybook-data-table-revie-61bb8--empty-reset-acknowledgment-chromium/trace.zip
    ────────────────────────────────────────────────────────────────────────────────────────────────
  2 failed
    [chromium] › e2e/storybook-data-table.spec.ts:202:5 › mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment
    [chromium] › e2e/storybook-data-table.spec.ts:674:5 › review 12 P2: a facet selected after reset survives the empty reset acknowledgment
  30 passed (35.0s)
/home/runner/work/shipde-platform/shipde-platform/apps/web:
[ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL] @shipde/web@3.3.0 test:a11y: `playwright test`
Exit status 1
##[error]Process completed with exit code 1.
```

### application-gate (job 126405647167) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```
