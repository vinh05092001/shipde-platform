# TASK-AI-223 — Add agy-pool group-delta identity verifier and reviewer-not-run artifact clarity (WI-B2/B3)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-223` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-222` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: adds fail-closed identity evidence verification and clearer reviewer-not-run artifacts; agy-pool remains OFF by default |
| Allowed paths | `tools/ai-brain/agy-pool-candidates.js`; `tools/ai-brain/orchestrate/review-item.js`; `tools/ai-brain/test/wi-b2-b3-receipt-and-artifact.test.js`; `tools/ai-brain/test/wi-b2-group-evidence.test.js`; `docs/product-spec/work-items/TASK-AI-223.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-223-agy-identity-evidence` |

## Business outcome

Add 4-timestamp bracketed agy-pool group-delta identity evidence verifier and distinct reviewer-not-run artifact causes. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-b2-b3-receipt-and-artifact.test.js`; `tools/ai-brain/test/wi-b2-group-evidence.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-b2-b3-receipt-and-artifact.test.js`; `tools/ai-brain/test/wi-b2-group-evidence.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-b2-b3-receipt-and-artifact.test.js tools/ai-brain/test/wi-b2-group-evidence.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
