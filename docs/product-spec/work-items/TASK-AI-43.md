# TASK-AI-43 — Run the manifest audit as a blocking check

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-43` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `176` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `scripts/ai/doctor.ps1`, `scripts/ai/ecosystem.ps1`, `docs/product-spec/work-items/TASK-AI-43.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-43-audit-gate` |
| Pull Request | `<URL>` |

## Business outcome

A tool believed to be running while absent must fail the pipeline, not sit in an
advisory report. The ecosystem manifest `tools/ecosystem-manifest.json` defines
the authoritative set of 37 adopted repositories, tools, and quality gates
governing development, security, and verification across Ship Dễ.

Prior to this Work Item, the automated manifest truth audit
(`node tools/ai-brain/cli.js manifest`) was available as a standalone CLI
command, but was not integrated into the blocking health check
`scripts/ai/doctor.ps1` or `scripts/ai/ecosystem.ps1 -Action Validate`. The
doctor script only validated static JSON schema constraints (such as verifying
that the adopted tools array contains exactly 37 elements and that 9 profiles
are declared), without verifying whether declared tools actually exist on the
workstation, in monorepo dependencies, or in CI workflow definitions.
Consequently, an environment where critical quality gates were absent while
claimed as `ADOPTED` would still receive a passing "VALIDATED" status.

Wiring the manifest audit into `doctor.ps1` and `ecosystem.ps1` ensures that any
unverified overclaiming of reality (such as `QUALITY_GATE_MISSING` or
`DECLARED_ADOPTED_BUT_ABSENT`) immediately fails closed with exit code 1,
halting delivery until tools are either honestly installed or reconciled in the
manifest.

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
- Node.js v24 workstation runtime available on PATH.
- `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` operational.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to the allowed paths:
- `scripts/ai/doctor.ps1`
- `scripts/ai/ecosystem.ps1`
- `docs/product-spec/work-items/TASK-AI-43.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`

Prohibited in this Work Item:
- Modifying anything under `.github/`, `scripts/verify-*`,
  `docs/product-spec/scripts/`, `.gitleaks.toml`, or any existing validator.
- Flipping a declared `lifecycle_state` or Work Item status to make a check pass.
- Disabling, skipping, or narrowing any audit rule or error severity.
- Introducing byte-order marks (BOM) or non-ASCII characters into `scripts/ai/*`.
- Author self-approval.

## In scope

- Execute `node tools/ai-brain/cli.js manifest` during ecosystem validation in
  `scripts/ai/ecosystem.ps1 -Action Validate` and `scripts/ai/doctor.ps1`.
- Enforce fail-closed blocking: if `summary.error > 0` (e.g. `QUALITY_GATE_MISSING`,
  `DECLARED_ADOPTED_BUT_ABSENT`), output exact finding codes and missing tool
  identifiers, append to `$failures`, and exit with code 1.
- Preserve differentiation between blocking errors and non-fatal warnings:
  documented warnings (`PINNED_VERSION_DRIFT` for `codex-cli`) are printed
  visibly for operator awareness but do not cause failure in default mode.
- Resolve the PowerShell strict-mode null collection evaluation bug in
  `ecosystem.ps1` (`if ($errors.Count -gt 0)` when `$errors` is null).
- Record the blocking manifest audit integration in `AI-TOOLCHAIN-DECISIONS.md`.
- Author this Work Item specification `docs/product-spec/work-items/TASK-AI-43.md`.
- Ensure all repository tests and reconciliation checks stay green.

## Out of scope

- Modifying GitHub Actions workflow definitions under `.github/`.
- Modifying repository validator scripts or test fixtures.
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
| `AI-43-R04` | Tools declared with `install_method: "ci-provisioned"` (such as `gitleaks` at pinned 8.24.0 in `.github/workflows/security-baseline.yml`) must be verified against workflow declarations rather than local host `PATH`, preventing false-positive failures on developer workstations. |
| `AI-43-R05` | In PowerShell scripts under `Set-StrictMode -Version Latest`, checking error collections must safely guard against null objects before accessing `.Count`. |
| `AI-43-R06` | All files under `scripts/ai/` must remain pure ASCII with no byte-order mark (BOM). |

## UI states

Not applicable; this Work Item has no user-facing web UI. Operator-facing console
states:
- **PASS**: `Ecosystem manifest audit: VALIDATED (27 checkable, 19 present, 8 missing, 0 errors, 1 warning [codex-cli drift])`
- **FAIL**: `Ecosystem manifest audit: FAILED (N errors: QUALITY_GATE_MISSING: tool-id) -> ACTION REQUIRED` with exit code 1.

## API, event and data impact

No database schema, API route, or runtime data structure changes. Observable
impact is bounded to PowerShell health check scripts and toolchain documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-43-01` | Run `doctor.ps1` against reconciled manifest | Manifest audit passes, 0 errors, reports VALIDATED, exits cleanly on manifest gate | Console stdout |
| `AC-AI-43-02` | Run `ecosystem.ps1 -Action Validate` | Schema and manifest truth audit both execute and pass with 0 errors | Console stdout |
| `AC-AI-43-03` | Simulate missing adopted quality gate in manifest | Audit detects overstatement, `doctor.ps1` and `ecosystem.ps1` fail closed with exit code 1 and list tool ID | Console stderr/stdout |
| `AC-AI-43-04` | Verify CI-provisioned gate handling | `gitleaks` is recognized as present via workflow evidence without requiring local binary | Manifest audit stdout |
| `AC-AI-43-05` | Verify warning visibility | `codex-cli` version drift (`0.154.0` vs `0.151.0`) is displayed visibly as a warning without blocking | Console stdout |
| `AC-AI-43-06` | Regression checks | `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"`, `node tools/ai-brain/cli.js reconcile`, `node tools/ai-brain/cli.js manifest` all pass | Test runner stdout |

## Verification commands

```
powershell -NoProfile -File scripts/ai/ecosystem.ps1 -Action Validate
powershell -NoProfile -File scripts/ai/doctor.ps1
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

The manifest audit on developer workstations validates CI-provisioned tools by
inspecting GitHub Actions workflow YAML files rather than by executing them
locally, since tools such as Linux-based CI scanners may not be installed
locally. Full local execution of security scanners is deferred to dedicated
work items (`TASK-AI-35` for betterleaks, `TASK-AI-36` for lefthook,
`TASK-AI-37` for trivy). The `codex-cli` version drift warning remains open
pending a deliberate human upgrade decision per `AI-TOOLCHAIN-DECISIONS.md`.
