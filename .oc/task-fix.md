# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----
