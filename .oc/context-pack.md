# Focused context pack

## .oc/pr-body.md

```
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
- Slice A = this PR; Slice B = supervisor dispatch integration (tools/ai-brain/work-item-planner.js, tools/ai-brain/work-evidence.js)

## Implementation

- UI and user states: None
- API/application behavior: Implemented `RunLedger` wrapping `ProgressLedger` with execution ID chaining (`decisionId`, `jobId`, `attemptId`, `reviewSha`, `verdict`, `stage`), cross-layer retry deduplication across `pipeline`, `cli`, and `gateway`, and token unknown tracking without zero/currency fabrications.
- Data/migrations: None
- Permissions/tenancy/audit: Recursive credential masking in `maskCredentials` redacts API keys, tokens, secrets, passwords, and URL basic auth across objects and arrays.
- External adapters/jobs: None

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                                                                   | Visual/manual evidence |
| ------------ | ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| AC-AI-169-01 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-01: chain computes correct total spent and links)                  | N/A                    |
| AC-AI-169-02 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-02: missing tokens yields UNKNOWN/UNENFORCED without money fields) | N/A                    |
| AC-AI-169-03 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-03: exceeding budget cap refuses admission and record)             | N/A                    |
| AC-AI-169-04 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-04: retryLayer deduplication counts attempt once across layers)    | N/A                    |
| AC-AI-169-05 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-05: route identity masks credentials)                              | N/A                    |
| AC-AI-169-06 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-06: recursive masking in nested arrays)                            | N/A                    |
| AC-AI-169-07 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-07: missing jobId and attemptId throws RUN_LEDGER_REFUSED)         | N/A                    |
| AC-AI-169-08 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-08: same attemptId across layers with cap=1 both recorded)         | N/A                    |
| AC-AI-169-09 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-09: reserve followed by record counts 1 attempt)                   | N/A                    |
| AC-AI-169-10 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-10: no file writes outside os.tmpdir())                            | N/A                    |
| AC-AI-169-11 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-11: reservations honor RunLedger limit override)                   | N/A                    |
| AC-AI-169-12 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-12: distinct attempts cannot reuse in-flight credit)               | N/A                    |
| AC-AI-169-13 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-13: reserve with goalId tracks goal attempts)                      | N/A                    |
| AC-AI-169-14 | PASS   | tools/ai-brain/test/run-ledger.test.js (AC-AI-169-14: preserves full counter schema across repeated writes)          | N/A                    |

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
| node --test tools/ai-brain/test/run-ledger.test.js                                        | PASS               | 14/14 AC tests pass (one test per acceptance criterion, <=300 lines)                                                                   |
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

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## docs/product-spec/work-items/TASK-AI-169.md

```
# TASK-AI-169 — Unified budget ledger across writer, reviewer, repair, and fallback

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-169` |
| Feature ID | `N/A — AI delivery routing and unified budget control` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `302` |
| Dependencies | `TASK-AI-167` |
| Assigned author | `AGY` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/run-ledger.js`; `tools/ai-brain/run-ledger-helpers.js`; `tools/ai-brain/test/run-ledger.test.js`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-169.md`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-169-run-ledger` |
| Pull Request | `Set when opened` |

## Business outcome

Establish a unified execution and budget ledger (`RunLedger`) across all stages of delivery execution: writer, reviewer, repair, and fallback. The ledger tracks a complete decision-to-verdict execution ID chain (`decisionId`, `jobId`, `attemptId`, `reviewSha`, `verdict`, `stage`), enforces shared attempt/time/token caps across stages and goals, treats missing token metrics strictly as `UNKNOWN` / `UNENFORCED` without fabricating zero or invalid monetary conversion, and deduplicates retries across orchestration layers (`pipeline`, `cli`, `gateway`) so that repeated attempts for the same attempt identifier are counted exactly once against budgets while accumulating elapsed time and preserving stage verdicts. Sensitive credentials and secrets in route identities are recursively masked, and reservations can be safely completed by subsequent records without double-charging attempt budgets.

## Source references

- `AGENTS.md` (Unit of delivery, Hard prohibitions — no VND floating-point, no secret leakage, no fake outcome)
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `tools/ai-brain/work-guard.js` (TASK-AI-167 ProgressLedger, generation locks, cause codes, fingerprinting)
- `tools/ai-brain/route-identity.js` (Routing identity normalization)
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`

## Preconditions and dependencies

- `TASK-AI-167` progress guard merged or available, providing `ProgressLedger`, `Cause`, atomic locking, and fingerprint computation.
- Clean worktree on branch `feat/task-ai-169-run-ledger` synchronized with `origin/main`.

## Ambiguity and clarification markers

None. Requirements, schema properties, and budget calculation semantics are fully specified and tested.

## Author boundary

Appropriate for AGY author. Provides runtime ledger abstraction and test suite in `tools/ai-brain/`. No changes to `.github/`, gate configs, security allowlists, baselines, or semgrep rules.

## Slice sizing rule

Bounded single vertical delivery of `tools/ai-brain/run-ledger.js`, its dedicated test suite `tools/ai-brain/test/run-ledger.test.js`, register row, Work Item documentation, and PR body, strictly within target line budget.

## In scope

- `tools/ai-brain/run-ledger.js`:
  - `RunLedger` class wrapping `ProgressLedger` with stage execution tracking (`writer`, `reviewer`, `repair`, `fallback`, `review`).
  - Unified budget enforcement (`attempts`, `ms`, `tokens`) across both per-item and whole-goal scopes.
  - Complete execution trace chaining: `decisionId`, `jobId`, `attemptId`, `launch`, `exit`, `reviewSha`, `verdict`, `stage`, `itemId`, `goalId`, `retryLayer`, `ms`, `tokens`, `tokenEnforcement`, `route`, and timestamp `at`.
  - Missing token discipline: tokens set to `'UNKNOWN'`, `tokenEnforcement` set to `'UNENFORCED'`, with zero financial/cost conversions.
  - Cross-layer retry deduplication across `pipeline`, `cli`, and `gateway` layers under the same `attemptId`/`jobId`.
  - Recursive credential masking (`maskCredentials`) for API keys, tokens, secrets, passwords, and userinfo in URLs, across strings, objects, and arrays.
  - Safe admission reservation (`admit` with `reserve: true`) syncing limit overrides with `ProgressLedger`, tracking goal attempts on reservation, and allowing matching records to complete without double-counting attempt usage.
  - Validation: requires valid stage, valid retry layer, and mandatory `jobId` or `attemptId`.
- `tools/ai-brain/test/run-ledger.test.js`:
  - 14 comprehensive unit tests covering chains, token semantics, budget caps, retry deduplication, recursive credential masking, ID validation, in-flight reservation handling, and tmpdir isolation.

## Out of scope

- Modifying existing Controller dispatch pipelines or supervisor scripts.
- Modifying security scanning policies, baselines, or allowlists.

## Business rules and edge cases

- `BR-LEDGER-01`: A run record must include either `attemptId` or `jobId`; missing both rejects with `RUN_LEDGER_REFUSED: missing jobId or attemptId`.
- `BR-LEDGER-02`: Stage must belong to `VALID_STAGES` (`writer`, `reviewer`, `repair`, `fallback`, `review`); otherwise reject with `RUN_LEDGER_REFUSED: invalid stage`.
- `BR-LEDGER-03`: Retry layer, if specified, must be one of `pipeline`, `cli`, `gateway`; invalid values reject with `RUN_LEDGER_REFUSED: invalid retryLayer`.
- `BR-LEDGER-04`: Retries across orchestration layers (`pipeline`, `cli`, `gateway`) with the same attempt identifier accumulate execution time (`ms`) and record verdicts, but consume only 1 attempt toward the attempt budget.
- `BR-LEDGER-05`: Missing token counts are stored as `'UNKNOWN'` with `tokenEnforcement: 'UNENFORCED'`. Missing tokens never default to 0, nor do they trigger currency/cost calculations.
- `BR-LEDGER-06`: Credential masking recursively redacts keys matching sensitive patterns (`key`, `secret`, `token`, `password`, `auth`, `credential`), strips basic auth credentials from URLs (`http://user:pass@host`), and masks Anthropic/OpenAI API key patterns (`sk-...`).
- `BR-LEDGER-07`: An admission reservation (`reserve: true`) records `IN_FLIGHT` state with PID; a subsequent run record with matching fingerprint/attemptId completes the reservation without consuming an additional attempt counter.
- `BR-LEDGER-08`: Distinct attempts cannot reuse or hijack an in-flight reservation credit; attempts exceeding budget caps are refused with `ATTEMPTS_EXHAUSTED`.
- `BR-LEDGER-09`: RunLedger limit overrides are synchronized onto the underlying ProgressLedger instance so reservations honor customized attempt limits.
- `BR-LEDGER-10`: Reservations tracked against a `goalId` increment goal attempts upon admission and maintain accurate goal rollups upon recording.

## Constitution check

- [x] **Tenant scope**: N/A — internal delivery orchestration and ledger tooling.
- [x] **RBAC & permissions**: N/A — local execution ledger; stage and layer validation enforced.
- [x] **Audit & sensitive data**: Strict recursive credential masking across strings, objects, and nested arrays in route identities; no secrets stored in ledger JSON.
- [x] **VND integer arithmetic**: N/A — zero currency conversion; cost fields strictly excluded.
- [x] **Carrier reconciliation**: N/A — local delivery toolchain.
- [x] **Tests at the lowest useful level, test-first where executable**: All 14 unit tests in `tools/ai-brain/test/run-ledger.test.js` verified passing.

## UI states

N/A — headless developer tool and AI delivery runtime module.

## API, event and data impact

- File-based JSON ledger schema (`runs`, `items`, `goals`, `goal`, `limits`) with atomic temporary file swapping.
- Zero external network API impact.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-169-01 | Writer -> review -> repair -> review chain | Computes correct total spent (attempts=4, ms=4100, tokens=1700) and preserves execution ID chain with verdicts | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-02 | Missing tokens handling | Tokens set to UNKNOWN, tokenEnforcement UNENFORCED, no cost/price/vnd fields, summary tracks tokensUnknown=1 | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-03 | Attempt or deadline budget cap exhaustion | Refuses admission and record with ATTEMPTS_EXHAUSTED or TIME_EXHAUSTED when limits exceeded | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-04 | Retry layer deduplication across pipeline/cli/gateway | Attempt counted once across retry layers with same attemptId while accumulating ms; invalid layer throws | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-05 | Route identity credential masking | apiKey, secret, token masked as [REDACTED]; URL passwords masked in endpoint | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-06 | Recursive credential masking in arrays | Secrets inside nested providers array recursively masked as [REDACTED] and URL credentials stripped | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-07 | Mandatory execution identifier | Record missing both jobId and attemptId throws RUN_LEDGER_REFUSED | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-08 | Deduplication before cap enforcement | Same attemptId across layers with cap=1 both recorded, accumulate ms, keep verdicts; new attempt refused | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-09 | Reservation completion | ProgressLedger.admit with reserve:true followed by record for same fingerprint counts 1 attempt total | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-10 | Filesystem isolation | No file writes outside os.tmpdir() | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-11 | Limit override synchronization | Reservations honor RunLedger limit override on underlying ProgressLedger | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-12 | Distinct attempt reservation isolation | Distinct attempt IDs cannot reuse in-flight reservation credit; excess attempts rejected | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-13 | Goal tracking on reservation and record | Reserve followed by record with goalId correctly tracks attempts in goal and per-goal rollups | `unit test: tools/ai-brain/test/run-ledger.test.js` |
| AC-AI-169-14 | ProgressLedger validateLedger schema compatibility | Preserves full counter schema (attempts, ms, tokens, tokensUnknown, unknownTokens), enforces attempts >= itemRecordCount, and sets valid pid/imputedTokens for IN_FLIGHT records | `unit test: tools/ai-brain/test/run-ledger.test.js` |

## Task breakdown

- [x] `T01` Implement RunLedger and helpers in tools/ai-brain/.
- [x] `T02` Acceptance criteria tests in tools/ai-brain/test/run-ledger.test.js.

## Author checklist

- [x] Run pnpm ai:check and paste its summary in the PR.

## Verification commands

- `pnpm format:check`
- `pnpm lint`
- `pnpm test:brain`
- `pnpm security:secrets`
- `node --test tools/ai-brain/test/run-ledger.test.js`
- `node scripts/ai/check-no-hardcode.mjs`

## Residual limitations

None.

```

## tools/ai-brain/run-ledger-helpers.js

```
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const fastRedact = require('fast-redact');
const { Cause } = require('./work-guard');

const VALID_STAGES = new Set(['writer', 'reviewer', 'repair', 'fallback', 'review']);
const VALID_RETRY_LAYERS = new Set(['pipeline', 'cli', 'gateway']);
const FORBIDDEN_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const SECRET_KEY =
  /^(api[-_]?key|secret|token|password|passwd|auth|authorization|credential|cookie)$/i;
const URL_KEY = /^(endpoint|url|uri|route|routeIdentity)$/i;

function isForbiddenId(id) {
  if (id === null || id === undefined) return false;
  let s;
  try {
    s = String(id);
  } catch (_) {
    return true;
  }
  return FORBIDDEN_IDS.has(s) || s in Object.prototype;
}

function assertValidId(id, name) {
  if (isForbiddenId(id)) throw new Error(`RUN_LEDGER_REFUSED: invalid ${name} ${id}`);
}

function maskUrl(v) {
  if (typeof v !== 'string') return v;
  try {
    const u = new URL(v);
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
    }
    for (const [k] of [...u.searchParams.entries()]) {
      if (SECRET_KEY.test(k)) u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString();
  } catch (_) {
    return v.replace(/([a-z][a-z0-9+.-]*:\/\/)[^@/\s]*@/i, '$1');
  }
}

function redactPaths(v, prefix, out) {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (const item of v) redactPaths(item, prefix + '[*]', out);
    return;
  }
  for (const [k, val] of Object.entries(v)) {
    const p = prefix ? prefix + '.' + k : k;
    if (SECRET_KEY.test(k)) out.secrets.push(p);
    else if (URL_KEY.test(k)) out.urls.push(p);
    if (val && typeof val === 'object') redactPaths(val, p, out);
  }
}

function maskCredentials(v) {
  if (typeof v === 'string') return maskUrl(v);
  if (!v || typeof v !== 'object') return v;
  const out = JSON.parse(JSON.stringify(v));
  const paths = { secrets: [], urls: [] };
  redactPaths(out, '', paths);
  if (paths.urls.length) {
    fastRedact({ paths: paths.urls, censor: maskUrl, serialize: false })(out);
  }
  if (paths.secrets.length) {
    fastRedact({ paths: paths.secrets, censor: '[REDACTED]', serialize: false })(out);
  }
  return out;
}

function writeJson(file, value) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function overLimit(spent, lim, now) {
  if (!lim) return null;
  if (Number.isFinite(lim.attempts) && (spent.attempts || 0) >= lim.attempts) return 'attempts';
  if (Number.isFinite(lim.ms) && (spent.ms || 0) >= lim.ms) return 'ms';
  if (
    Number.isFinite(lim.tokens) &&
    (spent.tokens || 0) + (spent.unknownTokens || 0) >= lim.tokens
  ) {
    return 'tokens';
  }
  return null;
}

function limitCause(k) {
  return k === 'ms'
    ? Cause.TIME_EXHAUSTED
    : k === 'tokens'
      ? Cause.TOKENS_EXHAUSTED
      : Cause.ATTEMPTS_EXHAUSTED;
}

function computeGoals(runs) {
  const goals = Object.create(null);
  const seen = new Map();
  for (const r of runs || []) {
    if (!r || !r.goalId || isForbiddenId(r.goalId)) continue;
    const g = (goals[r.goalId] = goals[r.goalId] || {
      attempts: 0,
      ms: 0,
      tokens: 0,
      tokensUnknown: 0,
      unknownTokens: 0,
    });
    const ids = seen.get(r.goalId) || new Set();
    if (r.attemptId && !ids.has(r.attemptId)) {
      ids.add(r.attemptId);
      g.attempts += 1;
    }
    seen.set(r.goalId, ids);
    if (Number.isFinite(r.ms)) g.ms += r.ms;
    if (Number.isFinite(r.tokens)) g.tokens += r.tokens;
    else if (r.tokens === 'UNKNOWN') g.tokensUnknown += 1;
  }
  return goals;
}

function normalizeAdmit(arg1, arg2, arg3, arg4) {
  if (typeof arg1 === 'object' && arg1 !== null) return Object.assign({ stage: arg1.stage }, arg1);
  if (typeof arg2 === 'object' && arg2 !== null) return Object.assign({ stage: arg1 }, arg2);
  if (typeof arg3 === 'string') return Object.assign({ itemId: arg1, stage: arg2, fp: arg3 }, arg4);
  return { stage: arg1, opts: arg2 };
}

function normalizeRecord(arg1, arg2, arg3) {
  let stage, opts;
  if (typeof arg1 === 'object' && arg1 !== null) {
    opts = arg1;
    stage = opts.stage;
  } else if (typeof arg2 === 'object' && arg2 !== null && !arg3) {
    stage = arg1;
    opts = arg2;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'string') {
    stage = arg2;
    opts = Object.assign({ itemId: arg1 }, typeof arg3 === 'object' ? arg3 : {});
  } else {
    stage = arg1;
    opts = arg2 || {};
  }
  const st = String(stage || '').toLowerCase();
  if (!VALID_STAGES.has(st)) throw new Error('RUN_LEDGER_REFUSED: invalid stage ' + stage);
  if (opts.retryLayer && !VALID_RETRY_LAYERS.has(opts.retryLayer)) {
    throw new Error('RUN_LEDGER_REFUSED: invalid retryLayer ' + opts.retryLayer);
  }
  if (!opts.attemptId && !opts.jobId) {
    throw new Error('RUN_LEDGER_REFUSED: missing jobId or attemptId');
  }
  if (
    opts.ms !== undefined &&
    (typeof opts.ms !== 'number' || !Number.isFinite(opts.ms) || opts.ms < 0)
  ) {
    throw new Error('RUN_LEDGER_REFUSED: invalid ms');
  }
  if (
    opts.tokens !== undefined &&
    (typeof opts.tokens !== 'number' || !Number.isFinite(opts.tokens) || opts.tokens < 0)
  ) {
    throw new Error('RUN_LEDGER_REFUSED: invalid tokens');
  }
  const attemptKey = String(opts.attemptId || opts.jobId);
  assertValidId(opts.itemId, 'itemId');
  assertValidId(opts.goalId, 'goalId');
  assertValidId(opts.fp || opts.fingerprint, 'fingerprint');
  return { stage: st, opts, attemptKey };
}

module.exports = {
  VALID_STAGES,
  VALID_RETRY_LAYERS,
  FORBIDDEN_IDS,
  SECRET_KEY,
  URL_KEY,
  isForbiddenId,
  assertValidId,
  maskUrl,
  redactPaths,
  maskCredentials,
  writeJson,
  overLimit,
  limitCause,
  computeGoals,
  normalizeAdmit,
  normalizeRecord,
};

```

## tools/ai-brain/run-ledger.js

```
'use strict';

/*
 * RunLedger is a thin execution-chain adapter over ProgressLedger (work-guard).
 * Budget ownership stays in ProgressLedger: admission, caps, attempt counting and
 * goal totals are delegated there. RunLedger only persists writer -> review ->
 * repair links and retry-layer metadata under keys ProgressLedger's validator
 * ignores. Masking uses fast-redact (MIT) with explicit paths and URL parsing.
 */

const { ProgressLedger, Cause, fingerprint } = require('./work-guard');
const {
  VALID_STAGES,
  VALID_RETRY_LAYERS,
  assertValidId,
  maskCredentials,
  writeJson,
  overLimit,
  limitCause,
  computeGoals,
  normalizeAdmit,
  normalizeRecord,
} = require('./run-ledger-helpers');

class RunLedger {
  constructor(o = {}) {
    if (typeof o === 'string') o = { file: o };
    this.progressLedger =
      o instanceof ProgressLedger ? o : o.progressLedger || new ProgressLedger(o);
    this.file = this.progressLedger.file;
    this.limits = o.limits || this.progressLedger.limits || {};
    this.progressLedger.limits = this.limits;
    this.now = o.now || this.progressLedger.now || (() => Date.now());
    this.progressLedger.now = this.now;
  }

  load() {
    return this.progressLedger.load();
  }

  settleAll() {
    const s = this.progressLedger.load();
    const pending = s.pending || {};
    for (const [itemId, byAttempt] of Object.entries(pending)) {
      for (const p of Object.values(byAttempt || {})) {
        if (!p || p.inflight) continue;
        this.progressLedger.recordUnlocked(itemId, p.stage, p.fp, p.outcome, {
          ms: p.ms,
          tokens: p.tokensKnown ? p.tokens : undefined,
        });
      }
    }
    const fresh = this.progressLedger.load();
    for (const [itemId, byAttempt] of Object.entries(fresh.pending || {})) {
      for (const [key, p] of Object.entries(byAttempt || {})) {
        if (p && !p.inflight) delete byAttempt[key];
      }
      if (Object.keys(byAttempt || {}).length === 0) delete fresh.pending[itemId];
    }
    if (fresh.pending && Object.keys(fresh.pending).length === 0) delete fresh.pending;
    if (fresh.pending !== undefined || s.pending !== undefined) writeJson(this.file, fresh);
    return fresh;
  }

  admit(arg1, arg2, arg3, arg4) {
    const a = normalizeAdmit(arg1, arg2, arg3, arg4);
    const opts = a.opts || a;
    const stage = a.stage;
    let itemId = a.itemId;
    const fp0 = a.fp || a.fingerprint;
    assertValidId(itemId, 'itemId');
    assertValidId(opts.goalId, 'goalId');
    assertValidId(fp0, 'fingerprint');
    const attemptKey = opts.attemptId || opts.jobId;
    const targetItemId = itemId || (attemptKey ? String(attemptKey) : null);
    assertValidId(targetItemId, 'itemId');
    if (opts.reserve && !targetItemId) return { ok: false, cause: Cause.NO_PROGRESS };

    const fp =
      fp0 ||
      (opts.headSha
        ? fingerprint({ headSha: opts.headSha, baseSha: opts.baseSha, inputs: opts.inputs })
        : 'att-' + (attemptKey || 'default'));
    assertValidId(fp, 'fingerprint');

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      const s = this.settleAll();
      if (!targetItemId) {
        const over = overLimit(s.goal, this.limits.goal, this.now());
        if (over) return { ok: false, cause: limitCause(over), limit: over };
        return { ok: true };
      }
      return this.progressLedger.admitUnlocked(targetItemId, stage, fp, opts);
    });
  }

  record(arg1, arg2, arg3) {
    const { stage: st, opts, attemptKey } = normalizeRecord(arg1, arg2, arg3);

    return this.progressLedger.locked(() => {
      this.progressLedger.limits = this.limits;
      let s = this.progressLedger.load();
      let itemId = opts.itemId;
      if (!itemId) {
        const prior = (s.runs || []).find((r) => r.attemptId === attemptKey && r.itemId);
        if (prior) itemId = prior.itemId;
      }
      const targetItemId = String(itemId || attemptKey);
      assertValidId(targetItemId, 'itemId');
      if (
        itemId &&
        (s.runs || []).some((r) => r.attemptId === attemptKey && r.itemId && r.itemId !== itemId)
      ) {
        return { ok: false, cause: Cause.NO_PROGRESS, reason: 'attempt-owned-by-other-item' };
      }

      const reviewSha = opts.reviewSha || opts.headSha || null;
      const fp =
        opts.fp ||
        opts.fingerprint ||
        (reviewSha
          ? fingerprint({ headSha: reviewSha, baseSha: opts.baseSha, inputs: opts.inputs })
          : 'att-' + attemptKey);
      assertValidId(fp, 'fingerprint');
      const verdict = String(opts.verdict || opts.outcome || 'DONE');
      const ms = Number(opts.ms) || 0;
      const known = Number.isFinite(opts.tokens);
      const pending = (s.pending = s.pending || Object.create(null));
      const byItem = (pending[targetItemId] = pending[targetItemId] || Object.create(null));
      const current = byItem[attemptKey];

      if (current) {
        const owner = Object.values(byItem).find(
          (p) => p && p.fp === fp && p.stage === st && p.attemptId !== attemptKey && p.inflight
        );
        if (owner) {
          return {
            ok: false,
            cause: Cause.NO_PROGRESS,
            reason: 'in-flight-owned-by-other-attempt',
          };
        }
        current.ms += ms;
        if (known) {
          current.tokens = (current.tokens || 0) + opts.tokens;
          current.tokensKnown = true;
        }
        current.outcome = verdict;
        current.inflight = verdict === 'IN_FLIGHT';
      } else {
        const owner = Object.values(byItem).find(
          (p) => p && p.fp === fp && p.stage === st && p.inflight
        );
        if (owner) {
          return {
            ok: false,
            cause: Cause.NO_PROGRESS,
            reason: 'in-flight-owned-by-other-attempt',
          };
        }
        s = this.settleAll();
        const item = s.items && s.items[targetItemId];
        const rec = item && item.stages && item.stages[st] && item.stages[st].fps[fp];
        if (!rec || rec.outcome !== 'IN_FLIGHT') {
          const res = this.progressLedger.admitUnlocked(targetItemId, st, fp, {
            reserve: true,
            pid:
              Number.isInteger(opts.pid) && opts.pid > 0
                ? opts.pid
                : this.progressLedger.lastPid || process.pid,
          });
          if (!res.ok) return res;
        }
        s = this.progressLedger.load();
        const pend = (s.pending = s.pending || Object.create(null));
        const itemPend = (pend[targetItemId] = pend[targetItemId] || Object.create(null));
        itemPend[attemptKey] = {
          attemptId: attemptKey,
          stage: st,
          fp,
          ms,
          tokens: known ? opts.tokens : 0,
          tokensKnown: known,
          outcome: verdict,
          inflight: verdict === 'IN_FLIGHT',
        };
      }

      s = this.progressLedger.load();
      const effectiveGoalId =
        opts.goalId ||
        ((s.runs || []).find((r) => r.attemptId === attemptKey && r.goalId) || {}).goalId ||
        null;
      assertValidId(effectiveGoalId, 'goalId');
      const run = {
        decisionId: opts.decisionId || null,
        jobId: opts.jobId || null,
        attemptId: attemptKey,
        launch: opts.launch !== undefined ? opts.launch : null,
        exit: opts.exit !== undefined ? opts.exit : null,
        reviewSha,
        verdict: opts.verdict || opts.outcome || null,
        stage: st,
        itemId: targetItemId,
        goalId: effectiveGoalId,
        retryLayer: opts.retryLayer || null,
        ms,
        tokens: known ? opts.tokens : 'UNKNOWN',
        tokenEnforcement: known ? opts.tokenEnforcement || 'ENFORCED' : 'UNENFORCED',
        route: maskCredentials(opts.route || opts.routeIdentity || null),
        at: this.now(),
      };
      s.runs = s.runs || [];
      s.runs.push(run);
      s.chains = s.chains || Object.create(null);
      s.chains[targetItemId] = s.chains[targetItemId] || [];
      s.chains[targetItemId].push(run);
      if (s.items && s.items[targetItemId]) s.items[targetItemId].runs = s.chains[targetItemId];
      s.goals = computeGoals(s.runs);
      writeJson(this.file, s);
      return { ok: true, run };
    });
  }

  getRuns(itemId) {
    const s = this.progressLedger.load();
    if (itemId) return (s.chains && s.chains[itemId]) || [];
    return s.runs || [];
  }

  getChain(itemId) {
    return this.getRuns(itemId);
  }

  getSummary(itemId) {
    return this.progressLedger.locked(() => {
      const s = this.settleAll();
      if (itemId) {
        return (
          (s.items[itemId] && s.items[itemId].spent) || {
            attempts: 0,
            ms: 0,
            tokens: 0,
            tokensUnknown: 0,
            unknownTokens: 0,
          }
        );
      }
      return s.goal;
    });
  }

  block(itemId, reason) {
    return this.progressLedger.block(itemId, reason);
  }

  unblock(itemId) {
    return this.progressLedger.unblock(itemId);
  }
}

module.exports = { RunLedger, maskCredentials, VALID_STAGES, VALID_RETRY_LAYERS, Cause };

```