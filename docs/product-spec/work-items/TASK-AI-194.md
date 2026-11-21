# TASK-AI-194 — JEV-guided member selection over curated 9router combo (Lát B2)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-194` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-192`; `TASK-AI-193` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator architecture decision 2026-11-21 |
| Risk | `LOW`: new self-contained selector module reusing `combo-reader.js`, `priors-read.js`, `jev.js`, and `combo.js` |
| Allowed paths | `tools/ai-brain/combo-jev-select.js`; `tools/ai-brain/test/task-ai-194-jev-combo-select.test.js`; `docs/product-spec/work-items/TASK-AI-194.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-194-jev-combo-select` |

## Business outcome

Implements the operator-approved 5-step model selection architecture over the curated 9router combo (`vinh`):
1. Assess the task (complexity, risk, role, file count).
2. Read only the curated combo members via `combo-reader.readComboConfig`.
3. Attach benchmark score & reasoning/effort metadata via `priors-read.scoreComboMembers` (combo-local `liveIds`, zero full-catalogue enumeration).
4. For the reviewer role, filter out members sharing the writer's model family so writer and reviewer naturally satisfy `M-R04` independence.
5. Ask JEV (`jev.advise`) using opaque option labels (`M0`, `M1`, ...) carrying score & reasoning effort -> JEV selects which combo member fits the task, with deterministic complexity-aware fallback if JEV is unavailable or undecided.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | `selectComboMember` assesses task difficulty, scores combo members, asks JEV with opaque option IDs, and returns a 9router candidate for the JEV-selected member | `tools/ai-brain/test/task-ai-194-jev-combo-select.test.js` |
| AC2 | Reviewer selection excludes members sharing the writer's upstream or model family (`independentApplied: true`), refusing fail-closed (`NO_INDEPENDENT_REVIEWER`) when no independent member qualifies | `tools/ai-brain/test/task-ai-194-jev-combo-select.test.js` |
| AC3 | When JEV is unavailable or undecided, deterministic fallback picks by complexity (`high` -> top score/effort, `low` -> lower-effort within score band), and empty combo falls back cleanly to the configured combo candidate | `tools/ai-brain/test/task-ai-194-jev-combo-select.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-194-jev-combo-select.test.js`
- `node --test tools/ai-brain/test/task-ai-192-combo-reader.test.js tools/ai-brain/test/task-ai-193-priors-read-hooks.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
