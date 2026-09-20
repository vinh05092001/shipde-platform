# TASK-AI-11 — Preview/dry-run mode contract and bounded failover recovery

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-11` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `144` |
| Dependencies | `TASK-AI-10` (merged into `origin/main` as commit `d804c27`; register row 144 records `BLOCKED_DEPENDENCY` until reconciled) |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-11.md`, `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/ac-11-*.js`, `tools/ai-brain/acceptance/lib/preview-dryrun-contract.js`, `tools/ai-brain/acceptance/lib/failover-exhaustion-contract.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-11-impl-214438` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 144) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register records `BLOCKED_DEPENDENCY` awaiting automated reconciliation. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 144, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality: `TASK-AI-10` is merged into `origin/main` at commit `d804c27`, while register row 144 still reads `BLOCKED_DEPENDENCY`. `AC-AI-11-03` proves this from the repository rather than from the register.
- `AC-AI-11-01` mechanically compares the `Status` cell of the Control table above against row 144 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

Operators running `scripts/ai/control.ps1 -Action Supervise` require deterministic visibility into what the supervisor would do without mutating git worktrees, writing persistent checkpoints, or spawning autonomous worker sessions. Furthermore, the cross-harness failover architecture introduced in `TASK-AI-07` requires an explicit, bounded failover budget so that when multiple workers fail successively, the supervisor does not enter an unbounded thrashing loop or destroy existing worktrees. Instead, it terminates fail-closed with diagnostic logs while preserving the author branch intact.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-18
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` (row 144)
- `AGENTS.md` § Unit of delivery

## Preconditions and dependencies

- `TASK-AI-10` is merged into `origin/main` (commit `d804c27`), providing security hardening and permission allowlists.
- `control.ps1` supervisor loop and state normalization functions are available.

## Author boundary

- Changes are strictly bounded to `scripts/ai/control.ps1`, `docs/product-spec/work-items/TASK-AI-11.md`, and acceptance test modules under `tools/ai-brain/acceptance/`.
- No application business logic, carrier integration, or database migrations are touched.

## In scope

1. **Preview / DryRun CLI Surface**:
   - Declare `[switch]$Preview` and `[switch]$DryRun` in the top-level param block of `scripts/ai/control.ps1`.
   - Pass `$Preview` and `$DryRun` into `Invoke-ShipDeSupervise`.
   - Emit observable `[PREVIEW]` and `[SUPERVISOR][DRY-RUN]` banners.
   - Early-return `PREVIEW` status before any state-mutating actions, worktree manipulation, checkpoint writing, or worker spawning occur.
2. **Bounded Failover Recovery Budget**:
   - Declare `[int]$MaxFailovers = 3` in the top-level param block of `scripts/ai/control.ps1` with validation range `[ValidateRange(1, [int]::MaxValue)]`.
   - Wire `$MaxFailovers` into `Invoke-ShipDeSupervisorLoop`.
   - Check `[int]$State.FailoverCount -ge $MaxFailovers` at the entry of the supervisor loop.
   - When exceeded, emit `[FAIL-CLOSED]` log specifying current count and maximum limit, preserve the branch, and throw to terminate session safely.
3. **Acceptance Test Suite**:
   - Invariant and negative proof tests (`ac-11-01` through `ac-11-10`) with shared contract modules in `tools/ai-brain/acceptance/lib/`.

## Out of scope

- Runtime integration tests that execute external AO processes or GitHub API network calls.
- Automated registration status updates in `FEATURE-DELIVERY-REGISTER.csv`.

## Business rules and edge cases

- `AI-11-R01`: When `$Preview` or `$DryRun` is active, no git worktree or checkpoint mutation shall occur.
- `AI-11-R02`: The default failover limit is 3, ensuring unconfigured runs are bounded.
- `AI-11-R03`: When the failover budget is exhausted, the active branch is preserved untouched and never deleted.
- `AI-11-R04`: Failover exhaustion terminates fail-closed via an explicit throw with a `[FAIL-CLOSED]` banner.

## UI states

N/A — control plane CLI script and automation harness.

## API, event and data impact

No REST/GraphQL API or database schema changes. Extends PowerShell CLI parameter interface of `scripts/ai/control.ps1`.

## Acceptance matrix

| Row | Exit | Output |
|---|---|---|
| `AC-AI-11-01` | `0` | `Control status matches register row 144: BLOCKED_DEPENDENCY (declared TASK-AI-11)` |
| `AC-AI-11-02` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-11-03` | `0` | `TASK-AI-10 dependency verified: merged into origin/main for TASK-AI-11` |
| `AC-AI-11-04` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |
| `AC-AI-11-05` | `0` | `PREVIEW_DRYRUN_CONTRACT_HOLDS: Preview/DryRun surface present in scripts/ai/control.ps1` |
| `AC-AI-11-06` | `1` | `PREVIEW_CONTRACT_BROKEN: a [switch]$Preview parameter in the top-level param block` |
| `AC-AI-11-07` | `0` | `FAILOVER_EXHAUSTION_CONTRACT_HOLDS: bounded failover exhaustion present in scripts/ai/control.ps1` |
| `AC-AI-11-08` | `1` | `FAILOVER_EXHAUSTION_CONTRACT_BROKEN: a guard that terminates the session when failover count exceeds the bound` |
| `AC-AI-11-09` | `0` | `PREVIEW_DRYRUN_BANNERS_PRESENT: [PREVIEW] and [SUPERVISOR][DRY-RUN] banners found in scripts/ai/control.ps1` |
| `AC-AI-11-10` | `0` | `FAIL_CLOSED_GUARDS_HOLD: exhaustion stop, Preview if-guard, DryRun if-guard, and [FAIL-CLOSED] tag present` |

## Verification commands

```bash
# 1. Structural documentation validation
python docs/product-spec/scripts/validate_docs.py

# 2. Invariant and negative proof acceptance tests
node tools/ai-brain/acceptance/ac-11-01-status-alignment.js
node tools/ai-brain/acceptance/ac-11-02-status-divergence.js
node tools/ai-brain/acceptance/ac-11-03-dependency-merged.js
node tools/ai-brain/acceptance/ac-11-04-dependency-unproven.js
node tools/ai-brain/acceptance/ac-11-05-preview-contract.js
node tools/ai-brain/acceptance/ac-11-06-preview-contract-broken.js
node tools/ai-brain/acceptance/ac-11-07-failover-exhaustion-contract.js
node tools/ai-brain/acceptance/ac-11-08-failover-exhaustion-broken.js
node tools/ai-brain/acceptance/ac-11-09-preview-dryrun-banners.js
node tools/ai-brain/acceptance/ac-11-10-fail-closed-guards.js

# 3. Supervisor behavioral self-tests
powershell -ExecutionPolicy Bypass -File scripts/ai/control.ps1 -Action Test
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-11: Preview/dry-run mode contract and bounded failover recovery. Control table status aligned to authoritative delivery register row 144 (`BLOCKED_DEPENDENCY`). |

## Acceptance matrix validation

Written `2026-09-19`. Every `node` row was executed against this branch: the invariant rows produced exit `0` with their stated string and the negative proofs produced exit `1` with their stated string. Each negative proof reads a real repository file, proves the untouched source is accepted as a CONTROL, tampers an in-memory copy, and asserts the same shared rule rejects it. Each negative proof exits `2`, not `0`, when it cannot detect its tamper, and exits `2`, not `1`, when its real source is missing.

## Residual limitations

- **The Preview/DryRun guards are structural, not behavioral.** The acceptance tests prove the switches and banners exist in the source; they do not execute the supervisor against live worker harnesses. A full live worker integration test is out of scope for unit contract verification.
- **The failover exhaustion guard is checked at loop entry.** If the `FailoverCount` is incremented during the loop body the guard will fire on the next iteration, not mid-poll. This is intentional: the supervisor's poll loop is a single-threaded state machine and a mid-poll interrupt would leave the checkpoint in an inconsistent state.
- **`$MaxFailovers` defaults to 3.** The default is chosen so that an unconfigured supervisor still has a finite budget; operators who need more retries must pass `-MaxFailovers N` explicitly.
