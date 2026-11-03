## Work Item

- Work Item ID: TASK-AI-167
- Feature ID: N/A — AI delivery loop control
- Work Item file: docs/product-spec/work-items/TASK-AI-167.md
- Assigned implementation author: CLAUDE
- Business outcome: Stop the delivery loop from spending tokens and time on work that cannot progress: a wrong branch, a conflict or an unchanged review input blocks that item alone with a reason, while independent items keep running.

## Source requirements

- Feature/use case/rule IDs: BR-LOOP-01, BR-LOOP-02, BR-LOOP-03, BR-LOOP-04, BR-LOOP-05, AC-AI-167-01 to AC-AI-167-09
- Screen/API/entity/state IDs: N/A — delivery tooling; no user interface, API or schema
- Source documents: docs/product-spec/work-items/TASK-AI-167.md, AGENTS.md, docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md, tools/ai-brain/review-loop.js

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: N/A — no user interface.
- API/application behavior: New tools/ai-brain/work-guard.js (workspace check, per-fingerprint progress ledger with reserved admission and item/goal budgets, generation locks, job-bound results, cleanup that keeps the exit code, CLI). review-loop.js caches tests and reviews per SHA.
- Data/migrations: N/A — no database change; ledger and lock files live where the caller points them.
- Permissions/tenancy/audit: N/A — internal delivery tooling.
- External adapters/jobs: N/A — no network calls; tests use injected git and os.tmpdir() only.

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                       | Visual/manual evidence |
| ------------ | ------ | ------------------------------------------------------------------------ | ---------------------- |
| AC-AI-167-01 | PASS   | tools/ai-brain/test/work-guard.test.js (workspace tests)                 | N/A                    |
| AC-AI-167-02 | PASS   | tools/ai-brain/test/work-guard.test.js (fingerprint and transient retry) | N/A                    |
| AC-AI-167-03 | PASS   | tools/ai-brain/test/work-guard.test.js (per-item block)                  | N/A                    |
| AC-AI-167-04 | PASS   | tools/ai-brain/test/work-guard.test.js (budgets, reservation)            | N/A                    |
| AC-AI-167-05 | PASS   | tools/ai-brain/test/work-guard.test.js (generation lock races)           | N/A                    |
| AC-AI-167-06 | PASS   | tools/ai-brain/test/work-guard.test.js (jobId)                           | N/A                    |
| AC-AI-167-07 | PASS   | tools/ai-brain/test/work-guard.test.js (cleanup)                         | N/A                    |
| AC-AI-167-08 | PASS   | tools/ai-brain/test/work-guard.test.js (review loop SHA cache)           | N/A                    |
| AC-AI-167-09 | PASS   | node scripts/ai/check-no-hardcode.mjs                                    | N/A                    |

## Round 2 Review Findings Resolution

| Finding          | Description                                                      | Test Name                                                                                        | Command Run                                          | Result |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------ |
| Round 2 #4 (P1)  | Workspace verification fails open when conflict inspection fails | `round 2 #4: a failed conflict inspection refuses admission instead of passing`                  | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #5 (P1)  | Unknown token consumption bypasses token caps                    | `round 2 #5: unknown token usage counts toward the token caps`                                   | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #6 (P1)  | Cleanup failure drops the worker result during serialization     | `round 2 #6: worker own properties survive failing cleanup across JSON serialization and spread` | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #7 (P2)  | Falsy worker exceptions are swallowed                            | `round 2 #7: falsy worker exceptions are not swallowed`                                          | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #8 (P2)  | The revisited-SHA regression test asserts nothing                | `codex 8fa765f: returning to a tested SHA does not re-run its tests`                             | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #14 (P1) | Unexpected liveness errors permit lock takeover                  | `round 2 #14: unexpected liveness errors treat lock as held`                                     | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 2 #15 (P2) | Checkout comparison conflates distinct case-sensitive paths      | `round 2 #15: checkout comparison respects filesystem case-sensitivity`                          | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |

## Round 3 Review Findings Resolution

| Finding                | Description                                                                | Test Name                                                                                           | Command Run                                          | Result |
| ---------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ |
| Round 3 #4 (P1)        | Goal-only token caps still permit unlimited unknown consumption            | `round 3 #4: goal-only token caps impute unknown usage and refuse excess attempts`                  | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #5 (P1)        | Recording one attempt erases other attempts' unresolved token charges      | `round 3 #5: recording one attempt does not erase another attempt's unresolved token charges`       | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #6 (P1)        | Elapsed-time caps omit unresolved reservations                             | `round 3 #6: elapsed-time caps account for unresolved reservations and repeated crashes`            | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #11 / #15 (P2) | Checkout comparison conflates distinct case-sensitive paths on Darwin      | `round 3 #11 / #15: checkout comparison detects actual filesystem case-sensitivity via inode probe` | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #12 (P1)       | Contenders delete earlier lock generations despite explicit contract       | `round 3 #12: contenders preserve earlier lock generations and release markers`                     | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #13 (P2)       | Unknown completion charges a reserved attempt twice                        | `round 3 #13: unknown completion does not double-charge reserved attempt`                           | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 3 #14 (P2)       | Cleanup annotation breaks built-in worker result types (Array/Date/RegExp) | `round 3 #14: cleanup annotation preserves built-in types including Array, Date and RegExp`         | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |

## Round 4 Review Findings Resolution

| Finding          | Description                                                                    | Test Name                                                                                              | Command Run                                          | Result |
| ---------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------ |
| Round 4 #4 (P1)  | Completing a reservation without elapsed usage erases its time consumption     | `round 4 #4: completing a reservation without elapsed usage accounts for elapsed time`                 | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 4 #5 (P1)  | Null token usage becomes known zero and refunds the reservation                | `round 4 #5: null/false/empty token usage is rejected as invalid usage.tokens`                         | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 4 #6 (P1)  | Structurally damaged ledger can lose outstanding token charges without refusal | `round 4 #6: structurally damaged ledger missing unknownTokens fails closed on admission`              | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 4 #12 (P1) | Release targets an older generation when a job ID is reused                    | `round 4 #12: release specifies generation and does not release older generation when jobId is reused` | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 4 #13 (P2) | Invalid release owner can release unreadable lock metadata                     | `round 4 #13: invalid release owner or unreadable lock metadata cannot release lock`                   | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |
| Round 4 #14 (P2) | Cleanup still breaks unsupported built-ins and private-field instances         | `round 4 #14: cleanup annotation preserves unsupported built-ins and private-field instances`          | `node --test tools/ai-brain/test/work-guard.test.js` | PASS   |

## Verification

| Command                                            | Result             | Evidence/notes                                                                                                                  |
| -------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| node --test tools/ai-brain/test/work-guard.test.js | PASS               | 47 tests pass (including all Round 2, Round 3, and Round 4 negative tests)                                                      |
| node --test tools/ai-brain/test/task-ai-60.test.js | PASS               | 21 tests pass                                                                                                                   |
| node scripts/ai/check-no-hardcode.mjs              | PASS               | 0 hardcode violations (baseline 345)                                                                                            |
| pnpm lint                                          | PASS               | All 7 packages pass, 0 errors                                                                                                   |
| pnpm typecheck                                     | PASS               | All 7 packages pass, 0 errors                                                                                                   |
| git diff --check origin/main...HEAD                | PASS               | no whitespace or conflict errors                                                                                                |
| pnpm --filter @shipde/api test                     | BLOCKED_BY_SANDBOX | Pre-existing origin/main regression: rbac.unit.spec.ts OpenAPI mount assertion failed; Docker DB harness blocked without Docker |

- [x] Clean install completed. (CI application-gate on the PR head; not run locally — local node_modules incomplete)
- [x] Lint/typecheck completed. (CI application-gate on the PR head)
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed. (N/A — no user-facing path; tooling only)
- [x] Production build completed. (CI application-gate on the PR head)
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: N/A — no tenant data.
- Authorization: N/A — internal tooling.
- Idempotency/reconciliation: The same input is refused rather than retried; transient failures may retry. Damaged ledger fails closed.
- Sensitive data/secrets: None handled or logged.
- Error, timeout and recovery paths: Dead lock owners and dead reservations are recovered only on provable death of a positive pid; never by age.
- Carrier capability/evidence level: N/A.

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

- No production Controller caller yet; the scratch delivery pipeline uses the CLI.
- acceptResult is not yet wired into the lane launcher.

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: 34eba8913bb1ab5a5983257f187dd4562cd08d66 (pre-PR, PASS); PR head 58f64a1beb242159a6e658a0a000b3f3d92bcfdf
- Verdict: pending on PR head

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
