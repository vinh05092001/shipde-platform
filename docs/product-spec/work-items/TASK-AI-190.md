# TASK-AI-190 — Fix Windows CRLF format gate, carry-over `.shipde-bin` exclusion, and live decision timestamps

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-190` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-188` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator instruction 2026-11-21 |
| Risk | `LOW`: narrow bug fixes for live Windows Controller runs |
| Allowed paths | `tools/ai-brain/orchestrate/gates.js`; `tools/ai-brain/isolation/carryover-exercise.js`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/test/task-ai-190-format-carryover-now.test.js`; `docs/product-spec/work-items/TASK-AI-190.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-190-format-carryover-now` |

## Business outcome

Unblocks live Controller end-to-end runs on Windows by fixing three defects observed during `TASK-AI-187`:
1. `prettierCheck` in `orchestrate/gates.js` false-failed `FORMAT_CHECK_FAILED` on Prettier-clean LF commits checked out as CRLF under Windows `core.autocrlf=true`. Checking the raw committed Git blob via `git show <sha>:<relative>` + `prettier --check --stdin-filepath` verifies the exact bytes Git and Linux CI check.
2. `carryOverSave` in `isolation/carryover-exercise.js` excluded `.shipde` but forgot `.shipde-bin`, causing it to stage and commit the 10 MB `.shipde-bin/rtk.exe` binary into the feature branch.
3. `orchestrateCommand` in `cli/commands.js` unconditionally passed `now: (d && d.now) || Date.now()` into `runOrchestration`, freezing every decision log `at` timestamp in live CLI runs to process startup time.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | `prettierCheck(files, { workerRoot, sha })` passes on a Prettier-clean LF commit even when the working-tree file on disk has CRLF, and still fails when the committed blob is unformatted | `tools/ai-brain/test/task-ai-190-format-carryover-now.test.js` |
| AC2 | `carryOverSave` does not stage or commit files under `.shipde-bin/` while still carrying over legitimate edits | `tools/ai-brain/test/task-ai-190-format-carryover-now.test.js` |
| AC3 | `orchestrateCommand` forwards `now` only when `deps.now !== undefined`, leaving live CLI runs free to stamp real decision timestamps | `tools/ai-brain/test/task-ai-190-format-carryover-now.test.js` |

## Verification

- `node --test tools/ai-brain/test/task-ai-190-format-carryover-now.test.js`
- `node --test tools/ai-brain/test/task-ai-188-repair-adoption.test.js tools/ai-brain/test/task-ai-182-split-paths.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
