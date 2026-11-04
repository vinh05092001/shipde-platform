# Decision ledger — p-task-ai-169 (seeded 11-04_08:33 from earlier review rounds)

- seen: WHERE: tools/ai-brain/run-ledger.js:11 (isForbiddenId) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:118 (RunLedger.admit / RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:119 (`RunLedger.admit`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:127 (`RunLedger.admit`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:129 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:14 (`maskCredentials`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:142 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:144 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:166 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:170 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:178 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:199 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:205 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:208 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:210 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:216 (RunLedger.admit) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:22 (maskCredentials) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:242 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:250 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:261 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:278 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:280 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:286 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:289 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:296 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:297 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:308 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:309 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:322 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:330 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:332 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:338 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:345 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:347 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:352 (`RunLedger.record`) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:361 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:363 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:382 (RunLedger.record) — NEW P1
- seen: WHERE: tools/ai-brain/run-ledger.js:397 (RunLedger.record) — NEW P1

## coordinator decision 04/11 12:10 (operator: reuse community packages)

- REQUIRED: credential masking uses fast-redact@3.5.0 + new URL(); hand-written regex masking = prior finding NOT FIXED.
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.

## round 66 11-04_14:53 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/run-ledger.js:359 (RunLedger.record; PRIOR #1 FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:386 (RunLedger.record; PRIOR #2 FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:251 (RunLedger.admit; PRIOR #3 FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:22 (assertValidId; PRIOR #4 FIXED)
- seen: WHERE: .oc/pr-body.md:101 (Verification; PRIOR CI P1 NOT FIXED — unverified)
- seen: WHERE: tools/ai-brain/run-ledger.js:228 (RunLedger.admit; NEW P1 — AC/spec match)
- seen: Follow-up (non-blocking): Align Work Item and PR evidence with the final slice and actual test count; previously closed prototype, URL-masking, and execution-identity findings are not reopened.

## round 67 11-04_15:48 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/run-ledger.js:312 (RunLedger.record; PRIOR #1 NOT FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:313 (RunLedger.record; PRIOR #2 NOT FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:338 (RunLedger.record; PRIOR #3 NOT FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:252 (RunLedger.record, assertValidId; PRIOR #4 FIXED)
- seen: WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 NOT FIXED — previous-review location, current body not supplied)
- seen: WHERE: tools/ai-brain/run-ledger.js:337 (RunLedger.record; PRIOR #6 NOT FIXED)
- seen: WHERE: tools/ai-brain/run-ledger.js:19 (SECRET_KEY, maskCredentials; NEW P1 — audit/PII masking)
- seen: Follow-up (non-blocking): Align the Work Item’s claimed 13 tests and completed verification checklist with the final slice and supplied results.

## round 68 11-04_17:57 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/run-ledger.js:201 (RunLedger.record; PRIOR #1 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:202 (RunLedger.record; PRIOR #2 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:227 (RunLedger.record; PRIOR #3 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:161 (RunLedger.record; PRIOR #4 FIXED, rejection implemented in run-ledger-helpers.js:27)
- seen: WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 FIXED by supplied exact-HEAD CI evidence; location belongs to the previous review)
- seen: WHERE: tools/ai-brain/run-ledger.js:226 (RunLedger.record; PRIOR #6 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger-helpers.js:12 (SECRET_KEY, maskCredentials; PRIOR #7 NOT FIXED — P1, audit/PII masking)
- seen: Follow-up (non-blocking): Align the Work Item’s claimed 13 tests with the 14 supplied AC tests and remove unrelated lockfile version drift.

## round 69 11-04_18:17 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/run-ledger.js:201 (RunLedger.record; PRIOR #1 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:202 (RunLedger.record; PRIOR #2 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:227 (RunLedger.record; PRIOR #3 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger.js:135 (RunLedger.record; PRIOR #4 FIXED; rejection in tools/ai-brain/run-ledger-helpers.js:27, assertValidId)
- seen: WHERE: .oc/pr-body.md:101 (Verification; PRIOR #5 FIXED by supplied exact-HEAD CI evidence; previous-review location)
- seen: WHERE: tools/ai-brain/run-ledger.js:226 (RunLedger.record; PRIOR #6 NOT FIXED — P1, AC/spec match)
- seen: WHERE: tools/ai-brain/run-ledger-helpers.js:12 (SECRET_KEY, maskCredentials; PRIOR #7 NOT FIXED — P1, audit/PII masking)
- seen: Follow-up (non-blocking): Align the claimed 13 tests with the 14 supplied AC tests and remove unrelated lockfile version drift.
