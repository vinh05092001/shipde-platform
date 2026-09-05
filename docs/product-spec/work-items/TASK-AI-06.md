# TASK-AI-06 — Deterministic orchestrator supervisor (core slice)

## Control

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-06`                                                                                                                                        |
| Feature ID      | `N/A`                                                                                                                                               |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                  |
| Delivery order  | `139`                                                                                                                                               |
| Dependencies    | `TASK-AI-05` merged through PR #7 as `a344b69`                                                                                                      |
| Assigned author | `GEMINI` (requires architectural decisions for supervisor design and AO integration)                                                                |
| Risk            | `HIGH`                                                                                                                                              |
| Allowed paths   | `scripts/ai/*.ps1`; `docs/product-spec/work-items/TASK-AI-*.md`; `docs/product-spec/docs/10-ai-collaboration/*.md`; `tools/ecosystem-manifest.json` |
| Reviewer        | `Codex — fresh independent task (Sol High primary; Luna only when Sol unavailable)`                                                                 |
| Branch          | `feat/task-ai-06-orchestrator-supervisor`                                                                                                           |
| Pull Request    | `TBD`                                                                                                                                               |

## Scope split rationale

The complete deterministic supervisor system is split into ordered governed Work Items. This Work Item (TASK-AI-06) implements the smallest end-to-end automation slice that removes human copy/paste from the normal flow. Follow-up Work Items extend this foundation:

| Work Item ID | Scope                                                      | Dependency   |
| ------------ | ---------------------------------------------------------- | ------------ |
| `TASK-AI-06` | Core supervisor loop, AO spawn, auto-prompt, basic monitor | `TASK-AI-05` |
| `TASK-AI-07` | Provider failover chain and bounded recovery               | `TASK-AI-06` |
| `TASK-AI-08` | Automatic CI/review routing and repair                     | `TASK-AI-07` |
| `TASK-AI-09` | Full checkpoint persistence and restart recovery           | `TASK-AI-08` |
| `TASK-AI-10` | Permission allowlist and security hardening                | `TASK-AI-09` |
| `TASK-AI-11` | Preview/DryRun modes and comprehensive tests               | `TASK-AI-10` |
| `TASK-AI-12` | Optional Windows startup/scheduling script                 | `TASK-AI-11` |

## Business outcome

The operator can run a single `Supervise` action that automatically: reads the delivery register, selects the next dependency-ready Work Item, generates the implementation prompt, spawns an isolated AO worker session, monitors progress, and notifies when human action is needed. No manual prompt copying, no routine progress monitoring, no manual recovery of ordinary stalled sessions.

## Source references

- `AGENTS.md` — human-only merge, protected `main`, isolated worktrees, fail-closed behavior.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — state flow and role separation.
- `docs/product-spec/docs/10-ai-collaboration/GEMINI-START-PROMPT.md` — implementation author prompt template.
- `docs/product-spec/docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md` — 9Router author prompt template.
- `scripts/ai/control.ps1` — existing controller patterns to extend.
- AO CLI documentation at `C:/Users/gumac/.ao/data/skills/using-ao/`.

## Preconditions and dependencies

- PR #7 (TASK-AI-05) is human-merged.
- AO CLI is installed and `ao` command is available.
- At least one provider (Claude Code, Gemini CLI, or 9Router) is configured.
- The delivery register has at least one `READY_FOR_AUTHOR` or `BLOCKED_DEPENDENCY` Work Item with met dependencies.

## Author boundary

This is a `GEMINI`-assigned Work Item because it involves:

- Designing the supervisor state machine and control loop
- Integrating with AO CLI for worker spawning and session management
- Structured monitoring using AO JSON outputs
- Checkpoint file format design

The implementation must:

- Extend `scripts/ai/control.ps1` (not replace it)
- Work on Windows PowerShell 5.1
- Never auto-merge
- Never install, remove, scan, or upgrade machine tools
- Stop fail-closed on unrecoverable errors

## In scope

### 1. AO readiness check

- Verify `ao` command is available
- Verify project is registered with AO
- Verify at least one provider is configured and responsive

### 2. Delivery register automation

- Read `FEATURE-DELIVERY-REGISTER.csv` from current branch
- Identify the next dependency-ready Work Item (status `READY_FOR_AUTHOR` or `BLOCKED_DEPENDENCY` with all dependencies `MERGED`)
- Validate Work Item file exists and contains required fields

### 3. Automatic prompt generation

- Read the Work Item document
- Extract assigned author, allowed paths, acceptance criteria, verification commands
- Read the appropriate prompt template (`GEMINI-START-PROMPT.md` or `NINEROUTER-START-PROMPT.md`)
- Substitute placeholders (`<WORK_ITEM_ID>`, `<BRANCH>`)
- Deliver the prompt directly to the AO worker (no clipboard)

### 4. AO worker spawning

- Create or switch to the feature branch
- Spawn an isolated AO worker session for the assigned author type
- Pass the generated prompt to the worker
- Record the session ID for monitoring

### 5. Basic monitoring loop

- Poll session state every 30 seconds using `ao session list --json`
- Detect idle, active, completed, or failed states
- Bounded inactivity timer (default 10 minutes idle triggers nudge)
- Log state transitions with timestamps

### 6. Inactivity handling (first tier only)

- Nudge the existing session with a reminder prompt after inactivity timeout
- One nudge attempt before marking as stalled
- Report stalled sessions to the operator

### 7. State file checkpointing

- Write supervisor state to `$HandoffRoot/supervisor-state.json`
- Include: Work Item ID, session ID, branch, state, last activity timestamp, nudge count
- Allow restart to resume from checkpoint

### 8. Human notification

- Print clear status when human action is needed
- Never auto-merge regardless of review verdict
- Notify when CI is green and Codex review passes

### 9. Deterministic self-tests

- Startup assertions for AO availability
- Startup assertions for register parsing
- Startup assertions for state file round-trip

## Out of scope (deferred to follow-up Work Items)

- Provider failover chain (TASK-AI-07)
- Automatic CI/review routing and repair (TASK-AI-08)
- Full restart recovery and duplicate prevention (TASK-AI-09)
- Permission allowlist enforcement (TASK-AI-10)
- Preview/DryRun modes and comprehensive tests (TASK-AI-11)
- Windows startup/scheduling script (TASK-AI-12)

## Business rules

- `AI-SUP-01`: The supervisor is a deterministic PowerShell loop, not an LLM agent.
- `AI-SUP-02`: Only one Work Item is active at a time; parallel orchestration is not supported.
- `AI-SUP-03`: The supervisor polls AO session state; it does not modify AO internals.
- `AI-SUP-04`: Implementation/test failures are NOT provider failures; they return to the author.
- `AI-SUP-05`: The supervisor never auto-merges; human merge is always required.
- `AI-SUP-06`: Checkpoints are written after every state transition.
- `AI-SUP-07`: The supervisor stops fail-closed on: missing AO, no providers, malformed register, missing Work Item file.
- `AI-SUP-08`: Inactivity timeout is configurable (default 10 minutes).
- `AI-SUP-09`: Maximum 1 nudge attempt per inactivity window before reporting stalled.
- `AI-SUP-10`: The supervisor respects existing controller gates (CI must pass, Codex must approve).

## Acceptance matrix

| AC/Test ID | Scenario                                 | Expected result                                              | Evidence required               |
| ---------- | ---------------------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `AC-AI-42` | AO CLI not available                     | Supervisor stops with `Missing required command: ao`         | Deterministic assertion         |
| `AC-AI-43` | No dependency-ready Work Item            | Supervisor reports "No dependency-ready Work Item" and stops | Deterministic assertion         |
| `AC-AI-44` | Valid dependency-ready Work Item found   | Supervisor generates prompt and spawns AO worker             | Log output and session ID       |
| `AC-AI-45` | Prompt template placeholder substitution | `<WORK_ITEM_ID>` and `<BRANCH>` replaced correctly           | Generated prompt inspection     |
| `AC-AI-46` | AO session monitoring                    | State transitions logged with timestamps                     | Log output                      |
| `AC-AI-47` | Session idle for 10+ minutes             | Supervisor nudges session once                               | Nudge log and session state     |
| `AC-AI-48` | Session completes successfully           | Supervisor reports completion and awaits CI/review           | Log output                      |
| `AC-AI-49` | State file written and readable          | Checkpoint survives supervisor restart                       | State file round-trip assertion |
| `AC-AI-50` | CI green and review PASS                 | Supervisor notifies human "Ready for merge"                  | Notification output             |
| `AC-AI-51` | Never auto-merge                         | No `gh pr merge` command in any code path                    | Code audit                      |
| `AC-AI-52` | Windows PowerShell 5.1 compatible        | All startup assertions pass on Windows PowerShell 5.1        | CI validation                   |

## Verification commands

From a clean checkout:

- Parse every `scripts/ai/*.ps1` file through the PowerShell AST parser in the contract job.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Status` and confirm all startup assertions pass.
- Run `python docs/product-spec/scripts/validate_docs.py`.
- Run `pnpm format:check`.
- Run `pnpm security:secrets`.
- Run `git diff --check origin/main...HEAD`.

## Codex review record

| Review round | Commit    | Verdict | Findings resolved |
| ------------ | --------- | ------- | ----------------- |
| 1            | `pending` | Pending | N/A               |

## Residual limitations

- This slice does not implement automatic provider failover (deferred to TASK-AI-07).
- This slice does not implement automatic CI/review repair (deferred to TASK-AI-08).
- Full restart recovery without duplication is deferred to TASK-AI-09.
- Permission allowlist enforcement is deferred to TASK-AI-10.
