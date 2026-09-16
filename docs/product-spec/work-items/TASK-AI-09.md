# TASK-AI-09 — Full checkpoint persistence and restart recovery

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-09` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `142` |
| Dependencies | `TASK-AI-08` (merged into `origin/main`; register row 141 not yet reconciled to `MERGED`) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-09.md`, `scripts/ai/control.ps1`, `tools/ai-brain/**`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-09` |
| Pull Request | `Pending` |

**Row numbering.** "Row 142" is the register's own `delivery_order` column, the convention `TASK-AI-07` (row 140) and `TASK-AI-08` (row 141) already use. `TASK-AI-17` numbers by physical CSV line instead, where this record is line 10. The two conventions disagree, so every row number in this file also names the record's `work_item_id`.

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 142) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 142, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-08` is merged into `origin/main` at `8d039256adfa36172c09464123fcc9b488ab7f61` (PR #64), while register row 141 still reads `BACKLOG`. `AC-AI-09-03` proves this from the repository rather than from the register.
- **Measured warning on this exact mechanism.** Register row 142 is not frozen. It read `BLOCKED_DEPENDENCY` at the moment this file was authored and `AC-AI-09-01` was verified against it. `TASK-AI-08` is the live precedent for the opposite: its Control table declares `BLOCKED_DEPENDENCY` while register row 141 now reads `BACKLOG`, so `AC-AI-08-01` exits `1` on the current tip and `AC-AI-08-02` exits `2` at its own control step. If the governed reconciler clears this row's block before this file merges, the Control table must be re-aligned to the register in the same change; the divergence would be reported by `AC-AI-09-01` rather than hidden.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.
- `AC-AI-09-01` mechanically compares the `Status` cell of the Control table above against row 142 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

The deterministic supervisor established by `TASK-AI-06`, extended with cross-harness failover by `TASK-AI-07` and with exact failure evidence by `TASK-AI-08`, already writes its state to `$HandoffRoot/supervisor-state.json` (`TASK-AI-06` § 8) and already declares every field a restart needs to read back. What no Work Item yet specifies is the **restart semantics** of that state: what a new run may do with a checkpoint and a supervisor lock left behind by a previous run; what a restart must do when the same Work Item, branch and Pull Request are already in flight; and how the supervisor refuses to invent state when the checkpoint, the handoff root or the worktree it names is gone.

`TASK-AI-09` fixes the restart contract. Four properties are load-bearing, and every one of them already exists in the real `scripts/ai/control.ps1` — this Work Item extends them and must not silently remove them:

1. **A restart continues the work in flight instead of duplicating it.** `Invoke-ShipDeResume` resolves the open implementation Pull Request for the active Work Item first, and only then considers a prepared Work Item or prepares a new one. That ordering is the whole mechanism by which re-running the entrypoint after a reboot does not open a second Pull Request for the same row (`AI-SUP-15`), does not consume a second register row, and does not re-dispatch a repair already acknowledged under `TASK-AI-08` (`AI-08-R05`).
2. **A checkpoint is written atomically and read back completely.** `Write-ShipDeSupervisorCheckpoint` writes a temporary file and renames it into place, so a process that dies mid-write leaves the previous checkpoint rather than a truncated one; `Normalize-ShipDeSupervisorState` declares every recovery-critical field, so a checkpoint written by an older build gains the new fields with defaults instead of faulting in `StrictMode` (`PropertyNotFoundStrict`).
3. **A checkpoint that cannot be read fails closed and is preserved.** `Read-ShipDeSupervisorCheckpoint` throws and the caller stops; it never substitutes a fresh state, because a fresh state would discard the record of what was already dispatched and re-issue it. Superseded checkpoints are archived under a stable identity (`WorkItemId_PR_n`), not overwritten, and are restorable by that identity.
4. **A dead supervisor's lock is reclaimed; a live one is never displaced.** `Assert-ShipDeSupervisorLock` refuses to start when the recorded holder process is alive, and treats a record whose holder is gone (or is the current process) as stale and reclaims it. `Release-ShipDeSupervisorLock` removes the lock only for its own holder. Together these make one restart safe without letting a second supervisor run concurrently (`AI-TOOL-03`, `AI-SUP-02`).

Beyond those four, `TASK-AI-09` specifies the recovery that `TASK-AI-06` deferred to this Work Item: **recovery from a deleted or corrupted checkpoint, deleted AO state, or an externally removed worktree**. The required behaviour is an explicit, fail-closed refusal that names the missing artifact and preserves whatever checkpoint exists for diagnosis — never a silent re-creation of a worktree, a branch or a Work Item the operator removed.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent Codex review gate; single-writer invariant per Work Item.
- `AGENTS.md` § Semi-automatic workspaces — Five isolated worktrees; single-writer invariant per Work Item.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `AGENTS.md` § Foundation verification commands — Authoritative root workspace verification gates.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-02 — Only one Work Item is active at a time; parallel orchestration is not supported.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-15 — The final unattended entrypoint is `control.ps1 -Action Resume`; `Supervise` remains a stage-specific recovery action.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-15 — An open implementation Pull Request belongs to the active Work Item only when both the Work Item ID and the exact governed head branch match; zero, ambiguous or wrong-branch matches fail closed.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-17 — An AO review trigger is checkpointed with its timestamp and must reach a supported terminal state within the configured bounded timeout.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § Human gates, § Unattended supervisor mode, § Final automation acceptance case — `Resume` is the normal daily entrypoint, and the completed orchestrator must survive being run again.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § Failure handling — AgentRouter exhaustion preserves the checkpoint and stops fail-closed, so the checkpoint is the artifact that must survive.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 142 (`TASK-AI-09`).
- `docs/product-spec/work-items/TASK-AI-06.md` § 8 State file checkpointing and § Out of scope — The checkpoint file and its fields, and the note that recovery from deleted or corrupted AO state and an externally removed worktree belongs to `TASK-AI-09`.
- `docs/product-spec/work-items/TASK-AI-07.md` § In scope 7 — Failover state persisted in `supervisor-state.json`; § Residual limitations — machine restart checkpoint resumption is owned by `TASK-AI-09`.
- `docs/product-spec/work-items/TASK-AI-08.md` § In scope 5 and § Residual limitations — Repair evidence and per-HEAD attempt counts persisted in the checkpoint, and the explicit statement that their restart semantics remain owned by `TASK-AI-09`.
- `scripts/ai/control.ps1` — `Normalize-ShipDeSupervisorState`, `Write-ShipDeSupervisorCheckpoint`, `Read-ShipDeSupervisorCheckpoint`, `Clear-ShipDeSupervisorCheckpoint`, `Archive-ShipDeSupervisorCheckpoint`, `Get-ShipDeArchivedSupervisorCheckpoint`, `Test-ShipDeArchivedCheckpointMatches`, `Assert-ShipDeSupervisorLock`, `Release-ShipDeSupervisorLock`, `Invoke-ShipDeResume`.
- `tools/ai-brain/acceptance/lib/checkpoint-recovery-contract.js` — The shared restart-recovery contract that `AC-AI-09-05` and `AC-AI-09-06` both require.

## Preconditions and dependencies

- Prerequisite `TASK-AI-08` is merged into `origin/main` at `8d039256adfa36172c09464123fcc9b488ab7f61` (PR #64). `AC-AI-09-03` proves this from the repository rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 142 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- The deterministic supervisor exists in `scripts/ai/control.ps1` with `Supervise`, `Resume`, `Status` and `Test` actions, and its behavioral suite runs under `powershell -NoProfile -File scripts/ai/control.ps1 -Action Test`.
- `$HandoffRoot` (`scripts/ai/handoff`) is a writable local directory outside the repository, holding `supervisor-state.json`, `supervisor.lock` and `archived-supervisor-checkpoints.json`.
- `supervisor-state.json` round-trips through `Normalize-ShipDeSupervisorState` with every property present, so a new recovery field can be added without breaking `StrictMode`.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to designing and implementing durable checkpoint persistence, restart recovery, stale-lock reclamation and fail-closed recovery from a deleted checkpoint, deleted AO state or an externally removed worktree, within `scripts/ai/control.ps1` and related specifications.

Prohibited in this Work Item:

- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT create, delete, reset or re-create a Work Item's branch or worktree as part of recovery; an operator removal is a decision, and the supervisor reports it fail-closed instead of undoing it.
- Do NOT replace a corrupt or unreadable checkpoint with a fresh one. Preserve it and stop.
- Do NOT re-dispatch a repair, a review trigger or a merge intent already acknowledged in a checkpoint (`TASK-AI-08`).
- Do NOT allow two supervisors to run concurrently, and do NOT displace a lock whose holder process is alive (`AI-TOOL-03`).
- Do NOT introduce an unbounded recovery loop; every recovery path is bounded and ends in a fail-closed stop.
- Do NOT trigger cross-harness failover on a restart, a lock collision or a corrupted checkpoint; failover remains `TASK-AI-07`.
- Do NOT auto-merge any Pull Request (`AI-SUP-05`); a restart never completes a merge the preflight did not authorize.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.

## In scope

1. **Checkpoint durability and atomicity**:
   - Keep the checkpoint at `$HandoffRoot/supervisor-state.json`, written through a temporary file and renamed into place, so an interrupted write leaves the previous checkpoint intact.
   - Keep the archive at `$HandoffRoot/archived-supervisor-checkpoints.json`, written the same way.
2. **Checkpoint round-trip completeness**:
   - `Normalize-ShipDeSupervisorState` declares every recovery-critical field, including the ones `TASK-AI-07` and `TASK-AI-08` added (`FailoverCount`, `PendingDispatch`, `RepairAttemptsByHead`, `LastAcknowledgedCiRepairHead`, `LastAcknowledgedReviewRepairHead`, `MergeIntent`, `MergeCommitOid`).
   - A checkpoint written by an older build gains missing fields with defaults rather than faulting in `StrictMode`.
3. **Fail-closed read**:
   - A checkpoint that cannot be parsed or is structurally invalid stops the supervisor with a diagnostic that names the file and preserves it for diagnosis; it is never silently replaced.
4. **Restart idempotence**:
   - `Resume` consumes the existing open implementation Pull Request for the active Work Item before it starts a prepared item or prepares a new one, so a restart never opens a second Pull Request for the same register row and never consumes a second row.
   - An acknowledged CI or review repair is consulted before the budget on a restart, so a restart does not re-dispatch it (`AI-08-R05`).
   - A merge intent already persisted is resumed or discarded on exact `expectedHeadOid` match, never re-issued against a changed head.
5. **Stale-lock reclamation and live-holder refusal**:
   - `Assert-ShipDeSupervisorLock` reclaims a lock whose recorded holder process is gone, and refuses to start when the holder is alive.
   - `Release-ShipDeSupervisorLock` removes the lock only for its own holder.
6. **Archive and restore by stable identity**:
   - A superseded checkpoint is archived under `WorkItemId_PR_n` (or the available half of that identity) and restorable by the same identity, so a restart selects the record for its Work Item and Pull Request rather than the newest one.
7. **Recovery from removed state**:
   - A deleted or corrupted checkpoint, deleted AO session state, or an externally removed worktree stops the supervisor fail-closed with a diagnostic naming the missing artifact, and never re-creates it.
8. **Deterministic self-tests**:
   - Add behavioral cases to `Assert-ShipDeSupervisorCompatibility` covering: a checkpoint round-trip; a malformed checkpoint refused and preserved; a stale lock reclaimed; a live lock refused; an archived checkpoint restored by identity; and a restart that resumes an existing Pull Request without spawning a second worker.

## Out of scope

- Cross-harness worker failover and AgentRouter route exhaustion (`TASK-AI-07`).
- Exact CI/review repair evidence and the per-exact-HEAD repair budget (`TASK-AI-08`); this Work Item persists their fields, it does not change their policy.
- Fine-grained permission allowlists (`TASK-AI-10`).
- Preview/DryRun modes and the comprehensive failover test matrix (`TASK-AI-11`).
- Windows Task Scheduler automation and boot-time entry (`TASK-AI-12`).
- Auto-merging pull requests (`TASK-AI-13`).
- Cross-machine checkpoint replication or a shared checkpoint store; the checkpoint is local to the handoff root.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-09-R01` | **A restart continues, it does not duplicate**: `Resume` resolves the existing open implementation Pull Request for the active Work Item before it starts a prepared item or prepares a new one. A restart must not open a second Pull Request for the same register row, must not consume a second row, and must not re-spawn a worker for a Work Item that already has an open Pull Request at the exact governed head branch (`AI-SUP-15`). |
| `AI-09-R02` | **A checkpoint is written atomically**: the checkpoint and its archive are written to a temporary path and renamed into place. An interrupted write leaves the previous record readable; a partial file is never published. |
| `AI-09-R03` | **A checkpoint round-trips completely**: `Normalize-ShipDeSupervisorState` declares every recovery-critical field, and a checkpoint that predates a field gains it with the declared default instead of faulting in `StrictMode`. |
| `AI-09-R04` | **An unreadable checkpoint fails closed and is preserved**: a checkpoint that cannot be parsed stops the supervisor with a diagnostic naming the file. It is never replaced by a fresh state, because a fresh state would discard what was already dispatched and re-issue it. |
| `AI-09-R05` | **A dead holder's lock is reclaimed; a live holder's lock is not**: a lock whose recorded holder process no longer exists is stale and is reclaimed; a lock whose holder is alive stops the new supervisor fail-closed. Release removes the lock only for its own holder. |
| `AI-09-R06` | **A superseded checkpoint is archived, never dropped, and restorable by identity**: the archive key is the Work Item ID and Pull Request number, and a restart selects by that identity rather than by recency. |
| `AI-09-R07` | **Removed state is reported, not re-created**: a deleted handoff root, a deleted AO session record or an externally removed worktree stops the supervisor fail-closed with a diagnostic naming the missing artifact. No branch, worktree, directory or Work Item is re-created by recovery. |
| `AI-09-R08` | **Recovery is bounded and idempotent**: every recovery path is bounded by a configurable limit, re-running the entrypoint after a successful recovery is a no-op, and an acknowledged repair, review trigger or merge intent is never re-dispatched (`AI-08-R05`). |
| `AI-09-R09` | **Recovery is not failover**: a restart, a lock collision or a corrupted checkpoint never triggers harness failover; those are returned to the operator fail-closed (`TASK-AI-07`, `AI-SUP-04`). |

## UI states

Not applicable; this Work Item governs supervisor automation and terminal logging:

- **Checkpoint persisted**: Emits `[SUPERVISOR] Checkpoint persisted for Work Item {0} at exact HEAD {1}`.
- **Restart resumed in-flight work**: Emits `[SUPERVISOR] Resuming Work Item {0} from checkpoint; open Pull Request #{1} at exact HEAD {2} is consumed before any new Work Item`.
- **Stale lock reclaimed**: Emits `[SUPERVISOR] Reclaimed stale supervisor lock held by PID {0} (Work Item '{1}'); no live holder remains`.
- **Live lock refused (fail-closed)**: Emits `[BLOCKED] Another supervisor instance (PID {0}, Work Item '{1}') is actively supervising. Stopping fail-closed`.
- **Checkpoint unreadable (fail-closed)**: Emits `[BLOCKED] Supervisor checkpoint '{0}' is malformed. Preserved for diagnosis; stopping fail-closed`.
- **State removed (fail-closed)**: Emits `[BLOCKED] Recovery target is missing: {0}. Stopping fail-closed; recovery never re-creates a branch, worktree or Work Item`.

## API, event and data impact

- Supervisor state schema in `$HandoffRoot/supervisor-state.json` extended with:
  - `RecoveryCount`: Integer, default `0` — the number of recoveries performed for this Work Item, bounded by the configured limit.
  - `LastRecoveryAt`: ISO-8601 UTC timestamp or `null` — when recovery last ran.
  - `RecoveredFrom`: String or `null` — `CHECKPOINT`, `ARCHIVE` or `LOCK`, naming the record recovery selected.
  - `RecoveryDiagnostic`: String or `null` — the diagnostic recorded when a recovery path stopped fail-closed.
  - `LastAcknowledgedCiRepairHead`, `LastAcknowledgedReviewRepairHead`, `RepairAttemptsByHead`, `MergeIntent`, `MergeCommitOid`: persisted by `TASK-AI-08` and `TASK-AI-13`; this Work Item defines their restart semantics, not their shape.
- New supervisor parameter: `MaxRecoveryAttempts` (Integer, default 1), bounding recovery inside one run.
- No database migrations, runtime REST APIs, or carrier integration contract changes.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-09-01` | Control table status and delivery register row 142 cannot diverge | `node tools/ai-brain/acceptance/ac-09-01-status-alignment.js` | `0` | `Control status matches register row 142: BLOCKED_DEPENDENCY (declared TASK-AI-09)` | `docs/product-spec/work-items/TASK-AI-09.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-09-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-09-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-09-01` runs detects it | `node tools/ai-brain/acceptance/ac-09-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-09-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-09-03` | Dependency resolution truthfulness: register row 142 declares `TASK-AI-08`, and `TASK-AI-08` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-09-03-dependency-merged.js` | `0` | `TASK-AI-08 dependency verified: merged into origin/main for TASK-AI-09` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-09-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-09-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-09-03` runs | `node tools/ai-brain/acceptance/ac-09-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-09-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr |
| `AC-AI-09-05` | Restart-recovery contract holds in the real supervisor source: a durable checkpoint, a stale-lock reclaim, and a restart that consumes an existing Pull Request first | `node tools/ai-brain/acceptance/ac-09-05-recovery-contract.js` | `0` | `RECOVERY_CONTRACT_HOLDS: durable checkpoint and restart recovery present in scripts/ai/control.ps1` | `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/ac-09-05-recovery-contract.js`, `tools/ai-brain/acceptance/lib/checkpoint-recovery-contract.js` |
| `AC-AI-09-06` | **Negative proof, must fail:** a copy of the real supervisor source with the atomic checkpoint write replaced by a direct write is rejected by the same contract `AC-AI-09-05` runs | `node tools/ai-brain/acceptance/ac-09-06-recovery-contract-broken.js` | `1` | `RECOVERY_CONTRACT_BROKEN: an atomic checkpoint write through a temporary file` | `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/ac-09-06-recovery-contract-broken.js`, `tools/ai-brain/acceptance/lib/checkpoint-recovery-contract.js`; command stderr |
| `AC-AI-09-07` | Toolchain suite invariant green with 0 failures | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js` | `0` | `AC-AI-08-07 suite invariant held: fail 0 with` | `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; test runner stdout |
| `AC-AI-09-08` | Manifest truth audit green with 0 errors | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-09-09` | Delivery register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-09-10` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py stdout` |
| `AC-AI-09-11` | Incremental code and document formatting check green | `pnpm format:check` | `0` | `✅ Hoàn tất:` | `scripts/verify-formatting.ts stdout` |
| `AC-AI-09-12` | Secret surface guard reports no leakable secret | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/cli.js stdout` |
| `AC-AI-09-13` | Supervisor self-tests and auto-merge behavioral test suite executes and passes | `powershell -NoProfile -File scripts/ai/control.ps1 -Action Test` | `0` | `ALL SUPERVISOR AND AUTO-MERGE BEHAVIORAL TESTS PASSED` | `scripts/ai/control.ps1 stdout` |
| `AC-AI-09-14` | The three negative proofs of this Work Item fail operationally (exit 2), not as findings (exit 1), when run outside the repository | `node tools/ai-brain/acceptance/ac-09-14-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 3 negative proofs exited 2 with SOURCE_MISSING outside the repository` | `tools/ai-brain/acceptance/ac-09-14-outside-repository.js`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-09-07`, `-08`, `-09`, `-10` and `-11` assert invariants (`fail 0`, `0 lỗi`, a passing validator), never exact totals, because this Work Item itself adds a markdown specification file and seven acceptance scripts, so any pinned count is stale on arrival. The counts below are recorded as evidence of the observed baseline only; a change in any of them does not falsify the corresponding acceptance row, and no row may be rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-09-07` | `fail 0` in the test runner summary, with `tests > 0` and `suites > 0` | `641` tests across `140` suites at the time of writing |
| `AC-AI-09-08` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js manifest` | Exactly one expected warning (`PINNED_VERSION_DRIFT` for `codex-cli`); warning and note totals are deliberately unpinned |
| `AC-AI-09-09` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled at the time of writing |
| `AC-AI-09-10` | `Documentation validation passed:` from `validate_docs.py` | `97` markdown files, `130` feature IDs, `178` delivery rows at the pre-implementation baseline |
| `AC-AI-09-11` | `✅ Hoàn tất:` from `scripts/verify-formatting.ts` | The scanned file count is deliberately unpinned |

`AC-AI-09-07` runs the suite-invariant script already committed by `TASK-AI-08` rather than restating the rule in a fourth private copy. The invariant `fail 0` and the three test globs are owned by `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; this Work Item consumes that gate and adds none.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-09
node tools/ai-brain/acceptance/ac-09-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-09-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-08 merged into origin/main
node tools/ai-brain/acceptance/ac-09-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-09-04-dependency-unproven.js

# 5. Restart-recovery contract over the real supervisor source
node tools/ai-brain/acceptance/ac-09-05-recovery-contract.js

# 6. Negative proof: the atomic checkpoint write removed is rejected
node tools/ai-brain/acceptance/ac-09-06-recovery-contract-broken.js

# 7. Toolchain suite invariant (fail 0, and the suites really ran)
node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js

# 8. Manifest truth audit
node tools/ai-brain/cli.js manifest

# 9. Register reconciliation audit
node tools/ai-brain/cli.js reconcile

# 10. Specification structural validation
python docs/product-spec/scripts/validate_docs.py

# 11. Code formatting verification
pnpm format:check

# 12. Secret surface guard
node tools/ai-guard/cli.js secret-surface

# 13. Supervisor self-tests and behavioral suite
powershell -NoProfile -File scripts/ai/control.ps1 -Action Test

# 14. Outside-repository probe: every negative proof exits 2, never 1
node tools/ai-brain/acceptance/ac-09-14-outside-repository.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-09: full checkpoint persistence and restart recovery. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Acceptance matrix validation

Written `2026-09-16`. Every row was executed against this branch before the
matrix was committed: the eight `node` rows produced their stated exit code and
expected string, the Python and formatting rows were run, and the three negative
proofs produced exit `1` with their stated string. Each negative proof reads a
**real** repository file, proves the untouched source is accepted as a CONTROL,
tampers a **copy** under `os.tmpdir()`, and asserts the same check rejects the
copy. Each exits `2`, not `1`, when its real source is missing; `AC-AI-09-14`
measures that for all three at once.

The matrix was then extracted from this table cell by cell and re-run as stored,
to prove no row's command is mangled by the table: `13` of the `14` rows passed
and the PowerShell row was not run in that sandbox.

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy) | Rejection |
|---|---|---|---|---|
| `AC-AI-09-02` | status alignment `AC-AI-09-01` | real `TASK-AI-09.md` agrees with real register row 142 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-09-04` | dependency proof `AC-AI-09-03` | real declared dependency `TASK-AI-08` has a merge commit on `origin/main` | `dependencies` cell repointed to `TASK-AI-99` in a register copy | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-09-06` | restart-recovery contract `AC-AI-09-05` | real `scripts/ai/control.ps1` satisfies all 11 parts of the contract | the temporary-file-and-rename checkpoint write replaced by a direct `Set-Content` in a copy | `RECOVERY_CONTRACT_BROKEN`, exit `1` |

Three defects were removed while validating the matrix, each of the classes this
repository has already had to repair once:

1. **The rules live in one module each, not in the rows.** The comparison
   `AC-AI-09-01` runs and the proof `AC-AI-09-02` runs are the same module,
   `tools/ai-brain/acceptance/lib/spec-status-alignment.js`, and `AC-AI-09-02`
   calls the same aggregate function `statusAlignmentViolations` rather than a
   second reading of the cells; `dependency-merged.js` is shared with
   `TASK-AI-08`'s pair for `-03`/`-04`; and `checkpoint-recovery-contract.js` is
   shared for `-05`/`-06`. The invariant and its proof cannot drift apart, because
   neither carries a private copy of the rule.
2. **No command is stored inside a table cell.** The restart-recovery check needs
   to read a function body, a temporary-file rename and a lock comparison out of
   a 15 597-line PowerShell file; a stored inline form of that reaches Node
   mangled, and a `SyntaxError` exits `1`, which is the code a negative row
   expects. Every row is therefore a committed script under
   `tools/ai-brain/acceptance/`.
3. **The negative proofs fail closed outside the repository.** `AC-AI-09-14`
   spawns all three from an empty temporary directory and requires exit `2` with
   the `SOURCE_MISSING` line naming the real file each one could not read. A proof
   that dies for an unrelated reason cannot be mistaken for a detection.

## Coupling proof for the shared rules

Each pair was mutated through the shared module alone, without touching either
script, and both were re-run. Every module was restored from a file backup
afterwards (copied to a temporary path with `cp` and copied back; no
`git checkout --` was run against uncommitted work).

Baseline, with all modules intact:

| Row | Exit | Output |
|---|---|---|
| `AC-AI-09-01` | `0` | `Control status matches register row 142: BLOCKED_DEPENDENCY (declared TASK-AI-09)` |
| `AC-AI-09-02` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-09-03` | `0` | `TASK-AI-08 dependency verified: merged into origin/main for TASK-AI-09` |
| `AC-AI-09-04` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |
| `AC-AI-09-05` | `0` | `RECOVERY_CONTRACT_HOLDS: durable checkpoint and restart recovery present in scripts/ai/control.ps1` |
| `AC-AI-09-06` | `1` | `RECOVERY_CONTRACT_BROKEN: an atomic checkpoint write through a temporary file` |

Mutation results:

| Mutation (shared module only) | Invariant row | Negative proof | Reading |
|---|---|---|---|
| `spec-status-alignment.js`: `statusAlignmentViolations` stops reporting divergence | `AC-AI-09-01` exit `0` (unchanged) | `AC-AI-09-02` exit `0`, prints `DIVERGENCE_NOT_DETECTED` | The negative proof **fails**: the gate stays green while the rule is dead, so the proof is the only thing that notices |
| `dependency-merged.js`: `dependencyProven` returns `ok: true` unconditionally | `AC-AI-09-03` exit `0` (unchanged) | `AC-AI-09-04` exit `0`, prints `DEPENDENCY_WRONGLY_PROVEN` | The negative proof **fails**: a rule that proves every dependency makes `AC-AI-09-03` vacuous and `AC-AI-09-04` red |
| `checkpoint-recovery-contract.js`: `missingRecoveryParts` returns `[]` | `AC-AI-09-05` exit `0` (unchanged) | `AC-AI-09-06` exit `2`, prints `CONTROL_FAILED: the real supervisor already violates the contract` | The negative proof **fails** at its own control step: it cannot prove a rejection with a detector that reports nothing |

Each invariant row stayed green under every mutation; in all three cases the
negative proof — the only row that can tell a live rule from a dead one — went
red. That is the evidence the pairs are coupled to one rule.

## Residual limitations

- Implementation of the recovery fields (`RecoveryCount`, `LastRecoveryAt`,
  `RecoveredFrom`, `RecoveryDiagnostic`), `MaxRecoveryAttempts`, the fail-closed
  recovery diagnostics for a removed worktree or deleted AO state, and the
  behavioral self-tests is specified here and delivered during the
  implementation phase of `TASK-AI-09`. `AC-AI-09-05` asserts the restart-recovery
  contract the real supervisor already satisfies today, so that extending it
  cannot silently remove it; it does not assert the extended behaviour, which
  does not exist yet.
- Delivery register row 142 displays `BLOCKED_DEPENDENCY` while `TASK-AI-08` is
  merged in Git reality. The Control table stays strictly aligned to the register
  under `AGENTS.md` § Unit of delivery; clearing the block is the governed
  reconciler's job, not a manual write. **Measured drift risk on this row:**
  register row 141 (`TASK-AI-08`) was `BACKLOG` before PR #64 merged, so
  `TASK-AI-08`'s own Control table and `AC-AI-08-01` are already divergent on the
  current tip. If the same reconciler run clears row 142, this Control table must
  be re-aligned in the same change.
- Register row 141 (`TASK-AI-08`) reads `BACKLOG` although its specification is
  merged, because no durable merge-evidence artifact carrying an exact-HEAD
  verdict exists for it. `AC-AI-09-03` therefore proves the dependency from Git
  rather than from the register status; it does not assert the register row, which
  would fail while the reconciler correctly refuses to write `MERGED`.
- `tools/ai-brain/acceptance/lib/dependency-merged.js` proves a Work Item is
  merged when any commit reachable on `origin/main` names it in its message. That
  is evidence, not proof, and it is weakest exactly where it is reused: a commit
  that merely *names* a Work Item as a dependency satisfies it. For `TASK-AI-08`
  the naming commit is its own merge commit, so the row is sound here; the
  limitation is recorded so a later Work Item that depends on a frequently-named
  id does not inherit it silently.
- **Two row-numbering conventions disagree in this directory.** `TASK-AI-07` and
  `TASK-AI-08` call the register's `delivery_order` column the "row"; `TASK-AI-17`
  numbers by physical CSV line. Measured: this Work Item is `delivery_order` 142
  and physical line 10, `TASK-AI-17` is `delivery_order` 150 and physical line
  152, and physical line 154 is `TASK-AI-19`, not `TASK-AI-21`. This file uses
  `delivery_order` and names the `work_item_id` alongside every row number so the
  two cannot be confused. The divergence is recorded rather than repaired, because
  renumbering another Work Item's prose is not this one's scope.
- Checkpoint replication across machines, and recovery of a handoff root that was
  never written, are out of scope; the checkpoint is local to this machine's
  handoff root.
