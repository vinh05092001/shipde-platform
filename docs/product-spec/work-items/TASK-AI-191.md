# TASK-AI-191 — Extract `failure-domain.js` and sever live loop imports of `routing.js` and `ranking.js` (Lát B1-1)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-191` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-189` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator instruction 2026-11-21 |
| Risk | `LOW`: pure extraction and import migration with re-export parity in `routing.js` |
| Allowed paths | `tools/ai-brain/failure-domain.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/orchestrate/candidate-select.js`; `tools/ai-brain/orchestrate/checkpoint.js`; `tools/ai-brain/orchestrate/repair-round.js`; `tools/ai-brain/orchestrate/review-item.js`; `tools/ai-brain/orchestrate/review-lane.js`; `tools/ai-brain/publisher.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/cli/dispatch-helpers.js`; `tools/ai-brain/planning-services.js`; `tools/ai-brain/test/task-ai-104.test.js`; `tools/ai-brain/test/task-ai-191-failure-domain.test.js`; `docs/product-spec/work-items/TASK-AI-191.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-191-extract-failure-domain` |

## Business outcome

First small, independently reviewable slice of Lát B1: extracts the ~170-line canonical failure-domain logic out of the 2,948-line `routing.js` into `tools/ai-brain/failure-domain.js`, breaks the circular `routing <-> publisher` dependency, removes 4 dead `ranking`/`routing` imports in `orchestrate*`, and migrates every live `intake -> orchestrate -> review -> publish` caller off `routing.js`. `routing.js` re-exports the extracted functions so no existing caller or test breaks while subsequent Lát B1 slices retire the legacy routing/ranking modules.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | `tools/ai-brain/failure-domain.js` exports `failureDomainFromCandidateKey`, `canonicalFailureDomain`, `failureDomainOf`, `sameFailureDomain`, and `matchesForbiddenDomain` with exact parity to `routing.js` | `tools/ai-brain/test/task-ai-191-failure-domain.test.js` |
| AC2 | `orchestrate.js`, `orchestrate/*.js`, `intake.js`, `publisher.js`, `planning-services.js`, and `cli/dispatch-helpers.js` no longer require `routing.js` or `ranking.js` for failure-domain checks | `tools/ai-brain/test/task-ai-191-failure-domain.test.js` |
| AC3 | Existing failure-domain, orchestrate, publisher, and split-paths tests pass unchanged | `node --test` verification suite |

## Verification

- `node --test tools/ai-brain/test/task-ai-191-failure-domain.test.js`
- `node --test tools/ai-brain/test/task-ai-182-split-paths.test.js tools/ai-brain/test/task-ai-103.test.js tools/ai-brain/test/mvp-repair.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
