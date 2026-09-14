# TASK-AI-36 — Lefthook git hook manager

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-36` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
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

- `TASK-AI-17` complete: Ecosystem manifest truthfully reconciled against reality; merged into base branch `fix/task-ai-16-codex-launch-flags` (via commit `1f587dd`). Note: delivery register row 169 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler rather than manual edit.
- `gitleaks` is `ADOPTED` and a `BLOCKING_GATE`, `install_method: "ci-provisioned"`, installed by `.github/workflows/security-baseline.yml` and `.github/workflows/current-application.yml` at pinned `8.24.0`. It is NOT absent.
- `lefthook` and `trivy` genuinely are absent from host and workspace devDependencies prior to implementation, and are declared `PENDING` with `blocking_policy: "NON_BLOCKING"` in `tools/ecosystem-manifest.json`.
- `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly one warning (`PINNED_VERSION_DRIFT` for `codex-cli`: pin `0.151.0` vs observed `0.154.0`, which is an intentional human decision under the upgrade rule). This invariant must be maintained.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors.
- Package manifest policy: Root `package.json` and workspace manifests (`apps/web/package.json`) strictly forbid all four install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`). Git hook installation must never execute implicitly via npm/pnpm lifecycle hooks; Lefthook hook installation must be explicitly invocable (`pnpm lefthook install`) and wired into worktree bootstrapping.
- Workstation secret scanning availability: On clean workstations (including Windows) where native Gitleaks binary is not installed in system PATH, invoking `pnpm security:secrets` produces an operational exit code 2. Local pre-commit hook defense-in-depth requires a locally available staged-content scanner wrapper or provisioned local binary that evaluates staged content without blocking clean commits on missing PATH binaries, while retaining the existing CI Gitleaks gate.

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
  - `pre-commit` stage executing `staged-secret-scan`: executes a staged-content secret scanner wrapper (e.g. `node tools/ai-guard/cli.js staged-secrets` or provisioned local scanner) that queries the Git staged index (`git diff --cached` / `git show :<file>`) and validates staged changes against `.gitleaks.toml` patterns, rather than invoking `pnpm security:secrets` (which scans working tree / commit log and fails with operational code 2 when Gitleaks binary is absent from PATH).
  - Cross-platform shell invocation ensuring robust execution through Git's hook shell on Windows (PowerShell / cmd) and POSIX runners.
- Retain the existing CI `pnpm security:secrets` (Gitleaks 8.24.0) gate in GitHub Actions workflows as the authoritative CI secret barrier.
- Implement/wire the staged-content secret scanner wrapper in `tools/ai-guard/` (with regression tests in `tools/ai-guard/test/`) or provision pinned local binary in `scripts/ai/bootstrap-worktrees.ps1`.
- Update `scripts/ai/bootstrap-worktrees.ps1` to execute `pnpm lefthook install` (or `npx lefthook install`) when provisioning worktrees.
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
| `AI-36-R03` | Explicit, verifiable installation: Hook installation is performed via `pnpm lefthook install`, provisioned in `bootstrap-worktrees.ps1`, and verified by `scripts/ai/doctor.ps1`. |
| `AI-36-R04` | Fail-closed writer claim check: The `pre-commit` hook must execute `node tools/ai-guard/cli.js check` and refuse commit if the current branch is held by a live concurrent AO or external writer session under `AI-TOOL-03`. |
| `AI-36-R05` | Local defense-in-depth staged secret scan: The `pre-commit` hook must scan the Git staged index (`git diff --cached` / staged file contents) prior to commit creation, ensuring that secrets staged in the index are detected even if the working tree copy was subsequently altered or deleted. The hook uses a locally available staged scanner wrapper (`node tools/ai-guard/cli.js staged-secrets` evaluating `.gitleaks.toml` rules) or pinned provisioned binary to prevent operational code 2 failures on workstations where Gitleaks is not on PATH, while retaining `pnpm security:secrets` (Gitleaks 8.24.0) as the authoritative CI gate. |
| `AI-36-R06` | Cross-platform and worktree safety: Lefthook hooks must operate correctly through Git's native hook shell in Windows (PowerShell/cmd) and POSIX (sh/bash) environments across all 5 isolated worktrees without corrupting shared repository storage. Real execution evidence with captured outputs and exit codes is required on both OS families. |
| `AI-36-R07` | Legitimate bypass preserves auditability: Emergency commits remain overridable via standard Git flags (`git commit --no-verify`) or environment variables (`LEFTHOOK=0`); the hook runner must not disable or tamper with Git's native bypass flags. |
| `AI-36-R08` | Truthful manifest promotion: `lefthook` may only be promoted to `ADOPTED` / `BLOCKING_GATE` in `tools/ecosystem-manifest.json` once `pnpm install` verifies binary availability and `lefthook version` passes in the workspace. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer and agent interaction is through Git CLI terminal output and `scripts/ai/doctor.ps1`:
- **Allowed commit**: Lefthook runs `writer-claim` and `staged-secret-scan` quietly; commit proceeds without friction across Windows and POSIX shells (exit code 0).
- **Writer collision blocked**: Emits clear diagnostic stating which session/owner holds the branch, providing unblock guidance (`node tools/ai-guard/cli.js release` or `git commit --no-verify`), aborting commit with non-zero exit code.
- **Secret leak blocked**: Staged secret detected in git index via staged-content scanner wrapper; emits file path and matched pattern details, aborting commit with non-zero exit code before unencrypted secrets enter local git history, even if working-tree copy was modified or deleted.
- **Doctor diagnosis**: `scripts/ai/doctor.ps1` reports `PASS lefthook` when binary and hooks are active, or `FAIL lefthook` with remediation instructions.

## API, event and data impact

No database schema, runtime REST API, or carrier integration contract changes. Toolchain and repository impact:
- Root `package.json` adds `lefthook: "1.11.3"` to `devDependencies`.
- Root `lefthook.yml` added to version control.
- Git hooks generated under `.git/hooks/` (or worktree gitdir) managed by Lefthook.
- `tools/ecosystem-manifest.json` promotes `lefthook` from `PENDING` to `ADOPTED`.
- Staged secret scanner wrapper defined under `tools/ai-guard/`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-36-01` | Verify package dependency pin | `package.json` includes `lefthook: "1.11.3"` in `devDependencies`; `pnpm lefthook version` exits 0 with `1.11.3` | CLI stdout |
| `AC-AI-36-02` | Verify declarative configuration | `lefthook.yml` exists at repo root, configures `writer-claim` (`node tools/ai-guard/cli.js check`) and `staged-secret-scan` (`node tools/ai-guard/cli.js staged-secrets` or staged scanner wrapper) | File inspection |
| `AC-AI-36-03` | Verify hook installation & lifecycle script prohibition | `pnpm lefthook install` installs active pre-commit hooks into git hooks directory; inspection of both root `package.json` and `apps/web/package.json` confirms complete absence of all four forbidden lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) | Command output & manifest inspection for root and apps/web |
| `AC-AI-36-04` | Pre-commit blocks on writer collision | With branch held by simulated external session, `git commit` fails closed with diagnostic output through Git's hook shell on Windows and POSIX runners | Captured stderr & non-zero exit code on Windows and POSIX |
| `AC-AI-36-05` | Pre-commit blocks on staged secret leak | Staging a file containing secret token triggers failure in `staged-secret-scan` hook, aborting commit with non-zero exit code through Git's hook shell on Windows and POSIX runners | Captured stderr & non-zero exit code on Windows and POSIX |
| `AC-AI-36-06` | Doctor reports hook health | `pwsh scripts/ai/doctor.ps1` verifies Lefthook presence and reports `PASS` across worktrees | Doctor stdout |
| `AC-AI-36-07` | Manifest audit green | `node tools/ai-brain/cli.js manifest` passes with 0 errors and exactly 1 warning (`codex-cli` drift) | Manifest CLI stdout |
| `AC-AI-36-08` | Register reconciliation green | `node tools/ai-brain/cli.js reconcile` reports 0 errors | Reconcile CLI stdout |
| `AC-AI-36-09` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` passes with 0 errors | Validator stdout |
| `AC-AI-36-10` | Staged index vs working tree isolation | Secret is added to git stage (`git add`), but the working tree copy is subsequently cleaned or deleted; pre-commit hook inspects staged index, detects secret, and aborts commit | Captured output & non-zero exit code |
| `AC-AI-36-11` | Clean workstation execution without PATH Gitleaks | In a clean environment where native Gitleaks binary is absent from PATH, pre-commit hook runs staged secret scanner wrapper without throwing operational exit code 2 | Captured stdout & exit code 0 |
| `AC-AI-36-12` | Cross-platform allowed commit execution | In a clean workspace with valid writer claim and clean staged files, `git commit` executes hooks cleanly through Git's hook shell on both Windows (PowerShell/cmd) and POSIX (sh/bash) runners | Captured stdout & exit code 0 on Windows and POSIX |

## Verification commands

```powershell
# Authoritative workspace root verification commands (AGENTS.md):
pnpm install --prod --frozen-lockfile
pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:baseline
pnpm security:secrets
pnpm build

# Work Item specific & toolchain verification commands:
pnpm lefthook version
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
pwsh -NoProfile -File scripts/ai/doctor.ps1
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `8db2d77` | `CHANGES_REQUIRED` | Resolved 6 findings: Lifecycle state vs register documented with TASK-AI-17 merged in base; install lifecycle script forbidden across root and web manifests; provisioned staged scanner wrapper authorized for git index scanning; authoritative root verification gates restored; Windows and POSIX execution evidence required in acceptance matrix. |

## Residual limitations

- Automatic-on-install hook registration via lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) remains strictly forbidden in both root `package.json` and `apps/web/package.json` under repository supply-chain policies; new worktrees must run `bootstrap-worktrees.ps1` or `pnpm lefthook install`. `scripts/ai/doctor.ps1` makes any missing installation immediately visible.
- Windows execution requires PowerShell/cmd command compatibility in `lefthook.yml`, ensuring cross-platform agent operations without POSIX-only shell assumptions.
