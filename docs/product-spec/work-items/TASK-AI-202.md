# TASK-AI-202 — Move the live runtime helpers out of the legacy dispatch modules (Lát C-2b-1)

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `TASK-AI-202` |
| Feature ID      | `N/A` |
| Status          | `READY_FOR_CODEX` |
| Dependencies    | `TASK-AI-198` |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup; prepared for release by Claude |
| Risk            | `LOW`: moves seven helpers unchanged into a new module and repoints their live callers; the legacy modules keep re-exporting them, so behaviour is unchanged |
| Allowed paths   | `tools/ai-brain/orchestrate/runtime-helpers.js`; `tools/ai-brain/cli/dispatch-helpers.js`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/planning-services.js`; `tools/ai-brain/test/lat-c2b1-runtime-helpers-parity.test.js`; `tools/ai-brain/test/task-ai-105.test.js`; `docs/product-spec/work-items/TASK-AI-202.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model |
| Branch          | `feat/task-ai-202-extract-runtime-helpers` |

## Business outcome

The live orchestration path (checkpoint persistence, failure blocks, evidence accounts and candidate assembly) still reached these helpers through `cli.js` and `cli/dispatch-helpers.js`, the legacy dispatch modules. This Work Item moves `mergeEvidenceAccounts`, `assembleForDispatch`, `readCheckpoint`, `writeJsonFile`, `applyFailureBlocks`, `DRY_RUN_BLOCK_CODES` and `LIVE_BLOCK_CODES` unchanged into `tools/ai-brain/orchestrate/runtime-helpers.js` and repoints the live callers to it. `dispatch-helpers.js` re-exports the same functions, so the legacy dispatch keeps working until it is retired in the next Work Item.

## Scope and acceptance

| ID  | Criterion | Evidence |
| --- | --------- | -------- |
| AC1 | `orchestrate/runtime-helpers.js` exports the seven live helpers, and `cli/dispatch-helpers.js` and `cli.js` re-export the same function objects | `lat-c2b1-runtime-helpers-parity.test.js` |
| AC2 | `cli/commands.js`, `isolation-launcher.js`, `orchestrate.js` and `planning-services.js` require `orchestrate/runtime-helpers` instead of `cli` or `cli/dispatch-helpers` | `lat-c2b1-runtime-helpers-parity.test.js` |
| AC3 | Offline behaviour is unchanged: evidence accounts, candidate assembly, atomic checkpoint write with `.tmp` adoption, and failure blocks with fixed golden `sameFailureDomain` outputs | `lat-c2b1-runtime-helpers-parity.test.js`; `task-ai-105.test.js` CK-R03 |

## Verification

- `node --test tools/ai-brain/test/lat-c2b1-runtime-helpers-parity.test.js tools/ai-brain/test/task-ai-105.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
