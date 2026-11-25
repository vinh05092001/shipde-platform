# TASK-AI-225 — Skip failed model/account pairs and exhausted agy-pool accounts within a run (WI-D)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-225` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-224` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: opt-in agy-pool lane remains OFF by default; in-run exclusion only |
| Allowed paths | `tools/ai-brain/agy-pool-candidates.js`; `tools/ai-brain/combo-jev-select.js`; `tools/ai-brain/orchestrate/candidate-select.js`; `tools/ai-brain/test/wi-d-agy-account-rotation.test.js`; `docs/product-spec/work-items/TASK-AI-225.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-225-agy-account-rotation` |

## Business outcome

Exclude failed agy-pool model/account pairs and exhausted accounts within a single run without affecting other models or runs. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-d-agy-account-rotation.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-d-agy-account-rotation.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-d-agy-account-rotation.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
