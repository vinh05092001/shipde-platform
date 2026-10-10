# TASK-AI-135 — Intake resolves dependencies from main history, and orchestrate explains planner refusals

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-135` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `247` |
| Dependencies | `TASK-AI-131` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/intake.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-135.test.js`; `tools/ai-brain/test/task-ai-131.test.js`; `docs/product-spec/work-items/TASK-AI-135.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-135-intake-dependencies` |
| Pull Request | `Pending` |

## Business Outcome

Intake previously passed a one-item spec to the planner while retaining dependencies already merged on `origin/main`. The planner treated each such dependency as unknown, and the operator received a generic publication refusal without the cause.

DP-R01: for each declared dependency, intake uses the pinned `origin/main` SHA and the delivery register. A dependency counts as merged when its register status is `MERGED`, or when that SHA's history contains a subject with the exact `[<DEP-ID>]` token and a `(#<number>)` PR reference. Intake removes resolved dependencies from the run spec and writes each resolved ID and commit SHA to `resolved-dependencies.json`. Any unresolved dependency causes `DEPENDENCY_NOT_MERGED` and lists every unresolved ID; intake does not infer status.

DP-R02: when planner validation returns errors, orchestrate refuses before dispatch, includes every error in its returned plan and refusal reason, logs each as a `refused` decision, and prints the plan errors and refusal in CLI output. A planner refusal cannot have an empty reason.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| DP-R01 | History-merged dependency | Exact-ID PR history resolves it; run spec omits it and run directory records its commit SHA | Test |
| DP-R01 | Register-merged dependency | `MERGED` register row resolves it and records its merge commit SHA | Test |
| DP-R01 | Unmerged dependencies | Intake refuses with `DEPENDENCY_NOT_MERGED` and lists every dependency | Test |
| DP-R01 | Exact ID matching | `FEAT-AUTH-10` history does not resolve `FEAT-AUTH-1` | Test |
| DP-R02 | Planner errors | Orchestrate result, CLI output, and decision log expose each error and a non-empty refusal reason | Test |
| DP-R03 | Offline test isolation | Tests use fake commits in temporary git repositories under `.upstream-tmp`; no network | Test |
| DP-R04 | Handoff artifacts | Work Item exists and one 14-column register row 247 is appended | Files; register numstat `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-135.test.js tools/ai-brain/test/task-ai-131.test.js tools/ai-brain/test/task-ai-132.test.js`
- `node --test tools/ai-brain/test/*.test.js` (with `NINEROUTER_API_KEY` unset)
- `./node_modules/.bin/prettier --check tools/ai-brain/intake.js tools/ai-brain/orchestrate.js tools/ai-brain/cli.js tools/ai-brain/test/task-ai-135.test.js docs/product-spec/work-items/TASK-AI-135.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: the new acceptance test file is absent from `origin/main`; on this branch before the implementation, intake retains merged dependencies and the planner reports them as `UNKNOWN_DEPENDENCY`. Planner errors are not logged as refusal decisions and the CLI output omits them.
- Pass-after: the new acceptance tests pass 5/5; the required AI-131/AI-132/AI-135 regression command passes 27/27 with `NINEROUTER_API_KEY` unset; the full brain suite passes 1704/1704. Prettier and `git diff --check` pass, and the register diff is exactly one added line (`1 0`).

## Residual Limitations

None.
