# TASK-AI-60 - Autonomous planning and repair loop (dry-run level)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-60`                                                                                                                                                                                                                                                                                                                                                    |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                           |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                                               |
| Delivery order  | `186`                                                                                                                                                                                                                                                                                                                                                           |
| Dependencies    | `TASK-AI-50`                                                                                                                                                                                                                                                                                                                                                    |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                        |
| Risk            | `MEDIUM`                                                                                                                                                                                                                                                                                                                                                        |
| Allowed paths   | `tools/ai-brain/planner.js`, `tools/ai-brain/prompt-compiler.js`, `tools/ai-brain/supervisor.js`, `tools/ai-brain/review-loop.js`, `tools/ai-brain/orchestrate.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/task-ai-60.test.js`, `docs/product-spec/work-items/TASK-AI-60.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex - fresh independent task`                                                                                                                                                                                                                                                                                                                                |
| Branch          | `feat/task-ai-60-autonomous-loop`                                                                                                                                                                                                                                                                                                                               |
| Pull Request    | `Pending`                                                                                                                                                                                                                                                                                                                                                       |

## Business outcome

The Controller (TASK-AI-58) selects a candidate and dispatches one Work Item. What no component yet provides is the loop around that dispatch: turn a user goal into a validated plan of Work Items, compile one prompt per item, classify a running session honestly, and run a bounded review/repair cycle. TASK-AI-60 delivers that loop at dry-run level - four pure modules plus a dry-run orchestration entry that runs goal to plan to prompts to Controller selection to simulated fallback to checkpoint/resume to simulated tests/review/repair, without a live agent, a daemon, a framework import, or a second state store.

## Source references

- `AGENTS.md` - Role separation and Unit of delivery.
- `tools/ai-brain/scheduler.js` - `planDispatch`, the planner/executor split this Work Item generalises.
- `tools/ai-brain/candidates.js` - `candidateKey`, `generateCandidates` (the seven-part candidate identity).
- `tools/ai-brain/ranking.js` - `rankAndRecord`, the single ranking engine this Work Item reuses.
- `tools/ai-brain/decisions.js` - the single decision/state log this Work Item reuses.
- `tools/ai-brain/executor.js` - `defaultPrompt`, `executePlan`, `Outcome`.
- `tools/ai-brain/harness.js` - `progressVerdict`, `structuredOutcome`.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` - `AI-TOOL-03` (the concurrent implementation ceiling).

## Preconditions and dependencies

- `TASK-AI-50` (Hermes pinned adapter and Jev advisory) is merged at `2ed7bd9`, reviewed PASS.
- `TASK-AI-58` (Controller MVP) is on main: it owns candidate selection, evidence, quota/cooldown, ranking, reservation, fallback, checkpoint/resume and the decision log. This Work Item never re-implements any of those.

## In scope

1. A goal planner (`planner.js`) that produces a validated DAG of Work Items with capability requirements (never a model/provider/account), rejecting cycles and file-ownership collisions.
2. A prompt compiler (`prompt-compiler.js`) that emits one prompt per item carrying the full scope and the publisher boundary (workers never push/PR/merge) and the pinned candidateKey.
3. A session supervisor (`supervisor.js`) that classifies a session from real progress signals as RUNNING_WITH_PROGRESS / STALLED / FAILED / COMPLETED_WITH_ARTIFACT / COMPLETED_EMPTY / UNKNOWN.
4. A review/repair loop (`review-loop.js`) bound to an exact SHA, rejecting PASS-with-findings, and bounded to a repair budget that returns BLOCKED when exhausted.
5. A dry-run orchestration (`orchestrate.js` + `cli.js orchestrate`) that runs the whole loop and writes a log to `--out`, reusing `ranking.js` and `decisions.js` only.

## Out of scope

- A live agent, a daemon, or any framework import.
- A second state store, registry, ranking engine, quota store or checkpoint store.
- Pushing, opening a Pull Request, merging, or any GitHub write.
- The Controller's candidate-selection policy itself (TASK-AI-58).

## Business rules

| Rule        | Behavior                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `AI-60-R01` | The planner never names a model, provider or account; it emits capability requirements only.                          |
| `AI-60-R02` | A dependency cycle is rejected; two Work Items owning one file is rejected.                                           |
| `AI-60-R03` | A worker never pushes, opens a Pull Request, or merges (publisher boundary).                                          |
| `AI-60-R04` | An empty SUCCESS is COMPLETED_EMPTY; a dead process with an empty log is FAILED.                                      |
| `AI-60-R05` | A review is bound to an exact SHA; PASS with findings is rejected; a repair budget that is exhausted returns BLOCKED. |
| `AI-60-R06` | The orchestration reuses `ranking.js` and `decisions.js`; no second store or ranking engine exists.                   |

## Acceptance matrix

| AC/Test ID    | Scenario                                                        | Command                                                        | Exit |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ---- |
| `AC-AI-60-15` | planner makes a valid DAG                                       | `node --test tools/ai-brain/test/task-ai-60.test.js` (test 15) | 0    |
| `AC-AI-60-16` | dependency cycle rejected                                       | test 16                                                        | 0    |
| `AC-AI-60-17` | two slices owning one file detected                             | test 17                                                        | 0    |
| `AC-AI-60-18` | prompt has full scope, tests and acceptance                     | test 18                                                        | 0    |
| `AC-AI-60-19` | prompt carries the pinned candidateKey                          | test 19                                                        | 0    |
| `AC-AI-60-20` | empty SUCCESS not counted completed                             | test 20                                                        | 0    |
| `AC-AI-60-21` | no-progress session stalled                                     | test 21                                                        | 0    |
| `AC-AI-60-22` | restart reads the checkpoint and does not redo completed steps  | test 22                                                        | 0    |
| `AC-AI-60-23` | old-SHA review not accepted for a new SHA                       | test 23                                                        | 0    |
| `AC-AI-60-24` | PASS with findings rejected                                     | test 24                                                        | 0    |
| `AC-AI-60-25` | CI failure creates a repair task with the right cause           | test 25                                                        | 0    |
| `AC-AI-60-26` | repair over budget -> BLOCKED                                   | test 26                                                        | 0    |
| `AC-AI-60-27` | a failing source does not stop a lane on another failure domain | test 27                                                        | 0    |
| `AC-AI-60-28` | a worker has no merge capability                                | test 28                                                        | 0    |
| `AC-AI-60-29` | plan input count = completed + blocked + deferred               | test 29                                                        | 0    |
| `AC-AI-60-30` | no second state store or ranking engine                         | test 30                                                        | 0    |

## Codex review record

| Review round | Commit    | Verdict        | Findings resolved                 |
| ------------ | --------- | -------------- | --------------------------------- |
| 1            | `Pending` | `NOT_REVIEWED` | Dry-run autonomous loop authored. |

## Residual limitations

- This is a dry-run loop; no live agent, daemon or external effect is executed.
- The simulated fallback uses two synthetic candidates; the real Controller fallback remains TASK-AI-58.
- The review loop consumes an injected review; the reviewer-differs-from-writer rule is enforced by the Controller, not re-implemented here.
