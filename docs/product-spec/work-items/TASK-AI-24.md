# TASK-AI-24 — Execute dispatch plans through AO session create

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-24` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `157` |
| Dependencies | `TASK-AI-16` (register row 149 `MERGED`, PR #58, merge commit `914ca697bf755fb97416db37d1b3433df22fbfc1`) |
| Assigned author | `CLAUDE` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-24.md`, `tools/ai-brain/executor.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/executor.test.js`, `tools/ai-brain/acceptance/ac-24-*.js`, `tools/ai-brain/acceptance/lib/dispatch-executor-contract.js`, `scripts/ai/control.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-24` |
| Pull Request | `pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `delivery_order` 157, `work_item_id` `TASK-AI-24`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BACKLOG`, therefore the Control table above records `BACKLOG` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 157, column `status` = `BACKLOG` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BACKLOG`. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- Unlike the neighbouring rows `TASK-AI-20`, `TASK-AI-21` and `TASK-AI-27`, this row's dependency block is not stale: `TASK-AI-16` is recorded `MERGED` in the register, and `AC-AI-24-03` proves it from Git as well.
- The `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written by the governed register reconciler (`TASK-AI-19`) or the controller, never by hand.
- `AC-AI-24-01` compares the `Status` cell above with register row 157 and fails if they diverge.

## Business outcome

The brain already decides which ready Work Item may start, on which model and account, and why each other item waits. Nothing acts on that decision. `planDispatch` in `tools/ai-brain/scheduler.js` has no caller outside its tests, and the controller launches workers by a separate rule: `Get-ShipDeAoHarnessCandidates` in `scripts/ai/control.ps1` maps the author name in the Work Item (`GEMINI` → `agy`, `9ROUTER` → `claude-code`) and `New-ShipDeAoSpawnArguments` builds `ao spawn`. Quota, cooldown, fitness and the escalation ladder therefore shape a plan that no launch reads.

This Work Item adds an executor that takes one plan and launches exactly its assignments through AO, while the planner stays a pure function. The split is the point of the register row: "the planner plans; a separate executor launches, so the plan stays testable". Both halves of that separation are asserted today on the real code (`AC-AI-24-05`, `AC-AI-24-07`), so the implementation cannot quietly give it up.

## Source references

- `tools/ai-brain/scheduler.js` — `planDispatch`, `DEFAULTS`, `IMPLEMENTATION_ROLES`, `REVIEW_ROLES`; header "It plans; it does not launch"
- `scripts/ai/control.ps1` — `Get-ShipDeAoHarnessCandidates`, `New-ShipDeAoSpawnArguments`, and its two callers (the initial spawn and the TASK-AI-07 failover)
- `docs/product-spec/work-items/TASK-AI-07.md` — cross-harness failover, which must keep the same Work Item, branch and worktree
- `docs/product-spec/work-items/TASK-AI-16.md` — the AO launch flags this Work Item depends on
- `docs/product-spec/work-items/TASK-AI-28.md` — cooldown observed inside `planDispatch`
- `AGENTS.md` § Role separation and § Unit of delivery — one writer per Work Item
- `AI-TOOL-03` in `AI-TOOLCHAIN-DECISIONS.md` — the implementation ceiling of one

## Preconditions and dependencies

- `TASK-AI-16` is merged (register row 149, PR #58). `AC-AI-24-03` proves this from Git.
- `planDispatch` exists, returns `{ assignments, deferred, utilisation, headrooms, cooldowns }`, and requires no launch capability itself (`AC-AI-24-05`).
- `New-ShipDeAoSpawnArguments` passes `spawn --project --kind --name --branch --harness --prompt` (`AC-AI-24-07`).

## Author boundary

`CLAUDE` is the assigned author. Scope is an executor that consumes a plan and launches its assignments through AO, plus the wiring that lets the controller use it.

Prohibited in this Work Item:

- Do NOT make `scheduler.js` launch, spawn, call the network or write files. `AC-AI-24-05` must stay green.
- Do NOT raise `maxImplementationAgents` or any other `DEFAULTS` value. That decision is `TASK-AI-42`.
- Do NOT change quota, fitness, cooldown or capability rules (`TASK-AI-26`, `TASK-AI-27`, `TASK-AI-28`).
- Do NOT feed outcomes back into `qualifiedRoles` (`TASK-AI-25`).
- Do NOT touch `.github/`, `scripts/verify-*` or `docs/product-spec/scripts/`.
- Do NOT advance the register status by hand.

## In scope

1. **An executor module** (`tools/ai-brain/executor.js`) that takes a plan returned by `planDispatch` and, for each assignment, produces the AO launch arguments and runs them through an injected runner, so a test can pass a fake runner and see exactly what would have been launched.
2. **Dry run by default.** Without an explicit execute flag the executor reports the launches it would make and makes none.
3. **Idempotent launch.** Before launching, the executor reads the running AO sessions and skips an assignment whose Work Item already has a writer, recording why.
4. **Harness from the assignment.** The harness is derived from the assignment's provider and account through a declared mapping; an assignment whose provider has no mapped harness is refused, naming the provider, never launched on a default.
5. **A launch record.** Every launch, skip and refusal is written as one JSON line carrying the Work Item, branch, account, model, harness, the plan's `fitReason` and the AO session id or the error.
6. **Controller wiring.** `control.ps1` may call the executor in place of the author-name mapping for new launches. The TASK-AI-07 failover path keeps its current behaviour.
7. **CLI.** `node tools/ai-brain/cli.js dispatch [--execute]` prints the plan and the launches.
8. **Unit tests** in `tools/ai-brain/test/executor.test.js`, no network and no real AO.

## Out of scope

- Changing what the planner decides.
- Concurrency above the current ceiling (`TASK-AI-42`).
- Measured outcomes feeding qualification (`TASK-AI-25`).
- Review dispatch through the Codex connector, which stays in `control.ps1`.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-24-R01` | **The planner never launches.** `scheduler.js` requires no process, network or thread capability; launching lives only in the executor. |
| `AI-24-R02` | **The executor launches only what the plan assigned.** A deferred item is never launched, and no item absent from `assignments` is launched. |
| `AI-24-R03` | **One writer per Work Item, checked at launch as well as at planning.** A plan can be stale by the time it runs; an assignment whose Work Item already has a running AO writer is skipped with reason `WORK_ITEM_ALREADY_WRITING`. |
| `AI-24-R04` | **The branch is always passed.** A launch without `--branch` is refused rather than attempted, because the worker would write to whatever branch it found. |
| `AI-24-R05` | **No default harness.** An assignment whose provider has no declared harness is refused, naming the provider. |
| `AI-24-R06` | **Dry run is the default.** Launching requires an explicit execute flag. |
| `AI-24-R07` | **A failed launch is recorded, not retried.** The executor records the AO error and stops for that item; retry and failover stay with `TASK-AI-07`. |
| `AI-24-R08` | **Every launch is traceable to the plan.** The launch record carries the plan's model, account, tier and `fitReason`. |
| `AI-24-R09` | **No secret in a launch record.** Prompts and records carry no credential, token or key. |

## UI states

No screen. The cockpit may show the launch record; states are launched, skipped (with reason), refused (with reason) and dry run.

## API, event and data impact

- No database, API or carrier change.
- New append-only launch record (JSON lines) under the existing handoff directory.
- No register schema change.

## Acceptance matrix

**Evidence boundary.** Every row runs against the real files in this repository or a copy of one written to `os.tmpdir()`. No row cites this document as evidence, no row compares two literals written into its own command, no command is stored inline in a table cell, and no row pins a count that drifts with the repository.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-24-01` | Control table status and delivery register row 157 cannot diverge | `node tools/ai-brain/acceptance/ac-24-01-status-alignment.js` | `0` | `Control status matches register row 157: BACKLOG (declared TASK-AI-24)` | `tools/ai-brain/acceptance/ac-24-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-24-02` | **Negative proof, must fail:** a tampered copy of this specification diverges from the real register and is detected | `node tools/ai-brain/acceptance/ac-24-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BACKLOG` | `tools/ai-brain/acceptance/ac-24-02-status-divergence.js`; command stderr |
| `AC-AI-24-03` | Register row 157 declares `TASK-AI-16`, and `TASK-AI-16` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-24-03-dependency-merged.js` | `0` | `TASK-AI-16 dependency verified: merged into origin/main for TASK-AI-24` | `tools/ai-brain/acceptance/ac-24-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-24-04` | **Negative proof, must fail:** a register copy naming a dependency with no merge commit is refused | `node tools/ai-brain/acceptance/ac-24-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-24-04-dependency-unproven.js`; command stderr |
| `AC-AI-24-05` | The real planner directly requires no launch capability (transitive requires are not followed), and `planDispatch` returns a plan that defers an item it cannot place | `node tools/ai-brain/acceptance/ac-24-05-planner-launches-nothing.js` | `0` | `PLANNER_LAUNCHES_NOTHING: scheduler.js directly requires no launch capability` | `tools/ai-brain/scheduler.js`, `tools/ai-brain/acceptance/lib/dispatch-executor-contract.js` |
| `AC-AI-24-06` | **Negative proof, must fail:** a copy of the real planner that requires `child_process` is rejected by the rule `AC-AI-24-05` runs | `node tools/ai-brain/acceptance/ac-24-06-planner-launch-detected.js` | `1` | `PLANNER_CONTRACT_VIOLATED: PLANNER_REQUIRES_LAUNCH_CAPABILITY: child_process` | `tools/ai-brain/acceptance/ac-24-06-planner-launch-detected.js`; command stderr |
| `AC-AI-24-07` | The controller's real launcher, with PowerShell comments stripped, names `spawn` with project, kind, name, branch, harness and prompt | `node tools/ai-brain/acceptance/ac-24-07-spawn-contract.js` | `0` | `SPAWN_CONTRACT_HOLDS: New-ShipDeAoSpawnArguments passes spawn with --project --kind --name --branch --harness --prompt` | `scripts/ai/control.ps1`, `tools/ai-brain/acceptance/lib/dispatch-executor-contract.js` |
| `AC-AI-24-08` | **Negative proof, must fail:** a copy of the controller whose launcher drops `--branch` is rejected by the rule `AC-AI-24-07` runs | `node tools/ai-brain/acceptance/ac-24-08-spawn-branch-dropped.js` | `1` | `SPAWN_CONTRACT_VIOLATED: SPAWN_FLAG_MISSING: --branch` | `tools/ai-brain/acceptance/ac-24-08-spawn-branch-dropped.js`; command stderr |
| `AC-AI-24-09` | The four negative proofs exit 2, not 1, where no repository exists | `node tools/ai-brain/acceptance/ac-24-09-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-24-09-outside-repository.js`; command stdout |
| `AC-AI-24-10` | The register does not overstate | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js`; command stdout |
| `AC-AI-24-11` | Documentation validation passes | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py`; command stdout |

### Why each negative proof is not vacuous

| Row | Negative proof of | CONTROL (real input accepted) | Tamper (copy in `os.tmpdir()`) | Rejection |
|---|---|---|---|---|
| `AC-AI-24-02` | `AC-AI-24-01` | the real specification agrees with row 157 | `Status` cell set to `READY_FOR_AUTHOR` | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-24-04` | `AC-AI-24-03` | `TASK-AI-16` has a merge commit on `origin/main` | `dependencies` cell set to `TASK-AI-99` | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-24-06` | `AC-AI-24-05` | the real `scheduler.js` has no violation | one `require('child_process')` prepended | `PLANNER_CONTRACT_VIOLATED`, exit `1` |
| `AC-AI-24-08` | `AC-AI-24-07` | the real launcher has every flag | the `"--branch", $Item.Branch` line removed from `New-ShipDeAoSpawnArguments` | `SPAWN_CONTRACT_VIOLATED`, exit `1` |

Each negative proof exits `2` when its source is missing (measured by `AC-AI-24-09`) and also exits `2` when a regression stops the rule detecting its tamper, so a broken proof never reports success with `0`. That second property is the defect `TASK-AI-39` repaired in its own proofs.

### One rule, one module

The planner and executor rules live once in `tools/ai-brain/acceptance/lib/dispatch-executor-contract.js`; `AC-AI-24-05` to `-08` all require it. The register pair reuses `lib/spec-status-alignment.js` and `lib/dependency-merged.js`, the modules the other Work Items already share.

### Observed baseline (evidence only, not asserted)

Every command in the matrix was run on this branch and produced the exit code and string stated. `AC-AI-24-05` reported the probe item deferred as `NO_ELIGIBLE_ACCOUNT`.

## Verification commands

```bash
node tools/ai-brain/acceptance/ac-24-01-status-alignment.js
node tools/ai-brain/acceptance/ac-24-02-status-divergence.js
node tools/ai-brain/acceptance/ac-24-03-dependency-merged.js
node tools/ai-brain/acceptance/ac-24-04-dependency-unproven.js
node tools/ai-brain/acceptance/ac-24-05-planner-launches-nothing.js
node tools/ai-brain/acceptance/ac-24-06-planner-launch-detected.js
node tools/ai-brain/acceptance/ac-24-07-spawn-contract.js
node tools/ai-brain/acceptance/ac-24-08-spawn-branch-dropped.js
node tools/ai-brain/acceptance/ac-24-09-outside-repository.js
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-24. The register records `BACKLOG`, so no verdict is claimed. |

## Residual limitations

- **The planner rule covers `scheduler.js` itself, not everything it requires.** `offerings.js` requires `agy-quota.js`, which requires `child_process` for its quota reader. The planning path calls only the pure `headroomFor` and `statusFrom` from it, measured at HEAD, but a module-level rule cannot prove a function is never called. The executor must not rely on the planner having no transitive launch capability.
- **The executor rows do not exist yet.** `executor.js` is not at HEAD, so `AI-24-R02` to `R09` have no positive acceptance row; they are delivered and tested during implementation. `AC-AI-24-05` to `-08` assert what the implementation must preserve.
- **`AC-AI-24-07` reads PowerShell source text.** It proves the launcher names every flag outside comments, not that AO accepts them; `control.ps1 -Action Test` covers the fixture spawn.

## Contradictions found in neighbouring specifications

1. **The register row says "AO session create"; the controller uses `ao spawn`.** `New-ShipDeAoSpawnArguments` builds `spawn --project … --kind worker`, and no call to a `session create` verb exists in `scripts/ai/`. This specification follows the code and asserts `spawn`; the register wording is left for the owner to correct, since hand-editing a register row is prohibited.
2. **Two dispatch authorities.** `AGENTS.md` § Author routing assigns the author by name in the Work Item (`GEMINI`, `CLAUDE`, `9ROUTER`), and the controller launches by that name, while `scheduler.js` assigns by capability, quota and fitness. Until the executor lands, the brain's plan cannot change which harness runs. This Work Item resolves the launch path but not the governance question of which authority wins when they disagree; `In scope` item 6 keeps the controller able to fall back.
