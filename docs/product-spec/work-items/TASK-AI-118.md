# TASK-AI-118 — The Controller acts on retryable and replay rules

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-118` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `231` |
| Dependencies | `TASK-AI-115` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-118.test.js`; `docs/product-spec/work-items/TASK-AI-118.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-118-route-on-retryable` |
| Pull Request | `Pending` |

## Business Outcome

TASK-AI-115 added `retryable` and `retryAfterMs` fields to classifyFailure results and `isReplayable(operation)` helper. The Controller now uses them to make safe routing decisions:

- **RT-R01**: every decision-log entry with stage "failed" records `retryable` and `retryAfterMs` from the classification.
- **RT-R02**: when a failure is non-retryable (retryable === false), that exact candidate key is not selected again for the same Work Item in the same run.
- **RT-R03**: when a failure is retryable and retryAfterMs is greater than the default cooldown, the Controller uses retryAfterMs. It is never shortened.
- **RT-R04**: the publish step never automatically re-runs after a failed or timed-out publish attempt within one run. It is guarded by `isReplayable('publish')` and records the refusal as `PUBLISH_NOT_REPLAYABLE`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RT-R01 | failed decision-log entry | Contains `retryable` (boolean) and `retryAfterMs` (number or null) fields matching the classification | RT-R01 test in `tools/ai-brain/test/task-ai-118.test.js` |
| RT-R02 | non-retryable candidate | Candidate key is excluded from re-selection; decision log shows it in excluded set | RT-R02 test in `tools/ai-brain/test/task-ai-118.test.js` |
| RT-R03 | retryable with longer cooldown | retryAfterMs from classification is recorded and used when greater than default | RT-R03 test in `tools/ai-brain/test/task-ai-118.test.js` |
| RT-R04 | publish failure | isReplayable('publish') returns false; publisher called once; no retry attempt | RT-R04 test in `tools/ai-brain/test/task-ai-118.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-118.test.js tools/ai-brain/test/task-ai-115.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/task-ai-60.test.js tools/ai-brain/test/task-ai-93.test.js tools/ai-brain/test/task-ai-91.test.js tools/ai-brain/test/failure-classifier.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-118.test.js docs/product-spec/work-items/TASK-AI-118.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: RT-R03 test fails (retryAfterMs recorded as null when no reset time pattern); RT-R04 test fails (publish is retried)
- Pass-after: all 5 tests pass

## Residual Limitations

- None. The retryable/retryAfterMs routing is now consistent across all lanes.
