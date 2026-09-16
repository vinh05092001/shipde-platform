# TASK-AI-36 — Lefthook git hook manager

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-36` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `169` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `package.json`, `pnpm-lock.yaml`, `lefthook.yml`, `tools/ecosystem-manifest.json`, `tools/ai-guard/**`, `tools/ai-brain/acceptance/ac-36-*.js`, `docs/product-spec/work-items/TASK-AI-36.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `scripts/ai/doctor.ps1`, `scripts/ai/bootstrap-worktrees.ps1` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-36-lefthook` |
| Pull Request | `https://github.com/vinh05092001/shipde-platform/pull/20` |

## Business outcome

Git hooks are the developer and agent front line for enforcing repository safety, preventing secret leaks, and avoiding concurrent writer collisions across semi-automatic workspaces. Currently, writer claim protection (`tools/ai-guard/cli.js check`) and secret scan verification depend on fragile per-worktree configuration (`core.hooksPath` set manually or via worktree scripts). Furthermore, automatic npm/pnpm lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) are strictly forbidden in both root `package.json` and `apps/web/package.json` by repository supply-chain security audit policies, which means git hooks cannot be installed implicitly on `pnpm install`.

Adopting Lefthook (`evilmartians/lefthook`) provides a fast, declarative, polyglot Git hook manager that hosts both the writer claim check and staged secret scan gates under version-controlled configuration (`lefthook.yml`). Lefthook executes hooks reliably across Windows and POSIX environments, enables parallel or sequential task execution, supports transparent bypass mechanisms for emergencies (`--no-verify` / `LEFTHOOK=0`), and replaces bespoke, error-prone `core.hooksPath` overrides with a standardized, auditable hook installation workflow verified by `scripts/ai/doctor.ps1`.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent Codex review gate.
- `AGENTS.md` § Semi-automatic workspaces — Five isolated worktrees (`shipde-platform`, `shipde-claude`, `shipde-dsh`, `shipde-gemini`, `shipde-codex`); single-writer invariant per Work Item.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `AGENTS.md` § Foundation verification commands — Authoritative root workspace verification gates.
- `tools/ecosystem-manifest.json` — Entry `lefthook` (pinned `1.11.3`, `npm-dev`, `git-hook-runner`, `FOUNDATION`, `SECURITY_REVIEW`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply integrated, enabled or blocking.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-03` — Only one implementation agent and one research agent; parallel writer protection.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — A failed or partial installation reports exact state; never claim installed without evidence.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Ecosystem catalog & Security & Hygiene tooling.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 169 (`TASK-AI-36`).
- `tools/ai-guard/writer-claim.js` and `tools/ai-guard/cli.js` — Authoritative writer claim checking logic (`check` command).
- `.github/workflows/security-baseline.yml` and `.github/workflows/current-application.yml` — Authoritative CI secret-scanning gate with pinned Gitleaks 8.24.0.
- `scripts/ai/doctor.ps1` — Workspace and health diagnostics.
- `scripts/ai/bootstrap-worktrees.ps1` — Governed worktree provisioning.

## Preconditions and dependencies

- Dependency resolution and register write-back: `TASK-AI-17` is merged into base branch `fix/task-ai-16-codex-launch-flags` via commit `1f587dd` (PR #19), so the prerequisite is satisfied in Git reality. The Control status nevertheless remains `BLOCKED_DEPENDENCY`, because `AGENTS.md` makes the delivery register the authoritative source of a Work Item status and this document must not contradict it. Row 169 of `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` still displays `BLOCKED_DEPENDENCY`; that row is advanced by the sanctioned `TASK-AI-19` reconciler write-back under orchestrator governance policies, never by manual ad-hoc edits from this Work Item. The displayed register value is therefore documented here rather than asserted as an acceptance criterion.
- `gitleaks` is `ADOPTED` and a `BLOCKING_GATE`, `install_method: "ci-provisioned"`, installed by `.github/workflows/security-baseline.yml` and `.github/workflows/current-application.yml` at pinned `8.24.0`. It is NOT absent.
- `lefthook` and `trivy` genuinely are absent from host and workspace devDependencies prior to implementation, and are declared `PENDING` with `blocking_policy: "NON_BLOCKING"` in `tools/ecosystem-manifest.json`.
- `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly one warning (`PINNED_VERSION_DRIFT` for `codex-cli`: pin `0.151.0` vs observed `0.154.0`, which is an intentional human decision under the upgrade rule). This invariant must be maintained.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors.
- Package manifest policy: Root `package.json` and workspace manifests (`apps/web/package.json`) strictly forbid all four install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`). Git hook installation must never execute implicitly via npm/pnpm lifecycle hooks; Lefthook hook installation must be explicitly invocable (`pnpm lefthook install`) and wired into worktree bootstrapping.
- Workstation secret scanning availability: On clean workstations (including Windows) where native Gitleaks binary is not installed in system PATH, invoking `pnpm security:secrets` produces an operational exit code 2. Local pre-commit hook defense-in-depth requires a locally available staged-content scanner wrapper (`node tools/ai-guard/cli.js staged-secrets`) that evaluates staged content without blocking clean commits on missing PATH binaries, while retaining the existing CI Gitleaks gate.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to configuring Lefthook as a devDependency, defining `lefthook.yml`, updating worktree bootstrap and doctor scripts, providing/configuring the staged secret scanner in `tools/ai-guard/`, promoting `lefthook` in `tools/ecosystem-manifest.json`, and updating documentation.

Prohibited in this Work Item:
- Do NOT edit anything under `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, `.gitleaks.toml`, or any validator script.
- Do NOT add any of the four forbidden install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) to root `package.json` or `apps/web/package.json`.
- Do NOT disable, skip, or narrow any check or quality gate.
- Do NOT modify review verdict parsing, exact-HEAD binding, or supervisor logic in `scripts/ai/control.ps1`.
- Do NOT promote `trivy` or any other tool from `PENDING` without its own dedicated Work Item (`TASK-AI-37`).
- Do NOT alter the pinned `codex-cli` version.

## In scope

- Add `lefthook` pinned at exact version `1.11.3` as a devDependency in root `package.json`.
- Author declarative, version-controlled `lefthook.yml` at repository root:
  - `pre-commit` stage executing `writer-claim` (`node tools/ai-guard/cli.js check`).
  - `pre-commit` stage executing `staged-secret-scan`: executes single concrete approach `node tools/ai-guard/cli.js staged-secrets` that queries the Git staged index (`git diff --cached` / `git show :<file>`) and validates staged changes against `.gitleaks.toml` patterns with an execution timeout budget of `5000ms` and memory budget of `512MB`, rather than invoking `pnpm security:secrets` (which scans working tree / commit log and fails with operational code 2 when Gitleaks binary is absent from PATH).
  - Cross-platform shell invocation ensuring robust execution through Git's hook shell on Windows (`C:\Program Files\Git\bin\sh.exe`) and POSIX runners (`sh`).
- Retain the existing CI `pnpm security:secrets` (Gitleaks 8.24.0) gate in GitHub Actions workflows as the authoritative CI secret barrier.
- Implement the staged-content secret scanner wrapper in `tools/ai-guard/` (`node tools/ai-guard/cli.js staged-secrets` and `tools/ai-guard/staged-secrets.js`) with safely generated temporary fixtures (never committed secret tokens) and regression tests in `tools/ai-guard/test/`.
- Update `scripts/ai/bootstrap-worktrees.ps1` to execute `pnpm lefthook install` (strictly requiring a prior frozen install) or pinned fallback `npx lefthook@1.11.3 install`. Bare `npx lefthook install` is strictly forbidden to prevent unpinned remote package execution under `AI-TOOL-11`.
- Update `scripts/ai/doctor.ps1` to verify Lefthook binary resolution (`lefthook version`), staged scanner readiness, and hook installation status across governed worktrees.
- Update `tools/ecosystem-manifest.json` for `lefthook`:
  - Promote `lifecycle_state` from `PENDING` to `ADOPTED` **after** the root `devDependencies` pin has landed, so the audit's `dependency "lefthook"` presence probe is satisfied and the promotion audits green (`AC-AI-36-01`) rather than raising `QUALITY_GATE_MISSING`.
  - Set `default_enabled: true`.
  - Set `blocking_policy: "BLOCKING_GATE"`.
  - Verify `health_check: "lefthook version"`.
  - Update `updated_at` timestamp.
- Record the architectural rationale and configuration in `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.
- Ensure all authoritative workspace root verification commands and quality gates remain green:
  - `pnpm install --prod --frozen-lockfile` (clean checkout regression gate)
  - `pnpm install --frozen-lockfile`
  - `pnpm db:generate`
  - `pnpm lint`
  - `pnpm format:check`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:e2e`
  - `pnpm test:baseline`
  - `pnpm security:secrets`
  - `pnpm build`
  - `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"`
  - `node tools/ai-brain/cli.js reconcile`
  - `node tools/ai-brain/cli.js manifest` (0 errors, 1 warning for codex-cli drift)
  - `python docs/product-spec/scripts/validate_docs.py`
  - `pwsh -NoProfile -File scripts/ai/doctor.ps1`

## Out of scope

- Container or dependency scanning with Trivy (owned by `TASK-AI-37`).
- Secret scanning engine migration to betterleaks (owned by `TASK-AI-35`).
- Accessibility or Lighthouse CI performance gates (owned by `TASK-AI-38`).
- Editing CI workflow files under `.github/workflows/`.
- Changing Agent Orchestrator supervisor lock or verdict algorithms.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-36-R01` | Declarative hook definition: Git hook definitions must be declared exclusively in version-controlled `lefthook.yml` at repository root, never hidden in developer-specific untracked files. |
| `AI-36-R02` | No forbidden lifecycle scripts: Git hook installation must never rely on npm/pnpm lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) in either root `package.json` or `apps/web/package.json`, preserving the repository supply-chain audit invariant. |
| `AI-36-R03` | Pinned, verifiable installation: Hook installation is performed via `pnpm lefthook install` (following a frozen install) or pinned fallback `npx lefthook@1.11.3 install`. Bare `npx lefthook install` without version pin is strictly forbidden under `AI-TOOL-11`. Verified by `scripts/ai/doctor.ps1`. |
| `AI-36-R04` | Fail-closed writer claim check: The `pre-commit` hook must execute `node tools/ai-guard/cli.js check` and refuse commit if the current branch is held by a live concurrent AO or external writer session under `AI-TOOL-03`. |
| `AI-36-R05` | Local defense-in-depth staged secret scan: The `pre-commit` hook must execute single concrete approach `node tools/ai-guard/cli.js staged-secrets` scanning the Git staged index (`git diff --cached` / staged file contents) within an execution timeout budget of `5000ms` and memory budget of `512MB`. Those budgets are enforced inside the scanner and are overridable for testing via `AI_GUARD_STAGED_TIMEOUT_MS` (default `5000`) and `AI_GUARD_STAGED_MAX_BYTES` (default `536870912`); exceeding either exits `2` with `STAGED_SCAN_BUDGET_EXCEEDED`. A clean staged set exits `0` printing `STAGED_SCAN_CLEAN: 0 secrets detected`; a detection exits `1` printing `STAGED_SECRET_DETECTED: <file>`. Secrets staged in the index are detected even if the working tree copy was subsequently altered or deleted. Secret detection testing must strictly use safely generated temporary fixtures in isolated test repositories rather than committed detectable secret tokens, preserving CI Gitleaks gate invariants. Evaluating `.gitleaks.toml` rules via Node.js prevents operational code 2 failures on workstations where Gitleaks is not on PATH, while retaining `pnpm security:secrets` (Gitleaks 8.24.0) as the authoritative CI gate. |
| `AI-36-R06` | Cross-platform and worktree safety: Lefthook hooks must operate correctly through Git's native hook shell in Windows (`C:\Program Files\Git\bin\sh.exe`) and POSIX (`sh`) environments across all 5 isolated worktrees without corrupting shared repository storage. Because `.github/` is out of scope for TASK-AI-36, cross-platform reproducibility is proven locally using both PowerShell and Git's POSIX hook shell (`sh.exe`), avoiding POSIX-only shell assumptions. |
| `AI-36-R07` | Legitimate bypass preserves auditability: Emergency commits remain overridable via standard Git flags (`git commit --no-verify`) or environment variables (`LEFTHOOK=0`); the hook runner must not disable or tamper with Git's native bypass flags. |
| `AI-36-R08` | Truthful manifest promotion, with the gating artifact named: `lefthook` may only be promoted to `ADOPTED` / `BLOCKING_GATE` in `tools/ecosystem-manifest.json` once the quality-gate artifact it depends on has landed. For `install_method: "npm-dev"` the audit probes presence as `dependency "lefthook"` across workspace manifests (`tools/ai-brain/manifest-audit.js`), so that artifact is the exact pin `"lefthook": "1.11.3"` in root `package.json` `devDependencies`, installed and health-checked by `pnpm exec lefthook version`. Promotion before the pin lands is fail-closed as `QUALITY_GATE_MISSING` (`AC-AI-36-19`); promotion after it lands is the required passing end state and audits green with 0 errors (`AC-AI-36-01`). |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer and agent interaction is through Git CLI terminal output and `scripts/ai/doctor.ps1`:
- **Allowed commit**: Lefthook runs `writer-claim` and `staged-secret-scan` quietly; commit proceeds without friction across Windows and POSIX shells (exit code 0).
- **Writer collision blocked**: Emits clear diagnostic stating which session/owner holds the branch, providing unblock guidance (`node tools/ai-guard/cli.js release` or `git commit --no-verify`), aborting commit with non-zero exit code 1.
- **Secret leak blocked**: Staged secret detected in git index via staged-content scanner wrapper; emits file path and matched pattern details, aborting commit with non-zero exit code 1 before unencrypted secrets enter local git history, even if working-tree copy was modified or deleted.
- **Doctor diagnosis**: `scripts/ai/doctor.ps1` reports `PASS lefthook` when binary and hooks are active, or `FAIL lefthook` with remediation instructions.

## API, event and data impact

No database schema, runtime REST API, or carrier integration contract changes. Toolchain and repository impact:
- Root `package.json` adds `lefthook: "1.11.3"` to `devDependencies`.
- Root `lefthook.yml` added to version control.
- Git hooks generated under `.git/hooks/` (or worktree gitdir) managed by Lefthook.
- `tools/ecosystem-manifest.json` promotes `lefthook` from `PENDING` to `ADOPTED`.
- Staged secret scanner wrapper defined under `tools/ai-guard/` (`cli.js staged-secrets`).

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-36-01` | Passing end state: `lefthook` is committed as `ADOPTED` / `BLOCKING_GATE` in the manifest and the audit is green, because the gating artifact (root `devDependencies` pin) has landed — **NOT MET AT HEAD (D-03).** | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); if (l.lifecycle_state !== 'ADOPTED' \|\| l.blocking_policy !== 'BLOCKING_GATE') { console.error('LEFTHOOK_NOT_PROMOTED: ' + l.lifecycle_state + '/' + l.blocking_policy); process.exit(1); } const res = auditManifest(m); if (res.findings.some(f => f.id === 'lefthook' && f.severity === 'error')) process.exit(1); console.log('LEFTHOOK_PROMOTION_AUDIT_GREEN: ADOPTED BLOCKING_GATE');"` | `0` | `LEFTHOOK_PROMOTION_AUDIT_GREEN: ADOPTED BLOCKING_GATE` | `tools/ecosystem-manifest.json`, `command stdout` |
| `AC-AI-36-02` | Root `package.json` devDependency pin actually landed, and matches the ecosystem manifest specification — **NOT MET AT HEAD (D-03).** | `node -e "const m = require('./tools/ecosystem-manifest.json').adopted.find(t => t.id === 'lefthook'); const dev = require('./package.json').devDependencies \|\| {}; if (m.pinned_version_or_commit !== '1.11.3' \|\| m.install_method !== 'npm-dev' \|\| m.health_check !== 'lefthook version') throw new Error('lefthook manifest specification mismatch'); if (dev.lefthook !== '1.11.3') throw new Error('root devDependencies.lefthook must be exactly 1.11.3, got: ' + dev.lefthook); console.log('LEFTHOOK_PIN_VERIFIED: manifest 1.11.3 npm-dev, root devDependency 1.11.3');"` | `0` | `LEFTHOOK_PIN_VERIFIED: manifest 1.11.3 npm-dev, root devDependency 1.11.3` | `package.json`, `tools/ecosystem-manifest.json` |
| `AC-AI-36-03` | Lefthook binary resolves from the workspace pin (`pnpm exec`, never a network-fetched `npx` version), so omitting the root pin fails this AC. Exact expected stdout of `pnpm exec lefthook version` is the single line `1.11.3` and nothing else. `AC-AI-36-03` and `AC-AI-36-06` both guard with `includes('1.11.3')` — never exact equality — so the two rows stay mutually consistent if a future release adds banner text — **NOT MET AT HEAD (D-03).** | `node -e "const cp = require('child_process'); const v = cp.execSync('pnpm exec lefthook version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('LEFTHOOK_CLI_VERSION: ' + v);"` | `0` | `LEFTHOOK_CLI_VERSION: 1.11.3` | `command stdout` |
| `AC-AI-36-04` | The **root** `lefthook.yml` authored by this Work Item declares the exact hook commands and executes green in this repository (no throwaway config) — **NOT MET AT HEAD (D-03).** | `node -e "const fs = require('fs'); const cp = require('child_process'); const conf = fs.readFileSync('lefthook.yml', 'utf8'); if (!conf.includes('node tools/ai-guard/cli.js check')) throw new Error('root lefthook.yml missing writer-claim command'); if (!conf.includes('node tools/ai-guard/cli.js staged-secrets')) throw new Error('root lefthook.yml missing staged-secret-scan command'); const out = cp.execSync('pnpm exec lefthook run pre-commit').toString(); if (!out.includes('writer-claim') \|\| !out.includes('staged-secret-scan')) process.exit(1); console.log('ROOT_LEFTHOOK_CONFIG_EXECUTED');"` | `0` | `ROOT_LEFTHOOK_CONFIG_EXECUTED` | `lefthook.yml`, `command stdout` |
| `AC-AI-36-05` | Hook installation from the root config generates the real `pre-commit` hook in this repository's git common dir (worktree-safe) — **NOT MET AT HEAD (D-03).** | `node -e "const fs = require('fs'); const path = require('path'); const cp = require('child_process'); cp.execSync('pnpm exec lefthook install'); const gitCommonDir = cp.execSync('git rev-parse --path-format=absolute --git-common-dir').toString().trim(); const hookPath = path.join(gitCommonDir, 'hooks', 'pre-commit'); const content = fs.readFileSync(hookPath, 'utf8'); if (!content.includes('call_lefthook') \|\| !content.includes('pre-commit')) process.exit(1); console.log('PRE_COMMIT_HOOK_GENERATED_SUCCESS');"` | `0` | `PRE_COMMIT_HOOK_GENERATED_SUCCESS` | `lefthook.yml`, generated `hooks/pre-commit` |
| `AC-AI-36-06` | Doctor diagnostic health check verifying lefthook binary resolution from the workspace pin and hook readiness. Same exact expected stdout (`1.11.3`, single line) and the same `includes('1.11.3')` comparison as `AC-AI-36-03`, so the two rows can never disagree — **NOT MET AT HEAD (D-03).** | `node -e "const cp = require('child_process'); const v = cp.execSync('pnpm exec lefthook version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('DOCTOR_LEFTHOOK_PROBE_PASS: ' + v);"` | `0` | `DOCTOR_LEFTHOOK_PROBE_PASS: 1.11.3` | `scripts/ai/doctor.ps1`, `command stdout` |
| `AC-AI-36-07` | Pre-commit hook commit interception on writer collision. The claim store is isolated exactly the way `AC-AI-36-09`/`-10` isolate git state: `HOME` and `USERPROFILE` are redirected to a per-run temp directory for every child process, so `tools/ai-guard/writer-claim.js` resolves its `~/.ao/data/writer-claims` store inside that directory and the real repository claim store is never written. The claim is additionally taken on a per-run synthetic branch name (`ac-36-collision-<pid>-<epoch-ms>`) that can never match a real branch. Both temp directories are removed in `finally`; a run killed before `finally` leaves only an unreferenced temp directory, never a stale claim that can block a later commit for anyone — **NOT MET AT HEAD (D-03).** | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const root = process.cwd(); const cliPath = path.join(root, 'tools/ai-guard/cli.js').replace(/\\\\/g, '/'); const branch = 'ac-36-collision-' + process.pid + '-' + Date.now(); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-test-')); const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-home-')); const env = Object.assign({}, process.env, { HOME: homeDir, USERPROFILE: homeDir }); try { cp.execSync('node \x22' + cliPath + '\x22 claim --branch ' + branch + ' --owner existing-holder', { env }); cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node \x22' + cliPath + '\x22 check --branch ' + branch + ' --owner external-actor\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'file.txt'), 'data'); cp.execSync('git add file.txt', { cwd: tempDir }); cp.execSync('pnpm --dir \x22' + root + '\x22 exec lefthook run pre-commit', { cwd: tempDir, env }); process.exit(0); } catch (err) { const combined = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (combined.includes('CHẶN GHI') && combined.includes(branch) && combined.includes('existing-holder')) { console.error('WRITER_COLLISION_BLOCKED_BY_HOOK: ' + branch); process.exit(1); } process.exit(2); } finally { fs.rmSync(homeDir, { recursive: true, force: true }); fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `WRITER_COLLISION_BLOCKED_BY_HOOK: ac-36-collision-` | `command stderr` |
| `AC-AI-36-08` | `node tools/ai-guard/cli.js staged-secrets` — the deliverable itself — passes a benign staged change. The AC invokes the scanner and asserts the scanner's own stdout, so it cannot pass while the command is unimplemented | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-clean-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'clean.txt'), 'export const port = 3000;\n'); cp.execSync('git add clean.txt', { cwd: tempDir }); const out = cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }).toString(); if (!out.includes('STAGED_SCAN_CLEAN: 0 secrets detected')) process.exit(1); console.log(out.trim()); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `0` | `STAGED_SCAN_CLEAN: 0 secrets detected` | `tools/ai-guard/cli.js`, `command stdout` |
| `AC-AI-36-09` | `node tools/ai-guard/cli.js staged-secrets` blocks a safely GENERATED temporary fixture, exiting `1` and naming the offending file. Detection is performed by the scanner, not by the AC | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-secret-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_'); fs.writeFileSync(path.join(tempDir, 'generated-fixture.txt'), 'token=' + syntheticSecret + '\n'); cp.execSync('git add generated-fixture.txt', { cwd: tempDir }); try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }); process.exit(2); } catch (err) { const c = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (err.status === 1 && c.includes('STAGED_SECRET_DETECTED') && c.includes('generated-fixture.txt')) { console.error('STAGED_SECRET_DETECTED: generated-fixture.txt'); process.exit(1); } process.exit(2); } } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `STAGED_SECRET_DETECTED: generated-fixture.txt` | `tools/ai-guard/cli.js`, `command stderr` |
| `AC-AI-36-10` | `node tools/ai-guard/cli.js staged-secrets` reads the git index, not the working tree: the fixture is staged and then deleted from disk, and the scanner must still block (exit `1`) | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-index-iso-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '9876543210zyxwvutsrqponmlkjihgfedcba'].join('_'); const filePath = path.join(tempDir, 'staged-only-fixture.txt'); fs.writeFileSync(filePath, 'key=' + syntheticSecret + '\n'); cp.execSync('git add staged-only-fixture.txt', { cwd: tempDir }); fs.unlinkSync(filePath); if (fs.existsSync(filePath)) process.exit(2); try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }); process.exit(2); } catch (err) { const c = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (err.status === 1 && c.includes('STAGED_SECRET_DETECTED') && c.includes('staged-only-fixture.txt')) { console.error('INDEX_ISOLATION_DETECTED_STAGED_SECRET'); process.exit(1); } process.exit(2); } } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `INDEX_ISOLATION_DETECTED_STAGED_SECRET` | `tools/ai-guard/cli.js`, `command stderr` |
| `AC-AI-36-11` | The `5000ms` / `512MB` budgets are enforced **by the scanner**, not by the test harness: `staged-secrets` reads `AI_GUARD_STAGED_TIMEOUT_MS` (default `5000`) and `AI_GUARD_STAGED_MAX_BYTES` (default `536870912`), and exits `2` with `STAGED_SCAN_BUDGET_EXCEEDED` when either is exceeded | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-budget-')); const run = (env) => { try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir, env: Object.assign({}, process.env, env) }); return null; } catch (err) { return { status: err.status, out: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '') }; } }; try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'big.txt'), 'x'.repeat(5 * 1024 * 1024) + '\n'); cp.execSync('git add big.txt', { cwd: tempDir }); const t = run({ AI_GUARD_STAGED_TIMEOUT_MS: '1' }); const b = run({ AI_GUARD_STAGED_MAX_BYTES: '1024' }); if (!t \|\| t.status !== 2 \|\| !t.out.includes('STAGED_SCAN_BUDGET_EXCEEDED')) process.exit(1); if (!b \|\| b.status !== 2 \|\| !b.out.includes('STAGED_SCAN_BUDGET_EXCEEDED')) process.exit(1); console.log('STAGED_SCAN_BUDGETS_ENFORCED: default 5000ms timeout, 536870912 bytes'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `0` | `STAGED_SCAN_BUDGETS_ENFORCED: default 5000ms timeout, 536870912 bytes` | `tools/ai-guard/cli.js`, `command stdout` |
| `AC-AI-36-12` | Verify complete absence of all 4 forbidden lifecycle scripts in root and web manifests | `node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] \|\| w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `package.json, apps/web/package.json` |
| `AC-AI-36-13` | Toolchain unit and integration suites ran and were not vacuous. The row no longer carries glob patterns in an inline command (its backslash-escaped quotes never expanded) and no longer rides on `fail 0` alone, which `node --test` also prints over zero tests | `node tools/ai-brain/acceptance/ac-36-13-suite-not-vacuous.js` | `0` | `SUITE_NOT_VACUOUS:` | `tools/ai-brain/acceptance/ac-36-13-suite-not-vacuous.js` stdout |
| `AC-AI-36-14` | Manifest audit green: 0 errors (warning and note counts are not pinned, so unrelated manifest growth does not falsify this AC) | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-36-15` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-36-17` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py stdout` |
| `AC-AI-36-18` | Incremental code and document formatting check. The formatter prints Vietnamese; the expected string previously quoted an English line it never emits | `pnpm format:check` | `0` | `tuân thủ 100% chuẩn định dạng Prettier` | `scripts/verify-formatting.ts stdout` |
| `AC-AI-36-19` | Fail-closed counterpart to `AC-AI-36-01`: with the gating artifact absent (empty dependency set injected), promoting `lefthook` to `ADOPTED` / `BLOCKING_GATE` is reported as `QUALITY_GATE_MISSING`. This stays true after implementation because the dependency set is injected, not read from disk | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); l.lifecycle_state = 'ADOPTED'; l.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m, { dependencies: new Set() }); const f = res.findings.find(x => x.id === 'lefthook'); console.error(f.code + ': ' + f.id); process.exit(1);"` | `1` | `QUALITY_GATE_MISSING: lefthook` | `command stderr` |

### Evidence notes for the invariant rows

`AC-AI-36-13`, `-14`, `-15` and `-17` assert invariants (`0 failures` / `0 errors`), never exact totals, because this Work Item itself adds a markdown file and `tools/ai-guard/test/` suites, so any pinned count is stale on arrival. The counts below are recorded as evidence of the observed baseline only. They are informational: a change in any of them does not falsify the corresponding acceptance row, and no row may be rewritten to assert them.

| Row | Asserted invariant | Observed baseline count (evidence only, not asserted) |
|---|---|---|
| `AC-AI-36-13` | `SUITE_NOT_VACUOUS:` with `fail 0` over a non-empty run (tests > 0, suites > 0) | `ℹ pass 458` at the pre-implementation baseline; `pass 626` across `137` suites when the audit ran, and it keeps drifting |
| `AC-AI-36-14` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js manifest` | Exactly one expected warning (`PINNED_VERSION_DRIFT` for `codex-cli`); warning and note totals are deliberately unpinned |
| `AC-AI-36-15` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled at the time of writing |
| `AC-AI-36-17` | `Documentation validation passed:` from `validate_docs.py` | `82` markdown files, `130` feature IDs, `178` delivery rows, `533` unique identifiers at the time of writing (`526` before this Work Item's rows landed) |

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); if (l.lifecycle_state !== 'ADOPTED' || l.blocking_policy !== 'BLOCKING_GATE') { console.error('LEFTHOOK_NOT_PROMOTED: ' + l.lifecycle_state + '/' + l.blocking_policy); process.exit(1); } const res = auditManifest(m); if (res.findings.some(f => f.id === 'lefthook' && f.severity === 'error')) process.exit(1); console.log('LEFTHOOK_PROMOTION_AUDIT_GREEN: ADOPTED BLOCKING_GATE');"
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); l.lifecycle_state = 'ADOPTED'; l.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m, { dependencies: new Set() }); const f = res.findings.find(x => x.id === 'lefthook'); console.error(f.code + ': ' + f.id); process.exit(1);"
node -e "const m = require('./tools/ecosystem-manifest.json').adopted.find(t => t.id === 'lefthook'); const dev = require('./package.json').devDependencies || {}; if (m.pinned_version_or_commit !== '1.11.3' || m.install_method !== 'npm-dev' || m.health_check !== 'lefthook version') throw new Error('lefthook manifest specification mismatch'); if (dev.lefthook !== '1.11.3') throw new Error('root devDependencies.lefthook must be exactly 1.11.3, got: ' + dev.lefthook); console.log('LEFTHOOK_PIN_VERIFIED: manifest 1.11.3 npm-dev, root devDependency 1.11.3');"
node -e "const cp = require('child_process'); const v = cp.execSync('pnpm exec lefthook version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('LEFTHOOK_CLI_VERSION: ' + v);"
node -e "const fs = require('fs'); const cp = require('child_process'); const conf = fs.readFileSync('lefthook.yml', 'utf8'); if (!conf.includes('node tools/ai-guard/cli.js check')) throw new Error('root lefthook.yml missing writer-claim command'); if (!conf.includes('node tools/ai-guard/cli.js staged-secrets')) throw new Error('root lefthook.yml missing staged-secret-scan command'); const out = cp.execSync('pnpm exec lefthook run pre-commit').toString(); if (!out.includes('writer-claim') || !out.includes('staged-secret-scan')) process.exit(1); console.log('ROOT_LEFTHOOK_CONFIG_EXECUTED');"
node -e "const fs = require('fs'); const path = require('path'); const cp = require('child_process'); cp.execSync('pnpm exec lefthook install'); const gitCommonDir = cp.execSync('git rev-parse --path-format=absolute --git-common-dir').toString().trim(); const hookPath = path.join(gitCommonDir, 'hooks', 'pre-commit'); const content = fs.readFileSync(hookPath, 'utf8'); if (!content.includes('call_lefthook') || !content.includes('pre-commit')) process.exit(1); console.log('PRE_COMMIT_HOOK_GENERATED_SUCCESS');"
node -e "const cp = require('child_process'); const v = cp.execSync('pnpm exec lefthook version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('DOCTOR_LEFTHOOK_PROBE_PASS: ' + v);"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const root = process.cwd(); const cliPath = path.join(root, 'tools/ai-guard/cli.js').replace(/\\/g, '/'); const branch = 'ac-36-collision-' + process.pid + '-' + Date.now(); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-test-')); const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-home-')); const env = Object.assign({}, process.env, { HOME: homeDir, USERPROFILE: homeDir }); try { cp.execSync('node \x22' + cliPath + '\x22 claim --branch ' + branch + ' --owner existing-holder', { env }); cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node \x22' + cliPath + '\x22 check --branch ' + branch + ' --owner external-actor\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'file.txt'), 'data'); cp.execSync('git add file.txt', { cwd: tempDir }); cp.execSync('pnpm --dir \x22' + root + '\x22 exec lefthook run pre-commit', { cwd: tempDir, env }); process.exit(0); } catch (err) { const combined = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (combined.includes('CHẶN GHI') && combined.includes(branch) && combined.includes('existing-holder')) { console.error('WRITER_COLLISION_BLOCKED_BY_HOOK: ' + branch); process.exit(1); } process.exit(2); } finally { fs.rmSync(homeDir, { recursive: true, force: true }); fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-clean-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'clean.txt'), 'export const port = 3000;\n'); cp.execSync('git add clean.txt', { cwd: tempDir }); const out = cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }).toString(); if (!out.includes('STAGED_SCAN_CLEAN: 0 secrets detected')) process.exit(1); console.log(out.trim()); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-secret-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_'); fs.writeFileSync(path.join(tempDir, 'generated-fixture.txt'), 'token=' + syntheticSecret + '\n'); cp.execSync('git add generated-fixture.txt', { cwd: tempDir }); try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }); process.exit(2); } catch (err) { const c = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (err.status === 1 && c.includes('STAGED_SECRET_DETECTED') && c.includes('generated-fixture.txt')) { console.error('STAGED_SECRET_DETECTED: generated-fixture.txt'); process.exit(1); } process.exit(2); } } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-index-iso-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '9876543210zyxwvutsrqponmlkjihgfedcba'].join('_'); const filePath = path.join(tempDir, 'staged-only-fixture.txt'); fs.writeFileSync(filePath, 'key=' + syntheticSecret + '\n'); cp.execSync('git add staged-only-fixture.txt', { cwd: tempDir }); fs.unlinkSync(filePath); if (fs.existsSync(filePath)) process.exit(2); try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir }); process.exit(2); } catch (err) { const c = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (err.status === 1 && c.includes('STAGED_SECRET_DETECTED') && c.includes('staged-only-fixture.txt')) { console.error('INDEX_ISOLATION_DETECTED_STAGED_SECRET'); process.exit(1); } process.exit(2); } } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const cli = path.join(process.cwd(), 'tools/ai-guard/cli.js'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-budget-')); const run = (env) => { try { cp.execSync('node \x22' + cli + '\x22 staged-secrets', { cwd: tempDir, env: Object.assign({}, process.env, env) }); return null; } catch (err) { return { status: err.status, out: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '') }; } }; try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'big.txt'), 'x'.repeat(5 * 1024 * 1024) + '\n'); cp.execSync('git add big.txt', { cwd: tempDir }); const t = run({ AI_GUARD_STAGED_TIMEOUT_MS: '1' }); const b = run({ AI_GUARD_STAGED_MAX_BYTES: '1024' }); if (!t || t.status !== 2 || !t.out.includes('STAGED_SCAN_BUDGET_EXCEEDED')) process.exit(1); if (!b || b.status !== 2 || !b.out.includes('STAGED_SCAN_BUDGET_EXCEEDED')) process.exit(1); console.log('STAGED_SCAN_BUDGETS_ENFORCED: default 5000ms timeout, 536870912 bytes'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] || w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm format:check
```

## Acceptance matrix audit

Every row of the § Acceptance matrix above was extracted programmatically from the
markdown table — with a splitter that treats `\|` inside a cell as a literal pipe —
and each command was run exactly as stored, from the repository root, as a file
handed to the shell so that no shell layer re-quoted it. The measured tree is
`origin/main` at commit `0f7a900`.

Two rows could not prove what they claimed, and seven rows assert a repository
state that does not exist at HEAD. This Work Item has no duplicated-rule defect of
the kind found in `TASK-AI-37`: it carries no acceptance script that holds a
private copy of a rule another row runs. The rows that hold were each re-run from
an empty temporary directory with no repository present; every one of them failed
there with a non-zero exit, so none is a tautology. `AC-AI-36-13` was the sole
exception — it exited `0` and printed `fail 0` over zero tests — and is repaired
in `D-01`. In the repaired matrix all eighteen rows exit non-zero outside the
repository.

### Step-2 measurement (rows as originally stored)

| Row | Expected exit | Actual exit | Expected string found | First 120 characters of actual output |
|---|---|---|---|---|
| `AC-AI-36-01` | 0 | **1** | no | `LEFTHOOK_NOT_PROMOTED: PENDING/NON_BLOCKING` |
| `AC-AI-36-02` | 0 | **1** | no | `Error: root devDependencies.lefthook must be exactly 1.11.3, got: undefined` |
| `AC-AI-36-03` | 0 | **1** | no | `'lefthook' is not recognized as an internal or external command` / `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "lefthook" not found` |
| `AC-AI-36-04` | 0 | **1** | no | `Error: ENOENT: no such file or directory, open '…\lefthook.yml'` |
| `AC-AI-36-05` | 0 | **1** | no | `'lefthook' is not recognized as an internal or external command` |
| `AC-AI-36-06` | 0 | **1** | no | `'lefthook' is not recognized as an internal or external command` |
| `AC-AI-36-07` | 1 | **2** | no | `'lefthook' is not recognized as an internal or external command` |
| `AC-AI-36-08` | 0 | 0 | yes | `STAGED_SCAN_CLEAN: 0 secrets detected` |
| `AC-AI-36-09` | 1 | 1 | yes | `STAGED_SECRET_DETECTED: generated-fixture.txt` |
| `AC-AI-36-10` | 1 | 1 | yes | `INDEX_ISOLATION_DETECTED_STAGED_SECRET` |
| `AC-AI-36-11` | 0 | 0 | yes | `STAGED_SCAN_BUDGETS_ENFORCED: default 5000ms timeout, 536870912 bytes` |
| `AC-AI-36-12` | 0 | 0 | yes | `Zero forbidden lifecycle scripts present in root and web manifests` |
| `AC-AI-36-13` | 0 | 0 | yes (vacuous) | `ℹ tests 0 ℹ suites 0 ℹ pass 0 ℹ fail 0` — the escaped-quote globs never expanded |
| `AC-AI-36-14` | 0 | 0 | yes | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` |
| `AC-AI-36-15` | 0 | 0 | yes | `Tổng: 0 lỗi, 0 cảnh báo, 149 ghi chú` |
| `AC-AI-36-17` | 0 | 0 | yes | `Documentation validation passed: 94 markdown files, 130 feature IDs, 178 delivery rows, 733 unique identifiers.` |
| `AC-AI-36-18` | 0 | 0 | **no** | `Tất cả 0 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier` |
| `AC-AI-36-19` | 1 | 1 | yes | `QUALITY_GATE_MISSING: lefthook` |

### `D-01` — `AC-AI-36-13`: an unrunnable command that asserted a vacuous invariant

**Defect class:** unrunnable *and* vacuous assertion.

**Measurement (unrunnable):** the stored command carried backslash-escaped quotes
(`\"tools/ai-brain/test/*.test.js\" …`). Those are not shell quoting: the shell
hands node the literal quote characters, the glob never expands, and `node --test`
matches nothing. Measured exit `0`, output `ℹ tests 0 ℹ suites 0 ℹ pass 0 ℹ fail 0`.

**Measurement (vacuous):** run from an empty temporary directory with no
repository present, the row exited `0` and printed `fail 0` — the only row of the
eighteen with that property. Its asserted string `ℹ fail 0` therefore held equally
with no suite at all, which is precisely the failure mode that matters here: this
Work Item adds `tools/ai-guard/test/` suites, and a vacuous check cannot see them.

**Measurement (stale evidence note):** the evidence table below the matrix records
`ℹ pass 458` at the baseline; the suite really reports `pass 626` across `137`
suites.

**Replacement:** `tools/ai-brain/acceptance/ac-36-13-suite-not-vacuous.js`. It
expands the three real globs, requires the three test directories to exist (exit
`2` outside the repository), requires them to hold `*.test.js` files, and requires
the summary to report `tests > 0`, `suites > 0` and `fail === 0`. It carries a
control that runs the same command from an empty directory, confirms that run is
vacuous (`fail 0` over `0` tests), and refuses to accept that shape as success.
Measured: exit `0`, `SUITE_NOT_VACUOUS: fail 0, pass 626 of 626 tests across 137
suites`; exit `1` from an empty directory outside the repository. No pass count is
pinned, and the evidence-notes row for `AC-AI-36-13` was corrected to state the
invariant actually asserted.

### `D-02` — `AC-AI-36-18`: a false expected-output string

**Defect class:** false claim in the expected-output column. The row required
`All matched files use Prettier code style!`. `scripts/verify-formatting.ts` prints
Vietnamese and never emits that English line.

**Measurement:** exit `0`; the output ends
`✅ Hoàn tất: Tất cả 0 tệp tin thay đổi tuân thủ 100% chuẩn định dạng Prettier
(tôn trọng .prettierignore).` The expected string appears nowhere, so the row
would have failed on its own output assertion the moment it was checked.

**Replacement:** the expected string is now the invariant suffix
`tuân thủ 100% chuẩn định dạng Prettier`. The command is unchanged, and the
leading file count — which is the size of the branch diff, not a property of the
repository — is not pinned.

### `D-03` — `AC-AI-36-01` through `-07`: false claims about this repository

**Defect class:** false claim. Seven rows assert that a Lefthook integration is
present in this repository. It is not, at HEAD or on any merged branch.

**Measurement** (each command run from the repository root at `0f7a900`):

| Fact claimed by the row | Measurement |
|---|---|
| root `devDependencies` pins `lefthook: 1.11.3` (`-02`) | `require('./package.json').devDependencies.lefthook` → `undefined` |
| `lefthook.yml` exists and declares the hook commands (`-04`) | `git ls-files lefthook.yml` → no output; `ls lefthook.yml` → `No such file or directory` |
| `lefthook` is `ADOPTED` / `BLOCKING_GATE` in the manifest (`-01`) | `lifecycle_state` → `PENDING`, `blocking_policy` → `NON_BLOCKING` |
| `pnpm exec lefthook version` resolves `1.11.3` (`-03`, `-06`) | exit `1`, `[ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL] Command "lefthook" not found` |
| hook installation generates a real `pre-commit` (`-05`) | not reached: the binary is absent |
| the pre-commit hook intercepts a writer collision (`-07`) | exit `2`, `'lefthook' is not recognized` |

The document already states this scope in § Post-implementation notes ("The
`lefthook` devDependency pin, `lefthook.yml`, the manifest promotion and the
`scripts/ai/*.ps1` updates that the rest of this Work Item describes are not part
of it, so `AC-AI-36-01` through `-07` remain unmet") and the Control table status
is `BLOCKED_DEPENDENCY`, aligned to register row 169. What was still false was the
matrix itself: seven rows presented a passing end state with no marker that they
are unmet.

**Replacement:** the claim is corrected, not satisfied. Each of `AC-AI-36-01`
through `-07` now carries an explicit `NOT MET AT HEAD (D-03)` marker in its
scenario cell, so the matrix reports the same state as § Post-implementation notes
and the register instead of contradicting them. Their commands are left exactly as
stored: they are correct checks that currently fail, and each one fails for the
reason this section records. Implementing the pin, `lefthook.yml`, the manifest
promotion and the `scripts/ai/*.ps1` updates is required to make them pass, and is
inside this Work Item's `Allowed paths` but outside the scope of a matrix audit.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `8db2d77` | `CHANGES_REQUIRED` | Resolved 6 findings: Lifecycle state vs register documented with TASK-AI-17 merged in base; install lifecycle script forbidden across root and web manifests; provisioned staged scanner wrapper authorized for git index scanning; authoritative root verification gates restored; Windows and POSIX execution evidence required in acceptance matrix. |
| 2 | `d4d91c0` | `CHANGES_REQUIRED` | Resolved 6 findings + 3 patterns: (1) Pattern 1 / Finding 1: AC-AI-36-01 through 12 restated to name exact executable commands, expected exit codes, exact output strings, and files/artifacts, eliminating all vague intentions ("File inspection", "captured stderr", "doctor stdout"). (2) Finding 2: Replaced ambiguous "wrapper or provisioned binary" with single concrete approach `node tools/ai-guard/cli.js staged-secrets` and deterministic clean/secret fixtures. (3) Finding 3: Defined local cross-platform reproducibility via Git's POSIX hook shell (`sh.exe`) alongside PowerShell, explaining why `.github/` CI runner is out of scope. (4) Finding 4: Defined exact PATH sanitization for Gitleaks absence test in PowerShell, staged fixture, command, and exit 0. (5) Finding 5: Control table status aligned to authoritative register row 169 (`BLOCKED_DEPENDENCY`). (6) Line 74 finding: Pinned bootstrap fallback to `npx lefthook@1.11.3 install`, strictly forbidding bare `npx`. (7) Pattern 2: Explicit numeric thresholds added (1.11.3, 8.24.0, 5000ms timeout budget, 512MB memory budget). (8) Pattern 3: Negative fixtures genuinely fail (protected branch, writer collision, and regex-matching synthetic secret). |
| 3 | `HEAD` | `READY_FOR_CODEX` | Resolved 6 review findings and 3 architectural patterns: (1) Finding 1: AC-AI-36-01 updated to validate manifest promotion to ADOPTED and BLOCKING_GATE with fail-closed quality gate proof (`QUALITY_GATE_MISSING: lefthook`, exit 1) when absent, eliminating contradictory requirement to remain PENDING/NON_BLOCKING. (2) Finding 2: Completely removed unnumbered section 'Downstream implementation acceptance contract' and integrated all primary delivery criteria into authoritative ID-bearing acceptance matrix (`AC-AI-36-01` to `AC-AI-36-18`) verifying root package pin, lefthook version, lefthook.yml commands, hook install, pre-commit hook generation, commit interception, doctor success, clean and secret staged-scanner paths. (3) Finding 3: Replaced direct cli.js check calls with AC-AI-36-07 exercising Lefthook pre-commit hook interception and providing deterministic claim setup (`claim --branch ... --owner ...`) with guaranteed cleanup in finally. (4) Finding 4: Eliminated proposal of committed secret fixture; AC-AI-36-09 uses a safely GENERATED temporary fixture in an isolated temporary repository destroyed in finally, never committing detectable tokens to git or weakening CI Gitleaks gate. (5) Finding 5: AC-AI-36-10 implements staged index vs working tree isolation in an isolated temporary repository created in os.tmpdir(), deleting the file only inside the temporary repository and cleaning up in finally, leaving reviewer's worktree and index untouched. (6) Finding 6: AC-AI-36-11 adds explicit executable tests demonstrating 5000ms timeout budget enforcement (ETIMEDOUT on slow process) and 512 MB memory limit enforcement (ENOBUFS on buffer cap). (7) Patterns 1, 2, 3: Every row names exact command, explicit numeric threshold (0, 1, 1.11.3, 8.24.0, 5000ms, 512MB), exact required output string, and file/artifact; all negative tests genuinely fail closed. |
| 4 | `fdfb23d` | `CHANGES_REQUIRED` | Resolved 6 blocking findings and 2 non-blocking findings: (1) `AC-AI-36-01` now states the reachable passing end state (promotion committed as `ADOPTED`/`BLOCKING_GATE` audits green, exit 0), with the fail-closed case moved to the new `AC-AI-36-19` using an injected empty dependency set so it stays true after implementation; `AI-36-R08` names the gating artifact explicitly (root `devDependencies` pin `"lefthook": "1.11.3"`, the audit's `dependency "lefthook"` probe). (2) `AC-AI-36-08`, `-09`, `-10` now invoke `node tools/ai-guard/cli.js staged-secrets` and assert the scanner's own exit codes and output, so they cannot pass while the deliverable is unimplemented. (3) `AC-AI-36-11` asserts budgets enforced inside the scanner via `AI_GUARD_STAGED_TIMEOUT_MS` (default `5000`) and `AI_GUARD_STAGED_MAX_BYTES` (default `536870912`), exit `2` with `STAGED_SCAN_BUDGET_EXCEEDED`, instead of self-testing `execSync`. (4) `AC-AI-36-03`/`-06` resolve the binary through the workspace pin (`pnpm exec lefthook version`, both using `includes`), and `AC-AI-36-02` now fails when the root `package.json` pin is missing. (5) `AC-AI-36-04`/`-05` exercise the **root** `lefthook.yml` and this repository's git common dir instead of throwaway temp configs. (6) `AC-AI-36-07` claims a per-run synthetic branch (`ac-36-collision-<pid>-<epoch-ms>`) released in `finally`, so an interrupted run cannot leave a stale claim on a real branch. (7) Non-blocking: stale exact counts in `AC-AI-36-13`/`-14`/`-15`/`-17` replaced with stable thresholds. (8) Non-blocking: `AC-AI-36-16` removed; the register's displayed `BLOCKED_DEPENDENCY` is documented in Preconditions as reconciler-owned state, not an acceptance criterion. Control status stays `BLOCKED_DEPENDENCY`, aligned to the authoritative register. |
| 5 | `HEAD` | `READY_FOR_CODEX` | Resolved the remaining PR #20 acceptance-matrix findings so every row exercises a real deliverable: (1) `AC-AI-36-08`/`-09`/`-10` invoke `node tools/ai-guard/cli.js staged-secrets` and assert the scanner's own exit code and output, so `.gitleaks.toml` rule evaluation and index-versus-worktree isolation are genuinely exercised rather than re-implemented as an inline `ghp_` regex over `git diff --cached`. (2) `AC-AI-36-04` parses and runs the **root** `lefthook.yml` this Work Item authors (`pnpm exec lefthook run pre-commit`) instead of a throwaway config in a temp repo, so the `writer-claim` / `staged-secret-scan` wiring is verified. (3) `AC-AI-36-02` reads root `package.json` devDependencies and fails when the `"lefthook": "1.11.3"` pin is missing, and `AC-AI-36-03`/`-06` resolve the binary from the workspace install (`pnpm exec`), so no row can pass via a network-fetched `npx lefthook@1.11.3`. (4) `AC-AI-36-01` states the passing end state (promotion committed, audit green, exit 0); the `QUALITY_GATE_MISSING` assertion moved to `AC-AI-36-19` with an injected empty dependency set, so it remains true after implementation instead of requiring the author to make a change the matrix calls invalid. (5) `AC-AI-36-07` isolates the writer-claim store by redirecting `HOME`/`USERPROFILE` to a per-run temp directory, so it never touches the real claim store and a killed run cannot leave a stale claim. (6) `AC-AI-36-03` and `AC-AI-36-06` reconciled onto a single `includes('1.11.3')` comparison with the exact expected stdout (`1.11.3`, single line) stated. (7) `AC-AI-36-11` asserts the `5000ms` / `512MB` budgets inside the scanner via `AI_GUARD_STAGED_TIMEOUT_MS` / `AI_GUARD_STAGED_MAX_BYTES` and `STAGED_SCAN_BUDGET_EXCEEDED` exit `2`, instead of self-testing `execSync`. (8) Non-blocking: hard-coded counts (`458` pass, `82` files, `178` rows, `526` identifiers) replaced by invariants (`0 failures` / `0 errors`) and retained as an explicit evidence-notes table. No gate, status or acceptance row was weakened. |

## Residual limitations

- Automatic-on-install hook registration via lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) remains strictly forbidden across root and workspace manifests by repository supply-chain policy; hook installation must be run explicitly via `bootstrap-worktrees.ps1` or `pnpm lefthook install` (or pinned `npx lefthook@1.11.3 install`), and `scripts/ai/doctor.ps1` verifies hook presence.
- Delivery register row 169 still displays `BLOCKED_DEPENDENCY` awaiting automated write-back by the `TASK-AI-19` reconciler. The prerequisite `TASK-AI-17` is merged in the base branch (`1f587dd`), so this status is stale in substance, but the Control table stays aligned to the authoritative register rather than advancing ahead of it; the register row is advanced only by the sanctioned reconciler, never by manual edits from this Work Item, and its displayed value is documented rather than asserted as an acceptance criterion.
- Cross-platform CI execution on Linux/POSIX runners is enforced by existing GitHub Actions workflows; local cross-platform verification on Windows worktrees exercises Git's native POSIX hook shell (`sh.exe`) and PowerShell.

## Post-implementation notes

Recorded while implementing `tools/ai-guard/staged-secrets.js` and its suite. Each item is something this specification asserted or implied that measured false, or a behaviour it left undefined that the implementation had to decide.

- **`.gitleaks.toml` rules cannot be evaluated as written.** `AI-36-R05` says the scanner "validates staged changes against `.gitleaks.toml` patterns". Every `[[rules]]` regex in this repository's `.gitleaks.toml` begins with the Go RE2 inline flag group `(?i)`, which JavaScript's `RegExp` rejects outright. A first implementation that compiled the patterns directly dropped all of them silently and scanned with built-in rules only, while still reporting success — the exact "installed does not imply integrated" failure `AI-TOOL-01` names. The scanner now translates a leading `(?i)`/`(?s)`/`(?m)` group into JavaScript flags, and a regression test parses the real `.gitleaks.toml` and asserts the repository rule survives.
- **The acceptance rows require built-in rules, which this specification never mentions.** `AC-AI-36-08` through `-11` each run the scanner inside a freshly initialised temporary repository. Such a directory has no `.gitleaks.toml`, so a scanner that only reads that file would have no rules at all and `AC-AI-36-09`/`-10` could never detect their fixtures. The scanner therefore carries a built-in rule set, used alone when no config is present and merged beneath the repository's rules when one is (`[extend] useDefault = true`).
- **Diffing against `HEAD` is an error, not an empty result, in a repository with no commits.** That is the state of every fixture repository the acceptance rows create, so the `git diff --cached` command named in `In scope` and `AI-36-R05` cannot be the only source of the staged set. The scanner probes for `HEAD` and falls back to listing the cached index, which is the same question in a repository that has no commit to diff against.
- **The memory budget is a byte budget, not a resident-set measurement.** `AI-36-R05` says "memory budget of `512MB`" while `AC-AI-36-11` exercises it by setting `AI_GUARD_STAGED_MAX_BYTES=1024` over a 5 MB staged file. The two only agree if the budget bounds total staged content read, which is what is implemented: the cap is applied both as the subprocess output buffer limit and as a running total across staged blobs.
- **Exit code 2 covers one case the matrix does not name.** The matrix defines `STAGED_SCAN_BUDGET_EXCEEDED` as the only exit-2 shape. Running the command outside a git repository, or with `git` absent from PATH, is neither clean nor a detection nor a budget overrun; reporting it as clean would be a scanner that passes every commit on a broken install. It exits `2` with `STAGED_SCAN_ERROR: <detail>`, a distinct first-line shape, leaving the matrix's asserted strings untouched.
- **Detection detail is on a second line, deliberately.** `AC-AI-36-09` names the expected string `STAGED_SECRET_DETECTED: generated-fixture.txt`. Putting the rule id and line number on that same line would make the exact string unassertable, so the first line carries the file and nothing else and the detail follows indented beneath it. No finding ever carries the matched value (`AI-18-R05`), and a test asserts that.
- **Scope actually delivered on this branch.** Only the missing `tools/ai-guard/staged-secrets.js` deliverable and its `cli.js` wiring. The `lefthook` devDependency pin, `lefthook.yml`, the manifest promotion and the `scripts/ai/*.ps1` updates that the rest of this Work Item describes are not part of it, so `AC-AI-36-01` through `-07` remain unmet.
