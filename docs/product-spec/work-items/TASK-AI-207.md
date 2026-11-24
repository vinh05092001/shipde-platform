# TASK-AI-207 — Remove helpers left dead by the retired profile dispatch (Lát C-3c-2a)

## Control

| Field           | Value                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-207`                                                                                                                                                                                                                                                          |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                  |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                      |
| Dependencies    | `TASK-AI-206`                                                                                                                                                                                                                                                          |
| Assigned author | Claude (Opus) — Lát C cleanup; packaged on `TASK-AI-206` by Antigravity (`agy08`, Gemini)                                                                                                                                                                              |
| Risk            | `LOW`: deletes 6 zero-caller helpers (`formatTopEntry`, `rankProofOf`, `jsonRejectedSlice`, `defaultLauncher`, `routeScopeOf`, `resolveFixturePaths`) and their unused imports/constants left dead by `TASK-AI-206`, with a 0-caller guard test                        |
| Allowed paths   | `tools/ai-brain/cli/dispatch-helpers.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/test/lat-c3c2a-retire-dead-dispatch-helpers.test.js`; `docs/product-spec/work-items/TASK-AI-207.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                              |
| Branch          | `feat/task-ai-207-retire-dead-dispatch-helpers`                                                                                                                                                                                                                        |

## Business outcome

After `TASK-AI-206` retired the profile and coordinator dispatch paths, six helper functions (`formatTopEntry`, `rankProofOf`, `jsonRejectedSlice`, `defaultLauncher` in `routing.js`; `routeScopeOf`, `resolveFixturePaths` in `cli/dispatch-helpers.js`) and their exclusive imports/constants (`REJECTED_RECORDED_LIMIT`) had zero production callers (−171 lines). Removing them with a 0-caller guard keeps `routing.js` and `cli/dispatch-helpers.js` free of dead code while leaving `adviseModelChoice`, `jevModelChoiceQuestion`, and `validateTaskProfile` untouched for their existing live/policy tests.

## Scope and acceptance

| ID  | Criterion                                                                             | Evidence                                                             |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| AC1 | The six retired helpers are undefined on `routing` and `cli/dispatch-helpers` exports | `tools/ai-brain/test/lat-c3c2a-retire-dead-dispatch-helpers.test.js` |
| AC2 | Zero production source files define or reference the retired helpers                  | `tools/ai-brain/test/lat-c3c2a-retire-dead-dispatch-helpers.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3c2a-retire-dead-dispatch-helpers.test.js tools/ai-brain/test/lat-c3c1-retire-dispatch-profile.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
