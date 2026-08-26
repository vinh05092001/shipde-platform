# Ship Dễ AI control scripts

Run these scripts from Windows PowerShell. They default to `%USERPROFILE%\AI` and repository `vinh05092001/shipde-platform`.

| Script | Purpose | Writes external state |
|---|---|---|
| `control.ps1` | One-button state router: prepare, auto-select author, open the isolated worktree, gate Codex review, return fixes and synchronize after merge | Clean local branch checkout, local review artifact and optional PR comment only after confirmation |
| `install-clis.ps1` | Preview or install every missing machine CLI; optional Docker Desktop | Global npm/Windows packages only with `-Apply` |
| `bootstrap-worktrees.ps1` | Clone if absent, create missing worktrees and report dirty state | Local Git/worktree only |
| `doctor.ps1` | Verify CLI versions, authentication, branches, Docker, services and optional 9Router models | No |
| `start-work-item.ps1` | Move exactly one assigned author workspace onto an existing prepared remote branch | Local Git branch checkout |
| `review-pr.ps1` | Fetch PR identity/checks and copy a review-only prompt | Clipboard only |
| `protect-main.ps1` | Preview or apply GitHub merge settings and `main` protection | GitHub only with `-Apply` |

Normal daily use is `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume`. The controller derives the next safe stage from Git/GitHub state; the human still approves material decisions, review publication and merge.

`install-clis.ps1` and `protect-main.ps1` are preview-only unless `-Apply` is supplied. The installer installs missing npm CLIs sequentially with bounded network retries, never upgrades an already installed CLI and never authenticates an account or reads a credential.

None of these scripts resets, force-pushes, deletes a worktree, merges a PR or stores a credential. `control.ps1` stops on dirty worktrees, multiple active implementation PRs or failed CI; it never converts a failure into a pass.
