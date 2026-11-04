# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.
TASK-AI-160 currently adds 836 lines. Do exactly these, nothing else:
- (no file over 300 lines) -> only remove anything no acceptance criterion needs
Then: run the AC tests, commit "[TASK-AI-160] Split into small files: <insertions> lines", stop.
If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----
