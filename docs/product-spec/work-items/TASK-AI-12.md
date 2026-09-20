# TASK-AI-12 — Provide startup/scheduling script for autonomous background operation

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-12` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `145` |
| Dependencies | `TASK-AI-11` (merged into `origin/main` as commit `6301e06`; register row 145 records `BLOCKED_DEPENDENCY` until reconciled) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-12.md`, `scripts/ai/install-task-scheduler.ps1`, `scripts/ai/README.md`, `tools/ai-brain/acceptance/ac-12-*.js`, `tools/ai-brain/acceptance/lib/task-scheduler-contract.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-12-impl-d-174548` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 145) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register records `BLOCKED_DEPENDENCY` awaiting automated reconciliation. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 145, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality: `TASK-AI-11` is merged into `origin/main` at commit `6301e06`, while register row 145 still reads `BLOCKED_DEPENDENCY`. `AC-AI-12-03` proves this from the repository rather than from the register.
- `AC-AI-12-01` mechanically compares the `Status` cell of the Control table above against row 145 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

Under `AI-TOOL-15` in `AI-TOOLCHAIN-DECISIONS.md`:
"The final unattended entrypoint is `control.ps1 -Action Resume`; `Supervise` remains a stage-specific recovery action until TASK-AI-12 completes convergence."

`TASK-AI-12` delivers the opt-in Windows Task Scheduler management script `scripts/ai/install-task-scheduler.ps1`. It enables operators to install, query, or remove a scheduled background task that invokes `control.ps1 -Action Resume` periodically (default 15 minutes) and optionally at logon. This guarantees that crash-recovery checkpoints, stale file locks, and interrupted author/review sessions are safely and idempotently reconciled without requiring continuous interactive terminal windows.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-15
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` (row 145)
- `AGENTS.md` § Unit of delivery

## Preconditions and dependencies

- `TASK-AI-11` is merged into `origin/main` (commit `6301e06`), providing preview/dry-run modes and failover exhaustion safety.
- `scripts/ai/control.ps1` supports `-Action Resume` via `Invoke-ShipDeResume`.
- Windows PowerShell 5.1+ or PowerShell Core on Windows with `ScheduledTasks` cmdlets and/or `schtasks.exe`.


## Detailed specification

### Entrypoint and parameters

`scripts/ai/install-task-scheduler.ps1` supports:
- `-Action`: `Install`, `Uninstall`, or `Status` (default: `Status`).
- `-IntervalMinutes`: `[ValidateRange(1, 1440)]` integer interval (default: 15).
- `-Profile`: Optional path to 9Router or ecosystem profile passed through to `control.ps1`.
- `-TaskName`: Task name in Windows Task Scheduler (default: `ShipDe-Autonomous-Supervisor`).
- `-DryRun` / `-Preview`: Switch preventing any mutation to Task Scheduler and displaying planned actions.
- `-Apply`: Required switch to commit mutations for `Install` or `Uninstall`.
- `-AtStartup`: Switch to include user logon trigger on installation.

### Safety and fail-closed rules

1. **Preview by default**: Invoking `Install` or `Uninstall` without `-Apply` outputs `[PREVIEW]` and `[DRY-RUN]` diagnostic banners and exits 0 without modifying system configuration.
2. **Controller validation**: Verifies `scripts/ai/control.ps1` exists relative to `$paths.Main` before registering any task; throws fatal error if missing.
3. **Bounded repetition**: Interval is bounded between 1 and 1440 minutes.
4. **Resilient registration**: Uses PowerShell `ScheduledTasks` cmdlets with fallback to `schtasks.exe`.

## Acceptance criteria matrix

| Test ID | Expected exit | Expected standard output / match |
|---|---|---|
| `AC-AI-12-01` | `0` | `Control status matches register row 145: BLOCKED_DEPENDENCY (declared TASK-AI-12)` |
| `AC-AI-12-02` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-12-03` | `0` | `TASK-AI-11 dependency verified: merged into origin/main for TASK-AI-12` |
| `AC-AI-12-04` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |
| `AC-AI-12-05` | `0` | `TASK_SCHEDULER_CONTRACT_HOLDS: install-task-scheduler.ps1 matches all contract requirements` |
| `AC-AI-12-06` | `1` | `TASK_SCHEDULER_CONTRACT_BROKEN: missing action parameter declaration in param block` |
| `AC-AI-12-07` | `0` | `TASK_SCHEDULER_BANNERS_PRESENT: [PREVIEW], [DRY-RUN], and [TASK-SCHEDULER] banners found in scripts/ai/install-task-scheduler.ps1` |
| `AC-AI-12-08` | `0` | `TASK_SCHEDULER_DRYRUN_EXECUTION_PASS: install-task-scheduler.ps1 preview run executed cleanly with exit 0` |
| `AC-AI-12-09` | `0` | `TASK_SCHEDULER_STATUS_EXECUTION_PASS: install-task-scheduler.ps1 status query executed cleanly with exit 0` |
| `AC-AI-12-10` | `0` | `TASK_SCHEDULER_FAIL_CLOSED_GUARDS_HOLD: controller existence check, interval range check, and apply-guard present` |

## Verification commands

```bash
# 1. Structural documentation validation
python docs/product-spec/scripts/validate_docs.py

# 2. Acceptance test suite
node tools/ai-brain/acceptance/ac-12-01-status-alignment.js
node tools/ai-brain/acceptance/ac-12-02-status-divergence.js
node tools/ai-brain/acceptance/ac-12-03-dependency-merged.js
node tools/ai-brain/acceptance/ac-12-04-dependency-unproven.js
node tools/ai-brain/acceptance/ac-12-05-task-scheduler-contract.js
node tools/ai-brain/acceptance/ac-12-06-task-scheduler-contract-broken.js
node tools/ai-brain/acceptance/ac-12-07-task-scheduler-banners.js
node tools/ai-brain/acceptance/ac-12-08-task-scheduler-dryrun-execution.js
node tools/ai-brain/acceptance/ac-12-09-task-scheduler-status-execution.js
node tools/ai-brain/acceptance/ac-12-10-fail-closed-guards.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Initial specification and implementation for TASK-AI-12: opt-in Windows startup/scheduling script for autonomous background operation. Aligned with delivery register row 145 (`BLOCKED_DEPENDENCY`). |

## Residual limitations

- Scheduled task runs in the security context of the user who registered it; machine-level system service registration is intentionally out of scope.
- Windows Task Scheduler COM registration state updates may experience minor propagation latency (~100ms) on rapid successive unregistration/query sequences.
