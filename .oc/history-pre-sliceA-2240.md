## Round 52 review (pl-task-ai-155-52, writer was opencode:ninerouter/dahl/MiniMaxAI/MiniMax-M2.7)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: e3dff46b6880a4fe146121dea5b00607167c54c4

Goal: TASK-AI-155 provides reusable server-driven tables and a responsive dashboard shell.
Touched acceptance requirements: URL pagination/sort/search/facet synchronization with transitions, accessible pagination/mobile navigation, and verification.
Scope: supplied part 1/4 only; no acceptance row identifiers or completed exact-head CI conclusions were supplied.

1. **PRIOR FINDINGS — P1 CI: NOT FIXED (resolution unverified)**

   WHERE: apps/web/e2e/storybook-data-table.spec.ts:234 (mounted popstate Back test; previous-review location), :692 (reset/facet test; previous-review location)
   WRONG: The supplied previous run returned `"Ngu"` instead of `"N"` on Back and lost the selected facet after reset. No passing exact-head rerun is provided; the current rollup omits current-application/application-gate and contains blank conclusions.
   GOAL: TASK-AI-155 verification requires working URL navigation and interactive filtering; the previous failing application gates must pass. Current failure is not established, but neither is resolution.
   VERIFY: Run `pnpm --filter @shipde/web test:a11y`; assert both named scenarios pass. Record command/results and exact-head current-application/application-gate SUCCESS evidence in the PR body.

2. **BLOCKING NEW FINDING — P1, AC/spec match**

   WHERE: apps/web/src/components/data-table/useDataTable.ts:194 (useTablecnDataTable)
   WRONG: A Next.js page supplies server-fetched page-one rows to `useDataTable({ columns, data, pageCount })`. Clicking page two updates URL/table pagination using default `shallow: true`, without refreshing the server-rendered data; the table retains page-one rows because pagination is manual.
   GOAL: TASK-AI-155’s server-driven table must refresh supplied server data when pagination, sorting, or filters change. Use maintained **nuqs** server navigation support with `shallow: false` and transition integration for the server default.
   VERIFY: Run scenario `server pagination refreshes supplied rows`: click page two on a server-fetched table and assert both the server request and displayed row IDs correspond to page two. Record command/result in the PR body.

3. **BLOCKING NEW FINDING — P1, AC/spec match**

   WHERE: apps/web/src/components/data-table/useDataTable.ts:572 (useShipdeDataTable/createQueryString)
   WRONG: Starting with no facets, select `status=pending`, then `carrier=ghtk` before the first router navigation commits. Both updates build from the same committed URL; the second navigation contains only `carrier=ghtk`, dropping the status selection.
   GOAL: TASK-AI-155 requires synchronized multi-select faceted URL state. Use maintained **nuqs `useQueryStates`** batching for the Ship Dễ hook; the unused pending reference at line 494 does not preserve successive edits.
   VERIFY: Run scenario `successive facet edits survive pending navigation`: delay the first navigation, select both facets, then assert the final URL and selected controls retain both values. Record command/result in the PR body; no committed test is requested.

SIZE: 2423 inserted lines in supplied part 1; cut apps/web/src/tests/data-table-tablecn.test.ts as a separate suite and consolidate required acceptance coverage into the Work Item’s designated data-table-dashboard.test.ts.

Follow-up (non-blocking): give pagination selectors per-instance IDs when composing multiple tables.VERDICT: CHANGES_REQUIRED
Reviewed SHA: e3dff46b6880a4fe146121dea5b00607167c54c4

Goal: TASK-AI-155 provides reusable server-driven tables and a responsive dashboard shell while preserving existing feature screens.
Acceptance touched: URL synchronization, accessible table states and selection, sidebar navigation, isolated fixtures, and browser verification.
Scope: supplied part 2/4 only; the acceptance matrix itself was not supplied.

1. WHERE: `apps/web/e2e/storybook-data-table.spec.ts:234,692` (Back-navigation and reset/facet tests) — **PRIOR FINDINGS: P1 NOT FIXED — unverified**.
   WRONG: The previous run observed `Ngu` instead of `N` and never observed the expected `status=DELIVERED` request. The supplied exact-head CI entries contain no conclusions and omit `current-application` and `application-gate`; they do not establish either failure was repaired.
   GOAL: AGENTS.md verification gate requires successful application checks. Demonstrate both previously failing scenarios and both required jobs passing at the reviewed SHA.
   VERIFY: Run `pnpm --filter @shipde/web test:a11y` and `gh pr checks 493`; provide commands and results in the PR body, with successful exact-head application checks.

2. WHERE: `apps/web/src/components/data-table/DataTableToolbar.tsx:98` (`DataTableToolbar.handlePopstate`; synchronization effect at line 108) — **BLOCKING NEW FINDINGS: P1, AC/spec match**.
   WRONG: With mounted history entries `?search=An&page=1` and `?search=An&page=2`, type `Ng`, then press Back before the debounce expires. The handler only sets a ref. Because `searchValue` remains `An`, the synchronization effect does not run: the textbox retains `Ng`, and its pending timer dispatches the abandoned search after Back.
   GOAL: The Work Item’s URL synchronization requirement and BR-UI-01 require Back to restore the selected URL state and cancel abandoned drafts even when the search parameter is unchanged. Reuse the maintained `sadmann7/shadcn-table` URL-state synchronization pattern instead of extending this independent history tracker.
   VERIFY: Temporary browser check `back_same_search_cancels_pending_draft`: perform that sequence, wait beyond the debounce, and assert input/search remain `An`, page remains `1`, and no `Ng` dispatch occurs. Record the command and result in the PR body; no committed test is requested.

SIZE: 2387 lines, cut `apps/web/src/components/data-table/lib/data-table-filters.ts` — supplied-part insertion count; its advanced client-side filtering engine is not required by the supplied server-driven table acceptance requirements.

Follow-up (non-blocking): `storybook-data-table.spec.ts:670` accepts `Ng`/`Ngu` through loose final matchers despite requiring exactly `N`; tighten the verification evidence.VERDICT: CHANGES_REQUIRED
Reviewed SHA: e3dff46b6880a4fe146121dea5b00607167c54c4

TASK-AI-155 delivers reusable server-driven tables and a responsive dashboard shell with accessible Vietnamese states and isolated fixtures.
This part touches AC-AI-155-01–11 through showcase composition, particularly -05 (sorting), -08 (page header), -10 (URL helpers), and -11 (fixtures).

1. **PRIOR FINDINGS — P1: NOT FIXED (closure unverified).**
   WHERE: apps/web/e2e/support/review-gates.mjs:191 (`review 37` test).
   WRONG: The previous mounted Back scenario expected `N` but received `Ngu`. These source-string assertions do not exercise that behavior or the previously failing reset/facet scenario. The supplied exact-HEAD CI list contains no conclusions proving either application gate passed.
   GOAL: BR-UI-01 requires navigation and filter state synchronization; the previous CI finding requires successful `current-application` and `application-gate` results. Neither closure is demonstrated by this part.
   VERIFY: Run `pnpm --filter @shipde/web test:a11y`; the existing “mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment” and “review 12 P2: a facet selected after reset survives the empty reset acknowledgment” cases must pass. Record command/results in the PR body and provide both application gates’ SUCCESS conclusions at this SHA.

Blocking new findings: None established in supplied part 3/4.

Follow-up (non-blocking): Align showcase page-size choices `[5, 10, 20]` with AC-AI-155-06’s `[10, 20, 50, 100]`.

SIZE: 2151 lines in supplied part 3/4, cut apps/web/e2e/support/review-gates.mjs (historical review scaffolding; no acceptance row requires it).VERDICT: CHANGES_REQUIRED
Reviewed SHA: e3dff46b6880a4fe146121dea5b00607167c54c4

TASK-AI-155 should provide reusable server-driven tables and a responsive dashboard shell while preserving existing feature screens.
This part touches dashboard header actions, faceted selection, unit-test integration, licensing, and the runtime-dependency constraint.
Numbered acceptance rows were not supplied; review is limited to part 4/4 and the stated requirements.

1. **PRIOR FINDINGS — P1: NOT FIXED (closure unverified).**
   WHERE: apps/web/e2e/storybook-data-table.spec.ts:234 and :692 (Back-restoration and post-reset facet tests; locations from the supplied previous logs).
   WRONG: Previously, Back restored `Ngu` instead of `N`, and selecting a facet after Reset lost the selection. This part supplies neither the relevant implementation repair nor passing browser results. The supplied head CI entries have blank conclusions and omit `current-application` and `application-gate`; they do not establish resolution.
   GOAL: TASK-AI-155 URL synchronization must restore browser-history state and preserve subsequent facet selections; both required application checks must pass.
   VERIFY: Run `pnpm --filter @shipde/web test:a11y`; existing tests “mounted popstate Back arriving at a previously drafted value is not dropped as an acknowledgment” and “review 12 P2: a facet selected after reset survives the empty reset acknowledgment” must pass their respective assertions. Record command/results and both application checks’ exact-SHA `SUCCESS` evidence in the PR body; no additional committed test requested.

BLOCKING NEW FINDINGS: None established from the supplied part.

SIZE: 4869 lines, cut apps/web/src/tests/data-table-dashboard.test.ts (non-AC PR-body/template checks, simulated review-history proofs, and duplicated test machinery; retain AC coverage). Count covers supplied part only, excluding lockfile.

Follow-up (non-blocking): Reconcile the added `@tanstack/react-table` and `nuqs` runtime dependencies with the Work Item’s explicit no-new-runtime-dependencies constraint.

## Round 57 review (pl-task-ai-155-57, writer was agy05:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 3e2f1a38b3691eda9803a0df788727400aa00a8f

1. **P1 — CI failing:** ai-brain-tests. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126624002724) — failing log lines
```
  ✔ capabilities the operator declares are carried through (0.712576ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.737993ms)
✔ the add path writes only the entry the registry accepts (15.345824ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (1.140146ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.482485ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.960224ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.615516ms)
✔ the validator is the gate and names every failing field (5.124633ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (1.054741ms)
--
  ✔ the secret never appears in the registry file (1.070587ms)
  ✔ the secret is not stored in plaintext anywhere (1.434568ms)
  ✔ listAccounts reports presence but never the value (1.959896ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.843535ms)
  ✔ a secret for an unknown account is refused (0.319545ms)
  ✔ removing an account destroys its secret (1.397601ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (2.747911ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.307688ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.258896ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.369092ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.365251ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.389193ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.136983ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.126155ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.180524ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.529515ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.202044ms)
  ✔ audit flags missing source URL or checked_on as error (0.175249ms)
  ✔ audit flags model version mismatch with offerings as warning (0.138008ms)
  ✔ production benchmarks.json passes audit with zero errors (0.121194ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.100896ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.497226ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.820971ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.194759ms)
  ✔ summary.pass counts records with no findings (0.283793ms)
  ✔ the audit prints the operator-console state lines (0.293097ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (6.18587ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.59019ms)
--
  ✔ shared-quota defaults to unknown (1.116678ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.210983ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (11.992188ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (2.73475ms)
  ✔ cross-account: success on one account is not inherited as verified by another (2.047236ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.842286ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.355024ms)
✔ evidence store (34.61295ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (38.019872ms)
    ✔ login-required excluded (36.108975ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.620411ms)
```
