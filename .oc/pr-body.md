## Work Item

- Work Item ID: TASK-AI-169
- Feature ID: N/A
- Work Item file: docs/product-spec/work-items/TASK-AI-169.md
- Assigned implementation author: AGY
- Business outcome: Provide a unified execution and budget ledger (`RunLedger`) across writer, reviewer, repair, and fallback stages with execution ID chaining, token UNKNOWN/UNENFORCED discipline, cross-layer retry deduplication, recursive credential masking, and in-flight reservation handling.

## Source requirements

- Feature/use case/rule IDs: BR-LEDGER-01, BR-LEDGER-02, BR-LEDGER-03, BR-LEDGER-04, BR-LEDGER-05, BR-LEDGER-06, BR-LEDGER-07, BR-LEDGER-08, BR-LEDGER-09, BR-LEDGER-10
- Screen/API/entity/state IDs: None
- Source documents: AGENTS.md (Unit of delivery, Hard prohibitions); docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md; tools/ai-brain/work-guard.js; docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: None
- API/application behavior: Implemented `RunLedger` wrapping `ProgressLedger` with execution ID chaining (`decisionId`, `jobId`, `attemptId`, `reviewSha`, `verdict`, `stage`), cross-layer retry deduplication across `pipeline`, `cli`, and `gateway`, and token unknown tracking without zero/currency fabrications.
- Data/migrations: None
- Permissions/tenancy/audit: Recursive credential masking in `maskCredentials` redacts API keys, tokens, secrets, passwords, and URL basic auth across objects and arrays.
- External adapters/jobs: None

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                                                                                                            | Visual/manual evidence |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| AC-AI-169-01 | PASS   | tools/ai-brain/test/run-ledger.test.js (chain writer->review->repair->review computes correct total spent and links)                                          | N/A                    |
| AC-AI-169-02 | PASS   | tools/ai-brain/test/run-ledger.test.js (missing tokens yields UNKNOWN, tokenEnforcement UNENFORCED, no zero or money conversion)                              | N/A                    |
| AC-AI-169-03 | PASS   | tools/ai-brain/test/run-ledger.test.js (exceeding attempt or deadline budget cap refuses admission and record)                                                | N/A                    |
| AC-AI-169-04 | PASS   | tools/ai-brain/test/run-ledger.test.js (retryLayer pipeline\|cli\|gateway counts attempt once across layers)                                                  | N/A                    |
| AC-AI-169-05 | PASS   | tools/ai-brain/test/run-ledger.test.js (route identity masks credentials)                                                                                     | N/A                    |
| AC-AI-169-06 | PASS   | tools/ai-brain/test/run-ledger.test.js (route identity masks credentials recursively in providers array)                                                      | N/A                    |
| AC-AI-169-07 | PASS   | tools/ai-brain/test/run-ledger.test.js (record missing both jobId and attemptId throws RUN_LEDGER_REFUSED)                                                    | N/A                    |
| AC-AI-169-08 | PASS   | tools/ai-brain/test/run-ledger.test.js (two retry layers with same attemptId and cap=1 are both recorded, accumulate ms, keep verdicts and stay at 1 attempt) | N/A                    |
| AC-AI-169-09 | PASS   | tools/ai-brain/test/run-ledger.test.js (ProgressLedger.admit with reserve:true followed by record for same fingerprint counts 1 attempt total)                | N/A                    |
| AC-AI-169-10 | PASS   | tools/ai-brain/test/run-ledger.test.js (no file writes outside os.tmpdir())                                                                                   | N/A                    |
| AC-AI-169-11 | PASS   | tools/ai-brain/test/run-ledger.test.js (reserve_honors_run_ledger_limit_override)                                                                             | N/A                    |
| AC-AI-169-12 | PASS   | tools/ai-brain/test/run-ledger.test.js (distinct_attempts_cannot_reuse_in_flight_credit)                                                                      | N/A                    |
| AC-AI-169-13 | PASS   | tools/ai-brain/test/run-ledger.test.js (reserve followed by record with goalId tracks attempt in goals)                                                       | N/A                    |
| AC-AI-169-14 | PASS   | tools/ai-brain/test/run-ledger.test.js (persisted ledger preserves full counter schema and passes validateLedger across repeated writes)                      | N/A                    |

## Review Findings Addressed

| Finding                                                                                                                       | Test Name                                                                                         | Command Run                                          | Result                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| P1: CI failing ai-brain-tests (validateLedger schema corruption after TASK-AI-167 merge)                                      | `persisted ledger preserves full counter schema and passes validateLedger across repeated writes` | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS (29/29 tests pass) |
| P1: `opts.force` allowed caller to bypass attempt budget cap (BR-LEDGER-08)                                                   | `force_cannot_bypass_attempt_budget`                                                              | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Negative elapsed time (`opts.ms`) restored spent budget                                                                   | `negative_elapsed_time_cannot_restore_budget`                                                     | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Omission of `itemId` caused temporary item deduplication state to be lost                                                 | `deduplicates_attempt_without_item_id`                                                            | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Changed fingerprint on retry violated `attempts >= itemRecordCount` schema invariant                                      | `changed_fingerprint_retry_preserves_schema`                                                      | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Completing matching reservation double-charged per-goal counter                                                           | `goal_reservation_completion_counts_once`                                                         | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Passwordless URL userinfo was not stripped by credential masking                                                          | `masks_passwordless_url_userinfo`                                                                 | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Prototype-named attempt (`constructor`) bypassed budget cap                                                               | `prototype_named_attempt_cannot_bypass_cap`                                                       | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| Follow-up: Invalid stage rejection                                                                                            | `invalid_stage_is_rejected`                                                                       | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Negative token measurements could restore consumed budget (run-ledger.js:250)                                             | `negative_tokens_cannot_restore_budget`                                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: URL credential masking ignored userinfo with empty password (run-ledger.js:14)                                            | `masks_empty_password_url_userinfo`                                                               | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Goal reservation completion numerical heuristic caused undercounting (run-ledger.js:286)                                  | `previously_used_goal_counts_late_assigned_reservation`                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Concurrent goal reservation completion double-charged goal attempts (run-ledger.js:119)                                   | `concurrent_goal_reservation_completion_counts_once`                                              | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Same fingerprint retry across stages violated itemRecordCount invariant (run-ledger.js:322)                               | `cross_stage_same_fingerprint_retry_preserves_schema`                                             | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Late item ID arrival left item spent attempts at 0 while recording fps (run-ledger.js:210)                                | `retry_with_late_item_id_preserves_schema`                                                        | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| Schema verification: Output loads directly through ProgressLedger without LEDGER_CORRUPT                                      | `run-ledger output loads through ProgressLedger.load without LEDGER_CORRUPT`                      | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Conflicting established item context on retry violated `attempts >= itemRecordCount` schema invariant (run-ledger.js:278) | `retry_cannot_change_established_item`                                                            | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Retry with late goalId assignment left goal attempts at zero (run-ledger.js:352)                                          | `retry_with_late_goal_id_counts_goal_attempt`                                                     | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Completing known-token in-flight run without tokens failed to track unknown tokens (run-ledger.js:332)                    | `known_token_in_flight_completion_tracks_unknown_tokens`                                          | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Concurrent completion then fallback double-counted goal attempts on admission (run-ledger.js:127)                         | `concurrent_completion_then_fallback_counts_once`                                                 | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Username credential in URL was not masked when password was non-empty (run-ledger.js:14)                                  | `masks_username_credential_with_nonempty_password`                                                | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Real item with matching jobId was erroneously treated as placeholder and migrated (run-ledger.js:205)                     | `job_id_collision_does_not_migrate_real_item`                                                     | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: CI contract gate failing due to template placeholder in PR body (review round 59)                                         | `pr_body_contains_no_template_placeholders`                                                       | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Established item named same as attempt was erroneously migrated via isPlaceholder (run-ledger.js:203)                     | `established_item_named_like_attempt_cannot_migrate`                                              | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Concurrent completion without goalId left reserved goal uncharged (run-ledger.js:115)                                     | `concurrent_completion_without_goal_preserves_reserved_goal_charge`                               | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Uppercase HTTP scheme (HTTPS://) not matched by case-sensitive regex — userinfo persisted (run-ledger.js:16)              | `uppercase_http_scheme_masks_userinfo`                                                            | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: `__proto__` as item id mutated object prototype instead of creating own property (run-ledger.js:453)                      | `prototype_named_item_id_is_refused`                                                              | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: CI format check failing on tools/ai-brain/test/run-ledger.test.js and .oc/pr-body.md (job 126221109534)                   | `npx prettier --check` / `pnpm format:check`                                                      | `pnpm format:check`                                  | PASS                    |
| Architecture: run-ledger is a thin adapter over ProgressLedger; eliminated duplicate budget model, placeholder migration      | `item A/B same attempt id cap=1 refuses B and leaves A exhausted`                                 | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Default fingerprint reservation completes once (admit:118)                                                                | `default_fingerprint_reservation_completes_once`                                                  | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Repeated IN_FLIGHT record counts attempt once (record:280)                                                                | `repeated_in_flight_record_counts_once`                                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Completed retry tracks unknown tokens across layers (record:330)                                                          | `completed_retry_tracks_unknown_tokens`                                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Distinct goal-associated reservation increments goal counter (admit:129)                                                  | `second_reservation_for_same_item_charges_goal`                                                   | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Reservation completion preserves established goal association and rollups (record:361)                                    | `completion_inherits_reserved_goal`                                                               | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Cross-stage IN_FLIGHT retry preserves schema with valid PID (record:347)                                                  | `cross_stage_in_flight_retry_preserves_schema`                                                    | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Prototype-named goal ID refused without mutation (record:363)                                                             | `prototype_named_goal_is_refused_without_mutation`                                                | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS (48/48 tests pass) |
| P1: Explicit reservation completes by matching attemptId when fingerprint omitted (record:261)                                | `explicit_reservation_completes_by_attempt_id`                                                    | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Distinct completion cannot hijack IN_FLIGHT reservation credit (record:345)                                               | `distinct_completion_cannot_hijack_in_flight_fingerprint`                                         | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Inherited goal name refused without mutating Object.prototype (admit:144)                                                 | `inherited_goal_name_is_refused_without_mutation`                                                 | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Inherited item name refused without mutating Object.prototype (record:308)                                                | `inherited_item_name_is_refused_without_mutation`                                                 | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Concurrent completion without goalId preserves reserved goal charge with time and tokens (admit:142)                      | `concurrent_completion_without_goal_preserves_reserved_goal_charge`                               | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Mask sensitive query credentials in URL route endpoint (run-ledger.js:22)                                                 | `masks_sensitive_url_query_credentials`                                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS (53/53 tests pass) |
| P1: Distinct in-flight record overwrote existing reservation (run-ledger.js:338)                                              | `distinct_in_flight_record_cannot_overwrite_reservation`                                          | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Cross-stage execution continuation to fallback at attempt cap returned ATTEMPTS_EXHAUSTED (run-ledger.js:289)             | `reserved_attempt_can_continue_in_fallback_at_cap`                                                | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Reservation without attemptId captured unrelated prior runs of item into goal rollup (admit:166)                          | `reservation_without_attempt_id_does_not_capture_prior_runs`                                      | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS                    |
| P1: Prototype-named fingerprint identifier mutated prototype, omitting IN_FLIGHT from JSON persistence (run-ledger.js:382)    | `prototype_named_fingerprint_is_refused_without_writes`                                           | `node --test tools/ai-brain/test/run-ledger.test.js` | PASS (57/57 tests pass) |

## Verification

| Command                                                                                   | Result             | Evidence/notes                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm format:check                                                                         | PASS               | Codebase and spec formatting verified clean (14/14 files pass)                                                                         |
| pnpm lint                                                                                 | PASS               | Turbo lint across 7 workspace packages + scripts passes cleanly (12/12 successful, 0 errors)                                           |
| pnpm typecheck                                                                            | PASS               | TypeScript typecheck across all workspace packages passes cleanly (12/12 successful, 0 errors)                                         |
| node --test tools/ai-brain/test/run-ledger.test.js                                        | PASS               | 57/57 run-ledger tests pass (all 4 review findings 1–4 verified)                                                                       |
| node --test tools/ai-brain/test/work-guard.test.js                                        | PASS               | 53/53 work-guard tests pass                                                                                                            |
| node --test tools/ai-brain/test/run-ledger.test.js tools/ai-brain/test/work-guard.test.js | PASS               | 110/110 tests pass total                                                                                                               |
| pnpm security:secrets                                                                     | PASS               | 0 secrets detected on commit history and working tree                                                                                  |
| node scripts/ai/check-no-hardcode.mjs                                                     | PASS               | Zero forbidden production hardcodes detected                                                                                           |
| git diff --check origin/main...HEAD                                                       | PASS               | Zero whitespace or merge conflict markers                                                                                              |
| pnpm test:brain                                                                           | BLOCKED_BY_SANDBOX | task-ai-136 integration tests require host pnpm executable (ENOENT); all 110 run-ledger+work-guard tests pass directly via node --test |

- [x] Clean install completed.
- [x] Lint/typecheck completed.
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed.
- [x] Production build completed.
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: None (internal delivery orchestration module)
- Authorization: Enforced stage membership in VALID_STAGES and retry layer in VALID_RETRY_LAYERS; empty/invalid stages denied
- Idempotency/reconciliation: Retry layers deduplicated under same attemptId (`att-attemptKey`); in-flight reservations safely completed by record without double-counting; attempts >= itemRecordCount invariant maintained
- Sensitive data/secrets: `maskCredentials` redacts keys, secrets, tokens, passwords and URLs recursively; `pnpm security:secrets` passes with 0 violations
- Error, timeout and recovery paths: Managed via `Cause` codes (`ATTEMPTS_EXHAUSTED`, `TIME_EXHAUSTED`, `TOKENS_EXHAUSTED`, `ITEM_BLOCKED`, `GOAL_EXHAUSTED`)
- Carrier capability/evidence level: None

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

None

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: 02d7d28a363c7098b21a97d6aac1d132b97bd681 (Round 63: CHANGES_REQUIRED — 4 P1 findings fixed in this round)
- Verdict: READY_FOR_REVIEW

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.

**Depends on:** #503 (TASK-AI-167 `ProgressLedger` in `work-guard.js`); merge after #503.
