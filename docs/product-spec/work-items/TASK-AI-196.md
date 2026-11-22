# TASK-AI-196 — Fix live RTK .shipde-bin dirty refusal and activate comboJevSelect in orchestrateCommand

## Control

| Field           | Value                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-196`                                                                                                                                                                                                                                                             |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                     |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                         |
| Dependencies    | `TASK-AI-195`                                                                                                                                                                                                                                                             |
| Assigned author | Antigravity (`agy08`, Gemini) — live E2E `TASK-AI-187` finding fix                                                                                                                                                                                                        |
| Risk            | `LOW`: 2 surgical live-loop fixes discovered directly from live `TASK-AI-187` decision log (`d04798d7`)                                                                                                                                                                   |
| Allowed paths   | `tools/ai-brain/orchestrate/writer-loop.js`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js`; `docs/product-spec/work-items/TASK-AI-196.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                 |
| Branch          | `feat/task-ai-196-live-rtk-jev-wire`                                                                                                                                                                                                                                      |

## Business outcome

Fixes the two live-loop defects exposed by the live `TASK-AI-187` run on `d04798d7`:

1. `isolation-launcher.js:1303` copies `.shipde-bin/rtk.exe` into the isolated worker root, but `orchestrate/writer-loop.js:getTreeStatus` reported untracked `.shipde-bin/rtk.exe` as a dirty file, causing repair retention (`isolation-launcher.js:324`) to refuse with `WORKER_COMMIT_REFUSED: dirty file .shipde-bin/rtk.exe outside allowed paths`.
2. `cli/commands.js:orchestrateCommand` always passed `candidates: [comboResult.candidate]` into `runOrchestration`, which tripped `!Array.isArray(o.candidates)` in `shouldUseComboJevSelect` and kept live runs on `"combo-only routing"` instead of invoking `combo-jev-select.js`.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                        | Evidence                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| AC1 | `getTreeStatus` and `isTreeDirty` ignore untracked `.shipde-bin/` shim artifacts while continuing to report all other untracked/modified files                                   | `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js` |
| AC2 | `orchestrateCommand` passes `comboJevSelect: true` on live `--isolated-worker` runs (without injected `candidates` or `run`) and `false` when `candidates` or `run` are injected | `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js tools/ai-brain/test/task-ai-194-jev-combo-select.test.js`
