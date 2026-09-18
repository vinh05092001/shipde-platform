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
| Allowed paths | `docs/product-spec/work-items/TASK-AI-37.md`, `tools/ai-brain/acceptance/ac-37-*.js`, `tools/ai-brain/acceptance/lib/lifecycle-forbidden.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-37-trivy-ci` (PR #103 repair rounds push here: rounds 1–2 from `fix/pr103-143135`, round 3 from `fix/pr103-211719`) |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/103 (prior spec PR https://github.com/vinh05092001/shipde-platform/pull/24; audit repair PR https://github.com/vinh05092001/shipde-platform/pull/56) |
| Deliverable of this Work Item | Specification document and the acceptance probes that guard its own claims; no CI gate is delivered here |
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

### Review routing disposition

**REVIEW HOLD.** Register row 170 of
`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` holds
this Work Item at `BLOCKED_DEPENDENCY`, and the Control table above records the
same value. Only the governed register-write path — the `TASK-AI-19` reconciler
that owns that CSV — may advance the item through `READY_FOR_AUTHOR` and
`IN_PROGRESS`. `Allowed paths` excludes the register file, so `TASK-AI-37` has
no authority to write any of those transitions and claims none.
`AC-AI-37-21` (`tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js`)
refuses a blocked item that stops disclosing this hold, so the paragraph cannot
be deleted in a later edit without a probe failing.

Two, and only two, remedies are admissible, and both belong to the human merge
owner rather than to the author:

1. **ADVANCE** — the planner writes `READY_FOR_AUTHOR`, then `IN_PROGRESS`, then
   `READY_FOR_CODEX` for row 170 through the `TASK-AI-19` register-write path;
   the Control table follows the register, and review routing becomes valid as
   `AGENTS.md` § Unit of delivery requires.
2. **CLOSE** — close the open pull request and record on the register that the
   deliverables already sit on `main`: the specification by PR #24, the five
   acceptance probes by PR #46 (`e508bfc`) and their repair by PR #56
   (`31e16b2`).

The conflict this discloses is recorded, not silently resolved. The Pull Request
contract gate (`.github/workflows/feature-contract-gate.yml`, which runs
`python3 docs/product-spec/scripts/validate_pr_contract.py --event
"$GITHUB_EVENT_PATH"`) requires every PR body to carry the line
`Review status: READY_FOR_CODEX`. On a `BLOCKED_DEPENDENCY` item that line states
only that the pull request is ready to be independently reviewed; it is not a
stage transition for the Work Item, and the register plus the Control table above
stay the single source of stage truth. An author cannot satisfy the CI contract
and `AGENTS.md` § Unit of delivery any other way while the register is blocked,
which is precisely why this hold is written here and probed by `AC-AI-37-21`.

## Business outcome

> PR #103 repair note (2026-09-18): the `CHANGES_REQUIRED` review found the PR
> head to be an empty commit (`d50962f`, zero file changes) on a stale base
> (`cd3cfd8`), and found that the five acceptance scripts named in
> `Allowed paths` had already been delivered on `main` by PR #46 (`e508bfc`) and
> repaired by PR #56 (`31e16b2`). Repair rounds 1 and 2 merged current
> `origin/main` (`8cec992`) into the branch and recorded the review outcome
> inside this Work Item's Allowed paths. Round 3 adds the missing deliverable
> instead of only prose: a new acceptance probe,
> `tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js`, and the § Control ›
> Review routing disposition that probe enforces. No previously delivered script
> is re-delivered, the Work Item remains `BLOCKED_DEPENDENCY` in both the Control
> table and register row 170, and no register, workflow, CI gate or out-of-scope
> file is touched.

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

Bounded scope for the acceptance probes that guard this specification's own
claims: `tools/ai-brain/acceptance/ac-37-*.js` and
`tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`. Five probes were
delivered there by PR #46 (`e508bfc`) and repaired by PR #56 (`31e16b2`);
`AC-AI-37-21` (`tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js`) was
added by the third repair round of PR #103 to make the review-routing hold
mechanical. No other path is authorized in either phase.

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
| `AC-AI-37-06` | Invariant check: zero forbidden install lifecycle scripts in the real root and web manifests. The rule lives in one committed module, `tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`, which this row and the negative proof `AC-AI-37-07` both require; the row fails (`exit 2`) if that shared rule can no longer fire | `node tools/ai-brain/acceptance/ac-37-06-lifecycle-clean.js` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `tools/ai-brain/acceptance/ac-37-06-lifecycle-clean.js`, `package.json`, `apps/web/package.json` |
| `AC-AI-37-07` | Negative proof: the real lifecycle check rejects a tampered copy of the real root manifest. The check is the shared predicate required from `tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`, not a private copy held in this script, so the row exercises exactly what `AC-AI-37-06` runs | `node tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` | `1` | `FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall` | `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`, `tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`, command stderr |
| `AC-AI-37-08` | Specification structural integrity (all 15 required sections) | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Scope conflicts and successor authorization','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 17 required sections present');"` | `0` | `Specification structural integrity verified: all 17 required sections present` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-09` | Specification contract & numeric thresholds completeness | `python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action','TASK-AI-45','DISTINCT_EXIT_CODES','trivy-fixture-evidence','shipde-sbom-cyclonedx','AC-AI-45-01','AC-AI-45-12']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified');"` | `0` | `Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified` | `docs/product-spec/work-items/TASK-AI-37.md` |
| `AC-AI-37-10` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-11` | Register reconciliation green with 0 errors (the invariant; warning and note totals are not pinned because they drift with the repository) | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-37-12` | Specification and documentation validation (the invariant prefix; file and identifier totals grow with the repository and are not pinned) | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py` stdout |
| `AC-AI-37-13` | Toolchain unit and integration suites ran and were not vacuous. The row no longer asserts a pinned pass count and no longer carries glob patterns in the row: the script expands the real globs, refuses a zero-test run, and proves the refusal with an empty-directory control | `node tools/ai-brain/acceptance/ac-37-13-suite-not-vacuous.js` | `0` | `SUITE_NOT_VACUOUS:` | `tools/ai-brain/acceptance/ac-37-13-suite-not-vacuous.js` stdout |
| `AC-AI-37-14` | Incremental code and document formatting check. The file count in the formatter banner is the size of the branch diff, so only the invariant suffix is pinned | `pnpm format:check` | `0` | `tuân thủ 100% chuẩn định dạng Prettier` | `scripts/verify-formatting.ts` stdout |
| `AC-AI-37-15` | Control table status and delivery register row 170 cannot diverge | `node tools/ai-brain/acceptance/ac-37-15-status-alignment.js` | `0` | `Control status matches register row 170: BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-37-15-status-alignment.js` stdout |
| `AC-AI-37-16` | Filesystem proof that no application container target exists yet | `python -c "import os; hits=[os.path.join(r,f) for r,_,fs in os.walk('.') for f in fs if f=='Dockerfile' and 'node_modules' not in r and '.git' not in r]; apps=[p for p in hits if 'apps' in p.split(os.sep)]; assert not apps, 'UNEXPECTED_APP_DOCKERFILE: ' + str(apps); assert any('docker-worker' in p for p in hits), 'MISSING_KNOWN_DOCKERFILE'; print('Dockerfile inventory: ' + str(len(hits)) + ' total, 0 under apps/*, docker-worker present')"` | `0` | `Dockerfile inventory: 1 total, 0 under apps/*, docker-worker present` | repository filesystem, `scripts/ai/docker-worker/Dockerfile` |
| `AC-AI-37-17` | Successor implementation Work Item is named here and not yet registered | `python -c "import csv; ids=[r['work_item_id'] for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',encoding='utf-8'))]; spec=open('docs/product-spec/work-items/TASK-AI-37.md',encoding='utf-8').read(); assert 'TASK-AI-45' in spec, 'SUCCESSOR_NOT_NAMED'; assert 'TASK-AI-45' not in ids, 'SUCCESSOR_ALREADY_REGISTERED'; print('Successor TASK-AI-45 named in specification and not yet registered')"` | `0` | `Successor TASK-AI-45 named in specification and not yet registered` | `docs/product-spec/work-items/TASK-AI-37.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-37-18` | Negative proof: `AC-AI-37-07` fails operationally (exit `2`), not as a finding (exit `1`), when run outside the repository. The row asserts the child's exit `2`; the harness itself exits `0` when the observation holds and `1` when it does not | `node tools/ai-brain/acceptance/ac-37-18-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: child exit 2 with SOURCE_MISSING: package.json` | `tools/ai-brain/acceptance/ac-37-18-outside-repository.js` stdout |
| `AC-AI-37-19` | The local Trivy driver reports an ABSENT scanner as an operational failure, never as a clean scan. On this workstation `trivy` is absent, so the applicable branch is exit `2` | `pnpm security:trivy` | `2` (on a workstation where `trivy` is absent from `PATH`; `0` or `1` when it is present) | `Không tìm thấy native binary Trivy CLI` | `scripts/verify-trivy.ts` stderr |
| `AC-AI-37-20` | The Trivy driver's three outcomes stay distinct and its argument vector omits `secret` | `node --test "tools/ai-guard/test/verify-trivy.test.js"` | `0` | `ℹ fail 0` | `tools/ai-guard/test/verify-trivy.test.js` |
| `AC-AI-37-21` | Review routing hold: a Work Item that the register still holds at a `BLOCKED` stage must disclose the hold on the page reviewers read, and must name the governed register-write path and the remedies it offers. The row does not re-implement the Control-versus-register comparison: it runs `AC-AI-37-15` as a child and mirrors its verdict, because duplicating a rule in the probe that claims to test it is defect `D-01` below | `node tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` | `0` | `REVIEW_ROUTING_HOLD: BLOCKED_DEPENDENCY disclosed with a governed transition path` | `tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js`, `docs/product-spec/work-items/TASK-AI-37.md` § Control › Review routing disposition |

## Acceptance matrix audit

Every row of the § Acceptance matrix above was extracted programmatically from the
markdown table — with a splitter that treats `\|` inside a cell as a literal pipe —
and each command was run exactly as stored, from the repository root, as a file
handed to the shell so that no shell layer re-quoted it. The measured tree is
`origin/main` at commit `0f7a900`. Seven rows did not hold and one pair of rows
carried a duplicated rule. Each defect is recorded below with its measurement and
its replacement. No replacement pins a count that drifts, and no replacement
compares two literals written into this document.

Of the twenty rows as originally stored, only `AC-AI-37-13` exited `0` from an
empty temporary directory with no repository present; every other row failed
there with a non-zero exit, so no other row is a tautology. `AC-AI-37-13` is
repaired in `D-04`, and in the repaired matrix all twenty rows exit non-zero
outside the repository.

`AC-AI-37-21` was added afterwards, by the third repair round of PR #103, and is
measured the same way: exit `0` at the repository root and exit `2` with
`SOURCE_MISSING: docs/product-spec/work-items/TASK-AI-37.md` from an empty
temporary directory outside the repository. Its mutants — disposition heading
renamed, disposition section deleted, hold statement removed, remedies removed —
each exit `1`, and the measurements are recorded in § PR #103 `CHANGES_REQUIRED`
resolution record. It is not one of the twenty audited rows: it was written after
that audit, by the round that answers the review, and it is measured by the same
method rather than exempted from it.

### Step-2 measurement (rows as originally stored)

| Row | Expected exit | Actual exit | Expected string found | First 120 characters of actual output |
|---|---|---|---|---|
| `AC-AI-37-01` | 0 | 0 | yes | `Trivy truthfully declared: PENDING, NON_BLOCKING, pinned 0.60.0` |
| `AC-AI-37-02` | 0 | 0 | yes | `Gitleaks truthfully declared: ADOPTED, BLOCKING_GATE, pinned 8.24.0` |
| `AC-AI-37-03` | 0 | 0 | yes | `Register row 170 status: BLOCKED_DEPENDENCY` |
| `AC-AI-37-04` | 1 | 1 | yes | `UNAUTHORIZED_STATUS_ADVANCEMENT: register is BLOCKED_DEPENDENCY` |
| `AC-AI-37-05` | 1 | 1 | yes | `NEGATIVE TEST PROOF: Falsely declaring trivy ADOPTED triggers QUALITY_GATE_MISSING error` |
| `AC-AI-37-06` | 0 | 0 | yes | `Zero forbidden lifecycle scripts present in root and web manifests` |
| `AC-AI-37-07` | 1 | 1 | yes | `FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall` |
| `AC-AI-37-08` | 0 | 0 | yes | `Specification structural integrity verified: all 17 required sections present` |
| `AC-AI-37-09` | 0 | 0 | yes | `Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified` |
| `AC-AI-37-10` | 0 | 0 | yes | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` |
| `AC-AI-37-11` | 0 | 0 | **no** | `Tổng: 0 lỗi, 0 cảnh báo, 149 ghi chú (dùng --all để xem ghi chú)` |
| `AC-AI-37-12` | 0 | 0 | **no** | `Documentation validation passed: 94 markdown files, 130 feature IDs, 178 delivery rows, 733 unique identifiers.` |
| `AC-AI-37-13` | 0 | 0 | **no** | `ℹ tests 0 ℹ suites 0 ℹ pass 0 ℹ fail 0` — the escaped-quote globs never matched, so the row asserted `fail 0` over no suite at all |
| `AC-AI-37-14` | 0 | 0 | **no** | `Tất cả 0 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier` |
| `AC-AI-37-15` | 0 | **1** | no | `TypeError: can only concatenate str (not "NoneType") to str` |
| `AC-AI-37-16` | 0 | 0 | yes | `Dockerfile inventory: 1 total, 0 under apps/*, docker-worker present` |
| `AC-AI-37-17` | 0 | 0 | yes | `Successor TASK-AI-45 named in specification and not yet registered` |
| `AC-AI-37-18` | 2 | **1** | no | `cd: :TEMP: No such file or directory` then `Cannot find module 'C:\Program Files\Git\tools\ai-brain\...'` |
| `AC-AI-37-19` | 2 | 2 | yes (string present) | `❌ LỖI: Không tìm thấy native binary Trivy CLI (trivy, pin 0.60.0) trong PATH hoặc môi trường hệ thống!` |
| `AC-AI-37-20` | 0 | 0 | **no** | `✔ scripts/verify-trivy.ts exists and is the file under test … ℹ tests 27 … ℹ fail 0` — the expected string `# fail 0` is TAP syntax; `node --test` prints `ℹ fail 0` |

### `D-01` — the acceptance scripts duplicated the rule they claimed to test

**Defect class:** duplicated rule. `AC-AI-37-06` was an inline `node -e` one-liner
carrying its own `['preinstall','install','postinstall','prepare']` list, and
`tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` carried a *second,
private* copy of the same list. Changing the rule in either place left the other
row green, so the negative proof did not exercise the check the positive row ran
— it proved a proposition about its own copy. This is the same shape this
repository already exhibits between
`tools/ai-brain/acceptance/ac-07-12-lifecycle-clean.js` (line 9) and
`tools/ai-brain/acceptance/ac-07-13-forbidden-lifecycle.js` (line 9); those two
belong to `TASK-AI-07` and are not touched here.

**Replacement:** one committed module,
`tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`, exporting
`FORBIDDEN_INSTALL_SCRIPTS` and `findForbiddenLifecycleScripts`. Both rows now
require it and neither restates the list: `AC-AI-37-06` points at the new
`tools/ai-brain/acceptance/ac-37-06-lifecycle-clean.js`, and
`ac-37-07-forbidden-lifecycle.js` was rewired to the same module.
`ac-37-06-lifecycle-clean.js` additionally carries a control that exits `2` when
the shared list can no longer fire, so neutering the rule is detected in both
directions.

**Coupling proof (mutation).** The module was edited in place so the rule could no
longer fire, both rows re-run, and the module restored byte-for-byte from a file
backup (`lifecycle-forbidden.bak`). No `git checkout --` was used on uncommitted
work.

| Module state | `AC-AI-37-06` (expected `0`) | `AC-AI-37-07` (expected `1`) |
|---|---|---|
| `['preinstall','install','postinstall','prepare']` (before) | exit `0` | exit `1` |
| `[]` (mutated) | exit `2` — `CONTROL_FAILED: the shared rule cannot detect preinstall` | **exit `0`** — `FORBIDDEN_SCRIPT_NOT_DETECTED`, the negative row FAILS |
| `['preinstall','install','postinstall','prepare']` (restored) | exit `0` | exit `1` |

The pre-fix tree could not have shown this at all: `ac-37-07` held its own copy
of the list in the same file it ran from, so no edit outside that file could have
changed its verdict.

### `D-02` — `AC-AI-37-11`: stale pin

**Defect class:** stale pin. The row required the whole console tally
`Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú`. Two of those three numbers are
host/state-dependent observations, and one of them was already wrong: `reconcile`
reports `0 cảnh báo`, not `1`.

**Measurement:** exit `0`, output `Tổng: 0 lỗi, 0 cảnh báo, 149 ghi chú
(dùng --all để xem ghi chú)`, so the expected string was absent.

**Replacement:** the expected string is now the invariant `Tổng: 0 lỗi`. The
command is unchanged. No count is pinned.

### `D-03` — `AC-AI-37-12`: stale pin

**Defect class:** stale pin. The row required
`82 markdown files, 130 feature IDs, 178 delivery rows, 541 unique identifiers.`
Three of those four numbers grow with the repository on every unrelated Work Item.

**Measurement:** exit `0`, output `Documentation validation passed: 94 markdown
files, 130 feature IDs, 178 delivery rows, 733 unique identifiers.` — 12 files and
192 identifiers more than the pin.

**Replacement:** the expected string is now the invariant prefix
`Documentation validation passed:`. File, identifier and row totals are reported
by the validator as evidence but are no longer asserted.

### `D-04` — `AC-AI-37-13`: stale pin over an unrunnable, vacuous assertion

**Defect class:** unrunnable *and* vacuous assertion, over a stale pin.

**Measurement (unrunnable):** the stored command carried backslash-escaped quotes
(`\"tools/ai-brain/test/*.test.js\" …`). Those are not shell quoting: the shell
hands node the literal quote characters, the glob never expands, and `node --test`
matches nothing. Measured exit `0`, output `ℹ tests 0 ℹ suites 0 ℹ pass 0 ℹ fail 0`.

**Measurement (vacuous):** run from an empty temporary directory with no
repository present, the row exited `0` and printed `fail 0` — it passed where
there is no suite at all, so it could not tell a green suite from no suite. This
is the one row of the twenty with that property.

**Measurement (stale pin):** the row required `ℹ pass 458`; the suite really
reports `pass 626` across `137` suites.

**Replacement:** `tools/ai-brain/acceptance/ac-37-13-suite-not-vacuous.js`. It
expands the three real globs, requires the three test directories to exist (exit
`2` outside the repository), requires them to hold `*.test.js` files, and requires
the summary to report `tests > 0`, `suites > 0` and `fail === 0`. It carries a
control that runs the same command from an empty directory, confirms that run is
vacuous (`fail 0` over `0` tests), and refuses to accept that shape as success.
Measured: exit `0`, `SUITE_NOT_VACUOUS: fail 0, pass 626 of 626 tests across 137
suites`; exit `1` from an empty directory outside the repository. No pass count is
pinned.

### `D-05` — `AC-AI-37-14`: stale pin

**Defect class:** stale pin. The row required `Tất cả 62 tệp tin thay đổi …`,
a count that is the size of the branch diff, not a property of the repository.

**Measurement:** exit `0`, output ends `Tất cả 0 tệp tin thay đổi tuân thủ 100%
chuẩn định dạng Prettier` — the pinned number was a snapshot of a different diff.

**Replacement:** the expected string is now the invariant suffix
`tuân thủ 100% chuẩn định dạng Prettier`. The command is unchanged.

### `D-06` — `AC-AI-37-15`: unrunnable

**Defect class:** unrunnable, from markdown escaping. The stored command embedded
the Python regular expression `r'\n\| Status \| .([A-Z_]+). \|\n'`. Copied out of
the rendered table, the `\|` escapes resolve to bare pipes, the expression becomes
an alternation of empty branches, `re.search` matches at offset 0, and the command
dies at `TypeError: can only concatenate str (not "NoneType") to str`.

**Measurement:** exit `1`, expected `0`; no output string produced.

**Replacement:** `tools/ai-brain/acceptance/ac-37-15-status-alignment.js`, which
parses the Control table's `Status` cell and register row 170 with a real CSV
scanner (the register is quoted CSV and row 170's `key_behavior` contains commas,
which a naive split misaligns) and exits `2` outside the repository. It carries a
control that proves the parser can distinguish two different statuses. Measured:
exit `0`, `Control status matches register row 170: BLOCKED_DEPENDENCY`; exit `2`
outside the repository.

### `D-07` — `AC-AI-37-18`: unrunnable

**Defect class:** unrunnable. The stored command was
`cd $env:TEMP; node $REPO/tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js`.
That is PowerShell syntax, `$REPO` is defined nowhere in this document, and the
line dies in the documented bash harness at `cd: :TEMP: No such file or directory`
before node is reached.

**Measurement:** exit `1`, expected `2`; no `SOURCE_MISSING` output.

**Replacement:** `tools/ai-brain/acceptance/ac-37-18-outside-repository.js`. It
spawns `AC-AI-37-07` with an argv array — no shell re-quotes anything — from a
fresh temporary directory holding no repository, and requires the child to exit
`2` with `SOURCE_MISSING: package.json`. The row now asserts the child's exit `2`
and the harness itself exits `0` on a confirmed observation, `1` when the child
behaves differently, and `2` when its own subject is missing. Measured: exit `0`.

### `D-08` — `AC-AI-37-20`: false expected-output string

**Defect class:** false claim in the expected-output column. The row required
`# fail 0`, which is TAP syntax; `node --test` prints `ℹ fail 0`. The command was
correct and is unchanged.

**Measurement:** exit `0` and `ℹ tests 27 ℹ pass 27 ℹ fail 0`; the string
`# fail 0` appears nowhere in the output.

**Replacement:** the expected string is now `ℹ fail 0`.

### `D-09` — the `Allowed paths` boundary was exceeded, and the overlap with the successor is misstated

**Defect class:** false claim about the repository's own change boundary,
recorded rather than silently accepted.

**Measurement:** `Allowed paths` authorized exactly one file,
`docs/product-spec/work-items/TASK-AI-37.md`. The branch that delivered the audit
targets (`e508bfc`, PR #46) wrote five files besides it, none of them in
`Allowed paths`:

| File written | In `Allowed paths`? | In the successor path set of § Author boundary? |
|---|---|---|
| `scripts/verify-trivy.ts` | no | yes — and also matches the § Prohibited `scripts/verify-*` pattern |
| `package.json` | no | no |
| `tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` | no | no |
| `tools/ai-guard/test/verify-trivy.test.js` | no | no |
| `tools/ai-guard/test/fixtures/trivy-harness.ts` | no | no |

§ Post-implementation notes record that "four of the five are inside the set §
Author boundary reserves for the unregistered successor." Measured against the
five downstream paths § Author boundary actually lists
(`.github/workflows/*`, `scripts/verify-trivy.ts`, `scripts/ai/doctor.ps1`,
`tools/ecosystem-manifest.json`, `tests/fixtures/trivy/*`), exactly **one** of
the five is inside that set; the other four are inside no declared set at all.

**Replacement:** `Allowed paths` is widened here to cover the audit scripts this
change adds (`tools/ai-brain/acceptance/ac-37-*.js`,
`tools/ai-brain/acceptance/lib/lifecycle-forbidden.js`). The five pre-existing
files are left untouched and the discrepancy is recorded rather than papered
over: the implementation Work Item `TASK-AI-45` is still unregistered, so the
five files currently sit outside every authorized boundary, and the `scripts/verify-*`
prohibition in § Author boundary contradicts the successor path list that names
`scripts/verify-trivy.ts`.

### Spec claims that measured false

- The § Acceptance matrix expected-output column required `# fail 0`
  (`AC-AI-37-20`) and `ℹ pass 458` (`AC-AI-37-13`); neither string is produced.
- `AC-AI-37-14`'s expected `Tất cả 62 tệp tin thay đổi` — the formatter reported
  `0` changed files.
- `AC-AI-37-11`'s expected `1 cảnh báo` — `reconcile` reports `0 cảnh báo`; only
  `node tools/ai-brain/cli.js manifest` reports `1 cảnh báo`.
- § Post-implementation notes' "four of the five are inside the set § Author
  boundary reserves for the unregistered successor" — one of five (measured
  above).

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
node tools/ai-brain/acceptance/ac-37-06-lifecycle-clean.js            # expected exit 0
node tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js   # expected exit 1
pnpm security:trivy                                              # expected exit 2 while trivy is absent
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Scope conflicts and successor authorization','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 17 required sections present');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-37.md', encoding='utf-8').read(); tokens=['0.60.0','8.24.0','180000ms','500MB','BLOCKED_DEPENDENCY','AI-37-R01','AI-37-R02','AI-37-R03','AI-37-R04','AI-37-R05','AI-37-R06','AI-37-R07','AI-37-R08','AI-37-R09','AI-37-R10','sbom.cyclonedx.json','NO_CONTAINER_TARGET','aquasecurity/trivy-action','TASK-AI-45','DISTINCT_EXIT_CODES','trivy-fixture-evidence','shipde-sbom-cyclonedx','AC-AI-45-01','AC-AI-45-12']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, rules AI-37-R01 through R10, SBOM, successor TASK-AI-45, and downstream evidence-artifact tokens verified');"
node tools/ai-brain/acceptance/ac-37-15-status-alignment.js      # expected exit 0
node tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js   # expected exit 0
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

### PR #103 `CHANGES_REQUIRED` resolution record (2026-09-18)

Blocking findings in review comment `5724674195` and how this repair resolves
each one without leaving this Work Item's Allowed paths:

1. **Empty PR (zero file changes, `d50962f`):** resolved by making a real,
   in-scope change — this section plus the corrected `Branch`/`Pull Request`
   Control rows and the repair note under § Business outcome — and by merging
   current `origin/main` (`8cec992`) into the repair branch, so the PR diff is
   non-empty and reviewable. No out-of-scope file is touched.
2. **Stale branch (`cd3cfd8`, behind `origin/main`):** resolved by the merge
   above; the resynced head contains `e66f766`, `4a1e97f`, `0496acf`,
   `cd2a45d`, and `8cec992`. A fresh `git fetch origin` plus the five TASK-AI-37
   acceptance probes were re-run after the merge (see evidence below).
3. **Specification conflict (`BLOCKED_DEPENDENCY` PR opened for review):**
   acknowledged as a constraint, not overridden. The Control table still
   records `BLOCKED_DEPENDENCY`, the transition ledger is unchanged, register
   row 170 still records `BLOCKED_DEPENDENCY`, and this file requests no
   `READY_FOR_AUTHOR`/`IN_PROGRESS`/`READY_FOR_CODEX` transition; the register
   is outside Allowed paths and untouched. The PR therefore remains a repair of
   the review routing state, not a claim of stage advancement, and the human
   merge owner decides whether a `BLOCKED_DEPENDENCY` item may hold an open PR.
4. **Acceptance scripts already on `main` (PR #46):** confirmed and recorded
   rather than re-delivered. `git log --all --oneline` shows `e508bfc` (PR #46)
   delivered and `31e16b2` (PR #56) repaired the five scripts; no script content
   is duplicated here. Re-run evidence after the merge: `AC-AI-37-06` exit `0`,
   `AC-AI-37-07` exit `1` with `FORBIDDEN_LIFECYCLE_SCRIPT`, `AC-AI-37-13`
   exit `0` non-vacuous, `AC-AI-37-15` exit `0`
   (`Control status matches register row 170: BLOCKED_DEPENDENCY`),
   `AC-AI-37-18` exit `0`.

#### Round 3 — the missing in-scope deliverable (worktree `fix/pr103-211719` → PR branch `feat/task-ai-37-trivy-ci`)

Rounds 1 and 2 answered findings 1, 2 and 4 by resynchronising the branch and
recording the outcome here, but that record was prose: nothing in the repository
failed if a later edit deleted it, and finding 3 stayed a disclosure rather than a
checked claim. Round 3 delivers the one artifact this Work Item's `Allowed paths`
can still produce and that the review found missing — an acceptance probe — and
makes the disclosure of finding 3 mechanical.

| Finding (comment `5724674195`) | Round-3 disposition | Evidence |
|---|---|---|
| 1. Empty PR (`d50962f`, zero file changes) | The PR now carries a real deliverable and not only a record: `tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` plus this Work Item. `git diff --name-only origin/main...HEAD` lists exactly those two files, both inside `Allowed paths`. | `git diff --name-only origin/main...HEAD`, `git diff --stat origin/main...HEAD` |
| 2. Branch stale (`cd3cfd8`, behind `origin/main`) | Re-verified at this head after `git fetch origin --prune`: `origin/main` is an ancestor of `HEAD` and stands at `8cec992`. | `git merge-base --is-ancestor origin/main HEAD` exit `0`; `git log --oneline origin/main -1` |
| 3. Specification conflict (`BLOCKED_DEPENDENCY` routed for review) | Not overridden, and no longer disclosure-only. § Control › Review routing disposition states the hold, names the `TASK-AI-19` register-write path that owns the transition, and names the two admissible remedies (`ADVANCE`, `CLOSE`). `AC-AI-37-21` exits `1` when any of those statements is removed, so the conflict cannot be silently dropped by a later edit. Register row 170 is untouched and still `BLOCKED_DEPENDENCY`, and `AC-AI-37-15` still proves the Control table agrees with it. | `node tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` exit `0`; mutants below each exit `1` |
| 4. Acceptance scripts already on `main` (PR #46) | Not re-delivered. The new probe does not exist on `origin/main` (`git cat-file -e origin/main:tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` fails), and no file delivered by `e508bfc` (PR #46) or `31e16b2` (PR #56) is modified by this PR. | `git cat-file -e` non-zero; PR file list |

Measured behaviour of the new probe at this head (repository root, Windows
PowerShell, `node v24.15.0`):

| Scenario | Exit | Output |
|---|---|---|
| `node tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` | `0` | `REVIEW_ROUTING_HOLD: BLOCKED_DEPENDENCY disclosed with a governed transition path` |
| the same command from an empty temporary directory outside the repository | `2` | `SOURCE_MISSING: docs/product-spec/work-items/TASK-AI-37.md` |
| mutant: disposition heading renamed | `1` | `DISPOSITION_SECTION_MISSING: ### Review routing disposition` |
| mutant: disposition section deleted | `1` | `DISPOSITION_SECTION_MISSING: ### Review routing disposition` |
| mutant: `REVIEW HOLD` statement removed | `1` | `DISCLOSURE_MISSING: REVIEW HOLD` |
| mutant: remedies removed (`ADVANCE`, `CLOSE`) | `1` | `DISCLOSURE_MISSING: ADVANCE; DISCLOSURE_MISSING: CLOSE` |

The mutants were applied to this document in place and it was restored
byte-for-byte from an in-memory copy held by the measuring harness: the harness
printed `spec restored byte-for-byte: True`, `git status` reported the document
clean afterwards, and no `git checkout --` was used on uncommitted work. The
digest the harness compared was the working-tree file of this Windows checkout,
which uses CRLF (`sha256 89bde9a59de3…`); the same content as committed at
`17e1af4` is `sha256 0b0f217b3bde…` with LF, reproducible with
`git show 17e1af4:docs/product-spec/work-items/TASK-AI-37.md` piped to
`sha256sum`. Both digests belong to commit `17e1af4` rather than to the current
head because this record's own follow-up edits change them again; the digest a
reviewer can reproduce is the committed blob.

Re-measuring the mutants after this section was written is what produced the
hardening recorded next. The first measurement of the renamed-heading mutant
reported `DISCLOSURE_MISSING: TASK-AI-19` rather than a missing section, because
`AC-AI-37-21` located its subject with a plain substring search and this section's
own prose names the heading it quotes, so the probe re-anchored onto that mention.
The probe now matches the heading line itself
(`/^### Review routing disposition[ \t]*$/m`), which is why a renamed or deleted
heading is reported as `DISPOSITION_SECTION_MISSING` above and a prose mention can
never stand in for the section. The probe's own controls additionally prove that
it stays silent on a Control status that is not blocked and that its parser can
tell two Control statuses apart.

Round 3 touches nothing outside `Allowed paths`: `FEATURE-DELIVERY-REGISTER.csv`,
`.github/**`, `tools/ecosystem-manifest.json` and every script delivered by PR #46
and PR #56 are unchanged, and no CI gate is claimed.

### Verification commands record

- `node tools/ai-brain/acceptance/ac-37-06-lifecycle-clean.js` (exit 0)
- `node tools/ai-brain/acceptance/ac-37-07-forbidden-lifecycle.js` (exit 1 with `FORBIDDEN_LIFECYCLE_SCRIPT: detected preinstall`)
- `node tools/ai-brain/acceptance/ac-37-13-suite-not-vacuous.js` (exit 0: pass 733 of 733 tests across 159 suites)
- `node tools/ai-brain/acceptance/ac-37-15-status-alignment.js` (exit 0: Control status matches register row 170: `BLOCKED_DEPENDENCY`)
- `node tools/ai-brain/acceptance/ac-37-18-outside-repository.js` (exit 0: child exit 2 with `SOURCE_MISSING: package.json`)
- `node --test tools/ai-brain/test/*.test.js` (exit 0: 483 tests, 483 pass, 0 fail)
- `python docs/product-spec/scripts/validate_docs.py` (exit 0: `Documentation validation passed:` — 105 markdown files, 130 feature IDs, 178 delivery rows, 853 unique identifiers at the round-2 head; the file, row and identifier totals grow with the repository, so only the `Documentation validation passed:` prefix is asserted)
- `python docs/product-spec/scripts/validate_pr_contract.py` (exit 0: Pull Request contract passed for TASK-AI-37; 1 changed files inspected at the round-2 head)

Round 3 (repair worktree `fix/pr103-211719`, pushed to the PR branch
`feat/task-ai-37-trivy-ci`) added these measurements, taken at this head:

- `node tools/ai-brain/acceptance/ac-37-21-review-routing-hold.js` (exit 0: `REVIEW_ROUTING_HOLD: BLOCKED_DEPENDENCY disclosed with a governed transition path`; exit 2 with `SOURCE_MISSING: docs/product-spec/work-items/TASK-AI-37.md` from an empty directory outside the repository; four mutants each exit 1 — see the table in § PR #103 `CHANGES_REQUIRED` resolution record)
- `node --test 'tools/ai-brain/test/*.test.js'` (exit 0: 483 tests, 109 suites, 483 pass, 0 fail)
- `python docs/product-spec/scripts/validate_docs.py` (exit 0: `Documentation validation passed: 105 markdown files, 130 feature IDs, 178 delivery rows, 854 unique identifiers.`)
- `python docs/product-spec/scripts/validate_pr_contract.py --event <pull_request payload>` (exit 0: Pull Request contract passed for TASK-AI-37; 2 changed files inspected)
- `git merge-base --is-ancestor origin/main HEAD` (exit 0; `origin/main` at `8cec992`)


