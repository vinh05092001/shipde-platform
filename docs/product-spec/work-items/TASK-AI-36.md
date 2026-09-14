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
| Allowed paths | `package.json`, `pnpm-lock.yaml`, `lefthook.yml`, `tools/ecosystem-manifest.json`, `docs/product-spec/work-items/TASK-AI-36.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `scripts/ai/doctor.ps1`, `scripts/ai/bootstrap-worktrees.ps1` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-36-lefthook` |
| Pull Request | `<URL>` |

## Business outcome

Git hooks are the developer and agent front line for enforcing repository safety, preventing secret leaks, and avoiding concurrent writer collisions across semi-automatic workspaces. Currently, writer claim protection (`tools/ai-guard/cli.js check`) and secret scan verification depend on fragile per-worktree configuration (`core.hooksPath` set manually or via worktree scripts). Furthermore, automatic npm lifecycle scripts (`prepare`, `preinstall`, `postinstall`) are strictly forbidden in `package.json` by repository supply-chain security audit policies, which means git hooks cannot be installed implicitly on `pnpm install`.

Adopting Lefthook (`evilmartians/lefthook`) provides a fast, declarative, polyglot Git hook manager that hosts both the writer claim check and secret scan gates under version-controlled configuration (`lefthook.yml`). Lefthook executes hooks reliably across Windows and POSIX environments, enables parallel or sequential task execution, supports transparent bypass mechanisms for emergencies (`--no-verify` / `LEFTHOOK=0`), and replaces bespoke, error-prone `core.hooksPath` overrides with a standardized, auditable hook installation workflow verified by `scripts/ai/doctor.ps1`.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent Codex review gate.
- `AGENTS.md` § Semi-automatic workspaces — Five isolated worktrees (`shipde-platform`, `shipde-claude`, `shipde-dsh`, `shipde-gemini`, `shipde-codex`); single-writer invariant per Work Item.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` — Entry `lefthook` (pinned `1.11.3`, `npm-dev`, `git-hook-runner`, `FOUNDATION`, `SECURITY_REVIEW`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply integrated, enabled or blocking.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-03` — Only one implementation agent and one research agent; parallel writer protection.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — A failed or partial installation reports exact state; never claim installed without evidence.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Ecosystem catalog & Security & Hygiene tooling.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 169 (`TASK-AI-36`).
- `tools/ai-guard/writer-claim.js` and `tools/ai-guard/cli.js` — Authoritative writer claim checking logic (`check` command).
- `scripts/verify-secrets.ts` (`pnpm security:secrets`) — Secret scanning gate.
- `scripts/ai/doctor.ps1` — Workspace and health diagnostics.
- `scripts/ai/bootstrap-worktrees.ps1` — Governed worktree provisioning.

## Preconditions and dependencies

- `TASK-AI-17` complete: Ecosystem manifest truthfully reconciled against reality.
- `gitleaks` is `ADOPTED` and a `BLOCKING_GATE`, `install_method: "ci-provisioned"`, installed by `.github/workflows/security-baseline.yml` and `.github/workflows/current-application.yml` at pinned `8.24.0`. It is NOT absent.
- `lefthook` and `trivy` genuinely are absent from host and workspace devDependencies prior to implementation, and are declared `PENDING` with `blocking_policy: "NON_BLOCKING"` in `tools/ecosystem-manifest.json`.
- `node tools/ai-brain/cli.js manifest` reports 0 errors and exactly one warning (`PINNED_VERSION_DRIFT` for `codex-cli`: pin `0.151.0` vs observed `0.154.0`, which is an intentional human decision under the upgrade rule). This invariant must be maintained.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors.
- Package manifest policy: `package.json` forbids install lifecycle scripts (`prepare`, `preinstall`, `postinstall`). Lefthook hook installation must be explicitly invocable (`pnpm lefthook install`) and wired into worktree bootstrapping.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to configuring Lefthook as a devDependency, defining `lefthook.yml`, updating worktree bootstrap and doctor scripts, promoting `lefthook` in `tools/ecosystem-manifest.json`, and updating documentation.

Prohibited in this Work Item:
- Do NOT edit anything under `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, `.gitleaks.toml`, or any validator script.
- Do NOT add `prepare`, `preinstall`, or `postinstall` scripts to `package.json`.
- Do NOT disable, skip, or narrow any check or quality gate.
- Do NOT modify review verdict parsing, exact-HEAD binding, or supervisor logic in `scripts/ai/control.ps1`.
- Do NOT promote `trivy` or any other tool from `PENDING` without its own dedicated Work Item (`TASK-AI-37`).
- Do NOT alter the pinned `codex-cli` version.

## In scope

- Add `lefthook` pinned at exact version `1.11.3` as a devDependency in root `package.json`.
- Author declarative, version-controlled `lefthook.yml` at repository root:
  - `pre-commit` stage executing `writer-claim` (`node tools/ai-guard/cli.js check`).
  - `pre-commit` stage executing `secret-scan` (`pnpm security:secrets`).
  - Cross-platform shell invocation ensuring compatibility on Windows (PowerShell / cmd) and POSIX runners.
- Update `scripts/ai/bootstrap-worktrees.ps1` to execute `pnpm lefthook install` (or `npx lefthook install`) when provisioning worktrees.
- Update `scripts/ai/doctor.ps1` to verify Lefthook binary resolution (`lefthook version`) and hook installation status across governed worktrees.
- Update `tools/ecosystem-manifest.json` for `lefthook`:
  - Promote `lifecycle_state` from `PENDING` to `ADOPTED`.
  - Set `default_enabled: true`.
  - Set `blocking_policy: "BLOCKING_GATE"`.
  - Verify `health_check: "lefthook version"`.
  - Update `updated_at` timestamp.
- Record the architectural rationale and configuration in `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.
- Ensure all quality gates remain green:
  - `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"`
  - `node tools/ai-brain/cli.js reconcile`
  - `node tools/ai-brain/cli.js manifest` (0 errors, 1 warning for codex-cli drift)
  - `python docs/product-spec/scripts/validate_docs.py`

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
| `AI-36-R02` | No forbidden lifecycle scripts: Git hook installation must never rely on npm/pnpm lifecycle hooks (`prepare`, `preinstall`, `postinstall`) in `package.json`, preserving the repository supply-chain audit invariant. |
| `AI-36-R03` | Explicit, verifiable installation: Hook installation is performed via `pnpm lefthook install`, provisioned in `bootstrap-worktrees.ps1`, and verified by `scripts/ai/doctor.ps1`. |
| `AI-36-R04` | Fail-closed writer claim check: The `pre-commit` hook must execute `node tools/ai-guard/cli.js check` and refuse commit if the current branch is held by a live concurrent AO or external writer session under `AI-TOOL-03`. |
| `AI-36-R05` | Local defense-in-depth secret scan: The `pre-commit` hook must execute secret scanning on staged files prior to commit creation, complementing CI enforcement by `gitleaks`. |
| `AI-36-R06` | Cross-platform and worktree safety: Lefthook hooks must operate correctly in Windows and POSIX shells across all 5 isolated worktrees without corrupting shared repository storage. |
| `AI-36-R07` | Legitimate bypass preserves auditability: Emergency commits remain overridable via standard Git flags (`git commit --no-verify`) or environment variables (`LEFTHOOK=0`); the hook runner must not disable or tamper with Git's native bypass flags. |
| `AI-36-R08` | Truthful manifest promotion: `lefthook` may only be promoted to `ADOPTED` / `BLOCKING_GATE` in `tools/ecosystem-manifest.json` once `pnpm install` verifies binary availability and `lefthook version` passes in the workspace. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer and agent interaction is through Git CLI terminal output and `scripts/ai/doctor.ps1`:
- **Allowed commit**: Lefthook runs `writer-claim` and `secret-scan` quietly; commit proceeds without friction.
- **Writer collision blocked**: Emits clear diagnostic stating which session/owner holds the branch, providing unblock guidance (`node tools/ai-guard/cli.js release` or `git commit --no-verify`).
- **Secret leak blocked**: Emits file path and matched pattern details, aborting commit before unencrypted secrets enter local git history.
- **Doctor diagnosis**: `scripts/ai/doctor.ps1` reports `PASS lefthook` when binary and hooks are active, or `FAIL lefthook` with remediation instructions.

## API, event and data impact

No database schema, runtime REST API, or carrier integration contract changes. Toolchain and repository impact:
- Root `package.json` adds `lefthook: "1.11.3"` to `devDependencies`.
- Root `lefthook.yml` added to version control.
- Git hooks generated under `.git/hooks/` (or worktree gitdir) managed by Lefthook.
- `tools/ecosystem-manifest.json` promotes `lefthook` from `PENDING` to `ADOPTED`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-36-01` | Verify package dependency pin | `package.json` includes `lefthook: "1.11.3"` in `devDependencies`; `pnpm lefthook version` exits 0 with `1.11.3` | CLI stdout |
| `AC-AI-36-02` | Verify declarative configuration | `lefthook.yml` exists at repo root, configures `writer-claim` (`node tools/ai-guard/cli.js check`) and `secret-scan` (`pnpm security:secrets`) | File inspection |
| `AC-AI-36-03` | Verify hook installation | `pnpm lefthook install` installs active pre-commit hooks into git hooks directory without lifecycle scripts | Command output & directory inspection |
| `AC-AI-36-04` | Pre-commit blocks on writer collision | With branch held by simulated external session, `git commit` fails closed with diagnostic output | Stderr capture |
| `AC-AI-36-05` | Pre-commit blocks on secret leak | Staging a file with secret token triggers failure in `secret-scan` hook, aborting commit | Stderr capture |
| `AC-AI-36-06` | Doctor reports hook health | `pwsh scripts/ai/doctor.ps1` verifies Lefthook presence and reports `PASS` across worktrees | Doctor stdout |
| `AC-AI-36-07` | Manifest audit green | `node tools/ai-brain/cli.js manifest` passes with 0 errors and exactly 1 warning (`codex-cli` drift) | Manifest CLI stdout |
| `AC-AI-36-08` | Register reconciliation green | `node tools/ai-brain/cli.js reconcile` reports 0 errors | Reconcile CLI stdout |
| `AC-AI-36-09` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` passes with 0 errors | Validator stdout |

## Verification commands

```powershell
pnpm install
pnpm lefthook version
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
pwsh -NoProfile -File scripts/ai/doctor.ps1
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

- Automatic-on-install hook registration remains forbidden under repository supply-chain policies; new worktrees must run `bootstrap-worktrees.ps1` or `pnpm lefthook install`. `scripts/ai/doctor.ps1` makes any missing installation immediately visible.
- Windows execution requires PowerShell/cmd command compatibility in `lefthook.yml`, ensuring cross-platform agent operations without POSIX-only shell assumptions.
