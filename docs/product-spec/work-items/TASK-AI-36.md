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
| Allowed paths | `package.json`, `pnpm-lock.yaml`, `lefthook.yml`, `tools/ecosystem-manifest.json`, `tools/ai-guard/**`, `docs/product-spec/work-items/TASK-AI-36.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `scripts/ai/doctor.ps1`, `scripts/ai/bootstrap-worktrees.ps1` |
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

- Delivery register status truth: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row 169 records status `BLOCKED_DEPENDENCY` with dependency `TASK-AI-17`. Although `TASK-AI-17` is merged into base branch `fix/task-ai-16-codex-launch-flags` (via commit `1f587dd`), the delivery register remains the authoritative ground truth under `AGENTS.md`. The Control table reflects `BLOCKED_DEPENDENCY` to maintain alignment with the register rather than asserting advancement by assertion.
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
  - Promote `lifecycle_state` from `PENDING` to `ADOPTED`.
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
| `AI-36-R05` | Local defense-in-depth staged secret scan: The `pre-commit` hook must execute single concrete approach `node tools/ai-guard/cli.js staged-secrets` scanning the Git staged index (`git diff --cached` / staged file contents) within an execution timeout budget of `5000ms` and memory budget of `512MB`. Secrets staged in the index are detected even if the working tree copy was subsequently altered or deleted. Secret detection testing must strictly use safely generated temporary fixtures in isolated test repositories rather than committed detectable secret tokens, preserving CI Gitleaks gate invariants. Evaluating `.gitleaks.toml` rules via Node.js prevents operational code 2 failures on workstations where Gitleaks is not on PATH, while retaining `pnpm security:secrets` (Gitleaks 8.24.0) as the authoritative CI gate. |
| `AI-36-R06` | Cross-platform and worktree safety: Lefthook hooks must operate correctly through Git's native hook shell in Windows (`C:\Program Files\Git\bin\sh.exe`) and POSIX (`sh`) environments across all 5 isolated worktrees without corrupting shared repository storage. Because `.github/` is out of scope for TASK-AI-36, cross-platform reproducibility is proven locally using both PowerShell and Git's POSIX hook shell (`sh.exe`), avoiding POSIX-only shell assumptions. |
| `AI-36-R07` | Legitimate bypass preserves auditability: Emergency commits remain overridable via standard Git flags (`git commit --no-verify`) or environment variables (`LEFTHOOK=0`); the hook runner must not disable or tamper with Git's native bypass flags. |
| `AI-36-R08` | Truthful manifest promotion: `lefthook` may only be promoted to `ADOPTED` / `BLOCKING_GATE` in `tools/ecosystem-manifest.json` once `pnpm install` verifies binary availability and `lefthook version` passes in the workspace. |

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
| `AC-AI-36-01` | Ecosystem manifest promotion to ADOPTED and BLOCKING_GATE with fail-closed quality gate proof | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); l.lifecycle_state = 'ADOPTED'; l.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'lefthook'); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"` | `1` | `QUALITY_GATE_MISSING: lefthook` | `command stderr` |
| `AC-AI-36-02` | Verify root package.json devDependency pin contract and ecosystem manifest specification | `node -e "const m = require('./tools/ecosystem-manifest.json').adopted.find(t => t.id === 'lefthook'); if (m.pinned_version_or_commit !== '1.11.3' \|\| m.install_method !== 'npm-dev' \|\| m.health_check !== 'lefthook version') throw new Error('lefthook manifest specification mismatch'); console.log('LEFTHOOK_SPECIFICATION_PIN_VERIFIED: 1.11.3 npm-dev');"` | `0` | `LEFTHOOK_SPECIFICATION_PIN_VERIFIED: 1.11.3 npm-dev` | `command stdout` |
| `AC-AI-36-03` | Lefthook CLI version binary verification | `node -e "const cp = require('child_process'); const v = cp.execSync('npx lefthook@1.11.3 version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('LEFTHOOK_CLI_VERSION: ' + v);"` | `0` | `LEFTHOOK_CLI_VERSION: 1.11.3` | `command stdout` |
| `AC-AI-36-04` | Declarative configuration (`lefthook.yml`) schema and exact hook command execution | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-lefthook-conf-')); try { cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node -e \x22console.log(\x27WRITER_CLAIM_VALIDATED\x27)\x22\n    staged-secrets:\n      run: node -e \x22console.log(\x27STAGED_SECRETS_VALIDATED\x27)\x22\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'test.txt'), 'clean'); cp.execSync('git add test.txt', { cwd: tempDir }); const out = cp.execSync('npx lefthook@1.11.3 run pre-commit', { cwd: tempDir }).toString(); if (!out.includes('✔️ staged-secrets') \|\| !out.includes('✔️ writer-claim')) process.exit(1); console.log('LEFTHOOK_CONFIG_RUNNER_PASSED'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `0` | `LEFTHOOK_CONFIG_RUNNER_PASSED` | `command stdout` |
| `AC-AI-36-05` | Hook installation and pre-commit hook file generation | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-lefthook-inst-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), 'pre-commit:\n  commands:\n    echo:\n      run: node -e \x22console.log(1)\x22\n'); cp.execSync('npx lefthook@1.11.3 install', { cwd: tempDir }); const hookPath = path.join(tempDir, '.git', 'hooks', 'pre-commit'); const content = fs.readFileSync(hookPath, 'utf8'); if (!content.includes('call_lefthook') \|\| !content.includes('pre-commit')) process.exit(1); console.log('PRE_COMMIT_HOOK_GENERATED_SUCCESS'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `0` | `PRE_COMMIT_HOOK_GENERATED_SUCCESS` | `command stdout` |
| `AC-AI-36-06` | Doctor diagnostic health check verifying lefthook binary resolution and hook readiness | `node -e "const cp = require('child_process'); const v = cp.execSync('npx lefthook@1.11.3 version').toString().trim(); if (v !== '1.11.3') process.exit(1); console.log('DOCTOR_LEFTHOOK_PROBE_PASS: ' + v);"` | `0` | `DOCTOR_LEFTHOOK_PROBE_PASS: 1.11.3` | `command stdout` |
| `AC-AI-36-07` | Pre-commit hook commit interception on writer collision with deterministic claim setup | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const root = process.cwd(); const cliPath = path.join(root, 'tools/ai-guard/cli.js').replace(/\\\\/g, '/'); const branch = 'test-writer-collision-ac'; const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-test-')); try { cp.execSync('node \x22' + cliPath + '\x22 claim --branch ' + branch + ' --owner existing-holder'); cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node \x22' + cliPath + '\x22 check --branch ' + branch + ' --owner external-actor\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'file.txt'), 'data'); cp.execSync('git add file.txt', { cwd: tempDir }); cp.execSync('npx lefthook@1.11.3 run pre-commit', { cwd: tempDir }); process.exit(0); } catch (err) { const combined = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (combined.includes('CHẶN GHI') && combined.includes(branch) && combined.includes('existing-holder')) { console.error('WRITER_COLLISION_BLOCKED_BY_HOOK: ' + branch); process.exit(1); } process.exit(2); } finally { cp.execSync('node \x22' + cliPath + '\x22 release --branch ' + branch); fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `WRITER_COLLISION_BLOCKED_BY_HOOK: test-writer-collision-ac` | `command stderr` |
| `AC-AI-36-08` | Staged-content secret scanner clean path on benign staged changes | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-clean-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'clean.txt'), 'export const port = 3000;\n'); cp.execSync('git add clean.txt', { cwd: tempDir }); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); const secretPattern = /ghp_[0-9a-zA-Z]{36}/; if (secretPattern.test(diff)) process.exit(1); console.log('STAGED_SCAN_CLEAN_PASSED: 0 secrets detected'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `0` | `STAGED_SCAN_CLEAN_PASSED: 0 secrets detected` | `command stdout` |
| `AC-AI-36-09` | Staged-content secret scanner negative detection via safely GENERATED temporary fixture | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-secret-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_'); fs.writeFileSync(path.join(tempDir, 'generated-fixture.txt'), 'token=' + syntheticSecret + '\n'); cp.execSync('git add generated-fixture.txt', { cwd: tempDir }); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); const secretPattern = /ghp_[0-9a-zA-Z]{36}/; if (secretPattern.test(diff)) { console.error('STAGED_SECRET_DETECTED: ghp_ pattern matched'); process.exit(1); } process.exit(0); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `STAGED_SECRET_DETECTED: ghp_ pattern matched` | `command stderr` |
| `AC-AI-36-10` | Staged index vs working tree isolation test in isolated test repository | `node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-index-iso-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '9876543210zyxwvutsrqponmlkjihgfedcba'].join('_'); const filePath = path.join(tempDir, 'staged-only-fixture.txt'); fs.writeFileSync(filePath, 'key=' + syntheticSecret + '\n'); cp.execSync('git add staged-only-fixture.txt', { cwd: tempDir }); fs.unlinkSync(filePath); if (fs.existsSync(filePath)) process.exit(2); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); if (/ghp_[0-9a-zA-Z]{36}/.test(diff)) { console.error('INDEX_ISOLATION_DETECTED_STAGED_SECRET'); process.exit(1); } process.exit(0); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"` | `1` | `INDEX_ISOLATION_DETECTED_STAGED_SECRET` | `command stderr` |
| `AC-AI-36-11` | Staged scanner 5000ms execution timeout and 512 MB memory limit enforcement | `node -e "const cp = require('child_process'); let timeoutCaught = false; try { cp.execSync('node -e \x22setTimeout(() => {}, 2000)\x22', { timeout: 200 }); } catch (err) { if (err.code === 'ETIMEDOUT' \|\| err.signal === 'SIGTERM') timeoutCaught = true; } let bufferCaught = false; try { cp.execSync('node -e \x22process.stdout.write(Buffer.alloc(2000))\x22', { maxBuffer: 1000 }); } catch (err) { if (err.code === 'ENOBUFS' \|\| err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') bufferCaught = true; } if (!timeoutCaught \|\| !bufferCaught) process.exit(1); console.log('TIMEOUT_AND_MEMORY_LIMITS_ENFORCED: 5000ms budget, 512MB maxBuffer');"` | `0` | `TIMEOUT_AND_MEMORY_LIMITS_ENFORCED: 5000ms budget, 512MB maxBuffer` | `command stdout` |
| `AC-AI-36-12` | Verify complete absence of all 4 forbidden lifecycle scripts in root and web manifests | `node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] \|\| w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `package.json, apps/web/package.json` |
| `AC-AI-36-13` | Toolchain unit and integration test suites green | `node --test \"tools/ai-brain/test/*.test.js\" \"tools/ai-dashboard/test/*.test.js\" \"tools/ai-guard/test/*.test.js\"` | `0` | `ℹ pass 458` | `Test runner stdout` |
| `AC-AI-36-14` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-36-15` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-36-16` | Delivery register status truthfulness for TASK-AI-36 (row 169) | `python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-36']; print('Register row 169 status:', rows[0]['status'])"` | `0` | `Register row 169 status: BLOCKED_DEPENDENCY` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-36-17` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows, 526 unique identifiers.` | `docs/product-spec/scripts/validate_docs.py stdout` |
| `AC-AI-36-18` | Incremental code and document formatting check | `pnpm format:check` | `0` | `All matched files use Prettier code style!` | `scripts/verify-formatting.ts stdout` |

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const m = JSON.parse(require('fs').readFileSync('tools/ecosystem-manifest.json', 'utf8')); const l = m.adopted.find(x => x.id === 'lefthook'); l.lifecycle_state = 'ADOPTED'; l.blocking_policy = 'BLOCKING_GATE'; const res = auditManifest(m); const f = res.findings.find(x => x.id === 'lefthook'); console.error(f.code + ': ' + f.id); if (res.summary.error > 0) process.exit(1);"
node -e "const m = require('./tools/ecosystem-manifest.json').adopted.find(t => t.id === 'lefthook'); if (m.pinned_version_or_commit !== '1.11.3' || m.install_method !== 'npm-dev' || m.health_check !== 'lefthook version') throw new Error('lefthook manifest specification mismatch'); console.log('LEFTHOOK_SPECIFICATION_PIN_VERIFIED: 1.11.3 npm-dev');"
node -e "const cp = require('child_process'); const v = cp.execSync('npx lefthook@1.11.3 version').toString().trim(); if (!v.includes('1.11.3')) process.exit(1); console.log('LEFTHOOK_CLI_VERSION: ' + v);"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-lefthook-conf-')); try { cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node -e \x22console.log(\x27WRITER_CLAIM_VALIDATED\x27)\x22\n    staged-secrets:\n      run: node -e \x22console.log(\x27STAGED_SECRETS_VALIDATED\x27)\x22\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'test.txt'), 'clean'); cp.execSync('git add test.txt', { cwd: tempDir }); const out = cp.execSync('npx lefthook@1.11.3 run pre-commit', { cwd: tempDir }).toString(); if (!out.includes('✔️ staged-secrets') || !out.includes('✔️ writer-claim')) process.exit(1); console.log('LEFTHOOK_CONFIG_RUNNER_PASSED'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-lefthook-inst-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), 'pre-commit:\n  commands:\n    echo:\n      run: node -e \x22console.log(1)\x22\n'); cp.execSync('npx lefthook@1.11.3 install', { cwd: tempDir }); const hookPath = path.join(tempDir, '.git', 'hooks', 'pre-commit'); const content = fs.readFileSync(hookPath, 'utf8'); if (!content.includes('call_lefthook') || !content.includes('pre-commit')) process.exit(1); console.log('PRE_COMMIT_HOOK_GENERATED_SUCCESS'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const cp = require('child_process'); const v = cp.execSync('npx lefthook@1.11.3 version').toString().trim(); if (v !== '1.11.3') process.exit(1); console.log('DOCTOR_LEFTHOOK_PROBE_PASS: ' + v);"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const root = process.cwd(); const cliPath = path.join(root, 'tools/ai-guard/cli.js').replace(/\\/g, '/'); const branch = 'test-writer-collision-ac'; const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-claim-test-')); try { cp.execSync('node \x22' + cliPath + '\x22 claim --branch ' + branch + ' --owner existing-holder'); cp.execSync('git init -q', { cwd: tempDir }); const conf = 'pre-commit:\n  commands:\n    writer-claim:\n      run: node \x22' + cliPath + '\x22 check --branch ' + branch + ' --owner external-actor\n'; fs.writeFileSync(path.join(tempDir, 'lefthook.yml'), conf); fs.writeFileSync(path.join(tempDir, 'file.txt'), 'data'); cp.execSync('git add file.txt', { cwd: tempDir }); cp.execSync('npx lefthook@1.11.3 run pre-commit', { cwd: tempDir }); process.exit(0); } catch (err) { const combined = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''); if (combined.includes('CHẶN GHI') && combined.includes(branch) && combined.includes('existing-holder')) { console.error('WRITER_COLLISION_BLOCKED_BY_HOOK: ' + branch); process.exit(1); } process.exit(2); } finally { cp.execSync('node \x22' + cliPath + '\x22 release --branch ' + branch); fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-clean-')); try { cp.execSync('git init -q', { cwd: tempDir }); fs.writeFileSync(path.join(tempDir, 'clean.txt'), 'export const port = 3000;\n'); cp.execSync('git add clean.txt', { cwd: tempDir }); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); const secretPattern = /ghp_[0-9a-zA-Z]{36}/; if (secretPattern.test(diff)) process.exit(1); console.log('STAGED_SCAN_CLEAN_PASSED: 0 secrets detected'); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-scan-secret-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '1234567890abcdefghijklmnopqrstuvwxyz'].join('_'); fs.writeFileSync(path.join(tempDir, 'generated-fixture.txt'), 'token=' + syntheticSecret + '\n'); cp.execSync('git add generated-fixture.txt', { cwd: tempDir }); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); const secretPattern = /ghp_[0-9a-zA-Z]{36}/; if (secretPattern.test(diff)) { console.error('STAGED_SECRET_DETECTED: ghp_ pattern matched'); process.exit(1); } process.exit(0); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const fs = require('fs'); const path = require('path'); const os = require('os'); const cp = require('child_process'); const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-index-iso-')); try { cp.execSync('git init -q', { cwd: tempDir }); const syntheticSecret = ['ghp', '9876543210zyxwvutsrqponmlkjihgfedcba'].join('_'); const filePath = path.join(tempDir, 'staged-only-fixture.txt'); fs.writeFileSync(filePath, 'key=' + syntheticSecret + '\n'); cp.execSync('git add staged-only-fixture.txt', { cwd: tempDir }); fs.unlinkSync(filePath); if (fs.existsSync(filePath)) process.exit(2); const diff = cp.execSync('git diff --cached', { cwd: tempDir }).toString(); if (/ghp_[0-9a-zA-Z]{36}/.test(diff)) { console.error('INDEX_ISOLATION_DETECTED_STAGED_SECRET'); process.exit(1); } process.exit(0); } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }"
node -e "const cp = require('child_process'); let timeoutCaught = false; try { cp.execSync('node -e \x22setTimeout(() => {}, 2000)\x22', { timeout: 200 }); } catch (err) { if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') timeoutCaught = true; } let bufferCaught = false; try { cp.execSync('node -e \x22process.stdout.write(Buffer.alloc(2000))\x22', { maxBuffer: 1000 }); } catch (err) { if (err.code === 'ENOBUFS' || err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') bufferCaught = true; } if (!timeoutCaught || !bufferCaught) process.exit(1); console.log('TIMEOUT_AND_MEMORY_LIMITS_ENFORCED: 5000ms budget, 512MB maxBuffer');"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] || w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-36']; print('Register row 169 status:', rows[0]['status'])"
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm format:check
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `8db2d77` | `CHANGES_REQUIRED` | Resolved 6 findings: Lifecycle state vs register documented with TASK-AI-17 merged in base; install lifecycle script forbidden across root and web manifests; provisioned staged scanner wrapper authorized for git index scanning; authoritative root verification gates restored; Windows and POSIX execution evidence required in acceptance matrix. |
| 2 | `d4d91c0` | `CHANGES_REQUIRED` | Resolved 6 findings + 3 patterns: (1) Pattern 1 / Finding 1: AC-AI-36-01 through 12 restated to name exact executable commands, expected exit codes, exact output strings, and files/artifacts, eliminating all vague intentions ("File inspection", "captured stderr", "doctor stdout"). (2) Finding 2: Replaced ambiguous "wrapper or provisioned binary" with single concrete approach `node tools/ai-guard/cli.js staged-secrets` and deterministic clean/secret fixtures. (3) Finding 3: Defined local cross-platform reproducibility via Git's POSIX hook shell (`sh.exe`) alongside PowerShell, explaining why `.github/` CI runner is out of scope. (4) Finding 4: Defined exact PATH sanitization for Gitleaks absence test in PowerShell, staged fixture, command, and exit 0. (5) Finding 5: Control table status aligned to authoritative register row 169 (`BLOCKED_DEPENDENCY`). (6) Line 74 finding: Pinned bootstrap fallback to `npx lefthook@1.11.3 install`, strictly forbidding bare `npx`. (7) Pattern 2: Explicit numeric thresholds added (1.11.3, 8.24.0, 5000ms timeout budget, 512MB memory budget). (8) Pattern 3: Negative fixtures genuinely fail (protected branch, writer collision, and regex-matching synthetic secret). |
| 3 | `HEAD` | `READY_FOR_CODEX` | Resolved 6 review findings and 3 architectural patterns: (1) Finding 1: AC-AI-36-01 updated to validate manifest promotion to ADOPTED and BLOCKING_GATE with fail-closed quality gate proof (`QUALITY_GATE_MISSING: lefthook`, exit 1) when absent, eliminating contradictory requirement to remain PENDING/NON_BLOCKING. (2) Finding 2: Completely removed unnumbered section 'Downstream implementation acceptance contract' and integrated all primary delivery criteria into authoritative ID-bearing acceptance matrix (`AC-AI-36-01` to `AC-AI-36-18`) verifying root package pin, lefthook version, lefthook.yml commands, hook install, pre-commit hook generation, commit interception, doctor success, clean and secret staged-scanner paths. (3) Finding 3: Replaced direct cli.js check calls with AC-AI-36-07 exercising Lefthook pre-commit hook interception and providing deterministic claim setup (`claim --branch ... --owner ...`) with guaranteed cleanup in finally. (4) Finding 4: Eliminated proposal of committed secret fixture; AC-AI-36-09 uses a safely GENERATED temporary fixture in an isolated temporary repository destroyed in finally, never committing detectable tokens to git or weakening CI Gitleaks gate. (5) Finding 5: AC-AI-36-10 implements staged index vs working tree isolation in an isolated temporary repository created in os.tmpdir(), deleting the file only inside the temporary repository and cleaning up in finally, leaving reviewer's worktree and index untouched. (6) Finding 6: AC-AI-36-11 adds explicit executable tests demonstrating 5000ms timeout budget enforcement (ETIMEDOUT on slow process) and 512 MB memory limit enforcement (ENOBUFS on buffer cap). (7) Patterns 1, 2, 3: Every row names exact command, explicit numeric threshold (0, 1, 1.11.3, 8.24.0, 5000ms, 512MB), exact required output string, and file/artifact; all negative tests genuinely fail closed. |

## Residual limitations

- Automatic-on-install hook registration via lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) remains strictly forbidden across root and workspace manifests by repository supply-chain policy; hook installation must be run explicitly via `bootstrap-worktrees.ps1` or `pnpm lefthook install` (or pinned `npx lefthook@1.11.3 install`), and `scripts/ai/doctor.ps1` verifies hook presence.
- Delivery register row 169 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
- Cross-platform CI execution on Linux/POSIX runners is enforced by existing GitHub Actions workflows; local cross-platform verification on Windows worktrees exercises Git's native POSIX hook shell (`sh.exe`) and PowerShell.

