# TASK-AI-167 — Stop no-progress writer/review loops per Work Item

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-167` |
| Feature ID | `N/A — AI delivery loop control` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `293` |
| Dependencies | `None` |
| Assigned author | `CLAUDE` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/work-guard.js`; `tools/ai-brain/review-loop.js`; `tools/ai-brain/test/work-guard.test.js`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-167.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-167-progress-guard` |
| Pull Request | `Set when opened` |

## Business outcome

Stop the delivery loop from spending tokens and wall time on work that cannot progress. The audit of 2026-11-03 observed a clone left on another item's branch being re-dispatched every round (TASK-AI-165, 160 and 164 on the TASK-AI-155 branch), repeated conflict dispatches (TASK-AI-163), and the same commit reviewed again. After this item, a wrong branch, a conflict or an unchanged review input blocks that item alone, with a reason, while independent items keep running.

## Source references

- `AGENTS.md` (Unit of delivery, Code review rules — hardcode)
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `tools/ai-brain/review-loop.js` (TASK-AI-60/64 bounded repair loop)
- Operator routing/orchestration handoff of 2026-11-03, priority 1 (no-progress loops)

## Preconditions and dependencies

None. The module is new and repository-agnostic; the review-loop change keeps its existing contract.

## Ambiguity and clarification markers

None.

## Author boundary

Loop control only. Route selection, health/quota classification, JEV and context/budget interfaces are owned by the separate routing work (`feat/routing-core-selection`) and are not touched here.

## In scope

- `work-guard.js`:
  - `checkWorkspace`: the checkout is the expected root, has no unmerged files, is on a branch and the branch carries the whole Work Item ID (bounded match).
  - `ProgressLedger`: per item and stage, each fingerprint of (head SHA, base SHA, review input) keeps its outcome; the same fingerprint is refused unless its last outcome was transient. Item and goal caps on attempts, elapsed time and tokens. Admission can reserve the attempt (`IN_FLIGHT`, owner pid). Mutations are serialised; a damaged ledger fails closed. Unknown token usage is counted as unknown, never zero.
  - `acquireLock`/`releaseLock`: generation locks; a dead owner is superseded by an exclusive create of the next generation, never deleted; only the owner releases.
  - `acceptResult`: a lane result counts only when its `jobId` matches the job.
  - `runWithCleanup`: cleanup never replaces the worker's result or exception.
  - CLI (`check-workspace`, `admit`, `record`, `block`) for shell runtimes.
- `review-loop.js`: tests and reviews are cached per SHA, so a repair that never ran, or one that returns to an earlier SHA, does not buy another test run or review.

## Out of scope

- Wiring the guard into a production Controller caller and the lane launcher (`route.js` launch, agy `job.json`): follow-up items.
- Route selection, health, quota, JEV and budget interfaces.

## Business rules and edge cases

- `BR-LOOP-01`: a refused workspace blocks only that item.
- `BR-LOOP-02`: the same (head, base, input) is never reviewed twice unless the earlier attempt failed transiently (timeout, rate limit, network, launch failure, not attempted).
- `BR-LOOP-03`: alternating inputs cannot reopen an earlier fingerprint.
- `BR-LOOP-04`: a lock is never taken from a live owner and never deleted by a contender; liveness needs a positive pid.
- `BR-LOOP-05`: budgets only grow; negative or non-finite usage is refused.

## UI states

N/A — no user interface.

## API, event and data impact

No API, schema or database change. The ledger and lock files live where the caller points them.

## Acceptance matrix

| ID | Criterion | Evidence |
|---|---|---|
| AC-AI-167-01 | Wrong branch, other checkout, conflict and detached head are refused with a cause | `work-guard.test.js` workspace tests |
| AC-AI-167-02 | Same fingerprint refused; new head, base or input reopens; transient outcome retries | `work-guard.test.js` ledger tests |
| AC-AI-167-03 | Blocking one item leaves others admitted | `work-guard.test.js` |
| AC-AI-167-04 | Item and goal caps for attempts, time and tokens; reserved admission | `work-guard.test.js` |
| AC-AI-167-05 | Second owner refused, only owner releases, dead owner superseded, races cannot yield two owners | `work-guard.test.js` lock tests |
| AC-AI-167-06 | Result from a previous job rejected | `work-guard.test.js` |
| AC-AI-167-07 | Cleanup cannot mask the exit code or exception | `work-guard.test.js` |
| AC-AI-167-08 | Review loop does not re-test or re-review an unchanged or revisited SHA | `work-guard.test.js` review-loop tests |
| AC-AI-167-09 | No production hardcode | `node scripts/ai/check-no-hardcode.mjs` |

## Verification commands

- `node --test tools/ai-brain/test/work-guard.test.js`
- `node --test tools/ai-brain/test/task-ai-60.test.js tools/ai-brain/test/task-ai-64.test.js`
- `node scripts/ai/check-no-hardcode.mjs`

## Codex review record

Pre-PR review rounds on the diff (gpt-6.1-sol, read-only): `8fa765f`, `a820c19`, `4625b50`, `e4a6705`, `b4a4064` and `ee9ce83` returned CHANGES_REQUIRED and were addressed; `34eba89` returned PASS with no P0/P1/P2 findings. The PR review follows the normal gate.

## Residual limitations

- No production Controller caller yet; the scratch delivery pipeline uses the CLI.
- `acceptResult` is not yet wired into the lane launcher.
