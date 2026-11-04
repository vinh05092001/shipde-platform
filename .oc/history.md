## Round 67 review (pl-task-ai-169-67, writer was opencode:ninerouter/oc/deepseek-v4.1-flash-free)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 6eed30df4220fbbdd34d2b54826b2c00ffe2d8f6

TASK-AI-169 should unify execution traces and attempt/time/token budgets across writer, reviewer, repair, and fallback.
This delta touches AC-AI-169-01–14: chaining, budgets, token semantics, retry deduplication, masking, reservations, goal accounting, and schema compatibility.

1. WHERE: tools/ai-brain/run-ledger.js:312 (RunLedger.record; PRIOR #1 NOT FIXED)
   WRONG: Reserve writer/T/F for a1, then record a2 at writer/T/F with IN_FLIGHT -> accepted using a1’s reservation credit. The ownership checks inspect pending entries, while admission reservations have no such entry.
   GOAL: BR-LEDGER-07/08 and AC-AI-169-12 require rejecting a2 while preserving a1’s reservation.
   VERIFY: Run supplied `distinct_in_flight_record_cannot_overwrite_reservation`; assert a2 is refused and a1 completes with one attempt. Put command/result in the PR body.

2. WHERE: tools/ai-brain/run-ledger.js:313 (RunLedger.record; PRIOR #2 NOT FIXED)
   WRONG: Reserve writer/T/F for a1 with item/global attempt caps of 1, then record fallback/T/F for a1 -> another reservation is requested without a1’s identity instead of completing the writer reservation.
   GOAL: BR-LEDGER-04/07 and AC-AI-169-08/09 require cross-stage completion with one attempt.
   VERIFY: Run supplied `reserved_attempt_can_continue_in_fallback_at_cap`; assert success and one item/global attempt after reload. Put command/result in the PR body.

3. WHERE: tools/ai-brain/run-ledger.js:338 (RunLedger.record; PRIOR #3 NOT FIXED)
   WRONG: Record unassigned writer a1, reserve repair/T/F for G without an attemptId, then complete repair a2/F without goalId -> completion receives goalId=null, and recomputing goals removes G’s reservation rollup.
   GOAL: BR-LEDGER-10 and AC-AI-169-13 require a1 to remain unassigned and G to retain attempts=1/ms=50/tokens=5.
   VERIFY: Run supplied `reservation_without_attempt_id_does_not_capture_prior_runs`; assert unchanged a1 ownership and the complete G totals. Put command/result in the PR body.

4. WHERE: tools/ai-brain/run-ledger.js:252 (RunLedger.record, assertValidId; PRIOR #4 FIXED)
   WRONG: Fingerprint `__proto__` previously reached persistence -> now rejected before ledger mutation.
   GOAL: AC-AI-169-14 requires reservation metadata and counters to remain intact.
   VERIFY: Run supplied `prototype_named_fingerprint_is_refused_without_writes`; assert rejection, unchanged bytes, and unchanged counters. Put command/result in the PR body.

5. WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 NOT FIXED — previous-review location, current body not supplied)
   WRONG: The supplied exact-head rollup has blank conclusions for both listed checks -> successful remote CI remains unverified.
   GOAL: AGENTS.md requires successful CI evidence before the merge gate.
   VERIFY: Provide `gh pr checks 505` command/result in the PR body showing successful required checks at the reviewed SHA.

6. WHERE: tools/ai-brain/run-ledger.js:337 (RunLedger.record; PRIOR #6 NOT FIXED)
   WRONG: With goal.ms=100, record writer a1 with ms=100, then admit reviewer without itemId -> admission remains allowed because this reload discards the pending metrics created at line 325; settleAll never charges that elapsed time.
   GOAL: AC-AI-169-03 requires exhausted time budgets to refuse admission. Use the attached work-guard.js ProgressLedger.recordUnlocked accounting and budget enforcement.
   VERIFY: Run temporary `goal_time_cap_applies_without_item_id`; assert recorded goal.ms=100 and admission returns TIME_EXHAUSTED. Put command/result in the PR body.

7. WHERE: tools/ai-brain/run-ledger.js:19 (SECRET_KEY, maskCredentials; NEW P1 — audit/PII masking)
   WRONG: Record a route containing `{key:'sk-ant-api03-abcdefghijklmn'}` -> the credential is persisted unchanged because `key` does not match SECRET_KEY and ordinary string values receive no API-key masking.
   GOAL: BR-LEDGER-06 and AGENTS.md prohibit credential leakage. Use maintained fast-redact for the required sensitive paths, including `key`, before persistence.
   VERIFY: Run temporary `route_key_is_redacted`; assert the returned route contains `[REDACTED]` and ledger bytes exclude the supplied credential. Put command/result in the PR body.

SIZE: 2363 lines excluding lockfile, cut tools/ai-brain/test/run-ledger.test.js duplicated/finding-only checks and docs/product-spec/work-items/TASK-AI-169.md historical review tables that no AC needs.

Follow-up (non-blocking): Align the Work Item’s claimed 13 tests and completed verification checklist with the final slice and supplied results.

## Round 68 review (pl-task-ai-169-68, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: e214960f362b578bae394bd38baf2612894e4169

TASK-AI-169 should unify execution traces and shared attempt/time/token budgets across writer, reviewer, repair, and fallback.
This delta touches AC-AI-169-01–14: chaining, token semantics, caps, retry deduplication, masking, reservations, goal accounting, isolation, and schema compatibility.

1. WHERE: tools/ai-brain/run-ledger.js:201 (RunLedger.record; PRIOR #1 NOT FIXED — P1, AC/spec match)
   WRONG: Reserve writer/T/F for a1, then record writer/T/F for a2 with IN_FLIGHT → the existing reservation bypasses admission without checking its attempt owner; a2 is accepted.
   GOAL: BR-LEDGER-07/08 and AC-AI-169-12 require refusing a2 while preserving a1’s reservation credit.
   VERIFY: Run temporary `distinct_in_flight_record_cannot_overwrite_reservation`; assert a2 is refused and a1 completes with one attempt. Put command/result in the PR body.

2. WHERE: tools/ai-brain/run-ledger.js:202 (RunLedger.record; PRIOR #2 NOT FIXED — P1, AC/spec match)
   WRONG: Reserve writer/T/F for a1 with item/global attempt caps of 1, then record fallback/T/F for a1 → the fallback lookup misses the writer reservation and requests another reservation without a1’s identity, exhausting the cap.
   GOAL: BR-LEDGER-04/07 and AC-AI-169-08/09 require cross-stage continuation of the reserved attempt without another attempt charge.
   VERIFY: Run temporary `reserved_attempt_can_continue_in_fallback_at_cap`; assert success and one item/global attempt after reload. Put command/result in the PR body.

3. WHERE: tools/ai-brain/run-ledger.js:227 (RunLedger.record; PRIOR #3 NOT FIXED — P1, AC/spec match)
   WRONG: Record unassigned writer a1, reserve repair/T/F for G without an attemptId, then complete repair a2/F without goalId → goal ownership is recovered only from prior runs, so completion receives null and line 256 removes G’s reservation rollup.
   GOAL: BR-LEDGER-10 and AC-AI-169-13 require a1 to remain unassigned and G to retain attempts=1/ms=50/tokens=5.
   VERIFY: Run temporary `reservation_without_attempt_id_does_not_capture_prior_runs`; assert unchanged a1 ownership and complete G totals. Put command/result in the PR body.

4. WHERE: tools/ai-brain/run-ledger.js:161 (RunLedger.record; PRIOR #4 FIXED, rejection implemented in run-ledger-helpers.js:27)
   WRONG: Fingerprint `__proto__` previously reached persistence → it now throws before ledger mutation.
   GOAL: AC-AI-169-14 requires reservation metadata and counters to remain intact.
   VERIFY: Run temporary `prototype_named_fingerprint_is_refused_without_writes`; assert rejection, unchanged bytes, and unchanged counters. Put command/result in the PR body.

5. WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 FIXED by supplied exact-HEAD CI evidence; location belongs to the previous review)
   WRONG: Previously blank check conclusions → the supplied rollup now reports SUCCESS for all ten checks at the reviewed SHA.
   GOAL: AGENTS.md requires successful CI evidence before the merge gate; the supplied exact-HEAD evidence satisfies this prior finding.
   VERIFY: Supplied `gh pr view` statusCheckRollup reports ten SUCCESS results at this SHA; retain the command/result in the PR body.

6. WHERE: tools/ai-brain/run-ledger.js:226 (RunLedger.record; PRIOR #6 NOT FIXED — P1, AC/spec match)
   WRONG: With goal.ms=100, record writer a1 with ms=100, then admit reviewer without itemId → this reload discards the unsaved pending metrics, so settleAll cannot charge the elapsed time and admission remains allowed.
   GOAL: AC-AI-169-03 requires TIME_EXHAUSTED after consuming the time budget. Use the attached work-guard.js ProgressLedger.recordUnlocked accounting before reloading.
   VERIFY: Run temporary `goal_time_cap_applies_without_item_id`; assert recorded goal.ms=100 and admission returns TIME_EXHAUSTED. Put command/result in the PR body.

7. WHERE: tools/ai-brain/run-ledger-helpers.js:12 (SECRET_KEY, maskCredentials; PRIOR #7 NOT FIXED — P1, audit/PII masking)
   WRONG: Record route `{key:'sk-ant-api03-abcdefghijklmn'}` → `key` still does not match SECRET_KEY, and its string value receives no API-key masking, so the credential reaches ledger persistence.
   GOAL: BR-LEDGER-06 and AGENTS.md require credential redaction before persistence. Use installed fast-redact with the required sensitive paths, including `key`, and API-key value masking.
   VERIFY: Run temporary `route_key_is_redacted`; assert returned key is `[REDACTED]` and ledger bytes exclude the supplied credential. Put command/result in the PR body.

BLOCKING NEW FINDINGS: None.

SIZE: 897 lines excluding lockfile, cut docs/product-spec/work-items/TASK-AI-169.md historical review tables and completed task history that no AC needs.

Follow-up (non-blocking): Align the Work Item’s claimed 13 tests with the 14 supplied AC tests and remove unrelated lockfile version drift.

## Round 69 review (pl-task-ai-169-69, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: e214960f362b578bae394bd38baf2612894e4169

TASK-AI-169 should unify execution traces and attempt/time/token budgets across writer, reviewer, repair, and fallback.
This delta touches AC-AI-169-01–14: execution chains, token semantics, caps, deduplication, masking, reservations, goal accounting, isolation, and schema compatibility.

1. WHERE: tools/ai-brain/run-ledger.js:201 (RunLedger.record; PRIOR #1 NOT FIXED — P1, AC/spec match)
   WRONG: Reserve writer/T/F for a1, then record writer/T/F for a2 with IN_FLIGHT → the persisted reservation bypasses admission without checking its attempt owner; a2 is accepted.
   GOAL: BR-LEDGER-07/08 and AC-AI-169-12 require refusing a2 while preserving a1’s reservation credit.
   VERIFY: Run temporary `distinct_in_flight_record_cannot_overwrite_reservation`; assert a2 is refused and a1 completes with one attempt. Include command/result in the PR body.

2. WHERE: tools/ai-brain/run-ledger.js:202 (RunLedger.record; PRIOR #2 NOT FIXED — P1, AC/spec match)
   WRONG: Reserve writer/T/F for a1 with item/global attempt caps of 1, then record fallback/T/F for a1 → the stage-specific lookup misses the reservation and requests another attempt, returning ATTEMPTS_EXHAUSTED.
   GOAL: BR-LEDGER-04/07 and AC-AI-169-08/09 require cross-stage continuation of the reserved attempt without another attempt charge.
   VERIFY: Run temporary `reserved_attempt_can_continue_in_fallback_at_cap`; assert success and one item/global attempt after reload. Include command/result in the PR body.

3. WHERE: tools/ai-brain/run-ledger.js:227 (RunLedger.record; PRIOR #3 NOT FIXED — P1, AC/spec match)
   WRONG: Record unassigned writer a1, reserve repair/T/F for G without an attemptId, then complete repair a2/F without goalId → effectiveGoalId remains null, and line 256 replaces the goal rollups without G.
   GOAL: BR-LEDGER-10 and AC-AI-169-13 require a1 to remain unassigned and G to retain attempts=1/ms=50/tokens=5.
   VERIFY: Run temporary `reservation_without_attempt_id_does_not_capture_prior_runs`; assert unchanged a1 ownership and complete G totals. Include command/result in the PR body.

4. WHERE: tools/ai-brain/run-ledger.js:135 (RunLedger.record; PRIOR #4 FIXED; rejection in tools/ai-brain/run-ledger-helpers.js:27, assertValidId)
   WRONG: Fingerprint `__proto__` previously reached persistence → it now throws before ledger mutation.
   GOAL: AC-AI-169-14 requires reservation metadata and counters to remain intact; the supplied delta implements rejection.
   VERIFY: Run temporary `prototype_named_fingerprint_is_refused_without_writes`; assert rejection, unchanged bytes, and unchanged counters. Include command/result in the PR body.

5. WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 FIXED by supplied exact-HEAD CI evidence; previous-review location)
   WRONG: Previously missing check conclusions → supplied evidence now reports ten SUCCESS results at the reviewed SHA.
   GOAL: AGENTS.md requires successful CI evidence before the merge gate; the supplied exact-HEAD results satisfy this prior finding.
   VERIFY: Retain the supplied statusCheckRollup command/result showing ten SUCCESS conclusions at e214960f362b578bae394bd38baf2612894e4169 in the PR body.

6. WHERE: tools/ai-brain/run-ledger.js:226 (RunLedger.record; PRIOR #6 NOT FIXED — P1, AC/spec match)
   WRONG: With goal.ms=100, record writer a1 with ms=100, then admit reviewer without itemId → reloading discards the unsaved pending metrics, so admission remains allowed.
   GOAL: AC-AI-169-03 requires TIME_EXHAUSTED after consuming the time budget. Use the attached work-guard.js ProgressLedger.recordUnlocked accounting before reloading.
   VERIFY: Run temporary `goal_time_cap_applies_without_item_id`; assert recorded goal.ms=100 and admission returns TIME_EXHAUSTED. Include command/result in the PR body.

7. WHERE: tools/ai-brain/run-ledger-helpers.js:12 (SECRET_KEY, maskCredentials; PRIOR #7 NOT FIXED — P1, audit/PII masking)
   WRONG: Record route `{key:'sk-ant-api03-abcdefghijklmn'}` → `key` does not match SECRET_KEY, and its value receives no API-key masking, so the credential reaches persistence.
   GOAL: BR-LEDGER-06 and AGENTS.md prohibit credential leakage. Use installed fast-redact with sensitive paths including `key` and censoring that masks API-key values.
   VERIFY: Run temporary `route_key_is_redacted`; assert returned key is `[REDACTED]` and ledger bytes exclude the credential. Include command/result in the PR body.

BLOCKING NEW FINDINGS: None.

SIZE: 897 lines excluding lockfile, cut docs/product-spec/work-items/TASK-AI-169.md historical review tables and completed task history that no AC needs.

Follow-up (non-blocking): Align the claimed 13 tests with the 14 supplied AC tests and remove unrelated lockfile version drift.
