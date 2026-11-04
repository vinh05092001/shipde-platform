
## Round 3 review (pl-task-ai-171-3, writer was opencode:ninerouter/kr/glm-5)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 9bb90d7aa419786a852d44ee1562b6cbe3737d26

TASK-AI-171 should unify route identity, scoped health and selection across 9router, direct providers and AGY, with private-account masking.
This delta touches AC-AI-171-01–08: account/quota isolation, error classification, locks, model identity, combos and pathway aggregation.
It also touches AC-AI-171-09–14: JEV caching, budgets, production defaults, cost admission, canonical keys and identity-free advice.

1. **PRIOR FINDINGS — P1 FIXED: PR contract failure**

   WHERE: PR #509 description (contract validation; this GitHub field has no repository file:line).
   WRONG: FIXED — the previous placeholder failure is resolved according to the supplied exact-head `contract=SUCCESS` evidence.
   GOAL: AGENTS.md Pull Request evidence requires a completed PR description without required template placeholders.
   VERIFY: Supplied GitHub `contract` result is SUCCESS at the reviewed SHA.

2. **BLOCKING NEW FINDINGS — P1 / AC/spec match: known shared-account exhaustion is bypassed**

   WHERE: tools/ai-brain/candidate-adapters.js:548 (loadAgyPoolCandidates), :598 (aggregateAllCandidates).
   WRONG: Configure a healthy-looking 9router candidate and an AGY lane for the same Antigravity account, with the AGY model’s `remainingPercent: 0`. The exhausted lane is discarded before linking; `selectOptimalRoute` can select the 9router route despite that account’s known exhaustion.
   GOAL: AC-AI-171-02 / BR-ROUTING-02 requires shared-account exhaustion to govern both pathways, including telemetry from excluded candidates.
   VERIFY: Uncommitted offline check `shared_exhaustion_blocks_both_pathways`: supply those adapters and assert selection returns BLOCKED; paste command and result in the PR body.

3. **P1 / AC/spec match: recognized provider aliases split shared quota**

   WHERE: tools/ai-brain/candidate-adapters.js:255 (load9RouterCandidates).
   WRONG: A connection with `provider: 'ag'` matches catalog model `ag/gemini-x`, but its identity retains provider `ag`. An AGY route for the same account uses `antigravity`; their scopes remain separate, so recording a 402 on the 9router route leaves AGY healthy.
   GOAL: AC-AI-171-02 / BR-ROUTING-02 requires canonical provider identity before quota linking; reuse the route-identity module’s existing provider resolver.
   VERIFY: Uncommitted offline check `provider_alias_shares_quota`: aggregate these routes, record the 402, and assert equal quota scopes and unhealthy AGY; paste command and result in the PR body.

4. **P1 / AC/spec match: unrelated direct accounts share an UNKNOWN quota scope**

   WHERE: tools/ai-brain/candidate-adapters.js:355 (loadDirectProviderCandidates).
   WRONG: Two direct sources with distinct IDs and credential environments, the same provider, and omitted `accountRef` both receive `quota::provider::UNKNOWN`. Recording quota exhaustion on source A consequently blocks source B.
   GOAL: The Work Item’s account-failure isolation guarantee requires unknown accounts to remain connection-scoped until observed evidence establishes sharing.
   VERIFY: Uncommitted offline check `unknown_direct_accounts_remain_isolated`: create those sources, record a 402 on A, and assert B remains healthy; paste command and result in the PR body.

5. **P1 / RBAC: author combos bypass reviewer independence**

   WHERE: tools/ai-brain/unified-selector.js:135 (evaluateAdmission).
   WRONG: An author combo has parent provider `author-combo` and an executable OpenAI branch. A reviewer candidate using OpenAI is admitted because independence compares against the author’s parent provider and never examines the author’s branches.
   GOAL: AC-AI-171-07 and the Work Item’s reviewer-domain independence requirement prohibit reviewers from sharing an executable author constituent’s provider.
   VERIFY: Uncommitted offline check `reviewer_rejects_author_combo_provider`: pass that author combo and reviewer route, and assert admission is false; paste command and result in the PR body.

6. **P1 / AC/spec match: blank unknown cost becomes free**

   WHERE: tools/ai-brain/unified-selector.js:236 (evaluateAdmission).
   WRONG: An unpriced catalog entry with `estimatedCostUsd: ''` is admitted under `costCeiling: 0`, because `Number('')` becomes zero.
   GOAL: AC-AI-171-12 / BR-ROUTING-09 requires unknown cost to be rejected without inventing a zero price.
   VERIFY: Uncommitted offline check `blank_cost_rejected_by_ceiling`: assert that this input is rejected as UNKNOWN_COST_REJECTED_BY_CEILING; paste command and result in the PR body.

7. **P1 / AC/spec match: ordinary JEV explanations can name identities**

   WHERE: tools/ai-brain/unified-selector.js:77 (advisoryNamesIdentity).
   WRONG: JEV returns `{choice: 'QUALITY_FIRST', confidence: 0.9, reason: 'Use openai'}`. The response is accepted despite explicitly naming a provider, because only selected top-level property names are inspected.
   GOAL: AC-AI-171-14 / BR-ROUTING-08 requires IDENTITY_PROHIBITED; use maintained Ajv validation with a closed weight-advice schema to prevent identity-bearing extra fields.
   VERIFY: Uncommitted offline check `jev_identity_in_explanation_rejected`: return this response with two eligible candidates and assert IDENTITY_PROHIBITED plus deterministic fallback; paste command and result in the PR body.

8. **P1 / audit/PII masking: JEV exception text escapes masking**

   WHERE: tools/ai-brain/unified-selector.js:438 (selectRoute).
   WRONG: A JEV client throws an authentication error containing a private account email. Selection returns that email verbatim inside `jev.reason`, exposing it in the decision diagnostic.
   GOAL: AGENTS.md prohibits PII in errors, and the Work Item requires private-email masking across decision metadata; reuse the route-identity redaction API `maskEmailsInString`.
   VERIFY: Uncommitted offline check `jev_exception_email_masked`: throw an error containing a synthetic email and assert serialized selection output excludes it; paste command and result in the PR body.

SIZE: 3729 lines, cut tools/ai-brain/test/task-ai-142-account-quota-scope.test.js

Follow-up (non-blocking): Isolate shared JEV caches by validation policy and bind combo account alternatives to the account that passed admission.
## Round 4 review (pl-task-ai-171-4, writer was agy05:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: f11c161b0214b278aa3bb30f3f0f882db632e54f

TASK-AI-171 should unify route identity, scoped health, admission and selection across 9router, direct providers and AGY, while masking private accounts.
This delta touches AC-AI-171-01–08: account/quota isolation, classification, reset/locks, model identity, combos and pathway aggregation.
It also touches AC-AI-171-09–10, BR-ROUTING-08–10 and the Work Item’s reviewer independence and sensitive-data requirements.

1. **PRIOR FINDINGS — P1 FIXED: PR contract placeholder**

   WHERE: PR #509 description (contract validation; no repository file:line applies).
   WRONG: FIXED — the supplied previous review explicitly closed the placeholder failure; this delta supplies no evidence of its reintroduction.
   GOAL: AGENTS.md requires a completed PR description with acceptance evidence.
   VERIFY: Previously supplied `contract=SUCCESS` resolved this finding; current exact-head CI entries contain no result values.

2. **PRIOR FINDINGS — P1 NOT FIXED / AC/spec match: shared exhaustion bypass**

   WHERE: tools/ai-brain/candidate-adapters-agy.js:226 (loadAgyPoolCandidates); tools/ai-brain/candidate-adapters.js:200 (aggregateAllCandidates).
   WRONG: An AGY lane has `remainingPercent: 0`, while a 9router candidate uses the same account and model family. The exhausted lane is discarded before quota linking, leaving the 9router route selectable.
   GOAL: AC-AI-171-02 / BR-ROUTING-02 requires known shared-account exhaustion to govern both pathways, including evidence from excluded candidates.
   VERIFY: Uncommitted check `shared_exhaustion_blocks_both_pathways`: supply these adapters and assert selection returns BLOCKED; record command + result in the PR body.

3. **PRIOR FINDINGS — P1 NOT FIXED / AC/spec match: provider aliases split quota**

   WHERE: tools/ai-brain/candidate-adapters.js:167 (load9RouterCandidates).
   WRONG: A connection with `provider: 'ag'` matches `ag/gemini-x` but retains provider `ag`; the same account’s AGY route uses `antigravity`. Recording a 402 on the 9router route leaves AGY healthy because linking and health keys use different providers.
   GOAL: AC-AI-171-02 / BR-ROUTING-02 requires canonical provider identity before quota linking; reuse the existing route-identity provider resolver.
   VERIFY: Uncommitted check `provider_alias_shares_quota`: aggregate these routes, record the 402, and assert equal quota scopes and unhealthy AGY; record command + result in the PR body.

4. **PRIOR FINDINGS — P1 NOT FIXED / AC/spec match: unrelated UNKNOWN accounts collide**

   WHERE: tools/ai-brain/candidate-adapters-direct.js:90 (loadDirectProviderCandidates).
   WRONG: Two direct sources have distinct IDs and credential environments, the same provider, and no `accountRef`. Both receive `quota::provider::UNKNOWN`; recording exhaustion on source A blocks source B.
   GOAL: AC-AI-171-01 and the Work Item’s account-isolation guarantee require unknown accounts to remain connection-scoped until evidence establishes sharing.
   VERIFY: Uncommitted check `unknown_direct_accounts_remain_isolated`: record a 402 on A and assert B remains healthy; record command + result in the PR body.

5. **PRIOR FINDINGS — P1 NOT FIXED / RBAC: author combo bypasses independence**

   WHERE: tools/ai-brain/unified-selector-admission.js:59 (evaluateAdmission).
   WRONG: An author combo has parent provider `author-combo` and an executable OpenAI branch. An OpenAI reviewer is admitted because comparison examines the author’s parent provider, not its constituent providers.
   GOAL: AC-AI-171-07 and the Work Item’s reviewer-domain independence requirement prohibit sharing an executable author constituent’s provider.
   VERIFY: Uncommitted check `reviewer_rejects_author_combo_provider`: supply this author combo and reviewer and assert admission is false; record command + result in the PR body.

6. **PRIOR FINDINGS — P1 NOT FIXED / AC/spec match: blank cost becomes free**

   WHERE: tools/ai-brain/unified-selector-admission.js:159 (evaluateAdmission).
   WRONG: A candidate with `estimatedCostUsd: ''` is admitted under `costCeiling: 0` because `Number('')` produces zero.
   GOAL: BR-ROUTING-09 requires unknown cost to be rejected without inventing a zero price.
   VERIFY: Uncommitted check `blank_cost_rejected_by_ceiling`: assert rejection with UNKNOWN_COST_REJECTED_BY_CEILING; record command + result in the PR body.

7. **PRIOR FINDINGS — P1 NOT FIXED / AC/spec match: JEV explanation names identity**

   WHERE: tools/ai-brain/unified-selector-admission.js:6 (advisoryNamesIdentity); tools/ai-brain/unified-selector-jev.js:95 (determineWeightProfile).
   WRONG: JEV returns `{choice: 'QUALITY_FIRST', confidence: 0.9, reason: 'Use openai'}`. The response is accepted because identity checking examines only selected top-level property names.
   GOAL: BR-ROUTING-08 requires IDENTITY_PROHIBITED and deterministic fallback; use maintained Ajv validation with a closed weight-advice schema.
   VERIFY: Uncommitted check `jev_identity_in_explanation_rejected`: return this response for two eligible candidates and assert IDENTITY_PROHIBITED plus fallback; record command + result in the PR body.

8. **PRIOR FINDINGS — P1 NOT FIXED / audit/PII masking: JEV exception leaks email**

   WHERE: tools/ai-brain/unified-selector-jev.js:125 (determineWeightProfile).
   WRONG: The JEV client throws an authentication error containing a private account email. Its message is interpolated verbatim into the returned `jev.reason`.
   GOAL: AGENTS.md prohibits PII in errors; the Work Item requires masked decision metadata. Reuse the existing route-identity redaction API `maskEmailsInString`.
   VERIFY: Uncommitted check `jev_exception_email_masked`: throw an error containing a synthetic email and assert serialized selection output excludes it; record command + result in the PR body.

9. **BLOCKING NEW FINDINGS — P1 / AC/spec match: stale AGY telemetry is admitted**

   WHERE: tools/ai-brain/candidate-adapters-agy.js:210 (loadAgyPoolCandidates).
   WRONG: On November 4, supply an AGY model with required capabilities and a matching quota row containing `remainingPercent: 40`, `known: true`, and `resetsAt: '2026-11-03T00:00:00Z'`. With an empty health registry, selection admits it without a fresh probe because the adapter ignores the elapsed reset.
   GOAL: AC-AI-171-05 / BR-ROUTING-05 requires expired reset telemetry to produce `requiresProbe: true` and prevent unverified admission.
   VERIFY: Uncommitted check `agy_expired_reset_requires_probe`: aggregate this lane and assert it cannot be selected until fresh telemetry arrives; record command + result in the PR body.

SIZE: 3188 lines, cut tools/ai-brain/test/task-ai-142-account-quota-scope.test.js

Follow-up (non-blocking): Isolate JEV caches by validation policy, bind combo alternatives to the admitted account, refresh stale test-count claims, and provide actual exact-head CI results.
## Round 5 review (pl-task-ai-171-5, writer was opencode:ninerouter/gcli/grok-4.7)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: fd82b1cef368bc4ff5e7ac6d10b73b04a4c89ce9

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126518272416) — failing log lines
```
 - tools/ai-brain/unified-selector-admission.js
 - tools/ai-brain/unified-selector-jev.js
 - tools/ai-brain/unified-selector.js
❌ PHÁT HIỆN 1 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/pr-body.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126519049629) — failing log lines
```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 6 review (pl-task-ai-171-6, writer was agy06:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 275a9e58dc99f04fd4097f7013ffca1402410609

1. **P1 — CI failing:** ai-brain-tests, application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126569416070) — failing log lines
```
  ✔ capabilities the operator declares are carried through (0.348621ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.320208ms)
✔ the add path writes only the entry the registry accepts (5.940657ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (0.598965ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (0.679595ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.389883ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.297255ms)
✔ the validator is the gate and names every failing field (2.315941ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.24132ms)
--
  ✔ the secret never appears in the registry file (1.247234ms)
  ✔ the secret is not stored in plaintext anywhere (1.197459ms)
  ✔ listAccounts reports presence but never the value (1.043429ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.633316ms)
  ✔ a secret for an unknown account is refused (0.273739ms)
  ✔ removing an account destroys its secret (1.033294ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (2.980904ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.291396ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.217275ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.30756ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.255342ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.309873ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.143965ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.156103ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.136494ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.203592ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.221101ms)
  ✔ audit flags missing source URL or checked_on as error (0.191857ms)
  ✔ audit flags model version mismatch with offerings as warning (0.161201ms)
  ✔ production benchmarks.json passes audit with zero errors (0.126329ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (0.928597ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.247834ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (2.085516ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.193469ms)
  ✔ summary.pass counts records with no findings (0.316714ms)
  ✔ the audit prints the operator-console state lines (0.219558ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (7.465685ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.027449ms)
--
  ✔ shared-quota defaults to unknown (0.66224ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.188672ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (9.522639ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.51235ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.601964ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.118792ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.272867ms)
✔ evidence store (26.090273ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (38.621862ms)
    ✔ login-required excluded (30.49183ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.744456ms)
```

### current-application (job 126569511704) — failing log lines
```
 - tools/ai-brain/test/task-ai-142-account-quota-scope.test.js
 - tools/ai-brain/test/task-ai-69.test.js
 - tools/ai-brain/test/unified-routing-offline.test.js
❌ PHÁT HIỆN 1 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/pr-body.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
 - tools/ai-brain/unified-selector-admission.js
 - tools/ai-brain/unified-selector-jev.js
 - tools/ai-brain/unified-selector.js
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126570526711) — failing log lines
```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 8 review (pl-task-ai-171-8, writer was opencode:ninerouter/kgw/dots-studio/dots-3-note-preview:free)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: a2bea13048ae3c3e8677fb35671745aee92c88a7

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126752143192) — failing log lines
```
Đã phát hiện và quét 21 tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:
 - .oc/pr-body.md
 - config/route-identity.json
❌ PHÁT HIỆN 1 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/pr-body.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
--
 - tools/ai-brain/unified-selector-admission.js
 - tools/ai-brain/unified-selector-jev.js
 - tools/ai-brain/unified-selector.js
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126753246519) — failing log lines
```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```
