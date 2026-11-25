# TASK-AI-226 — Offer agy-pool members when all 9router combo members are exhausted (WI-E)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-226` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-225` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: opt-in agy-pool lane remains OFF by default; preserves legacy fallback when off or combo unreadable |
| Allowed paths | `tools/ai-brain/orchestrate/candidate-select.js`; `tools/ai-brain/test/wi-e-agy-combo-exhausted-fallback.test.js`; `docs/product-spec/work-items/TASK-AI-226.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-226-agy-combo-exhausted-fallback` |

## Business outcome

Allow selectComboMember to evaluate agy-pool members when all 9router combo members have failed in the run and agy-pool is enabled. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-e-agy-combo-exhausted-fallback.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-e-agy-combo-exhausted-fallback.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-e-agy-combo-exhausted-fallback.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
