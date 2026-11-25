# TASK-AI-222 — Add config-driven modelStemAliases and fail-closed family independence (WI-B1)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-222` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-221` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: pure config-driven vendor alias normalization with fail-closed family independence checks; agy-pool remains OFF by default |
| Allowed paths | `tools/ai-brain/combo-jev-select.js`; `tools/ai-brain/sources.json`; `tools/ai-brain/test/wi-b1-vendor-stem-aliases.test.js`; `docs/product-spec/work-items/TASK-AI-222.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-222-vendor-stem-aliases` |

## Business outcome

Add config-driven modelStemAliases in sources.json and enforce fail-closed vendor family independence in combo-jev-select.js. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-b1-vendor-stem-aliases.test.js`; `tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js`; `tools/ai-brain/test/jev-systemone-criteria.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-b1-vendor-stem-aliases.test.js`; `tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js`; `tools/ai-brain/test/jev-systemone-criteria.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-b1-vendor-stem-aliases.test.js tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js tools/ai-brain/test/jev-systemone-criteria.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
