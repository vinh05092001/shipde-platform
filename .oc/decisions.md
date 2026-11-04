# Decision ledger — p-task-ai-166 (seeded 11-04_08:33 from earlier review rounds)

## coordinator decision 04/11 12:10

- REQUIRED: catalogue built from OpenRouter /api/v1/models + LiteLLM model_prices_and_context_window.json + live provider /models; any hand-written model list or score = prior finding NOT FIXED.

## coordinator decision 04/11 12:40

- REQUIRED in this PR: priors normalisation fix (fallback-only percentile inflation) — see task-fix root-cause SCORING.
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.

## round 103 11-04_15:42 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/test/discovery.test.js:1008 (append-only ledger regression)
- seen: WHERE: tools/ai-brain/cli.js:2100 (dispatchCommand)
- seen: WHERE: tools/ai-brain/catalogue-refresh.js:112 (refreshCatalogue)
- seen: Follow-up (non-blocking): Complete the recorded AC-166-01/02 host live evidence and update the stale author-handoff text.

## round 104 11-04_18:00 VERDICT: CHANGES_REQUIRED

## round 105 11-04_20:46 VERDICT: CHANGES_REQUIRED
## round 116 11-05_04:06 VERDICT: CHANGES_REQUIRED
