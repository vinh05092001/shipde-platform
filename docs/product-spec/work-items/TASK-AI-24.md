# TASK-AI-24 — Execute dispatch plans through AO session create

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-24` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `157` |
| Dependencies | `TASK-AI-16` (merged, PR #58, `914ca69`) |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/executor.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/executor.test.js`, `tools/ai-brain/acceptance/ac-24-*.js`, `docs/product-spec/work-items/TASK-AI-24.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-24-dispatch-executor` |
| Pull Request | `<URL>` |

## Business outcome

The dispatch planner (`tools/ai-brain/scheduler.js`, `planDispatch`) decides
which ready Work Item may start, on which account and model, and records why
every other item waits. Its own header states the design boundary: "It plans;
it does not launch." That boundary is correct and must survive — a planner
that also launches cannot be tested without launching agents.

Measured at HEAD (`4b0fa4b`), nothing consumes the plan. `git grep planDispatch`
finds callers only in `tools/ai-brain/test/accounts.test.js` and
`tools/ai-brain/test/cooldown.test.js`. The live launch path is
`scripts/ai/control.ps1`, which builds its own `ao spawn` arguments
(`New-ShipDeAoSpawnArguments`, line 3437) from a hard-coded author-to-harness
switch and never reads `planDispatch` output. The planner's quota, cooldown,
fitness and concurrency decisions are therefore advisory: an operator can be
shown a plan that the controller does not follow.

This Work Item delivers a separate, deterministic **executor** that takes a
plan produced by `planDispatch` and turns each assignment into exactly one AO
session launch, and nothing else. The planner stays pure; the executor owns
the side effect; the seam between them is a plain data structure that both
tests and humans can read.

## Source references

- `AGENTS.md` § Role separation — one writer per Work Item; author never
  approves own work.
- `tools/ai-brain/scheduler.js` — `planDispatch`, `DEFAULTS`
  (`maxImplementationAgents: 1`), `IMPLEMENTATION_ROLES`, `REVIEW_ROLES`.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-03` — concurrent
  implementation ceiling of one.
- `scripts/ai/control.ps1` — `New-ShipDeAoSpawnArguments`,
  `Get-ShipDeAoHarnessCandidates`, `Get-ShipDeAoSessionPayload` (the existing
  AO argument and response contract this executor must match).
- `docs/product-spec/work-items/TASK-AI-16.md` — Codex launch flags that make
  AO hooks and activity reporting work; the prerequisite for a launched
  session to be observable.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
  row 157 — registration; rows 158 (`TASK-AI-25`) and 175 (`TASK-AI-42`)
  depend on this item.

## Preconditions and dependencies

- `TASK-AI-16` is `MERGED` (PR #58, merge commit
  `914ca697bf755fb97416db37d1b3433df22fbfc1`), so the dependency is satisfied
  and this item is not blocked.
- The `ao` CLI is on PATH and `ao status` succeeds for project
  `shipde-platform`. The executor must detect when it is not (see `AI-24-R06`).
- Node.js v24 runtime.

## Author boundary

`CLAUDE` authors. This specification change is bounded to
`docs/product-spec/work-items/TASK-AI-24.md`. Implementation is bounded to the
Allowed paths in the Control table.

Prohibited in this Work Item:

- Editing `tools/ai-brain/scheduler.js` to launch anything. The planner stays
  side-effect free.
- Editing `scripts/ai/control.ps1`. Switching the controller over to the
  executor is a separate integration decision (see Out of scope).
- Raising `maxImplementationAgents` above `1` or any other limit; that is
  `TASK-AI-42`.
- Editing the delivery register status by hand; write-back belongs to the
  `TASK-AI-19` reconciler.
- Author self-approval.

## In scope

- `tools/ai-brain/executor.js` exporting `executePlan(plan, options)`.
  `options` carries an injectable `runAo(args) -> { exitCode, stdout, stderr }`
  so tests never start a real agent, plus `project`, `dryRun` and `now`.
- Translation of each `plan.assignments[]` entry into one argument vector that
  is byte-identical in shape to `New-ShipDeAoSpawnArguments`: `spawn --project
  <p> --kind worker --name <name> --mode <chat|tui> --branch <branch>
  --harness <harness> --prompt <prompt>`.
- Parsing the AO response into a session id using the same accepted shapes as
  `Get-ShipDeAoSessionPayload` (`session`, nested `session`, `id` /
  `sessionId` / `session_id`).
- A result record per assignment: `{ workItemId, role, offeringId, args,
  outcome: LAUNCHED | REFUSED | FAILED | DRY_RUN, sessionId, detail }`, and a
  summary `{ launched, refused, failed }`.
- `node tools/ai-brain/cli.js dispatch --dry-run` (default) and
  `node tools/ai-brain/cli.js dispatch --execute`, printing the plan, the
  exact argument vectors, and the result records.
- Unit tests in `tools/ai-brain/test/executor.test.js` and acceptance scripts
  `tools/ai-brain/acceptance/ac-24-*.js` following the control-step pattern of
  `ac-07-13-forbidden-lifecycle.js`.
- A short section in `AI-TOOLCHAIN-DECISIONS.md` recording the planner /
  executor split.

## Out of scope

- Replacing the launch path inside `scripts/ai/control.ps1`.
- Feeding outcomes back into `qualifiedRoles` (`TASK-AI-25`).
- Changing the concurrency ceiling (`TASK-AI-42`).
- Monitoring, killing or restarting sessions after launch.
- Account or quota storage changes (`TASK-AI-26`..`TASK-AI-31`).

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-24-R01` | The executor launches only what `plan.assignments` contains. `plan.deferred` entries are never launched, and the executor never re-ranks, substitutes an account, or picks an alternative from `alternatives`. |
| `AI-24-R02` | One launch per assignment. A retry after `FAILED` is not performed inside the same call; a new plan is required, so quota and cooldown are re-evaluated. |
| `AI-24-R03` | Default is dry run. Without `--execute` (CLI) or `dryRun: false` (API), `runAo` is never called and every record is `DRY_RUN` with the exact argument vector. |
| `AI-24-R04` | Defence in depth for the safety invariant: before launching, the executor refuses (`REFUSED`, detail `DUPLICATE_WRITER`) a second non-review assignment for the same `workItemId` or `branch` within one plan, even though `planDispatch` should never emit one. |
| `AI-24-R05` | Defence in depth for the stability limit: the executor refuses (`REFUSED`, detail `IMPLEMENTATION_CEILING`) implementation assignments beyond `plan.utilisation.maxImplementation`. It does not read or raise the limit itself. |
| `AI-24-R06` | Fail closed on AO: a non-zero exit, empty stdout, unparseable JSON, or JSON without a session id yields `FAILED` with the AO exit code and stderr in `detail`. It is never recorded as `LAUNCHED`. If any record is `FAILED`, the CLI exits `1`. |
| `AI-24-R07` | An assignment missing `branch`, `workItemId` or a resolvable harness is `REFUSED` (`INCOMPLETE_ASSIGNMENT`) before AO is called. |
| `AI-24-R08` | The executor writes no register row and no Work Item file. Its only side effect is the `ao spawn` call. |
| `AI-24-R09` | Argument vectors are passed as an array to the child process, never concatenated into a shell string, so a prompt containing quotes or `|` cannot change the command. |

## UI states

No web UI. Operator console states for `cli.js dispatch`:

- **DRY RUN**: lists each assignment with its argument vector, then
  `Dispatch dry run: N planned, 0 launched`. Exit `0`.
- **EXECUTED**: `Dispatch executed: L launched, R refused, F failed`. Exit `0`
  when `F = 0`, else `1`.
- **NOTHING TO DO**: `Dispatch: 0 assignments (N deferred)` with each deferral
  reason. Exit `0`.

## API, event and data impact

No database, API route or event schema change. New module
`tools/ai-brain/executor.js` and new CLI subcommand `dispatch`. The plan object
returned by `planDispatch` is consumed read-only; its shape is not changed.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-24-01` | Dry run never calls AO | `node tools/ai-brain/acceptance/ac-24-01-dry-run-no-launch.js` exits 0 and prints `DRY_RUN_AO_CALLS: 0` | stdout, including a `CONTROL:` line showing the same plan with `dryRun: false` calls the stub once per assignment |
| `AC-AI-24-02` | Argument vector matches the controller contract | `node tools/ai-brain/acceptance/ac-24-02-spawn-args-contract.js` exits 0 and prints `SPAWN_ARGS_MATCH_CONTROL_PS1: true` | stdout; the script reads the flag order from `New-ShipDeAoSpawnArguments` in `scripts/ai/control.ps1` on disk, with a `CONTROL:` line showing a reordered vector rejected |
| `AC-AI-24-03` | Deferred items are never launched | `node tools/ai-brain/acceptance/ac-24-03-deferred-not-launched.js` exits 0 and prints `DEFERRED_LAUNCHED: 0` | stdout |
| `AC-AI-24-04` | Duplicate writer refused | `node tools/ai-brain/acceptance/ac-24-04-duplicate-writer.js` exits 0 and prints `REFUSED: DUPLICATE_WRITER` | stdout, with the stub AO call count for the duplicate equal to `0` |
| `AC-AI-24-05` | AO failure is not reported as a launch | `node tools/ai-brain/acceptance/ac-24-05-ao-fail-closed.js` exits 0 and prints `AO_FAILURES_RECORDED_AS_LAUNCHED: 0` for non-zero exit, empty stdout, invalid JSON and missing id | stdout listing the four cases |
| `AC-AI-24-06` | Planner remains side-effect free | `node tools/ai-brain/acceptance/ac-24-06-planner-pure.js` exits 0 and prints `SCHEDULER_LAUNCH_REFERENCES: 0` | stdout; a `CONTROL:` line shows a copy of `scheduler.js` with an injected `child_process` require being detected |
| `AC-AI-24-07` | Suite is not vacuous | `node tools/ai-brain/acceptance/ac-24-07-suite-invariant.js` exits 0 and prints `SUITE_NOT_VACUOUS:` with `executor.test.js` among the resolved files | stdout |
| `AC-AI-24-08` | Outside the repository | each `ac-24-*.js` run from an empty temp directory exits `2` with `SOURCE_MISSING` | stdout |

## Verification commands

```powershell
node --test "tools/ai-brain/test/*.test.js"
Get-ChildItem tools/ai-brain/acceptance/ac-24-*.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw $_.Name } }
node tools/ai-brain/cli.js dispatch --dry-run
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| — | — | — | Not yet reviewed. |

## Residual limitations

- The controller (`scripts/ai/control.ps1`) keeps its own launch path after
  this item. Until an integration Work Item switches it to the executor, the
  plan and the live launch can still diverge; this item makes the plan
  executable, not mandatory.
- The AO CLI exposes session creation as `ao spawn`; the register title's
  "session create" names the operation, not a literal subcommand.
- Outcome measurement for `qualifiedRoles` is deferred to `TASK-AI-25`.
