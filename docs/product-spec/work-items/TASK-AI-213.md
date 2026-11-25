# TASK-AI-213 — Retire five zero-caller routing helpers and STALL constants (Lát C-3e-1)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-213`                                                                                                                                                                                                                                                                                                                      |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                              |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                  |
| Dependencies    | `TASK-AI-212`                                                                                                                                                                                                                                                                                                                      |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup                                                                                                                                                                                                                                                                                      |
| Risk            | `LOW`: removes five zero-caller helpers, two `STALL_*` constants, and four newly unused imports from `tools/ai-brain/routing.js` (−317 lines), guarded by `lat-c3e1-retire-dead-routing-helpers.test.js`                                                                                                                           |
| Allowed paths   | `tools/ai-brain/routing.js`; `tools/ai-brain/test/lat-c3e1-retire-dead-routing-helpers.test.js`; `tools/ai-brain/test/task-ai-171-route-pr09-history.test.js`; `tools/ai-brain/test/task-ai-67.test.js`; `docs/product-spec/work-items/TASK-AI-213.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                                                          |
| Branch          | `feat/task-ai-213-retire-dead-routing-helpers`                                                                                                                                                                                                                                                                                     |

## Business outcome

Five routing helpers (`applyFailureScope` / dead stall/history helpers), two `STALL_*` constants, and four newly unused imports in `tools/ai-brain/routing.js` had zero production callers (−317 lines). Removing them with a 0-caller guard keeps `routing.js` lean and prevents dead helpers from being called by mistake.

## Scope and acceptance

| ID  | Criterion                                                                                                                       | Evidence                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | The retired routing helpers and `STALL_*` constants are undefined on `routing.js` exports                                       | `tools/ai-brain/test/lat-c3e1-retire-dead-routing-helpers.test.js`                                                                                                         |
| AC2 | Zero production source files reference the retired helpers while `task-ai-67` and `task-ai-171-route-pr09-history` remain green | `tools/ai-brain/test/lat-c3e1-retire-dead-routing-helpers.test.js`; `tools/ai-brain/test/task-ai-67.test.js`; `tools/ai-brain/test/task-ai-171-route-pr09-history.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3e1-retire-dead-routing-helpers.test.js tools/ai-brain/test/task-ai-67.test.js tools/ai-brain/test/task-ai-171-route-pr09-history.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
