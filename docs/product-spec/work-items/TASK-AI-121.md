# TASK-AI-121 — Launch infrastructure failures are reported as local, and the worker timeout is configurable

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-121` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `234` |
| Dependencies | `TASK-AI-120` |
| Assigned author | `9ROUTER` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-121.test.js`; `docs/product-spec/work-items/TASK-AI-121.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-121-launch-failures-local` |
| Pull Request | `Pending` |

## Business Outcome

Gate5f evidence (2026-10-08): `isolation-launcher.js` threw `ISOLATION_VERDICT_STALE` (verdict older than 24h), plain errors on a failed worker-root removal (`EPERM`/`EBUSY`) and on a failed clone, and `ISOLATION_CHECKOUT_FAILED` / `PROVISION_BASE_MISMATCH` on provisioning. `orchestrate.js` recorded every one of them as cause `unknown`, scope `unknown`, detail `unknown`, then cooled down every model for five minutes so the next run refused with `NO_ELIGIBLE_CANDIDATE`. The real message was lost; the supervisor could only recover it from a scratch script. Separately, the worker timeout was hard-coded at 30 minutes and three writers each timed out at 30 minutes with working code but no commit.

Now a launch infrastructure failure is classified `launch_config` / `local` with `failureDomain: null`, blames no candidate and sets no evidence cooldown, and the decision log's `failed` entry carries the launcher's real message (first 300 chars, secrets scrubbed). A stale or missing isolation verdict stops the run immediately: status `BLOCKED`, the real reason, and the human action `run scripts/ai/isolation/Test-WorkerIsolation.ps1` — no second candidate and no later work item is launched. The worker timeout is configurable with `--worker-timeout-min N` (1..240, default 30) and reaches the isolated launcher as `workerTimeoutMs` for writer, reviewer and repair launches; the run log records it.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| LF-R01 | Isolated launcher throws `ISOLATION_VERDICT_STALE` / `_MISSING` / `_INVALID`, `ISOLATION_CHECKOUT_FAILED`, `PROVISION_BASE_MISMATCH`, worker-root removal `EPERM`/`EBUSY`, or `Failed to clone repository` | `failed` entry: detail = real message (first 300 chars, no secrets), cause `launch_config`, scope `local`; `failureDomain` null; candidate in no exclusion set and no evidence cooldown | LF-R01 tests in `tools/ai-brain/test/task-ai-121.test.js` |
| LF-R02 | Stale or missing isolation verdict | Run stops immediately: status `BLOCKED`, reason starts with `ISOLATION_VERDICT_STALE` / `ISOLATION_VERDICT_MISSING`, human action `run scripts/ai/isolation/Test-WorkerIsolation.ps1`; no next candidate and no next work item is launched | LF-R02 tests |
| LF-R03 | `orchestrate --worker-timeout-min N` (1..240, default 30) | `workerTimeoutMs` reaches the isolated launcher for writer, reviewer and repair launches and is recorded in the run log; values outside 1..240 are refused | LF-R03 tests |
| LF-R04 | New tests fail on unchanged code and pass after | Every LF-R01/R02/R03 test fails on `origin/main` and passes with the change | Fail-before / pass-after run |
| LF-R05 | Work Item and register | `TASK-AI-121.md` with the standard sections; exactly one appended register row `234` (`READY_FOR_CODEX`, branch `fix/task-ai-121-launch-failures-local`) | `git diff origin/main --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-121.test.js tools/ai-brain/test/task-ai-120.test.js tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-117.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/task-ai-64.test.js tools/ai-brain/test/failure-classifier.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/failure-classifier.js tools/ai-brain/orchestrate.js tools/ai-brain/cli.js tools/ai-brain/test/task-ai-121.test.js docs/product-spec/work-items/TASK-AI-121.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged code on `origin/main`): all 8 tests in `tools/ai-brain/test/task-ai-121.test.js` fail
- Pass-after: all 8 new tests pass; the full verification list passes (272 tests, 0 failures)

## Residual Limitations

- `ISOLATION_VERDICT_INVALID` (wrong worktree, policy hash, SID or checks) is classified local and blameless but, per LF-R02, only a stale or missing verdict stops the run; an invalid verdict lets the Controller continue with the remaining candidates even though they would fail the same way.
- The worker timeout governs worker launches (writer, reviewer, repair); the host-side verification command keeps its own `timeoutMs` default.
