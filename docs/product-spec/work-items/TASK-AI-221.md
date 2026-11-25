# TASK-AI-221 — Add opt-in agy-pool candidates to JEV shortlist (WI-A1)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-221` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-211` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: opt-in flag `agyPoolShortlistEnabled` remains `false` by default; preserves single `shortlistForJev` implementation and 9router-only behavior when flag is off |
| Allowed paths | `tools/ai-brain/agy-pool-candidates.js`; `tools/ai-brain/agy-pool-runtime.js`; `tools/ai-brain/combo-jev-select.js`; `tools/ai-brain/sources.json`; `tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js`; `docs/product-spec/work-items/TASK-AI-221.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-221-agy-pool-shortlist` |

## Business outcome

Add agy-pool candidate discovery and lane-aware shortlistForJev support with agyPoolShortlistEnabled OFF by default. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js`; `tools/ai-brain/test/jev-systemone-criteria.test.js`; `tools/ai-brain/test/jev-wire-and-shortlist.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js`; `tools/ai-brain/test/jev-systemone-criteria.test.js`; `tools/ai-brain/test/jev-wire-and-shortlist.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-a1-agy-pool-shortlist.test.js tools/ai-brain/test/jev-systemone-criteria.test.js tools/ai-brain/test/jev-wire-and-shortlist.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
