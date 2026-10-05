# TASK-AI-100 — The Controller uses external benchmark priors as a bounded tie-break

## Control

- Work Item ID: TASK-AI-100
- Status: READY_FOR_CODEX
- Assigned author: tokenharbor/gpt-6-luna via opencode
- Dependencies: TASK-AI-80

## Business Outcome

Candidates with the same proof level were ranked equally, so weak models tied strong ones. The Controller now adds a small bounded bonus from external benchmark tiers (AA Coding Index 2026-09, LiveBench 2026-06-25; data/external-model-priors.json) after all floors, never changing eligibility or proof level, and records the prior in the score breakdown.

## Acceptance Matrix

- P-R01 Add a small module tools/ai-brain/priors.js exporting loadPriors(file?) (default the data file above; returns {ranking:[]} on missing/invalid file, never throws) and priorFor(candidate, role, priors) returning {canonical, tier, bonus} or null. Canonical matching: take the model id's last path segment, lower-case, strip ':free', '-free', '@...' suffixes, and treat '.' and '_' as '-'; match when equal to the same normalisation of ranking[].canonical. role 'reviewer' or 'security-review' uses reviewTier; every other role uses codingTier. Bonus: T1 +6, T2 +4, T3 +2, T4 0, unknown/null -> null (never 0 presented as a score and never negative).
- P-R02 In routing.js scoring, after floors are applied, add the prior bonus to the candidate score only as a tie-break: it must never let a candidate pass a floor it failed, never raise proof level, and never change eligibility. Record in the score breakdown { prior: { canonical, tier, bonus } } or prior: null.
- P-R03 Priors are loaded once per ranking call and can be injected (ctx.priors) for tests; no network access.
- P-R04 Tests (new file tools/ai-brain/test/task-ai-100.test.js, hermetic): two candidates with the same proof level where only the prior differs -> the T1 candidate ranks first and its breakdown shows the prior; a candidate below the proof floor with a T1 prior is still rejected; an unknown model gets prior null and its score is unchanged; reviewer role uses reviewTier.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-100.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- Priors cover 54 canonical models; others get prior null. Tiers come from a third-party aggregator (benchlm.ai) of Artificial Analysis and LiveBench.
