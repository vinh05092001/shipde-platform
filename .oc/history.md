## Round 103 review (pl-task-ai-166-103, writer was opencode:ninerouter/oc/deepseek-v4.1-flash-free)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: a905cd69ed392dee45a4bee169fce7bae6111ab2

Goal: TASK-AI-166 refreshes live model, benchmark and quota evidence and restores bounded unattended coordination with publication gates and independent exact-SHA review.
Touched acceptance rows: AC-166-01–03 refresh/discovery/freshness; AC-166-04–08 writer/publication/review/quota/fan-out; AC-166-09–10 metrics/daily scheduling/handoff.

1. PRIOR FINDINGS — P1 FIXED: failing CI gates
   WHERE: tools/ai-brain/test/discovery.test.js:1008 (append-only ledger regression)
   WRONG: Previous head had failing ai-brain-tests and contract gates; the supplied exact-head results now show both SUCCESS. PR-body repair lines were not supplied.
   GOAL: AC-166-10 and AGENTS.md require valid handoff evidence and green CI.
   VERIFY: Supplied statusCheckRollup reports ai-brain-tests=SUCCESS and contract=SUCCESS at the reviewed SHA; no additional committed test is requested.

2. BLOCKING NEW FINDING — P1: AC/spec match
   WHERE: tools/ai-brain/cli.js:2100 (dispatchCommand)
   WRONG: An operator host sets AGY_POOL_RUNS_DIR to its real scheduled-lane directory. With catalogue evidence older than 48 hours and an otherwise eligible live candidate, dispatch --dry-run skips the freshness gate because that environment variable exists, permitting selection from stale live evidence.
   GOAL: AC-166-03 / BR-166-03 require live dispatch dry-runs to refuse STALE_CATALOGUE. A runtime-directory setting must not establish that candidates are fixture-injected.
   VERIFY: Run an uncommitted check named “live pool directory cannot bypass stale catalogue”, asserting exitCode === 1 and warning.code === "STALE_CATALOGUE" with AGY_POOL_RUNS_DIR configured; record command and result in the PR body.

3. BLOCKING NEW FINDING — P1: AC/spec match
   WHERE: tools/ai-brain/catalogue-refresh.js:112 (refreshCatalogue)
   WRONG: The coordinator’s daily refresh and an operator’s pnpm ai:refresh-catalogue overlap, both capturing the same expired lastSuccessfulAt. The coordinator succeeds and publishes fresh evidence; the operator’s attempt subsequently fails and restores its captured expired timestamp. Dispatch then reports STALE_CATALOGUE despite the completed successful refresh. No shared refresh lock prevents this ordinary overlap.
   GOAL: AC-166-09 / BR-166-10 require single-flight daily refresh; BR-166-01 requires failed attempts to preserve the latest good evidence. Coordinate both entry points through the same exclusive refresh boundary.
   VERIFY: Run an uncommitted check named “overlapping refresh cannot erase latest success”, controlling completion order and asserting either refusal of the second attempt or preservation of the successful timestamp; record command and result in the PR body.

SIZE: 5140 lines, cut duplicate/finding-check blocks in tools/ai-brain/test/task-ai-166-review.test.js and tools/ai-brain/test/task-ai-166-runtime.test.js; retain required AC coverage and use Slice B/C for deferred scope.

Follow-up (non-blocking): Complete the recorded AC-166-01/02 host live evidence and update the stale author-handoff text.

## Round 104 review (pl-task-ai-166-104, writer was agy05:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: a4fe95201990ad849f13fa363d34ad15d58fe0ac

1. **P1 — CI failing:** application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### current-application (job 126528930573) — failing log lines

```
================================================================
✨ SHIP DỄ — BỘ KIỂM TOÁN ĐỊNH DẠNG TĂNG TRƯỞNG (INCREMENTAL PRETTIER CHECK)
================================================================
❌ PHÁT HIỆN 8 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - tools/ai-brain/coordinator-metrics.js
 - tools/ai-brain/coordinator-quota-state.js
--
 - tools/ai-brain/test/task-ai-166-refresh.test.js
 - tools/ai-brain/test/task-ai-166-review.test.js
 - tools/ai-brain/test/task-ai-166-runtime.test.js
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126529775584) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 105 review (pl-task-ai-166-105, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: b04c5e2c9b1be8d34bae56ee878d59ea05794a77

1. **P1 — CI failing:** ai-brain-tests. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126606002178) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.561136ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.506014ms)
✔ the add path writes only the entry the registry accepts (9.445757ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (0.843293ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.041903ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.524838ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.395748ms)
✔ the validator is the gate and names every failing field (3.303782ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.339403ms)
--
  ✔ the secret never appears in the registry file (1.804406ms)
  ✔ the secret is not stored in plaintext anywhere (1.610845ms)
  ✔ listAccounts reports presence but never the value (1.295276ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.917691ms)
  ✔ a secret for an unknown account is refused (1.047173ms)
  ✔ removing an account destroys its secret (1.517149ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.384869ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.405476ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.507126ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.4288ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.746652ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.366263ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.183102ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.258151ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.19874ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.63537ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.276746ms)
  ✔ audit flags missing source URL or checked_on as error (0.292255ms)
  ✔ audit flags model version mismatch with offerings as warning (0.235239ms)
  ✔ production benchmarks.json passes audit with zero errors (0.185426ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.510988ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (2.20925ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (1.572052ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.228847ms)
  ✔ summary.pass counts records with no findings (0.390569ms)
  ✔ the audit prints the operator-console state lines (0.27859ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (7.253238ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.376002ms)
--
  ✔ shared-quota defaults to unknown (0.806724ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.200664ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (12.826323ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (2.547912ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.999019ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.505368ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.37538ms)
✔ evidence store (33.415294ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (44.844441ms)
    ✔ login-required excluded (42.955458ms)
    ✔ the adapter writes the expected job.json and maps each result state (5.295537ms)
```

## Round 116 review (pl-task-ai-166-116, writer was agy06:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 26bb377818ab0eba154c19add2ef701e5bdf8543

1. **P1 — CI failing:** application-gate, contract, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 126858705865) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```

### current-application (job 126858805165) — failing log lines

```
================================================================
Đã phát hiện và quét 52 tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:
 - .oc/check-syntax.json
❌ PHÁT HIỆN 5 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/context-pack.md
 - .oc/context-pack.md.manifest.json
--
 - tools/ai-brain/test/task-ai-166-refresh.test.js
 - tools/ai-brain/test/task-ai-166-review.test.js
 - tools/ai-brain/test/task-ai-166-runtime.test.js
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126859940356) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 121 review (pl-task-ai-166-121, writer was opencode:ninerouter/kgw/stealth/glyph-cluster)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 5cc02ba6dd873e8c26faff880cc9ed75263cdd4f

1. **P1 — CI failing:** application-gate, contract, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 126934018747) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```

### current-application (job 126934100056) — failing log lines
```
 - tools/ai-brain/test/task-ai-166-refresh.test.js
 - tools/ai-brain/test/task-ai-166-review.test.js
 - tools/ai-brain/test/task-ai-166-runtime.test.js
❌ PHÁT HIỆN 4 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/context-pack.md
 - .oc/context-pack.md.manifest.json
 - .oc/pack-spec.json
 - .oc/task.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126935116064) — failing log lines
```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 122 review (pl-task-ai-166-122, writer was opencode:ninerouter/kgw/dots-studio/dots-3-note-preview:free)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: e6d5db2cfbb943240d98134fd08e784d78383a45

1. **P1 — CI failing:** application-gate, contract, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 126952446340) — failing log lines
```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.16/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.16/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.16/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
##[error]Process completed with exit code 1.
```

### current-application (job 126952514234) — failing log lines
```
 - tools/ai-brain/test/task-ai-166-refresh.test.js
 - tools/ai-brain/test/task-ai-166-review.test.js
 - tools/ai-brain/test/task-ai-166-runtime.test.js
❌ PHÁT HIỆN 5 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - .oc/context-pack.md
 - .oc/context-pack.md.manifest.json
--
 - .oc/pr-body.md
 - .oc/task.md
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 126953434495) — failing log lines
```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```
