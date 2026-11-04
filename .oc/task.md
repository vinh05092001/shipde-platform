# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.
TASK-AI-171 currently adds 3729 lines. Do exactly these, nothing else:
- tools/ai-brain/test/unified-routing-offline.test.js (966 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/scoped-health.js (676 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/unified-selector.js (637 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/candidate-adapters.js (619 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/route-identity.js (556 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
Then: run the AC tests, commit "[TASK-AI-171] Split into small files: <insertions> lines", stop.
If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.
