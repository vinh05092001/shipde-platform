# Windows Setup and Operating Runbook

## Completion definition

Setup is complete only when all worktrees are healthy, 9Router and DSH can reach an approved free model, GitHub gates are green and `main` is protected. No API key is stored in Git.

## Expected local layout

| Path | Role |
|---|---|
| `C:\Users\gumac\AI\shipde-platform` | protected integration baseline |
| `C:\Users\gumac\AI\shipde-dsh` | 9Router/DSH low-risk author |
| `C:\Users\gumac\AI\shipde-gemini` | Gemini primary author |
| `C:\Users\gumac\AI\shipde-codex` | Codex planner and independent reviewer |

## 1. Merge and synchronize the setup contract

After independent Codex `PASS`, squash-merge PR `#1`, then run:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
git pull --ff-only origin main
powershell -ExecutionPolicy Bypass -File .\scripts\ai\bootstrap-worktrees.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\ai\doctor.ps1
```

The bootstrap script never resets, deletes or overwrites a dirty worktree. It stops and reports the exact workspace requiring attention.

## 2. Configure 9Router safely

1. Start 9Router and open `http://127.0.0.1:20128/dashboard`.
2. Under Endpoint settings set RTK ON, Ponytail OFF, Caveman OFF, Headroom OFF and request logging OFF.
3. Create a free-only combo named `shipde-low-risk` from currently available models using the preference order in `AI-TOOLCHAIN-DECISIONS.md`.
4. Keep the service bound locally. Do not expose port `20128` to the internet.

## 3. Connect DSH to 9Router

Start DSH from its own workspace:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-dsh"
dsh web
```

In DSH open Settings → Models → Add a custom provider and enter:

| Field | Value |
|---|---|
| Provider ID | `9router` |
| Display name | `9Router Local` |
| Base URL | `http://127.0.0.1:20128/v1` |
| API protocol | `openai-completions` |
| Credential | paste the API key from the local 9Router dashboard |
| Model | `shipde-low-risk`, or a verified current candidate if the combo is not exposed |

Choose Fetch available models before saving. Select `C:\Users\gumac\AI\shipde-dsh` as the only DSH workspace for Ship Dễ.

Run the secure model test; the key is requested as a masked value and is never printed:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\doctor.ps1 -TestModels
```

## 4. Protect GitHub `main`

First preview, then apply:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\protect-main.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\ai\protect-main.ps1 -Apply
```

The script enables squash-only merging, deletes merged branches and requires the always-present `contract` and `application-gate` checks. It deliberately does not require a GitHub approval because the repository currently has one account; Codex verdict and human merge ownership remain required by the Work Item contract.

## 5. Start an implementation author

Codex first prepares and pushes one Work Item branch, then parks its worktree back on `agent/codex-review`. Start the assigned author with:

```powershell
# Example only after Codex has prepared the remote branch
.\scripts\ai\start-work-item.ps1 -WorkItemId TASK-FOUND-01 -Slug freeze-prototype -Author GEMINI
```

The script refuses dirty worktrees, missing remote branches, missing Work Items or an author mismatch.

## 6. Start independent Codex review

```powershell
.\scripts\ai\review-pr.ps1 -PullRequest 2
```

The script fetches the immutable PR identity, prints its checks and copies a review-only prompt to the Windows clipboard. Paste that prompt into a fresh Codex task opened at `shipde-codex`.

## Daily control rules

- Never open two apps on the same worktree.
- Never let an author work directly on `main` or `agent/codex-review`.
- Never paste API keys into chat, Work Items, `.env`, commits, screenshots or logs.
- Stop when a script reports a dirty workspace; inspect instead of resetting.
- After merge, run bootstrap and doctor before preparing the next Work Item.
- Keep one active implementation Work Item until the workflow has passed its first complete cycle.

## Final readiness checklist

- All four worktrees are present and clean.
- `gh auth status` is healthy.
- 9Router port `20128` and DSH port `3080` are reachable when started.
- DSH successfully completes a disposable read-only task through `shipde-low-risk`.
- Ponytail, Caveman, Headroom and request logging are OFF.
- GitHub `main` rejects direct/force pushes and requires `contract` plus `application-gate`.
- PR #1 is merged only after an independent Codex `PASS`.
- `TASK-FOUND-01` is the next and only implementation item.

