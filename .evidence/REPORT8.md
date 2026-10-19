# Task AI-142 Fix Report: Clear QUALITY_UNKNOWN on Subsequent Scored Ranking (PR #414 P1 Review)

## Summary of Fix

1. **P1 — `tools/ai-brain/ranking.js:637` (QUALITY_UNKNOWN not cleared on candidate gaining finite score)**
   - **Issue:** `rankAndRecord` set `c.qualityLabel = 'QUALITY_UNKNOWN'` when a candidate initially lacked a finite quality score. When that candidate later gained a finite quality score and underwent subsequent ranking, `rankAndRecord` never cleared `qualityLabel`. As a result, `aKnown` remained `false` due to `a.qualityLabel !== 'QUALITY_UNKNOWN'` failing, causing the now-scored model to be treated as unscored and violating the required ordering.
   - **Fix:** In `rankAndRecord`, derive `qualityLabel` afresh on every ranking pass. When candidate `quality` is finite (or 0), clear `qualityLabel` from the candidate (`delete c.qualityLabel`) and ensure `scoreBreakdown.qualityLabel` is cleared.

## Regression Test

Added regression test in `tools/ai-brain/test/task-ai-142-quality-unknown.test.js`:

- `TASK-AI-142 regression: rankAndRecord clears QUALITY_UNKNOWN when candidate gains finite quality and orders correctly`:
  - Step 1: Runs `rankAndRecord` on an initially unscored candidate alongside a scored candidate; confirms candidate receives `QUALITY_UNKNOWN` and ranks behind the scored candidate.
  - Step 2: Updates candidate with a finite quality score derived from sources configuration.
  - Step 3: Runs subsequent `rankAndRecord` pass; verifies `qualityLabel` is cleared, `scoreBreakdown.qualityLabel` is cleared, and the candidate with higher score and finite quality correctly orders ahead of the lower-scored candidate.

## Test Execution Results

- `node --test tools/ai-brain/test/task-ai-142-quality-unknown.test.js`
  - 6 tests pass, 0 fail.
- `node --test tools/ai-brain/test/task-ai-142-*.test.js`
  - 624 tests, 620 pass, 0 fail, 4 skipped.
- `node scripts/ai/check-no-hardcode.mjs`
  - PASS: 0 new hardcode violations.
- `git diff --check`
  - Clean, no whitespace/conflict errors.
- Prettier check (`prettier --check`)
  - All matched files use Prettier code style.
