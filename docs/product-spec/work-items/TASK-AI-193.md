# TASK-AI-193 — Add `priors-read.js` for combo members and cut legacy `priors`/`route-health` hooks (Lát B1-3)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-193` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-191`; `TASK-AI-192` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator instruction 2026-11-21 |
| Risk | `LOW`: adds combo-local read facade and removes dead legacy hooks in `next-runner.js` and `orchestrate.js` |
| Allowed paths | `tools/ai-brain/priors-read.js`; `tools/ai-brain/priors.js`; `tools/ai-brain/hermes-session.js`; `tools/ai-brain/next-runner.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-193-priors-read-hooks.test.js`; `docs/product-spec/work-items/TASK-AI-193.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-193-priors-read-hooks` |

## Business outcome

Third small slice of Lát B1 (preparing directly for Lát B2 JEV-over-combo selection):
1. Introduces `tools/ai-brain/priors-read.js` with `scoreComboMembers(members, role)` supplying combo-local `liveIds` so `splitModelEffort` never falls back to `priors-public.liveModelIds()`.
2. Migrates `hermes-session.js` off direct `priors.js` import to `priors-read.js`.
3. Removes the legacy `refreshPriors` network auto-refresh hook in `next-runner.js` and the unused `route-health` launch writes (`rememberLaunchTpm`, `rememberLaunchContextOverflow`) in `orchestrate.js`.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | `priors-read.js` exports `loadPriors`, `normaliseModelId`, `splitModelEffort`, `priorFor`, and `scoreComboMembers`, and scores/sorts combo members with combo-local prefix resolution | `tools/ai-brain/test/task-ai-193-priors-read-hooks.test.js` |
| AC2 | `hermes-session.js`, `next-runner.js`, and `orchestrate.js` no longer require `priors.js` or `route-health.js` | `tools/ai-brain/test/task-ai-193-priors-read-hooks.test.js` |
| AC3 | Existing hermes, next-runner, and orchestrate tests pass unchanged | `node --test` verification suite |

## Verification

- `node --test tools/ai-brain/test/task-ai-193-priors-read-hooks.test.js`
- `node --test tools/ai-brain/test/task-ai-142-hermes-session.test.js tools/ai-brain/test/task-ai-182-split-paths.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
