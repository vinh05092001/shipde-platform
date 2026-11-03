# TASK-AI-168 — Lane launcher with generation lock, result validation, and cleanup

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-168` |
| Feature ID | `N/A — AI unified routing core lane launcher` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `301` |
| Dependencies | `TASK-AI-167` |
| Assigned author | `AGY` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/lane-launcher.js; tools/ai-brain/test/lane-launcher.test.js; docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv; docs/product-spec/work-items/TASK-AI-168.md; .oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-168-lane-launcher` |
| Pull Request | `Set when opened` |

## Business outcome

Provide safe, isolated execution lane management for the unified routing core (`tools/ai-brain/lane-launcher.js`). Every launch assigns fresh `jobId` and `attemptId` identifiers, rejects busy lanes that have an active job without a matching result, protects resources with generation locks where only the owner releases, accepts only results matching the active `jobId`, redacts credentials line-by-line in stderr outputs, and scopes process cleanup exclusively to the job's recorded `pidTree` without touching external processes.

## Source references

- `AGENTS.md` (Unit of delivery, Code review rules, Hard prohibitions, Role separation)
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- `docs/product-spec/work-items/TASK-AI-167.md` (Progress guard, generation locks, `acceptResult`, `runWithCleanup`)
- `tools/ai-brain/lane-launcher.js`
- `tools/ai-brain/test/lane-launcher.test.js`

## Preconditions and dependencies

- `TASK-AI-167` merged or available providing `work-guard.js` primitives (`acquireLock`, `releaseLock`, `acceptResult`, `runWithCleanup`).
- Clean worktree on branch `feat/task-ai-168-lane-launcher`.
- Node.js runtime supporting `node:test`, `node:crypto`, `node:fs`, and `node:path`.

## Ambiguity and clarification markers

None. All lane launcher behaviors, locking semantics, redaction patterns, and cleanup isolation constraints are fully specified and verified.

## Author boundary

Appropriate for AGY author under governed repository workflow. Scoped strictly to lane launcher runtime isolation, generation lock management, stderr redaction, and pid cleanup. Does not modify application product code, database schemas, allowlists, baselines, or CI security policies.

## Slice sizing rule

Single vertical delivery of execution lane management, unit test suite, Work Item specification, delivery register update, and PR body, within ~400 lines target.

## In scope

- `tools/ai-brain/lane-launcher.js`:
  - `launch(lane, job, options)`: generates fresh `jobId` and `attemptId` (UUID), checks existing `job.json`, refuses launch if lane has an active job without matching result (`LANE_BUSY`), enforces `pid > 0`, acquires generation lock via `acquireLaneLock`, writes `job.json`.
  - `acquireLaneLock(lane, owner, options)`: verifies positive pid, delegates to `acquireLock` from `work-guard.js`.
  - `releaseLaneLock(lane, owner)`: delegates to `releaseLock` from `work-guard.js`, ensures only owner can release.
  - `readResult(lane, job)`: reads `result.json` and validates via `acceptResult(job, parsed)`, discarding stale or mismatched results.
  - `saveResult(lane, job, outcome)`: saves `result.json` containing `exitCode`, `durationMs`, `logPath`, and `stderr` redacted line-by-line via `redactStderr`.
  - `redactStderr(text)`: line-by-line redaction replacing lines containing credentials (tokens, api keys, bearer, authorization, passwords, standalone keys) with `[REDACTED LINE: credential]`, preserving safe log lines and line endings.
  - `cleanup(lane, job, options)`: verifies supplied `jobId` matches stored `job.json`, rejects empty or mismatched identifiers (`JOB_MISMATCH`), and kills only processes in the job's recorded `pidTree`/`pids`/`pid`.
- `tools/ai-brain/test/lane-launcher.test.js`: comprehensive unit test suite covering contention, stale results, lock generations, isolated process cleanup, and line-by-line redaction.

## Out of scope

- Production controller dispatch loop integration (handled in subsequent workflow tasks).
- Modifications to `work-guard.js` core primitives.
- Product database schema migrations or UI components.

## Business rules and edge cases

- `BR-LANE-01`: Two jobs contending for one lane results in the second being rejected; `skipLock` is explicitly removed to prevent lock check bypass; non-positive pids are refused.
- `BR-LANE-02`: Every launch generates fresh UUID `jobId` and `attemptId`; relaunching with an existing job object still generates new identifiers.
- `BR-LANE-03`: `readResult` returns `null` if the stored `result.json` does not match the active `jobId`.
- `BR-LANE-04`: Lane locks are generation-based; a live holder prevents contention regardless of lock age; dead holders are superseded by the next generation; non-owners cannot release the lock.
- `BR-LANE-05`: `cleanup` only kills processes when the supplied `jobId` matches the lane's `job.json`; empty or mismatched job identifiers fail closed with `cause: 'JOB_MISMATCH'` and zero kills.
- `BR-LANE-06`: Stderr redaction inspects each line independently; lines with credential keywords (`api_key`, `token`, `bearer`, `secret`, `key`, etc.) are redacted to `[REDACTED LINE: credential]`, while safe lines remain untouched.

## Constitution check

- [x] **Tenant scope**: N/A — Local runtime process and execution lane isolation only.
- [x] **RBAC & permissions**: N/A — Local CLI and agent runner execution lane.
- [x] **Audit & sensitive data**: Stderr sanitized line-by-line to prevent token/credential leakage into logs or results.
- [x] **VND integer arithmetic**: N/A — No monetary values manipulated.
- [x] **Carrier reconciliation**: N/A — No carrier APIs involved.
- [x] **Tests at the lowest useful level, test-first where executable**: All 13 acceptance scenarios verified via isolated unit tests in `tools/ai-brain/test/lane-launcher.test.js`.

## UI states

N/A — Backend and runtime tooling task; no user interface modified.

## API, event and data impact

No API schema or database impact. Local lane artifacts on filesystem: `job.json`, `lock`, `result.json`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-168-01 | 2 jobs contending for 1 lane | Second job rejected (`ok: false`), `skipLock` dropped, non-positive pid throws `positive pid required` | unit (`lane-launcher.test.js`) |
| AC-AI-168-02 | Stale job result in lane | `readResult` returns `null` for mismatched `jobId`, returns result only when `jobId` matches | unit (`lane-launcher.test.js`) |
| AC-AI-168-03 | Generation lock lifecycle | Live holder prevents stealing; non-owner release rejected; dead owner superseded by next generation; owner releases | unit (`lane-launcher.test.js`) |
| AC-AI-168-04 | Process cleanup isolation | `cleanup` kills only `pidTree` recorded in `job.json` when `jobId` matches; mismatched `jobId` kills nothing | unit (`lane-launcher.test.js`) |
| AC-AI-168-05 | Stderr credential redaction | `saveResult` redacts credentials line-by-line (JSON, Bearer, api_key, token), persists `exitCode`, `durationMs`, `logPath` | unit (`lane-launcher.test.js`) |
| AC-AI-168-06 | Relaunch with same job object | Fresh `jobId` and `attemptId` generated; previous job result discarded | unit (`lane-launcher.test.js`) |
| AC-AI-168-07 | Launch after completion and lock release | New job successfully launches once prior job result is recorded and lock released | unit (`lane-launcher.test.js`) |
| AC-AI-168-08 | Redact unquoted comma-separated key | `saveResult` redacts line containing unquoted comma key (`api_key=FAKE_PREFIX,FAKE_SUFFIX`) | unit (`lane-launcher.test.js`) |
| AC-AI-168-09 | Cleanup rejects job without jobId | `cleanup` fails with `ok: false` and kills nothing when job object lacks `jobId` | unit (`lane-launcher.test.js`) |
| AC-AI-168-10 | Redact quoted token following unquoted key | `saveResult` redacts mixed unquoted key and quoted token lines | unit (`lane-launcher.test.js`) |
| AC-AI-168-11 | Cleanup rejects empty job identifier | `cleanup` returns `ok: false`, `cause: 'JOB_MISMATCH'` for empty string or `{ jobId: '' }`, 0 kills | unit (`lane-launcher.test.js`) |
| AC-AI-168-12 | Line-by-line redaction preserves safe lines | `redactStderr` replaces only lines containing credentials, keeping safe lines intact | unit (`lane-launcher.test.js`) |
| AC-AI-168-13 | Redact standalone key flag | `saveResult` redacts lines containing standalone key flags (`--key=FAKE_ONLY`) | unit (`lane-launcher.test.js`) |
| AC-AI-168-14 | No hardcoded production secrets | `node scripts/ai/check-no-hardcode.mjs` exits with code 0 | automated test |

## Task breakdown

- [x] `T01` [P] Implement unit tests in `tools/ai-brain/test/lane-launcher.test.js` covering contention, stale results, lock generations, isolated process cleanup, and line-by-line redaction.
- [x] `T02` Implement `tools/ai-brain/lane-launcher.js` with `launch`, `acquireLaneLock`, `releaseLaneLock`, and `readResult`.
- [x] `T03` Implement line-by-line `redactStderr` and `saveResult` sanitizing credentials across JSON, punctuation, and standalone flags.
- [x] `T04` Implement `cleanup` validating job identifiers and killing only target job's `pidTree`.
- [x] `T05` Author Work Item document `TASK-AI-168.md` and update `FEATURE-DELIVERY-REGISTER.csv`.
- [x] `T06` Prepare `.oc/pr-body.md` following PR template with verification and safety evidence.
- [x] `T07` Run full quality gates (`pnpm format:check`, `pnpm lint`, `pnpm test:brain`, `pnpm security:secrets`, `python docs/product-spec/scripts/validate_docs.py`, `check-no-hardcode.mjs`).

## Author checklist

- [x] Run `node scripts/ai/check-no-hardcode.mjs` and paste summary in PR.
- [x] Verify unit tests pass with 100% coverage of acceptance scenarios.

## Verification commands

```bash
pnpm format:check
pnpm lint
pnpm test:brain
pnpm security:secrets
python docs/product-spec/scripts/validate_docs.py
node scripts/ai/check-no-hardcode.mjs
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `64be8cb` | CHANGES_REQUIRED | Redact JSON secrets in stderr, scope cleanup to matching lane job, enforce fresh launch IDs, drop skipLock |
| 2 | `2fb8623` | CHANGES_REQUIRED | Redact unquoted keys containing punctuation and reject cleanup without jobId |
| 3 | `1a89c49` | CHANGES_REQUIRED | Redact credentials by whole line and reject empty cleanup identifiers |
| 4 | `c7fc80a` | CHANGES_REQUIRED | Mask lines carrying a bare key credential |
| 5 | `9b6668f` | PASS | Codex independent review PASS — all findings resolved, ready for PR packaging |

## Residual limitations

None.
