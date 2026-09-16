# TASK-AI-08 — Extended CI/review diagnostics and bounded repair

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-08` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `141` |
| Dependencies | `TASK-AI-07` (merged into `origin/main`; register row 140 not yet reconciled to `MERGED`) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-08.md`, `scripts/ai/control.ps1`, `tools/ai-brain/**`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-08` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 141) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 141, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-07` is merged into `origin/main` at `bdeb15b6f8bcb9c688caddfbd6a671384654179f` (PR #37) and again at `a485ed88d62df045109e7fbc2208892d3a884be6` (PR #53), while register row 140 still reads `BACKLOG` because no durable merge-evidence artifact exists for it. Clearing the block is the governed reconciler's job (`TASK-AI-19`), not this file's.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.
- `AC-AI-08-01` mechanically compares the `Status` cell of the Control table above against row 141 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

The deterministic supervisor established by `TASK-AI-06` and extended with cross-harness failover by `TASK-AI-07` dispatches **at most one CI repair and one review repair per exact HEAD**, and each dispatch names the exact HEAD but not the evidence that failed: the CI message says `CI failed for PR #<n> at exact HEAD <sha>. Inspect the failing checks, ...` without naming a single check, and the checkpoint records only `LastCiRepairHead`, `LastAcknowledgedCiRepairHead` and a Work-Item-level `RepairCount`. Two consequences follow, both observed in the source at `scripts/ai/control.ps1` (`Invoke-ShipDeSupervisorLoop`):

1. **A repair that does not fully fix one HEAD is unrecoverable.** Because the guard is `LastAcknowledgedCiRepairHead -ne $headSha`, a HEAD that fails again after its single repair is never repaired again — the loop falls through and stops. A flaky check, a second failing check that only surfaced after the first was fixed, or a repair that introduced a new failure all end autonomous delivery on the first retry. The Work-Item-level `RepairCount` bound of `$MaxRepairBudget` does not help, because the per-HEAD guard refuses before the counter is consulted.
2. **A repair carries no evidence.** The dispatch tells the worker that CI failed without telling it which check failed, with what conclusion, or against which provider attempt (`AI-SUP-16`). The worker re-derives that evidence, and when it re-derives the wrong thing the supervisor cannot tell a genuine second failure from a re-dispatch of the first. A repair that is not bound to the exact failure it repairs is not auditable after the fact.

`TASK-AI-08` adds exact failure evidence and a bounded repair budget beyond one dispatch per exact HEAD:

1. **Exact failure evidence.** Every CI and review repair dispatch carries the exact failure it repairs: for CI, the failing check names, their provider identity and conclusion, and the exact HEAD SHA they observed (`AI-SUP-16`); for review, the exact findings text bound to the exact HEAD. A repair that cannot be bound to concrete evidence is not dispatched.
2. **Budget beyond one dispatch per HEAD.** A HEAD may be repaired more than once, bounded by a per-HEAD attempt limit, while the Work Item total remains bounded by `$MaxRepairBudget`. Both bounds are configurable; neither is unbounded.
3. **Fail-closed exhaustion.** When either bound is exceeded the supervisor stops fail-closed with a durable diagnostic naming the Work Item, the exact HEAD and the bound reached. It never retries indefinitely and never invents a repair when evidence cannot be gathered.
4. **Crash-recoverable evidence.** The evidence and the per-HEAD attempt count are persisted in `supervisor-state.json` so a restarted supervisor (`TASK-AI-09`) does not redispatch a repair already acknowledged.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent Codex review gate; single-writer invariant per Work Item.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `AGENTS.md` § Foundation verification commands — Authoritative root workspace verification gates.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Transient failure classification — Lint/type/test and assertion failures return to the author; that table is what a CI repair is dispatched for.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-04 — Implementation/test failures are NOT provider failures; they return to the author.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-SUP-16 — GitHub check attempts are grouped by name and provider identity; only the unambiguous newest attempt in each group participates, and required gates must come from GitHub Actions. Repair evidence must name the same identity.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § 1 Codex prepares the next item, § 5 Correction loop — `CHANGES_REQUIRED` returns to the same author on the same branch; every updated commit requires a fresh verdict.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 141 (`TASK-AI-08`).
- `docs/product-spec/work-items/TASK-AI-06.md` § In scope 7 and § Out of scope — The single repair dispatch per exact HEAD, and the note that richer diagnosis and retry budgeting beyond it belong to `TASK-AI-08`.
- `docs/product-spec/work-items/TASK-AI-07.md` § Out of scope — "Extended multi-turn CI failure diagnostics and repair budgeting beyond 1 dispatch per exact HEAD" are owned by `TASK-AI-08`.
- `scripts/ai/control.ps1` — `Invoke-ShipDeSupervisorLoop` (the `$MaxRepairBudget` bound and the `LastAcknowledgedCiRepairHead` / `LastAcknowledgedReviewRepairHead` per-HEAD guards), `Get-ShipDePrGate`, `Get-ShipDeExactHeadCheckRollup`, `New-ShipDeAoReviewRepairMessage`, `Normalize-ShipDeSupervisorState`, `Reset-ShipDeSupervisorHeadState`.
- `tools/ai-brain/reconcile.js` — `dependencyProven`, the rule the dependency acceptance row shares.

## Preconditions and dependencies

- Prerequisite `TASK-AI-07` is merged into `origin/main` at `bdeb15b6f8bcb9c688caddfbd6a671384654179f` (PR #37), with a follow-up on the shared-check rule at `a485ed88d62df045109e7fbc2208892d3a884be6` (PR #53). Both commits are reachable on `origin/main`; `AC-AI-08-03` proves this from the repository rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 141 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- The deterministic supervisor exists in `scripts/ai/control.ps1` with `Supervise`, `Review`, `Resume`, `Status` and `Test` actions, and its behavioral suite runs under `powershell -NoProfile -File scripts/ai/control.ps1 -Action Test`.
- GitHub check evidence is available through the paginated check rollup (`Get-ShipDeExactHeadCheckRollup`) grouped by name and provider identity (`AI-SUP-16`).
- `supervisor-state.json` round-trips through `Normalize-ShipDeSupervisorState` with every property present, so a new evidence field can be added without breaking StrictMode.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to designing and implementing exact CI/review failure-evidence capture, the per-exact-HEAD bounded repair budget, fail-closed exhaustion diagnostics, and their persistence in the supervisor checkpoint, within `scripts/ai/control.ps1` and related specifications.

Prohibited in this Work Item:

- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT remove the Work-Item-level `$MaxRepairBudget` bound or the fail-closed stop; the per-HEAD budget is added alongside it, never instead of it.
- Do NOT introduce an unbounded repair loop, an infinite retry, or a repair that is not bound to an exact 40-character HEAD SHA.
- Do NOT dispatch a repair when the failing evidence cannot be gathered; stop fail-closed instead of guessing.
- Do NOT trigger cross-harness failover on CI or review failures; those return to the author (`AI-SUP-04`), and failover remains `TASK-AI-07`.
- Do NOT weaken or skip any quality gate to make a repair pass.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.
- Do NOT auto-merge any Pull Request (`AI-SUP-05`).

## In scope

1. **Exact CI failure evidence**:
   - Resolve the failing checks for the exact HEAD from the paginated rollup, grouped by name and provider identity (`AI-SUP-16`); ambiguous or equal-time attempts fail closed rather than being chosen.
   - Bind each CI repair dispatch to: the exact 40-character HEAD SHA, the failing check names, their provider identity, their conclusion, and the observation timestamp.
   - Persist the evidence in `supervisor-state.json` so a restarted supervisor dispatches the identical evidence.
2. **Exact review failure evidence**:
   - Bind each review repair dispatch to the exact HEAD SHA and the exact trusted-reviewer findings text already available through `Get-ShipDeGitHubExactHeadCodexFindings`.
   - Refuse to dispatch a review repair whose findings are empty or whose HEAD cannot be resolved to 40 characters.
3. **Bounded repair budget beyond one dispatch per HEAD**:
   - Add `MaxRepairAttemptsPerHead` (default 2) bounding dispatches for the same exact HEAD, counted separately for CI and review.
   - Retain `RepairCount` and `$MaxRepairBudget` as the Work-Item total bound.
   - A HEAD that fails again is repaired again only while both bounds hold.
4. **Fail-closed exhaustion**:
   - When either bound is exceeded, stop fail-closed with a durable diagnostic naming the Work Item, the exact HEAD, the bound reached, and the evidence of the last dispatch.
   - Never silently continue, never discard the pending evidence, never redispatch an acknowledged repair.
5. **Checkpoint contract extension**:
   - Persist, per Work Item: `RepairAttemptsByHead` (per-HEAD attempt counts), `LastCiRepairEvidence`, `LastReviewRepairEvidence`, `LastRepairDispatchedAt` (existing), and the resolved bound in use.
   - Extend `Normalize-ShipDeSupervisorState` and the archiving/restore paths so the new fields survive a checkpoint round-trip and a head change without `PropertyNotFoundStrict` faults.
6. **Deterministic self-tests**:
   - Add behavioral cases to `Assert-ShipDeSupervisorCompatibility` covering: one repair allowed under the per-HEAD bound, a second repair allowed under a bound of 2, refusal at the bound, refusal without evidence, and evidence round-tripping through the checkpoint.

## Out of scope

- Full checkpoint persistence across machine reboot and crash recovery (`TASK-AI-09`); this Work Item persists the new fields, not their restart semantics.
- Cross-harness worker failover and AgentRouter route exhaustion (`TASK-AI-07`).
- Fine-grained permission allowlists (`TASK-AI-10`).
- Preview/DryRun modes and the comprehensive failover test matrix (`TASK-AI-11`).
- Windows Task Scheduler automation (`TASK-AI-12`).
- Auto-merging pull requests (`TASK-AI-13`).

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-08-R01` | **Evidence before dispatch**: A repair is dispatched only when bound to the exact 40-character HEAD SHA and to concrete failing evidence — the failing CI check identities, or the review findings text. A repair whose evidence cannot be gathered is not dispatched; the supervisor stops fail-closed instead. |
| `AI-08-R02` | **Budget beyond one dispatch per HEAD**: A HEAD may be repaired more than once, bounded by `MaxRepairAttemptsPerHead`. The former single-dispatch limit is a special case of this rule (bound of 1), not a separate guard. |
| `AI-08-R03` | **Work-Item total bound is preserved**: `RepairCount` and `$MaxRepairBudget` continue to bound the Work Item as a whole. The per-HEAD bound never widens the total bound. |
| `AI-08-R04` | **Fail-closed exhaustion**: Exceeding either bound stops delivery fail-closed with a durable diagnostic naming the Work Item, the exact HEAD, the bound reached and the last evidence. No unbounded retry, no silent continuation. |
| `AI-08-R05` | **Acknowledged repairs are not redispatched**: A repair already acknowledged for an exact HEAD is never dispatched again after a restart; the acknowledgement is consulted before the budget. |
| `AI-08-R06` | **CI failures are not provider failures**: A lint, typecheck, test, or assertion failure returns to the author as a repair (`AI-SUP-04`); it never triggers harness failover (`TASK-AI-07`). |
| `AI-08-R07` | **Ambiguous check evidence fails closed**: When two attempts of the same check name and provider cannot be ordered unambiguously, the supervisor refuses to name a failing check and stops rather than choosing one (`AI-SUP-16`). |
| `AI-08-R08` | **Evidence durability**: The evidence and the per-HEAD attempt count are persisted in `supervisor-state.json` on every dispatch and on every acknowledgement, so the checkpoint is the record of what was dispatched. |
| `AI-08-R09` | **Head change resets the per-HEAD budget, not the evidence history**: A new HEAD starts a fresh per-HEAD attempt count while the Work-Item `RepairCount` accumulates across heads; superseded evidence is archived, never silently dropped. |

## UI states

Not applicable; this Work Item governs supervisor automation and terminal logging:

- **Repair dispatched with evidence**: Emits `[SUPERVISOR] CI repair 1/2 dispatched for PR #{0} at exact HEAD {1}: failing checks {2}`.
- **Review repair dispatched with evidence**: Emits `[SUPERVISOR] Review repair 1/2 dispatched for PR #{0} at exact HEAD {1} with {2} findings`.
- **Evidence unavailable (fail-closed)**: Emits `[BLOCKED] Cannot bind repair evidence for PR #{0} at exact HEAD {1}; stopping fail-closed`.
- **Per-HEAD budget exhausted (fail-closed)**: Emits `[BLOCKED] Repair budget for exact HEAD {0} exhausted after {1} attempts for Work Item {2}. Stopping fail-closed for human intervention`.
- **Work-Item budget exhausted (fail-closed)**: Emits `[BLOCKED] Supervisor repair budget exhausted ({0} repairs dispatched exceeds max budget {1} for Work Item '{2}'). Stopping fail-closed for human intervention`.
- **Acknowledged repair recovered after restart**: Emits `[SUPERVISOR] Repair for exact HEAD {0} already acknowledged; awaiting author repair, not redispatching`.

## API, event and data impact

- Supervisor state schema in `$HandoffRoot/supervisor-state.json` extended with:
  - `RepairAttemptsByHead`: Object mapping a 40-character HEAD SHA to the number of repair dispatches against it.
  - `LastCiRepairEvidence`: Object or `null` — `Head`, `Checks` (name, provider, conclusion), `ObservedAt`.
  - `LastReviewRepairEvidence`: Object or `null` — `Head`, `FindingsCount`, `ObservedAt`.
  - `RepairAttemptsPerHead`: Integer, the resolved per-HEAD bound in use for the run.
- New supervisor parameter: `MaxRepairAttemptsPerHead` (Integer, default 2), alongside the existing `MaxRepairBudget`.
- No database migrations, runtime REST APIs, or carrier integration contract changes.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-08-01` | Control table status and delivery register row 141 cannot diverge | `node tools/ai-brain/acceptance/ac-08-01-status-alignment.js` | `0` | `Control status matches register row 141: BLOCKED_DEPENDENCY (declared TASK-AI-08)` | `docs/product-spec/work-items/TASK-AI-08.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-08-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-08-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-08-01` runs detects it | `node tools/ai-brain/acceptance/ac-08-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-08-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-08-03` | Dependency resolution truthfulness: register row 141 declares `TASK-AI-07`, and `TASK-AI-07` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-08-03-dependency-merged.js` | `0` | `TASK-AI-07 dependency verified: merged into origin/main for TASK-AI-08` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-08-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-08-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-08-03` runs | `node tools/ai-brain/acceptance/ac-08-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-08-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr |
| `AC-AI-08-05` | Bounded-repair contract holds in the real supervisor source: a configurable budget, a fail-closed stop, and a repair bound to the exact HEAD | `node tools/ai-brain/acceptance/ac-08-05-repair-budget-surface.js` | `0` | `REPAIR_BUDGET_CONTRACT_HOLDS: bounded repair budget present in scripts/ai/control.ps1` | `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/ac-08-05-repair-budget-surface.js`, `tools/ai-brain/acceptance/lib/repair-budget-contract.js` |
| `AC-AI-08-06` | **Negative proof, must fail:** a copy of the real supervisor source with the fail-closed budget comparison removed is rejected by the same contract `AC-AI-08-05` runs | `node tools/ai-brain/acceptance/ac-08-06-repair-budget-unbounded.js` | `1` | `REPAIR_BUDGET_UNBOUNDED: a fail-closed stop when the repair counter exceeds the bound` | `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/ac-08-06-repair-budget-unbounded.js`, `tools/ai-brain/acceptance/lib/repair-budget-contract.js`; command stderr |
| `AC-AI-08-07` | Toolchain unit and integration test suites green with 0 failures | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js` | `0` | `AC-AI-08-07 suite invariant held: fail 0 with` | `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; test runner stdout |
| `AC-AI-08-08` | Manifest truth audit green with 0 errors | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-08-09` | Delivery register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-08-10` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py stdout` |
| `AC-AI-08-11` | Incremental code and document formatting check green | `pnpm format:check` | `0` | `✅ Hoàn tất:` | `scripts/verify-formatting.ts stdout` |
| `AC-AI-08-12` | Secret surface guard reports no leakable secret | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/cli.js stdout` |
| `AC-AI-08-13` | Supervisor self-tests and auto-merge behavioral test suite executes and passes | `powershell -NoProfile -File scripts/ai/control.ps1 -Action Test` | `0` | `ALL SUPERVISOR AND AUTO-MERGE BEHAVIORAL TESTS PASSED` | `scripts/ai/control.ps1 stdout` |
| `AC-AI-08-14` | The negative proof `AC-AI-08-02` fails operationally (exit 2), not as a finding (exit 1), when run outside the repository | `node tools/ai-brain/acceptance/ac-08-14-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: child exit 2 with SOURCE_MISSING: docs/product-spec/work-items/TASK-AI-08.md` | `tools/ai-brain/acceptance/ac-08-14-outside-repository.js`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-08-07`, `-08`, `-09`, `-10` and `-11` assert invariants (`fail 0`, `0 lỗi`, a passing validator), never exact totals, because this Work Item itself adds a markdown specification file and eight acceptance scripts, so any pinned count is stale on arrival. The counts below are recorded as evidence of the observed baseline only; a change in any of them does not falsify the corresponding acceptance row, and no row may be rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-08-07` | `fail 0` in the test runner summary, with `tests > 0` and `suites > 0` | `632` tests across `138` suites at the pre-implementation baseline |
| `AC-AI-08-08` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js manifest` | Exactly one expected warning (`PINNED_VERSION_DRIFT` for `codex-cli`); warning and note totals are deliberately unpinned |
| `AC-AI-08-09` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled at the time of writing |
| `AC-AI-08-10` | `Documentation validation passed:` from `validate_docs.py` | `94` markdown files, `130` feature IDs, `178` delivery rows at the time of writing |
| `AC-AI-08-11` | `✅ Hoàn tất:` from `scripts/verify-formatting.ts` | The scanned file count is deliberately unpinned; it is `0` before this change and `1` after |

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-08
node tools/ai-brain/acceptance/ac-08-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-08-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-07 merged into origin/main
node tools/ai-brain/acceptance/ac-08-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-08-04-dependency-unproven.js

# 5. Bounded-repair contract over the real supervisor source
node tools/ai-brain/acceptance/ac-08-05-repair-budget-surface.js

# 6. Negative proof: a copy with the budget bound removed is rejected
node tools/ai-brain/acceptance/ac-08-06-repair-budget-unbounded.js

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

# 14. Outside-repository probe: the negative proof exits 2, never 1
node tools/ai-brain/acceptance/ac-08-14-outside-repository.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-08: extended CI/review diagnostics and bounded repair. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Acceptance matrix validation

Written `2026-09-16`. Every row was executed against this branch before the
matrix was committed. The three negative proofs are not tautologies: each reads
a **real** repository file, proves the untouched source is accepted as a
CONTROL, tampers a **copy** under `os.tmpdir()`, and asserts the same check
rejects the copy. Each exits `2`, not `1`, when its real source is missing.

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy) | Rejection |
|---|---|---|---|---|
| `AC-AI-08-02` | status alignment `AC-AI-08-01` | real `TASK-AI-08.md` agrees with real register row 141 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-08-04` | dependency proof `AC-AI-08-03` | real declared dependency `TASK-AI-07` has a merge commit on `origin/main` | `dependencies` cell repointed to `TASK-AI-99` in a register copy | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-08-06` | bounded-repair contract `AC-AI-08-05` | real `scripts/ai/control.ps1` satisfies the contract | fail-closed budget comparison replaced by an unbounded one in a copy | `REPAIR_BUDGET_UNBOUNDED`, exit `1` |

Three defects were removed while validating the matrix, each of the classes this
repository has already had to repair once:

1. **The rules live in one module each, not in the rows.** The comparison
   `AC-AI-08-01` runs and the proof `AC-AI-08-02` runs are the same module,
   `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; likewise
   `dependency-merged.js` for `-03`/`-04` and `repair-budget-contract.js` for
   `-05`/`-06`. The invariant and its proof cannot drift apart, because neither
   carries a private copy of the rule.
2. **No command is stored inside a table cell.** A stored inline form of the
   bounded-repair check needed a JavaScript alternation and a comparison against
   `$MaxRepairBudget`; inside a markdown cell those reach Node mangled, and a
   `SyntaxError` exits `1`, which is the code a negative row expects. Every row
   is therefore a committed script under `tools/ai-brain/acceptance/`.
3. **The negative proofs fail closed outside the repository.** `AC-AI-08-14`
   spawns `AC-AI-08-02` from an empty temporary directory and requires exit `2`
   with `SOURCE_MISSING`; a proof that dies for an unrelated reason cannot be
   mistaken for a detection.

## Residual limitations

- Implementation of exact failure-evidence capture, the per-exact-HEAD repair
  budget and the checkpoint fields above is specified here and delivered during
  the implementation phase of `TASK-AI-08`. `AC-AI-08-05` asserts the bounded
  repair contract the real supervisor already satisfies today, so that extending
  the budget cannot silently remove it; it does not assert the extended behavior,
  which does not exist yet.
- Delivery register row 141 displays `BLOCKED_DEPENDENCY` while `TASK-AI-07` is
  merged in Git reality. The Control table stays strictly aligned to the register
  under `AGENTS.md` § Unit of delivery; clearing the block is the governed
  reconciler's job (`TASK-AI-19`), not a manual write.
- Register row 140 (`TASK-AI-07`) still reads `BACKLOG` although its work is
  merged and implemented, because no durable merge-evidence artifact carrying an
  exact-HEAD verdict exists for it. `AC-AI-08-03` therefore proves the dependency
  from Git rather than from the register status; it does not assert the register
  row, which would fail while the reconciler correctly refuses to write `MERGED`.
- Checkpoint restart semantics — resuming a repair across a machine reboot or a
  deleted worktree — remain owned by `TASK-AI-09`; this Work Item only persists
  the fields `TASK-AI-09` will resume.
