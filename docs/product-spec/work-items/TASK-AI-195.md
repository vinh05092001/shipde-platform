# TASK-AI-195 — Wire JEV-guided combo member selection into orchestrate (Lát B3)

## Control

| Field           | Value                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-195`                                                                                                                                                                                                                         |
| Feature ID      | `N/A`                                                                                                                                                                                                                                 |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                     |
| Dependencies    | `TASK-AI-194`                                                                                                                                                                                                                         |
| Assigned author | Antigravity (`agy08`, Gemini) — operator architecture decision 2026-11-21                                                                                                                                                             |
| Risk            | `LOW`: wires `combo-jev-select.js` into `orchestrate/candidate-select.js` with clean failover to configured combo and zero regression on injected-candidate test suites                                                               |
| Allowed paths   | `tools/ai-brain/orchestrate/candidate-select.js`; `tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js`; `docs/product-spec/work-items/TASK-AI-195.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter)                                                                                                                                                             |
| Branch          | `feat/task-ai-195-wire-combo-jev`                                                                                                                                                                                                     |

## Business outcome

Connects `tools/ai-brain/combo-jev-select.js` (TASK-AI-194) into the live orchestration selection seam (`orchestrate/candidate-select.js:selectCandidateForProfile`) so:

1. Writer selection assesses task difficulty, scores combo members, asks JEV (`jevAsk` or deterministic complexity fallback), and launches the chosen combo member candidate.
2. Reviewer selection passes `writerModelId` to `selectComboMember` so the review lane selects an independent combo member (distinct upstream + distinct model family) satisfying `M-R04` naturally.
3. If the chosen member fails on attempt 1 (`failedKeys`), retry excludes failed/exhausted members and falls back cleanly to remaining members or the configured combo candidate.
4. Existing unit tests with injected `o.candidates` or test runners (`o.run` / `o.injectedRun`) remain untouched unless combo-JEV selection is explicitly enabled.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| AC1 | `selectCandidateForProfile` invokes `selectComboMember` for writer role, appends the chosen member candidate into the run pool, and records `combo-jev:*` selection decision                                                                                                                                                                                                       | `tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js` |
| AC2 | `selectCandidateForProfile` passes `writerModelId` for reviewer role and selects an independent member (different upstream + family); concrete or unknown writer identities refuse fail-closed (`NO_INDEPENDENT_REVIEWER` with non-empty `rejected` blocking downstream `reviewerIdentity` override) by default, while opaque-combo writers preserve the 2026-11-19 combo fallback | `tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js` |
| AC3 | Failed member in `failedKeys` is skipped on retry, falling back to another eligible member or the configured combo candidate                                                                                                                                                                                                                                                       | `tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-195-wire-combo-jev.test.js tools/ai-brain/test/task-ai-194-jev-combo-select.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
