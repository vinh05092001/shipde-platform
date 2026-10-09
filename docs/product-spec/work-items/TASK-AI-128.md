# TASK-AI-128 — a resumed run adopts its own repair commit instead of refusing it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-128` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `241` |
| Dependencies | `TASK-AI-127` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/test/task-ai-128.test.js`; `docs/product-spec/work-items/TASK-AI-128.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-128-resume-repair-head` |
| Pull Request | `Pending` |

## Business Outcome

Root cause: If a repair round commits successfully but the controller crashes before finishing, the next resume will attempt to restart the repair with `--retain-worker-head` pinned to the original SHA before the repair. Since the isolated worker root already contains the repair commit, `isolation-launcher.js` throws a `WORKER_HEAD_MISMATCH` because `HEAD` does not match the requested SHA, halting the run and requiring manual intervention.

RH-R01: when the retained worker root HEAD is a strict descendant of the requested SHA, and every extra commit was made in that root by this work item's own repair rounds (recorded in the checkpoint/decision log for this workItemId), the launcher adopts that HEAD instead of refusing. The checkpoint step's sha is updated, a decision entry "adopted_repair_head" is recorded, and the run continues.

RH-R02: any other mismatch is still refused: a non-descendant HEAD, a dirty tree, or extra commits that cannot be attributed to this item's repair. The refusal must be classified as a LOCAL infra failure with no cooldown.

RH-R03: the repair round itself records its resulting commit SHA in the checkpoint as soon as it commits. This applies even when the format gate later still fails.

RH-R04: a missing retained root is reported as WORKER_ROOT_MISSING (local, no cooldown).

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RH-R01 | Adopt descendant repair HEAD | Launcher bypasses WORKER_HEAD_MISMATCH, adopts new SHA in checkpoint | Test |
| RH-R02 | Refuse dirty or unknown HEAD | Launcher still throws WORKER_HEAD_MISMATCH, classified as local | Test |
| RH-R03 | Checkpoint saves repair SHA | Checkpoint's `repair.sha` is updated early after repair round completes | Test |
| RH-R04 | Missing worker root | Launcher throws WORKER_ROOT_MISSING, classified as local | Test |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-128.test.js`

## Fail-Before / Pass-After

- Fail-before: the launcher strictly checked `retainedHeadSha === retainWorkerHead` and threw `WORKER_HEAD_MISMATCH` with no path for adoption. `WORKER_ROOT_MISSING` and `WORKER_HEAD_MISMATCH` were not classified as local infrastructure failures. `repairRound` did not log `sha` to the `LAUNCHED` decision.
- Pass-after: tests pass.
