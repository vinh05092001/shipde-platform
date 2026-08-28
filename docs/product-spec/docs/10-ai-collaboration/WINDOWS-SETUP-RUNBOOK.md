# Windows Setup and Operating Runbook

## Completion definition

Setup is complete only when all five worktrees are healthy, all required machine CLIs resolve, Docker Compose is available, Claude/AgentRouter, Gemini/Antigravity and Codex can authenticate, 9Router and DSH can reach an approved free model, GitHub gates are green and `main` is protected. No API key is stored in Git.

Windows 10 Pro is used natively. Ubuntu/WSL is not required for this workflow. Docker Desktop may use its supported Windows backend; follow Docker's restart prompt if one appears.

## Expected local layout

| Path | Role |
|---|---|
| `C:\Users\gumac\AI\shipde-platform` | protected integration baseline |
| `C:\Users\gumac\AI\shipde-claude` | Claude business and solution analysis only |
| `C:\Users\gumac\AI\shipde-dsh` | 9Router/DSH low-risk author |
| `C:\Users\gumac\AI\shipde-gemini` | Gemini primary author |
| `C:\Users\gumac\AI\shipde-codex` | Codex planner and independent reviewer |

These paths are worktrees of the same repository. Do not clone Playwright, Storybook, NestJS or other upstream source repositories. The complete classification is in `REPOSITORY-CLI-MANIFEST.md`.

## 1. Merge and synchronize the setup contract

After independent Codex `PASS`, squash-merge PR `#1`, then run:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
git pull --ff-only origin main
powershell -ExecutionPolicy Bypass -File .\scripts\ai\bootstrap-worktrees.ps1
```

The bootstrap script never resets, deletes or overwrites a dirty worktree. It stops and reports the exact workspace requiring attention.

Preview and then install the Desktop entry point for the state controller:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-control-shortcut.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-control-shortcut.ps1 -Apply
```

This shortcut replaces any older app-launch menu. It opens the versioned controller; choose **Continue pipeline** for normal operation.

## 2. Inventory and install every required CLI

Preview first:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-clis.ps1 -InstallDocker
```

If the plan is correct, install only missing tools:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-clis.ps1 -Apply -InstallDocker
```

The script covers pnpm 11, 9Router, pinned DSH, Gemini CLI, Codex CLI, Claude Code and Docker Desktop. It does not reinstall or upgrade an existing CLI, sign in, start a provider or store a secret. Docker installation can require administrator approval, a restart and opening a new PowerShell window.

After restart, launch Docker Desktop and verify:

```powershell
docker version
docker compose version
```

## 3. Authenticate interactive tools

GitHub is already authenticated; verify it rather than pasting a token:

```powershell
gh auth status
```

Use the already authenticated Antigravity CLI as the preferred Gemini implementation client; Gemini CLI remains the fallback:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-gemini"
agy --version
gemini --version
```

Start Codex from its review worktree and use **Sign in with ChatGPT**, not an API key:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-codex"
codex login status
```

Claude Code is isolated in `shipde-claude` and remains business/solution-only. Its AgentRouter token must be read by an untracked local launcher or user credential environment, never copied into this repository. Validate the launcher with a harmless analysis prompt; do not route AgentRouter through 9Router.

## 4. Configure 9Router safely

1. Start `9router` and open `http://127.0.0.1:20128/dashboard`.
2. Under Endpoint settings set RTK ON, Ponytail OFF, Caveman OFF, Headroom OFF and request logging OFF.
3. Create a free-only combo named `shipde-low-risk` from currently available models using the preference order in `AI-TOOLCHAIN-DECISIONS.md`.
4. Keep the service bound locally. Do not expose port `20128` to the internet.

## 5. Connect DSH to 9Router

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

Run the secure full check; the key is requested as a masked value and is never printed:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\doctor.ps1 -TestDocker -TestModels
```

## 6. Protect GitHub `main`

First preview, then apply:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\protect-main.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\ai\protect-main.ps1 -Apply
```

The script enables squash-only merging, deletes merged branches and requires the always-present `contract` and `application-gate` checks. It deliberately does not require a GitHub approval because the repository currently has one account; Codex verdict and human merge ownership remain required by the Work Item contract.

## 7. Install project repositories through Foundation Work Items

Do not run global installs for the application framework or test stack. The assigned Gemini Foundation Pull Requests add and pin them in this order:

1. `TASK-FOUND-01`: repair ESLint/format baseline and add secret scanning.
2. `TASK-FOUND-02`: pnpm/Turborepo monorepo migration.
3. `TASK-FOUND-03`: NestJS API/worker plus PostgreSQL, Redis and S3-compatible Docker services.
4. `TASK-FOUND-04`: OpenAPI generation, Vitest/Supertest, Playwright, Storybook, axe, MSW and targeted Lighthouse CI.

Each Foundation item must pass its own CI and independent Codex review. Installing all project dependencies into the current prototype in PR `#1` would mix four different Work Items and remove the ability to identify which migration broke the product.

## 8. Continue the delivery pipeline

For normal work, do not type Work Item ID, slug, branch, author or Pull Request number. Open **Ship De AI Control** and choose **Continue pipeline**, or run:

```powershell
Set-Location "$env:USERPROFILE\AI\shipde-platform"
powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume
```

From durable Git/GitHub state the controller performs exactly one next safe transition:

- no prepared item and no implementation PR: open Codex planning with the exact prompt on the clipboard;
- one prepared `READY_FOR_AUTHOR` branch: verify its dedicated Work Item, select Gemini/Antigravity or 9Router/DSH, check out only that isolated worktree and copy the filled author prompt;
- one implementation PR with green CI: detach the Codex worktree at its immutable head and run non-interactive independent review;
- `CHANGES_REQUIRED`: offer to return the findings to the same author and branch;
- `PASS`: open the PR for the human merge owner.

The human pastes a prepared prompt when an interactive client opens, approves posting a review comment, resolves material product choices and performs the merge. The controller never merges, invents a product decision, bypasses red CI or resets a dirty worktree.

## 9. Synchronize after human merge

After squash-merging the passing PR, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Sync
```

This parks and fast-forwards every clean worktree. Then choose **Continue pipeline** again to prepare the next dependency-ready Work Item. The lower-level `start-work-item.ps1` and `review-pr.ps1` remain recovery tools, not the normal operating path.

## Daily control rules

- Never open two apps on the same worktree.
- Never let an author work directly on `main` or `agent/codex-review`.
- Never paste API keys into chat, Work Items, `.env`, commits, screenshots or logs.
- Stop when a script reports a dirty workspace; inspect instead of resetting.
- Do not auto-upgrade a CLI during an active Work Item.
- After merge, run controller `Sync`; rerun `doctor.ps1` after tool, Docker, credential or model changes.
- Keep one active implementation Work Item until the workflow has passed its first complete cycle.

## Final readiness checklist

- All five worktrees are present and clean.
- `git`, `gh`, `node`, `npm`, `pnpm`, `docker`, `9router`, `dsh`, `codex`, `claude` and at least one Gemini client (`agy` preferred, `gemini` fallback) resolve in a new PowerShell window.
- `gh auth status`, Antigravity/Gemini sign-in, Codex ChatGPT sign-in and the isolated Claude/AgentRouter launcher are healthy.
- Docker Desktop is running and `docker compose version` succeeds.
- 9Router port `20128` and DSH port `3080` are reachable when started.
- DSH successfully completes the `SHIPDE_OK` task through `shipde-low-risk`.
- Ponytail, Caveman, Headroom and request logging are OFF.
- GitHub `main` rejects direct/force pushes and requires `contract` plus `application-gate`.
- PR #1 is merged only after an independent Codex `PASS`.
- `TASK-FOUND-01` is the next and only implementation item.
