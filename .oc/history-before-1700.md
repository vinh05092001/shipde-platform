## Round 24 review (pl-task-ai-158-24, writer was codex-ar:gpt-6-astra)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: c3cfbe89323198fc799f51533b449a4c63909b54

1. **P1 — CI failing:** ai-brain-tests, contract, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125657026650) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.597519ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.557284ms)
✔ the add path writes only the entry the registry accepts (9.038762ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (1.114446ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (0.818113ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (1.176194ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.339516ms)
✔ the validator is the gate and names every failing field (3.913301ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.361959ms)
--
  ✔ the secret never appears in the registry file (1.151579ms)
  ✔ the secret is not stored in plaintext anywhere (1.410213ms)
  ✔ listAccounts reports presence but never the value (1.777121ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.947236ms)
  ✔ a secret for an unknown account is refused (0.388157ms)
  ✔ removing an account destroys its secret (1.149584ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.400489ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.440305ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.260388ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.414237ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.350427ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.417443ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.219211ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.223839ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.20795ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.153421ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.289383ms)
  ✔ audit flags missing source URL or checked_on as error (0.253956ms)
  ✔ audit flags model version mismatch with offerings as warning (0.23997ms)
  ✔ production benchmarks.json passes audit with zero errors (0.214813ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.305047ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (2.007272ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.984009ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.245751ms)
  ✔ summary.pass counts records with no findings (0.4003ms)
  ✔ the audit prints the operator-console state lines (0.337383ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (7.988235ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.502552ms)
--
  ✔ shared-quota defaults to unknown (0.684373ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.271328ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (12.424261ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (2.494587ms)
  ✔ cross-account: success on one account is not inherited as verified by another (2.463177ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.604568ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.365084ms)
✔ evidence store (34.669601ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (48.469791ms)
    ✔ login-required excluded (39.196948ms)
    ✔ the adapter writes the expected job.json and maps each result state (2.072705ms)
```

### contract (job 125657026411) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### validate (job 125657026392) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

## Round 26 review (pl-task-ai-158-26, writer was agy03:gemini-3.8-flash-low)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 53f3059d8d78f94bc93e52a790e4af000d145874

1. **P1 — CI failing:** ai-brain-tests, contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125672741064) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.681048ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.687298ms)
✔ the add path writes only the entry the registry accepts (11.999302ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (2.199384ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.36541ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (1.368366ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.564949ms)
✔ the validator is the gate and names every failing field (6.223932ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (1.046933ms)
--
  ✔ the secret never appears in the registry file (1.485044ms)
  ✔ the secret is not stored in plaintext anywhere (1.152371ms)
  ✔ listAccounts reports presence but never the value (1.08819ms)
  ✔ a wrong key fails loudly instead of returning garbage (1.041263ms)
  ✔ a secret for an unknown account is refused (0.406553ms)
  ✔ removing an account destroys its secret (1.256867ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (3.090023ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.320251ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.231784ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.375594ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.352451ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.285496ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.148187ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.158037ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.199314ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (2.462728ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.193482ms)
  ✔ audit flags missing source URL or checked_on as error (0.181009ms)
  ✔ audit flags model version mismatch with offerings as warning (0.157415ms)
  ✔ production benchmarks.json passes audit with zero errors (0.179546ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (0.94401ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.701511ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.780639ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.241193ms)
  ✔ summary.pass counts records with no findings (0.300804ms)
  ✔ the audit prints the operator-console state lines (0.22938ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (6.671992ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.384832ms)
--
  ✔ shared-quota defaults to unknown (0.88499ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.252724ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (12.736774ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (2.627237ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.504482ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.9945ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.400882ms)
✔ evidence store (35.239743ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (57.691809ms)
    ✔ login-required excluded (40.850395ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.816246ms)
```

### contract (job 125672742633) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
- PR contains unchecked mandatory checklist items
##[error]Process completed with exit code 1.
```

## Round 27 review (pl-task-ai-158-27, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: b800e57b392ad7da106717b78aa95e697f112833

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned application reads or writes are introduced.

2. **(b) — Authorization/RBAC: N/A.** Local CLI; no endpoints or permission scopes change.

3. **(c) — Negative tests:** CLI validation, empty selections, token overflow, secret detection and environment-file exclusion are covered. Cross-tenant and forbidden-response tests are N/A. Missing coverage for findings #4 and #10.

4. **(d) — P2: A missing argument value can silently disable the requested token ceiling.** `scripts/ai/pack-context.mjs:54-64`: `--paths src/** --out --max-tokens 100` accepts `--max-tokens` as the output filename, ignores `100`, and runs without a token budget. This violates AC-AI-158-02’s requirement to reject missing/invalid arguments. Validate flag values and reject unexpected positional arguments; add this negative case.

5. **(e) — Integer VND: N/A.** No monetary behavior changes.

6. **(f) — External-effect idempotency/timeouts/reconciliation: N/A.** No external business effects are introduced.

7. **(g) — Audit and sensitive-data masking: N/A for audit requirements.** No additional masking finding in the supplied delta: child output is suppressed, security checking is forced on, and negative tests cover secret leakage and `.env*` exclusion.

8. **(h) — UI states: N/A.** No UI changes.

9. **(i) — Previous P1: FIXED, based on supplied exact-head CI evidence.** Both `ai-brain-tests` and `contract` now report `SUCCESS` at the reviewed SHA. Dependency snapshots include the missing entry at `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md:124`, `:169` and `:199`. The PR-body repair is supported by the supplied successful contract check; the body itself was not provided for inspection. No previous P0 remains in the supplied report.

10. **Phase 2 — NEW P1: Failure cleanup can delete an existing user file before producing any output.** `scripts/ai/pack-context.mjs:201-211` resolves an unrestricted `--out` path and unconditionally removes it after any `runRepomix` failure; `:177-179` performs the deletion. For example, selecting an existing file as output while repomix is missing deletes that file even though execution failed before writing a pack. Reject unsafe existing destinations and input/output collisions, and restrict cleanup to temporary output owned by this invocation. Add a regression proving an existing file survives a launch failure.

11. **Open sweep complete.** No additional P0/P1 findings identified in the supplied delta. Review used only the provided material; no commands or files were accessed.

## Round 28 review (pl-task-ai-158-28, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 58738e10f47255771cba8630dc54e53ad334e390

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned application reads or writes change.

2. **(b) — Authorization/RBAC: N/A.** Local CLI; no endpoints or permission scopes change.

3. **(c) — Negative tests:** Validation, empty selections, token overflow, secret detection, environment-file exclusion, unsafe destinations and preservation after launch/budget failures are covered. **Missing regression coverage for the destination-alias bypass in finding #10.** Cross-tenant 403/404 and forbidden-response tests are N/A.

4. **(d) — Acceptance matrix/specifications:** No additional functional mismatch identified against the supplied acceptance matrix. **P2 — Contradictory handoff evidence:** `docs/product-spec/work-items/TASK-AI-158.md:143-144` still reports failing CI, an out-of-scope dependency snapshot repair and an unavailable previous report. These statements conflict with the supplied exact-head CI, expanded allowed paths and subsequent review record. Mark historical evidence with its SHA and record the current results clearly.

5. **(e) — Integer VND: N/A.** No monetary behavior changes.

6. **(f) — External-effect idempotency/timeouts/reconciliation: N/A.** No external business effects change.

7. **(g) — Audit and sensitive-data masking:** Audit requirements are N/A. No additional masking finding: security checking remains forced on, child output is captured, and tests cover secret leakage and `.env*` exclusion.

8. **(h) — UI states: N/A.** No UI changes.

9. **(i) — Previous-review findings:**
   - **Previous P2 #4 — FIXED.** Missing flag values are rejected at `scripts/ai/pack-context.mjs:55-57`, `:70-72` and `:82-84`; unexpected positional arguments are rejected at `:93-94`. The reported argument sequence has a regression test.
   - **Previous P1 #10 — FIXED for the reported launch/failure-cleanup defect.** Repomix writes into invocation-owned temporary output at `scripts/ai/pack-context.mjs:210-213`; failure cleanup removes only that directory at `:238-239`. Destination publication occurs after successful packing at `:310-315`. Tests verify existing-file preservation after missing-binary and budget failures. Finding #10 below identifies a separate remaining overwrite path.
   - **Earlier CI P1 — remains FIXED according to supplied evidence.** Dependency snapshots contain the additions at `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md:124`, `:169` and `:199`; supplied `ai-brain-tests` and `contract` results are `SUCCESS` at this SHA. The PR body itself was not supplied.
   - No previous open P0 was supplied.

10. **Phase 2 — NEW P1: Destination aliases bypass collision protection and can overwrite selected source files.** `scripts/ai/pack-context.mjs:129-148` follows symlinks when checking file type but compares only lexical paths for containment and input collisions. `:313` then follows the destination symlink when copying. For example, with `context.xml` symlinked to `src/hello.js`, `--paths "src/**" --out context.xml` passes validation and overwrites the selected source with XML. A symlinked parent directory also bypasses repository containment. Resolve existing ancestors and destination aliases before validation, reject unsafe links or compare actual file identities, and add preservation regressions.

11. **Phase 2 — NEW P2: Publication failure can destroy an existing destination.** `scripts/ai/pack-context.mjs:312-315` copies directly over the existing output. An error after opening/truncating the destination can lose its previous contents; temporary-directory cleanup cannot restore them. Publish through a temporary sibling file and atomic replacement, with a regression proving failed publication preserves the original.

12. **Open sweep complete.** New blocking findings: **one P1 (#10); no P0**. Review used only the supplied delta and evidence; no commands ran and no files were accessed.

## Round 30 review (pl-task-ai-158-30, writer was agy01:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: ed1595f5c1ef3510b6082215bae08442aef9f256

1. **P1 — CI failing:** ai-brain-tests, contract, validate. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125752569010) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.665569ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.535786ms)
✔ the add path writes only the entry the registry accepts (11.416985ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (1.722131ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.025654ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.57541ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.593714ms)
✔ the validator is the gate and names every failing field (4.461543ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.386535ms)
--
  ✔ the secret never appears in the registry file (0.878689ms)
  ✔ the secret is not stored in plaintext anywhere (1.024002ms)
  ✔ listAccounts reports presence but never the value (1.776013ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.723337ms)
  ✔ a secret for an unknown account is refused (0.26645ms)
  ✔ removing an account destroys its secret (1.04468ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.113239ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.481113ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.410411ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.393969ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.503945ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.457188ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.210415ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.215113ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.219432ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.47473ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.291467ms)
  ✔ audit flags missing source URL or checked_on as error (0.292659ms)
  ✔ audit flags model version mismatch with offerings as warning (0.252765ms)
  ✔ production benchmarks.json passes audit with zero errors (0.210165ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.564576ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (1.876422ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (2.193076ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.276439ms)
  ✔ summary.pass counts records with no findings (0.387297ms)
  ✔ the audit prints the operator-console state lines (0.314079ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (7.952403ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.747356ms)
--
  ✔ shared-quota defaults to unknown (1.056332ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.234981ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (13.302664ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (2.628623ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.795369ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.41736ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.386025ms)
✔ evidence store (36.807352ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (42.49736ms)
    ✔ login-required excluded (37.650895ms)
    ✔ the adapter writes the expected job.json and maps each result state (2.005934ms)
```

### contract (job 125752568989) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```

### validate (job 125752569023) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Documentation validation failed:
- feature-register-delivery-order-invalid
##[error]Process completed with exit code 1.
```
