# TASK-AI-196 — Place trusted RTK shim outside workerRoot and activate comboJevSelect in orchestrateCommand

## Control

| Field           | Value                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-196`                                                                                                                                                                                                                                                        |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                    |
| Dependencies    | `TASK-AI-195`                                                                                                                                                                                                                                                        |
| Assigned author | Antigravity (`agy08`, Gemini) — live E2E `TASK-AI-187` finding fix                                                                                                                                                                                                   |
| Risk            | `LOW`: 2 surgical live-loop fixes discovered directly from live `TASK-AI-187` decision log (`d04798d7`)                                                                                                                                                              |
| Allowed paths   | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js`; `docs/product-spec/work-items/TASK-AI-196.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                            |
| Branch          | `feat/task-ai-196-live-rtk-jev-wire`                                                                                                                                                                                                                                 |

## Business outcome

Fixes the two live-loop defects exposed by the live `TASK-AI-187` run on `d04798d7` without weakening dirty-tree enforcement:

1. `isolation-launcher.js` previously copied `.shipde-bin/rtk.exe` inside `workerRoot`, causing repair retention (`isolation-launcher.js:324`) to refuse with `WORKER_COMMIT_REFUSED: dirty file .shipde-bin/rtk.exe outside allowed paths`. Fixing at the producer (`resolveIsolatedRtkDecision`) omits optional RTK for isolated execution unless a pre-provisioned trusted directory outside `workerRoot` and its worker-writable parent is supplied (`trustedBinDir` / `SHIPDE_RTK_TRUSTED_BIN_DIR`, non-symlink with real `rtk.exe`), never writing into `workerRoot` or prepending an untrusted directory, and keeping `getTreeStatus`/`isTreeDirty` strictly fail-closed.
2. `cli/commands.js:orchestrateCommand` always passed `candidates: [comboResult.candidate]` into `runOrchestration`, which tripped `!Array.isArray(o.candidates)` in `shouldUseComboJevSelect` and kept live runs on `"combo-only routing"` instead of invoking `combo-jev-select.js`.

## Writer & repair caller checks

- **Writer launch (`isolation-launcher.js:1290-1310`)**: stages `rtk.exe` in `resolveRtkBinDir(workerRoot)` (`<parent>/.shipde-bin/<basename>`) and prepends that external directory to `PATH`; `workerRoot` stays clean.
- **Repair launch (`isolation-launcher.js:250-338`, `1283-1284`)**: `isRepairRound` blocks RTK (`repair_round_blocks_rtk`), and dirty-work adoption runs `getTreeStatus(workerRoot, { untracked: 'all' })` unchanged so any arbitrary `.shipde-bin/*` created inside `workerRoot` is still refused with `WORKER_COMMIT_REFUSED`.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                                                                | Evidence                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| AC1 | `resolveRtkBinDir(workerRoot)` places the trusted RTK shim outside `workerRoot` (isolated per worker basename), leaving `workerRoot` clean while arbitrary `.shipde-bin/*` inside `workerRoot` remains fail-closed dirty | `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js` |
| AC2 | `orchestrateCommand` passes `comboJevSelect: true` on live `--isolated-worker` runs (without injected `candidates` or `run`) and `false` when `candidates` or `run` are injected                                         | `tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js tools/ai-brain/test/task-ai-109-rtk.test.js tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js tools/ai-brain/test/task-ai-194-jev-combo-select.test.js`
