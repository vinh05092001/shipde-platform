# Ship Dễ AI control scripts

Run these scripts from Windows PowerShell. They default to `%USERPROFILE%\AI` and repository `vinh05092001/shipde-platform`.

| Script | Purpose | Writes external state |
|---|---|---|
| `install-clis.ps1` | Preview or install every missing machine CLI; optional Docker Desktop | Global npm/Windows packages only with `-Apply` |
| `bootstrap-worktrees.ps1` | Clone if absent, create missing worktrees and report dirty state | Local Git/worktree only |
| `doctor.ps1` | Verify CLI versions, authentication, branches, Docker, services and optional 9Router models | No |
| `start-work-item.ps1` | Move exactly one assigned author workspace onto an existing prepared remote branch | Local Git branch checkout |
| `review-pr.ps1` | Fetch PR identity/checks and copy a review-only prompt | Clipboard only |
| `protect-main.ps1` | Preview or apply GitHub merge settings and `main` protection | GitHub only with `-Apply` |

`install-clis.ps1` and `protect-main.ps1` are preview-only unless `-Apply` is supplied. The installer never upgrades an already installed CLI and never authenticates an account or reads a credential.

None of these scripts resets, force-pushes, deletes a worktree, merges a PR or stores a credential.

