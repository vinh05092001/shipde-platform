# TASK-AI-197 — Sever remaining live runtime hooks to route-health.js and quota-scan.js (Lát C-1)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-197`                                                                                                                                                                                                                                                                                                                            |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                    |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                        |
| Dependencies    | `TASK-AI-196`                                                                                                                                                                                                                                                                                                                            |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup                                                                                                                                                                                                                                                                                            |
| Risk            | `LOW`: removes dead legacy route-health/quota-scan hooks from 4 runtime modules without removing legacy modules yet                                                                                                                                                                                                                      |
| Allowed paths   | `tools/ai-brain/cli/commands.js`; `tools/ai-brain/planning-services.js`; `tools/ai-brain/next-runner.js`; `tools/ai-brain/catalogue-refresh.js`; `tools/ai-brain/test/task-ai-197-sever-legacy-hooks.test.js`; `docs/product-spec/work-items/TASK-AI-197.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                                                                |
| Branch          | `feat/task-ai-197-sever-legacy-hooks`                                                                                                                                                                                                                                                                                                    |

## Business outcome

Severs the remaining live runtime references to legacy `route-health.js` and `quota-scan.js`:

1. Removes the dead `d.refreshRoutes === true` block in `cli/commands.js`.
2. Removes `require('./route-health').rememberProbe(...)` in `planning-services.js`.
3. Removes the default `require('./quota-scan')` fallback in `next-runner.js` (preserving injected `d.quotaScan` for unit tests).
4. Inlines the 15-line `sanitizeErrorSnippet` helper in `catalogue-refresh.js` so it no longer pulls in the 3,104-line `quota-scan.js`.

## Scope and acceptance

| ID  | Criterion                                                                                                                                   | Evidence                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| AC1 | None of `cli/commands.js`, `planning-services.js`, `next-runner.js`, or `catalogue-refresh.js` require `route-health.js` or `quota-scan.js` | `tools/ai-brain/test/task-ai-197-sever-legacy-hooks.test.js` |
| AC2 | `catalogue-refresh.js` loads cleanly without `quota-scan.js` and existing focused tests remain green                                        | `tools/ai-brain/test/task-ai-197-sever-legacy-hooks.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-197-sever-legacy-hooks.test.js tools/ai-brain/test/task-ai-196-live-rtk-and-jev-wire.test.js tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js`
