# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-158 currently adds 3398 lines. Do exactly these, nothing else:

- scripts/ai/test/pack-context.test.mjs (1074 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ctx-tools/test_smoke.py (604 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- scripts/ai/pack-context.mjs (557 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ctx-tools/smoke.py (419 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
  Then: run the AC tests, commit "[TASK-AI-158] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----
