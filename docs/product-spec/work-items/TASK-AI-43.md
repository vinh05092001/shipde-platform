# TASK-AI-43 — Run the manifest audit as a blocking check

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-43` |
| Feature ID | `N/A` |
| Status | `IN_PROGRESS` |
| Delivery order | `176` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-43.md`, `tools/ai-brain/acceptance/ac-43-*.js` |
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
`DECLARED_ADOPTED_BUT_ABSENT`) fails closed with exit code 1 in those two
scripts, so a developer or reviewer who runs the health check cannot be told
`VALIDATED` while an adopted gate is absent.

### Enforcement boundary claimed by this Work Item

This Work Item deliberately does **not** claim that an absent adopted tool
fails the CI pipeline or halts orchestrator delivery. That claim would be false
at the current HEAD: no file under `.github/workflows/` and no line of
`scripts/ai/control.ps1` invokes `scripts/ai/doctor.ps1` or
`scripts/ai/ecosystem.ps1 -Action Validate`, so those two scripts are
manually-executed verification surfaces, not enforced delivery gates. The
measured caller count is `0`, asserted by `AC-AI-43-09`.

The outcome claimed and accepted here is therefore exactly:

- **Not delivered at HEAD (measured, see Defect D3).** This Work Item
  specified that `scripts/ai/doctor.ps1` and
  `scripts/ai/ecosystem.ps1 -Action Validate` exit `1` when the manifest audit
  reports `summary.error > 0`. At HEAD no file under `scripts/` invokes
  `tools/ai-brain/cli.js manifest`, requires `manifest-audit`, or contains the
  string `QUALITY_GATE_MISSING`, and `doctor.ps1` declares no `-ManifestPath`
  parameter. The manifest audit is a Brain CLI surface only. `AC-AI-43-08` now
  measures that wiring rather than asserting it, and fails the moment the
  wiring is added without this section being widened to match.
- The audit logic itself (`tools/ai-brain/manifest-audit.js`) classifies an
  absent adopted gate as a blocking error (`AC-AI-43-03`, `AC-AI-43-05`).

Promoting these scripts into an enforced delivery path — a
`.github/workflows/*` job or a `control.ps1` dispatch precondition — requires
editing paths this Work Item prohibits (see **Out of scope**) and is reserved
for a subsequent integration Work Item. Until that item lands, `AC-AI-43-09`
holds the boundary honest by failing if any such caller is added without the
business outcome above being updated to match.

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
- Specify the enforcement-boundary assertion (`AI-43-R10`, `AC-AI-43-09`): the Work Item claims no CI or controller enforcement, and that claim is machine-checked at `0` callers rather than asserted in prose.
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
| `AI-43-R01` | The manifest audit must run as a blocking check in `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1 -Action Validate`. **Measured status at HEAD: NOT IMPLEMENTED** — no file under `scripts/` invokes the manifest audit (`AC-AI-43-08`). Wiring it requires editing `scripts/ai/*`; see Defect D3. |
| `AI-43-R02` | Any manifest audit error (`summary.error > 0`, such as `QUALITY_GATE_MISSING` or `DECLARED_ADOPTED_BUT_ABSENT`) must fail closed: report the finding codes and tool IDs, record an actionable item in `$failures`, and exit with code 1. |
| `AI-43-R03` | Non-fatal warnings (such as `PINNED_VERSION_DRIFT` for `codex-cli`) must be printed visibly with exact evidence (`0.154.0` observed vs `0.151.0` pin), but must not block doctor or ecosystem validation runs (which fail only when `summary.error > 0`). |
| `AI-43-R04` | Tools declared with `install_method: "ci-provisioned"` (such as `gitleaks` at pinned `8.24.0`) must be verified against authoritative workflow declarations: `.github/workflows/security-baseline.yml` must exist and install `gitleaks` at the pinned version (`8.24.0`). If the workflow is missing, decoyed, or specifies a mismatched version, the audit must fail closed with error `QUALITY_GATE_MISSING` and exit code 1. |
| `AI-43-R05` | In PowerShell scripts under `Set-StrictMode -Version Latest`, checking error collections must safely guard against null objects before accessing `.Count`. |
| `AI-43-R06` | All files under `scripts/ai/` must remain pure ASCII with no byte-order mark (BOM). |
| `AI-43-R07` | Both `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` must accept an optional `-ManifestPath` parameter for testing (defaulting to `tools/ecosystem-manifest.json`) and forward `--manifest "$ManifestPath"` to `node tools/ai-brain/cli.js manifest`. `tools/ai-brain/cli.js manifest` must accept `--manifest <path>` so that test fixtures can be loaded while keeping repository `rootDir` intact. **Measured status at HEAD: NOT IMPLEMENTED** — `scripts/ai/doctor.ps1` declares no `-ManifestPath` parameter and `tools/ai-brain/cli.js manifest` accepts `--root`, not `--manifest`. See Defect D3. |
| `AI-43-R08` | Quality gate classification for absent adopted tools: an entry with `lifecycle_state: "ADOPTED"` and `present === false` is classified as a quality gate (raising blocking error `QUALITY_GATE_MISSING`) if its `blocking_policy === "BLOCKING_GATE"` or its `id`/`role` matches `/scan|leak|trivy|lefthook|axe|lint|audit/i`. Absent tools without quality-gate classification emit non-fatal warning `DECLARED_ADOPTED_BUT_ABSENT`. |
| `AI-43-R09` | The blocking surface delivered by this Work Item is exactly `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1 -Action Validate`. Both must exit `1` (not merely print a warning) when `summary.error > 0` for the manifest supplied via `-ManifestPath`. **Measured status at HEAD: NOT IMPLEMENTED** — neither script exits `1` on manifest audit errors, because neither runs the manifest audit. See Defect D3. |
| `AI-43-R10` | Enforcement boundary: at delivery, the number of files under `.github/workflows/` plus `scripts/ai/control.ps1` that invoke `doctor.ps1` or `ecosystem.ps1` must be exactly `0`. This Work Item therefore claims no CI or controller enforcement. If a future Work Item adds such a caller, `AC-AI-43-09` fails and the Business outcome section must be updated to match the new, wider claim before that caller is merged. |

## UI states

Not applicable; this Work Item has no user-facing web UI. Operator-facing console
states **specified** by the manifest-audit integration (`AI-43-R01`):

- **PASS**: `Ecosystem manifest audit: VALIDATED (27 checkable, 19 present, 8 missing, 0 errors, 1 warning [codex-cli drift])` with exit code 0.
- **FAIL**: `Ecosystem manifest audit: FAILED (N errors: QUALITY_GATE_MISSING: tool-id) -> ACTION REQUIRED` with exit code 1.

**Measured status at HEAD: NOT DELIVERED.** Neither string is produced by any
script in the repository. `doctor.ps1` and `ecosystem.ps1` do not run the
manifest audit (`AC-AI-43-08`: `MANIFEST_AUDIT_WIRED_SURFACES: 0`), so these are
the states the wiring must produce once a later Work Item delivers `AI-43-R01`
and `AI-43-R09`, not states an operator can observe today. The audit's own
console finding line for an absent adopted gate is `QUALITY_GATE_MISSING:
<tool-id>` (`AC-AI-43-03`). See Defect D7.

## API, event and data impact

No database schema, API route, or runtime data structure changes. Observable
impact is bounded to PowerShell health check scripts, Brain CLI manifest command,
and toolchain documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-43-01` | Validate production ecosystem manifest schema and profile conformity | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/ecosystem.ps1 -Action Validate` exits 0 and prints the string `VALIDATION PASSED: All 37 approved adopted repositories, 14 product dependencies, 10 candidates, and 9 profiles conform to ecosystem policy.` | command stdout |
| `AC-AI-43-02` | Manifest truth audit reports zero blocking errors against the production manifest (the invariant, not a pinned tally) | `node tools/ai-brain/acceptance/ac-43-02-manifest-zero-errors.js` exits 0 and prints the string `MANIFEST_AUDIT_ERRORS: 0` | command stdout, including the `CONTROL:` line showing a tampered copy of the manifest being rejected |
| `AC-AI-43-03` | Run manifest truth audit against negative fixture with absent quality gate (trivy flipped to ADOPTED) | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const t = m.adopted.find(x => x.id === 'trivy'); t.lifecycle_state = 'ADOPTED'; t.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'trivy'); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` exits 1 and prints the string `QUALITY_GATE_MISSING: trivy` | command stderr |
| `AC-AI-43-04` | Verify CI-provisioned gitleaks install in authoritative security-baseline workflow | `node -e "const fs = require('fs'); const wf = fs.readFileSync('.github/workflows/security-baseline.yml', 'utf8'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const g = m.adopted.find(x => x.id === 'gitleaks'); const pin = g.pinned_version_or_commit; const hasPin = wf.includes('GITLEAKS_VERSION=\x22' + pin + '\x22'); console.log('Gitleaks pin ' + pin + ' in security-baseline.yml: ' + hasPin); if (!hasPin) process.exit(1);"` exits 0 and prints the string `Gitleaks pin 8.24.0 in security-baseline.yml: true` | command stdout |
| `AC-AI-43-05` | Negative proof: verify missing or decoyed workflow fails closed on CI-provisioned gate | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const os = require('os'); const fs = require('fs'); const path = require('path'); const d = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-decoy-')); fs.mkdirSync(path.join(d, '.github', 'workflows'), { recursive: true }); fs.writeFileSync(path.join(d, '.github', 'workflows', 'decoy.yml'), 'steps:\n  - run: echo no-gitleaks\n'); const m = JSON.parse(fs.readFileSync('tools/ecosystem-manifest.json', 'utf8')); const res = auditManifest(m, { rootDir: d }); const f = res.findings.find(x => x.id === 'gitleaks'); fs.rmSync(d, { recursive: true, force: true }); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` exits 1 and prints the string `QUALITY_GATE_MISSING: gitleaks` | command stderr |
| `AC-AI-43-06` | Verify warning visibility for codex-cli version drift without blocking | `node tools/ai-brain/cli.js manifest` exits 0 and prints the string `[CẢNH] PINNED_VERSION_DRIFT` naming `codex-cli` | command stdout |
| `AC-AI-43-07` | Full test suite regression checks ran and were not vacuous | `node tools/ai-brain/acceptance/ac-43-07-suite-not-vacuous.js` exits 0 and prints the string `SUITE_NOT_VACUOUS:` | command stdout, including the `CONTROL:` line showing `node --test` exiting 0 on an empty directory, and the measured file/test/pass counts |
| `AC-AI-43-08` | Blocking surface: measured wiring of the manifest audit into `scripts/ai/doctor.ps1` and `scripts/ai/ecosystem.ps1` (measured at zero; see Defect D3) | `node tools/ai-brain/acceptance/ac-43-08-audit-wiring.js` exits 0 and prints the string `MANIFEST_AUDIT_WIRED_SURFACES: 0 []` | command stdout, including the `CONTROL:` line showing wiring injected into a copy of `doctor.ps1` being detected |
| `AC-AI-43-09` | Enforcement boundary is exactly 0 CI/controller callers, so the Business outcome claims no pipeline enforcement | `node tools/ai-brain/acceptance/ac-43-09-enforcement-boundary.js` exits 0 and prints the string `Enforced-path callers of doctor.ps1/ecosystem.ps1 outside scripts/ai: 0 []` | command stdout, reading `.github/workflows/*` and `scripts/ai/control.ps1`, including the `CONTROL:` line showing an injected caller in a copy being detected |

## Acceptance matrix audit (defects found and repaired)

Every row of the acceptance matrix above was extracted programmatically from the
markdown table and executed as stored, on Windows PowerShell, from the
repository root. Four rows did not hold. Each is recorded below with its
measurement and its replacement. Rows `AC-AI-43-01`, `AC-AI-43-03`,
`AC-AI-43-04`, `AC-AI-43-05` and `AC-AI-43-06` were re-measured and hold as
written; they read real repository files and each fails when run from an empty
directory with no repository present, so they are left unchanged.

### Step 1 measurement (rows as originally stored)

| Row | Expected exit | Actual exit | Expected string found | First 120 chars of actual output |
|---|---|---|---|---|
| `AC-AI-43-01` | 0 | 0 | yes | `=== VALIDATING ECOSYSTEM MANIFEST & PROFILES === Manifest : ...` |
| `AC-AI-43-02` | 0 | 1 | no | `37 repo khai trong manifest - kiem duoc 27 - co 18 - thieu 9 ... [LOI] DECLARED_INSTALLED_BUT_ABSENT (1)` |
| `AC-AI-43-03` | 1 | 1 | yes | `QUALITY_GATE_MISSING: trivy` |
| `AC-AI-43-04` | 0 | 0 | yes | `Gitleaks pin 8.24.0 in security-baseline.yml: true` |
| `AC-AI-43-05` | 1 | 1 | yes | `QUALITY_GATE_MISSING: gitleaks` |
| `AC-AI-43-06` | 0 | 0 | yes | `37 repo khai trong manifest ... [CANH] PINNED_VERSION_DRIFT (1) Pin la 0...` |
| `AC-AI-43-07` | 0 | 0 | yes | `tests 620, pass 620, fail 0` (but see D2: also 0 / `fail 0` outside the repository) |
| `AC-AI-43-08` | 1 | not extractable | n/a | command cell truncated mid-command by an unescaped `\|` |
| `AC-AI-43-09` | 0 | not extractable | n/a | command cell truncated mid-regex by an unescaped `\|` |

### D1 — `AC-AI-43-02`: stale pin

**Defect class:** stale pin. The row asserted the whole console tally
`Tong: 0 loi, 1 canh bao, 2 ghi chu`. Two of those three numbers are
host-dependent observations, not invariants: warning and note counts drift with
whatever happens to be installed on the workstation.

**Measurement:** the command exited `1` and printed
`DECLARED_INSTALLED_BUT_ABSENT (1)` with `co 18 - thieu 9` instead of
`co 19 - thieu 8`. Root cause: `onPath()` in `tools/ai-brain/manifest-audit.js`
probes with `where` under a 5-second timeout, which a cold or loaded
workstation can exceed; eleven subsequent runs, including six in parallel,
reported `co 19 - thieu 8` and exit `0`. The probe itself lives outside this
Work Item's allowed paths and is not changed here.

**Replacement:** `tools/ai-brain/acceptance/ac-43-02-manifest-zero-errors.js`,
which asserts only the invariant `summary.error === 0` against the real
manifest and prints the warning and note counts as evidence without comparing
them. No new number is pinned. A control step first writes a tampered copy of
the real manifest to the OS temp directory (flipping the existing `trivy` entry
to `ADOPTED`/`BLOCKING_GATE`, keeping 37 entries), re-reads it from disk, removes
it, and requires the audit to reject it, so a clean verdict cannot come from a
sleeping audit.

### D2 — `AC-AI-43-07`: an assertion that proves nothing

**Defect class:** vacuous assertion (tautology). The row asserted that
`node --test "tools/ai-brain/test/*.test.js" ...` exits 0 and prints
`fail 0`.

**Measurement:** run from an empty temporary directory with no repository
present, that exact command exits `0` and prints
`tests 0 / pass 0 / fail 0`. `node --test` reports a clean run when its globs
match nothing, so the row could not tell a green suite from no suite at all.

**Replacement:** `tools/ai-brain/acceptance/ac-43-07-suite-not-vacuous.js`,
which expands the globs against the real repository, requires them to resolve to
files, runs the suite, and asserts `tests >= file count`, `pass > 0` and
`fail === 0`. Its control step runs the identical command and the identical
parser from an empty directory and requires that vacuous run to be refused.
Measured at HEAD: 25 test files, 620 tests, 620 passed, fail 0.

### D3 — `AC-AI-43-08`: unrunnable, and a false claim underneath it

**Defect class:** unrunnable *and* false claim.

**Measurement (unrunnable):** the stored PowerShell one-liner contains unescaped
`|` characters (`Get-Content ... | ConvertFrom-Json`, `$m.adopted | Where-Object`).
In a markdown table those split the cell, so the command extracted from the
table ends at `$m=Get-Content tools/ecosystem-manifest.json -Raw`. Reassembled
by hand from the raw source line and executed, it still fails to parse:
`An empty pipe element is not allowed` at char 231, because the nested
double-quoted `-Command` string does not survive a second shell layer.

**Measurement (false claim):** the claim itself is untrue at HEAD.
`grep -rn "QUALITY_GATE_MISSING" scripts/` and
`grep -rn "cli.js manifest\|manifest-audit" scripts/` both return nothing, and
`scripts/ai/doctor.ps1` declares only `-AiRoot`, `-TestDocker` and
`-TestModels` — no `-ManifestPath`. `doctor.ps1` can never print
`QUALITY_GATE_MISSING: trivy`; its exit `1` on this workstation comes from
unrelated findings (Codex authentication, a dirty worktree). Wiring the audit
requires editing `scripts/ai/*`, which the Author boundary of this Work Item
prohibits, so the claim is corrected rather than satisfied: the Business outcome
and `AI-43-R01`/`AI-43-R07`/`AI-43-R09` are now marked NOT IMPLEMENTED at HEAD.

**Replacement:** `tools/ai-brain/acceptance/ac-43-08-audit-wiring.js`, which
measures the wiring instead of asserting it. It reads the two real health-check
scripts, reports the number of wired surfaces (`0` at HEAD), and exits `1` with
`CLAIM_STALE` the moment wiring appears — forcing the prose above to be widened
in the same change. Its control step injects the claimed wiring line into a copy
of `doctor.ps1` and requires the detector to find it, so `0` cannot come from a
dead pattern.

### D4 — `AC-AI-43-09`: unrunnable

**Defect class:** unrunnable. The command embeds the regular expression
`/(doctor|ecosystem)\.ps1/`, whose `|` is unescaped inside a markdown table
cell. Extracted from the table, the command ends at `...filter(f=>/(doctor`.
Reassembled by hand from the raw source line, the logic itself is sound and
exits `0`; the defect is storage, not logic.

**Replacement:** `tools/ai-brain/acceptance/ac-43-09-enforcement-boundary.js`,
carrying the identical logic in a committed file that no markdown escaping can
corrupt, plus a control step that injects a `doctor.ps1` call into a copy of a
real workflow file and requires it to be flagged.

### Exit codes of the new acceptance scripts

| Script | In repository | From an empty directory, no repository |
|---|---|---|
| `ac-43-02-manifest-zero-errors.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-43-07-suite-not-vacuous.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-43-08-audit-wiring.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-43-09-enforcement-boundary.js` | `0` | `2` (`SOURCE_MISSING`) |

All four follow `tools/ai-brain/acceptance/ac-07-13-forbidden-lifecycle.js`:
a control step that tampers with a copy and requires the real check to reject
it, real repository files read from disk, the tampered copy written in the OS
temp directory and removed so that no repository file is written, and exit `2`
rather than a false pass when run outside the repository.

### D5 — a no-write claim the code does not keep

**Defect class:** false claim in the specification.

**Claim at HEAD.** The paragraph above asserted "no file on disk ever written",
and D1 described its control as tampering "with an in-memory copy of the real
manifest". Measured, both claims are false.

**Measurement.** The accepted scripts write to disk:

| Script | Write | Location | Removed |
|---|---|---|---|
| `ac-43-02-manifest-zero-errors.js` (lines 42, 44) | tampered manifest copy | `os.tmpdir()` | `fs.unlinkSync` |
| `ac-43-08-audit-wiring.js` (lines 46, 48) | `doctor.ps1` copy with the wiring line | `os.tmpdir()` | `fs.unlinkSync` |
| `ac-43-09-enforcement-boundary.js` (lines 43-50) | workflow copy with an injected caller | `fs.mkdtempSync(os.tmpdir(), …)` | `fs.rmSync` |

Each writes a copy, reads it back, and removes it. None writes inside the
repository, and that part of the claim is true; "no file on disk ever written"
and "in-memory copy" are not.

**Replacement.** The paragraph now states exactly what the code does: the
tampered copy is written in the OS temp directory and removed, and no repository
file is written. D1 now says the control writes a tampered copy to the OS temp
directory and re-reads it. No script changed, because the code was already
correct; only the description of it was wrong.

### D6 — a review finding that did not hold: `AC-AI-43-08` / `AC-AI-43-09` are not regex-only

**Finding reviewed.** `ac-43-08` "writes the manifest to a temp copy and
re-reads it; `ac-43-09` injects a step into a copy and reads it back", and these
"prove only regex syntax" rather than exercising the real check.

**Verification from the code.** Both scripts were read and executed, and the
claim was tested by mutation. It does not hold.

- The control is a genuine disk round-trip, not a string comparison: each control
  calls `fs.writeFileSync(tmp, …)` and then `wiring(fs.readFileSync(tmp, 'utf8'))`
  (`ac-43-08`) or `CALLER.test(fs.readFileSync(tmp, 'utf8'))` (`ac-43-09`). The
  bytes come back off disk.
- The detector applied to the copy is the same function object applied to the
  real files: `wiring()` reads `scripts/ai/doctor.ps1` and
  `scripts/ai/ecosystem.ps1`; `CALLER` reads every `.github/workflows/*` file plus
  `scripts/ai/control.ps1`. Control and measurement share one code path, so a
  control hit and a measurement miss cannot come from different logic.
- The measurement tracks real repository content, which is the decisive test of
  "exercises the real check":

| Mutation of a real repository file | Script | Exit before | Exit after | Output after |
|---|---|---|---|---|
| append the claimed wiring line to `scripts/ai/doctor.ps1` | `ac-43-08` | `0` | `1` | `MANIFEST_AUDIT_WIRED_SURFACES: 1 ["scripts/ai/doctor.ps1 …"]` and `CLAIM_STALE` |
| append `- run: pwsh scripts/ai/doctor.ps1` to `.github/workflows/security-baseline.yml` | `ac-43-09` | `0` | `1` | `Enforced-path callers …: 1 [".github\\workflows\\security-baseline.yml"]` and `ENFORCEMENT_BOUNDARY_WIDENED` |

  Both mutations were reverted; the SHA-256 of each file was compared before
  and after the measurement and is unchanged, and the working tree is clean.

**Verdict.** The finding is wrong and no script was changed. The checks are
textual because the claim they verify is textual: the Business outcome asserts
that no file under `scripts/` "invokes `tools/ai-brain/cli.js manifest`",
"requires `manifest-audit`", or "contains the string `QUALITY_GATE_MISSING` at
all", which is a statement about file contents. A textual check is the correct
instrument for a textual claim, and the mutation above shows the instrument
reacts to the real files rather than to its own injected literals.

### D7 — the `Verification commands` and `UI states` blocks state expectations the repository does not meet

**Defect class:** stale pin and false claim, outside the acceptance matrix.

The audit above covered the acceptance matrix. The same two defect classes also
stood in two prose blocks of this Work Item; both were measured at HEAD before
being rewritten.

**Measurement (Verification commands §1), executed from the repository root:**

| Command | Stored expectation | Measured at HEAD |
|---|---|---|
| `scripts/ai/ecosystem.ps1 -Action Validate` | exit 0, `Ecosystem manifest: VALID` | exit 0; prints `VALIDATION PASSED: All 37 approved adopted repositories, 14 product dependencies, 10 candidates, and 9 profiles conform to ecosystem policy.` No script anywhere prints `Ecosystem manifest: VALID`. |
| `scripts/ai/doctor.ps1` | exit 0, `Ecosystem manifest audit: VALIDATED` | `doctor.ps1` does not run the manifest audit (`AC-AI-43-08`: `MANIFEST_AUDIT_WIRED_SURFACES: 0`), so it cannot print that line. This is the false claim D3 corrected in the Business outcome; §1 still carried it. |
| `node tools/ai-brain/cli.js manifest` | exit 0, `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | exit 0, `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` today; the warning and note counts are host-dependent (D1) and are not an invariant. |
| `node tools/ai-brain/cli.js reconcile` | exit 0, `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | exit 0, `Tổng: 0 lỗi, 0 cảnh báo, 150 ghi chú`. The pinned tally had drifted. |
| `node --test <three globs>` | exit 0, 458 passed, 0 failed | exit 0, 25 test files, 641 tests, 641 passed, 0 failed. The pinned tally had drifted. |
| `python docs/product-spec/scripts/validate_docs.py` | exit 0 | exit 0 today. |

**Measurement (UI states).** Both operator-facing console strings are specified
behaviour of the manifest-audit wiring, and neither is produced by any script in
the repository at HEAD: `doctor.ps1` and `ecosystem.ps1` do not run the manifest
audit, so the `VALIDATED` and `FAILED ... -> ACTION REQUIRED` states cannot be
observed today. The audit's console surface today is the Brain CLI report, whose
finding line for an absent adopted gate is `QUALITY_GATE_MISSING: <tool-id>`
(`AC-AI-43-03`).

**Replacement.** §1 now states only the invariants (exit code 0; `Tổng: 0 lỗi`)
and names the string each command actually prints, deferring every count and
pass tally to the acceptance script that asserts it (`AC-AI-43-01`,
`AC-AI-43-02`, `AC-AI-43-07`); it records that `doctor.ps1` is not a
manifest-audit surface. The `UI states` block now marks those two console
states as specified but not delivered at HEAD, matching the `NOT IMPLEMENTED`
marking already applied to `AI-43-R01`, `AI-43-R07` and `AI-43-R09`. No code
changed; only the expectations.

## Verification commands

### 1. Standard repository verification suite

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/ecosystem.ps1 -Action Validate
# Expected: Exit code 0. Measured at HEAD it prints
#   "VALIDATION PASSED: All 37 approved adopted repositories, 14 product dependencies,
#    10 candidates, and 9 profiles conform to ecosystem policy."
# asserted by AC-AI-43-01. No script prints "Ecosystem manifest: VALID"; see Defect D7.

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/doctor.ps1
# Expected: no manifest-audit verdict. doctor.ps1 does NOT run the manifest audit at HEAD
# (AC-AI-43-08 measures MANIFEST_AUDIT_WIRED_SURFACES: 0), so it neither fails on manifest
# audit errors nor prints "Ecosystem manifest audit: VALIDATED"; its exit code reflects
# unrelated workstation findings only. See Defects D3 and D7.

node tools/ai-brain/cli.js manifest
# Expected: Exit code 0, "Tổng: 0 lỗi" (zero blocking errors). The warning and note counts are
# host-dependent observations, not invariants (Defect D1); ac-43-02 asserts summary.error === 0
# against the real manifest. Measured at HEAD: 0 errors, 1 warning (codex-cli pin drift), 2 notes.

node tools/ai-brain/cli.js reconcile
# Expected: Exit code 0, "Tổng: 0 lỗi". Warning and note counts are host-dependent and are not
# pinned here (Defect D1). Measured at HEAD: 0 errors, 0 warnings, 150 notes.

node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
# Expected: Exit code 0, fail 0. The pass count is not an invariant and is not pinned here;
# ac-43-07 asserts the suite is non-vacuous (at least one test per file, pass > 0, fail 0).
# Measured at HEAD: 25 test files, 641 tests, 641 passed, 0 failed.

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
| 3 | `HEAD` | `CHANGES_REQUIRED` | [Finding 1 (P1 TASK-AI-43.md:9 — return to READY_FOR_AUTHOR)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4007073629): Already resolved at HEAD and no further change made. The finding was raised against `READY_FOR_CODEX`; the Control table reads `BLOCKED_DEPENDENCY`, matching authoritative register row 176. `BLOCKED_DEPENDENCY` is strictly more restrictive than `READY_FOR_AUTHOR` and does not present the item as review-ready, so no promotion or weakening was applied. [Finding 2 (P1 TASK-AI-43.md:182 — negative fixture must exercise a missing gate)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4007073640): Already resolved at HEAD and re-verified by execution. The fixture no longer uses `install_method: "manual"` or a 38th entry; it flips the existing entry `trivy` (`install_method: "system"`, a recognized checkable kind per `manifest-audit.js` `INSTALL_KINDS.SYSTEM`) to `ADOPTED`/`BLOCKING_GATE`, keeping exactly 37 schema-valid entries. `AC-AI-43-03` executes and asserts the exact code `QUALITY_GATE_MISSING: trivy` at exit 1. [Finding 3 (P1 TASK-AI-43.md:125 — wire the audit into an enforced delivery path)](https://github.com/vinh05092001/shipde-platform/pull/22#discussion_r4007073643): Confirmed and fixed by narrowing the claimed business outcome, the option Codex offered, because adding a CI or controller caller requires editing `.github/` and `scripts/ai/control.ps1`, both prohibited by this Work Item. Added the **Enforcement boundary** subsection, `AI-43-R09`/`AI-43-R10`, `AC-AI-43-08` (`doctor.ps1` itself exits 1 on the absent-gate fixture) and `AC-AI-43-09` (measured caller count is `0`, and fails if one is added without widening the claim). |

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
