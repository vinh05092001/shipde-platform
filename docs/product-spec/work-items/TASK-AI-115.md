# TASK-AI-115 — distil retry/failure patterns from audited repos into the existing classifier

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-115` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `228` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/test/task-ai-115.test.js`; `docs/product-spec/work-items/TASK-AI-115.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-115-retry-patterns` |
| Pull Request | `Pending` |

## Business Outcome

Previous workers already wrote `tools/ai-brain/test/task-ai-115.test.js` and partly changed `tools/ai-brain/failure-classifier.js`. This work item completes the implementation so that classification results carry retryability information and replayability rules distilled from Temporal, LangGraph, and E2B.

The classifier now:
- Adds `retryable` boolean and `retryAfterMs` fields to all classifyFailure results
- Exports `isReplayable(operation)` helper: only read-only/idempotent operations (probe, list, reviewRead, testRun) are replayable; mutating external effects (publish, push, createPR, comment, merge) are NEVER replayable

This mirrors the AGENTS.md rule against blind retries of external effects.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RP-R01 | classifyFailure results for each class | retryable (boolean) and retryAfterMs (from reset text when known) fields present; non-retryable classes: auth, model_not_supported, retired, call_contract, policy/permission, invalid request; retryable classes: quota/rate-limit, transient upstream 5xx, timeout; unknown → retryable false | RP-R01 tests in `tools/ai-brain/test/task-ai-115.test.js` |
| RP-R02 | isReplayable helper | Only probe/list/reviewRead/testRun return true; publish/push/createPR/comment/merge and unknown return false | RP-R02 tests in `tools/ai-brain/test/task-ai-115.test.js` |
| RP-R03 | Existing classification outputs unchanged | cause, scope, cooldownMs fields unchanged for every existing test | Regression tests in `tools/ai-brain/test/task-ai-115.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-115.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/failure-classifier.js tools/ai-brain/test/task-ai-115.test.js docs/product-spec/work-items/TASK-AI-115.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: 20 tests fail (isReplayable not exported, retryable fields not added to all classification paths)
- Pass-after: all 25 tests pass

## Residual Limitations

- None
