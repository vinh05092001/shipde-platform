# TASK-AI-214 — Retire zero-caller writer-selection.js module (Lát C-3e-2a)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-214`                                                                                                                                                                                                                                                                                                                                   |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                           |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                               |
| Dependencies    | `TASK-AI-213`                                                                                                                                                                                                                                                                                                                                   |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup                                                                                                                                                                                                                                                                                                   |
| Risk            | `LOW`: deletes `tools/ai-brain/writer-selection.js` (−139 lines), which has zero runtime callers, with a 0-caller guard test                                                                                                                                                                                                                    |
| Allowed paths   | `tools/ai-brain/writer-selection.js`; `tools/ai-brain/test/lat-c3e2a-retire-writer-selection.test.js`; `tools/ai-brain/test/task-ai-142-jev-weights.test.js`; `tools/ai-brain/test/task-ai-171-jev-pipeline.test.js`; `docs/product-spec/work-items/TASK-AI-214.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-214-retire-writer-selection`                                                                                                                                                                                                                                                                                                      |

## Business outcome

`tools/ai-brain/writer-selection.js` had zero runtime callers after legacy dispatch was retired. This Work Item deletes `writer-selection.js`, updates remaining test references, and adds `lat-c3e2a-retire-writer-selection.test.js` so no production file can require it.

## Scope and acceptance

| ID  | Criterion                                                                                                         | Evidence                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC1 | `tools/ai-brain/writer-selection.js` is deleted                                                                   | `tools/ai-brain/test/lat-c3e2a-retire-writer-selection.test.js`                                                                                                                |
| AC2 | Zero production source files reference `writer-selection` while `jev-weights` and `jev-pipeline` tests stay green | `tools/ai-brain/test/lat-c3e2a-retire-writer-selection.test.js`; `tools/ai-brain/test/task-ai-142-jev-weights.test.js`; `tools/ai-brain/test/task-ai-171-jev-pipeline.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3e2a-retire-writer-selection.test.js tools/ai-brain/test/task-ai-142-jev-weights.test.js tools/ai-brain/test/task-ai-171-jev-pipeline.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
