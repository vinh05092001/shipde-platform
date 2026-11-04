## Round 61 review (pl-task-ai-169-61, writer was agy05:claude-sonnet-4-6)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: b36eac2c91516c8fc108a511d9f502cabf0066f2

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126221109534) — failing log lines

```
Đã phát hiện và quét 3 tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:
 - .oc/pr-body.md
 - tools/ai-brain/run-ledger.js
❌ PHÁT HIỆN 1 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - tools/ai-brain/test/run-ledger.test.js
 - .oc/pr-body.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126222274010) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 62 review (pl-task-ai-169-62, writer was agy03:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 200f12a37841c226c818d1d592299ea10f4eb23e

TASK-AI-169 should unify execution traces and attempt/time/token accounting across delivery stages.
The delta must satisfy AC-01–14, particularly retry deduplication, UNKNOWN token accounting, reservation completion, goal rollups, credential masking, and ProgressLedger schema compatibility.

Phase 1 checklist:

- (a) N/A: no tenant-owned reads or writes.
- (b) N/A: no endpoints or RBAC changes.
- (c) Validation and budget rejection tests are present; missing regression tests are identified in VERIFY below. Cross-tenant and forbidden-endpoint tests are N/A.
- (d) NEW P1: findings 1–5 contradict the acceptance matrix at tools/ai-brain/run-ledger.js:118, :280, :330, :129, and :361.
- (e) N/A: no money calculations or currency conversion.
- (f) N/A: no external effects. Internal reservation deduplication defects appear in findings 1–2.
- (g) N/A: no concrete credential-masking defect established from the supplied delta; execution records and recursive route masking are present.
- (h) N/A: no UI changes.
- (i) Previous P1 CI failure: **NOT FIXED (unverified)**. [.oc/pr-body.md:80] claims formatting PASS, but the supplied exact-head CI entries contain no conclusions. Neither failing gate is demonstrated green.

1. WHERE: tools/ai-brain/run-ledger.js:118 (RunLedger.admit / RunLedger.record) — NEW P1
   WRONG: With item attempts capped at 1, `admit({itemId:'T',stage:'writer',attemptId:'a1',reserve:true,pid:process.pid})` reserves `__probe__a1`; recording the same identifiers without an explicit fingerprint selects `att-a1` and returns `ATTEMPTS_EXHAUSTED`.
   GOAL: BR-LEDGER-07 / AC-09 require the matching attempt to complete its reservation without another attempt charge.
   VERIFY: Add `default_fingerprint_reservation_completes_once`: assert admission and completion both succeed and item/global attempts remain 1.

2. WHERE: tools/ai-brain/run-ledger.js:280 (RunLedger.record) — NEW P1
   WRONG: Record `IN_FLIGHT` twice for item T, attempt a1, fingerprint F with attempts capped at 1; the second record recognizes the reservation, bypasses the attempt check, then increments item/global attempts to 2.
   GOAL: BR-LEDGER-04/07 and AC-08/09 require repeated records for one attempt to consume exactly one attempt.
   VERIFY: Add `repeated_in_flight_record_counts_once`: assert both records succeed, elapsed time accumulates, and item/global attempts remain 1.

3. WHERE: tools/ai-brain/run-ledger.js:330 (RunLedger.record) — NEW P1
   WRONG: Record completed attempt a1 with 100 tokens, then record a CLI retry of a1 without tokens; the retry contains `UNKNOWN`/`UNENFORCED`, but item/global `tokensUnknown` remain 0.
   GOAL: BR-LEDGER-05 / AC-02 require summaries to track missing token measurements across retry layers.
   VERIFY: Add `completed_retry_tracks_unknown_tokens`: assert the retry is UNKNOWN/UNENFORCED, known tokens remain 100, and item/global `tokensUnknown` become 1.

4. WHERE: tools/ai-brain/run-ledger.js:129 (RunLedger.admit) — NEW P1
   WRONG: Complete writer attempt a1 for item T and goal G, then successfully reserve a distinct repair attempt a2 for T/G; the existing T/G run triggers `alreadyChargedInRuns`, leaving `goals.G.attempts` at 1 while item/global attempts become 2.
   GOAL: BR-LEDGER-10 / AC-13 require every distinct goal-associated reservation to increment its goal counter once.
   VERIFY: Add `second_reservation_for_same_item_charges_goal`: assert the second reservation succeeds and item, global, and G attempts all equal 2.

5. WHERE: tools/ai-brain/run-ledger.js:361 (RunLedger.record) — NEW P1
   WRONG: Reserve T/F for goal G, then complete the matching attempt with `ms:100,tokens:10` while omitting `goalId`; G retains zero elapsed time and tokens, and the completion trace has `goalId:null`.
   GOAL: BR-LEDGER-07/10 and AC-13 require reservation completion to preserve its established goal association and accurate goal rollups.
   VERIFY: Add `completion_inherits_reserved_goal`: assert the completion trace retains G and `goals.G.ms === 100`, `goals.G.tokens === 10`, and `goals.G.attempts === 1`.

Phase 2 open sweep:

6. WHERE: tools/ai-brain/run-ledger.js:347 (RunLedger.record) — NEW P1
   WRONG: Record writer attempt a1/F as `IN_FLIGHT`, then record fallback a1/F as `IN_FLIGHT`; the existing-attempt branch removes the writer fingerprint and writes the fallback record without `pid`, violating the IN_FLIGHT schema.
   GOAL: AC-14 requires every persisted IN_FLIGHT record to have a valid PID and remain loadable through ProgressLedger.
   VERIFY: Add `cross_stage_in_flight_retry_preserves_schema`: assert both records and subsequent ProgressLedger loading succeed, the fallback PID is a positive integer, and attempts remain 1.

7. WHERE: tools/ai-brain/run-ledger.js:363 (RunLedger.record) — NEW P1
   WRONG: After recording an ordinary goal G and reloading its JSON, record another item with `goalId:'__proto__'`; lookup returns `Object.prototype`, counter updates mutate that prototype, and serialization creates no own goal entry for the attempt.
   GOAL: BR-LEDGER-10 requires accurate goal counters; identifiers must not mutate object prototypes or silently discard accounting.
   VERIFY: Add `prototype_named_goal_is_refused_without_mutation`: assert this goal ID is rejected before writing, `Object.prototype` remains unchanged, and persisted counters remain unchanged.

Follow-up (non-blocking): FEATURE-DELIVERY-REGISTER.csv:273 introduces another TASK-AI-167 row alongside the existing row at :274.

## Round 63 review (pl-task-ai-169-63, writer was agy02:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: f27314e0a8a29eec77fa79ad80be0dc263ec1ab9

TASK-AI-169 should unify execution traces and attempt/time/token budgets across writer, reviewer, repair, and fallback.
The delta touches AC-01–14, including retry deduplication, UNKNOWN tokens, reservation completion, goal rollups, credential masking, and ProgressLedger compatibility.

Phase 1 checklist:

- (a) N/A: no tenant-owned reads or writes.
- (b) N/A: no endpoints or RBAC changes.
- (c) Ledger validation and budget-denial negative tests are present. Missing regression coverage is specified in findings 1–6. Cross-tenant and forbidden-endpoint tests are N/A.
- (d) NEW P1: findings 1–5 at `run-ledger.js:261`, `:345`, `:144`, `:308`, and `:142` violate reservation, accounting, or schema acceptance requirements.
- (e) N/A: no money calculations or currency conversion.
- (f) N/A: no external effects. Internal reservation isolation fails in finding 2.
- (g) NEW P1: finding 6 at `run-ledger.js:22` exposes credentials in persisted route identities. Execution traces are present.
- (h) N/A: no UI changes.
- (i) Previous findings:
  - 1 **FIXED** for the supplied default-fingerprint scenario: `run-ledger.js:118` and `:266` align admission and completion fingerprints.
  - 2 **FIXED**: `run-ledger.js:278` prevents an existing attempt from consuming another attempt.
  - 3 **FIXED**: `run-ledger.js:376` increments missing-token counters on completed retries.
  - 4 **FIXED** for the supplied sequential scenario: `run-ledger.js:135` distinguishes the second reservation from completed goal attempts.
  - 5 **FIXED** for the supplied sequential scenario: `run-ledger.js:294` inherits the reserved goal. The concurrent path remains defective in finding 5 below.
  - 6 **FIXED**: `run-ledger.js:392` and `:403` provide a positive PID for cross-stage IN_FLIGHT records.
  - 7 **FIXED** for the supplied `__proto__` scenario: `run-ledger.js:208` rejects it and `:418` uses an own-property lookup. Other inherited identifiers remain defective below.
  - Previous CI P1: **NOT FIXED (unverified)**. The supplied exact-head checks contain no conclusions; author PASS claims do not establish successful remote gates.

1. WHERE: tools/ai-brain/run-ledger.js:261 (RunLedger.record) — NEW P1  
   WRONG: Reserve writer attempt `a1` for item `T` with explicit fingerprint `F`, then record the same attempt without a fingerprint; the matching-reservation search executes `fp = existingFp` although `fp` is declared `const`, throwing `TypeError: Assignment to constant variable`.
   GOAL: BR-LEDGER-07 / AC-09 require matching attempt identifiers to complete their reservation without another attempt charge.
   VERIFY: Add `explicit_reservation_completes_by_attempt_id`: reserve `T/F/a1`, complete `T/a1` without `fp`, and assert successful completion with item/global attempts remaining 1.

2. WHERE: tools/ai-brain/run-ledger.js:345 (RunLedger.record) — NEW P1  
   WRONG: With attempt cap 2, record writer `a1/F` as IN_FLIGHT, then record distinct writer `a2/F` as DONE; `reserved` is false for `a2`, but the unchanged IN_FLIGHT fingerprint is passed to `recordUnlocked` as a reservation completion, leaving two distinct attempts charged as one.
   GOAL: BR-LEDGER-08 / AC-12 prohibit a distinct attempt from consuming another attempt’s reservation credit.
   VERIFY: Add `distinct_completion_cannot_hijack_in_flight_fingerprint`: assert `a2/F` is refused, `a1/F` remains IN_FLIGHT, and item/global attempts remain 1.

3. WHERE: tools/ai-brain/run-ledger.js:144 (RunLedger.admit) — NEW P1  
   WRONG: After persisting ordinary goal `G`, reserve another item with `goalId:'toString'`; the inherited `Object.prototype.toString` function becomes `gAcc`, receives an `attempts` property, and is omitted during JSON serialization, so the accepted reservation has no persisted goal counter.
   GOAL: BR-LEDGER-10 / AC-13 require accurate goal rollups without mutating inherited objects or silently discarding accounting.
   VERIFY: Add `inherited_goal_name_is_refused_without_mutation`: assert admission rejects `toString` before writing, the ledger bytes remain unchanged, and `Object.prototype.toString` gains no `attempts` property.

4. WHERE: tools/ai-brain/run-ledger.js:308 (RunLedger.record) — NEW P1  
   WRONG: After an ordinary item is persisted, record IN_FLIGHT item `toString` with attempt `a2`; the inherited native function becomes `curIt`, receives `spent` and `stages`, and serializes without an own item entry while the global attempt counter is charged.
   GOAL: AC-14 requires persisted item accounting and IN_FLIGHT metadata to remain valid; identifiers must not mutate inherited objects.
   VERIFY: Add `inherited_item_name_is_refused_without_mutation`: assert recording item `toString` rejects before writing, global counters remain unchanged, and `Object.prototype.toString` gains neither `spent` nor `stages`.

5. WHERE: tools/ai-brain/run-ledger.js:142 (RunLedger.admit) — NEW P1  
   WRONG: During the gap between underlying reservation admission and the second lock, another ledger completes that reservation with `ms:100,tokens:10` and no `goalId`; the callback subsequently attaches goal `G` and charges its attempt, but leaves the completion trace at `goalId:null` and `goals.G.ms/tokens` at zero.
   GOAL: BR-LEDGER-07/10 / AC-13 require completion to preserve the reservation’s goal association and include its elapsed time and tokens in goal rollups.
   VERIFY: Extend `concurrent_completion_without_goal_preserves_reserved_goal_charge` with `tokens:10`; assert the completion trace has goal `G`, and G has attempts 1, ms 100, and tokens 10.

6. WHERE: tools/ai-brain/run-ledger.js:22 (maskCredentials) — NEW P1  
   WRONG: Recording `route.endpoint:'https://api.example/v1?api_key=privateValue'` preserves `privateValue` in the returned route and ledger JSON because parsed URL query credentials are never masked.
   GOAL: BR-LEDGER-06 / AC-05–06 require sensitive credentials in route identities to be masked before persistence.
   VERIFY: Add `masks_sensitive_url_query_credentials`: record an endpoint containing `api_key=privateValue` and assert neither the returned route nor persisted JSON contains `privateValue`.

Phase 2 open sweep: No additional NEW P0/P1 findings.

Follow-up (non-blocking): `FEATURE-DELIVERY-REGISTER.csv:274` adds a second TASK-AI-167 row alongside the existing row at :275.

## Round 64 review (pl-task-ai-169-64, writer was agy01:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 02d7d28a363c7098b21a97d6aac1d132b97bd681

TASK-AI-169 should unify execution traces and attempt/time/token budgets across writer, reviewer, repair, and fallback.
The delta touches AC-01–14: execution chains, retry deduplication, UNKNOWN tokens, reservations, goal accounting, credential masking, and ProgressLedger compatibility.

Phase 1 checklist:

- (a) N/A: no tenant-owned reads or writes.
- (b) N/A: no endpoints or RBAC changes.
- (c) Validation and budget-denial negative tests are present. Missing regression coverage is specified in findings 1–4. Cross-tenant and forbidden-endpoint tests are N/A.
- (d) NEW P1: findings 1–4 at `tools/ai-brain/run-ledger.js:338`, `:289`, `:166`, and `:382` violate reservation isolation, deduplication, goal accounting, or persisted-state requirements.
- (e) N/A: no monetary calculations.
- (f) N/A: no external effects. Internal reservation defects appear in findings 1–2.
- (g) NEW P1: finding 4 loses accepted IN_FLIGHT audit state. The previously reported URL query credential leak is fixed.
- (h) N/A: no UI changes.
- (i) Previous review findings:
  - Previous #1 **FIXED**: `run-ledger.js:281` declares mutable `fp`; `:306` safely selects the matching reservation fingerprint.
  - Previous #2 **FIXED** for the reported DONE completion: `run-ledger.js:338` refuses another attempt’s completion. The IN_FLIGHT collision remains defective in finding 1.
  - Previous #3 **FIXED**: `run-ledger.js:127` rejects inherited goal identifiers before admission; `:158` uses an own-property lookup.
  - Previous #4 **FIXED**: `run-ledger.js:250` rejects inherited item identifiers before recording; `:356` uses an own-property lookup.
  - Previous #5 **FIXED** for the reported concurrent completion: `run-ledger.js:166`–`:180` associates the completion with its goal and transfers elapsed time and tokens. Finding 3 reports incorrect attribution of earlier attempts.
  - Previous #6 **FIXED**: `run-ledger.js:26`–`:28` redact sensitive URL query parameters.
  - Previous CI P1 **NOT FIXED (unverified)**: supplied exact-head checks still contain no conclusions establishing successful remote gates.

1. WHERE: tools/ai-brain/run-ledger.js:338 (RunLedger.record) — NEW P1  
   WRONG: Reserve writer `T/F/a1` under attempt cap 2, then record distinct writer `T/F/a2` as IN_FLIGHT; the ownership guard is skipped and `:382` replaces a1’s reservation with a2. Completing a1 is subsequently refused.
   GOAL: BR-LEDGER-07/08 and AC-09/12 require another attempt to leave the original reservation intact and completable.
   VERIFY: Add `distinct_in_flight_record_cannot_overwrite_reservation`: assert a2 is refused without changing a1’s fingerprint record, then assert a1 completes successfully with item/global attempts remaining 1.

2. WHERE: tools/ai-brain/run-ledger.js:289 (RunLedger.record) — NEW P1  
   WRONG: Reserve writer `T/F/a1` under item attempt cap 1, then record fallback `T/F/a1`; reservation lookup examines only fallback fingerprints, and the runs-only deduplication finds no reservation, so completion returns ATTEMPTS_EXHAUSTED.
   GOAL: BR-LEDGER-04/07 and AC-08/09 require the same attempt identifier to remain counted once when execution continues through fallback.
   VERIFY: Add `reserved_attempt_can_continue_in_fallback_at_cap`: reserve writer a1, record fallback a1 with the same fingerprint, and assert success, item/global attempts equal 1, and successful ProgressLedger reload.

3. WHERE: tools/ai-brain/run-ledger.js:166 (RunLedger.admit) — NEW P1  
   WRONG: Record writer `T/a1` without a goal using ms=100 and tokens=10, then reserve repair `T/F` with goal G and no attemptId/jobId; the completion filter selects the earlier a1 run, changes its goal to G, and charges G ms=100/tokens=10 before the reserved repair executes.
   GOAL: BR-LEDGER-10 and AC-13 require reservation accounting to attribute only that reservation’s execution to its goal, preserving unrelated earlier attempts.
   VERIFY: Add `reservation_without_attempt_id_does_not_capture_prior_runs`: assert the reservation gives G attempts=1/ms=0/tokens=0 and leaves a1.goalId null; complete the repair with ms=50/tokens=5 and assert G totals remain 50/5.

4. WHERE: tools/ai-brain/run-ledger.js:382 (RunLedger.record) — NEW P1  
   WRONG: Record writer `T/a1` with fingerprint `__proto__` and verdict IN_FLIGHT; assignment changes the fingerprint map’s prototype, so JSON persistence omits the accepted IN_FLIGHT record while charging the attempt.
   GOAL: AC-14 requires accepted IN_FLIGHT records and their PID/identity metadata to persist. Unsafe fingerprint identifiers must be rejected before charging or stored safely as own properties.
   VERIFY: Add `prototype_named_fingerprint_is_refused_without_writes`: seed an ordinary record, attempt the IN_FLIGHT record with fingerprint `__proto__`, and assert rejection plus unchanged ledger bytes and counters.

Phase 2 open sweep: No additional NEW P0/P1 findings beyond findings 1–4.

Follow-up (non-blocking): `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv:274` still adds a duplicate TASK-AI-167 row beside the existing row at `:275`.
