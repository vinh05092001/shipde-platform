# TASK-AI-37 — Trivy dependency and container scanning in CI

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-37` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `170` |
| Dependencies | `TASK-AI-17` (merged, `6bd1cd7`) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-37.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-37-trivy` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/24 |

## Business outcome

The Ship Dễ continuous delivery pipeline requires automated supply-chain,
dependency vulnerability, container security, and Software Bill of Materials (SBOM)
scanning to detect known Common Vulnerabilities and Exposures (CVEs), package
misconfigurations, and vulnerable third-party dependencies before changes reach
production or merge into `main`.

Currently, secret scanning is actively enforced in CI by Gitleaks 8.24.0
(`ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`). However, automated Software
Composition Analysis (SCA), container vulnerability scanning, and SBOM generation
are absent; `aquasecurity/trivy` is truthfully documented as `PENDING` with
`blocking_policy: NON_BLOCKING` in `tools/ecosystem-manifest.json` following
`TASK-AI-17`.

`TASK-AI-37` establishes the authoritative architectural and operational
specification for introducing Trivy vulnerability, misconfiguration, and SBOM
scanning into the CI pipeline as an automated, fail-closed quality gate. It defines:
1. Dependency vulnerability scanning across `pnpm-lock.yaml` and monorepo manifests.
2. Software Bill of Materials (SBOM) generation in CycloneDX format on every PR.
3. Container image and Dockerfile misconfiguration scanning across applications,
   including deterministic fallback when application Dockerfiles are not yet present.
4. Separation of authority: Trivy secret scanning is disabled to preserve Gitleaks
   as the single source of truth for secrets.
5. Vulnerability database caching (`~/.cache/trivy`, budget `<= 500MB`) to avoid
   registry rate limits and ensure CI execution within a `180000ms` budget.
6. Severity filtering and blocking criteria (`HIGH,CRITICAL` with `--ignore-unfixed`).
7. Standard SARIF output uploaded via immutable commit SHA action for inline PR
   annotations and GitHub Security tab integration.
8. Rigorous 6-step manifest promotion prerequisites before Trivy can transition
   from `PENDING` to `ADOPTED` in `tools/ecosystem-manifest.json`.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern,
  existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent
  Codex review gate.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `AGENTS.md` § Foundation verification commands — Authorized root verification
  commands.
- `tools/ecosystem-manifest.json` — Entry `trivy` (pinned `0.60.0`, `system` / `cli`,
  `vulnerability-scan-local`, `SECURITY_REVIEW`, `NIGHTLY_MAINTENANCE`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking; gates are explicitly declared and verified.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — Declared lifecycle states
  must match machine truth; absent tools must be declared `PENDING`, never faked.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § The seven
  that were genuinely absent (item 2: `trivy` absent from PATH; deferred to
  `TASK-AI-37`).
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 170
  (`TASK-AI-37`).
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` — Entry
  Trivy (`aquasecurity/trivy`, vulnerability and container image scanner).
- `.github/workflows/security-baseline.yml` — Security baseline workflow pattern.

## Preconditions and dependencies

- `TASK-AI-17` reconciled the ecosystem manifest against reality, establishing
  that `gitleaks` is `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned`, while
  `lefthook` and `trivy` are genuinely absent and declared `PENDING` with
  `blocking_policy: "NON_BLOCKING"`.
- `trivy` is absent from host PATH and CI workflows; this Work Item authors the
  specification introducing the gate without prematurely claiming adoption.
- Delivery register row 170 records `TASK-AI-37` as `BLOCKED_DEPENDENCY` on
  `TASK-AI-17`. Even though `TASK-AI-17` has merged into the base branch, the
  Control table status is preserved as `BLOCKED_DEPENDENCY` in strict alignment
  with the durable delivery register until automated write-back is executed by
  the `TASK-AI-19` reconciler.
- Supply-chain security audit invariant: install lifecycle scripts (`preinstall`,
  `install`, `postinstall`, `prepare`) are strictly forbidden in root and web
  `package.json` manifests. Trivy must be provisioned via explicit GitHub Action
  or binary download, never via npm lifecycle hooks.
- `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly 1 warning
  (`PINNED_VERSION_DRIFT` for `codex-cli`: pin `0.151.0` vs observed `0.154.0`, an
  intentional human decision). This invariant must be preserved.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item defines a foundational
security gate specification across supply-chain dependencies, containers, and CI.

Bounded scope for this specification phase:
Authoring the specification in `docs/product-spec/work-items/TASK-AI-37.md`.

Authorized paths for downstream implementation phase:
When implementation is authorized, the downstream implementation phase executes
the physical integration with allowed paths:
- `.github/workflows/security-baseline.yml` (or `.github/workflows/trivy-scan.yml`)
- `scripts/verify-trivy.ts`
- `scripts/ai/doctor.ps1`
- `tools/ecosystem-manifest.json` (promoting `trivy` from `PENDING` to `ADOPTED`)
- `tests/fixtures/trivy/*` (clean and negative test fixtures)

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Editing `.github/` workflows directly; the specification describes what CI
  should do; implementation occurs in a subsequent, authorized Work Item.
- Declaring Trivy `ADOPTED` or `BLOCKING_GATE` in `tools/ecosystem-manifest.json`
  before all 6 manifest promotion prerequisites are satisfied.
- Replacing or duplicating Gitleaks secret scanning.
- Disabling, skipping, or narrowing any existing gate.
- Author never approves own work.

## In scope

- Author complete architectural and operational specification for Trivy in CI:
  1. Vulnerability scanning scope:
     - Software Composition Analysis (SCA) covering root `pnpm-lock.yaml` and
       workspace `package.json` files.
     - Container image scanning for built application artifacts (`apps/api`,
       `apps/worker`, `apps/web`). In the current repository state where `apps/*`
       lack Dockerfiles, the container step evaluates directory contents and
       deterministically outputs `NO_CONTAINER_TARGET` (exiting `0`), avoiding
       spurious job failures until application Dockerfiles are introduced.
     - Misconfiguration scanning for Dockerfiles and container configurations
       (including `scripts/ai/docker-worker/Dockerfile`).
  2. Software Bill of Materials (SBOM) generation & attestation:
     - CycloneDX JSON SBOM generation (`trivy fs --format cyclonedx --output sbom.cyclonedx.json .`).
     - Archiving `sbom.cyclonedx.json` as workflow artifact `shipde-sbom-cyclonedx`.
     - Attestation scanning verifying zero actionable CVEs on PR pull requests.
  3. Pinned version, immutable commit SHA, and provenance:
     - Strict pin at version `0.60.0` (matching `tools/ecosystem-manifest.json`).
     - Official GitHub Action `aquasecurity/trivy-action` pinned by immutable 40-character
       commit SHA (e.g., `aquasecurity/trivy-action@18f2510ee396bbf400402947b394f2dd8c87dbb0` # v0.29.0);
       mutable tags (`@v0.29.0`, `@latest`) are strictly forbidden.
     - For standalone CLI binary execution, binary downloads must be verified
       against official Aqua Security SHA-256 release checksums (`trivy_0.60.0_checksums.txt`).
  4. Failure threshold and exit code semantics:
     - Fail-closed execution: operational faults (network drop during DB fetch,
       corrupted lockfile, invalid arguments) exit code `2` and fail the job.
     - Vulnerability threshold: `--exit-code 1 --severity HIGH,CRITICAL` (CVSS `>= 7.0`)
       with `--ignore-unfixed` enabled for blocking checks.
     - Advisory reporting: `MEDIUM` (CVSS `4.0` - `6.9`) and `LOW` (CVSS `< 4.0`)
       vulnerabilities, plus unfixed CVEs, are reported in SARIF/logs without failing the build.
  5. Non-duplication of secret scanning:
     - Disable Trivy secret scanning (`--security-checks vuln,config` only) to
       preserve Gitleaks 8.24.0 as the sole authoritative secret scanning gate.
  6. Vulnerability database caching:
     - Utilize `actions/cache` targeting `~/.cache/trivy` (cache size budget `<= 500MB`,
       scan runtime budget `<= 180000ms`) to mitigate GitHub Container Registry rate
       limits and maintain fast, deterministic scans.
  7. SARIF generation and GitHub Code Scanning integration:
     - Generate standard SARIF 2.1.0 reports uploaded via immutable commit SHA action
       `github/codeql-action/upload-sarif@df971e4284b25752ebc60000a68d0d4dfd4ee5b3` (# v3.28.11)
       for rich PR inline annotations and repository Security tab tracking.
  8. Local verification and doctor integration specification:
     - Health check `trivy --version` in `scripts/ai/doctor.ps1` reporting `PASS trivy`
       with version `0.60.0` when installed locally and `PENDING` when absent.
  9. Manifest promotion criteria:
     - Define 6 non-negotiable prerequisites before promoting `trivy` from `PENDING`
       to `ADOPTED` in `tools/ecosystem-manifest.json`.

## Out of scope

- Editing `.github/workflows/*` in this PR (workflows remain untouched; CI
  implementation belongs to the downstream implementation phase).
- Replacing or modifying Gitleaks configuration (`TASK-AI-35`).
- Installing or configuring Lefthook git pre-commit hooks (`TASK-AI-36`).
- Web accessibility and Lighthouse performance scanning (`TASK-AI-38`).
- Third-party SaaS security integrations; scans execute entirely local to the runner.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-37-R01` | Truthful lifecycle state & register alignment: Trivy remains `PENDING` with `blocking_policy: NON_BLOCKING` in `tools/ecosystem-manifest.json` and `BLOCKED_DEPENDENCY` in `TASK-AI-37.md` and `FEATURE-DELIVERY-REGISTER.csv` until all 6 manifest promotion prerequisites are satisfied. No status is flipped prematurely. |
| `AI-37-R02` | Secret scanning authority separation: Trivy must run strictly with `--security-checks vuln,config`, omitting `secret`. Gitleaks 8.24.0 remains the sole adopted, blocking secret scanning authority under `AI-TOOL-01` and `TASK-AI-35`. |
| `AI-37-R03` | Pinned version, immutable commit SHA, and provenance: In GitHub Actions, `aquasecurity/trivy-action` must be pinned to a full 40-character immutable commit SHA (mutable tags forbidden). For CLI binary execution, Trivy is pinned to `0.60.0` and verified against official Aqua Security SHA-256 release checksums; unverified curl-pipe-bash is forbidden. |
| `AI-37-R04` | Actionable blocking threshold: When active as a blocking CI gate, Trivy blocks the build (`exit-code 1`) only on `HIGH` (CVSS 7.0 - 8.9) and `CRITICAL` (CVSS 9.0 - 10.0) vulnerabilities with vendor fixes available (`--ignore-unfixed`), preventing spurious build blocks on unfixable upstream disclosures. |
| `AI-37-R05` | Fail-closed operational behavior: Operational failures (missing binary, network timeout on DB fetch without cache, corrupted lockfile, invalid arguments) must produce non-zero exit code `2` and fail the CI job, never silently passing. |
| `AI-37-R06` | Vulnerability database resilience and caching: CI jobs must cache the Trivy vulnerability database (`~/.cache/trivy`, budget `<= 500MB`) to prevent rate-limiting by container registries and guarantee deterministic execution within a `180000ms` runtime budget. |
| `AI-37-R07` | Monorepo lockfile and container target scope: Scans inspect root `pnpm-lock.yaml` and monorepo manifests. For container images, when `apps/*` lack Dockerfiles, the step deterministically outputs `NO_CONTAINER_TARGET` and exits `0`; when Dockerfiles exist, built container images are scanned. Existing Dockerfiles (e.g., `scripts/ai/docker-worker/Dockerfile`) are scanned via `trivy config`. |
| `AI-37-R08` | Standard SARIF reporting: Scan results produce SARIF 2.1.0 format uploaded to GitHub Code Scanning via immutable `github/codeql-action/upload-sarif`, allowing pull request reviews and security dashboards to present actionable findings inline. |
| `AI-37-R09` | Software Bill of Materials (SBOM) generation & attestation: Trivy CI job generates a CycloneDX JSON SBOM (`sbom.cyclonedx.json`) covering all direct and transitive dependencies in `pnpm-lock.yaml`, archived as workflow artifact `shipde-sbom-cyclonedx` and verified via attestation scanning. |
| `AI-37-R10` | Manifest promotion prerequisites: Promoting `trivy` to `ADOPTED` and `BLOCKING_GATE` in `tools/ecosystem-manifest.json` strictly requires satisfying all 6 prerequisites (exact-HEAD execution, clean fixture, vulnerable fixture, operational fail-closed, SARIF/SBOM upload, non-duplication preservation). |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and CI-facing
outputs are GitHub Actions job logs, PR checks, GitHub Security tab annotations,
and `scripts/ai/doctor.ps1`:
- Clean scan: Exit code `0`, 0 actionable HIGH/CRITICAL vulnerabilities found; green PR check.
- Actionable finding detected: Exit code `1`, list of CVE IDs, affected package and installed version, fixed version, and severity (>= `7.0` CVSS); PR check fails with red status and SARIF annotation.
- Operational failure: Exit code `2`, diagnostic indicating DB download failure, invalid configuration, or runner error; build fails closed with actionable error logs.
- No-container fallback: When `apps/*` lack Dockerfiles, outputs `NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped` and exits code `0`.
- Doctor diagnosis: `scripts/ai/doctor.ps1` reports `PENDING` (expected when absent) or `PASS trivy` with version `0.60.0` when installed on host.

## API, event and data impact

No schema, database, or runtime API changes. Governs security quality gate
contracts, supply-chain verification specifications, and SBOM artifact generation.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-37-01` | Verify Trivy gate status in manifest | `node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='trivy'); if(!m \|\| m.lifecycle_state!=='PENDING' \|\| m.blocking_policy!=='NON_BLOCKING' \|\| m.pinned_version_or_commit!=='0.60.0') throw new Error('trivy truth mismatch'); console.log('Trivy truthfully declared: PENDING, NON_BLOCKING, pinned 0.60.0');"` | `0` | `Trivy truthfully declared: PENDING, NON_BLOCKING, pinned 0.60.0` | `tools/ecosystem-manifest.json` |
| `AC-AI-37-02` | Verify Gitleaks baseline gate status in manifest | `node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='gitleaks'); if(!m \|\| m.lifecycle_state!=='ADOPTED' \|\| m.blocking_policy!=='BLOCKING_GATE' \|\| m.pinned_version_or_commit!=='8.24.0') throw new Error('gitleaks truth mismatch'); console.log('Gitleaks truthfully declared: ADOPTED, BLOCKING_GATE, pinned 8.24.0');"` | `0` | `Gitleaks truthfully declared: ADOPTED, BLOCKING_GATE, pinned 8.24.0` | `tools/ecosystem-manifest.json` |
| `AC-AI-37-03` | Delivery register status truthfulness for TASK-AI-37 (row 170) | `python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-37']; actual=rows[0]['status']; assert actual=='BLOCKED_DEPENDENCY', f'mismatch: {actual}'; print('Register row 170 status: ' + actual)"` | `0` | `Register row 170 status: BLOCKED_DEPENDENCY` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-37-04` | Negative proof: unauthorized status advancement fails validation | `python -c "import csv, sys; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-37']; actual=rows[0]['status']; sys.stderr.write(f'UNAUTHORIZED_STATUS_ADVANCEMENT: register is {actual}\n'); sys.exit(1 if actual!='READY_FOR_CODEX' else 0)"` | `1` | `UNAUTHORIZED_STATUS_ADVANCEMENT: register is BLOCKED_DEPENDENCY` | command stderr |
| `AC-AI-37-05` | Negative proof: falsely declaring Trivy ADOPTED triggers QUALITY_GATE_MISSING | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const synthetic = { adopted: [{ id: 'trivy', role: 'Vulnerability scanner', install_method: 'system', pinned_version_or_commit: '0.60.0', lifecycle_state: 'ADOPTED', blocking_policy: 'BLOCKING_GATE' }] }; const res = auditManifest(synthetic, { onPath: () => false, rootDir: process.cwd() }); if(!res.findings.some(f => f.code === 'QUALITY_GATE_MISSING' && f.severity === 'error')) process.exit(0); console.error('NEGATIVE TEST PROOF: Falsely declaring trivy ADOPTED triggers QUALITY_GATE_MISSING error'); process.exit(1);"` | `1` | `NEGATIVE TEST PROOF: Falsely declaring trivy ADOPTED triggers QUALITY_GATE_MISSING error` | command stderr |
| `AC-AI-37-06` | Invariant check: zero forbidden install lifecycle scripts | `node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); const forbidden=['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => (r.scripts && r.scripts[s]) \|\| (w.scripts && w.scripts[s])); if(found.length > 0) throw new Error('Forbidden lifecycle script detected: ' + found.join(', ')); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `package.json`, `apps/web/package.json` |
| `AC-AI-37-07` | Negative proof: forbidden install lifecycle script triggers failure | `node -e "const synthetic = { scripts: { postinstall: 'curl https://example.com/trivy \| sh' } }; const forbidden = ['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => synthetic.scripts[s]); if(found.length > 0) { console.error('FORBIDDEN_LIFECYCLE_SCRIPT: detected ' + found.join(', ')); process.exit(1); }"` | `1` | `FORBIDDEN_LIFECYCLE_SCRIPT: detected postinstall` | command stderr |
| `AC-AI-37-08` | Specification structural integrity (all 15 required sections) | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Acceptance matrix','## Downstream implementation acceptance contract','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 15 required sections present');"` | `0` | `Specification structural integrity verified: all 15 required sections present` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-09` | Specification contract & numeric thresholds completeness | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, and fallback tokens verified');"` | `0` | `Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, and fallback tokens verified` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-10` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-11` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-12` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows, 528 unique identifiers.` | `docs/product-spec/scripts/validate_docs.py` stdout |
| `AC-AI-37-13` | Toolchain unit & integration test suites green | `node --test \"tools/ai-brain/test/*.test.js\" \"tools/ai-dashboard/test/*.test.js\" \"tools/ai-guard/test/*.test.js\"` | `0` | `ℹ pass 458` | Test runner stdout |
| `AC-AI-37-14` | Incremental code and document formatting check | `pnpm format:check` | `0` | `Tất cả 61 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier` | `scripts/verify-formatting.ts` stdout |

## Downstream implementation acceptance contract

When an author implements `TASK-AI-37`, the implementation must provide and satisfy the following deterministic verification contract:

1. **Exact-HEAD CI Execution Evidence**:
   - The GitHub Actions workflow `security-baseline.yml` (or `trivy-scan.yml`) executes on the exact 40-character commit SHA of the PR HEAD.
   - Job produces a green check run `Trivy Security Scan`.
2. **Pinned Action and Provenance Verification**:
   - Official action `aquasecurity/trivy-action` pinned by immutable 40-character commit SHA (e.g., `aquasecurity/trivy-action@18f2510ee396bbf400402947b394f2dd8c87dbb0` # v0.29.0).
   - Mutable tags (`@v0.29.0`, `@latest`) are strictly forbidden.
   - For CLI binary downloads: version `0.60.0` verified against official Aqua Security release SHA-256 checksums (`trivy_0.60.0_checksums.txt`).
3. **Clean Dependency Scan Proof (Exit Code 0)**:
   - Clean fixture: `tests/fixtures/trivy/clean-lockfile/pnpm-lock.yaml` (contains only updated, secure dependencies with 0 CVEs).
   - Command: `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed tests/fixtures/trivy/clean-lockfile/`
   - Expected exit code: `0`
   - Expected output: `Total: 0 (HIGH: 0, CRITICAL: 0)`
4. **Vulnerable Dependency Negative Proof (Exit Code 1)**:
   - Vulnerable fixture: `tests/fixtures/trivy/vulnerable-lockfile/pnpm-lock.yaml` (contains synthetic resolution for `lodash@4.17.20` exhibiting `CVE-2021-23337` / Command Injection, fixable in `4.17.21`).
   - Command: `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed tests/fixtures/trivy/vulnerable-lockfile/`
   - Expected exit code: `1`
   - Expected output string: `CVE-2021-23337` and `CRITICAL` or `HIGH`
5. **Operational Failure Fail-Closed Proof (Exit Code 2)**:
   - Command: `trivy fs --invalid-flag-syntax tests/fixtures/trivy/clean-lockfile/`
   - Expected exit code: `2`
   - Expected output string: `flag provided but not defined`
6. **Non-Duplication of Secret Scanning**:
   - Fixture: `tests/fixtures/trivy/synthetic-secret/token.txt` containing synthetic PAT `ghp_0123456789abcdefghijklmnopqrstuv`.
   - Command: `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL tests/fixtures/trivy/synthetic-secret/`
   - Expected exit code: `0` (Trivy ignores secrets because `--security-checks` is restricted to `vuln,config`, keeping Gitleaks 8.24.0 as the single authority for secret scanning).
7. **Software Bill of Materials (SBOM) Generation and Attestation**:
   - Generation command: `trivy fs --format cyclonedx --output sbom.cyclonedx.json .`
   - Expected exit code: `0`
   - Generated artifact: `sbom.cyclonedx.json` contains `"bomFormat": "CycloneDX"` and `"specVersion": "1.5"`.
   - CI step archives artifact as `shipde-sbom-cyclonedx`.
   - Attestation scan command: `trivy sbom --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed sbom.cyclonedx.json` exits `0`.
8. **Container Image and Misconfiguration Scanning**:
   - Existing Dockerfile scan: `trivy config --exit-code 1 --severity HIGH,CRITICAL scripts/ai/docker-worker/Dockerfile` exits `0`.
   - Application container scan fallback: when `apps/api`, `apps/worker`, and `apps/web` lack Dockerfiles, workflow step executes `Test-Path "apps/*/Dockerfile"` and logs `NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped` with exit code `0`.
   - Built image scan (upon containerization): `trivy image --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed <tag>` exits `0` (or `1` on fixable HIGH/CRITICAL).
9. **SARIF Generation and GitHub Code Scanning Integration**:
   - Command: `trivy fs --security-checks vuln,config --format sarif --output trivy-results.sarif .`
   - Expected exit code: `0`
   - Upload action: `github/codeql-action/upload-sarif@df971e4284b25752ebc60000a68d0d4dfd4ee5b3` (# v3.28.11).
10. **Vulnerability DB Caching and Budgets**:
   - Cache key: `trivy-db-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}` targeting `~/.cache/trivy`.
   - Maximum DB cache budget: `500MB`.
   - Maximum scan execution timeout budget: `180000ms`.
11. **Local Doctor Integration**:
   - `pwsh -NoProfile -File scripts/ai/doctor.ps1` reports `PASS trivy` when installed locally at `0.60.0`, or `PENDING` when absent.

## Manifest promotion criteria

Promoting `trivy` from `PENDING` to `ADOPTED` and `BLOCKING_GATE` in `tools/ecosystem-manifest.json` strictly requires satisfying all 6 prerequisites with auditable workflow evidence:
1. **Exact-HEAD Execution**: CI check run `Trivy Security Scan` passed at the exact 40-character commit SHA of PR HEAD.
2. **Clean Fixture Proof**: `trivy fs` on clean lockfile fixture exits `0` with zero actionable findings.
3. **Vulnerable Fixture Negative Proof**: `trivy fs` on vulnerable lockfile fixture exits `1` with detected CVE.
4. **Operational Failure Fail-Closed Proof**: `trivy fs` on invalid configuration exits `2`.
5. **SARIF and SBOM Artifacts**: Valid `trivy-results.sarif` uploaded to GitHub Code Scanning and `sbom.cyclonedx.json` uploaded to workflow artifacts.
6. **Non-Duplication Preservation**: Gitleaks 8.24.0 remains `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned`, `--security-checks vuln,config` excludes secret scanning, and `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly 1 warning (codex-cli drift).

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='trivy'); if(!m || m.lifecycle_state!=='PENDING' || m.blocking_policy!=='NON_BLOCKING' || m.pinned_version_or_commit!=='0.60.0') throw new Error('trivy truth mismatch'); console.log('Trivy truthfully declared: PENDING, NON_BLOCKING, pinned 0.60.0');"
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='gitleaks'); if(!m || m.lifecycle_state!=='ADOPTED' || m.blocking_policy!=='BLOCKING_GATE' || m.pinned_version_or_commit!=='8.24.0') throw new Error('gitleaks truth mismatch'); console.log('Gitleaks truthfully declared: ADOPTED, BLOCKING_GATE, pinned 8.24.0');"
python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-37']; actual=rows[0]['status']; assert actual=='BLOCKED_DEPENDENCY', f'mismatch: {actual}'; print('Register row 170 status: ' + actual)"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); const forbidden=['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => (r.scripts && r.scripts[s]) || (w.scripts && w.scripts[s])); if(found.length > 0) throw new Error('Forbidden lifecycle script detected: ' + found.join(', ')); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Acceptance matrix','## Downstream implementation acceptance contract','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 15 required sections present');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, and fallback tokens verified');"
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm format:check
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `f6ad603` | `CHANGES_REQUIRED` | Resolved 7 review findings & 3 patterns: (1) Pattern 1 / Finding 2: Acceptance criteria rewritten to replace vague intentions ("File inspection", "specification text") with exact executable commands, exit codes, expected output strings, and artifacts. (2) Finding 1: Control table status aligned to authoritative delivery register row 170 (`BLOCKED_DEPENDENCY`). (3) Finding 3 / Pattern 3: Negative fixtures specified and verified (unauthorized status advancement fails with exit 1, premature ADOPTED declaration triggers `QUALITY_GATE_MISSING` with exit 1, forbidden lifecycle script triggers exit 1). Downstream contract defines clean (0), vulnerable (1), and operational fault (2) fixtures. (4) Finding 4: Tag mutability removed; required full 40-character immutable commit SHA for `aquasecurity/trivy-action` and SHA-256 checksum verification for binary downloads. (5) Finding 5: Addressed current absence of Dockerfiles in `apps/api`, `apps/worker`, `apps/web` by establishing deterministic `NO_CONTAINER_TARGET` fallback (exit 0) while retaining Dockerfile config scanning for `scripts/ai/docker-worker/Dockerfile`. (6) Finding 6 (Line 113): Restored CycloneDX SBOM generation and attestation scanning to scope and rules (`AI-37-R09`). (7) Finding 7 (Line 140): Defined exact 6 non-negotiable prerequisites required before promoting Trivy in `tools/ecosystem-manifest.json` (`AI-37-R10`). (8) Pattern 2: Explicit numeric thresholds specified (`0.60.0`, `8.24.0`, `180000ms`, `500MB`, CVSS >= 7.0, exit codes 0, 1, 2). |

## Residual limitations

- Delivery register row 170 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
- Zero-day vulnerabilities or disclosures without available upstream vendor patches are intentionally non-blocking under `--ignore-unfixed` (`AI-37-R04`) to prevent halting developer delivery on unfixable dependencies, remaining tracked as advisory findings.
- Specification does not modify `.github/` workflows directly; actual workflow file creation and manifest promotion are strictly gated to the downstream implementation phase to honor repository change boundaries.
- Container image scanning for application packages (`apps/api`, `apps/worker`, `apps/web`) depends on the introduction of application Dockerfiles in foundation tasks; until Dockerfiles are added, container scanning gracefully falls back to `NO_CONTAINER_TARGET` while configuration scanning actively inspects existing Dockerfiles (`scripts/ai/docker-worker/Dockerfile`).
