# TASK-AI-188 — A repair adopts the dirty work its own writer left

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-188` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-171` (merged) |
| Assigned author | Claude Code, from agy08's root-cause analysis of the TASK-AI-187 live run |
| Risk | `MEDIUM`: touches the repair ownership check that guards adoption of uncommitted worker changes |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/orchestrate/repair-round.js`; `tools/ai-brain/orchestrate/writer-loop.js`; `tools/ai-brain/isolation/git-workspace.js`; `tools/ai-brain/test/task-ai-188-repair-adoption.test.js`; this file; the delivery register |
| Reviewer | Independent reviewer on a model other than Claude |
| Branch | `feat/task-ai-188-repair-adoption` |

## Business outcome

The first live combo-only run (TASK-AI-187) stopped with `REPAIR_BUDGET_EXHAUSTED` without a single repair running.

- The writer fixed the code but did not commit.
- Each of the three repairs was refused with `WORKER_HEAD_MISMATCH: retained worker root HEAD … is dirty`.

The Controller already has a safe path for this case (`isolation-launcher.js` around lines 250–370). That path:

- checks that no changed file is a secret;
- checks that every changed file is inside the Work Item's allowed paths;
- commits "Restore interrupted writer work" with the hooked controller git;
- lets the repair continue.

That path runs only when `retainedRootHasOwnWriterRecord` finds a writer record of the same run. In a live run it never could:

1. The repair job carried no `runId`.
2. The `writer-launch-result` record had no `workerRoot` or `sha`.
3. The `launched` record had no `runId`, and it stores its root as `worktree`, which the check did not read.

In addition, every decision in a run carried the run's start time, because `logOpts.now` was fixed once.

After this change a repair can adopt the work its own writer left behind, and decision timestamps advance in live runs.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | The repair job passed to the launcher carries the run's `runId` | `test/task-ai-188-repair-adoption.test.js`: the repair job handed to the launcher carries the run id |
| AC2 | A real `writer-launch-result` record carries `workerRoot` and the worker `sha`, and makes `retainedRootHasOwnWriterRecord` return true for a repair of the same run, and false for another run | `test/task-ai-188-repair-adoption.test.js`: a real writer-launch-result owns the dirty retained root |
| AC3 | A `launched` record with `runId`, `worktree` and `sha` satisfies the ownership check | `test/task-ai-188-repair-adoption.test.js`: a launched record carries enough … |
| AC4 | A live run stamps each decision with its own time; a supplied `o.now` still fixes it for tests | Full suite |

The safety checks of the adoption path (secret paths, allowed paths, hooked commit, run ownership, age limit) are unchanged.

## Verification

- `node --test tools/ai-brain/test/task-ai-188-repair-adoption.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- Live: re-run TASK-AI-187 through the Controller.
