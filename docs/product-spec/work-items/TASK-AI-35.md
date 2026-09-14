# TASK-AI-35 — Secret scanning gate evaluation: Gitleaks preservation vs Betterleaks replacement

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-35` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `168` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-35.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-35-betterleaks` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/21 |

## Business outcome

The Ship Dễ delivery pipeline must prevent secret and credential leaks before
code is committed or merged into `main`. The repository's existing secret
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
detection capability, negative proof parity (exact exit code 1), dual git-range
and working tree scanning, local and CI portability, zero telemetry, and a formal
human architectural decision.

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
  (`generic-api-key`, `private-key`, `aws-secret-key`) used during standalone verifier execution.
- `.gitleaks.toml` — Custom rule configuration containing exactly one custom rule
  (`shipde-carrier-live-token`) and extending Gitleaks' built-in default rules
  via `[extend] useDefault = true`.
- `docs/product-spec/work-items/TASK-FOUND-01.md` § `AC-FOUND-01-06` — Negative
  failure proof detecting secret leak fixtures with exact exit code 1 and
  guaranteed cleanup.

## Preconditions and dependencies

- `TASK-AI-17` reconciled the ecosystem manifest against reality, establishing
  that `gitleaks` is `ADOPTED` / `ci-provisioned` while `lefthook` and `trivy`
  are `PENDING`. `TASK-AI-17` is merged into the base branch
  (`fix/task-ai-16-codex-launch-flags` via PR #19 commit `1f587dd`), satisfying
  the dependency requirement for `TASK-AI-35` (the delivery register
  `FEATURE-DELIVERY-REGISTER.csv` retains `BLOCKED_DEPENDENCY` until `TASK-AI-19`
  executes the deterministic reconciler write-back).
- Pinned `gitleaks 8.24.0` is provisioned and running in CI
  (`.github/workflows/security-baseline.yml`).
- `pnpm security:secrets` and `pnpm security:secrets -- --test-negative` execute
  and pass cleanly in the current baseline.
- `node tools/ai-brain/cli.js manifest` reports exactly 0 errors and exactly
  the one named `codex-cli` version-drift warning (pinned `0.151.0` vs observed
  `0.154.0`), with zero unexpected warnings or unrecorded drift.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item defines a foundational
security gate evaluation and specification across tooling, CI workflows, and
developer worktrees.

Bounded scope: authoring the specification in `docs/product-spec/work-items/TASK-AI-35.md`.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
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
  2. Parity benchmark datasets (labeled corpora):
     - **Ship Dễ Carrier & Core Fixture Corpus**: 50 synthetic positive secret instances covering live and production carrier tokens (`ghn_live_*`, `ghtk_live_*`, `vtp_live_*`, `jtexpress_live_*`), AWS secret access keys (`[0-9a-zA-Z\/+=]{40}`), private key headers (`BEGIN RSA PRIVATE KEY`), and GitHub PATs (`ghp_*`), paired with the negative test fixture harness from `scripts/verify-secrets.ts` and `tools/ai-guard/test/fixtures/`.
     - **Public Credential Benchmark Corpus**: Pinned reference dataset of >= 1,000 positive secret instances across >= 15 credential classes (API tokens, private keys, database connection strings, OAuth client secrets).
     - **Benign Repository Negative Corpus**: The clean Ship Dễ codebase (500+ clean TypeScript, JSON, Markdown, YAML files) containing intentional benign patterns such as test redaction fixtures (`(sk-|ghp_|gho_|ghu_)1234567890`) and schema names (`key_behavior:`).
  3. Measurable quantitative parity thresholds:
     - **Minimum Recall**: Exactly 100.0% recall on the Ship Dễ Carrier & Core Fixture Corpus (zero missed carrier tokens or verifier fallback patterns); >= 99.0% recall across the Public Credential Benchmark Corpus (0% recall regression compared to Gitleaks 8.24.0 baseline).
     - **Maximum False-Positive Rate**: <= 0.1% false-positive rate across the Benign Repository Negative Corpus, and exactly 0 false positives on the clean Ship Dễ repository tree with allowlists applied.
     - **Execution Speed & Runtime Budget**:
       * Full repository directory scan (`dir .`): <= 5.0 seconds on standard CI runner (Linux x64, 2 vCPU / 8 GB RAM); <= 8.0 seconds on Windows x64 workstation.
       * PR commit range scan (`--log-opts=<base>...HEAD`): <= 1.5 seconds.
       * Memory ceiling: Peak Resident Set Size (RSS) <= 250 MB during full repository traversal.
  4. Target benchmark environments:
     - CI Environment: Linux x64 runner (`ubuntu-22.04` LTS in GitHub Actions).
     - Local Developer Environment: Windows 11 x64 (PowerShell 7+).
  5. Reproducible benchmark procedure & artifacts:
     - Benchmark execution harness executing identical passes of Gitleaks 8.24.0 and Betterleaks with cache dropped between runs.
     - Generated machine-readable benchmark artifacts: `benchmark-gitleaks-results.json` and `benchmark-betterleaks-results.json` detailing true positives, false positives, wall-clock duration (p50, p95), peak memory RSS, and rule match distributions.
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
  10. Zero-network behavior and runtime evidence:
     - Strictly offline execution with zero network calls or telemetry.
     - Verification command (Linux x64): `unshare -n betterleaks dir .` AND `strace -f -e trace=socket,connect -o /tmp/betterleaks-trace.log betterleaks dir .` (or container network isolation: `docker run --rm --network none -v ${PWD}:/repo betterleaks:local dir /repo`).
     - Expected log: Normal scan completion report with exit code 0 or 1; exactly 0 outbound `connect()` system calls to remote IP addresses (AF_INET/AF_INET6) in `/tmp/betterleaks-trace.log`.
     - Failure condition: Any attempt to open a socket to an external network host, any connection timeout, or any crash/warning/non-zero exit triggered by running without network access.
- Define the formal human decision gate in `AI-TOOLCHAIN-DECISIONS.md` required
  to authorize any future migration.
- Author complete Work Item specification `TASK-AI-35.md`.

## Out of scope

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
| `AI-35-R01` | Gitleaks baseline preservation: Gitleaks 8.24.0 remains the active, blocking, adopted CI secret scanning gate until all replacement criteria are proven and human decision is granted. Gitleaks is never treated as absent. |
| `AI-35-R02` | Parity benchmark thresholds & negative proof parity: Any proposed replacement scanner must achieve 100.0% recall on the `.gitleaks.toml` custom rule (`shipde-carrier-live-token`), Gitleaks defaults, and verifier fallback rules (`generic-api-key`, `private-key`, `aws-secret-key`), >= 99.0% recall on the public benchmark corpus, <= 0.1% false-positive rate, and adhere to the runtime budget (<= 5.0s CI / <= 8.0s Windows full scan, <= 1.5s PR range). It must exit with exact code 1 on negative leak fixtures with guaranteed cleanup, matching `AC-FOUND-01-06`. |
| `AI-35-R03` | Git range and tree scanning parity: The scanner must scan both the PR commit range (`BASE_SHA...HEAD`) and uncommitted working directory targets without traversing ignored paths (`.git`, `node_modules`, `.next`, `.turbo`, `.pnpm-store`). |
| `AI-35-R04` | Fail-closed behavior: Missing binary, invalid CLI flags, unparseable configuration, or empty report on exit code 1 must result in an operational failure (exit code 2) and block the CI pipeline, never silently exiting zero. |
| `AI-35-R05` | Local/CI platform portability & runtime zero-network verification: The scanner must provide verified pre-compiled native binaries for Linux x64 and Windows x64 with published SHA-256 checksums. Execution must be strictly offline with zero telemetry; verified at runtime via `unshare -n betterleaks dir .` (or Docker `--network none`) and `strace -f -e trace=socket,connect` logging zero remote socket connections. Any network connection attempt or failure under network isolation immediately disqualifies the scanner. |
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

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-35-01` | Truthfulness of baseline gate status | Gitleaks is accurately recorded as `ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`, and active in `.github/workflows/security-baseline.yml`; `lefthook` and `trivy` are accurately documented as `PENDING`; manifest check outputs exactly 0 errors and exactly the one named `codex-cli` version-drift warning | `tools/ecosystem-manifest.json`, workflow review, and `node tools/ai-brain/cli.js manifest` output (0 errors, exactly 1 warning: `codex-cli` version drift) |
| `AC-AI-35-02` | Measurable scanner-parity benchmarks and thresholds | The Work Item specifies quantitative and qualitative parity criteria: labeled datasets (Ship Dễ Carrier & Core Corpus + Public Credential Corpus + Benign Negative Corpus), quantitative thresholds (100.0% carrier recall, >= 99.0% overall recall, <= 0.1% FP rate, <= 5.0s CI / <= 8.0s Windows full scan runtime budget, <= 1.5s PR range budget, <= 250MB peak RSS), execution environments (Linux x64 CI and Windows x64 local), and reproducible benchmark artifacts (`benchmark-*-results.json`) | Specification text in `TASK-AI-35.md` § In scope and rule `AI-35-R02` |
| `AC-AI-35-03` | Negative failure proof parity requirement | Specification mandates exact exit code 1 on synthetic leak fixtures (`shipde-carrier-live-token`, `ghn_live_...`) and verifier fallback patterns with guaranteed cleanup in `finally`, matching existing `scripts/verify-secrets.ts` and `AC-FOUND-01-06` | Specification text and rule `AI-35-R02` |
| `AC-AI-35-04` | Dual-mode scanning parity requirement | Specification mandates full support for PR commit range (`BASE_SHA...HEAD`) and safe working tree directory scanning | Specification text and rule `AI-35-R03` |
| `AC-AI-35-05` | Fail-closed and zero-telemetry runtime verification | Specification requires operational failure (code 2) on missing binary or invalid config, and mandates runtime verification of zero network activity under network isolation (`unshare -n` or Docker `--network none`) with `strace -f -e trace=socket,connect` confirming zero external socket calls | Specification text, rule `AI-35-R05`, and documented verification commands: `unshare -n betterleaks dir .` and `strace -f -e trace=socket,connect` (expected log: 0 external connect calls; failure condition: socket creation to external IP or crash under isolation) |
| `AC-AI-35-06` | Human decision gate enforcement | Specification requires formal human approval in `AI-TOOLCHAIN-DECISIONS.md` before executing any replacement | Specification text and rule `AI-35-R06` |

## Verification commands

```
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
```

| Command | Result | Evidence/notes |
|---|---|---|
| `node tools/ai-brain/cli.js manifest` | PASS | Exactly 0 errors, exactly 1 warning (`codex-cli` pinned 0.151.0 vs observed 0.154.0 drift) |
| `node tools/ai-brain/cli.js reconcile` | PASS | 0 errors, 1 warning (`TASK-AI-07`), 161 notes; register matches repository reality |
| `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` | PASS | 458 tests passing across ai-brain, ai-dashboard, and ai-guard |
| `python docs/product-spec/scripts/validate_docs.py` | PASS | 82 markdown files, 130 feature IDs, 178 delivery rows, 520 unique identifiers |

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5e0f278` / `cafdc1c` | `CHANGES_REQUIRED` | Resolved 5 findings: P1 dependency truth explained on PR (TASK-AI-17 merged into base); P2 manifest warning pinned to exactly 0 errors and 1 codex-cli drift warning; P2 measurable parity thresholds defined across corpora, metrics, environments, and JSON artifacts; P2 zero-network runtime verification command, expected log, and failure condition specified; P2 custom-rule inventory corrected to distinguish TOML rule (`shipde-carrier-live-token`), Gitleaks defaults, and verifier fallback rules. |
| 2 | `HEAD` | `READY_FOR_CODEX` | Awaiting fresh independent Codex review. |

## Residual limitations

Betterleaks is an actively evolving project; while its BPE tokenization promises
higher accuracy and faster scans, its drop-in compatibility with complex custom
rules and broad multi-platform binary distributions across diverse developer
environments must be verified empirically before any migration is triggered.
Until such verification is conducted and human approval is granted under
`AI-35-R06`, Gitleaks 8.24.0 remains the sole blocking gate.
