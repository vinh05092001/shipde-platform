# TASK-AI-198 — Remove the unused writer-combo module (Lát C-2a)

## Control

| Field           | Value                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-198`                                                                                                                                                                                                                                                 |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                         |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                             |
| Dependencies    | `TASK-AI-197`                                                                                                                                                                                                                                                 |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup; prepared for release by Claude                                                                                                                                                                                 |
| Risk            | `LOW`: deletes a module with no runtime caller; the two predicates `candidates.js` still uses move into it unchanged                                                                                                                                          |
| Allowed paths   | `tools/ai-brain/writer-combo.js`; `tools/ai-brain/candidates.js`; `tools/ai-brain/test/task-ai-192-combo-reader.test.js`; `docs/product-spec/work-items/TASK-AI-198.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                     |
| Branch          | `feat/task-ai-198-retire-writer-combo`                                                                                                                                                                                                                        |

## Business outcome

`writer-combo.js` (278 lines) is no longer reached at runtime: the combo reader moved to `combo-reader.js` (TASK-AI-192) and the live selection reads combos through it. The only remaining runtime link was `candidates.js`, which imported two 9router predicates from it. This Work Item deletes the module and moves those two predicates, unchanged, into `candidates.js`, so the old path cannot be called by mistake.

## Scope and acceptance

| ID  | Criterion                                                                                                                              | Evidence                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| AC1 | `tools/ai-brain/writer-combo.js` is deleted and no runtime module requires it                                                          | `tools/ai-brain/test/task-ai-192-combo-reader.test.js` AC2 |
| AC2 | `candidates.isNineRouterCandidate` and `candidates.isIndividualNineRouterCandidate` keep their classification of router and combo rows | `tools/ai-brain/test/task-ai-192-combo-reader.test.js` AC2 |
| AC3 | `combo-reader.js` still exports the read-only combo API and reads the fixture                                                          | `tools/ai-brain/test/task-ai-192-combo-reader.test.js` AC1 |

## Verification

- `node --test tools/ai-brain/test/task-ai-192-combo-reader.test.js tools/ai-brain/test/task-ai-197-sever-legacy-hooks.test.js tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
