# TASK-AI-120 — A passed commit reaches the host after an interrupt and handoff failures blame no model

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-120` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `233` |
| Dependencies | `TASK-AI-119` |
| Assigned author | `9ROUTER` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-120.test.js`; `docs/product-spec/work-items/TASK-AI-120.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-120-resume-import` |
| Pull Request | `Pending` |

## Business Outcome

TASK-AI-111's worker committed `c524b11` and the run was interrupted at `review_completed` (review PASS). On resume, the step had no `passedRef` and the host repo never received `c524b11`. TASK-AI-112 (depends on 111) failed with cause/scope `unknown`, incorrectly blaming `cl`, `ocz`, and `xmtp`.

Now when a step resumes at `review_completed` with a PASS review but no `passedRef`, the Controller imports the commit into the host before any dependent launch. If the commit doesn't exist in the host or worker, the dependent is BLOCKED with `DEPENDENCY_COMMIT_UNAVAILABLE` and no candidate is blamed. Launch failures due to missing base commits record cause `launch_config` / scope `local` / failureDomain `null`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RI-R01 | Resume at review_completed with PASS but no passedRef | Commit imported to host, checkpoint records passedRef, dependent launches from that SHA | RI-R01 test in `tools/ai-brain/test/task-ai-120.test.js` |
| RI-R02 | SHA in neither host nor worker | Dependent BLOCKED with DEPENDENCY_COMMIT_UNAVAILABLE, zero writer launches | RI-R02 test |
| RI-R03 | Launch failure due to missing base | cause=launch_config, scope=local, failureDomain=null, candidate NOT excluded | RI-R03 test |
| RI-R04 | Orchestrate without cwd | No refs/shipde/* created in process.cwd() | RI-R04 test |
| RI-R05 | Existing tests | All referenced tests pass unchanged | RI-R05 test suite run |
| RI-R06 | Register row | One row 233 with READY_FOR_CODEX status | git diff --numstat shows 1 0 for register |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-120.test.js tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-117.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/task-ai-64.test.js tools/ai-brain/test/failure-classifier.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-120.test.js docs/product-spec/work-items/TASK-AI-120.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged orchestrate.js): RI-R01/R02/R03/R04 tests fail
- Pass-after: All new tests pass

## Residual Limitations

None.
