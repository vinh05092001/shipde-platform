# TASK-AI-14 — Native Claude Code CLI review and authoring fallback

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-14`                                                                                                                                                                                                                                                                                                                                  |
| Feature ID      | `N/A — AI delivery workflow`                                                                                                                                                                                                                                                                                                                  |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                             |
| Delivery order  | `147`                                                                                                                                                                                                                                                                                                                                         |
| Dependencies    | `TASK-AI-13` — `MERGED` by PR `#10` at `d0092b9a78c0567a33866ff95848a815d81db2a5`                                                                                                                                                                                                                                                             |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                      |
| Risk            | `LOW`                                                                                                                                                                                                                                                                                                                                         |
| Allowed paths   | `AGENTS.md`; `docs/product-spec/work-items/TASK-AI-14.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/docs/10-ai-collaboration/CLAUDE-START-PROMPT.md`; `scripts/ai/control.ps1`; `scripts/ai/start-work-item.ps1`; `scripts/ai/docker-worker/**`                                       |
| Branch          | `feat/task-ai-14-native-claude-worker-integration`                                                                                                                                                                                                                                                                                             |
| Pull Request    | Pending                                                                                                                                                                                                                                                                                                                                       |

## Business outcome

Enable the autonomous delivery supervisor to leverage local machine-authenticated Claude Code CLI (`claude`) as a primary review fallback and authoring assistant without requiring external API credits or third-party proxies. Fix Windows PowerShell 5.1 pipeline encoding defects ($OutputEncoding UTF-8 without BOM) and StrictMode property resolution in GitHub GraphQL auto-merge mutations.

## Acceptance criteria

- `AC-AI-14-01`: Native Claude Code CLI (`claude`) is invoked with machine-authenticated configuration directory and danger-mode flags.
- `AC-AI-14-02`: PowerShell 5.1 enforces `[System.Text.UTF8Encoding]::new($false)` before piping mutation JSON to `gh api graphql`.
- `AC-AI-14-03`: `Test-ShipDeMergePreflight` resolves `app_id` safely under `Set-StrictMode -Version Latest`.
- `AC-AI-14-04`: Docker worker infrastructure files (`docker-compose.yml`, `Dockerfile`, `start-worker.bat`) are provided for containerized worker runs.
- `AC-AI-14-05`: `AGENTS.md` documents Claude Code CLI local fallback and role separation.
