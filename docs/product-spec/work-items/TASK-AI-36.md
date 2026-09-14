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
- Implement the staged-content secret scanner wrapper in `tools/ai-guard/` (`node tools/ai-guard/cli.js staged-secrets` and `tools/ai-guard/staged-secrets.js`) with deterministic fixtures and regression tests in `tools/ai-guard/test/`.
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
| `AI-36-R05` | Local defense-in-depth staged secret scan: The `pre-commit` hook must execute single concrete approach `node tools/ai-guard/cli.js staged-secrets` scanning the Git staged index (`git diff --cached` / staged file contents) within an execution timeout budget of `5000ms` and memory budget of `512MB`. Secrets staged in the index are detected even if the working tree copy was subsequently altered or deleted. Evaluating `.gitleaks.toml` rules via Node.js prevents operational code 2 failures on workstations where Gitleaks is not on PATH, while retaining `pnpm security:secrets` (Gitleaks 8.24.0) as the authoritative CI gate. |
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
| `AC-AI-36-01` | Verify package dependency pin in ecosystem manifest | `node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='lefthook'); if(m.pinned_version_or_commit!=='1.11.3' \|\| m.lifecycle_state!=='PENDING' \|\| m.blocking_policy!=='NON_BLOCKING') throw new Error('lefthook mismatch'); console.log('Lefthook pinned at 1.11.3, PENDING, NON_BLOCKING');"` | `0` | `Lefthook pinned at 1.11.3, PENDING, NON_BLOCKING` | `tools/ecosystem-manifest.json` |
| `AC-AI-36-02` | Verify single approach, timeout budget, and fixtures specified | `python -c "content=open('docs/product-spec/work-items/TASK-AI-36.md', encoding='utf-8').read(); assert 'node tools/ai-guard/cli.js staged-secrets' in content; assert 'tools/ai-guard/test/fixtures/staged-secret.txt' in content; assert '5000ms' in content; print('Single approach, timeout budget 5000ms, and fixtures specified');"` | `0` | `Single approach, timeout budget 5000ms, and fixtures specified` | `docs/product-spec/work-items/TASK-AI-36.md` |
| `AC-AI-36-03` | Verify complete absence of all 4 forbidden lifecycle scripts | `node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] \|\| w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `package.json`, `apps/web/package.json` |
| `AC-AI-36-04` | Pre-commit blocks on branch collision with external owner (negative test) | `node tools/ai-guard/cli.js check --branch feat/task-ai-15-realtime-ai-cockpit --owner external-user` | `1` | `CHẶN GHI — Nhánh \"feat/task-ai-15-realtime-ai-cockpit\" đang được giữ bởi: shipde-platform-14` | `tools/ai-guard/cli.js` stderr |
| `AC-AI-36-05` | Pre-commit blocks on protected branch write (negative test) | `node tools/ai-guard/cli.js check --branch main` | `1` | `CHẶN GHI — Không ghi trực tiếp lên main. Hãy tạo nhánh riêng.` | `tools/ai-guard/cli.js` stderr |
| `AC-AI-36-06` | Cross-platform hook shell execution via Git's POSIX hook shell (`sh.exe`) | `& \"C:\Program Files\Git\bin\sh.exe\" -c \"node tools/ai-guard/cli.js check --branch main\"` | `1` | `CHẶN GHI — Không ghi trực tiếp lên main. Hãy tạo nhánh riêng.` | `C:\Program Files\Git\bin\sh.exe` stderr |
| `AC-AI-36-07` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 2 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-36-08` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-36-09` | Delivery register status truthfulness for TASK-AI-36 (row 169) | `python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-36']; print('Register row 169 status:', rows[0]['status'])"` | `0` | `Register row 169 status: BLOCKED_DEPENDENCY` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-36-10` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows, 526 unique identifiers.` | `docs/product-spec/scripts/validate_docs.py` stdout |
| `AC-AI-36-11` | Toolchain unit & integration test suites green | `node --test \"tools/ai-brain/test/*.test.js\" \"tools/ai-dashboard/test/*.test.js\" \"tools/ai-guard/test/*.test.js\"` | `0` | `ℹ pass 458` | Test runner stdout |
| `AC-AI-36-12` | Incremental code and document formatting check | `pnpm format:check` | `0` | `All matched files use Prettier code style!` | `scripts/verify-formatting.ts` stdout |

## Downstream implementation acceptance contract

When an author implements `TASK-AI-36`, the implementation must provide and satisfy the following deterministic verification contract:

1. **Lefthook package pin**:
   - `pnpm lefthook version` exits `0` and outputs `1.11.3`.
   - Root `package.json` contains `"lefthook": "1.11.3"` under `devDependencies`.
2. **Declarative configuration (`lefthook.yml`)**:
   - `lefthook.yml` at repository root configures:
     - `pre-commit.commands.writer-claim.run`: `node tools/ai-guard/cli.js check`
     - `pre-commit.commands.staged-secrets.run`: `node tools/ai-guard/cli.js staged-secrets`
3. **Single staged-secret scan approach**:
   - Command: `node tools/ai-guard/cli.js staged-secrets`.
   - Execution timeout budget: `5000ms`; memory budget: `512MB`.
   - Clean fixture (`tools/ai-guard/test/fixtures/clean-file.txt` containing benign `test=clean`):
     - Execution: `git add tools/ai-guard/test/fixtures/clean-file.txt && node tools/ai-guard/cli.js staged-secrets`
     - Expected exit: `0`
     - Expected output: `No staged secrets detected`
   - Staged-secret negative fixture (`tools/ai-guard/test/fixtures/staged-secret.txt` containing synthetic GitHub PAT matching regex `ghp_[0-9a-zA-Z]{36}` under `.gitleaks.toml` rules):
     - Execution: `git add tools/ai-guard/test/fixtures/staged-secret.txt && node tools/ai-guard/cli.js staged-secrets`
     - Expected exit: `1`
     - Expected output: `STAGED SECRET DETECTED: ghp_`
4. **Index vs working tree isolation**:
   - Secret added to index via `git add tools/ai-guard/test/fixtures/staged-secret.txt`, then working-tree file removed via `Remove-Item tools/ai-guard/test/fixtures/staged-secret.txt`.
   - Execution: `node tools/ai-guard/cli.js staged-secrets`
   - Expected exit: `1`
   - Expected output: `STAGED SECRET DETECTED: ghp_`
5. **Clean workstation execution (PATH sanitized without Gitleaks)**:
   - PowerShell PATH sanitized: `$env:PATH = ($env:PATH -split ';' | Where-Object { -not (Test-Path "$_\gitleaks.exe") }) -join ';'`
   - Clean staged fixture: `git add tools/ai-guard/test/fixtures/clean-file.txt`
   - Execution: `node tools/ai-guard/cli.js staged-secrets`
   - Expected exit: `0`
   - Expected output: `No staged secrets detected` (no operational exit code 2).
6. **Hook installation and doctor verification**:
   - `pnpm lefthook install` installs hooks into `.git/hooks/pre-commit`.
   - `pwsh -NoProfile -File scripts/ai/doctor.ps1` reports `PASS lefthook`.
   - Hook installation fallback requires `npx lefthook@1.11.3 install`; bare unpinned `npx lefthook install` is rejected.

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='lefthook'); if(m.pinned_version_or_commit!=='1.11.3' || m.lifecycle_state!=='PENDING' || m.blocking_policy!=='NON_BLOCKING') throw new Error('lefthook mismatch'); console.log('Lefthook pinned at 1.11.3, PENDING, NON_BLOCKING');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-36.md', encoding='utf-8').read(); assert 'node tools/ai-guard/cli.js staged-secrets' in content; assert 'tools/ai-guard/test/fixtures/staged-secret.txt' in content; assert '5000ms' in content; print('Single approach, timeout budget 5000ms, and fixtures specified');"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); ['preinstall','install','postinstall','prepare'].forEach(s => { if(r.scripts?.[s] || w.scripts?.[s]) throw new Error('forbidden script: '+s); }); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
node tools/ai-guard/cli.js check --branch feat/task-ai-15-realtime-ai-cockpit --owner external-user
node tools/ai-guard/cli.js check --branch main
& "C:\Program Files\Git\bin\sh.exe" -c "node tools/ai-guard/cli.js check --branch main"
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

## Residual limitations

- Automatic-on-install hook registration via lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) remains strictly forbidden across root and workspace manifests by repository supply-chain policy; hook installation must be run explicitly via `bootstrap-worktrees.ps1` or `pnpm lefthook install` (or pinned `npx lefthook@1.11.3 install`), and `scripts/ai/doctor.ps1` verifies hook presence.
- Delivery register row 169 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
- Cross-platform CI execution on Linux/POSIX runners is enforced by existing GitHub Actions workflows; local cross-platform verification on Windows worktrees exercises Git's native POSIX hook shell (`sh.exe`) and PowerShell.
