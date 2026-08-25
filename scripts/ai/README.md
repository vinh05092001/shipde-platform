# Ship Dễ AI control scripts

Run these scripts from Windows PowerShell. They default to `%USERPROFILE%\AI` and repository `vinh05092001/shipde-platform`.

| Script | Purpose | Writes external state |
|---|---|---|
| `bootstrap-worktrees.ps1` | Clone if absent, create missing worktrees and report dirty state | Local Git/worktree only |
| `doctor.ps1` | Verify commands, authentication, branches, services and optional 9Router models | No |
| `start-work-item.ps1` | Move exactly one assigned author workspace onto an existing prepared remote branch | Local Git branch checkout |
| `review-pr.ps1` | Fetch PR identity/checks and copy a review-only prompt | Clipboard only |
| `protect-main.ps1` | Preview or apply GitHub merge settings and `main` protection | GitHub only with `-Apply` |

None of these scripts resets, force-pushes, deletes a worktree, merges a PR or stores a credential.

