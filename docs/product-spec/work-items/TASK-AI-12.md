# TASK-AI-12 — Optional Windows startup/scheduling script: opt-in Windows Task Scheduler integration

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
| Allowed paths | `docs/product-spec/work-items/TASK-AI-12.md`, `scripts/ai/schedule-task.ps1`, `scripts/ai/schedule-task.Tests.ps1`, `scripts/ai/README.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-12-impl-e-191759` |
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
- The dependency is satisfied in Git reality: `TASK-AI-11` is merged into `origin/main` at commit `6301e06`, while register row 145 still reads `BLOCKED_DEPENDENCY`.

## Business outcome

Operators running the Ship Dễ autonomous AI workflow controller (`scripts/ai/control.ps1`) require an opt-in, non-intrusive mechanism to schedule or automate pipeline execution (such as `control.ps1 -Action Resume` or `Supervise`) through Windows Task Scheduler.
Crucially, this integration must be strictly opt-in: the mere presence of the script or cloning the repository must never configure, modify, or register any scheduled task.
Furthermore, the registration must be completely reversible and removable at any time through a dedicated removal action without leaving residual tasks or registry artifacts.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` (row 145)
- `docs/product-spec/work-items/TASK-AI-09.md` (line 128)
- `docs/product-spec/work-items/TASK-AI-11.md`
- `AGENTS.md` § Unit of delivery

## Preconditions and dependencies

- `TASK-AI-11` is merged into `origin/main` (commit `6301e06`), providing preview/dry-run mode contracts and failover tests.
- Windows PowerShell 5.1 host environment with `ScheduledTasks` module (`Get-ScheduledTask`, `Register-ScheduledTask`, `Unregister-ScheduledTask`).
- `scripts/ai/common.ps1` helper module and `scripts/ai/control.ps1` controller.

## Author boundary

`GEMINI` author assignment. Low-risk, bounded automation script and tests under `scripts/ai/` and specification document under `docs/product-spec/work-items/TASK-AI-12.md`. Does not mutate core application code, database schema, credentials, or production APIs.


## In scope

- Implementation of `scripts/ai/schedule-task.ps1` with actions:
  - `Status` (default, read-only: reports registration state and next steps).
  - `Register` (preview-only unless `-Apply` is provided: registers scheduled task in Windows Task Scheduler).
  - `Unregister` (preview-only unless `-Apply` is provided, also aliased by `-Remove`: cleanly removes scheduled task).
  - `Test` (executes self-tests).
- Support for triggers: `Daily`, `Logon`, `Hourly`.
- Comprehensive test suite `scripts/ai/schedule-task.Tests.ps1` verifying opt-in guarantees, preview safety, creation, querying, clean removal, idempotency, and parameter safety.
- Documentation in `scripts/ai/README.md`.

## Out of scope

- Automatic background scheduling during npm install, git checkout, or machine boot without explicit operator consent.
- Cross-machine remote task scheduling or Active Directory Group Policy management.
- Core product application changes, database migrations, or web UI alterations.

## Business rules and edge cases

- `BR-AI-12-01`: Opt-in by default. Mere presence of `schedule-task.ps1` does not register any task. Default invocation (`-Action Status`) is read-only.
- `BR-AI-12-02`: Preview safety. `-Action Register` and `-Action Unregister` without `-Apply` print planned actions and exit 0 without mutating Task Scheduler.
- `BR-AI-12-03`: Removability. `-Action Unregister -Apply` (and `-Remove -Apply`) completely removes the scheduled task from Windows Task Scheduler.
- `BR-AI-12-04`: Idempotent removal. Unregistering an unmanaged or already deleted task succeeds gracefully without throwing errors.
- `BR-AI-12-05`: Non-elevated compatibility. Default trigger (`Daily`) can be created without administrator elevation. If `Logon` trigger is requested without elevation on systems requiring admin, the script provides a clear diagnostic message.

## UI states

CLI Console States:
- `PREVIEW`: Outputs planned scheduled task parameters with `PREVIEW ONLY` notification.
- `STATUS_NOT_REGISTERED`: Outputs task not registered with instructions to register.
- `STATUS_REGISTERED`: Outputs task state, path, trigger, and instructions to unregister.
- `APPLIED_REGISTERED`: Confirms successful task creation.
- `APPLIED_REMOVED`: Confirms successful task removal.

## API, event and data impact

- No external HTTP API or backend schema changes.
- Modifies Windows Task Scheduler local store only when explicitly commanded with `-Apply`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-12-01` | Precondition check | Test task does not exist initially | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-02` | Opt-in script presence | Mere presence of script does not register task | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-03` | Status unregistered | Querying status on unmanaged task returns `Registered = False` | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-04` | Register preview | `-Action Register` without `-Apply` returns `PREVIEW_ONLY` without mutating | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-05` | Unregister preview | `-Action Unregister` without `-Apply` returns `PREVIEW_ONLY` without mutating | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-06` | Register apply | `-Action Register -Apply` creates scheduled task with `State = 'Ready'` | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-07` | Status registered | Querying status on registered task returns `Registered = True` and `State = 'Ready'` | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-08` | Unregister preview with task | Unregister preview on existing task does not delete task | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-09` | Unregister apply | `-Action Unregister -Apply` cleanly removes task from Windows Task Scheduler | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-10` | Idempotent unregister | Removing absent task returns `Status = 'NOT_FOUND'` without error | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-11` | Remove alias switch | `-Remove -Apply` successfully removes registered task | `schedule-task.Tests.ps1` PASS |
| `AC-AI-12-12` | Hourly trigger option | Registering with `-Trigger Hourly` succeeds and unregisters cleanly | `schedule-task.Tests.ps1` PASS |

## Verification commands

```bash
# 1. Structural documentation validation
python docs/product-spec/scripts/validate_docs.py

# 2. Windows Task Scheduler integration tests
powershell -ExecutionPolicy Bypass -File scripts/ai/schedule-task.Tests.ps1

# 3. Schedule task self-test action
powershell -ExecutionPolicy Bypass -File scripts/ai/schedule-task.ps1 -Action Test
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification and implementation authored for TASK-AI-12: Optional Windows startup/scheduling script. Control table status aligned to authoritative delivery register row 145 (`BLOCKED_DEPENDENCY`). |

## Residual limitations

- **Administrator elevation for logon triggers:** Registering a task with `-Trigger Logon` requires Administrator elevation on Windows systems where non-elevated users cannot create logon-triggered tasks. Standard users can use the default `-Trigger Daily` or execute PowerShell as Administrator.
