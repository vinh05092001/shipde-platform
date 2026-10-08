# TASK-AI-105 — Interrupted runs resume from a step checkpoint

## Control

- Work Item ID: TASK-AI-105
- Status: READY_FOR_CODEX
- Assigned author: tokenharbor/gpt-6-luna via opencode
- Dependencies: TASK-AI-64
- Branch: feat/task-ai-105-incremental-checkpoint
- Delivery order: 219

## Business Outcome

Live orchestration persists each completed stage to its existing atomic checkpoint. An interrupted run can resume selection, worker execution, fail-before measurement, review, repair, and publication without repeating completed external side effects. Failed candidate keys and failure scopes are retained for routing.

## Acceptance Matrix

| Requirement | Result | Evidence |
|---|---|---|
| CK-R01 incremental atomic checkpoint writes | PASS | `tools/ai-brain/test/task-ai-105.test.js` interruption after worker launch verifies selection and launch records are already durable |
| CK-R02 resume skips completed worker/review stages and records resumed step | PASS | Resume scenario checks launch/reviewer counts and `resumed.from` |
| CK-R03 no duplicate publication | PASS | Resume scenario confirms saved publication is returned without invoking publisher again |
| CK-R04 failure scope and failed candidate persist for fallback routing | PASS | Failure fallback scenario inspects persisted failure entry and alternate launch |
| CK-R05 deterministic interruption coverage | PASS | Node tests use a temporary git repository and injected launcher/reviewer/publisher functions |
| CK-R06 handoff documentation and register row | PASS | This Work Item and delivery-register row 219 |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-105.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/cli.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-105.test.js docs/product-spec/work-items/TASK-AI-105.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- A worker process interrupted before returning a result is recorded as unfinished; operator recovery must reconcile the worker state before retrying, because the launcher callback itself does not expose an external reconciliation API.
