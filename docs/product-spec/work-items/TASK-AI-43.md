# TASK-AI-43 — Run the manifest audit as a blocking check

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-43` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `176` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-43.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-43-audit-gate` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/22 |

## Business outcome

A tool believed to be running while absent must fail closed, not sit in an
advisory report. The ecosystem manifest `tools/ecosystem-manifest.json` defines
the authoritative catalog of 37 adopted repositories, tools, and quality gates
governing development, security, and verification across Ship Dễ.

Prior to this Work Item, the automated manifest truth audit
(`node tools/ai-brain/cli.js manifest`) was available as an advisory CLI
command, but was not integrated into the blocking health check scripts
`scripts/ai/doctor.ps1` or `scripts/ai/ecosystem.ps1 -Action Validate`. The
doctor script only validated static JSON schema constraints (such as verifying
that the adopted tools array contains exactly 37 elements and that 9 profiles
are declared), without verifying whether declared tools actually exist on the
workstation, in monorepo dependencies, or in CI workflow definitions.
Consequently, an environment where critical quality gates were absent while
claimed as `ADOPTED` would still receive a passing "VALIDATED" status.

Wiring the manifest truth audit into `doctor.ps1` and `ecosystem.ps1` ensures
that any unverified overclaiming of reality (such as `QUALITY_GATE_MISSING` or
`DECLARED_ADOPTED_BUT_ABSENT`) immediately fails closed with exit code 1,
halting developer setup and preflight verification until tools are either
honestly installed or reconciled in the manifest. Enforcing this blocking gate
in automated CI workflow definitions or the orchestrator controller dispatch
loop is reserved for subsequent integration work items.

## Source references

- `AGENTS.md` § Source of truth — A declared `lifecycle_state` must match what is
  actually on the machine; existing code is evidence, not authority.
- `AGENTS.md` § Role separation — Author never approves own work; handoff
  progresses through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — A failed or partial
  installation reports exact state; must not be recorded as installed or
  healthy.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row
  176 — `TASK-AI-43` registration and dependency on `TASK-AI-17`.
- `docs/product-spec/work-items/TASK-AI-17.md` — Manifest truth reconciliation
  baseline.
- `tools/ai-brain/manifest-audit.js` and `tools/ai-brain/cli.js manifest` —
  Truth-checking logic for adopted ecosystem entries.
- `.github/workflows/security-baseline.yml` — Authoritative install workflow for
  CI-provisioned `gitleaks` at pinned version `8.24.0`.

## Preconditions and dependencies

- `TASK-AI-17` reconciliation baseline established:
  - `gitleaks` is `ADOPTED` and a `BLOCKING_GATE`, `install_method: "ci-provisioned"`,
    installed by `.github/workflows/security-baseline.yml` at pinned `8.24.0`.
    It is NOT absent.
  - `lefthook` and `trivy` genuinely are absent from the host and declared
    `PENDING` with non-blocking policy pending `TASK-AI-36` and `TASK-AI-37`.
  - `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly one
    warning (`PINNED_VERSION_DRIFT` for `codex-cli` observed `0.154.0` vs pinned
    `0.151.0`), which is a governed human decision.
- Authoritative delivery register status:
  - `FEATURE-DELIVERY-REGISTER.csv` row 176 records `TASK-AI-43` as `BLOCKED_DEPENDENCY`
    on `TASK-AI-17`.
  - Although the implementation PR #19 for `TASK-AI-17` was merged into `fix/task-ai-16-codex-launch-flags`
    (commit `1f587dd`), register row 150 remains `READY_FOR_CODEX` pending automated write-back
    under `TASK-AI-19`. The Work Item Control table is strictly aligned to the authoritative
    register (`BLOCKED_DEPENDENCY`) rather than prematurely self-promoting to unblock.
- Node.js v24 workstation runtime available on PATH.
- `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` operational.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope for this specification Work Item is strictly bounded to the allowed path:
- `docs/product-spec/work-items/TASK-AI-43.md`

Allowed paths for subsequent implementation by GEMINI:
- `scripts/ai/doctor.ps1`
- `scripts/ai/ecosystem.ps1`
- `tools/ai-brain/cli.js`
- `tools/ai-brain/manifest-audit.js`
- `docs/product-spec/work-items/TASK-AI-43.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`

Prohibited in this Work Item:
- Modifying anything under `.github/`, `scripts/verify-*`,
  `docs/product-spec/scripts/`, `.gitleaks.toml`, or any existing validator.
- Flipping a declared `lifecycle_state` or Work Item status in the register to make a check pass.
- Disabling, skipping, or narrowing any audit rule or error severity.
- Introducing byte-order marks (BOM) or non-ASCII characters into `scripts/ai/*`.
- Author self-approval.

## In scope

- Author this formal Work Item specification `docs/product-spec/work-items/TASK-AI-43.md`.
- Specify execution of `node tools/ai-brain/cli.js manifest` during ecosystem validation in `scripts/ai/ecosystem.ps1 -Action Validate` and `scripts/ai/doctor.ps1`.
- Specify fail-closed blocking: if `summary.error > 0` (e.g. `QUALITY_GATE_MISSING`, `DECLARED_ADOPTED_BUT_ABSENT`), output exact finding codes and missing tool identifiers, append to `$failures`, and exit with code 1.
- Specify differentiation between blocking errors and non-fatal warnings: documented warnings (`PINNED_VERSION_DRIFT` for `codex-cli`) are printed visibly for operator awareness but do not cause failure in default mode.
- Specify resolution of the PowerShell strict-mode null collection evaluation bug in `ecosystem.ps1` (`if ($errors.Count -gt 0)` when `$errors` is null).
- Specify extending `tools/ai-brain/cli.js manifest` to accept `--manifest <path>` (defaulting to `<rootDir>/tools/ecosystem-manifest.json`). When supplied, the custom manifest is audited while preserving the repository `rootDir` for CI workflow and monorepo dependency resolution.
- Specify safe test injection path: both `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` accept an optional `-ManifestPath` parameter (defaulting to `tools/ecosystem-manifest.json`) and forward it to `node tools/ai-brain/cli.js manifest --manifest "$ManifestPath"`, allowing deterministic testing against synthetic fixture manifests without mutating tracked repository manifests.
- Specify classifier enhancement in `tools/ai-brain/manifest-audit.js`: an entry declared `ADOPTED` and absent (`present === false`) is classified as a quality gate (raising `QUALITY_GATE_MISSING` error with exit code 1) if `entry.blocking_policy === "BLOCKING_GATE"` or its `id`/`role` matches `/scan|leak|trivy|lefthook|axe|lint|audit/i`.
- Specify authoritative install verification for CI-provisioned tools: `tools/ai-brain/manifest-audit.js` must verify that `.github/workflows/security-baseline.yml` exists and installs `gitleaks` at the exact version pinned in `pinned_version_or_commit` (`8.24.0`), rather than relying on loose token matching across arbitrary workflows.
- Specify an automated negative acceptance test in `ecosystem.ps1 -Action Test` (e.g. Test 27) that verifies fail-closed behavior when an adopted quality gate is missing.
- Specify documentation of the blocking manifest audit integration in `AI-TOOLCHAIN-DECISIONS.md` during implementation.
- Ensure all repository tests and reconciliation checks stay green.

## Out of scope

- Modifying GitHub Actions workflow definitions under `.github/`.
- Modifying repository validator scripts or test fixtures outside the allowed implementation paths.
- Installing machine-level binaries (`lefthook`, `trivy`, etc., owned by
  `TASK-AI-35`..`40`).
- Upgrading or repinning `codex-cli` in `tools/ecosystem-manifest.json` (human
  decision gate).
- Formatting files outside the explicitly changed set.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-43-R01` | The manifest audit must run as a blocking check in `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1 -Action Validate`. |
| `AI-43-R02` | Any manifest audit error (`summary.error > 0`, such as `QUALITY_GATE_MISSING` or `DECLARED_ADOPTED_BUT_ABSENT`) must fail closed: report the finding codes and tool IDs, record an actionable item in `$failures`, and exit with code 1. |
| `AI-43-R03` | Non-fatal warnings (such as `PINNED_VERSION_DRIFT` for `codex-cli`) must be printed visibly with exact evidence (`0.154.0` observed vs `0.151.0` pin), but must not block normal doctor runs unless strict mode is explicitly requested. |
| `AI-43-R04` | Tools declared with `install_method: "ci-provisioned"` (such as `gitleaks` at pinned `8.24.0`) must be verified against authoritative workflow declarations: `.github/workflows/security-baseline.yml` must exist and install `gitleaks` at the pinned version (`8.24.0`), preventing false-positive failures on developer workstations while ensuring the gate is genuinely pinned in CI. If the workflow is missing or specifies a mismatched version, the audit must report `QUALITY_GATE_MISSING` with exit code 1. |
| `AI-43-R05` | In PowerShell scripts under `Set-StrictMode -Version Latest`, checking error collections must safely guard against null objects before accessing `.Count`. |
| `AI-43-R06` | All files under `scripts/ai/` must remain pure ASCII with no byte-order mark (BOM). |
| `AI-43-R07` | Both `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` must accept an optional `-ManifestPath` parameter for testing (defaulting to `tools/ecosystem-manifest.json`) and forward `--manifest "$ManifestPath"` to `node tools/ai-brain/cli.js manifest`. `tools/ai-brain/cli.js manifest` must accept `--manifest <path>` so that test fixtures can be loaded while keeping repository `rootDir` intact. |
| `AI-43-R08` | Quality gate classification for absent adopted tools: an entry with `lifecycle_state: "ADOPTED"` and `present === false` is classified as a quality gate (raising blocking error `QUALITY_GATE_MISSING`) if its `blocking_policy === "BLOCKING_GATE"` or its `id`/`role` matches `/scan|leak|trivy|lefthook|axe|lint|audit/i`. Absent tools without quality-gate classification emit non-fatal warning `DECLARED_ADOPTED_BUT_ABSENT`. |

## UI states

Not applicable; this Work Item has no user-facing web UI. Operator-facing console
states:
- **PASS**: `Ecosystem manifest audit: VALIDATED (27 checkable, 19 present, 8 missing, 0 errors, 1 warning [codex-cli drift])` with exit code 0.
- **FAIL**: `Ecosystem manifest audit: FAILED (N errors: QUALITY_GATE_MISSING: tool-id) -> ACTION REQUIRED` with exit code 1.

## API, event and data impact

No database schema, API route, or runtime data structure changes. Observable
impact is bounded to PowerShell health check scripts, Brain CLI manifest command,
and toolchain documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command | Expected exit code | Expected result and evidence |
|---|---|---|---|---|
| `AC-AI-43-01` | Run `doctor.ps1` against reconciled manifest | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/doctor.ps1` | `0` | Manifest audit passes with 0 errors; stdout contains `Ecosystem manifest audit: VALIDATED` without aborting doctor. |
| `AC-AI-43-02` | Run `ecosystem.ps1 -Action Validate` | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/ecosystem.ps1 -Action Validate` | `0` | Schema validation and manifest truth audit both execute and pass with 0 errors; stdout contains `Ecosystem manifest: VALID`. |
| `AC-AI-43-03` | Negative acceptance check harness: execute `ecosystem.ps1` and `doctor.ps1` with temporary manifest fixture where an adopted blocking quality gate is absent | Executable negative fixture harness (Section 2 under Verification commands) | `1` (for both `ecosystem.ps1` and `doctor.ps1`) | Both invocations fail closed with exit code 1; stdout/stderr output contains error code `QUALITY_GATE_MISSING` and explicitly identifies the missing tool ID `synthetic-missing-audit`. |
| `AC-AI-43-04` | Verify CI-provisioned gate handling against authoritative workflow and pinned version | `node tools/ai-brain/cli.js manifest` | `0` | Verifies that `gitleaks` is provisioned by `.github/workflows/security-baseline.yml` at pinned version `8.24.0`; marks `gitleaks` present; 0 errors reported; `gitleaks` does not appear in `QUALITY_GATE_MISSING` or `DECLARED_ADOPTED_BUT_ABSENT`. |
| `AC-AI-43-05` | Verify non-fatal warning visibility without blocking | `node tools/ai-brain/cli.js manifest` | `0` | Emits visible non-fatal warning `[CẢNH] PINNED_VERSION_DRIFT` for `codex-cli` (observed `0.154.0` vs pinned `0.151.0`), summary reports `0 lỗi, 1 cảnh báo`, exit code 0. |
| `AC-AI-43-06` | Regression checks across test suites and manifest reconciliation | `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"; node tools/ai-brain/cli.js reconcile; node tools/ai-brain/cli.js manifest` | `0` (for all commands) | Test runner reports `pass 458` (0 failed); reconcile reports `0 lỗi`; manifest audit reports `0 lỗi, 1 cảnh báo`. |

## Verification commands

### 1. Standard repository verification suite

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/ecosystem.ps1 -Action Validate
# Expected: Exit code 0, "Ecosystem manifest: VALID"

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/doctor.ps1
# Expected: Exit code 0, "Ecosystem manifest audit: VALIDATED"

node tools/ai-brain/cli.js manifest
# Expected: Exit code 0, "Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú", 1 warning (codex-cli version drift)

node tools/ai-brain/cli.js reconcile
# Expected: Exit code 0, "Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú"

node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
# Expected: Exit code 0, 458 passed, 0 failed

python docs/product-spec/scripts/validate_docs.py
# Expected: Exit code 0, validation passes across all markdown specifications
```

### 2. Executable negative acceptance check harness (AC-AI-43-03)

The following harness creates a temporary manifest fixture with an overstated quality gate (`synthetic-missing-audit` declared `ADOPTED` with `blocking_policy: "BLOCKING_GATE"` and role containing `audit` matching the quality-gate classifier) in an isolated scratch directory, and verifies that both PowerShell entrypoints fail closed with exit code 1 and identify the missing gate, without modifying any repository-tracked files:

```powershell
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("shipde-neg-manifest-" + [Guid]::NewGuid())
$null = New-Item -ItemType Directory -Path (Join-Path $tempDir "tools") -Force
$fixtureManifest = Join-Path $tempDir "tools/ecosystem-manifest.json"

try {
    # Generate fixture with an absent adopted quality gate matching the classifier
    $m = Get-Content "tools/ecosystem-manifest.json" -Raw | ConvertFrom-Json
    $m.adopted += [PSCustomObject]@{
        id = "synthetic-missing-audit"
        name = "Synthetic Security Audit Quality Gate"
        repository = "synthetic/security-audit-gate"
        role = "Synthetic security audit quality gate for negative verification"
        install_method = "system"
        pinned_version_or_commit = "1.0.0"
        blocking_policy = "BLOCKING_GATE"
        lifecycle_state = "ADOPTED"
    }
    $m | ConvertTo-Json -Depth 10 | Set-Content -Path $fixtureManifest -Encoding ASCII

    # 1. Negative check on ecosystem.ps1
    $ecoOut = Join-Path $tempDir "eco.out"
    $ecoErr = Join-Path $tempDir "eco.err"
    $ecoProc = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/ai/ecosystem.ps1",
        "-Action", "Validate", "-ManifestPath", "`"$fixtureManifest`""
    ) -PassThru -Wait -NoNewWindow -RedirectStandardOutput $ecoOut -RedirectStandardError $ecoErr

    if ($ecoProc.ExitCode -ne 1) {
        throw "ecosystem.ps1 failed negative check: expected exit code 1, got $($ecoProc.ExitCode)"
    }
    $ecoText = (Get-Content $ecoOut -Raw -ErrorAction SilentlyContinue) + (Get-Content $ecoErr -Raw -ErrorAction SilentlyContinue)
    if ($ecoText -notmatch "synthetic-missing-audit") {
        throw "ecosystem.ps1 output missing expected tool identifier 'synthetic-missing-audit'"
    }

    # 2. Negative check on doctor.ps1 via safe -ManifestPath injection path
    $docOut = Join-Path $tempDir "doc.out"
    $docErr = Join-Path $tempDir "doc.err"
    $docProc = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/ai/doctor.ps1",
        "-ManifestPath", "`"$fixtureManifest`""
    ) -PassThru -Wait -NoNewWindow -RedirectStandardOutput $docOut -RedirectStandardError $docErr

    if ($docProc.ExitCode -ne 1) {
        throw "doctor.ps1 failed negative check: expected exit code 1, got $($docProc.ExitCode)"
    }
    $docText = (Get-Content $docOut -Raw -ErrorAction SilentlyContinue) + (Get-Content $docErr -Raw -ErrorAction SilentlyContinue)
    if ($docText -notmatch "synthetic-missing-audit") {
        throw "doctor.ps1 output missing expected tool identifier 'synthetic-missing-audit'"
    }

    Write-Host "NEGATIVE ACCEPTANCE HARNESS PASSED: Both ecosystem.ps1 and doctor.ps1 failed closed with exit code 1 and reported the missing gate."
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
```

### 3. Behavioral regression checks: classifier and authoritative workflow

The following commands verify the exact behavioral distinctions identified in review:

```powershell
# A. Quality gate classifier: absent adopted gate raises QUALITY_GATE_MISSING (error, exit 1)
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); m.adopted.push({ id: 'synthetic-missing-audit', name: 'Synthetic Quality Gate', repository: 'synthetic/audit-gate', role: 'Synthetic security audit quality gate', install_method: 'system', pinned_version_or_commit: '1.0.0', blocking_policy: 'BLOCKING_GATE', lifecycle_state: 'ADOPTED' }); const res = auditManifest(m); const f = res.findings.find(x => x.id === 'synthetic-missing-audit'); console.log('Code:', f.code, 'Severity:', f.severity, 'Errors:', res.summary.error); if (f.code !== 'QUALITY_GATE_MISSING' || f.severity !== 'error' || res.summary.error < 1) process.exit(1);"
# Expected: Code: QUALITY_GATE_MISSING Severity: error Errors: 1 (Exit code 0)

# B. Non-gate utility: absent adopted non-gate tool raises DECLARED_ADOPTED_BUT_ABSENT (warn, exit 0)
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); m.adopted.push({ id: 'synthetic-missing-tool', name: 'Synthetic Tool', repository: 'synthetic/tool', role: 'General utility helper', install_method: 'system', pinned_version_or_commit: '1.0.0', blocking_policy: 'NON_BLOCKING', lifecycle_state: 'ADOPTED' }); const res = auditManifest(m); const f = res.findings.find(x => x.id === 'synthetic-missing-tool'); console.log('Code:', f.code, 'Severity:', f.severity, 'Errors:', res.summary.error); if (f.code !== 'DECLARED_ADOPTED_BUT_ABSENT' || f.severity !== 'warn' || res.summary.error !== 0) process.exit(1);"
# Expected: Code: DECLARED_ADOPTED_BUT_ABSENT Severity: warn Errors: 0 (Exit code 0)

# C. Authoritative CI-provisioned gitleaks install in .github/workflows/security-baseline.yml at pinned 8.24.0
node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const hasPin = wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22'); console.log('Gitleaks pin:', pin, 'Found in security-baseline.yml:', hasPin); if (!hasPin) process.exit(1);"
# Expected: Gitleaks pin: 8.24.0 Found in security-baseline.yml: true (Exit code 0)
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5b9b1ce` | `CHANGES_REQUIRED` | [Finding 1 (P1 doctor.ps1:658)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773151): Reverted implementation scripts (`doctor.ps1`, `ecosystem.ps1`, `AI-TOOLCHAIN-DECISIONS.md`) from planning commit; branch bounded strictly to Work Item specification. [Finding 2 (P1 TASK-AI-43.md:11)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773166): Retained `READY_FOR_CODEX` because dependency `TASK-AI-17` was merged into `fix/task-ai-16-codex-launch-flags` via PR #19 (`1f587dd`), while register row 176 status synchronization is reserved for `TASK-AI-19` reconciler write-back rather than manual edit. [Finding 3 (P2 TASK-AI-43.md:148)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773187): Defined safe `-ManifestPath` injection parameter in `doctor.ps1`, added `AI-43-R07`, updated `AC-AI-43-03`, and provided full executable negative acceptance fixture harness in Verification commands. |
| 2 | `34014ce` | `CHANGES_REQUIRED` | [Finding 1](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Added exact commands and expected exit codes to all criteria in Acceptance matrix (`AC-AI-43-01` through `AC-AI-43-06`). [Finding 2](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Corrected negative fixture to `synthetic-missing-audit` with `role: "Synthetic security audit quality gate..."` matching regex `/scan\|leak\|trivy\|lefthook\|axe\|lint\|audit/i`, producing `QUALITY_GATE_MISSING` (error) and exit code 1; placed classifier support for `blocking_policy === "BLOCKING_GATE"` into implementation scope. [Finding 3](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Brought `tools/ai-brain/cli.js` and `tools/ai-brain/manifest-audit.js` into allowed implementation paths and specified `--manifest <path>` support in `cli.js manifest`. [Finding 4](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Updated `AI-43-R04` and `AC-AI-43-04` to require authoritative install evidence in `.github/workflows/security-baseline.yml` pinned at `8.24.0`. [Finding 5](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Reconciled Work Item status in Control table from `READY_FOR_CODEX` to `BLOCKED_DEPENDENCY` to strictly reflect authoritative delivery register row 176 (`FEATURE-DELIVERY-REGISTER.csv`). |
| 3 | `HEAD` | Pending | Re-submitted for independent Codex review via `@codex review`. |

## Residual limitations

The delivery register row 176 (`FEATURE-DELIVERY-REGISTER.csv`) records `TASK-AI-43`
as `BLOCKED_DEPENDENCY` on `TASK-AI-17`. While PR #19 (`fix/task-ai-17-manifest-truth`)
has been merged into `fix/task-ai-16-codex-launch-flags` (commit `1f587dd`), register
row 150 remains `READY_FOR_CODEX` pending automated register write-back under
`TASK-AI-19`. The Work Item Control table is strictly aligned to the register
(`BLOCKED_DEPENDENCY`) in compliance with governance precedence rules.

On developer workstations, the manifest audit validates CI-provisioned tools by
inspecting the authoritative workflow file `.github/workflows/security-baseline.yml`
at pinned version `8.24.0` rather than executing Linux binaries locally. Full
local execution of security scanners is deferred to dedicated work items (`TASK-AI-35`
for betterleaks, `TASK-AI-36` for lefthook, `TASK-AI-37` for trivy). The `codex-cli`
version drift warning (`0.154.0` vs pinned `0.151.0`) remains open pending a
deliberate human upgrade decision per `AI-TOOLCHAIN-DECISIONS.md`.
