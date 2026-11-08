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
