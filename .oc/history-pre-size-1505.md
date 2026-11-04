## Round 66 review (pl-task-ai-169-66, writer was agy07:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: b254b80c545dd36dba975817e486011d80cefbf2

TASK-AI-169 should unify execution traces and shared attempt/time/token budgets across writer, reviewer, repair, and fallback.
This delta touches AC-AI-169-01–14: chains, budgets, retry deduplication, token semantics, masking, reservations, goal accounting, and schema compatibility.

1. WHERE: tools/ai-brain/run-ledger.js:359 (RunLedger.record; PRIOR #1 FIXED)
   WRONG: Distinct IN_FLIGHT a2 targeting writer/T/F previously replaced reserved a1; the ownership guard now refuses a2 before mutation.
   GOAL: BR-LEDGER-07/08 and AC-09/12 require a1’s reservation to remain completable.
   VERIFY: Supplied `distinct_in_flight_record_cannot_overwrite_reservation` asserts rejection, preserved ownership, successful a1 completion, and one attempt.

2. WHERE: tools/ai-brain/run-ledger.js:386 (RunLedger.record; PRIOR #2 FIXED)
   WRONG: Writer reservation a1 followed by fallback a1 at cap=1 previously returned ATTEMPTS_EXHAUSTED; cross-stage lookup now transfers the matching reservation before attempt enforcement.
   GOAL: BR-LEDGER-04/07 and AC-08/09 require completion without another attempt charge.
   VERIFY: Supplied `reserved_attempt_can_continue_in_fallback_at_cap` asserts success, one item/global attempt, and ProgressLedger reload.

3. WHERE: tools/ai-brain/run-ledger.js:251 (RunLedger.admit; PRIOR #3 FIXED)
   WRONG: Reserving repair/T/F without execution IDs previously attributed earlier writer a1 to G; goal reassignment now skips the live IN_FLIGHT reservation.
   GOAL: BR-LEDGER-10 and AC-13 require only the reserved execution to contribute to G.
   VERIFY: Supplied `reservation_without_attempt_id_does_not_capture_prior_runs` asserts unchanged a1 ownership and G totals of attempts=1/ms=50/tokens=5 after completion.

4. WHERE: tools/ai-brain/run-ledger.js:22 (assertValidId; PRIOR #4 FIXED)
   WRONG: Fingerprint `__proto__` previously accepted an IN_FLIGHT record that disappeared during persistence; validation now rejects that identifier before writes.
   GOAL: AC-14 requires accepted reservation metadata to persist without corrupting counters.
   VERIFY: Supplied `prototype_named_fingerprint_is_refused_without_writes` asserts rejection, unchanged bytes, and unchanged counters.

5. WHERE: .oc/pr-body.md:101 (Verification; PRIOR CI P1 NOT FIXED — unverified)
   WRONG: The supplied exact-head GitHub rollup lists check names with blank conclusions; it does not establish successful remote gates.
   GOAL: AGENTS.md requires green CI before delivery passes its merge gate; local results cannot establish remote success.
   VERIFY: Provide `gh pr checks 505` command/result in the PR body, confirming required checks succeeded at the reviewed SHA.

6. WHERE: tools/ai-brain/run-ledger.js:228 (RunLedger.admit; NEW P1 — AC/spec match)
   WRONG: With `limits.goal.ms=100`, record writer `{attemptId:'a1', ms:100}`, then call `admit('reviewer')` without itemId. The no-item path checks only attempts and returns `{ok:true}` despite exhausted goal time.
   GOAL: AC-AI-169-03 requires exhausted deadline budgets to refuse admission. Reuse the attached `tools/ai-brain/work-guard.js` ProgressLedger budget enforcement for this admission path.
   VERIFY: Run `goal_time_cap_applies_without_item_id` as a temporary local reproduction; assert admission returns `ok:false` with a time-exhaustion cause. Put the command/result in the PR body; no committed finding test is required.

SIZE: 2736 lines, cut .oc/pr-body.md historical review tables and tools/ai-brain/test/run-ledger.test.js duplicated/finding-only checks; retain AC-required coverage.

Follow-up (non-blocking): Align Work Item and PR evidence with the final slice and actual test count; previously closed prototype, URL-masking, and execution-identity findings are not reopened.
