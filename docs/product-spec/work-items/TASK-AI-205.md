# TASK-AI-205 — Stop live annotateCandidates callers from reading stale quota-scan or route-health (Lát C-3b)

## Control

| Field           | Value                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-205`                                                                                                                                                                                                                                                                                   |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                           |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                               |
| Dependencies    | `TASK-AI-204`                                                                                                                                                                                                                                                                                   |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup                                                                                                                                                                                                                                                   |
| Risk            | `LOW`: passes `loadQuotaState: false` from live `annotateCandidates` callers (`orchestrate.js`, `planning-services.js`) and skips `quota-scan` / `route-health` lookups when `loadQuotaState: false` and no `routeHealth` is supplied                                                           |
| Allowed paths   | `tools/ai-brain/candidates.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/planning-services.js`; `tools/ai-brain/test/lat-c3b-sever-live-quota-state.test.js`; `docs/product-spec/work-items/TASK-AI-205.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-205-cut-stale-quota-read`                                                                                                                                                                                                                                                         |

## Business outcome

Live orchestration (`orchestrate.js`, `planning-services.js`) still allowed `annotateCandidates` to read stale persisted `quota-state` or `route-health` data by default. This Work Item passes `loadQuotaState: false` from live callers and ensures `candidates.js` skips `quota-scan` and `route-health` when `loadQuotaState: false` and no explicit `routeHealth` store is provided, preventing stale probe state from blocking live candidates.

## Scope and acceptance

| ID  | Criterion                                                                                                                                     | Evidence                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| AC1 | Live `annotateCandidates` callers (`orchestrate.js`, `planning-services.js`) pass `loadQuotaState: false` so stale stored quota is never read | `tools/ai-brain/test/lat-c3b-sever-live-quota-state.test.js` |
| AC2 | `annotateCandidates` with `loadQuotaState: false` and no `routeHealth` never invokes `quota-scan` or `route-health`                           | `tools/ai-brain/test/lat-c3b-sever-live-quota-state.test.js` |

## Verification

- `node --test tools/ai-brain/test/lat-c3b-sever-live-quota-state.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
