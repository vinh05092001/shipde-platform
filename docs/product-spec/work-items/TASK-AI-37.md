# TASK-AI-37 — Trivy dependency and container scanning in CI

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-37` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `170` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-37.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-37-trivy` |
| Pull Request | `<URL>` |

## Business outcome

The Ship Dễ continuous delivery pipeline requires automated supply-chain,
dependency vulnerability, and container security scanning to detect known Common
Vulnerabilities and Exposures (CVEs), package misconfigurations, and vulnerable
third-party dependencies before changes reach production or merge into `main`.

Currently, secret scanning is actively enforced in CI by Gitleaks 8.24.0
(`ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`). However, automated Software
Composition Analysis (SCA) and container vulnerability scanning are absent;
`aquasecurity/trivy` is truthfully documented as `PENDING` with
`blocking_policy: NON_BLOCKING` in `tools/ecosystem-manifest.json` following
`TASK-AI-17`.

`TASK-AI-37` establishes the authoritative specification for introducing Trivy
vulnerability scanning into the CI pipeline as an automated, fail-closed quality
gate. It defines:
1. Dependency vulnerability scanning across `pnpm-lock.yaml` and monorepo manifests.
2. Container image and Dockerfile misconfiguration scanning across applications.
3. Separation of authority: Trivy secret scanning is disabled to preserve Gitleaks
   as the single source of truth for secrets.
4. Vulnerability database caching to avoid registry rate limits and ensure fast CI.
5. Severity filtering and blocking criteria (`HIGH,CRITICAL` with `--ignore-unfixed`).
6. Standard SARIF output for inline PR annotations and GitHub Security tab integration.
7. Verification boundaries ensuring no `.github/` workflow modifications occur
   prior to the dedicated implementation phase.

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

Bounded scope: authoring the specification in
`docs/product-spec/work-items/TASK-AI-37.md`.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Editing `.github/` workflows directly; the specification describes what CI
  should do; implementation occurs in a subsequent, authorized Work Item.
- Declaring Trivy `ADOPTED` or `BLOCKING_GATE` in `tools/ecosystem-manifest.json`
  before the binary and CI integration exist.
- Replacing or duplicating Gitleaks secret scanning.
- Disabling, skipping, or narrowing any existing gate.
- Author never approves own work.

## In scope

- Author complete architectural and operational specification for Trivy in CI:
  1. Vulnerability scanning scope:
     - Software Composition Analysis (SCA) covering root `pnpm-lock.yaml` and
       workspace `package.json` files.
     - Container image scanning for built artifacts (`apps/api`, `apps/worker`,
       `apps/web`).
     - Misconfiguration scanning for Dockerfiles and container configurations.
  2. Pinned version and provenance:
     - Strict pin at version `0.60.0` (matching `tools/ecosystem-manifest.json`).
     - Official GitHub Action `aquasecurity/trivy-action` pinned by immutable tag
       or SHA commit, or pre-compiled binary with checksum verification.
  3. Failure threshold and exit code semantics:
     - Fail-closed execution: operational faults (network drop during DB fetch,
       corrupted lockfile, crash) exit code 2 and fail the job.
     - Vulnerability threshold: `--exit-code 1 --severity HIGH,CRITICAL` with
       `--ignore-unfixed` enabled for blocking checks.
     - Advisory reporting: `MEDIUM` and `LOW` vulnerabilities, plus unfixed CVEs,
       are reported in SARIF/logs without failing the build.
  4. Non-duplication of secret scanning:
     - Disable Trivy secret scanning (`--security-checks vuln,config` only) to
       preserve Gitleaks as the sole authoritative secret scanning gate.
  5. Vulnerability database caching:
     - Utilize `actions/cache` targeting `~/.cache/trivy` to mitigate GitHub
       Container Registry rate limits and maintain fast scan times.
  6. SARIF generation and GitHub Code Scanning integration:
     - Generate standard SARIF reports uploaded via `github/codeql-action/upload-sarif`
       for rich PR inline annotations and repository Security tab tracking.
  7. Local verification and doctor integration specification:
     - Health check `trivy --version` in `scripts/ai/doctor.ps1` reporting `PASS`
       when installed locally and `PENDING` when absent.
  8. Manifest promotion criteria:
     - Define criteria for promoting `trivy` from `PENDING` to `ADOPTED` in
       `tools/ecosystem-manifest.json`.

## Out of scope

- Editing `.github/workflows/*` in this PR (workflows remain untouched; CI
  implementation belongs to the implementation phase).
- Replacing or modifying Gitleaks configuration (`TASK-AI-35`).
- Installing or configuring Lefthook git pre-commit hooks (`TASK-AI-36`).
- Web accessibility and Lighthouse performance scanning (`TASK-AI-38`).
- Third-party SaaS security integrations; scans execute entirely local to the runner.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-37-R01` | Truthful lifecycle state: Trivy remains `PENDING` with `blocking_policy: NON_BLOCKING` in `tools/ecosystem-manifest.json` until CI integration is implemented and verified. No status is flipped prematurely. |
| `AI-37-R02` | Secret scanning authority separation: Trivy must not run secret scanning in CI. Gitleaks 8.24.0 remains the sole adopted, blocking secret scanning authority under `AI-TOOL-01` and `TASK-AI-35`. |
| `AI-37-R03` | Pinned version and provenance: Trivy binary or action must be strictly pinned to version `0.60.0` or immutable commit hash with cryptographic checksum verification; unpinned `@latest` or unversioned curl-pipe-bash is forbidden. |
| `AI-37-R04` | Actionable blocking threshold: When active as a blocking CI gate, Trivy must fail the build (`exit-code 1`) only on `HIGH` and `CRITICAL` vulnerabilities with vendor fixes available (`--ignore-unfixed`), preventing spurious build blocks on unfixable upstream disclosures. |
| `AI-37-R05` | Fail-closed operational behavior: Operational failures (missing binary, network timeout on DB fetch without cache, corrupted lockfile) must produce a non-zero exit code and fail the CI job, never silently passing. |
| `AI-37-R06` | Vulnerability database resilience and caching: CI jobs must cache the Trivy vulnerability database (`~/.cache/trivy`) to prevent rate-limiting by container registries and guarantee deterministic execution. |
| `AI-37-R07` | Monorepo lockfile and container scope: The scanner must inspect the monorepo root `pnpm-lock.yaml` as well as all workspace container artifacts (`apps/api`, `apps/worker`, `apps/web`), ensuring full vertical supply-chain coverage. |
| `AI-37-R08` | Standard SARIF reporting: Scan results must produce SARIF format uploaded to GitHub Code Scanning, allowing pull request reviews and security dashboards to present actionable findings inline. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and CI-facing
outputs are GitHub Actions job logs, PR checks, GitHub Security tab annotations,
and `scripts/ai/doctor.ps1`:
- Clean scan: Exit code 0, 0 actionable HIGH/CRITICAL vulnerabilities found; green PR check.
- Actionable finding detected: Exit code 1, list of CVE IDs, affected package and installed version, fixed version, and severity; PR check fails with red status and SARIF annotation.
- Operational failure: Exit code 2, diagnostic indicating DB download failure, invalid configuration, or runner error; build fails closed with actionable error logs.
- Doctor diagnosis: `scripts/ai/doctor.ps1` reports `PENDING` (expected when absent) or `PASS trivy` with version `0.60.0` when installed on host.

## API, event and data impact

No schema, database, or runtime API changes. Governs security quality gate
contracts and verification specifications.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-37-01` | Truthfulness of baseline gate status | `trivy` is accurately documented as `PENDING`, `NON_BLOCKING`, `absent from host PATH` in `tools/ecosystem-manifest.json`; `gitleaks` is recognized as `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` | `tools/ecosystem-manifest.json` and workflow review |
| `AC-AI-37-02` | Dependency and lockfile scanning specification | Specification defines scanning of `pnpm-lock.yaml` and monorepo manifests with version pin `0.60.0` | Specification text in `TASK-AI-37.md` |
| `AC-AI-37-03` | Container image and misconfiguration scanning specification | Specification defines Dockerfile and container image scanning for `apps/api`, `apps/worker`, and `apps/web` | Specification text in `TASK-AI-37.md` |
| `AC-AI-37-04` | Secret scanning non-duplication | Specification mandates disabling Trivy secret scanner to preserve Gitleaks as the single source of truth for secrets | Specification text and rule `AI-37-R02` |
| `AC-AI-37-05` | Actionable blocking threshold and fail-closed semantics | Specification mandates exit code 1 on `HIGH,CRITICAL` with `--ignore-unfixed`, and exit code 2 on operational faults | Specification text and rules `AI-37-R04`, `AI-37-R05` |
| `AC-AI-37-06` | Vulnerability DB caching and resilience | Specification defines caching architecture for `~/.cache/trivy` to mitigate registry rate limits | Specification text and rule `AI-37-R06` |
| `AC-AI-37-07` | SARIF reporting and PR annotation | Specification details SARIF generation and upload via `github/codeql-action/upload-sarif` | Specification text and rule `AI-37-R08` |
| `AC-AI-37-08` | Manifest audit and doc validation green | `node tools/ai-brain/cli.js manifest` passes with 0 errors and 1 warning (codex drift); `python docs/product-spec/scripts/validate_docs.py` passes with 0 errors | Validator CLI stdout |

## Verification commands

```powershell
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test tools/ai-brain/test/*.test.js tools/ai-dashboard/test/*.test.js tools/ai-guard/test/*.test.js
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

- Trivy vulnerability databases require periodic updates to detect newly published
  CVEs; offline environments or networks blocking GitHub Container Registry
  (`ghcr.io`) require database caching or internal mirroring.
- Zero-day vulnerabilities or disclosures without available upstream vendor
  patches are intentionally non-blocking under `--ignore-unfixed` (`AI-37-R04`) to
  prevent halting developer delivery on unfixable dependencies, remaining tracked
  as advisory findings.
- Specification does not modify `.github/` workflows directly; actual workflow file
  creation is strictly gated to the downstream implementation phase to honor
  repository change boundaries.
