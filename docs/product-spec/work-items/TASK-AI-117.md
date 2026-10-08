# TASK-AI-117 — A run interrupted after the worker commit resumes into review, not a dead session

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-117` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `230` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-117.test.js`; `docs/product-spec/work-items/TASK-AI-117.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-117-resume-after-fail-before` |
| Pull Request | `Pending` |

## Business Outcome

The gate 5c live run (evidence: `tools/ai-brain/orchestrate.js` on main
`377d483`) lost a finished worker to a dead reattach. The checkpoint for
TASK-AI-111 stood at stage `fail_before_measured` with a completed launch —
`launch.workerSha` set, `launch.exitCode` 0, `failBefore` recorded — when the
orchestrate process was killed (controlled interrupt) and rerun with the same
`--checkpoint`. The resume reclaimed its writer claim (`resumed from
fail_before_measured and reclaimed its writer claim`) and then tried to
reattach to the writer session that had already exited 0. The synthesised
usage report for the reattach carried `session_id: null`, the reattach read
`HARNESS_NO_SESSION_ID`, and the item ended `blocked` with reasonCode
`NO_ALTERNATE_FAILURE_DOMAIN` and no review launched. There is nothing to
reattach to: the worker committed and finished.

Now a resume whose checkpoint holds a completed launch (workerSha present,
exitCode 0) at `fail_before_measured` or any later pre-review stage proceeds
directly to review of that exact workerSha with the recorded failBefore. The
writer session is neither relaunched nor reattached: no candidate is
re-selected, no launch or failure-domain attempt is recorded, and
`HARNESS_NO_SESSION_ID` is never raised for a completed launch. A resume whose
launch is genuinely incomplete (no workerSha) keeps the launch/reattach
behaviour it has today.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RS-R01 | Resume at `fail_before_measured` with `launch.workerSha` set, `launch.exitCode` 0, `failBefore` recorded | No relaunch and no reattach; review runs directly against that exact workerSha with the reused `failBefore`; the decision log records `resumed from fail_before_measured` and no second `launched` record | RS-R01 test in `tools/ai-brain/test/task-ai-117.test.js` |
| RS-R02 | Completed launch whose session handle cannot be reattached (usage reports gone) | `HARNESS_NO_SESSION_ID` is not raised; the item completes its review; no failure is recorded against the completed launch and the outcome carries no `NO_ALTERNATE_FAILURE_DOMAIN` reasonCode; no failure-domain attempt is counted (no `failed` decision, empty selection list) | RS-R02 test in `tools/ai-brain/test/task-ai-117.test.js` |
| RS-R03 | Resume whose launch record has no workerSha | Today's behaviour is kept: the resume goes through the launch/reattach machinery (one selection, one new `launched` record) and the reattached session is reviewed | RS-R03 test in `tools/ai-brain/test/task-ai-117.test.js` |
| RS-R04 | Test evidence | `node:test` with injected fake launcher/reviewer and a temp checkpoint, written before the fix and confirmed failing on unchanged code (RS-R01 and RS-R02 red, RS-R03 green) | Fail-before run in the Fail-Before / Pass-After section |
| RS-R05 | Register and work-item documentation | One register row `230` for `TASK-AI-117` (`READY_FOR_CODEX`, branch `fix/task-ai-117-resume-after-fail-before`); `git diff --numstat` shows `1 0` for the register | `git diff --numstat docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-117.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-60.test.js tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/task-ai-93.test.js tools/ai-brain/test/task-ai-91.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-117.test.js docs/product-spec/work-items/TASK-AI-117.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged `tools/ai-brain/orchestrate.js` + the new tests):
  RS-R01 and RS-R02 fail — the resume is blocked `HARNESS_NO_SESSION_ID` with
  reasonCode `NO_ALTERNATE_FAILURE_DOMAIN` and the reviewer is never called,
  matching the gate 5c decision log. RS-R03 passes (behaviour unchanged).
- Pass-after: all three tests pass, and the required regression list
  (task-ai-105, task-ai-114, task-ai-94, task-ai-113, task-ai-60, task-ai-102,
  task-ai-93, task-ai-91) stays green (67 tests).

## Residual Limitations

- A completed launch interrupted before its fail-before measurement (stage
  `worker_launch_finished` with no recorded `failBefore`) is measured on resume,
  from the recorded `baseSha` against the recorded workerSha, instead of being
  reused; only a recorded measurement is reused unchanged.
- The exact workerSha guarantee binds the review to the commit the launch
  recorded. A worktree that moved on while the run was interrupted is ignored
  by design: the review reads the recorded commit, never a newer head.
