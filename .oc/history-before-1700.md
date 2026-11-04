
## Round 8 review (pl-task-ai-160-8, writer was agy01:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 916b67331477f7646bdbc06c2b67207d0112e7b7

1. **P1 — CI failing:** ai-brain-tests, contract, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

## Round 7 review (pl-task-ai-160-7, writer was opencode:xkiro/qwen/qwen3.7-max:free)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: a885a9c0f5335e8945125c5639b54b50e00d59d8

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned data reads or writes are introduced.

2. **(b) — Authorization/RBAC: N/A.** No product endpoints or permission scopes change.

3. **(c) — Negative tests: N/A for tenant/RBAC cases.** CLI validation and failure tests are present. They omit the unsafe-target and credential cases identified below.

4. **(d) — NEW P1: The public-only target boundary is not enforced.** `scripts/ai/research.mjs:103-115` checks URL syntax, protocol and credential fields, but accepts private targets such as `http://127.0.0.1:8080/private` and `http://169.254.169.254/latest/meta-data/`, then forwards them to the selected backend. This contradicts the Work Item’s public-only boundary, exclusion of private research and AC-AI-160-02 unsafe-target refusal. Enforce public-target validation, including private-address and redirect handling, and add rejection tests. Backend refusal alone does not establish the wrapper’s promised boundary.

5. **(e) — Integer VND: N/A.** No monetary calculations change.

6. **(f) — External-effect idempotency/reconciliation: N/A.** No external mutations are introduced. Child calls have a timeout, and failures do not trigger automatic retries.

7. **(g) — NEW P1: Credential-bearing inputs can reach research services, and some structured secrets remain unmasked.** `scripts/ai/research.mjs:96-113` scans search queries only for URLs containing `://`. Consequently, `web search 'docs.example.com?token=private-input'` bypasses credential validation and forwards the token at line 115; output redaction occurs only afterward. Separately, `passwd` and `access_key` are absent from the sensitive-field matcher at line 21 and textual matcher at lines 158–161: a URL containing either parameter passes validation, and an upstream structured field such as `{"access_key":"private-input"}` survives redaction unless its value happens to match an inherited environment value. Reject credential-bearing URL forms consistently before launch and extend masking and negative tests. These gaps violate AI-160-R02/R04.

8. **(h) — UI states: N/A.** No UI changes.

9. **(i) — Previous P1, failing CI: FIXED.** `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv:270` assigns TASK-AI-160 delivery order `273`, avoiding the existing `272`. The supplied exact-head evidence confirms `ai-brain-tests`, `contract` and `validate` are now `SUCCESS` at the reviewed SHA. No previous P0/P1 remains open.

10. **Phase 2 — P2: Duplicate budget validation escapes the selected output limit.** `scripts/ai/research.mjs:50-59` can throw before the catch that attaches `maxChars` at lines 116–118. For `web search docs --max-chars 3 --max-chars 4`, the duplicate-option error therefore reaches line 196 without the selected budget and uses the default 20,000-character refusal budget. Move budget parsing inside the protected block and test duplicate/malformed options following a valid small budget.

New blocking findings: **4 and 7**. No additional P0/P1 identified in the supplied delta.
## Round 8 review (pl-task-ai-160-8, writer was agy04:gemini-3.8-flash-high)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: c4ed2e7c41072441f7d1f770faa0ddc382339b5b

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned reads or writes are introduced.

2. **(b) — Authorization/RBAC: N/A.** No product endpoints or permission scopes change.

3. **(c) — Negative tests:** Tenant/RBAC cases are N/A. CLI refusal tests cover the previously reported literal addresses and credential parameters, but omit DNS resolution, actual HTTP redirects and the credential-fragment bypass below.

4. **(d) — P1: Previous finding #4 NOT FIXED; public-only enforcement remains incomplete.** `scripts/ai/research.mjs:99` checks the hostname’s spelling; lines 104–133 inspect URL-looking query/path values. Neither establishes the resolved destination nor checks actual HTTP redirect hops. A hostname resolving to a private address, or a public URL returning `Location: http://169.254.169.254/latest/meta-data/`, passes validation. Inspecting redirect-shaped input parameters does not enforce redirect safety. AC-AI-160-02 and the public-only boundary remain unmet. Enforce destination restrictions through DNS resolution and every redirect at the fetching boundary, with corresponding negative tests.

5. **(e) — Integer VND: N/A.** No monetary calculations change.

6. **(f) — External-effect idempotency/reconciliation: N/A.** No external mutations are introduced. Child calls have a timeout and no automatic retry.

7. **(g) — P1: Previous finding #7 NOT FIXED completely; NEW credential-fragment bypass.** The reported schemeless query and `passwd`/`access_key` cases are repaired by `scripts/ai/research.mjs:22–23`, the search-token validation and extended redaction. However, `web search 'https://docs.example.com/#access_token=private-input'` still passes: line 98 examines only query parameters, and lines 104–133 never examine the fragment. The original target is forwarded at line 212, exposing the credential to the research backend before output masking. Reject credential-bearing fragments before launch and add a refusal/marker test. This remains an AI-160-R02 boundary violation.

8. **(h) — UI states: N/A.** No UI changes.

9. **(i) — Prior-review disposition:**
   - **#4: NOT FIXED**, as explained in finding 4.
   - **#7: NOT FIXED completely**, as explained in finding 7; the original concrete examples are fixed.
   - **#10, P2 duplicate budget validation: FIXED.** `scripts/ai/research.mjs:139–149` now parses budgets inside the protected block, and lines 213–215 preserve the selected budget on error. Regression cases cover duplicate and malformed options after a small budget.
   - **Earlier delivery-order collision: FIXED** at `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv:270`, using `273`. The supplied current-head CI entries have empty result fields, so they do not establish successful CI.

10. **Phase 2 — NEW P2: Ordinary questions are rejected as unsafe URLs.** `scripts/ai/research.mjs:192` treats every token containing `?` as a URL. Consequently, `web search 'How does pagination work?'` validates `https://work?`, which the single-label-host rule at line 69 rejects. Recognize URL-shaped tokens without interpreting ordinary question punctuation as a destination, and add a normal-question search test.

Open blocking findings: **4 and 7**. No additional P0/P1 identified in the supplied delta.
## Round 10 review (pl-task-ai-160-10, writer was agy02:gemini-3.8-flash-low)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 8db478367802fa4d8509299db5f0940de4ed1e79

1. **P1 — CI failing:** ai-brain-tests, contract, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125739401974) — failing log lines
```
  ✔ capabilities the operator declares are carried through (0.473448ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.405075ms)
✔ the add path writes only the entry the registry accepts (7.289414ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (0.914977ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.566171ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.873456ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.292116ms)
✔ the validator is the gate and names every failing field (4.020759ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (3.426411ms)
--
  ✔ the secret never appears in the registry file (0.681048ms)
  ✔ the secret is not stored in plaintext anywhere (0.665515ms)
  ✔ listAccounts reports presence but never the value (0.64184ms)
  ✔ a wrong key fails loudly instead of returning garbage (1.021527ms)
  ✔ a secret for an unknown account is refused (0.246889ms)
  ✔ removing an account destroys its secret (0.936068ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (2.932723ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.331074ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.332817ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.444114ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.664033ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.321201ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.155412ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.155432ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.138117ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.933324ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.240429ms)
  ✔ audit flags missing source URL or checked_on as error (0.213439ms)
  ✔ audit flags model version mismatch with offerings as warning (0.178927ms)
  ✔ production benchmarks.json passes audit with zero errors (0.143925ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.193483ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.540081ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.158932ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.150635ms)
  ✔ summary.pass counts records with no findings (0.208903ms)
  ✔ the audit prints the operator-console state lines (0.153129ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (4.833884ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.10143ms)
--
  ✔ shared-quota defaults to unknown (1.208205ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.162002ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (8.463008ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.581934ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.479001ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.071902ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.256102ms)
✔ evidence store (24.468988ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (27.374521ms)
    ✔ login-required excluded (25.268653ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.509206ms)
```

### contract (job 125739402734) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### validate (job 125739401941) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

## Round 11 review (pl-task-ai-160-11, writer was agy04:gemini-3.8-flash-low)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: b8b23f5e49b8c8daa68351b90fca36bf59bd9ebb

1. **P1 — CI failing:** contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 125752603750) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```

## Round 15 review (pl-task-ai-160-15, writer was agy02:gemini-3.8-flash-medium)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: b8b23f5e49b8c8daa68351b90fca36bf59bd9ebb

1. **P1 — CI failing:** contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 125752603750) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```
