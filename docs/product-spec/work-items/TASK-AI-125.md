# TASK-AI-125 — close the two P2 follow-ups from the TASK-AI-124 review

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-125` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `238` |
| Dependencies | `TASK-AI-124` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/publisher.js`; `tools/ai-brain/test/task-ai-125.test.js`; `docs/product-spec/work-items/TASK-AI-125.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-125-draft-p2-followups` |
| Pull Request | `Pending` |

## Business Outcome

Follow-ups from the TASK-AI-124 review:
1. `tools/ai-brain/publisher.js` line 164: `finding.id` was going into the PR body raw. It needs to be wrapped with the existing `neutralise()` helper, like `finding.summary`.
2. `tools/ai-brain/orchestrate.js` line 2193: inside `normalizeReviewForCheckpoint(entry, workItemId, logOpts)`, the code was using `o.goal`, but `o` is not in scope there. The code should read the goal from `logOpts.goal` instead, and pass the goal in `logOpts` at the caller (line ~2224; the caller's scope has `o.goal`).

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| TASK-AI-125-1 | Neutralise finding ids in PR bodies | A finding whose id contains `<x>` produces a body that does not match `/<[^>\n]+>/` | `task-ai-125.test.js` |
| TASK-AI-125-2 | `normalizeReviewForCheckpoint` goal scope | Uses goal from `logOpts` and gives the goal-based draftTitle, not a ReferenceError and not "work item" | `task-ai-125.test.js` |
| TASK-AI-125-3 | Work Item and register | `TASK-AI-125.md` added; row 238 appended to `FEATURE-DELIVERY-REGISTER.csv` | `git diff HEAD~1 --numstat` is `1 0` for register |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-125.test.js tools/ai-brain/test/task-ai-124.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/publisher.js tools/ai-brain/test/task-ai-125.test.js docs/product-spec/work-items/TASK-AI-125.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: Tests in `task-ai-125.test.js` fail.
- Pass-after: All tests pass.

## Residual Limitations

- None
