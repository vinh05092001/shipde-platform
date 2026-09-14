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
  `docs/product-spec/scripts/`, `.gitleaks.toml`, or any existing validator (such as
  the hard-coded 37-entry count check in `scripts/ai/ecosystem.ps1`).
- Flipping a declared `lifecycle_state` or Work Item status in the register to make a check pass.
- Disabling, skipping, or narrowing any audit rule or error severity.
- Introducing byte-order marks (BOM) or non-ASCII characters into `scripts/ai/*`.
- Author self-approval.

## In scope

- Author this formal Work Item specification `docs/product-spec/work-items/TASK-AI-43.md`.
- Specify execution of `node tools/ai-brain/cli.js manifest` during ecosystem validation in `scripts/ai/ecosystem.ps1 -Action Validate` and `scripts/ai/doctor.ps1`.
- Specify fail-closed blocking: if `summary.error > 0` (e.g. `QUALITY_GATE_MISSING`, `DECLARED_ADOPTED_BUT_ABSENT`), output exact finding codes and missing tool identifiers, append to `$failures`, and exit with code 1.
- Specify differentiation between blocking errors and non-fatal warnings: documented warnings (`PINNED_VERSION_DRIFT` for `codex-cli`) are printed visibly for operator awareness but do not cause failure in validation mode.
- Specify resolution of the PowerShell strict-mode null collection evaluation bug in `ecosystem.ps1` (`if ($errors.Count -gt 0)` when `$errors` is null).
- Specify extending `tools/ai-brain/cli.js manifest` to accept `--manifest <path>` (defaulting to `<rootDir>/tools/ecosystem-manifest.json`). When supplied, the custom manifest is audited while preserving the repository `rootDir` for CI workflow and monorepo dependency resolution.
- Specify safe test injection path: both `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` accept an optional `-ManifestPath` parameter (defaulting to `tools/ecosystem-manifest.json`) and forward it to `node tools/ai-brain/cli.js manifest --manifest "$ManifestPath"`, allowing deterministic testing against synthetic fixture manifests without mutating tracked repository manifests.
- Specify classifier enhancement in `tools/ai-brain/manifest-audit.js`: an entry declared `ADOPTED` and absent (`present === false`) is classified as a quality gate (raising `QUALITY_GATE_MISSING` error with exit code 1) if `entry.blocking_policy === "BLOCKING_GATE"` or its `id`/`role` matches `/scan|leak|trivy|lefthook|axe|lint|audit/i`.
- Specify authoritative install verification and negative proof for CI-provisioned tools: `tools/ai-brain/manifest-audit.js` must verify that `.github/workflows/security-baseline.yml` exists and installs `gitleaks` at the exact version pinned in `pinned_version_or_commit` (`8.24.0`). If the workflow is absent or decoyed without that pinned install, the audit must fail closed with `QUALITY_GATE_MISSING: gitleaks` (exit code 1).
- Specify an automated negative acceptance test that creates a 37-entry fixture by flipping existing entry `trivy` to `ADOPTED`/`BLOCKING_GATE`, passing the validator count check while failing closed on manifest truth.
- Specify documentation of the blocking manifest audit integration in `AI-TOOLCHAIN-DECISIONS.md` during implementation.
- Ensure all repository tests and reconciliation checks stay green.

## Out of scope

- Modifying GitHub Actions workflow definitions under `.github/`.
- Modifying repository validator scripts or test fixtures outside the allowed implementation paths.
- Relaxing, modifying, or parameterizing the 37-entry count assertion in `ecosystem.ps1`.
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
| `AI-43-R03` | Non-fatal warnings (such as `PINNED_VERSION_DRIFT` for `codex-cli`) must be printed visibly with exact evidence (`0.154.0` observed vs `0.151.0` pin), but must not block doctor or ecosystem validation runs (which fail only when `summary.error > 0`). |
| `AI-43-R04` | Tools declared with `install_method: "ci-provisioned"` (such as `gitleaks` at pinned `8.24.0`) must be verified against authoritative workflow declarations: `.github/workflows/security-baseline.yml` must exist and install `gitleaks` at the pinned version (`8.24.0`). If the workflow is missing, decoyed, or specifies a mismatched version, the audit must fail closed with error `QUALITY_GATE_MISSING` and exit code 1. |
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

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-43-01` | Validate production ecosystem manifest schema and profile conformity | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/ecosystem.ps1 -Action Validate` exits 0 and prints the string `VALIDATION PASSED: All 37 approved adopted repositories, 14 product dependencies, 10 candidates, and 9 profiles conform to ecosystem policy.` | command stdout |
| `AC-AI-43-02` | Run manifest truth audit against production manifest | `node tools/ai-brain/cli.js manifest` exits 0 and prints the string `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` naming `codex-cli` | command stdout |
| `AC-AI-43-03` | Run manifest truth audit against negative fixture with absent quality gate (trivy flipped to ADOPTED) | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const t = m.adopted.find(x => x.id === 'trivy'); t.lifecycle_state = 'ADOPTED'; t.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'trivy'); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` exits 1 and prints the string `QUALITY_GATE_MISSING: trivy` | command stderr |
| `AC-AI-43-04` | Verify CI-provisioned gitleaks install in authoritative security-baseline workflow | `node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const hasPin = wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22'); console.log('Gitleaks pin ' + pin + ' in security-baseline.yml: ' + hasPin); if (!hasPin) process.exit(1);"` exits 0 and prints the string `Gitleaks pin 8.24.0 in security-baseline.yml: true` | command stdout |
| `AC-AI-43-05` | Negative proof: verify missing or decoyed workflow fails closed on CI-provisioned gate | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const os = require('os'); const fs = require('fs'); const path = require('path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-decoy-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(d, '.github', 'workflows', 'decoy.yml'), 'steps:\n  - run: echo no-gitleaks\n'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const res = auditManifest(m, { rootDir: d }); const f = res.findings.find(x => x.id === 'gitleaks'); fs.rmSync(d, { recursive: true, force: true }); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` exits 1 and prints the string `QUALITY_GATE_MISSING: gitleaks` | command stderr |
| `AC-AI-43-06` | Verify warning visibility for codex-cli version drift without blocking | `node tools/ai-brain/cli.js manifest` exits 0 and prints the string `[CẢNH] PINNED_VERSION_DRIFT` naming `codex-cli` | command stdout |
| `AC-AI-43-07` | Run full test suite regression checks | `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` exits 0 and prints the string `fail 0` | command stdout |

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

The following harness creates a temporary manifest fixture where existing entry `trivy` is flipped from `PENDING` to `ADOPTED` and `BLOCKING_GATE`. The fixture maintains the exact 37-entry count required by `ecosystem.ps1:339` (satisfying schema validation with 0 errors), and proves that the manifest truth audit detects the missing gate, fails closed with exit code 1, and reports `QUALITY_GATE_MISSING: trivy`:

```powershell
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("shipde-neg-manifest-" + [Guid]::NewGuid())
$null = New-Item -ItemType Directory -Path (Join-Path $tempDir "tools") -Force
$fixtureManifest = Join-Path $tempDir "tools/ecosystem-manifest.json"

try {
    # 1. Generate 37-entry fixture by flipping existing entry 'trivy' to ADOPTED / BLOCKING_GATE.
    # Total count stays exactly 37, satisfying ecosystem.ps1 line 339 ($adopted.Count -ne 37),
    # while trivy is absent on host PATH, proving that the manifest truth audit (not the validator count check) fails closed.
    $m = Get-Content "tools/ecosystem-manifest.json" -Raw | ConvertFrom-Json
    $trivy = $m.adopted | Where-Object { $_.id -eq "trivy" }
    $trivy.lifecycle_state = "ADOPTED"
    $trivy.blocking_policy = "BLOCKING_GATE"
    $trivy.default_enabled = $true
    $m | ConvertTo-Json -Depth 10 | Set-Content -Path $fixtureManifest -Encoding ASCII

    # 2. Verify schema validation passes on the fixture (0 schema errors, count is 37)
    $p = Get-Content "tools/ecosystem-profiles.json" -Raw | ConvertFrom-Json
    . scripts/ai/ecosystem.ps1
    $schemaErrors = Assert-ShipDeManifest -Manifest $m -Profiles $p
    if ($schemaErrors.Count -ne 0) {
        throw "Fixture failed schema validation: $($schemaErrors -join '; ')"
    }

    # 3. Negative manifest truth audit execution on the fixture (exit code 1, QUALITY_GATE_MISSING: trivy)
    $testScript = Join-Path $tempDir "test-audit.js"
    @'
const path = require('path');
const fs = require('fs');
const { auditManifest } = require(path.join(process.cwd(), 'tools/ai-brain/manifest-audit'));
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const result = auditManifest(manifest);
const finding = result.findings.find(f => f.id === 'trivy');
console.error(finding.code + ': ' + finding.id);
if (result.summary.error > 0) process.exit(1);
'@ | Set-Content -Path $testScript -Encoding ASCII

    $nodeOut = node $testScript $fixtureManifest 2>&1
    if ($LASTEXITCODE -ne 1) {
        throw "Manifest audit failed negative check: expected exit code 1, got $LASTEXITCODE"
    }
    if ($nodeOut -notmatch "QUALITY_GATE_MISSING: trivy") {
        throw "Manifest audit output missing expected finding 'QUALITY_GATE_MISSING: trivy'"
    }

    Write-Host "NEGATIVE ACCEPTANCE HARNESS PASSED: Schema check passed (37 entries), manifest audit failed closed with exit code 1 and reported QUALITY_GATE_MISSING: trivy."
} finally {
    Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
}
```

### 3. Behavioral regression checks: classifier and authoritative workflow

The following commands verify the exact behavioral distinctions identified in review:

```powershell
# A. Quality gate classifier: absent adopted gate raises QUALITY_GATE_MISSING (error, exit 1)
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const t = m.adopted.find(x => x.id === 'trivy'); t.lifecycle_state = 'ADOPTED'; t.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'trivy'); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"
# Expected: QUALITY_GATE_MISSING: trivy (Exit code 1)

# B. Non-gate utility: absent adopted non-gate tool raises DECLARED_ADOPTED_BUT_ABSENT (warn, exit 0)
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const t = m.adopted.find(x => x.id === 'trivy'); t.lifecycle_state = 'ADOPTED'; t.role = 'General utility helper'; t.id = 'general-tool'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'general-tool'); console.log('Code:', f.code, 'Severity:', f.severity, 'Errors:', res.summary.error); if (f.code !== 'DECLARED_ADOPTED_BUT_ABSENT' || f.severity !== 'warn' || res.summary.error !== 0) process.exit(1);"
# Expected: Code: DECLARED_ADOPTED_BUT_ABSENT Severity: warn Errors: 0 (Exit code 0)

# C. Authoritative CI-provisioned gitleaks install in .github/workflows/security-baseline.yml at pinned 8.24.0 (happy path)
node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const hasPin = wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22'); console.log('Gitleaks pin ' + pin + ' in security-baseline.yml: ' + hasPin); if (!hasPin) process.exit(1);"
# Expected: Gitleaks pin 8.24.0 in security-baseline.yml: true (Exit code 0)

# D. Authoritative CI-provisioned gitleaks negative proof: missing or decoyed workflow fails closed (negative path)
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const os = require('os'); const fs = require('fs'); const path = require('path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-decoy-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(d, '.github', 'workflows', 'decoy.yml'), 'steps:\n  - run: echo no-gitleaks\n'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const res = auditManifest(m, { rootDir: d }); const f = res.findings.find(x => x.id === 'gitleaks'); fs.rmSync(d, { recursive: true, force: true }); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"
# Expected: QUALITY_GATE_MISSING: gitleaks (Exit code 1)
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5b9b1ce` | `CHANGES_REQUIRED` | [Finding 1 (P1 doctor.ps1:658)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773151): Reverted implementation scripts (`doctor.ps1`, `ecosystem.ps1`, `AI-TOOLCHAIN-DECISIONS.md`) from planning commit; branch bounded strictly to Work Item specification. [Finding 2 (P1 TASK-AI-43.md:11)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773166): Retained `READY_FOR_CODEX` because dependency `TASK-AI-17` was merged into `fix/task-ai-16-codex-launch-flags` via PR #19 (`1f587dd`), while register row 176 status synchronization is reserved for `TASK-AI-19` reconciler write-back rather than manual edit. [Finding 3 (P2 TASK-AI-43.md:148)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4006773187): Defined safe `-ManifestPath` injection parameter in `doctor.ps1`, added `AI-43-R07`, updated `AC-AI-43-03`, and provided full executable negative acceptance fixture harness in Verification commands. |
| 2 | `34014ce` | `CHANGES_REQUIRED` | [Finding 1](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Formatted Acceptance matrix to 4-part worked example structure naming exact command, expected exit code, required output string, and output source. [Finding 2 (Architectural)](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Negative fixture in `AC-AI-43-03` was adding a 38th entry, failing `ecosystem.ps1:339` count validation before the audit ran. Replaced with Option 1: flipping existing adopted entry `trivy` to `ADOPTED`/`BLOCKING_GATE`, keeping count at exactly 37, passing schema validation with 0 errors while failing closed on manifest truth (`QUALITY_GATE_MISSING: trivy`, exit 1). [Finding 3](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Brought `tools/ai-brain/cli.js` and `tools/ai-brain/manifest-audit.js` into implementation allowed paths and specified `--manifest <path>` support in `cli.js manifest`. [Finding 4](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Mandated authoritative install evidence in `.github/workflows/security-baseline.yml` at pinned `8.24.0` (`AC-AI-43-04`) and added negative proof for missing/decoyed workflow (`AC-AI-43-05`). [Finding 5](https://github.com/vinh05092001/shipde-platform/issues/22#issuecomment-5667336197): Reconciled Work Item status in Control table from `READY_FOR_CODEX` to `BLOCKED_DEPENDENCY` to strictly reflect authoritative delivery register row 176 (`FEATURE-DELIVERY-REGISTER.csv`). [Finding 6]: Removed undefined "strict mode" reference from `AI-43-R03`. |
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
