# TASK-AI-06 — Deterministic AO supervisor and AgentRouter runtime

## Control

| Field           | Value                                                                                                                                               |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-06`                                                                                                                                        |
| Feature ID      | `N/A`                                                                                                                                               |
| Status          | `READY_FOR_CODEX`                                                                                                                                   |
| Delivery order  | `139`                                                                                                                                               |
| Dependencies    | `TASK-AI-05` merged through PR #7 as `a344b69af3c1c9dc4469d0ccdefe15c130bb2188`                                                                     |
| Assigned author | `GEMINI` (requires architectural decisions for supervisor design and AO integration)                                                                |
| Risk            | `HIGH`                                                                                                                                              |
| Allowed paths   | `scripts/ai/*.ps1`; `docs/product-spec/work-items/TASK-AI-*.md`; `docs/product-spec/docs/10-ai-collaboration/*.md`; `tools/ecosystem-manifest.json` |
| Reviewer        | `Codex — fresh independent task using Sol High; no routed or self-review verdict`                                                                   |
| Branch          | `feat/task-ai-06-orchestrator-supervisor`                                                                                                           |
| Pull Request    | `#9`                                                                                                                                                |

## Scope split rationale

The deterministic supervisor is split into ordered governed Work Items. TASK-AI-06 owns the runnable core, the governed AgentRouter-backed AO launcher, current AO CLI integration, durable checkpointing, and automatic CI/review routing. Follow-up Work Items harden or extend this foundation:

Completing TASK-AI-06 does not mean the end-to-end orchestrator is complete. The automation is complete only after TASK-AI-07 through TASK-AI-12 satisfy the final `Resume` acceptance case below.

| Work Item ID | Scope                                                           | Dependency   |
| ------------ | --------------------------------------------------------------- | ------------ |
| `TASK-AI-06` | AO/AgentRouter launch, worker spawn, checkpoint, CI/review loop | `TASK-AI-05` |
| `TASK-AI-07` | Cross-harness worker failover after AgentRouter exhaustion      | `TASK-AI-06` |
| `TASK-AI-08` | Extended CI/review diagnostics and bounded repair policy        | `TASK-AI-07` |
| `TASK-AI-09` | Full checkpoint persistence and restart recovery                | `TASK-AI-08` |
| `TASK-AI-10` | Permission allowlist and security hardening                     | `TASK-AI-09` |
| `TASK-AI-11` | Preview/DryRun modes and comprehensive tests                    | `TASK-AI-10` |
| `TASK-AI-12` | Optional Windows startup/scheduling script                      | `TASK-AI-11` |

## Business outcome

The operator launches AO through the existing localhost AgentRouter profile and runs one `Supervise` action. The deterministic supervisor discovers prepared remote Work Items, spawns the assigned author through the supported AO CLI, monitors the same session and worktree, routes CI/review corrections, triggers independent Codex review, persists checkpoints, and stops only at exact-HEAD PASS for human merge or a genuine fail-closed blocker.

## Source references

- `AGENTS.md` — human-only merge, protected `main`, isolated worktrees, fail-closed behavior.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — state flow and role separation.
- `docs/product-spec/docs/10-ai-collaboration/GEMINI-START-PROMPT.md` — implementation author prompt template.
- `docs/product-spec/docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md` — 9Router author prompt template.
- `scripts/ai/control.ps1` — existing controller patterns to extend.
- Agent Orchestrator canonical source: `https://github.com/Untrivial-ai/agent-orchestrator`; installed version `0.12.10`; health check `ao status --json`.
- AO CLI documentation at `C:/Users/gumac/.ao/data/skills/using-ao/`.

## Preconditions and dependencies

- PR #7 (TASK-AI-05) is human-merged.
- AO CLI is installed and `ao` command is available.
- `%USERPROFILE%\.claude\settings.json` routes Claude to `http://localhost:20128/v1`.
- `control.ps1 -Action Supervise` can invoke `scripts/ai/start-agent-orchestrator.ps1` automatically when AO is stopped, stale, or running outside the governed AgentRouter profile. The launcher verifies and records runtime metadata without storing its token.
- The prepared Work Item exists on a normal remote `feat/*` or `fix/*` ref and is `READY_FOR_AUTHOR` there.
- `tools/ecosystem-manifest.json` records AO as a separate external orchestration runtime. AO is not counted as one of the adopted repositories or providers.

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

### 1. Governed AO and AgentRouter startup

- Verify the existing `.claude` profile points only to the localhost AgentRouter endpoint on port 20128.
- Start AgentRouter when its installed command is available but its loopback port is stopped.
- Launch or explicitly restart AO with `CLAUDE_CONFIG_DIR=%USERPROFILE%\.claude`.
- Let `Supervise` replace an absent, stale, or incorrectly launched AO runtime automatically; no profile-switching step is required from the operator.
- Remove inherited direct Anthropic environment overrides before launching AO.
- Persist only runtime metadata; never persist or print authentication tokens.

### 2. Delivery register automation

- Discover normal prepared remote feature/fix refs using the established controller function.
- Select only a Work Item marked `READY_FOR_AUTHOR` on its own prepared remote branch.
- Validate Work Item file exists and contains required fields

### 3. Automatic prompt generation

- Generate a bounded continuation prompt naming the Work Item, branch, source document, allowed-path contract and governed completion behavior.
- Require the worker to read the complete repository instructions and author template from its own worktree.
- Deliver the prompt directly through `ao spawn --prompt`; do not use the clipboard.

### 4. AO worker spawning

- Use the current AO command contract: `ao spawn --kind worker --branch ... --harness ...`.
- Use `agy`, then `gemini`, for a Gemini-assigned Work Item; use router-backed `claude-code` only for a `9ROUTER` assignment.
- Never use removed commands or flags such as `ao session spawn`, `--worktree`, or `--prompt-file`.
- Record the session ID for monitoring

### 5. Monitoring and lifecycle loop

- Poll exact session state using `ao session get <id> --json`.
- Detect idle, active, completed, or failed states
- Bounded inactivity timer (default 10 minutes idle triggers nudge)
- Stop after three consecutive unknown states or a completed worker that did not create its governed Pull Request; never poll forever.
- Log state transitions with timestamps

### 6. Inactivity handling (first tier only)

- Nudge the existing session with a reminder prompt after inactivity timeout
- One nudge attempt before marking as stalled
- Report a genuine stall only after the bounded nudge fails.

### 7. CI and independent review routing

- Detect the Work Item's open PR without consuming another row.
- Permit a bootstrap review to select one exact open PR with `-PullRequestNumber`; never guess when several implementation PRs are open.
- Route each failed exact HEAD back to the same worker once.
- Trigger AO's configured Codex reviewer only after required CI is green.
- Route durable exact-HEAD `CHANGES_REQUIRED` findings back to the worker once per HEAD.
- Stop at durable exact-HEAD `PASS`; never merge.

### 8. State file checkpointing

- Write supervisor state to `$HandoffRoot/supervisor-state.json`
- Include: Work Item ID, session ID, branch, state, last activity timestamp, nudge count
- Allow restart to resume from checkpoint

### 9. Human notification

- Print clear status when human action is needed
- Never auto-merge regardless of review verdict
- Notify when CI is green and Codex review passes

### 10. Deterministic self-tests

- Startup assertions for AO availability
- Startup assertions for register parsing
- Startup assertions for state file round-trip

## Out of scope (deferred to follow-up Work Items)

- Cross-harness worker replacement after all AgentRouter routes are exhausted (TASK-AI-07).
- Rich CI log diagnosis and bounded repair budgeting beyond one dispatch per exact HEAD (TASK-AI-08).
- Recovery from deleted/corrupted AO state or an externally removed worktree (TASK-AI-09).
- Permission allowlist enforcement (TASK-AI-10)
- Preview/DryRun modes and comprehensive tests (TASK-AI-11)
- Windows startup/scheduling script (TASK-AI-12)

## Business rules

- `AI-SUP-01`: The supervisor is a deterministic PowerShell loop, not an LLM agent.
- `AI-SUP-02`: Only one Work Item is active at a time; parallel orchestration is not supported.
- `AI-SUP-03`: The supervisor uses only supported public AO CLI commands; it does not modify AO internals.
- `AI-SUP-04`: Implementation/test failures are NOT provider failures; they return to the author.
- `AI-SUP-05`: The supervisor never auto-merges; human merge is always required.
- `AI-SUP-06`: AO uses the existing `.claude` AgentRouter profile for unattended orchestration; the direct `.claude-orchestrator` profile is not used by unattended mode.
- `AI-SUP-07`: AgentRouter owns Claude/provider quota fallback below AO; surfaced exhaustion means all approved routes failed and the supervisor stops fail-closed.
- `AI-SUP-08`: Inactivity timeout is configurable (default 10 minutes).
- `AI-SUP-09`: Maximum 1 nudge attempt per inactivity window before reporting stalled.
- `AI-SUP-10`: The supervisor respects existing controller gates (CI must pass, Codex must approve).
- `AI-SUP-11`: Starting `Supervise` repairs AO runtime drift by relaunching AO through AgentRouter before consuming a Work Item.
- `AI-SUP-12`: Manual bootstrap review requires an exact PR number when more than one implementation PR is open.
- `AI-SUP-13`: AO is an external control layer with pinned provenance and health check; it is never silently counted as an adopted repository/provider.

## Acceptance matrix

| AC/Test ID | Scenario                               | Expected result                                                                  | Evidence required               |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| `AC-AI-42` | AO CLI not available                   | Supervisor stops with `Missing required command: ao`                             | Deterministic assertion         |
| `AC-AI-43` | No prepared remote Work Item           | Supervisor reports that no prepared remote Work Item exists                      | Deterministic assertion         |
| `AC-AI-44` | Valid dependency-ready Work Item found | Supervisor generates prompt and spawns AO worker                                 | Log output and session ID       |
| `AC-AI-45` | Supported AO spawn contract            | Uses `ao spawn`; removed subcommands/flags are absent                            | Deterministic assertion         |
| `AC-AI-46` | AO session monitoring                  | State transitions logged with timestamps                                         | Log output                      |
| `AC-AI-47` | Session idle for 10+ minutes           | Supervisor nudges session once                                                   | Nudge log and session state     |
| `AC-AI-48` | Session completes successfully         | Supervisor reports completion and awaits CI/review                               | Log output                      |
| `AC-AI-49` | State file written and readable        | Checkpoint survives supervisor restart                                           | State file round-trip assertion |
| `AC-AI-50` | CI green and review PASS               | Supervisor notifies human "Ready for merge"                                      | Notification output             |
| `AC-AI-51` | Never auto-merge                       | No `gh pr merge` command in any code path                                        | Code audit                      |
| `AC-AI-52` | Windows PowerShell 5.1 compatible      | All startup assertions pass on Windows PowerShell 5.1                            | CI validation                   |
| `AC-AI-53` | AO starts through AgentRouter          | Runtime marker matches `.claude` and localhost port 20128                        | Launcher output and marker      |
| `AC-AI-54` | CI failure on exact HEAD               | Same worker receives one repair instruction for that HEAD                        | Checkpoint and AO activity      |
| `AC-AI-55` | CI green without verdict               | AO triggers configured independent Codex review                                  | AO review record                |
| `AC-AI-56` | Exact-HEAD Codex PASS                  | Supervisor stops for human merge without merge invocation                        | Durable verdict and code audit  |
| `AC-AI-57` | AO stopped, stale, or on wrong profile | `Supervise` relaunches AO through `.claude` and AgentRouter                      | Launcher output and live PID    |
| `AC-AI-58` | Multiple implementation PRs are open   | Explicit `-PullRequestNumber` selects exactly one review PR                      | Deterministic PR filter         |
| `AC-AI-59` | AO provenance is inspected             | Manifest identifies canonical source, version and health check outside `adopted` | Manifest validation             |

## Deferred final automation acceptance case

TASK-AI-07 through TASK-AI-12 must converge on one operator entrypoint:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume
```

From that single invocation, the controller must select the dependency-ready Work Item, compile the minimum tool profile from the governed manifest, create or reuse the assigned branch/worktree, invoke the correct worker, implement and test, open the PR, monitor and repair CI, request an independent exact-HEAD Codex review, return `CHANGES_REQUIRED` to the same worker, stop for human merge after durable `PASS`, and reconcile `main` before selecting the next Work Item.

The operator intervenes only for initial credential/login, destructive actions, conflicting or missing business rules, and Pull Request merge. No clipboard prompt transfer, manual quota watching, or manual stalled-agent polling is part of the accepted flow.

TASK-AI-11 must simulate direct-Claude quota exhaustion, provider `429`/`5xx`, a stalled agent, CI failure, Codex `CHANGES_REQUIRED`, machine restart, and a merged-but-unsynchronized PR. TASK-AI-12 must make the controller and AO daemon restartable on Windows while activating only the profile required by the current Work Item.

## Verification commands

From a clean checkout:

- Parse every `scripts/ai/*.ps1` file through the PowerShell AST parser in the contract job.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Status` and confirm all startup assertions pass.
- Run `python docs/product-spec/scripts/validate_docs.py`.
- Validate that the Pull Request body contains every required contract heading and `Review status: READY_FOR_CODEX`.
- With multiple open PRs, run `control.ps1 -Action Review -PullRequestNumber 9` and verify the immutable fetched HEAD matches PR #9.
- Run `pnpm format:check`.
- Run `pnpm security:secrets`.
- Run `git diff --check origin/main...HEAD`.

## Codex review record

| Review round | Commit    | Verdict | Findings resolved |
| ------------ | --------- | ------- | ----------------- |
| 1            | `pending` | Pending | N/A               |

## Residual limitations

- AgentRouter performs provider/model fallback inside one AO-facing endpoint; replacing the worker with another AO harness after every approved route is exhausted remains TASK-AI-07.
- The supervisor dispatches CI/review correction once per exact HEAD; richer diagnosis and retry budgeting remain TASK-AI-08.
- Checkpoint restart is included; recovery from externally deleted AO sessions/worktrees remains TASK-AI-09.
- Permission allowlist enforcement is deferred to TASK-AI-10.
