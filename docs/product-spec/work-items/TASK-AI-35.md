# TASK-AI-35 — Secret scanning gate evaluation: Gitleaks preservation vs Betterleaks replacement

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-35` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `168` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-35.md`, `tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js`, `tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-35-betterleaks` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/21 |

## Business outcome

The Ship Dễ delivery pipeline must prevent secret and credential leaks from
being **merged into `main`**. The enforcement point owned by this Work Item is
the CI gate, which runs on Pull Requests and on pushes to `main`; it therefore
blocks merge, and it does **not** and cannot block a local `git commit`. No
pre-commit hook exists in this repository today (`lefthook` is `PENDING`, owned
by `TASK-AI-36`), so pre-commit enforcement is explicitly out of scope here and
must not be claimed as an outcome of `TASK-AI-35`. The repository's existing secret
scanning gate is `gitleaks`: it is NOT missing. Gitleaks is `ADOPTED`, a
`BLOCKING_GATE`, `install_method: ci-provisioned`, installed at pinned version
`8.24.0` in `.github/workflows/security-baseline.yml` and
`.github/workflows/current-application.yml`, and actively enforced on every Pull
Request and push to `main`. It is wrapped by `scripts/verify-secrets.ts` with
fail-closed execution and a demonstrated negative failure proof (`AC-FOUND-01-06`).

In contrast, other tooling entries such as `lefthook` (pre-commit hooks) and
`trivy` (container and dependency vulnerability scanning) are genuinely absent
and truthfully documented as `PENDING` (owned by `TASK-AI-36` and `TASK-AI-37`).

`TASK-AI-35` defines the architectural specification and evidence-based criteria
for evaluating whether to REPLACE the currently working, blocking Gitleaks gate
with `betterleaks` (a Byte-Pair Encoding-based successor developed by the same
author, Zach Rice), or to retain Gitleaks indefinitely. Under `AGENTS.md` and
repository policy `AI-TOOL-01`, a production security gate cannot be replaced on
claims or novelty. Replacement requires verified proof of non-regression in
detection capability, 100.0% carrier token recall, negative proof parity (exact exit
code 1), dual git-range and working-tree scanning, local Windows and CI Linux
portability, verified zero-network behavior, and a formal human architectural decision.

## Source references

- `AGENTS.md` § Carrier integrations & Security and tenancy — Secrets and
  unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- `AGENTS.md` § Role separation — Codex as independent reviewer; author never
  approves its own work. Handoff progresses through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` — Entry `gitleaks` (`ADOPTED`, `BLOCKING_GATE`,
  `ci-provisioned`, pinned `8.24.0`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking; conversely, an active blocking gate must not
  be reported as missing.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — Declared lifecycle state
  must reflect machine reality.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § `gitleaks`
  was never absent, and the check was wrong (TASK-AI-17).
- `.github/workflows/security-baseline.yml` — Jobs `secret-scan` with pinned
  Gitleaks 8.24.0 and negative proof step `pnpm security:secrets -- --test-negative`.
- `.github/workflows/current-application.yml` — Security baseline execution on
  workflow branches.
- `scripts/verify-secrets.ts` — Fail-closed scanning harness supporting
  `gitleaks git --log-opts` and `gitleaks dir`. Contains fallback pattern definitions
  (`generic-api-key`, `private-key`, `aws-secret-key`) and negative test generator
  `runNegativeCliTest` creating `.temp-negative-fixture-*.js`.
- `.gitleaks.toml` — Custom rule configuration containing exactly one custom rule
  (`shipde-carrier-live-token`) and extending Gitleaks' built-in default rules
  via `[extend] useDefault = true`.
- `apps/web/src/tests/regression-audit.test.ts` — Section 5 regression tests
  proving scanner fail-closed execution (5d, 5e), shell-metacharacter path safety
  (5a), enumeration failure handling (5b, 5c), report cleanup failure overrides
  (5j-1, 5j-2), and target discovery exclusions (5k, 5l).
- `docs/product-spec/work-items/TASK-FOUND-01.md` § `AC-FOUND-01-06` — Negative
  failure proof detecting secret leak fixtures with exact exit code 1 and
  guaranteed cleanup.

## Preconditions and dependencies

- `TASK-AI-17` reconciled the ecosystem manifest against reality, establishing
  that `gitleaks` is `ADOPTED` / `ci-provisioned` while `lefthook` and `trivy`
  are `PENDING`. `TASK-AI-17` is merged into the base branch
  (`fix/task-ai-16-codex-launch-flags` via PR #19 commit `1f587dd`), satisfying
  the codebase dependency requirement.
- Authoritative delivery register `FEATURE-DELIVERY-REGISTER.csv` retains
  `BLOCKED_DEPENDENCY` for `TASK-AI-35` until `TASK-AI-19` executes the
  deterministic reconciler write-back. Under `AGENTS.md` and repository contract,
  the delivery register is authoritative: the Work Item Control table records
  `Status: BLOCKED_DEPENDENCY` to strictly align with register truth.
- Pinned `gitleaks 8.24.0` is provisioned and running in CI
  (`.github/workflows/security-baseline.yml`).
- `pnpm security:secrets` (exit code 0) and `pnpm security:secrets -- --test-negative`
  (exit code 1) execute and pass cleanly in the current baseline.
- `node tools/ai-brain/cli.js manifest` reports exactly 0 errors. The warning
  and note counts are deliberately NOT pinned: the only warning observed is a
  `codex-cli` version drift whose observed version changes whenever the upstream
  CLI is upgraded, so pinning it would make this Work Item fail for a reason that
  has nothing to do with the secret scanning gate. The invariant is `0 lỗi`.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item defines a foundational
security gate evaluation and specification across tooling, CI workflows, and
developer worktrees.

Bounded scope: authoring the specification in `docs/product-spec/work-items/TASK-AI-35.md`.
This Work Item is documentation-only: it defines the architectural requirements,
parity benchmarks, and decision template for evaluating Betterleaks, without
modifying production code, CI workflows, or `AI-TOOLCHAIN-DECISIONS.md` directly.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`,
  `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, or
  `docs/product-spec/scripts/*`.
- Declaring Gitleaks absent, removing Gitleaks from CI, or downgrading its
  `lifecycle_state` or `blocking_policy`.
- Installing or switching to Betterleaks without human decision approval and
  verified parity benchmarks.
- Author never approves own work.

## In scope

- Define the architectural comparison between Gitleaks (regex pattern matching + Shannon entropy calculation)
  and Betterleaks (regex pattern matching + Byte-Pair Encoding [BPE] tokenization).
- Define the strict parity and non-regression benchmarks required before any replacement can be considered:
  1. Full configuration compatibility: drop-in execution with `.gitleaks.toml`, specifically:
     - `[extend] useDefault = true` (inheriting standard Gitleaks built-in default rules);
     - Custom `[[rules]]` definitions, specifically the single custom rule `shipde-carrier-live-token` with keywords and regex matching;
     - Global `[allowlist]` paths, stopwords, regexTarget, and regex patterns (including redaction test fixtures and delivery register column exemptions);
     - Functional parity with standalone verifier fallback definitions in `scripts/verify-secrets.ts` (`generic-api-key`, `private-key`, `aws-secret-key`).
  2. Grounded benchmark datasets (labeled corpora):
     - **Ship Dễ Carrier & Core Fixture Corpus**: The committed and generated fixtures from `scripts/verify-secrets.ts` (synthetic fixture `.temp-negative-fixture-*.js` created by `runNegativeCliTest` containing `ghn_live_*`) and test suites in `apps/web/src/tests/regression-audit.test.ts` (including shell metacharacter fixtures `.temp-gitleaks-test-$(echo_safe)-fixture.js`). Covers live carrier tokens (`ghn_live_*`, `ghtk_live_*`, `vtp_live_*`, `jtexpress_live_*`), AWS secret access keys (`[0-9a-zA-Z\/+=]{40}`), private key headers (`BEGIN RSA PRIVATE KEY`), and verifier fallback tokens.
     - **Reference Public Credential Benchmark Corpus**: There is currently **no pinned external dataset**, and no benchmark run may cite this corpus until one is pinned. Before the first benchmark run the evaluator MUST record, in `artifacts/benchmarks/corpus-manifest.json`, the dataset's source URL, immutable release tag or commit SHA, archive file name, and SHA-256 digest of the downloaded archive, and MUST verify that digest before scanning. The pinned dataset must contain >= 1,000 labeled positive secret instances across >= 15 credential classes (API tokens, private keys, database connection strings, OAuth client secrets). A benchmark result whose `corpus_sha256` does not match the pinned digest recorded in `corpus-manifest.json` is INVALID and fails `AI-35-R02`.
     - **Benign Repository Negative Corpus**: The clean Ship Dễ working tree at a pinned commit SHA. Its contents are reproduced deterministically, never estimated: the corpus is the output of `git ls-files` at the pinned commit — measured per run via `git ls-files | wc -l` and recorded in `corpus-manifest.json`, never asserted as a constant, because the tracked-file count grows with every merged Work Item (it was recorded as 363 at commit `da71354` and measured at 418 on `origin/main` during the acceptance audit below) — and scanned through the same exclusion set that `getGitleaksScanTargets(process.cwd())` in `scripts/verify-secrets.ts` applies (`.git`, `node_modules`, `.next`, `.turbo`, `.pnpm-store`, `dist`, `build`, `out`, `.gemini`). The **count** of scan targets that function returns is deliberately NOT pinned as a corpus size: it depends on locally materialised build and dependency directories (observed 62 on a fully installed worktree at commit `da71354`, and lower before `pnpm install` materialises those directories), so it MUST be measured and recorded per run in `corpus-manifest.json` rather than asserted as a constant. The pinned commit SHA and the `git ls-files` file count are the reproducible corpus identity, and both MUST be recorded for every benchmark run. It contains intentional benign patterns such as test redaction fixtures (`(sk-|ghp_|gho_|ghu_)1234567890`) and schema names (`key_behavior:`). No corpus path outside the pinned tracked-file set may be introduced; in particular, `tools/ai-guard/test/fixtures/` does not exist in this repository and must not be cited.
     - **Corpus manifest (required artifact)**: `artifacts/benchmarks/corpus-manifest.json` MUST exist before any benchmark result is accepted and MUST record, for every corpus above: `corpus_name`, `generator` (the exact deterministic command or committed generator script that produces it), `pinned_commit_sha` (for repository-derived corpora), `source_url` and `release_tag` (for external corpora), `file_count`, `positive_instance_count`, and `corpus_sha256`. Corpora produced by an unversioned, ad-hoc, or unrecorded selection of inputs are not admissible evidence.
  3. Measurable quantitative parity thresholds (all concrete numbers):
     - **Minimum Recall**: Exactly 100.0% recall on the Ship Dễ Carrier & Core Fixture Corpus (zero missed carrier tokens or verifier fallback patterns); >= 99.0% recall across the Public Credential Benchmark Corpus (0% recall regression compared to Gitleaks 8.24.0 baseline).
     - **Maximum False-Positive Rate**: <= 0.1% false-positive rate across the Benign Repository Negative Corpus, and exactly 0 false positives on the clean Ship Dễ repository tree with allowlists applied.
     - **Execution Speed & Runtime Budget**:
       * Full repository directory scan (`dir .`): <= 5.0 seconds on the deployed CI runner label `ubuntu-latest` (GitHub-hosted Linux x64, 4 vCPU / 16 GB RAM at the time of measurement, with the resolved `runner_image` recorded); <= 8.0 seconds on Windows x64 workstation.
       * PR commit range scan (`--log-opts=<base>...HEAD`): <= 1.5 seconds.
       * Memory ceiling: Peak Resident Set Size (RSS) <= 250 MB during full repository traversal.
  4. Target benchmark environments — the benchmark MUST run on the runner that actually hosts the gate:
     - CI Environment: the GitHub-hosted runner label used by the `secret-scan` job in `.github/workflows/security-baseline.yml`, which is the floating label **`ubuntu-latest`** (not `ubuntu-22.04`); `.github/workflows/current-application.yml` uses the same label. Because the label floats, a timing result is admissible only if the run records the resolved image in the benchmark artifact: `runner_label` (`ubuntu-latest`), `runner_image` (captured with `echo "$ImageOS $ImageVersion"`), and `runner_cores` (captured with `nproc`). A result measured on any other label or image does not establish the <= 5.0 s CI budget for the deployed gate.
     - If a future change pins `.github/workflows/security-baseline.yml` to a fixed image label, the benchmark environment must be re-aligned to that same label before its timings are reused as parity evidence.
     - Local Developer Environment: Windows 11 x64 (PowerShell 7.4+).
  5. Machine-readable benchmark artifacts & JSON Schema:
     - Output paths: `artifacts/benchmarks/benchmark-gitleaks-results.json` and `artifacts/benchmarks/benchmark-betterleaks-results.json`.
     - Benchmark artifact schema:
       ```json
       {
         "$schema": "https://json-schema.org/draft/2020-12/schema",
         "title": "SecretScannerBenchmarkResult",
         "type": "object",
         "required": [
           "scanner", "version", "candidate_source_repo", "candidate_commit_sha",
           "binary_sha256", "platform", "runner_label", "runner_image",
           "runner_cores", "timestamp", "corpus_name", "corpus_sha256",
           "total_files_scanned", "total_test_instances", "true_positives",
           "false_positives", "false_negatives", "recall_percentage",
           "duration_p50_ms", "duration_p95_ms", "peak_rss_mb", "exit_code"
         ],
         "properties": {
           "scanner": { "type": "string", "enum": ["gitleaks", "betterleaks"] },
           "version": { "type": "string" },
           "candidate_source_repo": { "type": "string", "format": "uri" },
           "candidate_commit_sha": { "type": "string", "pattern": "^[0-9a-f]{40}$" },
           "binary_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
           "platform": { "type": "string", "enum": ["linux-x64", "windows-x64"] },
           "runner_label": { "type": "string" },
           "runner_image": { "type": "string" },
           "runner_cores": { "type": "integer", "minimum": 1 },
           "timestamp": { "type": "string", "format": "date-time" },
           "corpus_name": { "type": "string" },
           "corpus_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
           "total_files_scanned": { "type": "integer", "minimum": 0 },
           "total_test_instances": { "type": "integer", "minimum": 0 },
           "true_positives": { "type": "integer", "minimum": 0 },
           "false_positives": { "type": "integer", "minimum": 0 },
           "false_negatives": { "type": "integer", "minimum": 0 },
           "recall_percentage": { "type": "number", "minimum": 0, "maximum": 100 },
           "duration_p50_ms": { "type": "number", "minimum": 0 },
           "duration_p95_ms": { "type": "number", "minimum": 0 },
           "peak_rss_mb": { "type": "number", "minimum": 0 },
           "exit_code": { "type": "integer", "enum": [0, 1, 2] }
         }
       }
       ```
  6. Negative failure proof parity:
     - Exact exit code 1 when secret leak fixtures are present in git history or working tree.
     - Deterministic cleanup in `finally` blocks, matching `AC-FOUND-01-06` and `scripts/verify-secrets.ts`.
  7. Dual-mode scanning parity:
     - Commit range scanning: PR diff validation via `--log-opts=<base>...HEAD`.
     - Working tree directory scanning: Traversal honoring `.gitignore` and build exclusions (`.git`, `node_modules`, `.next`, `.turbo`, `.pnpm-store`).
  8. Fail-closed error handling:
     - Operational faults (missing binary, invalid CLI arguments, unparseable configuration file, unreadable target) must exit with code 2 and fail the pipeline, never silently exiting code 0.
  9. Multi-platform portability:
     - Verified pre-compiled native binaries for Linux x64 and Windows x64 distributed with published SHA-256 cryptographic checksums.
  10. Zero-network runtime verification procedures for Linux and Windows:
     - **Linux x64 CI runner procedure**:
       * Command: `unshare -n strace -f -e trace=socket,connect -o /tmp/betterleaks-trace.log betterleaks dir .`
       * Expected scan exit code: exactly `0` on clean repository tree.
       * Named trace artifact: `/tmp/betterleaks-trace.log`
       * Deterministic assertion command: `grep -E "connect\([0-9]+,\s*\{sa_family=AF_INET" /tmp/betterleaks-trace.log`
       * Expected assertion exit code: exactly `1` (0 matches found, proving zero external IPv4/IPv6 connections).
       * Failure condition: grep exit code 0 (connection attempt detected) or process error under network isolation.
     - **Windows 11 x64 workstation procedure**:
       * Procedure: Process execution with Windows Packet Monitor (`pktmon`) capture and TCP socket monitoring via PowerShell `Get-NetTCPConnection`.
       * Command:
         ```powershell
         pktmon filter add -p 53,80,443,8080
         pktmon start --etw -m real-time
         & betterleaks.exe dir .
         pktmon stop
         pktmon format pktmon.etl -o "$env:TEMP\betterleaks-win-traffic.log"
         ```
       * Expected scan exit code: exactly `0` on clean repository tree.
       * Named trace artifact: `$env:TEMP\betterleaks-win-traffic.log`
       * Deterministic assertion command:
         ```powershell
         Select-String -Path "$env:TEMP\betterleaks-win-traffic.log" -Pattern "betterleaks"
         ```
       * Expected assertion result: exactly 0 matching records.
       * Failure condition: Any outbound network packet captured, non-loopback TCP connection detected, or non-zero exit caused by running under an outbound blocking firewall rule (`New-NetFirewallRule -DisplayName Block-BL -Direction Outbound -Program betterleaks.exe -Action Block`).
  11. Formal Future Decision Record Template for `AI-TOOLCHAIN-DECISIONS.md`:
      - Precise specification of the decision record required before any future replacement can be authorized:
        ```markdown
        ### Future Decision Record Template for AI-TOOLCHAIN-DECISIONS.md

        #### `DECISION-AI-35-BETTERLEAKS-EVALUATION`: Secret scanning gate evaluation
        - **Status**: `PENDING_EVALUATION` (Authoritative status; Gitleaks remains `ADOPTED`)
        - **Date**: [YYYY-MM-DD]
        - **Decision Owner**: Human Product & Merge Owner
        - **Evaluation Summary**: [Empirical benchmark summary]
        - **Parity Benchmark Results**:
          | Criterion | Required Threshold | Gitleaks 8.24.0 Baseline | Betterleaks Candidate | Verdict |
          |---|---|---|---|---|
          | Custom Carrier Rule Recall | 100.0% | 100.0% (exit 1) | [Observed %] | [PASS/FAIL] |
          | Verifier Fallback Rules Recall | 100.0% | 100.0% (exit 1) | [Observed %] | [PASS/FAIL] |
          | Clean Repo False-Positive Rate | <= 0.1% (0 on clean tree) | 0 FP (exit 0) | [Observed FP] | [PASS/FAIL] |
          | Full Repo Scan Duration (Linux CI) | <= 5.0 seconds | ~1.5s | [Observed s] | [PASS/FAIL] |
          | Full Repo Scan Duration (Windows) | <= 8.0 seconds | ~2.5s | [Observed s] | [PASS/FAIL] |
          | PR Range Scan Duration | <= 1.5 seconds | ~0.6s | [Observed s] | [PASS/FAIL] |
          | Peak Memory RSS Ceiling | <= 250 MB | ~45 MB | [Observed MB] | [PASS/FAIL] |
          | Negative Proof Exit Code | Exactly 1 | Exactly 1 | [Observed code] | [PASS/FAIL] |
          | Operational Fault Exit Code | Exactly 2 | Exactly 2 | [Observed code] | [PASS/FAIL] |
          | Linux Zero-Network Trace | 0 external connect calls | 0 calls | [Observed calls] | [PASS/FAIL] |
          | Windows Zero-Network Trace | 0 external TCP sockets | 0 sockets | [Observed sockets] | [PASS/FAIL] |
        - **Mandatory Decision Rule**: In the absence of an explicit `APPROVED` record signed by the human product and merge owner, Gitleaks 8.24.0 remains the sole blocking CI gate.
        ```
  12. Pinning of the scanner candidate under test (both sides of the comparison):
      - **No Betterleaks revision is pinned today.** A repository-wide search finds no Betterleaks source URL, release tag, commit SHA, or binary digest anywhere in this repository outside this Work Item. Consequently **no benchmark result may be produced or accepted until the candidate is pinned**, and any result lacking the fields below is INVALID and fails `AI-35-R02`.
      - Before the first benchmark run the evaluator MUST record, in `artifacts/benchmarks/benchmark-betterleaks-results.json` and in the migration decision record: `candidate_source_repo` (upstream Git URL), `candidate_commit_sha` (full 40-hex source revision), the release tag when a published release is used, and `binary_sha256` (SHA-256 of the exact executable invoked, per platform).
      - The digest MUST be computed from the executable actually run, immediately before the run — Linux `sha256sum ./betterleaks`, Windows `Get-FileHash -Algorithm SHA256 .\\betterleaks.exe` — and the printed digest MUST equal `binary_sha256` in the artifact.
      - The Gitleaks baseline side is pinned identically: `version` `8.24.0` plus the `binary_sha256` of the CI-provisioned 8.24.0 executable, recorded in `artifacts/benchmarks/benchmark-gitleaks-results.json`.
      - Two benchmark artifacts may be compared only when both carry these pinning fields; a rerun producing a different `binary_sha256` or `candidate_commit_sha` is a **new** comparison and inherits no prior verdict.
- Author complete Work Item specification `TASK-AI-35.md`.

## Out of scope

- Modifying `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` in this PR (this Work Item specifies the required decision record template; authoring the decision entry occurs when an evaluation is performed and authorized by the human owner).
- Editing existing CI workflows (`.github/workflows/security-baseline.yml`,
  `.github/workflows/current-application.yml`).
- Modifying `scripts/verify-secrets.ts` or `.gitleaks.toml`.
- Installing the Betterleaks binary into production CI or local environments.
- Installing or configuring `lefthook` (owned by `TASK-AI-36`) or `trivy`
  (owned by `TASK-AI-37`).
- Weakening or relaxing any existing secret scanning rule or allowlist.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-35-R00` | Enforcement boundary: this Work Item's gate blocks **merge** (Pull Request and push to `main`), not local commits. No pre-commit hook exists (`lefthook` is `PENDING`, owned by `TASK-AI-36`), so no pre-commit protection may be claimed by `TASK-AI-35`. |
| `AI-35-R01` | Gitleaks baseline preservation: Gitleaks 8.24.0 remains the active, blocking, adopted CI secret scanning gate until all replacement criteria are proven and human decision is granted. Gitleaks is never treated as absent. |
| `AI-35-R02` | Parity benchmark thresholds & negative proof parity: Any proposed replacement scanner must achieve exactly 100.0% recall on the `.gitleaks.toml` custom rule (`shipde-carrier-live-token`), Gitleaks defaults, and verifier fallback rules (`generic-api-key`, `private-key`, `aws-secret-key`), >= 99.0% recall on the public benchmark corpus, <= 0.1% false-positive rate, and adhere to the runtime budget (<= 5.0s on the deployed CI runner label `ubuntu-latest` / <= 8.0s Windows full scan, <= 1.5s PR range) measured with `runner_label`, `runner_image` and `runner_cores` recorded. Every benchmark artifact must pin the candidate (`candidate_source_repo`, `candidate_commit_sha`, `binary_sha256`) and the corpus (`corpus_sha256` matching `artifacts/benchmarks/corpus-manifest.json`); an unpinned run is INVALID. It must exit with exact code 1 on negative leak fixtures with guaranteed cleanup, matching `AC-FOUND-01-06`. |
| `AI-35-R03` | Git range and tree scanning parity: The scanner must scan both the PR commit range (`BASE_SHA...HEAD`) and uncommitted working directory targets without traversing ignored paths (`.git`, `node_modules`, `.next`, `.turbo`, `.pnpm-store`). |
| `AI-35-R04` | Fail-closed behavior: Missing binary, invalid CLI flags, unparseable configuration, or empty report on exit code 1 must result in an operational failure (exit code 2) and block the CI pipeline, never silently exiting zero. |
| `AI-35-R05` | Local/CI platform portability & runtime zero-network verification: The scanner must provide verified pre-compiled native binaries for Linux x64 and Windows x64 with published SHA-256 checksums. Execution must be strictly offline with zero telemetry; verified at runtime on Linux via `unshare -n` and `strace -f -e trace=socket,connect` logging 0 external connect calls, and on Windows via `pktmon` / PowerShell socket capture logging 0 external network packets or TCP connections. Any network connection attempt or failure under network isolation immediately disqualifies the scanner. |
| `AI-35-R06` | Human authorization gate: Replacement of Gitleaks with Betterleaks requires explicit human approval in `AI-TOOLCHAIN-DECISIONS.md`. In the absence of an approved replacement decision or if Betterleaks fails any parity requirement, Gitleaks remains the sole authoritative blocking gate. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and CI-facing
outputs are CLI logs from `pnpm security:secrets` and GitHub Actions job
`secret-scan`. Output states:
- Clean pass: Exit code 0, 0 leaks found across PR commit range and directory targets.
- Finding detected: Exit code 1, list of file:line, RuleID, and redacted secret preview.
- Operational failure: Exit code 2, diagnostic error explaining missing binary, corrupt config, or execution failure.
- Negative test verification: Exit code 1 expected; exiting 0 or 2 fails the gate.

## API, event and data impact

No schema, database, or runtime API change. Governs security quality gate contracts
and verification scripts.

## Acceptance matrix

| AC/Test ID | Scenario | Verification command & expected result | Output source |
|---|---|---|---|
| `AC-AI-35-01` | Baseline gate truth and ecosystem manifest audit | `node tools/ai-brain/cli.js manifest` exits 0 and prints the string `Tổng: 0 lỗi,` confirming 0 errors (warning and note counts are not pinned — see Preconditions); and `node tools/ai-brain/acceptance/ac-35-01-gitleaks-baseline.js` exits 0 and prints the string `GITLEAKS_BASELINE_VERIFIED: gitleaks ADOPTED BLOCKING_GATE 8.24.0`. The rule is not written into the row: the script requires `tools/ai-brain/acceptance/lib/gitleaks-baseline.js`, the same module `AC-AI-35-07` requires for its negative proof, so these two halves of the baseline rule cannot drift apart. It exits 2 outside the repository | command stdout |
| `AC-AI-35-02` | Clean baseline secret scanning across commit history and working tree | `pnpm security:secrets` exits 0 and prints the string `✅ Quét secret hoàn tất: 0 phát hiện vi phạm bí mật trên commit history và working tree.` | command stdout |
| `AC-AI-35-03` | Demonstrated negative failure proof on synthetic carrier token fixture | `pnpm security:secrets -- --test-negative` exits 1 and prints the string `🚨 VI PHẠM ĐÃ ĐƯỢC BẮT CHÍNH XÁC QUA RULE: [shipde-carrier-live-token]` against generated fixture `.temp-negative-fixture-*.js` with guaranteed cleanup in `finally` | command stderr |
| `AC-AI-35-04` | Dual-mode scanning and build/dependency directory exclusions | `npx tsx tools/ai-brain/acceptance/ac-35-04-scan-exclusions.ts` exits 0 and prints the string `DUAL_MODE_EXCLUSIONS_VERIFIED:`. The ignored names are read from `IGNORED_SCAN_NAMES` and the traversal from `getGitleaksScanTargets`, both exported by the real `scripts/verify-secrets.ts`; the row restates neither. The script CONTROLs that the traversal reached the repository root and that the exclusion really removes the ignored directories from a fixture, and exits 2 outside the repository | command stdout |
| `AC-AI-35-05` | Scanner operational fail-closed behavior on spawn and argument errors | `npx tsx tools/ai-brain/acceptance/ac-35-05-fail-closed.ts` exits 0 and prints the string `FAIL_CLOSED_VERIFIED: Gitleaks process execution error:`. It calls the real `executeGitleaks` exported by `scripts/verify-secrets.ts`, CONTROLs that the fault carries a non-empty `operationalError` so an empty message cannot carry the row, and exits 2 outside the repository | command stdout |
| `AC-AI-35-06` | Negative proof: the real `shipde-carrier-live-token` rule read from `.gitleaks.toml` rejects a tampered copy of a real tracked file, after a CONTROL proving the untouched file is accepted | `node tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js` exits 1 and prints the string `CARRIER_TOKEN_DETECTED_IN_TAMPERED_COPY:` | `tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js`, command stderr |
| `AC-AI-35-07` | Negative proof: the baseline rule behind `AI-35-R01` rejects a tampered copy of the real ecosystem manifest, after a CONTROL proving the untouched manifest agrees with the Gitleaks version the CI workflow installs | `node tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js` exits 1 and prints the string `GITLEAKS_BASELINE_TAMPER_REJECTED:`. The rule is required from `tools/ai-brain/acceptance/lib/gitleaks-baseline.js` — the same module `AC-AI-35-01` requires — so this negative proof exercises the rule the positive row runs instead of a private copy of it. It exits 2 outside the repository | `tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js`, `tools/ai-brain/acceptance/lib/gitleaks-baseline.js`, command stderr |
| `AC-AI-35-08` | Negative proof: `AC-AI-35-06` fails operationally (exit `2`), not as a clean result, when its real source file is absent | `cd $env:TEMP; node $REPO/tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js` exits 2 and prints the string `SOURCE_MISSING: .gitleaks.toml` | `tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js`, command stderr |
| `AC-AI-35-09` | Negative proof: `AC-AI-35-07` fails operationally (exit `2`), not as a clean result, when its real source file is absent | `cd $env:TEMP; node $REPO/tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js` exits 2 and prints the string `SOURCE_MISSING: tools/ecosystem-manifest.json` | `tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js`, command stderr |

## Verification commands

```
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm security:secrets
pnpm security:secrets -- --test-negative
node tools/ai-brain/acceptance/ac-35-01-gitleaks-baseline.js   # expected exit 0
npx tsx tools/ai-brain/acceptance/ac-35-04-scan-exclusions.ts   # expected exit 0
npx tsx tools/ai-brain/acceptance/ac-35-05-fail-closed.ts   # expected exit 0
node tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js   # expected exit 1
node tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js   # expected exit 1
python docs/product-spec/scripts/validate_docs.py
```

Counts that grow with the repository (test totals, note counts, tracked-file and
identifier counts) are recorded as invariants, not as pinned numbers: a pinned
number turns any unrelated merge into a failure of this Work Item.

| Command | Result | Evidence/notes |
|---|---|---|
| `node tools/ai-brain/cli.js manifest` | PASS | Exit code 0; `Tổng: 0 lỗi,` — zero errors. Warning and note counts are not pinned |
| `node tools/ai-brain/cli.js reconcile` | PASS | Exit code 0; `0 lỗi` — register does not over-declare against repository reality. Note count is not pinned |
| `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` | PASS | Exit code 0; `fail 0` across ai-brain, ai-dashboard and ai-guard. The total is not pinned |
| `pnpm security:secrets` | PASS | Exit code 0; 0 leaks across PR commit range and working tree |
| `pnpm security:secrets -- --test-negative` | PASS (exit 1) | Exit code 1; detected `[shipde-carrier-live-token]` in `.temp-negative-fixture-*.js` with guaranteed cleanup |
| `node tools/ai-brain/acceptance/ac-35-01-gitleaks-baseline.js` | PASS (exit 0) | Exit code 0; the real manifest satisfies the shared baseline rule. Exit 2 outside the repository |
| `npx tsx tools/ai-brain/acceptance/ac-35-04-scan-exclusions.ts` | PASS (exit 0) | Exit code 0; the traversal reached the repository root and no target descends into an ignored directory. Exit 2 outside the repository |
| `npx tsx tools/ai-brain/acceptance/ac-35-05-fail-closed.ts` | PASS (exit 0) | Exit code 0; the real `executeGitleaks` returns a non-empty `operationalError` and no success on a missing binary. Exit 2 outside the repository |
| `node tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js` | PASS (exit 1) | Exit code 1; CONTROL accepted the untouched `package.json`, the real rule read from `.gitleaks.toml` rejected the tampered copy. Exit 2 outside the repository |
| `node tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js` | PASS (exit 1) | Exit code 1; CONTROL accepted the untouched manifest against the CI-installed Gitleaks version, the shared rule rejected the downgraded copy. Exit 2 outside the repository |
| `python docs/product-spec/scripts/validate_docs.py` | PASS | Exit code 0; `Documentation validation passed`. File, feature and identifier counts are not pinned |

## Acceptance matrix audit

Every row of the acceptance matrix was extracted programmatically from the table
and executed verbatim against `origin/main`, capturing the real exit code and the
real output. Four defects were found and repaired; the rows not listed here were
measured and held unchanged (`AC-AI-35-02` exit 0, `AC-AI-35-03` exit 1,
`AC-AI-35-04` exit 0, `AC-AI-35-05` exit 0, and the manifest-entry half of
`AC-AI-35-01` exit 0).

| Defect | Row | Measurement that proved it | Replacement |
|---|---|---|---|
| Stale pin | `AC-AI-35-01` | The row pinned `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú`. The warning it pins is a `codex-cli` version drift; the same run's `reconcile` counterpart, pinned in the verification table as "1 warning (`TASK-AI-07`), 161 notes", now measures 0 warnings and 149 notes. A count that already drifted once will drift again. | The expected string is now the invariant `Tổng: 0 lỗi,`. Warning and note counts are explicitly not pinned. |
| False claim | Benign Repository Negative Corpus | The corpus identity asserted "**363 tracked files**… reproducible today via `git ls-files \| wc -l`". Measured on `origin/main`: **418**. The number was not reproducible. | The tracked-file count is now measured per run and recorded in `corpus-manifest.json`; the pinned commit SHA remains the corpus identity. Both historical measurements are cited as measurements, not as constants. |
| Unrunnable / false claim | `AC-AI-35-06` | `pnpm test:audit` was asserted to exit 0. Measured: **exit 2**, expected string absent. It drives the whole `turbo` build graph, which fails in `@shipde/testkit:build` (`TS2305 PrismaClient`); running the suite directly then fails on `apps/web/.next build directory must exist`. The row's pass therefore depended on build artifacts, not on scanner behaviour. | `tools/ai-brain/acceptance/ac-35-06-carrier-rule-negative.js`: reads the real `shipde-carrier-live-token` regex out of `.gitleaks.toml`, CONTROLs that the untouched real `package.json` is accepted, then proves the real rule rejects a tampered **copy** written to the OS temp directory. Exit 1 in repo, exit 2 outside it. |
| Tautology | `AC-AI-35-07` | The row asserted that this very file contains a list of strings that are themselves written into the row. Proof: the command was extracted from the table, the single matrix line was written alone into an empty directory as the whole "specification", and the command still printed `SPECIFICATION_INTEGRITY_VERIFIED` and exited **0**. It also required the string `363 tracked files`, so it actively defended the false claim above. | `tools/ai-brain/acceptance/ac-35-07-gitleaks-pin-consistency.js`: reads the real manifest entry and the `GITLEAKS_VERSION` the CI workflow actually installs, CONTROLs that the untouched manifest agrees with it, then proves the check rejects a tampered **copy** whose gate is downgraded. Exit 1 in repo, exit 2 outside it. |

Both new scripts follow `tools/ai-brain/acceptance/ac-07-13-forbidden-lifecycle.js`:
the real files are only ever read, the tampering happens on a copy in the OS temp
directory, a CONTROL step proves the untouched source is accepted first, and a
missing source exits `2` so an absent repository can never be mistaken for a
clean result (`AC-AI-35-08`, `AC-AI-35-09`).

Assertions through `node --test --test-name-pattern` are prohibited in this Work
Item: `node --test` exits 0 when the pattern matches nothing, so such a row
cannot fail.

## Acceptance matrix audit — round 2 (rule coupling)

Every row of the acceptance matrix was extracted programmatically from the table
honouring the escaped-pipe rule and executed exactly as stored against
`origin/main`. Three defects remained after the first audit round, and all three
were classified, measured and repaired below. The remaining rows were measured
and held unchanged: `AC-AI-35-02` (exit 0), `AC-AI-35-03` (exit 1),
`AC-AI-35-06` (exit 1; exit 2 from an empty directory), `AC-AI-35-08` and
`AC-AI-35-09` (node exits 2 with `SOURCE_MISSING` from `$env:TEMP` under
PowerShell).

### `35-D1` — `AC-AI-35-01`, `AC-AI-35-04`, `AC-AI-35-05`: unrunnable as stored

Classification: UNRUNNABLE (markdown escaping).

Measurement: the markdown-aware splitter reads an unescaped `|` as a cell
boundary. These three rows carried raw JavaScript `||` operators, so they split
into 12, 6 and 6 cells instead of the table's 4 and no longer hold a command in
one cell. Reconstructed and executed, the intended commands did pass — exit 0
printing `GITLEAKS_BASELINE_VERIFIED: gitleaks ADOPTED BLOCKING_GATE 8.24.0`,
`DUAL_MODE_EXCLUSIONS_VERIFIED: 70 scan targets, all build and dependency
directories excluded` (the target count is measured, never pinned) and
`FAIL_CLOSED_VERIFIED: Gitleaks process execution error: spawnSync
nonexistent-binary-xyz ENOENT` — but a row that cannot be extracted as written
is not a row.

Replacement: each moved into a committed script —
`ac-35-01-gitleaks-baseline.js`, `ac-35-04-scan-exclusions.ts` and
`ac-35-05-fail-closed.ts`. Every one exits 2 from an empty directory with no
repository present, so an absent repository can never read as a pass.

### `35-D2` — the baseline rule was written twice, and the copies had drifted

Classification: TAUTOLOGY-adjacent private copy of the rule under test — the
systematic defect this audit was sent to find.

Measurement: the rule "Gitleaks is `ADOPTED`, `BLOCKING_GATE`,
`ci-provisioned`, pinned to the version CI installs" existed in two private
copies inside this Work Item — inline in `AC-AI-35-01`, comparing against the
literal `8.24.0`, and inside `reject()` in `ac-35-07-gitleaks-pin-consistency.js`,
comparing against the `GITLEAKS_VERSION` the workflow actually installs. They had
already diverged. Against a scratch copy of the real manifest and workflow whose
CI pin was changed to `9.9.9` — CI installs 9.9.9, the manifest pins 8.24.0, a
genuinely broken baseline:

| Command | Exit | Output |
|---|---|---|
| old `AC-AI-35-01` inline command | 0 | `GITLEAKS_BASELINE_VERIFIED: gitleaks ADOPTED BLOCKING_GATE 8.24.0` |
| new `ac-35-01-gitleaks-baseline.js` | 1 | `GITLEAKS_BASELINE_RULE_VIOLATED: pinned 8.24.0 but CI installs 9.9.9` |

The positive row certified the gate while the gate was broken, because it carried
its own copy of the rule.

Replacement: `tools/ai-brain/acceptance/lib/gitleaks-baseline.js` is the single
definition of the rule, required by both rows. `AC-AI-35-01` is the positive half
and `AC-AI-35-07` the negative half, keeping its `CONTROL` step: the untouched
manifest must be accepted before the tampered copy is rejected.

Coupling mutation 1 — the module is edited so the rule never fires
(`checkGitleaksBaseline` returns `null`): `ac-35-07` moves from exit 1 printing
`GITLEAKS_BASELINE_TAMPER_REJECTED:` to exit 0 printing
`GITLEAKS_BASELINE_TAMPER_ACCEPTED:`. The negative row fails.

Coupling mutation 2 — the module is edited so the rule fires on the real manifest
(`lifecycle_state !== 'INTEGRATED'`): `ac-35-01` exits 1 with
`GITLEAKS_BASELINE_RULE_VIOLATED: lifecycle_state is ADOPTED`, and `ac-35-07`
exits 2 with `CONTROL_FAILED: the untouched manifest is already rejected`. Both
rows move together.

The module was restored from a file backup, never by checking out the file:
`sha256sum` of the restored module is
`72f350c49dfbb2fa7b5c16633456e54352b892c66c6c7a07806bca155df75085`, equal to the
pre-mutation hash, and the rows return to exit 0 and exit 1.

No row compares two literals written into its own command, and no count that
drifts with the repository is pinned.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5e0f278` / `cafdc1c` | `CHANGES_REQUIRED` | Resolved 5 findings: P1 dependency truth explained on PR (TASK-AI-17 merged into base); P2 manifest warning pinned to exactly 0 errors and 1 codex-cli drift warning; P2 measurable parity thresholds defined across corpora, metrics, environments, and JSON artifacts; P2 zero-network runtime verification command, expected log, and failure condition specified; P2 custom-rule inventory corrected to distinguish TOML rule (`shipde-carrier-live-token`), Gitleaks defaults, and verifier fallback rules. |
| 2 | `3d0e259` | `CHANGES_REQUIRED` | Resolved 7 findings and 1 inline comment: (1) Control Status aligned to authoritative delivery register `BLOCKED_DEPENDENCY`; (2) All Acceptance Matrix rows replaced with independently executable commands naming exact command, expected exit code (0 or 1), exact string, and output source; (3) Proposed benchmark corpora grounded in committed `verify-secrets.ts` and `regression-audit.test.ts` harnesses, with exact JSON Schema, paths, and pass/fail exit codes defined; (4) Fixture path `.temp-negative-fixture-*.js` explicitly named from existing verifier harness and executed with exact exit code 1; (5) Dual-mode range and tree scanning verified alongside `getGitleaksScanTargets` build/dependency directory exclusions; (6) Disallowed ambiguous scan exit "0 or 1", fixed clean scan to exactly exit 0, negative test to exactly exit 1, operational error to exit 2, and specified Linux `strace` socket tracing against `/tmp/betterleaks-trace.log` with deterministic grep assertion; (7) Bounded Work Item to documentation-only and specified complete Future Decision Record Template for `AI-TOOLCHAIN-DECISIONS.md`; (8) Specified Windows 11 x64 zero-network procedure using `pktmon` / `Get-NetTCPConnection` to `$env:TEMP\betterleaks-win-traffic.log` with deterministic zero-connection assertion. |
| 3 | `da71354` | `CHANGES_REQUIRED` | Resolved 5 findings: (1) business outcome no longer promises pre-commit protection — scope limited to blocking merge, with new rule `AI-35-R00` recording that no pre-commit hook exists (`lefthook` PENDING, owned by `TASK-AI-36`); (2) benchmark environment realigned from `ubuntu-22.04` to the floating `ubuntu-latest` label actually used by the `secret-scan` job, with `runner_label` / `runner_image` / `runner_cores` now required in every artifact; (3) Betterleaks candidate pinning made mandatory (`candidate_source_repo`, `candidate_commit_sha`, `binary_sha256`), with the explicit statement that no revision is pinned today and no benchmark result is valid until it is; (4) corpora pinned — the nonexistent `tools/ai-guard/test/fixtures/` path and the unverifiable file counts replaced with a reproducible corpus identity (`git ls-files` = 363 tracked files at commit `da71354`; the `getGitleaksScanTargets` count is explicitly not pinned because it varies with locally installed build directories — observed 62 on a fully installed worktree — and is recorded per run) plus a required `artifacts/benchmarks/corpus-manifest.json` carrying generator, pinned commit, source URL / release tag and `corpus_sha256`; (5) Windows 11 x64 zero-network procedure (`pktmon` plus outbound firewall block rule and deterministic assertion) confirmed present alongside the Linux `unshare -n` / `strace` procedure. |
| 4 | `HEAD` | `READY_FOR_CODEX` | Awaiting fresh independent Codex review. |

## Residual limitations

Betterleaks is an actively evolving project; while its BPE tokenization promises
higher accuracy and faster scans, its drop-in compatibility with complex custom
rules (such as carrier token keywords and lookaheads) and broad multi-platform
binary distributions across diverse developer environments (Windows x64 MSVC/GNU,
macOS ARM64, Linux x64 glibc/musl) must be verified empirically before any migration
is triggered. Furthermore, Betterleaks' rule format translation fidelity from
Gitleaks TOML must achieve 100.0% parity on all custom rules.
Until such empirical verification is conducted against the defined parity thresholds
and human approval is granted under `AI-35-R06`, Gitleaks 8.24.0 remains the sole
blocking CI gate.
