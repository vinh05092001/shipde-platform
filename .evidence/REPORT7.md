# Task AI-142 Fix Report: Quality Unknown Labeling and Mutation (PR #414)

## Summary of Fixes

1. **P1 — `tools/ai-brain/routing.js:1192` (Null benchmark prior mislabeling)**
   - **Issue:** A null benchmark prior (`prior.score === null` or `prior.qualityLabel === 'QUALITY_UNKNOWN'`) previously forced `isQualityUnknown = true` even when `internalQuality` provided a finite quality score from harness/evidence. This caused scored candidates to be labelled `QUALITY_UNKNOWN` and sorted behind other scored models.
   - **Fix:** Base `isQualityUnknown` solely on the resulting computed `quality`: `quality === null || !Number.isFinite(quality)`. When `internalQuality` is finite, `quality` is finite and the candidate is correctly treated as scored.

2. **P1 — `tools/ai-brain/routing.js:1196,1570` (Candidate mutation & stale label trust)**
   - **Issue:** `scoreForProfile` mutated the input candidate object with `candidate.qualityLabel = 'QUALITY_UNKNOWN'`. Later in `rankForProfile`, ranking trusted `c.qualityLabel === 'QUALITY_UNKNOWN'`. If a candidate was subsequently evaluated with quality evidence, it retained the stale mutated label and remained sorted as unknown.
   - **Fix:** Removed mutation of `candidate.qualityLabel` in `scoreForProfile`. In `rankForProfile`, derived the quality unknown state freshly from the score breakdown: `const isQualityUnknown = scored.breakdown.qualityLabel === 'QUALITY_UNKNOWN' || scored.breakdown.quality === null;`, eliminating reliance on input `c.qualityLabel`.

## Regression Tests

Added two regression tests in `tools/ai-brain/test/task-ai-142-quality-unknown.test.js`:

1. `TASK-AI-142 regression: null benchmark prior does not set QUALITY_UNKNOWN when internal quality is finite`:
   - Verifies that a candidate with evidence (finite internal quality) and a null benchmark prior does not get labelled `QUALITY_UNKNOWN` and ranks ahead of a candidate with lower benchmark-only score.
2. `TASK-AI-142 regression: scoring does not mutate candidate qualityLabel and ranking derives label afresh`:
   - Verifies that `scoreForProfile` does not mutate `candidate.qualityLabel`.
   - Verifies that `rankForProfile` derives the label afresh from quality evidence even if the candidate object previously had `qualityLabel: 'QUALITY_UNKNOWN'`.

## Test Execution Results

- `node --test tools/ai-brain/test/task-ai-142-quality-unknown.test.js`
  - 5 tests pass, 0 fail.
- `node --test tools/ai-brain/test/task-ai-142-*.test.js`
  - 623 tests, 619 pass, 0 fail, 4 skipped.
- `node scripts/ai/check-no-hardcode.mjs`
  - PASS: 0 new hardcode violations.
- `git diff --check`
  - Clean, no whitespace/conflict errors.
- Prettier check (`prettier --check`)
  - All matched files use Prettier code style.
