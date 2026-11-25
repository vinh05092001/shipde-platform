# TASK-AI-217 — Retire remaining zero-caller dead helpers across ai-brain (Lát C-3g-1..C-3g-4)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-217` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-216` |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C-3g-1..4 cleanup; consolidated on `TASK-AI-216` per Codex approval |
| Risk | `LOW`: removes 21 zero-caller, zero-test dead helpers and two unused `require` lines across `approval-registry.js`, `intake.js`, `sources.js`, `evidence.js`, `facts.js`, `governed-merge.js`, `jev.js`, `route-identity-utils.js`, and `hermes-session.js` (−549 lines total) while keeping all four 0-caller guard tests intact |
| Allowed paths | `tools/ai-brain/approval-registry.js`; `tools/ai-brain/evidence.js`; `tools/ai-brain/facts.js`; `tools/ai-brain/governed-merge.js`; `tools/ai-brain/hermes-session.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/jev.js`; `tools/ai-brain/route-identity-utils.js`; `tools/ai-brain/sources.js`; `tools/ai-brain/test/lat-c3g1-retire-zero-caller-helpers.test.js`; `tools/ai-brain/test/lat-c3g2-retire-zero-caller-evidence-and-helpers.test.js`; `tools/ai-brain/test/lat-c3g3-retire-route-identity-dead-helpers.test.js`; `tools/ai-brain/test/lat-c3g4-retire-hermes-dead-helpers.test.js`; `docs/product-spec/work-items/TASK-AI-217.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-217-retire-zero-caller-c3g` |

## Business outcome

The final four Wave 4 cleanup slices (`C-3g-1` + `v2`, `C-3g-2`, `C-3g-3`, and `C-3g-4`) each remove zero-caller, zero-test helper functions (−245, −128, −121, and −55 lines; −549 lines total) across `tools/ai-brain`. Consolidating them into one Work Item preserves all five code commits and all four 0-caller guard tests (`lat-c3g1` through `lat-c3g4`) while closing Wave 4 cleanup in a single PR after `TASK-AI-216`.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | All 21 retired zero-caller helpers and unused requires across `C-3g-1..4` are removed with zero production references | `tools/ai-brain/test/lat-c3g1-retire-zero-caller-helpers.test.js`; `tools/ai-brain/test/lat-c3g2-retire-zero-caller-evidence-and-helpers.test.js`; `tools/ai-brain/test/lat-c3g3-retire-route-identity-dead-helpers.test.js`; `tools/ai-brain/test/lat-c3g4-retire-hermes-dead-helpers.test.js` |
| AC2 | Live `jev` contract and all four `lat-c3g*` guard tests pass with zero regression | `tools/ai-brain/test/task-ai-171-jev-contract.test.js`; all four `lat-c3g*` guard tests |

## Verification

- `node --test tools/ai-brain/test/lat-c3g1-retire-zero-caller-helpers.test.js tools/ai-brain/test/lat-c3g2-retire-zero-caller-evidence-and-helpers.test.js tools/ai-brain/test/lat-c3g3-retire-route-identity-dead-helpers.test.js tools/ai-brain/test/lat-c3g4-retire-hermes-dead-helpers.test.js tools/ai-brain/test/task-ai-171-jev-contract.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
