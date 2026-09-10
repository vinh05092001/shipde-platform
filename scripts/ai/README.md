# Ship Dễ AI control scripts

Run these scripts from Windows PowerShell. They default to `%USERPROFILE%\AI` and repository `vinh05092001/shipde-platform`.

| Script                         | Purpose                                                                                                                                                                                                    | Writes external state                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `control.ps1`                  | One-button state router: prepare, auto-select author, open isolated worktrees, gate Codex review, return fixes, execute governed exact-HEAD auto-merge with `expectedHeadOid`, and synchronize after merge | Clean local branch checkout, review artifacts, optional PR comments, crash-safe merge intent checkpoint, and squash merge mutation only when every gate passes |
| `install-clis.ps1`             | Preview or install every missing machine CLI; optional Docker Desktop                                                                                                                                      | Global npm/Windows packages only with `-Apply`                                                                                                                 |
| `install-control-shortcut.ps1` | Preview or install the Desktop shortcut that opens the versioned state controller                                                                                                                          | One `.lnk` file only with `-Apply`                                                                                                                             |
| `bootstrap-worktrees.ps1`      | Clone if absent, create missing worktrees and report dirty state                                                                                                                                           | Local Git/worktree only                                                                                                                                        |
| `doctor.ps1`                   | Verify CLI versions, authentication, branches, Docker, services, ecosystem validation, containment and optional 9Router models                                                                             | No                                                                                                                                                             |
| `ecosystem.ps1`                | Governed ecosystem operations: validate 37 adopted tools and 9 profiles, query status, activate/deactivate profiles, run negative policy self-tests, and reconcile register                                | Manifest/profile validation and delivery register updates with `-Action SyncRegister`                                                                          |
| `install-ecosystem.ps1`        | Preview or install missing machine-level tools from `tools/ecosystem-manifest.json`; preserves existing versions and defers project dependencies                                                           | Global npm/Windows packages only with `-Apply`                                                                                                                 |
| `start-work-item.ps1`          | Move exactly one assigned author workspace onto an existing prepared remote branch                                                                                                                         | Local Git branch checkout                                                                                                                                      |
| `review-pr.ps1`                | Fetch PR identity/checks and copy a review-only prompt                                                                                                                                                     | Clipboard only                                                                                                                                                 |
| `protect-main.ps1`             | Preview or apply GitHub merge settings and `main` protection                                                                                                                                               | GitHub only with `-Apply`                                                                                                                                      |

Normal daily use is **Continue pipeline** from the installed Desktop shortcut, or `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume`. The controller derives the next safe stage from Git/GitHub state; the human still approves material decisions, review publication and merge.

Under `TASK-AI-13` (`HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08`), the supervisor supports deterministic exact-HEAD auto-merge after reaching `READY_FOR_HUMAN_MERGE`. Auto-merge requires a single-snapshot preflight validating:

- PR matches Work Item ID, branch, non-fork, base `main`, non-draft, and exact 40-character commit OID.
- Every branch-protection required check concludes `SUCCESS` from GitHub Actions App ID 15368.
- Durable review verdict `PASS` from trusted bot `chatgpt-codex-connector[bot]` tied to the exact commit OID (rejecting author self-review, repo owner, or non-allowlisted authors).
- Zero unresolved review threads via exhaustive paginated GraphQL query.
- Valid repository merge/push permissions.
- Submission of exactly one GraphQL `mergePullRequest` mutation with `expectedHeadOid` and `mergeMethod: "SQUASH"`.

Explicit console states are: `WAIT_CI`, `WAIT_REVIEW`, `WAIT_THREADS`, `WAIT_MERGEABLE`, `MERGE_INTENT_PERSISTED`, `MERGE_RECONCILING`, `MERGED`, `BLOCKED`, and `CORE_COMPLETE`.

Crash recovery: Before sending the external merge mutation, the supervisor persists a checkpoint with state `MERGE_INTENT_PERSISTED`. On restart, `Reconcile-ShipDeMergeIntent` inspects remote GitHub PR state before attempting any retry.

Bootstrap and sequencing rules:

- `TASK-AI-13` bootstrap requires human merge; auto-merge is activated only after TASK-AI-13 is durably merged.
- PR #8 is preserved byte-for-byte during TASK-AI-13 bootstrap. Once TASK-AI-13 is merged, the controller prioritizes existing PR #8 repair before preparing TASK-AI-07.
- When both `TASK-AI-12` and `TASK-AI-13` are reconciled `MERGED`, the supervisor halts at `CORE_COMPLETE` without selecting `TASK-AI-14` or `TASK-AI-15`.

`install-clis.ps1`, `install-ecosystem.ps1`, and `protect-main.ps1` are preview-only unless `-Apply` is supplied. The installer installs missing npm CLIs sequentially with bounded network retries, never upgrades an already installed CLI, defers later foundation dependencies without mutating package manifests or lockfiles, and never authenticates an account or reads a credential.

Ecosystem governance rules enforce: exactly 37 adopted repositories/capabilities in `tools/ecosystem-manifest.json`, 10 isolated candidates in `PILOT`/`WATCH`, 9 activation profiles in `tools/ecosystem-profiles.json`, distinct Playwright roles (Test vs CLI vs MCP), local-only bindings (no 0.0.0.0 or tunnels), disabled telemetry, stopped optional services by default, and fail-closed validation.

None of these scripts resets, force-pushes, deletes a worktree, or stores a credential. Auto-merge executes exclusively via GitHub's `mergePullRequest` GraphQL mutation with strict `expectedHeadOid` preconditions. `control.ps1` stops on dirty worktrees, multiple active implementation PRs, or any missing, stale, or contradictory evidence; it never converts a failure into a pass.
