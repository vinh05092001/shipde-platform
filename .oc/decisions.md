# Decision ledger — p-routing-core (seeded 11-04_08:33 from earlier review rounds)
## round 1 11-04_11:38 VERDICT: CHANGES_REQUIRED
## round 2 11-04_12:57 VERDICT: CHANGES_REQUIRED
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.
## round 3 11-04_15:41 VERDICT: CHANGES_REQUIRED
- seen:    WHERE: PR #509 description (contract validation; this GitHub field has no repository file:line).
- seen:    WHERE: tools/ai-brain/candidate-adapters.js:548 (loadAgyPoolCandidates), :598 (aggregateAllCandidates).
- seen:    WHERE: tools/ai-brain/candidate-adapters.js:255 (load9RouterCandidates).
- seen:    WHERE: tools/ai-brain/candidate-adapters.js:355 (loadDirectProviderCandidates).
- seen:    WHERE: tools/ai-brain/unified-selector.js:135 (evaluateAdmission).
- seen:    WHERE: tools/ai-brain/unified-selector.js:236 (evaluateAdmission).
- seen:    WHERE: tools/ai-brain/unified-selector.js:77 (advisoryNamesIdentity).
- seen:    WHERE: tools/ai-brain/unified-selector.js:438 (selectRoute).
- seen: Follow-up (non-blocking): Isolate shared JEV caches by validation policy and bind combo account alternatives to the account that passed admission.
## round 4 11-04_16:26 VERDICT: CHANGES_REQUIRED
- seen:    WHERE: PR #509 description (contract validation; no repository file:line applies).
- seen:    WHERE: tools/ai-brain/candidate-adapters-agy.js:226 (loadAgyPoolCandidates); tools/ai-brain/candidate-adapters.js:200 (aggregateAllCandidates).
- seen:    WHERE: tools/ai-brain/candidate-adapters.js:167 (load9RouterCandidates).
- seen:    WHERE: tools/ai-brain/candidate-adapters-direct.js:90 (loadDirectProviderCandidates).
- seen:    WHERE: tools/ai-brain/unified-selector-admission.js:59 (evaluateAdmission).
- seen:    WHERE: tools/ai-brain/unified-selector-admission.js:159 (evaluateAdmission).
- seen:    WHERE: tools/ai-brain/unified-selector-admission.js:6 (advisoryNamesIdentity); tools/ai-brain/unified-selector-jev.js:95 (determineWeightProfile).
- seen:    WHERE: tools/ai-brain/unified-selector-jev.js:125 (determineWeightProfile).
- seen:    WHERE: tools/ai-brain/candidate-adapters-agy.js:210 (loadAgyPoolCandidates).
- seen: Follow-up (non-blocking): Isolate JEV caches by validation policy, bind combo alternatives to the admitted account, refresh stale test-count claims, and provide actual exact-head CI results.
## round 5 11-04_17:27 VERDICT: CHANGES_REQUIRED
## round 6 11-04_19:28 VERDICT: CHANGES_REQUIRED
## round 8 11-05_00:57 VERDICT: CHANGES_REQUIRED
## round 12 11-05_05:20 VERDICT: CHANGES_REQUIRED
## round 13 11-05_05:41 VERDICT: CHANGES_REQUIRED
