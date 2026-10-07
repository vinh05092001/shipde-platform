# TASK-AI-119 — A passed worker commit is kept in the host repo so dependents can start from it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-119` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `232` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/passed-commit.js`; `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/test/task-ai-119.test.js`; `docs/product-spec/work-items/TASK-AI-119.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-119-keep-passed-commit` |
| Pull Request | `Pending` |

## Business Outcome

The gate 5 live run on main (`0ed76eb`, 2026-10-07) lost a finished worker to a dead reattach. TASK-AI-111's worker committed `2a4a678` in the isolated worker root. TASK-AI-114 correctly launched dependent TASK-AI-112 with baseSha `2a4a678`, but the launcher re-provisions the worker root by cloning the HOST repo, which never received `2a4a678`. Every launch failed immediately, and each failure was mis-blamed on a model.

Now when a Work Item's review returns PASS at a worker SHA, the Controller imports that commit into the host repo under a namespaced ref before any later re-provisioning. Dependents launch from that exact SHA. On resume, a PASS item whose commit is missing from the host is re-imported from the worker root.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| KC-R01 | After review PASS at worker SHA | Commit imported to `refs/shipde/passed/<id>/<sha>`, checkpoint records `passedRef`, dependent launches from that SHA | KC-R01 test in `tools/ai-brain/test/task-ai-119.test.js` |
| KC-R02 | On resume, commit missing from host but present in worker | Re-imported from worker, ref present, dependent launches | KC-R02 test in `tools/ai-brain/test/task-ai-119.test.js` |
| KC-R04 | Repair path (retainWorkerHead) and PROVISION_BASE_MISMATCH | Unchanged from origin/main | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-64.test.js` |
| KC-R05 | Tests | `node:test` with real temp repos under `./.upstream-tmp/`, injected fake launchers/reviewers; tests fail on unchanged code | `tools/ai-brain/test/task-ai-119.test.js` |
| KC-R06 | Register and work-item documentation | One register row `232` for `TASK-AI-119` (`READY_FOR_CODEX`, branch `fix/task-ai-119-keep-passed-commit`); `git diff --numstat` shows `1 0` for the register | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-117.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/failure-classifier.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/passed-commit.js tools/ai-brain/failure-classifier.js tools/ai-brain/test/task-ai-119.test.js docs/product-spec/work-items/TASK-AI-119.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged `tools/ai-brain/orchestrate.js` + the new tests): KC-R01 fails (no `passedRef`), KC-R02 tests would pass without re-import implementation (happy path), KC-R03 fails (no `local` in reason).
- Pass-after: all three tests pass.

## Residual Limitations

- If the import at PASS time fails, the item still completes `REVIEW_PASS` with no `passedRef`; the dependent-side check handles the missing commit.
- The `hostCwd` must be set for the import and dependency check to run.
- Worker root path resolution for re-import uses `review.entry.workerRoot` or `session.worktree`.
- KC-R03 (`PROVISION_BASE_MISSING`, scope `local`, no domain exclusion) and the KC-R02 "gone from both host and worker → BLOCKED `DEPENDENCY_COMMIT_UNAVAILABLE`" branch are deferred to follow-up Work Item TASK-AI-120.
