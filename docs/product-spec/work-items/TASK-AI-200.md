# TASK-AI-200 — Forward model contextWindow and maxOutputTokens into worker opencode.json limits

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-200`                                                                                                                                                                                                                                                                                                                                      |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                              |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                                  |
| Dependencies    | `TASK-AI-187`                                                                                                                                                                                                                                                                                                                                      |
| Assigned author | Antigravity (`agy08`, Gemini) — Wave 2 standalone fix                                                                                                                                                                                                                                                                                              |
| Risk            | `LOW`: resolves worker `opencode.json` model `limit.context` and `limit.output` from candidate/combo metadata and router limits instead of hardcoding `32000/4096`, preserving historical `32000/4096` fallback only when router limit fields are absent                                                                                           |
| Allowed paths   | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/orchestrate/repair-round.js`; `tools/ai-brain/orchestrate/writer-loop.js`; `tools/ai-brain/test/opencode-model-limits.test.js`; `docs/product-spec/work-items/TASK-AI-200.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                                                                          |
| Branch          | `feat/task-ai-200-opencode-model-limits`                                                                                                                                                                                                                                                                                                           |

## Business outcome

Isolated OpenCode workers previously wrote hardcoded `32000/4096` token limits into `opencode.json` even when the selected candidate or 9router writer combo declared higher context and output limits (`128000/8192`). This Work Item forwards `contextWindow` and `maxOutputTokens` through `writer-loop.js`, `orchestrate.js`, and `repair-round.js` into `isolation-launcher.js`, reads router limits from the active registry without duplicate `loadSources()` calls, and preserves the historical `32000/4096` fallback only when limit fields are missing.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                                                                   | Evidence                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| AC1 | `isolation-launcher.js` resolves `opencode.json` `limit.context` and `limit.output` from `modelMeta` -> candidate options -> 9router writer combo limits, preserving `32000/4096` only when router limit fields are missing | `tools/ai-brain/test/opencode-model-limits.test.js` |
| AC2 | `writer-loop.js`, `orchestrate.js`, and `repair-round.js` forward candidate `contextWindow` and `maxOutputTokens` into isolated worker launch jobs                                                                          | `tools/ai-brain/test/opencode-model-limits.test.js` |

## Verification

- `node --test tools/ai-brain/test/opencode-model-limits.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
