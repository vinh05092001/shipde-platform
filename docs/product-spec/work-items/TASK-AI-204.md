# TASK-AI-204 — Remove zero-caller rolling-onboard module and unused dispatch-helpers (Lát C-3a)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-204`                                                                                                                                                                                                                                                                                   |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                           |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                               |
| Dependencies    | `TASK-AI-203`                                                                                                                                                                                                                                                                                   |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup                                                                                                                                                                                                                                                   |
| Risk            | `LOW`: deletes `tools/ai-brain/rolling-onboard.js` and unused helpers in `cli.js` / `cli/dispatch-helpers.js` that lost their last callers when `cli/dispatch.js` was retired in `TASK-AI-203`                                                                                                  |
| Allowed paths   | `tools/ai-brain/cli.js`; `tools/ai-brain/cli/dispatch-helpers.js`; `tools/ai-brain/rolling-onboard.js`; `tools/ai-brain/test/lat-c3a-retire-rolling-onboard.test.js`; `docs/product-spec/work-items/TASK-AI-204.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-204-retire-rolling-onboard`                                                                                                                                                                                                                                                       |

## Business outcome

After `cli/dispatch.js` was retired in `TASK-AI-203`, `tools/ai-brain/rolling-onboard.js` and the remaining dispatch-only helpers in `cli/dispatch-helpers.js` and `cli.js` had zero runtime callers (584 dead lines). Removing them eliminates unreachable legacy onboarding and dispatch glue while keeping all live `orchestrate/runtime-helpers.js` exports intact.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                       | Evidence                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AC1 | `tools/ai-brain/rolling-onboard.js` is deleted and no runtime caller requires it                                                                                                | `lat-c3a-retire-rolling-onboard.test.js`                                                                                |
| AC2 | Unused dispatch-only helpers in `cli.js` and `cli/dispatch-helpers.js` are removed while live `runtime-helpers` re-exports and `cli.js dispatch` fail-closed guard remain green | `lat-c3a-retire-rolling-onboard.test.js`; `lat-c2b1-runtime-helpers-parity.test.js`; `lat-c2b2-retire-dispatch.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3a-retire-rolling-onboard.test.js tools/ai-brain/test/lat-c2b1-runtime-helpers-parity.test.js tools/ai-brain/test/lat-c2b2-retire-dispatch.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
