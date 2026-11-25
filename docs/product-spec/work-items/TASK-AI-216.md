# TASK-AI-216 — Retire unused route-health and quota-scan helpers (Lát C-3f-1 + C-3f-2)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-216` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-215` |
| Assigned author | Codex — Lát C-3f-1 + C-3f-2 cleanup; packaged on `TASK-AI-215` by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: deletes unused source quota entry points in `quota-scan.js` and dead fallback/refresh helpers in `route-health.js` (−589 lines) while preserving live status/telemetry helpers and adding two 0-caller guard tests |
| Allowed paths | `tools/ai-brain/quota-scan.js`; `tools/ai-brain/route-health.js`; `tools/ai-brain/test/lat-c3f1-retire-unused-quota-entrypoints.test.js`; `tools/ai-brain/test/lat-c3f2-retire-route-refresh.test.js`; `docs/product-spec/work-items/TASK-AI-216.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-216-retire-route-quota-helpers` |

## Business outcome

After Wave 2 wired live `9router + JEV` dispatch and earlier Wave 4 slices retired legacy dispatchers, unused quota-scan entry points (`C-3f-1`, `9c87b614`) and route-health fallback/refresh helpers (`C-3f-2`, `07e77161`) had zero production callers (−589 lines). This Work Item keeps both commits and both 0-caller guard tests intact.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Retired quota-scan entry points and route-health fallback/refresh helpers are unexported with zero production callers | `tools/ai-brain/test/lat-c3f1-retire-unused-quota-entrypoints.test.js`; `tools/ai-brain/test/lat-c3f2-retire-route-refresh.test.js` |
| AC2 | Live route-health and quota-scan tests remain green without regression | `tools/ai-brain/test/lat-c3f1-retire-unused-quota-entrypoints.test.js`; `tools/ai-brain/test/lat-c3f2-retire-route-refresh.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3f1-retire-unused-quota-entrypoints.test.js tools/ai-brain/test/lat-c3f2-retire-route-refresh.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
