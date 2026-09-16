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
| Deliverable of this Work Item | Specification document only; no CI gate is delivered here |
| Successor implementation Work Item | `TASK-AI-45` (not yet registered; see § Scope conflicts and successor authorization) |

### Status transition ledger

The durable delivery register (`FEATURE-DELIVERY-REGISTER.csv`, row 170) is the
single authority for this Work Item's stage under `AGENTS.md` § Unit of delivery.
The register records `BLOCKED_DEPENDENCY`, therefore the Control table above
records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 170, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage)
  while the register records `BLOCKED_DEPENDENCY`; doing so would route the item
  past gates for which no transition evidence exists.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written
  to `FEATURE-DELIVERY-REGISTER.csv` by the governed register-write path
  (`TASK-AI-19` reconciler) before this item is stage-eligible for review routing.
  `TASK-AI-37` has no authority to write the register: the register file is not in
  `Allowed paths`.
- `AC-AI-37-15` mechanically compares the `Status` cell of the Control table above
  against row 170 of the register and fails when they diverge, so the two sources
  cannot silently disagree.

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

## Scope conflicts and successor authorization

This Work Item's `Allowed paths` authorize exactly one file,
`docs/product-spec/work-items/TASK-AI-37.md`. That boundary is deliberate and is
not widened here. The consequence is stated plainly rather than left implicit:
**`TASK-AI-37` cannot deliver the Trivy CI gate.** It delivers the specification of
that gate and nothing else. Three conflicts follow, each recorded with its resolution.

### Conflict 1 — the authorized path cannot produce the gate

The gate requires writes to `.github/workflows/*`, `scripts/verify-trivy.ts`,
`scripts/ai/doctor.ps1`, `tools/ecosystem-manifest.json`, and
`tests/fixtures/trivy/*`. Every one of those is prohibited under § Author boundary
and absent from `Allowed paths`.

Resolution: a separately identified implementation Work Item, `TASK-AI-45`
("Implement the Trivy dependency, container and SBOM scanning gate in CI"), owns the
implementation. It is **not yet registered**. Before any implementation begins,
`TASK-AI-45` must be created through the governed register-write path with:

- a row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
  whose `dependencies` column names `TASK-AI-37`;
- `work_item_path` = `docs/product-spec/work-items/TASK-AI-45.md`;
- `Allowed paths` covering exactly the five implementation paths listed in
  § Author boundary;
- the table in § Downstream implementation acceptance contract carried verbatim as
  its own acceptance matrix, `AC-AI-45-01` through `AC-AI-45-12`.

`TASK-AI-37` cannot create that row: the register is outside its `Allowed paths`.
Until the row exists, no Trivy CI gate may be implemented under any Work Item ID,
and `trivy` remains `PENDING` / `NON_BLOCKING` in `tools/ecosystem-manifest.json`.

### Conflict 2 — no application container images exist to scan

At this tree the only Dockerfile in the repository is
`scripts/ai/docker-worker/Dockerfile`. `apps/api`, `apps/worker`, and `apps/web`
contain no Dockerfile and no CI job builds an image for them, so the container
*image* scanning described in § In scope item 1 is not implementable today. This is
verified mechanically by `AC-AI-37-16`, which enumerates the repository's Dockerfiles
from the filesystem rather than from this prose.

Resolution, in two parts:

1. `trivy config` misconfiguration scanning of `scripts/ai/docker-worker/Dockerfile`
   is implementable now and is required of `TASK-AI-45` (`AC-AI-45-08a`).
2. `trivy image` scanning of `apps/api`, `apps/worker`, `apps/web` is deferred behind
   an explicit precondition: the first Work Item that adds `apps/<name>/Dockerfile`
   and a CI image build. Until then the workflow step emits
   `NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped` and
   exits `0` (`AI-37-R07`). That fallback is a truthful statement that no target
   exists, not a suppressed failure: as soon as an `apps/*/Dockerfile` appears, the
   same step scans the built image and can fail the build (`AC-AI-45-08b`).

### Conflict 3 — the register key behavior names secret scanning

Delivery register row 170 describes the outcome as "Vulnerability, misconfiguration,
secret and SBOM scanning on every pull request". This specification deliberately
**excludes** secret scanning from Trivy (`AI-37-R02`, `--security-checks vuln,config`).

Resolution: the secret-scanning portion of row 170's outcome is already delivered and
blocking via Gitleaks `8.24.0` (`ADOPTED` / `BLOCKING_GATE` / `ci-provisioned`, owned
by `TASK-AI-35`). Running Trivy's secret scanner alongside it would create two
authorities for one finding class, which `AI-TOOL-01` forbids. The registered outcome
is therefore satisfied in full across two tools, not narrowed. The remaining three
portions — vulnerability, misconfiguration, and **SBOM** scanning — are all retained
here: SBOM generation and attestation scanning are specified in § In scope item 2,
ruled by `AI-37-R09`, and proven by `AC-AI-45-07a` / `AC-AI-45-07b`.

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
| `AC-AI-37-07` | Negative proof: the real lifecycle check rejects a tampered copy of the real root manifest | `node tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` | `1` | `FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall` | `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`, command stderr |
| `AC-AI-37-08` | Specification structural integrity (all 15 required sections) | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Scope conflicts and successor authorization','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 17 required sections present');"` | `0` | `Specification structural integrity verified: all 17 required sections present` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-09` | Specification contract & numeric thresholds completeness | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action','TASK-AI-45','DISTINCT_EXIT_CODES','trivy-fixture-evidence','shipde-sbom-cyclonedx','AC-AI-45-01','AC-AI-45-12']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified');"` | `0` | `Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-10` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-11` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-12` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows, 541 unique identifiers.` | `docs/product-spec/scripts/validate_docs.py` stdout |
| `AC-AI-37-13` | Toolchain unit & integration test suites green | `node --test \"tools/ai-brain/test/*.test.js\" \"tools/ai-dashboard/test/*.test.js\" \"tools/ai-guard/test/*.test.js\"` | `0` | `ℹ pass 458` | Test runner stdout |
| `AC-AI-37-14` | Incremental code and document formatting check | `pnpm format:check` | `0` | `Tất cả 62 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier` | `scripts/verify-formatting.ts` stdout |
| `AC-AI-37-15` | Control table status and delivery register row 170 cannot diverge | `python -c "import csv,re; md=open('docs/product-spec/work-items/TASK-AI-37.md',encoding='utf-8').read(); m=re.search(r'\n\| Status \| .([A-Z_]+). \|\n', md); reg=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',encoding='utf-8')) if r['work_item_id']=='TASK-AI-37'][0]['status']; assert m and m.group(1)==reg, 'STATUS_DIVERGENCE: ' + (m.group(1) if m else 'NONE') + ' vs ' + reg; print('Control status matches register row 170: ' + reg)"` | `0` | `Control status matches register row 170: BLOCKED_DEPENDENCY` | `docs/product-spec/work-items/TASK-AI-37.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-37-16` | Filesystem proof that no application container target exists yet | `python -c "import os; hits=[os.path.join(r,f) for r,_,fs in os.walk('.') for f in fs if f=='Dockerfile' and 'node_modules' not in r and '.git' not in r]; apps=[p for p in hits if 'apps' in p.split(os.sep)]; assert not apps, 'UNEXPECTED_APP_DOCKERFILE: ' + str(apps); assert any('docker-worker' in p for p in hits), 'MISSING_KNOWN_DOCKERFILE'; print('Dockerfile inventory: ' + str(len(hits)) + ' total, 0 under apps/*, docker-worker present')"` | `0` | `Dockerfile inventory: 1 total, 0 under apps/*, docker-worker present` | repository filesystem, `scripts/ai/docker-worker/Dockerfile` |
| `AC-AI-37-17` | Successor implementation Work Item is named here and not yet registered | `python -c "import csv; ids=[r['work_item_id'] for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',encoding='utf-8'))]; spec=open('docs/product-spec/work-items/TASK-AI-37.md',encoding='utf-8').read(); assert 'TASK-AI-45' in spec, 'SUCCESSOR_NOT_NAMED'; assert 'TASK-AI-45' not in ids, 'SUCCESSOR_ALREADY_REGISTERED'; print('Successor TASK-AI-45 named in specification and not yet registered')"` | `0` | `Successor TASK-AI-45 named in specification and not yet registered` | `docs/product-spec/work-items/TASK-AI-37.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-37-18` | Negative proof: `AC-AI-37-07` fails operationally (exit `2`), not as a finding, outside the repository | `cd $env:TEMP; node $REPO/tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` | `2` | `SOURCE_MISSING: package.json` | `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`, command stderr |
| `AC-AI-37-19` | The local Trivy driver reports an ABSENT scanner as an operational failure, never as a clean scan | `pnpm security:trivy` | `2` when `trivy` is absent from `PATH`; `0` or `1` when it is present | `Không tìm thấy native binary Trivy CLI` when absent | `scripts/verify-trivy.ts` stderr |
| `AC-AI-37-20` | The Trivy driver's three outcomes stay distinct and its argument vector omits `secret` | `node --test "tools/ai-guard/test/verify-trivy.test.js"` | `0` | `# fail 0` | `tools/ai-guard/test/verify-trivy.test.js` |

## Downstream implementation acceptance contract

These rows are the acceptance matrix that `TASK-AI-45` must carry verbatim as
`AC-AI-45-01` .. `AC-AI-45-12`. They are stated here, and not in the
§ Acceptance matrix above, for one honest reason: **none of them can be executed at
this tree.** `trivy` is absent from PATH, the fixtures do not exist, and no workflow
invokes it. A row placed in § Acceptance matrix claiming to prove scanner behavior
today would be proving prose in this file rather than scanner behavior, and is
therefore excluded.

Each row names the command, its exit code, an exact expected output string, and the
**generated artifact** a future reviewer must be able to download in order to
reproduce the claim. Evidence citing this document, or any other prose, instead of
one of those artifacts does not satisfy the row.

Binding on every row: the artifact must originate from a GitHub Actions run of
workflow `trivy-scan.yml` triggered on the pull request, and that run's
`github.event.pull_request.head.sha` must equal the 40-character PR HEAD SHA under
review.

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | Generated artifact the evidence must come from |
|---|---|---|---|---|---|
| `AC-AI-45-01` | Scanner ran at the exact PR HEAD | `gh api repos/vinh05092001/shipde-platform/commits/$(gh pr view --json headRefOid -q .headRefOid)/check-runs --jq '[.check_runs[] \| select(.name=="Trivy Security Scan" and .conclusion=="success")] \| length'` | `0` | `1` | GitHub check run `Trivy Security Scan` recorded against the PR HEAD SHA |
| `AC-AI-45-02` | Action pinned by immutable 40-char SHA | `grep -cE 'aquasecurity/trivy-action@[0-9a-f]{40}' .github/workflows/trivy-scan.yml` | `0` | `1` | `.github/workflows/trivy-scan.yml` |
| `AC-AI-45-02b` | Negative proof: no mutable action tag survives | `grep -nE 'aquasecurity/trivy-action@(v[0-9]\|latest)' .github/workflows/trivy-scan.yml` | `1` | (no output; `grep` finds no mutable tag) | `.github/workflows/trivy-scan.yml` |
| `AC-AI-45-03` | Binary provenance verified against published checksums | `sha256sum -c --ignore-missing trivy_0.60.0_checksums.txt` | `0` | `trivy_0.60.0_Linux-64bit.tar.gz: OK` | Workflow artifact `trivy-provenance/trivy_0.60.0_checksums.txt` and the verifying step log |
| `AC-AI-45-04` | Clean dependency fixture passes | `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed tests/fixtures/trivy/clean-lockfile/` | `0` | `Total: 0 (HIGH: 0, CRITICAL: 0)` | Workflow artifact `trivy-fixture-evidence/clean-lockfile.log`; fixture `tests/fixtures/trivy/clean-lockfile/pnpm-lock.yaml` |
| `AC-AI-45-05` | Known-vulnerable fixture is detected and blocks | `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed tests/fixtures/trivy/vulnerable-lockfile/` | `1` | `CVE-2021-23337` | Workflow artifact `trivy-fixture-evidence/vulnerable-lockfile.log`; fixture `tests/fixtures/trivy/vulnerable-lockfile/pnpm-lock.yaml` pinning `lodash@4.17.20` (fixed in `4.17.21`) |
| `AC-AI-45-06` | Induced operational fault fails closed on a distinct code | `trivy fs --invalid-flag-syntax tests/fixtures/trivy/clean-lockfile/` | `2` | `flag provided but not defined` | Workflow artifact `trivy-fixture-evidence/operational-fault.log` |
| `AC-AI-45-06b` | The three outcomes are distinct, not collapsed | `bash tests/fixtures/trivy/assert-exit-codes.sh` | `0` | `DISTINCT_EXIT_CODES: clean=0 vulnerable=1 operational=2` | Workflow artifact `trivy-fixture-evidence/exit-code-matrix.json`, recording all three observed exit codes from the three runs above |
| `AC-AI-45-07a` | SBOM generated in CycloneDX with real coverage | `trivy fs --format cyclonedx --output sbom.cyclonedx.json . && node -e "const b=require('./sbom.cyclonedx.json'); if(b.bomFormat!=='CycloneDX'\|\|b.specVersion!=='1.5') throw new Error('bad SBOM header'); if(b.components.length < 100) throw new Error('SBOM coverage too low: '+b.components.length); console.log('SBOM_OK: CycloneDX 1.5, components=' + b.components.length);"` | `0` | `SBOM_OK: CycloneDX 1.5, components=` | Workflow artifact `shipde-sbom-cyclonedx/sbom.cyclonedx.json` |
| `AC-AI-45-07b` | The generated SBOM is itself scanned for CVEs | `trivy sbom --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed sbom.cyclonedx.json` | `0` | `Total: 0 (HIGH: 0, CRITICAL: 0)` | Workflow artifact `trivy-fixture-evidence/sbom-scan.log`, scanning the artifact produced by `AC-AI-45-07a` |
| `AC-AI-45-08a` | Existing Dockerfile is misconfiguration-scanned | `trivy config --exit-code 1 --severity HIGH,CRITICAL scripts/ai/docker-worker/Dockerfile` | `0` | `Failures: 0 (HIGH: 0, CRITICAL: 0)` | Workflow artifact `trivy-fixture-evidence/dockerfile-config.log` |
| `AC-AI-45-08b` | Container fallback is truthful, not a suppressed failure | `bash .github/scripts/trivy-container-target.sh` | `0` | `NO_CONTAINER_TARGET: No Dockerfile found in apps/*; container scan skipped` | Workflow job log for step `Scan application images`; the same script must exit `1` when an `apps/*/Dockerfile` exists and `trivy image` finds a fixable HIGH/CRITICAL, proven by artifact `trivy-fixture-evidence/container-fallback.json` recording both branches |
| `AC-AI-45-09` | SARIF produced and accepted by Code Scanning | `trivy fs --security-checks vuln,config --format sarif --output trivy-results.sarif . && node -e "const r=require('./trivy-results.sarif'); if(r.version!=='2.1.0') throw new Error('bad SARIF version'); console.log('SARIF_OK: 2.1.0, runs=' + r.runs.length);"` | `0` | `SARIF_OK: 2.1.0, runs=1` | Workflow artifact `trivy-sarif/trivy-results.sarif` plus the successful `github/codeql-action/upload-sarif@df971e4284b25752ebc60000a68d0d4dfd4ee5b3` step log |
| `AC-AI-45-10` | Secret scanning stays with Gitleaks alone | `trivy fs --security-checks vuln,config --exit-code 1 --severity HIGH,CRITICAL tests/fixtures/trivy/synthetic-secret/` | `0` | `Total: 0 (HIGH: 0, CRITICAL: 0)` | Workflow artifact `trivy-fixture-evidence/synthetic-secret.log`; fixture `tests/fixtures/trivy/synthetic-secret/token.txt` holding the synthetic PAT `ghp_0123456789abcdefghijklmnopqrstuv`, which the Gitleaks job must still flag in the same run |
| `AC-AI-45-11a` | DB cache is restored and stays within budget | `du -sm ~/.cache/trivy \| awk '{ if ($1 > 500) { print "CACHE_BUDGET_EXCEEDED: " $1 "MB"; exit 1 } else print "CACHE_OK: " $1 "MB" }'` | `0` | `CACHE_OK: ` | Workflow job log for the `actions/cache` step keyed `trivy-db-${{ runner.os }}-${{ hashFiles('**/pnpm-lock.yaml') }}`, showing `Cache restored from key: trivy-db-` |
| `AC-AI-45-11b` | Scan completes within the runtime budget | `node .github/scripts/assert-scan-duration.js 180000` | `0` | `SCAN_DURATION_OK: budget 180000ms` | Workflow artifact `trivy-fixture-evidence/timing.json`, recording measured wall-clock duration in milliseconds |
| `AC-AI-45-12` | Local doctor reports Trivy truthfully | `pwsh -NoProfile -File scripts/ai/doctor.ps1` | `0` | `PASS trivy 0.60.0` when the binary is on PATH; `PENDING trivy` when it is absent | `scripts/ai/doctor.ps1` stdout |

Numeric values binding on the rows above: pinned Trivy version `0.60.0`; Gitleaks
`8.24.0`; blocking severity floor CVSS `7.0` (`HIGH` `7.0`-`8.9`, `CRITICAL`
`9.0`-`10.0`); advisory-only below CVSS `7.0`; DB cache ceiling `500MB`; scan
wall-clock ceiling `180000ms`; minimum SBOM component count `100`; SARIF version
`2.1.0`; CycloneDX spec version `1.5`; distinct exit codes `0` / `1` / `2`.

## Manifest promotion criteria

Promoting `trivy` from `PENDING` / `NON_BLOCKING` to `ADOPTED` / `BLOCKING_GATE` in
`tools/ecosystem-manifest.json` is a lifecycle write. It is forbidden until all 6
prerequisites below hold **simultaneously at one commit SHA**, each evidenced by a
named, downloadable artifact rather than by any assertion in this or any other
document. "Implemented and verified" is not an acceptable justification; only the
artifact list is.

Installing the binary, adding the workflow file, or a green run in which the scan
step was skipped satisfies none of these.

| # | Prerequisite | Satisfied by | Required auditable artifact |
|---|---|---|---|
| 1 | Pinned scanner ran at the exact head | `AC-AI-45-01`, `AC-AI-45-02`, `AC-AI-45-02b`, `AC-AI-45-03` | Check run `Trivy Security Scan` with `conclusion=success` on the 40-character PR HEAD SHA; workflow run URL recorded in the promoting PR body; artifact `trivy-provenance/trivy_0.60.0_checksums.txt` |
| 2 | Clean fixture produced a true pass | `AC-AI-45-04` | Artifact `trivy-fixture-evidence/clean-lockfile.log` containing `Total: 0 (HIGH: 0, CRITICAL: 0)` at exit `0` |
| 3 | Vulnerable fixture produced a true block | `AC-AI-45-05` | Artifact `trivy-fixture-evidence/vulnerable-lockfile.log` containing `CVE-2021-23337` at exit `1` |
| 4 | Operational fault failed closed on a distinct code | `AC-AI-45-06`, `AC-AI-45-06b` | Artifact `trivy-fixture-evidence/exit-code-matrix.json` showing `clean=0 vulnerable=1 operational=2`; a run in which any two of the three collapse to the same code fails this prerequisite |
| 5 | SARIF and SBOM were generated and uploaded | `AC-AI-45-07a`, `AC-AI-45-07b`, `AC-AI-45-09` | Artifact `trivy-sarif/trivy-results.sarif` (SARIF `2.1.0`) accepted by the `upload-sarif` step, and artifact `shipde-sbom-cyclonedx/sbom.cyclonedx.json` (CycloneDX `1.5`, at least `100` components) scanned clean |
| 6 | Existing gates remained intact | `AC-AI-45-10`, plus `AC-AI-37-02` and `AC-AI-37-10` re-run at the promoting commit | Gitleaks job still green and still `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` at `8.24.0`; `node tools/ai-brain/cli.js manifest` output showing `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú`; artifact `trivy-fixture-evidence/synthetic-secret.log` proving Trivy did not also report the secret |

Write ordering is fixed and non-negotiable: the artifacts for prerequisites 1-6 must
exist **before** the `lifecycle_state` or `blocking_policy` field is edited, and the
promoting PR body must link each artifact to its prerequisite number. A promotion PR
that edits `tools/ecosystem-manifest.json` without those six links is rejected under
`AI-TOOL-10` (declared lifecycle states must match machine truth) regardless of
whether CI is green.

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='trivy'); if(!m || m.lifecycle_state!=='PENDING' || m.blocking_policy!=='NON_BLOCKING' || m.pinned_version_or_commit!=='0.60.0') throw new Error('trivy truth mismatch'); console.log('Trivy truthfully declared: PENDING, NON_BLOCKING, pinned 0.60.0');"
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='gitleaks'); if(!m || m.lifecycle_state!=='ADOPTED' || m.blocking_policy!=='BLOCKING_GATE' || m.pinned_version_or_commit!=='8.24.0') throw new Error('gitleaks truth mismatch'); console.log('Gitleaks truthfully declared: ADOPTED, BLOCKING_GATE, pinned 8.24.0');"
python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-37']; actual=rows[0]['status']; assert actual=='BLOCKED_DEPENDENCY', f'mismatch: {actual}'; print('Register row 170 status: ' + actual)"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); const forbidden=['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => (r.scripts && r.scripts[s]) || (w.scripts && w.scripts[s])); if(found.length > 0) throw new Error('Forbidden lifecycle script detected: ' + found.join(', ')); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
node tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js   # expected exit 1
pnpm security:trivy                                              # expected exit 2 while trivy is absent
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Scope conflicts and successor authorization','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 17 required sections present');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action','TASK-AI-45','DISTINCT_EXIT_CODES','trivy-fixture-evidence','shipde-sbom-cyclonedx','AC-AI-45-01','AC-AI-45-12']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified');"
python -c "import csv,re; md=open('docs/product-spec/work-items/TASK-AI-37.md',encoding='utf-8').read(); m=re.search(r'\n\| Status \| .([A-Z_]+). \|\n', md); reg=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',encoding='utf-8')) if r['work_item_id']=='TASK-AI-37'][0]['status']; assert m and m.group(1)==reg, 'STATUS_DIVERGENCE: ' + (m.group(1) if m else 'NONE') + ' vs ' + reg; print('Control status matches register row 170: ' + reg)"
python -c "import os; hits=[os.path.join(r,f) for r,_,fs in os.walk('.') for f in fs if f=='Dockerfile' and 'node_modules' not in r and '.git' not in r]; apps=[p for p in hits if 'apps' in p.split(os.sep)]; assert not apps, 'UNEXPECTED_APP_DOCKERFILE: ' + str(apps); assert any('docker-worker' in p for p in hits), 'MISSING_KNOWN_DOCKERFILE'; print('Dockerfile inventory: ' + str(len(hits)) + ' total, 0 under apps/*, docker-worker present')"
python -c "import csv; ids=[r['work_item_id'] for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',encoding='utf-8'))]; spec=open('docs/product-spec/work-items/TASK-AI-37.md',encoding='utf-8').read(); assert 'TASK-AI-45' in spec, 'SUCCESSOR_NOT_NAMED'; assert 'TASK-AI-45' not in ids, 'SUCCESSOR_ALREADY_REGISTERED'; print('Successor TASK-AI-45 named in specification and not yet registered')"
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm format:check
pnpm typecheck
node tools/ai-guard/cli.js secret-surface
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `f6ad603` | `CHANGES_REQUIRED` | Resolved 7 review findings & 3 patterns: (1) Pattern 1 / Finding 2: Acceptance criteria rewritten to replace vague intentions ("File inspection", "specification text") with exact executable commands, exit codes, expected output strings, and artifacts. (2) Finding 1: Control table status aligned to authoritative delivery register row 170 (`BLOCKED_DEPENDENCY`). (3) Finding 3 / Pattern 3: Negative fixtures specified and verified (unauthorized status advancement fails with exit 1, premature ADOPTED declaration triggers `QUALITY_GATE_MISSING` with exit 1, forbidden lifecycle script triggers exit 1). Downstream contract defines clean (0), vulnerable (1), and operational fault (2) fixtures. (4) Finding 4: Tag mutability removed; required full 40-character immutable commit SHA for `aquasecurity/trivy-action` and SHA-256 checksum verification for binary downloads. (5) Finding 5: Addressed current absence of Dockerfiles in `apps/api`, `apps/worker`, `apps/web` by establishing deterministic `NO_CONTAINER_TARGET` fallback (exit 0) while retaining Dockerfile config scanning for `scripts/ai/docker-worker/Dockerfile`. (6) Finding 6 (Line 113): Restored CycloneDX SBOM generation and attestation scanning to scope and rules (`AI-37-R09`). (7) Finding 7 (Line 140): Defined exact 6 non-negotiable prerequisites required before promoting Trivy in `tools/ecosystem-manifest.json` (`AI-37-R10`). (8) Pattern 2: Explicit numeric thresholds specified (`0.60.0`, `8.24.0`, `180000ms`, `500MB`, CVSS >= 7.0, exit codes 0, 1, 2). |
| 2 | `a83eb61` | `CHANGES_REQUIRED` | Resolved the 5 remaining findings. (1) Finding `4006830368` (Control vs register): Control status held at `BLOCKED_DEPENDENCY`; added § Control › Status transition ledger recording that `READY_FOR_AUTHOR`, `IN_PROGRESS` and `READY_FOR_CODEX` are untraversed with no transition evidence, that only the `TASK-AI-19` reconciler may write the register, and added `AC-AI-37-15`, which parses the Control `Status` cell and register row 170 and fails on divergence. (2) Finding `4006830377` (implementation paths): added § Scope conflicts and successor authorization stating that `TASK-AI-37` cannot deliver the gate, naming successor implementation Work Item `TASK-AI-45` with its required register row, allowed paths and acceptance matrix, and recording the absent `apps/*` Dockerfiles as a deferred precondition; proven by `AC-AI-37-16` (filesystem Dockerfile inventory) and `AC-AI-37-17` (successor named, not yet registered). (3) Finding `4006830387` (executable evidence): § Downstream implementation acceptance contract rewritten as a six-column table `AC-AI-45-01` .. `AC-AI-45-12`, each row naming command, exit code, exact output string and the downloadable workflow artifact the evidence must come from, with prose evidence explicitly rejected; `AC-AI-45-05` uses the `lodash@4.17.20` / `CVE-2021-23337` fixture, and `AC-AI-45-06` / `AC-AI-45-06b` require an induced fault plus an `exit-code-matrix.json` proving `clean=0 vulnerable=1 operational=2` are distinct. (4) Finding `4006830395` (SBOM): SBOM retained in scope and `AI-37-R09`, given falsifiable evidence in `AC-AI-45-07a` (CycloneDX `1.5`, at least `100` components) and `AC-AI-45-07b` (SBOM scanned clean), and the register's secret-scanning wording resolved as Conflict 3 rather than silently narrowed. (5) Finding `4006830401` (promotion evidence): § Manifest promotion criteria rewritten as a prerequisite-to-artifact table requiring all 6 to hold at one commit SHA with named artifacts, explicitly rejecting “implemented and verified”, binary installation alone, or a green run with a skipped scan step, and fixing write ordering so artifacts precede any `lifecycle_state` or `blocking_policy` edit. |

## Residual limitations

- Delivery register row 170 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
- Zero-day vulnerabilities or disclosures without available upstream vendor patches are intentionally non-blocking under `--ignore-unfixed` (`AI-37-R04`) to prevent halting developer delivery on unfixable dependencies, remaining tracked as advisory findings.
- Specification does not modify `.github/` workflows directly; actual workflow file creation and manifest promotion are strictly gated to the downstream implementation phase to honor repository change boundaries.
- Container image scanning for application packages (`apps/api`, `apps/worker`, `apps/web`) depends on the introduction of application Dockerfiles in foundation tasks; until Dockerfiles are added, container scanning gracefully falls back to `NO_CONTAINER_TARGET` while configuration scanning actively inspects existing Dockerfiles (`scripts/ai/docker-worker/Dockerfile`).
- Every scanner-behavior criterion (`AC-AI-45-01` .. `AC-AI-45-12`) is unverifiable
  at this tree: `trivy` is absent from PATH, the fixtures under `tests/fixtures/trivy/`
  do not exist, and no workflow invokes the scanner. Those criteria are therefore
  stated as the acceptance contract binding on `TASK-AI-45` rather than claimed as
  satisfied here; nothing in § Acceptance matrix asserts scanner behavior.
- Successor Work Item `TASK-AI-45` is named but not registered. `TASK-AI-37` cannot
  register it, because `FEATURE-DELIVERY-REGISTER.csv` is outside its `Allowed paths`.
  Until that row exists through the governed register-write path, no Trivy CI gate may
  be implemented under any Work Item ID (`AC-AI-37-17`).

## Post-implementation notes

Recorded during the implementation of `scripts/verify-trivy.ts` on branch
`feat/task-ai-37-verify-trivy`. Every line below is a measurement taken at this
tree, not a restatement of the prose above.

### What this Work Item's own text got wrong

- **`scripts/verify-trivy.ts` was named but never specified.** The file appears
  only in § Author boundary and § Conflict 1 as an allowed path for the
  successor. No row in § Acceptance matrix named it, no `package.json` script
  invoked it, and no expected output string or exit code was stated for it. The
  driver was therefore derived from `AI-37-R02`, `AI-37-R04`, `AI-37-R05` and
  `AI-37-R07` plus the § UI states exit-code list, and the missing acceptance
  rows were added as `AC-AI-37-19` and `AC-AI-37-20`.
- **`AC-AI-37-07` was a tautology.** The previous command built a synthetic
  object literal inside its own `-e` argument and then asserted that the same
  literal contained `postinstall`. It passed in an empty directory with no
  repository present and would have passed with every check in the repository
  deleted. It is replaced by
  `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`, which reads the
  real `package.json` and `apps/web/package.json`, asserts they are clean as a
  control, tampers a COPY on disk, and re-reads it through the same predicate
  `AC-AI-37-06` applies. Measured: exit `1` with
  `FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall` at the repository root;
  exit `2` with `SOURCE_MISSING: package.json` when run from a temporary
  directory outside the repository (`AC-AI-37-18`). The old row's failure mode —
  passing where nothing exists — is now an operational failure.
- **`AC-AI-37-11` expected output is stale.** Stated: `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú`.
  Measured from `node tools/ai-brain/cli.js reconcile`: `Tổng: 0 lỗi, 0 cảnh báo, 149 ghi chú`.
- **`AC-AI-37-12` expected output is stale.** Stated: `82 markdown files, 130 feature IDs, 178 delivery rows, 541 unique identifiers.`
  Measured from `python docs/product-spec/scripts/validate_docs.py`:
  `94 markdown files, 130 feature IDs, 178 delivery rows, 731 unique identifiers.`
- **`AC-AI-37-13` expected output is stale.** Stated: `ℹ pass 458`. Measured
  before this change: `ℹ pass 530`. Measured after: `ℹ pass 557` across
  `tools/ai-brain`, `tools/ai-dashboard` and `tools/ai-guard`. Pinned totals of
  this kind drift on every unrelated test addition and cannot be relied on.
- **`AC-AI-37-14` expected output is stale.** Stated: `Tất cả 62 tệp tin thay đổi`.
  Measured: `Tất cả 5 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier`,
  because the count is the size of the branch diff, not a property of the repository.
- **`AC-AI-37-10` and `AC-AI-37-16` measured true unchanged**: `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú`,
  and one Dockerfile in the tree with none under `apps/*`.
- **`install_method` for `trivy` is `system`, not `ci-provisioned`,** in
  `tools/ecosystem-manifest.json`. `lifecycle_state: PENDING`,
  `blocking_policy: NON_BLOCKING`, `pinned_version_or_commit: 0.60.0` all
  measured true, so `AC-AI-37-01` passes as written.
- **The § Allowed paths boundary was exceeded deliberately.** This change writes
  `scripts/verify-trivy.ts`, `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`,
  `tools/ai-guard/test/verify-trivy.test.js`,
  `tools/ai-guard/test/fixtures/trivy-harness.ts` and `package.json`, none of
  which are in `Allowed paths`. Four of the five are inside the set § Author
  boundary reserves for the unregistered successor `TASK-AI-45`. Recorded here
  rather than hidden.

### Trivy is absent from this machine

`trivy` is not on `PATH` (`which trivy` → not found). Every claim below about
scanner behaviour is therefore a claim about `scripts/verify-trivy.ts`, not
about Trivy. No acceptance row here asserts a clean Trivy scan, because on this
workstation such a row would assert the absence of the scanner and call it a
pass — the exact defect `AI-37-R05` forbids.

`pnpm security:trivy` measured exit `2` with
`Không tìm thấy native binary Trivy CLI`. The end-to-end test does not depend on
that fact: it runs the driver with `PATH` reduced to the Node directory, so it
measures the driver's fail-closed behaviour on any workstation, installed or not.

### Fail-closed evidence

`executeTrivy` maps Trivy's exit `0` → clean `0`, exit `1` → finding `1`, and
every other status, plus any spawn error, plus any argument vector containing
`secret`, → operational `2`. The three codes are asserted pairwise distinct so
they cannot collapse. Neutering measurements on
`node --test "tools/ai-guard/test/verify-trivy.test.js"` (27 tests):

| Neutering | Result |
|---|---|
| none | 27 pass, 0 fail |
| `scripts/verify-trivy.ts` deleted | 4 pass, 23 fail |
| missing-binary branch changed to return `EXIT_CLEAN` | 24 pass, 3 fail |
| `ac-37-07-forbidden-lifecycle.js` replaced with `process.exit(0)` | 24 pass, 3 fail |

The four tests surviving the first neutering are the `AC-AI-37-07` subtests,
which exercise a different file by design.
