# TASK-AI-192 — Extract `combo-reader.js` and migrate live `readComboConfig` callers off `writer-combo.js` (Lát B1-2)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-192` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-189` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator instruction 2026-11-21 |
| Risk | `LOW`: pure extraction and import migration with re-export parity in `writer-combo.js` |
| Allowed paths | `tools/ai-brain/combo-reader.js`; `tools/ai-brain/writer-combo.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/cli/dispatch.js`; `tools/ai-brain/test/task-ai-192-combo-reader.test.js`; `docs/product-spec/work-items/TASK-AI-192.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-192-combo-reader` |

## Business outcome

Second small slice of Lát B1: extracts the read-only 9router `/api/combos` reader (`readComboConfig`, `resolveComboConfig`, `resolveComboMembers`, `resolveEndpoint`, `assertLoopbackHost`, `loadCliToken`, `httpRequest`) out of `writer-combo.js` into `tools/ai-brain/combo-reader.js` with zero dependency on `priors.js` or `evidence.js`, and migrates all three live callers (`intake.js`, `cli.js`, `cli/dispatch.js`). `writer-combo.js` re-exports the extracted functions until legacy sync/candidate callers are retired in a later slice.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | `tools/ai-brain/combo-reader.js` exports `readComboConfig`, `resolveComboConfig`, `resolveComboMembers`, `resolveEndpoint`, `assertLoopbackHost`, `loadCliToken`, and `httpRequest` with exact parity to `writer-combo.js` | `tools/ai-brain/test/task-ai-192-combo-reader.test.js` |
| AC2 | `intake.js`, `cli.js`, and `cli/dispatch.js` require `combo-reader.js` instead of `writer-combo.js` | `tools/ai-brain/test/task-ai-192-combo-reader.test.js` |
| AC3 | Existing combo-config and intake tests pass unchanged | `node --test` verification suite |

## Verification

- `node --test tools/ai-brain/test/task-ai-192-combo-reader.test.js`
- `node --test tools/ai-brain/test/task-ai-186-combo-followups.test.js tools/ai-brain/test/task-ai-182-split-paths.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
