# TASK-AI-142 — Hermes chat brain wired to the Controller

## Operator ACP assignment (2026-10-16)

Codex is assigned to let the Controller observe Hermes through structured ACP events.
This extends allowed paths to `tools/ai-brain/hermes-acp.js` and
`tools/ai-brain/test/task-ai-142-hermes-acp.test.js` alongside the existing session adapter.
Use `node tools/ai-brain/cli.js chat --acp --prompt "..."` for one explicit turn.
The selected candidate still supplies the Controller-owned config; ACP starts a fresh
session and verifies the advertised model before sending the prompt. Existing CLI chat
sessions cannot be passively monitored over ACP. ACP turns currently do not resume history
or automatically retry/fail over: failures stop rather than replay a possibly applied tool.
`data/hermes/acp-status.json` contains lifecycle metadata only, not prompts, reasoning,
tool content or credentials. Unsupported host requests fail closed; permission requests
are cancelled. A `turn_ended` result is transport evidence, never work-item completion.
The default timeout is 120 seconds (`--acp-timeout-ms` overrides it). No ACP dependency installation or live provider call
is authorized by this implementation; verification uses an offline JSON-RPC subprocess.

## Writer selection integration assignment (2026-10-15)

The operator assigns Codex to finish `fix/task-ai-142-writer-selection-review`, integrate current main including #319–#323, run the full brain suite and required checks, and submit the resulting SHA through PR/CI and fresh independent review. An older Gemini PASS applies only to its reviewed SHA. The implementation author cannot supply the independent PASS. No additional model, provider request or live Hermes run is authorized in this assignment. The separate deadline investigation starts only after this writer selection PR merges, on a new branch from main.

The implementation expands router inventory independently of OpenCode declarations, separates listed/configured/probed evidence, retains task/credential/route/quota gates, caches unchanged JEV assessments with deterministic failure fallback, and redacts worker-environment secrets in writer launch results. Fixture acceptance lives in `task-ai-142-writer-selection.test.js`, `task-ai-142-writer-probe.test.js`, and `task-ai-142-review-repair-result.test.js`. Source/key, isolation-refresh and pre-push guard repairs in `w-fix578` are excluded. Full validation and PR evidence are recorded in `WRITER-SELECTION-HANDOFF.md` and the PR body.

## Control

| Field           | Value                                                                                                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Work Item ID    | `TASK-AI-142`                                                                                                                                                                                                                                          |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                  |
| Status          | `IN_PROGRESS`                                                                                                                                                                                                                                          |
| Delivery order  | `252`                                                                                                                                                                                                                                                  |
| Dependencies    | `TASK-AI-141; TASK-AI-132; TASK-AI-50`                                                                                                                                                                                                                 |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                               |
| Risk            | `MEDIUM`                                                                                                                                                                                                                                               |
| Complexity      | `standard`                                                                                                                                                                                                                                             |
| Allowed paths   | `tools/ai-brain/hermes-session.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/skills/shipde-controller/SKILL.md`; `scripts/ai/hermes-chat.ps1`; `tools/ai-brain/test/task-ai-142-hermes-session.test.js`; `docs/product-spec/work-items/TASK-AI-142.md` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-142-hermes-session`                                                                                                                                                                                                                      |
| Pull Request    | `Pending`                                                                                                                                                                                                                                              |

## Business outcome

The operator chats directly with Hermes. Hermes understands goals, plans, and reports back. The Controller (`tools/ai-brain`) retains model/account/harness choice, quota, concurrency, fallback, checkpoint, and dispatch. Claude only supervises and is not in the direct message path.

## Source references

- `.upstream-tmp/TASK-AI-142-spec.md`
- `AGENTS.md`: Shared Agent Contract, role separation, security and secret rules
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `tools/ai-brain/harness.js`: Hermes adapter (v0.21.4 pinned contract)
- `tools/ai-brain/routing.js`, `tools/ai-brain/ranking.js`, `tools/ai-brain/candidates.js`, `tools/ai-brain/decisions.js`, `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/sources.js`

## Preconditions and dependencies

- Monorepo baseline with Controller infrastructure in `tools/ai-brain`.
- Hermes v0.21.4 contract established in TASK-AI-50 and TASK-AI-63.
- Source registry, candidate identity, and decision logging are operational.

## Author boundary

- Part H1 (Writer A): owns `tools/ai-brain/goals.js`, CLI `goal` commands (`start`, `amend`, `plan`, `run`, `status`, `stop`, `resume`).
- Part H2 (Writer B - GEMINI): owns `tools/ai-brain/hermes-session.js`, CLI `chat` and `goal session` entries, skill `tools/ai-brain/skills/shipde-controller/SKILL.md`, operator script `scripts/ai/hermes-chat.ps1`, and unit tests in `tools/ai-brain/test/task-ai-142-hermes-session.test.js`.
- Part H3: live acceptance on the supervisor/operator machine after H1 and H2 merge.

## In scope

- Part H2 implementation:
  - Model selection using existing routing/ranking for reasoning/planner role with 7-part key (`harness=hermes`).
  - Decision logging via `decisions.recordDecision`.
  - Providers config file generated under `data/hermes/` containing only `base_url` and env var NAME (no secrets).
  - Session persistence in `data/hermes/session.json` (`sessionId`, `candidateKey`, `goalIds`).
  - Hermes argv construction: `-m <modelId> --provider <provider-name> --continue <sessionId> --create-if-missing` plus skill `-s`.
  - Relaunch loop with same `--continue <sessionId>` on route/quota/model failure; local failure does not cool down model.
  - Skill file `tools/ai-brain/skills/shipde-controller/SKILL.md` forbidding self-model-picking, subagent spawning, and claiming completion without evidence.
  - CLI `chat` and `goal session` commands in `tools/ai-brain/cli.js`.
  - Operator script `scripts/ai/hermes-chat.ps1`.
  - Deterministic unit tests with injectable dependencies in `tools/ai-brain/test/task-ai-142-hermes-session.test.js`.

## Out of scope

- Part H1 `goals.js` implementation (owned by Part H1).
- Live execution against real Hermes binary in automated test environments lacking binary/keys.
- Subagent spawning by Hermes.

## H2 open questions

The following points were verified against the real Hermes v0.21.4 binary during review:

1. **Provider config format:**
   - The `HERMES_HOME` environment variable selects Hermes' home dir (`config.yaml`, `sessions`, `state.db`). Launching Hermes with `HERMES_HOME=<repo>/tools/ai-brain/data/hermes/home` ensures Controller-owned configuration and persistent sessions.
   - `--ignore-user-config` / `HERMES_IGNORE_USER_CONFIG=1` makes Hermes skip `config.yaml` entirely; it must NOT be passed on the chat path.
   - In `config.yaml`, a custom provider entry supports fields: `name`, `base_url`, `key_env`, `api_mode`, `model`, `models`, `context_length`, etc. `key_env` is the name of the environment variable holding the key (never `api_key`). Selected via `hermes chat --provider <name> -m <modelId>`.
2. **Environment variable for provider credentials:**
   - Hermes v0.21.4 supports `key_env` naming the environment variable holding the key (never `api_key`).
3. **Interactive command:**
   - Interactive chat command: `hermes chat [-m MODEL] [--provider P] [--continue SESSION_NAME --create-if-missing] [-s SKILLS]`. The `chat` subcommand is standard.
4. **Session resumption semantics:**
   - Sessions persist under `$HERMES_HOME/sessions`. Passing `--continue <sessionId> --create-if-missing` connects to or creates the persistent named session.

## Acceptance matrix

| AC/Test ID        | Scenario                          | Expected result                                                                                     | Evidence required                                        |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `AC-AI-142-H2-01` | Candidate selection for reasoning | 7-part key with `harness=hermes`, ranked by quality/priors, decision recorded                       | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-02` | Provider config generation        | Written under `data/hermes/`, contains base_url and key env var NAME, zero secrets                  | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-03` | Hermes argv construction          | Emits `-m <modelId> --provider <provider-name> --continue <sessionId> --create-if-missing` and `-s` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-04` | Session persistence               | Stored in `data/hermes/session.json` with `{sessionId, candidateKey, goalIds}`                      | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-05` | Route/model failure recovery      | Reselects candidate and relaunches with same `--continue <sessionId>`                               | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-06` | Local failure handling            | Local environment failure does not cool down or exclude the model                                   | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-07` | CLI entries                       | `chat` and `goal session` commands work and output JSON                                             | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-08` | Skill & script integration        | Skill forbids unauthorized behaviors; powershell entry point forwards to CLI                        | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-142-hermes-session.test.js`
- `npx prettier --write tools/ai-brain/hermes-session.js tools/ai-brain/cli.js tools/ai-brain/skills/shipde-controller/SKILL.md scripts/ai/hermes-chat.ps1 tools/ai-brain/test/task-ai-142-hermes-session.test.js docs/product-spec/work-items/TASK-AI-142.md`
- `git diff --check`

## Residual limitations

- Real binary verification is deferred to Part H3 live acceptance per prompt requirements (no binary or provider keys in this account).

## Part H1 record (goal store and Controller contract)

### Control

| Field           | Value                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-142`                                                                                                                                      |
| Feature ID      | `N/A`                                                                                                                                              |
| Status          | `IN_PROGRESS`                                                                                                                                      |
| Delivery order  | `252`                                                                                                                                              |
| Dependencies    | `TASK-AI-109`, `TASK-AI-132`, `TASK-AI-141`                                                                                                        |
| Assigned author | `GEMINI`                                                                                                                                           |
| Risk            | `MEDIUM`                                                                                                                                           |
| Allowed paths   | `tools/ai-brain/goals.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-142-goals.test.js`; `docs/product-spec/work-items/TASK-AI-142.md` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                   |
| Branch          | `feat/task-ai-142-goal-contract`                                                                                                                   |
| Pull Request    | `Pending`                                                                                                                                          |

### Business outcome

The operator chats directly with Hermes. Hermes understands goals, plans, and reports back. The Controller (`tools/ai-brain`) maintains model/account/harness choice, quota, concurrency, fallback, checkpointing, and dispatch. Claude supervises and is not in the message path.

Part H1 delivers the Goal store and Controller contract (`tools/ai-brain/goals.js` and `node tools/ai-brain/cli.js goal <sub>`). All command output is JSON on stdout. Exit code != 0 on refusal.
Decision log entries link `goalId -> workItemId -> candidateKey -> session -> commit -> review`.

### Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
- `tools/ai-brain/plan-adapter.js` (TASK-AI-109)
- `tools/ai-brain/planner.js` (TASK-AI-60)
- `tools/ai-brain/next-runner.js` (TASK-AI-132)
- `tools/ai-brain/decisions.js` (TASK-AI-49)
- `.upstream-tmp/TASK-AI-142-spec.md`

### Preconditions and dependencies

- `tools/ai-brain/plan-adapter.js` and `tools/ai-brain/planner.js` are merged and available.
- `tools/ai-brain/next-runner.js` and `tools/ai-brain/decisions.js` are merged and operational.

### Author boundary

- Part H1 is authored by GEMINI in worktree `ai142h1`.
- Allowed paths: `tools/ai-brain/goals.js`, `tools/ai-brain/cli.js` (goal command only), `tools/ai-brain/test/task-ai-142-goals.test.js`, and `docs/product-spec/work-items/TASK-AI-142.md`.
- Does not edit files owned by Part H2 (`tools/ai-brain/hermes-session.js`, `tools/ai-brain/skills/shipde-controller/SKILL.md`, `scripts/ai/hermes-chat.ps1`, `tools/ai-brain/test/task-ai-142-hermes-session.test.js`).
- Never writes credentials to disk, logs, or argv.
- No `--no-verify`, no `core.hooksPath`, no `git reset --hard`, no `git clean`.

### In scope

- `tools/ai-brain/goals.js` implementation:
  - `goal start --text "<goal>"` -> creates `data/goals/<goalId>/goal.json` `{goalId, text, constraints[], status: OPEN, createdAt}`. Idempotent per identical open text.
  - `goal amend <goalId> --text "<extra>"` -> appends to constraints without creating a new run.
  - `goal plan <goalId> --file <plan.md>` -> validates tasks (objective, source refs, dependencies, allowed paths, acceptance criteria, verification commands), cycle check, writes Work Item docs (`docs/product-spec/work-items/<ID>.md`) and register rows linked to `goalId`; on failure status `BLOCKED` with `questions[]`.
  - `goal run <goalId>` -> starts `next --loop` restricted to goal items via detached child process and lock file; duplicate calls report running pid.
  - `goal status <goalId>` -> reports per item: state, candidate key, branch, commit SHA, test result, review verdict, last decision id.
  - `goal stop <goalId>` / `goal resume <goalId>` -> uses checkpoints; resume skips items already `PASSED` / `MERGED`.
  - Decision log entries link `goalId -> workItemId -> candidateKey -> session -> commit -> review`.
- CLI wiring in `tools/ai-brain/cli.js`: `node tools/ai-brain/cli.js goal <sub>`.
- Unit tests in `tools/ai-brain/test/task-ai-142-goals.test.js`.

### Out of scope

- Part H2 Hermes session binding, skill file authoring, and interactive chat script.
- Modifying `next-runner.js`, `orchestrate.js`, or other existing execution components.

### Business rules and edge cases

- A model must not invent business rules or mark work complete. A plan task missing a source, an acceptance criterion, or a verification command is `BLOCKED` with a concrete question.
- All output is structured JSON on stdout so callers (Hermes, scripts) can parse cleanly.
- Fail-closed: non-zero exit code on refusal or validation failure.
- Concurrency control: single running instance per goal enforced by `run.lock`.

### UI states

- N/A (headless controller and CLI tool surface).

### API, event and data impact

- Goal store schema: `data/goals/<goalId>/goal.json`:
  ```json
  {
    "goalId": "G-1234",
    "text": "Goal description",
    "constraints": ["constraint 1"],
    "status": "OPEN",
    "createdAt": "2026-10-12T...",
    "updatedAt": "2026-10-12T...",
    "items": ["GOAL-G-1234-1"]
  }
  ```
- Lock file: `data/goals/<goalId>/run.lock`:
  ```json
  {
    "pid": 12345,
    "goalId": "G-1234",
    "startedAt": "2026-10-12T..."
  }
  ```

### Acceptance matrix

| AC/Test ID | Scenario                                          | Expected result                                                                                 | Evidence required                               |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| H1-R01     | `goal start --text "<goal>"`                      | Creates `data/goals/<goalId>/goal.json`; identical text is idempotent                           | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R02     | `goal amend <goalId> --text "<extra>"`            | Appends constraint to `constraints[]`, updates `updatedAt`, no new run                          | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R03     | `goal plan` missing sources/verification/criteria | Returns `status: BLOCKED` with concrete questions in `questions[]`                              | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R04     | `goal plan` with valid plan                       | Writes Work Item docs and register rows; status `PLANNED`                                       | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R05     | `goal run` single instance                        | Detached start creates `run.lock`; second call reports running pid                              | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R06     | `goal status` per item inspection                 | Returns state, candidate key, branch, commit SHA, test result, review verdict, last decision id | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R07     | `goal stop` and `goal resume`                     | Stops running pid, writes stop file; resume skips `PASSED`/`MERGED` items                       | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R08     | Decision log linking                              | Entries link `goalId -> workItemId -> candidateKey -> session -> commit -> review`              | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R09     | CLI JSON output                                   | All subcommands output JSON on stdout; non-zero exit code on refusal                            | `tools/ai-brain/test/task-ai-142-goals.test.js` |

### Verification commands

- `node --test tools/ai-brain/test/task-ai-142-goals.test.js`
- `npx prettier --check tools/ai-brain/goals.js tools/ai-brain/cli.js tools/ai-brain/test/task-ai-142-goals.test.js`
- `git diff --check`

### Residual limitations

- Part H2 Hermes session selection, custom config binding, and `shipde-controller` skill file are delivered in Part H2.
- Live acceptance across chat and controller runs in Part H3 following merge of H1 and H2.

### H3 live: independent review repair for narrow test commands, fail-closed truncation, and diagnostic scoping (2026-10-19)

Addressing review findings for PR #404:
1. Bare test names in gate failures are resolved to concrete test files from gate output/summary or allowed paths; if unresolved, no command is emitted to avoid executing the whole suite.
2. When narrow commands cannot be derived (including UNPARSED_FAILURE), the repair prompt omits the Tests command line rather than falling back to the full test suite.
3. Command output truncation and gate summary truncation fail closed when limits are missing or non-positive.
4. Attempt-level result `res` is scoped inside the candidate loop; host gate failure details travel on the session and do not leak across attempts.
5. Extracted `formatHostGateDiagnostics` helper to eliminate duplication and enforce fail-closed truncation.

### H3 live: narrow repair test commands, truncated prompt output, and host-gate failure diagnostics (2026-10-19)

Live trial 17 (19/10): a successful writer (exit 0) failed the host gate. The subsequent host-gate repair attempt executed the full test suite `node --test tools/ai-brain/test/`, generating massive tool output that triggered REQUEST_TOO_LARGE, killing the worker. The resulting host_gate_failed failure record did not capture which checks failed.
Repairs:
1. Repair prompt narrows test commands to gate.failures only (`deriveNarrowTestCommands`), preventing execution of the full test suite during host-gate repair.
2. Prompt host gate command output is bounded by `dispatch.maxPromptCommandOutputChars` loaded from `sources.json` (no hardcoded numeric limits in code).
3. Failed and host_gate_failed decision and checkpoint records capture individual failing check names and a concise summary bounded by `dispatch.maxHostGateSummaryChars`.
4. A host-gate repair killed by REQUEST_TOO_LARGE remains retryable when alternative candidates exist.

### H3 live: the host gate runs the brain suite on a clean checkout of HEAD (2026-10-19)

Live FEAT-AUTH-05 run (19/10 14:17): 7 next-runner, route-health and account-registry tests failed in the host checkout (hermes-live), which holds live Controller state under tools/ai-brain/data, but passed on the base run's clean worktree, so they counted as new failures and blocked the writer. The gate now runs the suite on a detached clean worktree of HEAD (removed afterwards); if one cannot be created it runs in place as before.

### H3 live: host-gate base failures match by name without run duration (2026-10-19)

Live trial 19 of goal G-F622511E (19/10): the writer and reviewer commits were clean, but node --test prints each failure as `✖ <name> (<duration>ms)`; the run and the base run of the same pre-existing failure differed only in duration, so all 7 base failures counted as new and the host gate failed. Failure names are now parsed once, with the duration suffix removed, for both the run and the base run; a genuinely new failure is still reported.

### H3 live: the writer route-probe window is not charged with capability proof time (2026-10-18)

Live trial 15 of goal G-F622511E (18/10 15:59Z) ended PROBE_BUDGET_EXHAUSTED without probing a single route: #388 started the writer route-probe window at `now - capabilityProbeDurationMs`, so slow CLI capability proofs spent it first. Capability proofs keep their own `schemaProbeBudgetMs`; the route window now starts when route probing starts and its length is `probeBudgetMs` from the dispatch configuration instead of a module constant.

### H3 live: pool writer job identity and bounded local fallback (2026-10-18)

Trial 14 recorded an agy-pool writer exit 0 with no durable session identity,
then HARNESS_INVALID_JSON and an immediate item stop. `resolveLauncher` previously
used the adapter/scheduler path, which neither bound the result to a pool job nor
returned a launch handle. `readSessionId` therefore fell through to stdout JSON
parsing; the missing-session branch in orchestration stopped selection.

Authorized external pool writers now use the existing locked pool submission
path. The pool allocates a job UUID at submission, writes account/job identity
into job.json before execution, retains a per-job receipt, and returns that same
identity in result metadata. Executor reads it through the pool adapter contract,
independently of prose stdout and without claiming isolated execution. No PID,
time-derived id, account-only id or latest-session lookup is used. Reusing an
account creates a distinct job while retaining the earlier receipt.

A candidate-local session failure is recorded with its exact key and cause,
then skipped only for this item invocation. It consumes no upstream attempt or
provider cooldown. The next writer is selected by the Controller's existing
ranking. `dispatch.maxLocalWriterFallbacks` bounds the number of transitions;
exhaustion records LOCAL_WRITER_FALLBACK_LIMIT with each candidate/reason. Existing
isolation-verdict stops and repeated identical infrastructure-failure stops remain.
The agy authorization gate is unchanged. Tests use temporary repos/pool files and
mock adapter/scheduler boundaries; no machine fixture data is read by tests.

The historical decision snapshot retains exit/session metadata but no writer
stdout, so the regression uses explicitly synthetic prose. It proves the protocol
path and fallback, not that the historical writer completed the work. No real
goal replay is part of this validation.

### H3 live: exact route evidence and measured probe ordering (2026-10-18)

Repair of the `2b783b56` review: one shared `route-evidence.js` matcher binds work evidence to the full candidate identity (transport, path, gateway, upstream, account, quota scope and full model identifier). Missing gateway/account data and matching model suffixes cannot borrow another route's proof. Freshness reads `dispatch.routeEvidenceMaxAgeMs` (preserving the existing 24-hour window). API/level-1 success may inform route availability; only `WORK_ITEM_PASS` or passed level 2/3 counts as completed work. The agy writer authorization gate remains unchanged.

Probe order uses exact work/availability observations, then measured `elapsedMs` from route-health or evidence; unknown cost uses the existing dispatch `probeTimeoutMs`. Harness names receive no numeric priority. Rejection diagnostics share `sampleRepresentative` across every harness/reason, retaining the existing overall decision-log bound without named lane quotas. Dispatch dry-run and isolated goal ranking apply the same ordering.

Offline regression includes a checked-in, explicitly bounded sample from trial 14's selected decision (two ranked identities and ten recorded rejection identities), with no credentials, launch metadata or machine paths. The integration drives both `dispatchCommand --dry-run` and `runOrchestration` with fixture-only capability results and a fake writer launcher. It compares the generated, pre/post capability and pre-ranking candidate sets, then verifies the selected identity reaches the launcher. Sample counts: 12 generated, 12 at capability/ranking gates, 2 ranked and 10 rejected; these are fixture counts, not a claim about the uncapped live inventory. Tests never read the original snapshot or the host account registry.

### H3 live: live route prioritization, fast HTTP probe priority, and non-starving decision log representation (2026-10-18)

Historical proposal in rejected SHA `2b783b56`, superseded by the exact-identity repair above: the original change introduced `sampleRepresentative`, but also used harness-name priorities and named lane quotas, and let API evidence satisfy work proof. Those parts failed review and are removed by the repair. The generic representative sampling remains.

### H3 live: scheduled resume selects an open goal and respects live owners (2026-10-18)

`GoalResume` registration and `goal-resume.ps1` accept an optional goal ID.
Without it, the script selects the first directory by name whose
`goal.json` reports OPEN, PLANNED or RUNNING and whose lock has no live owner.
An explicit goal also respects its live lock. Malformed lock ownership fails
closed; locks are never deleted by the scheduler, and the Controller still owns
atomic lock acquisition. Tests invoke PowerShell against temporary goals and a
stub CLI; the machine-data gate disables machine/user environment loading.
The existing scheduled task remains untouched; the operator decides activation.

### H3 live: configured writer selection and item duration limits (2026-10-18)

Dispatch config now owns `maxWriterSelectionRounds` and `maxItemDurationMs`.
Each item stops retrying when either limit is reached, with an explicit terminal
code and counts of observed rejection/failure reasons. Selection-only refusals
consume selection rounds; the existing `maxTurns` still counts actual launches.
Capability and route probes share the item deadline and worker launch timeouts
are capped by its remaining duration. Defaults come from versioned `sources.json`;
invalid limits fail closed. Regression fixtures inject routes and clocks, with no
machine data or provider calls.
### H3 live: writers are schema-checked after the run, not before selection (2026-10-18)

Operator decision 2026-10-18: trials 10-13 of goal G-F622511E refused every agy-pool and Codex writer because the pre-selection jsonSchema proof (a full CLI launch) timed out or ran out of budget. The writer roles (author.foundation, author.lowrisk) no longer require jsonSchema before selection; the writer result is still validated after the run (WRITER_RESULT_INVALID_JSON), and the host gate and exact-SHA review still gate the commit. Planner and reviewer roles keep the requirement.

### H3 live: configurable probe budget, probe ordering by evidence, and HTTP-first capability verification (2026-10-17)

Operator decision 2026-10-17 23:10: the agy pool may write (writerEnabled/allowWriter true in sources.json). Tests set the flags explicitly rather than reading the tracked value.
PR C moves hard-coded probe budgets (`probeBudgetMs`, `maxConcurrentProbes`, `probeTimeoutMs`, `probeSafetyMarginMs`, `schemaProbeBudgetMs`) into `sources.json.dispatch`. Individual probe timeouts adapt to measured route duration (`elapsedMs + safetyMarginMs`) when available and fall back to configured `probeTimeoutMs`. Route probe ordering (`orderProbeRoutes`) puts routes with fresh successful evidence ahead of higher-scored routes without evidence; an unevidenced route is never ranked above an evidenced route. `agy-pool` writer permission is governed by registry configuration (`writerEnabled: false`, default OFF). Capability verification probes cheap HTTP routes first, so routes failing HTTP preflight (such as 402 monthly limits) never execute schema checks. HTTP-routed models (9Router, OpenCode-direct, direct-http) verify capabilities through direct OpenAI-compatible HTTP requests without spawning CLI harnesses. Pure CLI harness capability proofs (Codex, agy-pool) persist to evidence and are reused across rounds without re-execution.

### H3 live: verify unknown writer capabilities instead of inventing missing capabilities (2026-10-17)

Review fixes: capability probing in dispatch runs only through an injectable seam and makes no network call in dry-run or tests unless a probe or fetch is injected; direct HTTP probing is chosen from the route (opencode-direct with a source endpoint, direct-http), not from an http accessPath, so loopback daemon harnesses are not probed as direct HTTP; a missing registry no longer falls back to the machine sources.json; the writer schema timeout comes from the existing route/profile timeout.
`undefined` capability is now `CAPABILITY_UNVERIFIED`, kept in the explicit
`needsCapabilityProbe` group and excluded from ranking until checked. Only an
observed `false` produces `CAPABILITY_MISSING`, with the probe's real reason.
Registry, catalogue and harness Boolean declarations carry provenance and do not
serve as runtime proof. Account context-window declarations cannot supply a
per-model context window; documented model context metadata remains usable.

The shared verifier checks JSON schema by a strict nonce-bound writer-result
contract and checks tools by an actual forced function call carrying a fresh nonce.
HTTP probes use the selected source endpoint, credential environment variable,
headers and wire model. CLI checks reuse `writer-schema.js`; tools additionally
require tool-use telemetry observed by the isolated launcher (or actual pool event
output). Returning valid JSON alone does not prove tools. No CLI/harness gets an
implicit tools capability.

Timestamped results, including real failed probes, are persisted per seven-part
route and configuration binding in `evidence.json.capabilityProbes`. Each result
merges into the latest store so other runtime evidence is retained. Authorization
refusals, missing credentials and unattempted checks stay unknown, are not cached
as failed capabilities, and do not open a launch path. Agy still requires the
operator to include `agy-pool` in `externalWorkers` (`--external-workers agy-pool`);
this change does not enable that option or change the pool authorization policy.
Cached proof cannot bypass a revoked pool authorization.

Capability checks consume the existing Controller probe budget and existing
HTTP/schema timeouts. Only actual capability-probe time is deducted; JEV and pure
ranking time do not spend the route-probe window. Dry-run never authorizes a CLI
launch. HTTP refusal headers survive unreadable error bodies instead of becoming
timeouts.

Machine-only cleanup removed `jsonSchema`, `tools` and `contextWindow` from the
`ninerouter` and `xkiro` account records; no registry data or credentials are committed.
Windows-env profile dispatch dry-run before/after: `CAPABILITY_MISSING` 117 ->
108 (104 schema, 4 tools). After repair these are actual negative probe results:
83 upstream credit/quota, 7 rate limits, 4 HTTP 400, 10 timeouts and 4 incomplete
schema responses. Another 33 routes remain explicitly unverified because the
existing probe budget was exhausted. The selected route is
`http::regolo::::regolo::::regolo-regolo-api-key::gemma4-31b`; both required
capabilities were verified before ranking. This is a real HTTP capability check,
not a live CLI/goal acceptance run. The diagnostic uses the Controller writer
profile, current discovery/health data and Windows user environment, with offline
JEV advice; proof persistence is isolated to the author worktree. No agy launch
permission was added. Failed proofs can be retried after the existing failure
cooldown; positive proof is reused only for the same route/configuration binding.

### H3 live: every failed probe leaves evidence (2026-10-17)

Run 7 of goal G-F622511E recorded TIMEOUT for routes that answered within 1-4 s when probed directly with the same function, endpoint and environment (including 8 concurrent probes), and the decision log did not keep what the probe received. Every failed probe now records its redacted raw result, status and duration (boundedProbe adds elapsedMs) in the run decision log.

### H3 live: host gate turns all machine caches off (2026-10-17)

Run 6 of goal G-F622511E reached a writer commit (ag/gemini-3.8-flash) but the host gate failed candidate tests again: the models.dev cache in the Hermes home (models_dev_cache.json) gave a model a 200k context window. AI_BRAIN_MACHINE_DATA=none now turns machine caches off (that catalogue and discovered sources); the host gate sets it. An explicit catalogue path still counts.

### H3 live: preflight OpenCode CLI routes and retain HTTP refusal causes (2026-10-17)

Configured OpenCode CLI writer routes now pass HTTP preflight even outside isolated
execution, before the harness can replace an immediate upstream refusal with its
own timeout. Both the ranked pre-probe and runtime fallback use this rule. The
HTTP wire model, endpoint, credentials and headers still come from the registry.
A missing upstream credential is reported as `AUTH_NEEDED`; provider-specific
`PROVIDER_UNAVAILABLE` memory remains intact. A 404 `model_not_found` without a
credential message is `ROUTE_UNAVAILABLE`. Tests inject HTTP and launcher responses;
no live provider was called. Three new checks are red on origin/main and green
on the fix, covering isolated/non-isolated CLI and the model-not-found response.
This proves the missing CLI preflight and classification paths offline; it does not
claim a rerun of the historical live timeout.

### H3 live: derive small-item complexity and measure packed context (2026-10-17)

A single risk-domain keyword no longer makes a bounded item large. Complexity uses
acceptance/scope counts and layers; explicit higher complexity and multi-domain risk
remain authoritative. Intake also recognizes Files fields/sections. Before JEV and
writer selection, the actual packed text is measured with the existing repo-map token
estimator. This replaces the generic role context fallback; explicit larger item
requirements remain respected. The context manifest records bytes and estimated tokens.
Read-only replay of GOAL-G-F622511E-1: two owned files, `standard`, 7,831 pack bytes,
1,943 estimated context tokens rather than 200,000. No provider call was made.
Offline regressions are red on origin/main (`large`, 200,000 versus 16 fixture tokens)
and green after the fix. Existing intake tests: 7 passed.

### H3 live: summarize unchanged route cooldowns per item (2026-10-17)

Each writer selection/probe round records counts by cooldown reason and the earliest
reopening time. Initial cooldown inventory is summarized; individual route details
are recorded on state changes, including expiry changes and recovery. State belongs
to one item. Selected routes and new non-cooldown refusals retain their records.
Offline regression: 1,000 unchanged cooldown routes over three rounds produce three
summary records. The same fixture's cooldown-only bytes per round fall from 467,340
to 239. The origin/main regression is red (4,000 records before its turn-budget stop).

### H3 live: stop identical local launch configuration retries (2026-10-17)

The item stops when the same local `launch_config` cause and whitespace-normalized,
redacted launcher detail recur, regardless of writer identity. The terminal reason
keeps the actual launch error, without charging the provider a failure or cooldown.
Offline regression in `task-ai-121.test.js`: origin/main launched four times; the
fix stops after two `PROVISION_BASE_MISMATCH` failures.

### H3 live: local router probes are sent over loopback (2026-10-17)

Root cause of the run-5 failure of goal G-F622511E: `probeGatewayModel` refused every credentialed probe whose endpoint was not HTTPS, including 9router at http://127.0.0.1, so a route that answered 200 failed before any request with status 0. Plain HTTP is now allowed only to loopback hosts; any other host still needs HTTPS. Correction to the note below: an unexplained probe failure is recorded as PROBE_NO_RESPONSE with no cooldown (not UNAVAILABLE_NOW), and the decision log keeps the redacted raw result (status, error, body).

### H3 live: unknown probe evidence does not park a route (2026-10-17)

A failed probe without HTTP response evidence or an explicit failure cause is
`PROBE_NO_RESPONSE`, not confirmed `UNAVAILABLE_NOW`. It does not increase the
failure backoff and is due for another probe at the next selection. Existing
versioned, status-zero records missing `probeCause` are also eligible for recheck.
Known HTTP refusals and confirmed timeouts retain the existing cause/cooldown
policy in `probeCooldownMs`; no new cooldown value is introduced. Unverified
observations are never recorded as successful probes or healthy routes.

Both writer pre-probe and runtime fallback keep an uncertain route out of the
permanent failure exclusion/cache. The next selection can probe it again before
launch. Intake creates its decision destination before refreshing route health.
The shared health recorder logs uncertain probe status and body/message/error,
redacting environment secrets before truncating to the existing HTTP body limit.

Read-only evidence: the live `ag/gemini-3.8-flash|9router@xkiro` record has HTTP
status zero, no cause, and a 30-minute interval starting 09:17:46.055Z. That shape
comes from intake `recordResult`, whereas `rememberProbe` always sets a cause.
An offline reproduction using the current registry metadata shows that
`probeGatewayModel` rejects a credentialed HTTP 9Router endpoint with
`credentialed probe endpoint must use HTTPS` before invoking fetch. This local
refusal explains a reproducible source of the missing cause; the historical
round-five error cannot be proven uniquely because its raw response was not kept.
The HTTPS guard and live health/intake files were not modified.

Seven new regressions fail on origin/main
`40275bb8a4045367b7623e0dc7f3bfe243832971` and pass after repair, covering health
eligibility, old cause-less records, safe raw diagnostics, intake destination,
and a writer recovering on the next probe. Additional checks preserve HTTP
401/403/451/402/quota/404 handling and confirmed-timeout cooldown. Final offline
validation: 126 tests passed, including Controller canary, intake, route reprobe,
probe memory, writer preflight, and route-health fallback coverage.

### H3 live: pre-launch check uses the carry-over rule (2026-10-17)

Run 4 of goal G-F622511E chose ag/gemini-3.8-flash (health keys fixed) but 20 launches failed PROVISION_BASE_MISMATCH at the second check, "worker root HEAD before agent start", which still compared the carry-over merge with the base. It now applies the same rule as provisioning; a retained worker head must still match exactly.

### H3 live: route health per upstream behind a shared gateway (2026-10-17)

The third live run of goal G-F622511E exhausted its probe budget: ag/gemini-3.8-flash through 9router answered 200, but route health keyed it as gemini-3.8-flash|9router@ninerouter after stripping a fixed list of upstream prefixes, so a GEO_BLOCKED from another upstream blocked it until the next day. Health keys now keep the routed model id and drop a prefix only when it names the route itself (ag/x on route ag). Catalogue normalisation is unchanged.

### H3 live: carry-over keeps the base check (2026-10-17)

The second live Controller run of goal G-F622511E failed TURN_BUDGET_EXCEEDED: 17 launches in a row failed PROVISION_BASE_MISMATCH because carry-over merged the previous attempt into the fresh checkout and the base check compared that merge commit with the base. When carry-over merged, the provisioned HEAD must be a merge whose first parent is the base; otherwise HEAD must equal the base.

### H3 live: host gate sees what CI sees (2026-10-17)

The first live Controller run after the writer-selection audit (goal G-F622511E) chose a writer (9router ag/gemini-3.8-flash) that produced a commit, but the host brain gate failed 11 candidate tests: loadSources() merged this machine's discovery data (tools/ai-brain/data/sources.json, 33 sources) into every registry, including explicit test registries. An explicit registry file is now read alone unless a discovered file is named; AI_BRAIN_DISCOVERED_SOURCES=none turns machine discovery data off, and the host gate sets it. data/sources.json is gitignored.

### H3 live: native writer lanes (2026-10-17)

- Scope: `.worktrees/w-nativelanes`, branch `fix/task-ai-142-native-writer-lanes`. No staging or commit by Codex; Claude commits with real hooks.
- Native CLI binding excludes HTTP account inventory. Codex login checks auth file existence only, and models remain config-derived. Writer ranking refuses unknown or exhausted quota; usable Controller quota readings are required.
- Native account provider aliases are declared in the source registry. Gateway writers use the endpoint's own model listing and the existing direct HTTP preflight, credential and schema gates.
- A successful Codex file-only writer is committed by the Controller in its worker root before exact-SHA verification. Commit/hook failure is local and cannot become a successful worker SHA.
- Regression evidence: all 10 native-lane tests fail against the unchanged HEAD modules and pass with this implementation; the Codex sandbox expectation also fails before the adapter fix. HTTP 200/503 and installed-hook behavior use injected collaborators, with no provider calls or actual native-writer commit.
- Final offline validation: 537/537 tests pass, including Controller canary, TASK-AI-141, candidate generation and selected TASK-AI-142 suites; 0 skipped/TODO. Excluded: the two baseline-failing ACP/worker-progress suites below, plus `task-ai-142-agy-gateway.test.js` and `task-ai-142-jev-failure-reason.test.js` because they open loopback listeners. Gateway HTTP coverage here is injected. Prettier, `git diff --check` and the hardcode guard pass (6 production files scanned, 0 new violations). Logs: `native-lanes-final.log`, `native-lanes-red.log`, `native-lanes-baseline-failures.log` in this worktree.
- Broader checks reproduce 6 failures on unchanged HEAD: 4 `ACP_CLEANUP_FAILED` cases in `task-ai-142-hermes-acp.test.js` and 2 B4 abort cases in `task-ai-142-worker-progress.test.js`. They remain outside this lane. Usage tests require temporary `LOCALAPPDATA` under the permitted temporary directory.
- Evidence is offline fixtures only; this assignment does not establish live login, live quota, gateway availability or provider-backed writer success.

### H3 live: writer HTTP preflight, direct inventory and fresh health (2026-10-17)

- Scope: `.worktrees/w-writersel`, branch `fix/task-ai-142-writer-selection`; changes stay uncommitted for the host operator. No changes to `hermes-live`, credentials or provider/model scores.
- Historical evidence: intake `GOAL-AUTOCLAW-REPOS-4-2026-10-16T20-21-30-853Z/decisions/2026-10-16.jsonl` contains 2,077 wall-clock skips (1,319 OpenCode, 758 Paseo). Both sampled direct candidates were rejected with `CAPABILITY_MISSING:jsonSchema`. The isolated-lane summary reports 983 missing-schema rejections; its truncated rows cannot establish the cause for each native candidate.
- HTTP refusals retain their received 401/403/451/503 status when the error body fails or never ends. Error-body reads are bounded; an outer deadline retains an already observed HTTP refusal. 401 and 451 classify as authentication and geography failures; gateway 503 bodies explicitly reporting 401 re-authentication or 451 location refusal retain those upstream causes. Geography uses the existing 24-hour health policy, authentication six hours, generic 503 thirty minutes. Probe failures blame only the candidate, with explicit provider/account health gates unchanged.
- All configured HTTP writer routes receive direct HTTP preflight before their harness launches, including direct HTTP adapters; native-only CLI routes retain their separate qualification path. Source-owned direct model ids survive unrelated shared gateway catalogues. Inventory still does not prove JSON schema, tools, quota or writer eligibility.
- Known-good ordering now applies the same existing 24-hour success freshness rule at both ranking and pre-probe stages and respects active provider/account cooldowns. No scoring constants or provider/model preference lists were added.
- Red-before evidence on the clean starting production code: nine new probe cases failed (HTTP 401/451 cause, stale known-good ordering, two harness preflight cases, four interrupted error bodies); the additional never-ending-body case failed with status 0 instead of 503. The direct inventory regression failed with 0 rather than 34 candidates. Two nested-upstream regressions failed before that classifier change; two scope assertions failed before changing gateway blame to candidate blame. All fixtures are offline.
- Validation: the initial focused run passed 68/68; the final two regression files passed 38/38 (13 new tests). The expanded command `node --test --test-concurrency=1 tools/ai-brain/test/controller-canary.test.js "tools/ai-brain/test/task-ai-142-*.test.js"` finished with 435 pass / 10 fail out of 445, including a passing offline `goal resume` canary in 12.04 seconds. Failures: four ACP subprocess cases (`ACP_CLEANUP_FAILED`), four isolated-usage cases (`EPERM` writing outside the worktree to AppData), and two unchanged B4 worker timing cases (16.21/16.14 seconds versus a 10-second assertion). ACP/usage rerun reproduced 8 failures / 8 passes. These affected test/launcher/ACP files are unchanged from HEAD; no full-suite PASS is claimed. Prettier on the seven changed JS files and `git diff --check` passed. This is injected-writer evidence, not a live-provider success claim.
- Remaining item 3: no production change to native writer admission or host commit ownership. In the historical snapshot, `source-codex` is enabled with 914 HTTP-listed models; `candidates.js:760` treats it as a bound native account, bypassing `implicitCliLoginAccount` at line 766. The `agy-native-a` account uses provider `antigravity`, while the registry CLI source is `agy-local`; `accountsFor` at line 147 matches exact source identities. Native schema proof/authorization remains at `orchestrate.js:3380`, and Controller-owned commit recovery requires a separately tested launcher change. Existing `task-ai-142-known-good.test.js` tests intake admission but does not prove a successful native write/host commit.
- Live acceptance remains open: no real provider or live `goal resume` was run in this network-restricted task environment. The requested live writer selection under five minutes is not yet established. Direct-source enumeration is repaired, but provider credential readiness and per-model capability proof still gate actual selection.

## Part H3 live finding: context window (2026-10-13)

On main d479a48d, `goal session` refused all 591 Hermes candidates; 575 with CONTEXT_WINDOW_UNVERIFIED. Provider /models endpoints report `context_length` (the local 9router for all 918 models) but discovery kept only ids. Fix: keep the provider-reported context window per model and use it only for candidates routed through that same source; anything else stays unverified.

## Part H3 candidate wiring: OpenAI-compatible sources & context window (2026-10-13)

Every available OpenAI-compatible source with an endpoint and an env credential (9router via NINEROUTER_API_KEY, TokenHarbor, Cohere, B.AI, llmtr, etc.) yields Hermes candidates carrying their own `sourceId`, `endpoint`, and `contextWindow` from that source's `modelMeta`. Context window resolution is bound to the producing source object rather than gateway name guessing, keeping unverified sources as `CONTEXT_WINDOW_UNVERIFIED` and ensuring a model in source A never receives context from source B.

## Part H3 named Hermes session (2026-10-13)

Live evidence on the real Hermes v0.21.4 binary verified that invoking `hermes chat --resume <id>` with a Controller-minted ID fails with "session not found" on first launch. Replacing `--resume <sessionId>` with `--continue <sessionId> --create-if-missing` in `buildHermesArgv` allows Hermes to create the named session on first use (using the Controller-minted sessionId as the session title) and continue that exact session across subsequent turns and failover relaunches while preserving history.

## Part H3 skill install (2026-10-13)

Live evidence on the real Hermes v0.21.4 binary verified:

1. `hermes chat ... -s <absolute path to SKILL.md>` fails with "Unknown skill(s)" because Hermes `-s` takes skill names installed under `<HERMES_HOME>/skills/<name>/SKILL.md`.
2. When writing the Controller-owned Hermes home, the Controller installs (copies) the skill file to `<hermesHome>/skills/shipde-controller/SKILL.md` (overwriting each launch so it stays in sync with the repository).
3. `buildHermesArgv` passes `-s shipde-controller` (the skill name), never a path.
4. `config.yaml` includes a `model:` section with `default: <modelId>` and `provider: <providerName>` matching the providers entry (values validated/escaped as the existing YAML writer does; no secrets), preventing Hermes from warning that custom_providers is defined but no model section is present.

## Part H3 Windows launch (2026-10-13)

Live evidence on Windows verified that `node tools/ai-brain/cli.js chat` fails with `LOCAL_LAUNCH_FAILURE: spawn hermes ENOENT`. When installed via npm on Windows, `hermes` on PATH is a `.cmd` shim (`hermes.cmd`) that cannot be spawned directly without a shell. Because `child_process.spawn` must never use `shell: true` (to prevent shell interpretation of arguments), Hermes launch resolves:

1. `HERMES_BIN` environment variable if set (launching `process.execPath` + `[HERMES_BIN, ...argv]` if `.js`, else `HERMES_BIN` + `argv`).
2. On `win32`, searching each PATH directory for `hermes.cmd` and `<dir>/node_modules/hermes-agent/bin/hermes.js`, launching `process.execPath` with `[thatJs, ...argv]`.
3. Otherwise falling back to `'hermes'`.

## H3 AA priors

Artificial Analysis intelligenceIndex is the primary prior for the selected reasoning models; each benchmark value records its source URL and retrieval timestamp. The embedded leaderboard includes selected `aaAgenticIndex` values sourced from benchlm.ai; coding-index coverage remains separate and is present only where collected.

## Part H3 route probe (2026-10-13)

Before launching Hermes or reusing a stored binding, the Controller sends a minimal OpenAI-compatible chat completion to the selected route. Classified quota, rate-limit, timeout and availability failures exclude that candidate, are recorded in the decision log, and trigger bounded reselection (up to 20 route attempts, at most two per model). Dry-run skips live probes unless --probe is supplied. The probe reads the provider key using the registry-declared environment variable name; credentials are never recorded.

## H3 runtime gates (2026-10-13)

Runtime route fallback is triggered only by Hermes agent API-failure log lines that include an HTTP error code; ANSI escapes are removed before classification, and model-generated reasoning or answer text is never treated as route evidence. Route probing defaults to a configurable 20-attempt ceiling within the three-minute budget, while retaining the maximum of two routes per model. Goal-generated writer/planner profiles with no declared proof floor use `NONE`; reviewer proof floors remain enforced. Terminal goal-run logs include refusal reasons and counts where available.

## Part H3 realistic probe

H3 realistic probe sizes route preflight to candidate max-output metadata (8192-token fallback) and a roughly 2k-token context prompt, while requesting a short OK response. Hermes retry controls are set using verified v0.21.4 config keys (`api_max_retries: 1`, `auto_recovery_cycles: 0`). Runtime quota and route errors terminate the active Hermes process, record the reason, and reselect while preserving the named session.

## H3 isolated usage import (2026-10-13)

Live evidence from goal runs dispatching isolated opencode writers revealed a ReferenceError at `tools/ai-brain/isolation-launcher.js:2088` ("writeUsageReportFromHarnessResult is not defined"), which caused the Controller to treat successful worker runs as failures and rotate candidates. `writeUsageReportFromHarnessResult` is now lazily imported from `./orchestrate` at call time (avoiding circular dependency) and invoked with a normalized `job` object derived from launch options and adapter id, ensuring token budget enforcement and usage file synthesis function reliably in isolated runs.

## Part H3 JEV direct weights

On 2026-10-13, JEV was changed to score quality, latency, and cost directly; the Controller normalizes those scores into routing weights and records the scores, confidences, source, and final weights. Missing or low-confidence scores and JEV failures use the existing preset fallback. Reviewer and security-review roles retain QUALITY_FIRST. Hermes' session brain selection in hermes-session.js:543 remains fixed at QUALITY_FIRST.

## H3 isolated usage budget (2026-10-13)

Isolated OpenCode results now synthesize the usage report from token JSON in stdout or a launch-result `usage` field before budget enforcement. A proven overrun fails with `TOKEN_BUDGET_EXCEEDED`; missing/unreadable usage records `TOKEN_BUDGET_UNVERIFIED` as a warning while preserving the worker's actual outcome. `STALLED_NO_PROGRESS` details include the detector's measured file-signature and token-usage signals; stdout is explicitly identified as outside that detector.

## H3 writer route probe (2026-10-13)

Before launching an isolated writer, the Controller probes the resolved gateway with the exact upstream model id and a realistic request. Failed routes are logged and excluded before launch, with bounded time and attempt budgets and no credential values in logs. Hermes and isolated dispatch share the OpenAI-compatible probe implementation.

## H3 route probe review repair (2026-10-13)

Bounded probes pass an AbortController signal to the injected `routeProbe` and HTTP client, aborting timed-out requests. Writer and reviewer paths invoke the caller-provided probe directly. Named limits are `MAX_ROUTES_PER_MODEL = 2`, `PROBE_ATTEMPT_LIMIT = 20`, and `PROBE_BUDGET_MS = 180000`. CLI-only reviewers remain eligible and record a WARNING explaining skipped HTTP preflight. Regression coverage checks timeout cancellation and injected probes on both dispatch paths.

## H3 no silent post-select failure

Writer probe rejection, exceptions, missing route configuration and exhausted budgets record named reasons in checkpoint failures and decisions before reselection. Prompt and route-resolution exceptions become `POST_SELECTION_ERROR`. Successful probes proceed to launch; gateway requests remove the local OpenCode `ninerouter/` prefix while retaining the exact upstream model and region. Terminal intake failures recover the checkpoint reason for goal-run output, with a named child-exit fallback when no checkpoint is available. Deterministic orchestration regressions cover success, failure, thrown probes, budget exhaustion and post-selection exceptions; live checkpoint evidence remains read-only.

## H3 probe health memory

Writer and Hermes probes share durable gateway/model/account health. Credit, quota, entitlement and authentication failures cool down 6 hours; missing routes and aliases 24 hours; transient failures 30 minutes. Selection records cooldown reasons before probe budget use. Expiry permits re-probing; success clears cooldown. Budget exhaustion is not route evidence. No response bodies or credentials are stored.

Goal runners forward configured external worker pools through next and intake. Intake also discovers agy runtime accounts when aggregate quota evidence is absent. Agy candidates retain their own quota qualification and isolated launcher, without HTTP probing.

## H3 provider-wide exclusion (2026-10-13)

When an upstream probe failure indicates missing or unconfigured credentials for an entire provider (such as HTTP 404 with "No active credentials for provider"), the route failure is classified as `PROVIDER_UNAVAILABLE`. The Controller applies a 6-hour provider-level cooldown scoped to that gateway and provider, excluding sibling models under the same provider from probing and selection without wasting probe budget. Successful probes clear the provider cooldown for that gateway. Route health persistence preserves explicit bootstrap semantics when the health store file is missing.

Verification (2026-10-13): sequential `node --test --test-concurrency=1` groups passed: `task-ai-141*` 199/199; `task-ai-142*` 118/118; `task-ai-64*` 129/129; `task-ai-85*` 5/5; `task-ai-130*` 12/12. Sequential focused LF-R01, RT-R01 and V-R03 checks passed 3/3, 1/1 and 2/2. Changed JavaScript files pass Prettier and ESLint (including no-undef); `git diff --check` passes. Live goal execution is not claimed. Runtime data is excluded from the commit.

## H3 intake child reason

Reproduced the live pre-selection failure using copied GOAL-AUTOCLAW-REPOS-1 intake inputs and a copied decision log with network and process launches disabled: `DECISION_LOG_UNREADABLE: 2026-10-13.jsonl: ERR_STRING_TOO_LONG`. The 542,101,072-byte daily log exceeded V8's whole-string limit; individual lines were at most 2,832,192 bytes. Decision reading now decodes chunks while retaining damaged-log refusal and partial-final-line recovery. Failed orchestration outcomes are printed to stderr and retained in the checkpoint. Intake captures the last 40 stderr lines, redacts credentials, and carries the reason into parent output, decision records and item execution outcomes. Dispatch wiring tests use a temporary route-health file. Live inputs remain read-only; no model quota is used by reproduction.

Verification: sequential dispatch wiring 7/7, TASK-AI-141 199/199, TASK-AI-142 124/124 (including five child-reason regressions), TASK-AI-64 129/129; decision tests 24/24. Changed JavaScript passes Prettier and ESLint including no-undef; git diff --check passes. The fenced copied-data replay passed decision-log reading and reached candidate eligibility/cooldown checks; it was stopped at that point. Live writer execution is not claimed.

## H3 known-good first

Writer preflight preserves eligibility and quality floors, prioritizes route-health successes from the last 24 hours, then unknown routes by rank. Configured isolated agy-pool and Codex lanes precede HTTP exploration and qualify through quota/launcher checks. Decision reason: `PROBE_ORDER_KNOWN_GOOD`. Failure causes are persisted as reason strings. Live goal rerun remains operator acceptance; no router health API is assumed.

## H3 writer candidate gap

Read-only replay of the latest saved GOAL-AUTOCLAW-REPOS-1 intake (2026-10-13T16-24-17-299Z), its source inventory, evidence and route health uses the real planner profile: author.foundation, JSON-schema/tools, 200k context and quality floor 70. No model requests or worker launches were made. Pool model discovery uses the saved live cache and reads runtime account evidence only.

Before: OpenCode aliases openai/gpt-6-astra, cl/meta/muse-spark-1.3, meta/muse-spark-1.3, muse-spark-1-3, ocz/muse-spark-1.3 led the eligible ranking. After: OpenCode ninerouter/cbai/deepseek-v4.1-flash, then the same upstream on the gateway candidate, precede those unknown routes. The success at 16:19:14.194Z belonged to a Hermes inventory source; matching now uses the same gateway endpoint and normalized upstream model ID, independent of harness/account keys. Different endpoints, upstreams and regions remain distinct; newer failures supersede older success. This changes probe ordering only, never account authorization or quality/proof floors.

The copied inputs offer 78 agy-pool and 947 Codex candidates. Their JSON-schema capability is unverified, so they remain rejected with CAPABILITY_MISSING:jsonSchema; availability cannot invent that capability. Intake now uses the reviewed registry kind for a configured CLI even when discovered provider inventory labels its HTTP configuration model-source. Runtime pool discovery survives errors loading aggregate quota evidence. Decisions retain all known-good and isolated-lane rejection reasons beyond the general first-50 rejection limit. The saved health store contains no successful gh/* record (its two gh records are failures), so no gh-wide success is inferred. Live execution remains unverified.

Validation: sequential TASK-AI-141 199/199, TASK-AI-142 131/131, TASK-AI-64 129/129 and dispatch-wiring 7/7 passed. The focused regression exercises real goal-style runIntake with probes and worker launches fenced off, then verifies the resulting account file and external-worker option produce pool/Codex candidates. Changed JavaScript passes ESLint including no-undef, changed files pass Prettier, and git diff --check passes. Runtime data is excluded from the commit.

## H3 post-launch SHA and session (2026-10-14)

Live execution of an isolated worker (harness `opencode`, `isolatedWorker`) revealed that:

1. `readSessionId(adapter, job, res)` yielded no ID because the adapter looked exclusively in `--usage-file` reports or stdout rather than recognizing the isolated launch result's own `res.sessionId` / `launchHandle`. For isolated launches, `readSessionId` now accepts the isolated launch result's session ID directly, preserving existing behavior for non-isolated runs without inventing IDs. When a session ID is missing, a named cause (`HARNESS_NO_SESSION_ID` or adapter report error) is recorded so the item never fails with the generic `NO_LIVE_SESSION`.
2. For isolated launches, worker commits occur inside the isolated worker clone reported by the isolated launcher rather than `job.cwd`. `orchestrate.js` now resolves the worker clone path and verifies the commit SHA exists in that repository via `git rev-parse --verify`. If unverified, reason `WORKER_SHA_UNVERIFIED` is recorded rather than recording an unverified or host-cwd SHA.

Verification: `node --test tools/ai-brain/test/task-ai-142-*.test.js tools/ai-brain/test/task-ai-64.test.js` passed all tests. Changed files pass Prettier and `git diff --check`.

## H3 post-launch live path

Read-only evidence after main 83ce7996: host-owned launch result hermes-live-1791918998348.json (02:22:10 local) contains Git output for real commit b284ac5b and session ses_ec94df2f6ffevc9Ckmc00naDmX. The host brain gate failed, then the repair called launcher(job) without retainWorkerHead. isolation-launcher.js's fresh-provision branch removed and cloned the worker root again (reflog clone at 02:26:45). Result hermes-live-1791919618872.json (02:43:50) contains real commit ed773f10b754a0e852e27c899fb14f7750149ceb and a different session ses_ec9447b03ffetFvo0s63Kfgo8j. The second gate also failed; its early break left session null and the checkpoint kept the first, now deleted commit. b284ac5b came from Git HEAD of the first worker run, not a nonce hash or commit-tree export.

Repair now retains the verified worker HEAD, uses a separate usage report for the repair session, and records the final clone HEAD and session even when the host gate fails. Repair refusals and thrown launcher errors preserve the original successful session and report. A failed gate remains HOST_GATE_FAILED and cannot enter review, including on checkpoint resume. A passing gate proceeds to tests and exact-SHA review; the existing sanitized provisionReviewRoot imports the worker object store into the review repo and checks out the exact commit. Regression coverage uses the production readLaunchResult builder with OpenCode JSON stdout (no hand-made launcher result), exercises both second-gate outcomes, and verifies the commit exists in the review repo. Live rerun remains operator acceptance; no worker evidence repository was modified.

Verification (2026-10-14): sequential TASK-AI-141 199/199, TASK-AI-142 140/140, TASK-AI-64 129/129, dispatch-wiring 7/7, LF-R01 3/3, RT-R01 1/1 and V-R03 2/2 passed on the final code. The two gate regressions failed against 83ce7996: the passing-gate path retained the first session ID, and the failing-gate path had no session. Final coverage also checks repair refusals, thrown launcher errors and blocked resume. Prettier, ESLint no-undef with Node globals and git diff --check pass. Earlier TASK-AI-64 attempts had two review/resume failures that passed focused reruns, and a fixture failure from an added missing-HEAD guard; removing that guard preserved the existing stub-launcher contract. The final full TASK-AI-64 rerun passed all 129 tests. No live goal rerun, push or merge was performed; runtime data is excluded.

## H3 decision log size

Selection logs retain the full chosenCandidate, the existing chosen identity, top ten ranked candidates and score breakdown summaries, and rejection totals by reasonCode with ten examples. Full runtime routing arrays remain available for fallback. Daily logs roll at 50 MiB into date.N.jsonl; readers consume all parts in numeric order. `node tools/ai-brain/cli.js decisions compact --dir <dir>` incrementally writes capped copies named `<source>.compact-<timestamp>.jsonl`, preserving originals. Copies are excluded from daily history until the operator explicitly replaces originals; malformed input fails rather than silently dropping evidence. No live data is modified by this change.

### H3 live: goal writer pool candidate generation and capability probe starvation fix (2026-10-18)

1. Data-driven candidate harvesting for direct OpenAI-compatible sources:
   - `pushOpencodeProviderWriters` in `tools/ai-brain/candidates.js` resolves models from:
     a) String catalogue entries matching provider prefix (`${key}/` or `${source.id}/`), e.g. `regolo/gemma4-31b` or `tencent/*`.
     b) `sourceModels` containing provider aliases and option keys (`opencode-provider-${source.id}-options`, `${source.id}-ai`, `${source.id}-tokenhub`, etc.).
     c) `discoveryCatalogue` candidates from discovery imports and catalogue.
   - `tools/ai-brain/intake.js`: `composeOrchestrateCommand` includes `--catalogue-sources` pointing to `catalogue-sources.json`.
   - `tools/ai-brain/cli.js`: `orchestrateCommand` reads `--catalogue-sources` and discovery data, passing `sourceModels` and `discoveryCatalogue` to `generateCandidates`.
2. Writer capability probe ordering & prevention of budget starvation:
   - `tools/ai-brain/capability-probe.js`: Prioritizes writer candidates (`codex`, `agy-pool`, `opencode-direct`) at the head of the capability probe queue when selecting for writer roles, preventing starvation by thousands of preceding unranked router routes within the 180s probe deadline.
   - Prior real work evidence reuse: Checks `evidence.combinations` for prior real work execution (`proofLevel === 'WORK_ITEM_PASS'` or `status === 'passed'`), satisfying `jsonSchema` capability verification without launching CLI or consuming probe budget.
   - Verified proof caching: Successfully verified CLI schema proofs are cached into `evidence.capabilityProbes` and reused across subsequent rounds.
3. Verification: Unit tests in `tools/ai-brain/test/task-ai-142-goal-writer-pool.test.js` pass (5/5). All related TASK-AI-142 suites pass (83/83).

### H3 live: worker progress stall detection test B5 uses injected clock (2026-10-17)

Test B5 in `tools/ai-brain/test/task-ai-142-worker-progress.test.js` verified that genuine progress (tool calls, file signature changes) resets the worker stall detection timer. Under heavy system load, real wall-clock sleeps (600ms) could stretch beyond the 1500ms timeout threshold before progress was recorded, causing intermittent test failures.

1. Injected a simulated clock (`fakeClockPath`) into `runGeneratedHost` in `task-ai-142-worker-progress.test.js`, overriding `[System.Diagnostics.Stopwatch]::GetTimestamp()` in the generated host script.
2. Synchronized simulated time advances with target execution steps, ensuring deterministic timer resets without relying on real wall-clock elapsed time.
3. Preserved all original test assertions and contracts without loosening timeout tolerances.

Verification: `node --test tools/ai-brain/test/task-ai-142-worker-progress.test.js` passed 10 consecutive runs under parallel full-suite load. Changed files pass Prettier, ESLint, and `git diff --check`.

### H3 live: missing Codex used_percent is treated as unknown quota rather than zero (2026-10-17)

When `primary.used_percent` in Codex session rollout logs was omitted or non-numeric, `readCodexSessionQuota` in `tools/ai-brain/codex-quota.js` previously evaluated `Number(...) || 0`, falsely treating unmeasured quota as 0% used (`open`).

1. Enforced strict validation on `primary.used_percent`: when missing, null, undefined, or non-finite, `readCodexSessionQuota` returns `status: 'unknown'` and `available: false`, specifying the exact missing field in `reason`.
2. Omitted or unparseable `secondary.used_percent` gracefully falls back to evaluating `primary.used_percent` alone, retaining established secondary behavior.
3. Tests use synthetic session rollout files in temporary directories and never access or create `auth.json`.

Verification: `node --test tools/ai-brain/test/task-ai-142-codex-quota-missing.test.js tools/ai-brain/test/task-ai-142-audit-repairs.test.js` passed 14/14 tests. Changed files pass Prettier, ESLint, and `git diff --check`.

### H3 live: leaderboard source names carry explicit identifiers without undefined (2026-10-17)

External benchmark tables recorded in `model-priors-live.json` had entries in `sources[]` containing only `url` and `retrievedAt` without `id` or `name`, causing decision logs and candidate score breakdowns to output `undefined` for `qualitySource`.

1. Defined explicit source identifiers (`artificial-analysis` and `benchlm`) in `tools/ai-brain/priors-sources/public.json` under `sources[]`.
2. Updated `resolveDescriptorSources` in `tools/ai-brain/priors-public.js` to extract source IDs dynamically from the descriptor without hardcoding names.
3. Preserved `source.id` across document merging, per-model source records, and benchmark provenance in `tools/ai-brain/priors.js` (`mergePriorDocuments`).
4. Prevented any `undefined` source string or property from appearing in decision logs or merged prior documents.

Verification: `node --test tools/ai-brain/test/task-ai-142-priors-source-id.test.js tools/ai-brain/test/priors-public.test.js tools/ai-brain/test/task-ai-142-quality-priors.test.js` passed all tests. Changed files pass Prettier, ESLint, and `git diff --check`.

### H3 live: unverified route probes retain diagnostic evidence without a 30-minute penalty (2026-10-17)

When candidate route pre-probes return an unverified failure (`ok: false` with no HTTP status or recognizable error cause, e.g. `ag/gemini-3.8-flash|9router@xkiro`), `recordResult` in `tools/ai-brain/route-health.js` previously assigned the full 30-minute transient cooldown (`UNAVAILABLE_NOW`, 1800000ms), and `failedKeys` in `orchestrate.js` excluded the route from subsequent selection rounds, starving the candidate loop. Furthermore, raw diagnostic details (HTTP status, error message, body) were lost because intake had not initialized the run decision directory prior to route probe fallback.

1. Added `isUnverifiedProbe` and `unverifiedRecord` in `tools/ai-brain/route-health.js`. Unverified / cause-less probe failures (`status === null || status === undefined || status === 0` without recognized error patterns) record as `UNAVAILABLE_NOW` with `failures: 0` and immediate `nextCheckAt = now`, remaining eligible for re-probing in subsequent selection rounds (`isEligible`, `isSelectable`, and `orderProbeRoutes`).
2. Log raw diagnostics (`probeResult: { ok: false, status, message, error }` with redacted secrets) to decision records via `recordUnknownProbe` and `recordDecision`.
3. Pre-create the run decision directory in `tools/ai-brain/intake.js` so candidate route probe fallback writes diagnostics into the active run before route refresh.
4. Keep unverified failures scoped locally without registering permanent route failures or blacklisting keys in `failedKeys` in `tools/ai-brain/orchestrate.js`.
5. Genuine HTTP errors (401, 403, 451, 402, 429, 404, etc.) retain their explicit causes, diagnostics, and full standard cooldown backoffs.

Verification: `node --test tools/ai-brain/test/task-ai-142-unknown-probe-cause.test.js tools/ai-brain/test/task-ai-142-probe-transient.test.js tools/ai-brain/test/task-ai-142-writer-probe.test.js tools/ai-brain/test/task-ai-131.test.js` passed 52/52 tests. Changed files pass Prettier and `git diff --check`.

### H3 live: direct OpenAI-compatible sources yield opencode-direct writer candidates (2026-10-17)

Direct OpenAI-compatible sources with HTTP/HTTPS endpoints and environment-variable credentials (tencent, cohere, baseten, inception, regolo, amd-radeon) now generate isolated writer candidates with harness `opencode-direct`.

1. Data-driven candidate generation: Any active source in `sources.json` declaring an HTTP/HTTPS endpoint and environment credential variable without a custom CLI harness produces `opencode-direct` writer candidates for each declared or catalogued model ID, without hardcoded provider lists or model IDs. Direct-http candidates remain untouched for other roles.
2. Secret protection: Isolated worker configuration in `tools/ai-brain/isolation-launcher.js` generates OpenCode provider configurations referencing `{env:VARIABLE_NAME}` without writing raw API key secrets to disk. Keys are passed to the worker exclusively via process environment variables.
3. Undeclared capabilities: Newly generated candidates leave `jsonSchema` and `tools` undefined for probe-based verification (PR B), while preserving known `contextWindow` and token limits.
4. Route resolution: `stripOpencodeProviderPrefix` and executor `resolveRoute` correctly resolve wire model IDs for sources where `source.id` acts as the provider key.
5. Account binding and missing env detection: Candidate `accountId` binds to the concrete credential account ID (`<sourceId>-<envSuffix>`), rejecting missing keys honestly with `CREDENTIAL_ENV_MISSING` and eliminating false `WILDCARD_ACCOUNT` drops.
   Evidence: 115 new `opencode-direct` candidates yielded across 6 direct sources (tencent: 72, cohere: 15, baseten: 11, inception: 2, regolo: 9, amd-radeon: 6). Unit tests in `tools/ai-brain/test/task-ai-142-direct-writer-harness.test.js` and `tools/ai-brain/test/task-ai-142-opencode-writers.test.js`.

### H3 live: audit repairs (2026-10-17)

- Tier-only rows (codingTier without a score) keep their tier: operator decision 2026-10-12 keeps imported Claude-family rows eligible for writer ranking. The live leaderboard refresh (610 models, all scored, 2026-10-17) makes this moot in practice. Recorded path drops (ROUTE_PROBE_UNPROVEN, CREDENTIAL_ENV_MISSING) appear in the rejection list with route or account scope.
  Audit repairs on Controller model quality scoring, candidate route rejection visibility, route health isolation, transient failure cooldowns, and genuine writer quota telemetry:

1. Removed all hardcoded `quality` numbers from `tools/ai-brain/seed-accounts.js` (both ANTIGRAVITY_MODELS and NINEROUTER_MODELS).
2. Purged unverified/fabricated benchmark scores from `tools/ai-brain/benchmarks.json` (leaving an empty table until verifiable external sources are cited), updated staleness audit to allow clean empty tables.
3. Missing quality scores (`quality === null`) now display as "chưa rõ" (unknown) instead of defaulting to 100 in CLI candidate outputs and dry-run decision logs; fixed unformatted weights printing `weights null`.
4. Ineligible and unprobed candidate routes are explicitly retained in `decision.rejected` and CLI summaries with exact reason codes (`ROUTE_PROBE_UNPROVEN` or `rec.status` e.g. `UNAVAILABLE_NOW`) rather than dropped silently.
5. Transient probe errors (`TIMEOUT`, `PROBE_NO_RESPONSE`) employ a 30-minute transient cooldown instead of long lockouts, enabling automatic route re-probing.
6. Real Codex quota telemetry read from the latest session rollout log (`~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`, parsing `rate_limits`), strictly checking timestamp freshness against `primary.window_minutes` and evaluating existing headroom thresholds (100% used -> exhausted with `resets_at`; >= 80% used -> tight; < 80% used -> open; stale/missing -> unknown). Auth existence alone never claims capacity, and `auth.json` contents are never read.
7. Untracked runtime state `tools/ai-brain/data/model-route-health.json` from git and added to `.gitignore`.
8. Extracted candidate quality scores from `model-priors.json` external rankings when internal evidence is absent, recording quality, source provenance, URL, and retrievedAt in `scoreBreakdown` and decision logs; normalized model IDs across router prefixes (`cl/`, `ninerouter/`), account prefixes (`::`), and effort suffixes (`-thinking`, etc.) while unmatched models remain 'chưa rõ'; added staleness detection with decision log warning and non-blocking auto-refresh on `next --run`.
9. Bound credentialed API key sources to concrete account IDs derived from source ID and env variable name when the key is populated in the environment, eliminating false `WILDCARD_ACCOUNT` drops for operator keys (tencent, cohere, baseten, inception, regolo, amd-radeon, dahl); unpopulated env keys reject cleanly with `CREDENTIAL_ENV_MISSING` while routing wildcard gates remain strictly enforced.
10. Versioned route-health schema with `CLASSIFIER_VERSION = 2` to distinguish modern HTTP-cause records from legacy unclassified records; legacy records with unversioned `TIMEOUT`, `PROBE_NO_RESPONSE`, `PROBE_EXCEPTION`, or `UNAVAILABLE_NOW` before PR #372 are recognized as unverified (`isLegacyUnverified`) and permitted to re-probe via preflight HTTP before harness launch (partitioned into the probe-eligible unknown queue in `orderProbeRoutes`), while genuine error codes (401/403/451/402/quota/geo-blocked) preserve exact classifications and cooldowns.
    Evidence: dry-run ranking decisions recorded in `data/dryrun-decision-1017.json` and unit tests in `tools/ai-brain/test/task-ai-142-audit-repairs.test.js`, `task-ai-142-quality-priors.test.js`, `task-ai-142-credential-keys.test.js`, and `task-ai-142-route-reprobe.test.js`.

### H3 live: goal items become ready when their dependencies merge (2026-10-17)

goal plan sets each goal item status once (BACKLOG when it has dependencies). After GOAL-AUTOCLAW-REPOS-1 merged, item 2 stayed BACKLOG and the runner stopped with "plan --run requires the isolated planner", although goal plan had already written its Work Item. goal resume now promotes a BACKLOG goal item to READY_FOR_AUTHOR in the goal and delivery registers when every dependency is MERGED and its Work Item file exists.

### H3 live: register sync reads merged PRs from GitHub (2026-10-17)

The register sync loaded `runGh` from governed-merge.js, which did not export it; the require threw inside a try/catch, so the GitHub source never ran and GOAL-AUTOCLAW-REPOS-5 (PR #361) stayed IN_PROGRESS after merge. governed-merge.js now exports runGh; a test drives the real GitHub path with an injected gh runner and checks the canonical and goal registers become MERGED without a review verdict. The sync is opt-in: only `next --run` turns it on, so library callers and tests never call GitHub or rewrite the repository register (with the export fixed, the full suite had rewritten the worktree register during the ship gate).

### H3 live: register auto-sync from GitHub, goal PR registration, and writer pinpointing (2026-10-16)

Controller now automatically synchronizes merged GitHub Pull Requests into FEATURE-DELIVERY-REGISTER.csv on scheduling turns and control runs (`tools/ai-brain/reconcile.js`, `tools/ai-brain/next-runner.js`, `scripts/ai/control.ps1`), avoiding false dependency-blocked states without manual edits. Goal Work Item rows and specs are preserved across isolation boundaries (`tools/ai-brain/isolation-launcher.js`) and excluded from `validate_docs.py` core feature catalog audits, allowing goal PRs to satisfy single Work Item contracts. Pre-writer pinpointing (`tools/ai-brain/pinpoint.js`, `tools/ai-brain/prompt-compiler.js`) extracts explicit file:line targets and keyword clusters across allowed paths before dispatch, cutting codebase exploration tokens.

### H3 live: context windows come from the public model catalog when a route does not report them (2026-10-16)

Live decisions at 16:35 rejected 5581 Hermes routes with `CONTEXT_WINDOW_UNVERIFIED: hermes requires verified context >= 32000` (for example `cc/claude-sonnet-5`, `gh/*`, `kimchi/*`). Higher-ranked models (gpt-6-astra 93, gpt-5.6-sol 47, gpt-6.1-sol 45) were unusable and deepseek-v4.1-flash (34) won. PR #348 correctly removed the blanket 200000 window from the 9router gateway account, and 9router's `/v1/models` reports no context, so most routed models had no context evidence. `resolveCandidateCapabilities` now falls back, only when source, row and catalogue metadata give no window, to the public models.dev catalog cached at `<hermes home>/models_dev_cache.json` (the same file Hermes reads). A model matches on its canonical leaf id (router and upstream prefixes dropped, `.`/`_` folded to `-`); where several providers list it, the smallest window wins. The candidate records `capabilities.contextEvidence = 'catalog:models.dev'`; tool_call and structured_output are copied only when every match reports them. A model absent from the catalog stays `CONTEXT_WINDOW_UNVERIFIED`. No model name or number is hard-coded.

An unreported context window no longer excludes a candidate. When neither source metadata nor the catalog gives a window, the Hermes gate and the writer ranking keep the route eligible (`contextRefusal(..., { allowUnknown: true })`) and ranking subtracts `UNKNOWN_EVIDENCE_PENALTY` (15, the value already used for unknown quota headroom, now one named constant) as `breakdown.contextPenalty`, so it ranks after an otherwise equal route with a known window. A KNOWN window below 32000 still refuses with `CONTEXT_TOO_SMALL`. When a launched run fails because the request exceeded the model context (`maximum context length`, `context_length_exceeded`, `too many tokens`, `prompt is too long`; the per-minute TPM 413 is excluded), `route-health` records `contextOverflowObserved` and any reported `observedContextLimit` on that model's path, and later Hermes brain and writer selections reject it with `CONTEXT_OVERFLOW_OBSERVED`.

### H3 live: goal rows pass the documentation validator (2026-10-16)

PR #356 [GOAL-AUTOCLAW-REPOS-1] failed CI validate/contract with `feature-register-extra: GOAL-AUTOCLAW-REPOS`: the delivery-register check treated Controller goal rows as product features missing from the catalogue. validate_docs.py now excludes GOAL-* feature ids from that check and validate_pr_contract.py counts docs/product-spec/work-items/GOAL-*.md as Work Item files (from the Antigravity item 8 change, split out so item 1 can merge).

### H3 live: the PR contract accepts Controller goal Work Items (2026-10-16)

PR #356 [GOAL-AUTOCLAW-REPOS-1] (Hermes-coded, review PASS, ai-brain-tests green) failed the contract gate because the title rule only knew FEAT-_, TASK-FOUND-_ and TASK-AI-*, so no goal item the Controller plans could ever be published. validate_pr_contract.py and AGENTS.md now also accept GOAL-<GOAL>-<n>.

### H3 live: the agy gateway returns the answer, not the agy envelope (2026-10-16)

A live call through the gateway (16/10 16:45, gemini-3.8-flash-low via the pool, HTTP 200 in 17 s) returned the raw agy JSON envelope (`{"status":"SUCCESS","response":"ok\n",...}`) as the message content and no usage. The gateway now unwraps `response` as the content and maps the agy usage (input + cache read, output + thinking, total) to an OpenAI usage object; plain-text output passes through.

### H3 live: the agy pool serves Hermes through an OpenAI-compatible gateway (2026-10-16)

`tools/ai-brain/agy-gateway.js` exposes `GET /v1/models` (the live pool model list) and `POST /v1/chat/completions` (including `stream: true` as a single SSE chunk then `[DONE]`) on 127.0.0.1 only. Each request runs one agy job on a free account (in-process lock per account) whose weekly quota for the model family is above zero, preferring the highest remaining; accounts with an unreadable quota rank last. No free account with quota returns 429; pool `quota`, `login-required` and timeouts map to 429, 401 and 504.

Start it with `AGY_GATEWAY_TOKEN=<secret>` set (it refuses to start otherwise): `node tools/ai-brain/cli.js agy-gateway --port 20140` (default port 20140, or `AGY_GATEWAY_PORT`). Clients send `Authorization: Bearer <token>`. The source is declared as `agy-gateway` in `tools/ai-brain/sources.json` (harness `hermes`, credential env `AGY_GATEWAY_TOKEN`) so the Controller can rank it as a brain.

Limitation: agy cannot run Hermes' tools, so tool calls are emulated. The prompt lists the offered tools and requires a JSON answer (`{"content": ...}` or `{"tool_calls": [...]}`); only calls naming an offered tool become OpenAI `tool_calls`. Each turn is a full agy session, so it is slower than a plain model API, and no token usage is reported unless the pool result carries it.

### H3 live: Hermes loads only project skills and keeps a truthful memory (2026-10-16)

Hermes injects the name and description of every enabled skill into each session's system prompt (agent/prompt_builder.py build_skills_system_prompt) and loads bodies on demand via skill_view; `skills.disabled` in config.yaml hides skills by name (agent/skill_utils.py get_disabled_skill_names). Live sessions only ever loaded the Controller skill, so writeProvidersConfig now disables every other installed skill by name, discovered from the Hermes home. memories/MEMORY.md is loaded into every session (agent/agent_init.py) and bounded by memory_char_limit (default 2200), so each launch replaces only the marked Controller block with goal status, item states and the last review/test outcome from the goal register, keeping user text and the limit.

### H3 live: a scheduled task resumes the goal without a model call (2026-10-16)

`schedule-task.ps1 -ControllerAction GoalResume -GoalId <id>` registers a Windows task that runs `scripts/ai/goal-resume.ps1` in the Controller worktree: it loads the user environment, runs `goal resume` (which refuses to start a second run while one is active) and appends `goal status` to `data/goals/<id>/scheduled-status.log`. No model is called. Operator command: `schedule-task.ps1 -Action Register -Trigger Periodic -IntervalMinutes 10 -ControllerAction GoalResume -GoalId AUTOCLAW-REPOS -WorkingDirectory <hermes-live> -TaskName ShipDe-Goal-Resume -Apply`.

### H3 live: probed opencode providers become writer candidates (2026-10-16)

Probed direct sources never reached the writer pool: the unbound-source branch of `generateCandidates` (`candidates.js`, the `for (const acc of bound)` loop after `harness = source.harness`) iterates bound accounts only, and discovered sources have none, so they produced zero candidates for any role. Discovery now records the OpenCode provider key (`opencodeProvider`, from `provider.<key>` in `opencode.json`), `loadSources` carries it, and `pushOpencodeProviderWriters` emits one `opencode-direct` candidate per model with `modelId` `<key>/<model>`, gateway the source id and capabilities only from per-model metadata. A source without the key yields nothing. The isolated launcher resolves discovered sources, uses the key as the opencode provider id (API key stays an env reference) and the route probe sends the wire id without the key. Existing sources need one `sources --discover --probe` run to record the key.

### H3 live: agy pool schema failures retain redacted diagnostics (2026-10-16)

On origin/main d9982a32, a fresh writer dispatch dry-run produced 147 pool candidates, with no CAPABILITY_MISSING:tools rejection (36 quota exclusions and 111 NOT_SELECTED). Per the operator assignment, capability composition is unchanged. A failed pool schema probe now carries its state, reason, exit code and last 20 non-empty output lines through jsonSchemaEvidence.detail into the routing rejection, using createSecretRedactor. The new fixture failed on main with missing detail; the repaired writer-jsonschema suite passes 12/12. Dry-run snapshots are task4-before-decision.json and task4-after-decision.json under .worktrees/logs/night; live pool execution is not claimed.

### H3 live: source headers reach Hermes runtime custom_providers configuration (2026-10-16)

When an upstream source declares headers (such as AgentRouter CLI User-Agent), `writeProvidersConfig` now writes `extra_headers` into `custom_providers` within `config.yaml` using proper YAML quoting. Hermes natively supports `extra_headers` on custom providers, passing them into the HTTP client `default_headers`. When no headers are declared, the generated YAML is unchanged and header values are never logged.

### H3 live: a router only offers models it lists itself (2026-10-16)

After operator keys were probed, the intake catalogue merged 3254 ids from many sources (for example azure/, bedrock/, vertex/, runware/ ids from Requesty), and the router branch turned every one into a 9router candidate. 9router serves none of those prefixes, so hundreds of writer probes timed out, PROBE_BUDGET_EXHAUSTED fired and GOAL-AUTOCLAW-REPOS-1 failed before any writer launched. A router now produces catalogue-derived candidates only for ids in its own listing (per-source `sourceModels` from intake, or its `source.models`); with no known listing it produces none and records `ROUTER_LISTING_UNKNOWN`.

### H3 live: Windows Task Scheduler periodic trigger for goal resume (2026-10-16)

`scripts/ai/schedule-task.ps1` previously supported only `Daily`, `Logon`, and `Hourly` triggers. It now supports `-Trigger Periodic` with `-IntervalMinutes` (default 10 minutes), allowing zero-RAM background execution of `control.ps1 -Action Resume` to periodically check and resume goals without needing a permanent daemon process. Tested and verified in `scripts/ai/schedule-task.Tests.ps1`.

### H3 live: a Hermes reselection gets its own probe window and a Hermes login failure is remembered (2026-10-16)

The probe wall-clock deadline was computed once per launch, so after a runtime route failure (Hermes printing `No Codex credentials stored`) every remaining route was skipped and the launch ended NO_REASONING_CANDIDATE. Each selection round now recomputes the deadline with the same per-round cap. A Hermes-side missing login is also recorded as an account `account_auth_failed` cooldown in the route-health store (existing 6 hour cause cooldown), so the next launch skips that candidate without probing or spawning it.

### H3 live: declared source headers reach run-time requests (2026-10-16)

A header a source declares as data (for example the CLI user agent AgentRouter requires) now reaches the requests that actually call the provider: the shared route probe, the orchestrator route candidate, the opencode provider `options.headers` written for isolated workers, and the Hermes route probe. The Hermes `config.yaml` custom provider has no verified extra-header field, so Hermes runtime calls are not changed and only its probe sends the headers; no source id is hardcoded.

### H3 live: the quota-fallback controller test is deterministic (2026-10-16)

The test spawns a cold `cli.js dispatch` process (~5s alone) under a 15s `spawnSync` budget, so full-suite parallel load could kill it (status null) and fail the exit-code assertion; HOME, USERPROFILE and APPDATA were already per-test temp dirs. The budget is now a 180s ceiling with all assertions unchanged (not reproduced in 26 runs under load, so this is the identified wall-clock cause, not an observed failure).

### H3 live: the probe learns a route's token-per-minute limit (2026-10-16)

The writer probe passed `groq/openai/gpt-oss-120b` with a tiny request, then the real first request (about 9.2k tokens) failed HTTP 413 against a 8000 tokens-per-minute limit. The probe now records `tokensPerMinuteLimit` from the `x-ratelimit-limit-tokens` header or from a 413/429 body, and a real launch's TPM 413 records `requestedTokens`; both persist in route health. Writer selection refuses a route with `ROUTE_TPM_TOO_SMALL` when its known limit is below a request size it already refused, and never refuses when either value is unknown (no token count is hardcoded).

### H3 live: the role budget wins and only writer launches count as attempts (2026-10-16)

Live on GOAL-AUTOCLAW-REPOS-1 (role author.foundation, complexity standard) budgetForItem took the minimum of the role ceiling (250k) and the complexity ceiling (150k), so a 1M-context writer that had written 4 files and edited 3 was killed at 150.5k (TOKEN_BUDGET_EXCEEDED) before committing. The explicit role budget is the more specific rule and now wins for every field it sets; complexity fills the fields the role leaves unset and the default fills the rest. The same item also ended TURN_BUDGET_EXCEEDED at selection round 14 after only a few real launches, because maxTurns was compared with the selection-round counter; it now counts actual writer launches.

### H3 live: a retry keeps the previous writer's work (2026-10-16)

A retry used to delete the worker root and re-create the branch from main, so a writer's commit (389ee9e1 on GOAL-AUTOCLAW-REPOS-1) and another writer's uncommitted files were lost. The launcher now commits uncommitted changes as a WIP commit, keeps the branch under a private host ref, and merges it into the fresh checkout, recording `carriedOver` as `merged`, `conflict` or `none` and falling back to the plain base on any failure.

### H3 live: native agy candidates use the live agy model list (2026-10-16)

The native agy candidates take their model ids from the live `agy models` listing (the pool discovery and its cache) instead of the stale ids declared on the account: declared ids the listing lacks are dropped with reason `AGY_MODEL_NOT_LISTED`, and listed ids are added. When the listing is unavailable the declared ids are kept unchanged.

### H3 live: a CLI login binding is not test evidence (2026-10-16)

After the dry-run moved to rankForProfile (#343), the reviewer pick crashed (`evidence.filter is not a function`) because the auto-bound Codex CLI candidate carried the string `cli-login` in `evidence`, the list of test results. The binding stays in `binding`; `evidence` is no longer overwritten, so review-call gets a ranked reviewer again.

### H3 live: every operator key reaches a probed source (2026-10-16)

InternLM keys now resolve to the OpenAI-compatible endpoint https://chat.intern-ai.org.cn/api/v1, and TENCENT_TOKENHUB_BASE_URL (trailing slash stripped) is the endpoint of the Tencent TokenHub key. AgentRouter declares its required CLI User-Agent as data on the endpoint table entry, and the probe sends any declared source headers (carried into the registry source entry). Intake refreshes discovery plus probe automatically when the discovered file is missing or an env key that discovery maps to a source has no entry.

### H3 live: a failed Codex schema proof records why (2026-10-16)

When the Codex jsonSchema proof fails with a generic reason such as WRITER_SCHEMA_CODEX_LAUNCH_FAILED, the result now carries a `detail` field with the exit code and the last 20 stderr lines, redacted by the shared secret redactor, and the capability rejection in the logged decision copies it. A missing-login stderr ("No ... credentials stored") now maps to WRITER_SCHEMA_AUTH_NEEDED, so the next live run's decisions show the real cause instead of an opaque launch failure.

### H3 live: the host gate baseline is the writer branch's merge-base (2026-10-16)

On 16/10 the branch feat/goal-autoclaw-repos-1 was cut from main e037323e; main later fixed 9 environment-sensitive tests, so the gate's baseline at the new origin/main passed while the writer tree still failed them, and 9 pre-existing failures were reported as new (HOST_GATE_FAILED) that the repair writer could not fix. When the base is a ref, runHostBrainGate now baselines at `git merge-base HEAD <ref>` (falling back to the ref's rev-parse); an explicit 40-hex baseSha is unchanged.

### H3 live: Hermes stops on a 401 route failure (2026-10-16)

The live output scanner in `defaultSpawn` now treats `Error code: 401` on an API failure line as a route failure, so Hermes is stopped and the brain reselected instead of running until it exits. 400 stays excluded because a bad request is not a route failure.

### H3 live: a failed JEV assessment is not cached (2026-10-16)

`assessOnce` cached the in-flight Promise, so a transient JEV rejection stayed cached and every later call in the session got the same failure. The rejected entry is now removed (only if it is still the same entry), so the next call asks JEV again; resolved results are unchanged.

### H3 live: Hermes brain context refresh (2026-10-14)

Hermes could not start: the only reasoning candidate was refused with CONTEXT_WINDOW_UNVERIFIED because the source registry modelMeta and the discovery catalogue were stale, although 9router /v1/models reports the context window. chatCommand now refreshes provider-reported context windows from each OpenAI-compatible source before selecting the reasoning model; unknown context windows are still refused. Verification: context-window, hermes-candidates and hermes-session tests 73/73; live dry-run selects a verified candidate.

### H3 Hermes context and computed ranking repair (2026-10-14)

The shared /models parser now reads provider-reported capabilities.contextWindow as well as context_length, covering 9router and other compatible sources without inventing metadata. Hermes supplies actual QUALITY_FIRST weights and requests normalization over known score dimensions; unknown dimensions previously diluted quality before quota penalties clamped scores to zero. Existing writer/reviewer scoring stays compatible. No context, quality or benchmark values were added.

Verification: TASK-AI-142 146/146 versus origin/main 142/142; full brain suite 2,095 pass, 1 skip, 0 fail (2,096 total), versus origin/main 2,091 pass, 1 skip, 0 fail (2,092 total), SHA 4e971e84. Four regressions cover context refresh, Hermes weights, unknown dimensions and strongest healthy reasoning selection using existing priors. Prettier, ESLint and git diff --check pass. Node 24 rejects the directory-form test command, so the full suite uses tools/ai-brain/test/*.test.js.

Default local dry selection has three Mercury candidates with unknown quality, all score 0. A second dry selection reads the hermes-live discovery/evidence/source metadata snapshot: 9router/cbai/deepseek-v4.1-flash ranks first at 19 (quality 34), followed by Mercury 2, 2.5 and Decide at 0. Only four candidates qualify here; no fifth rank or interactive live success is claimed. Runtime data is excluded; no push or merge.

### H3 ranked admission for unprobed Hermes routes (2026-10-14)

`requireRouteHealth` excluded advertised, verified-context models without a prior path/account probe record. Hermes now admits only missing records for ranked live probing, retains known failure and cooldown exclusions (including direct sources without a gateway), and deduplicates converged seven-part Hermes keys. The existing probe loop still requires a successful probe before launch; no health, credential, context or quality evidence is fabricated.

Read-only dry selection at 09:05 local uses `hermes-live` discovery/evidence/health plus provider `/models` context refreshed in memory. Diagnostic funnel (health gates separated from assembly for counting): discovered 1,906 -> assembled route/account rows 7,427 -> HTTP endpoint/Hermes identity 5,505 before / 4,728 after deduplication -> verified context 3,401 / 2,665 -> route health 4 / 2,665 -> cooldown 4 / 2,665 -> ranked 4 / 2,664 (one quality-floor rejection). Original production health-filtered assembly was 153 rows, yielding DeepSeek Flash 19 and three Mercury models 0; the new top ten score 78 (seven routes) and 76 (three routes). Baseten/AMD have no verified model metadata in this snapshot; discovered-only external source copies remain non-serving. These are probe candidates, not newly proven live routes.

Verification: TASK-AI-142 plus candidates 201/201; related assembly tests 37/37; the same groups on `origin/main` 4e971e84 pass 194/194 and 37/37. Three added regressions fail on main and pass here: missing-record admission with failed/credential-less routes excluded, identity deduplication, and real ranking probing an untested stronger model before a healthy weaker route while never launching its failed probe. Changed-file Prettier, JavaScript no-undef and `git diff --check` pass. No full-suite run, live Hermes launch, push or merge.

### H3 model-first Hermes ranking and exhaustive top-model route probing (2026-10-14)

Hermes reasoning selection operates in two levels:

1. Rank distinct models by model score using canonical model identity (`priors.normaliseModelId`). Route availability, price, latency and quota do not dilute or inflate model score.
2. Within the top model, order its routes: live/known-good (available within 24h) first, followed by known cost, known latency, quota headroom, stored candidate binding, and deterministic candidate key.

Operator order (no route cap): the per-model route limit is removed entirely. For the top-ranked model, Hermes probes ALL of its eligible routes in priority order, skipping only routes already proven unusable (active cooldown, missing credentials, recent failure records). Fixed attempt counts and global budgets do not cut a model short before all routes of the current top model are tried. Only when every route of that model has failed does selection advance to the next distinct model. Decision records and dry-run JSON report the top ten distinct models with scores and route counts, plus the chosen route with its selection reason.

Focused verification: `node --test "tools/ai-brain/test/task-ai-142*.test.js"` passed 152/152. Running the same tests against `origin/main` (SHA 6edb33ef baseline) resulted in 7 failures covering model-first routing, credit/quota route exhaustiveness, and attempt budgets across multi-route models. Prettier, JavaScript no-undef and `git diff --check` pass.

Offline/snapshot dry-run on `hermes-live` (10 distinct models with scores, route count for top model, and chosen route):

- Top 10 models: gpt-6-astra (93), muse-spark-1-3 (91), qwen3-8-max (85), claude-opus-5-5 (50), claude-sonnet-5-5 (49), grok-4-6 (49), glm-5-3 (48), muse-wonder (48), gpt-5-6-sol (47), kimi-k3 (47).
- Chosen model: `gpt-6-astra` (score 93, 4 routes in active snapshot; 2 routes in stored session snapshot).
- Chosen route: `hermes::http://127.0.0.1:20128/v1::9router::cl::9router::9router::cl/openai/gpt-6-astra` (reason: highest ranked eligible model; routes ordered by live/known-good, known cost, known latency, quota, stored binding, then candidate key). Stored session binding selects `hermes::https://router.requesty.ai/v1::rqsty::azure::rqsty::rqsty::azure/gpt-6-astra@eastus2`. Live usability remains unverified.

### H3 Hermes reasoning candidate: openai-codex (2026-10-14)

The Controller can offer the Hermes reasoning session a GPT model through the operator's ChatGPT plan via the built-in `openai-codex` provider in `hermes-agent` (v0.21.4):

- **Candidate eligibility:** `openai-codex` candidates appear only when `~/.codex/auth.json` exists on disk (checked strictly with `fs.existsSync`; auth tokens are never read, printed, or logged).
- **Model discovery:** Models are read from `~/.codex/config.toml` (`model` key) if present, defaulting to `gpt-6.1-sol`.
- **Context window policy:** Context length is resolved only from documented entries in hermes-agent model catalogue or metadata. If undocumented, it remains `undefined` and candidate selection refuses it with `CONTEXT_WINDOW_UNVERIFIED`.
- **Quota sharing:** Marked with `quotaGroup: "codex-chatgpt"` to reflect shared quota with the Codex CLI lane in candidate objects, ranking outputs, and decision records.
- **Config & invocation:** `writeProvidersConfig` writes `config.yaml` with `model.default` and `model.provider: "openai-codex"`, avoiding dummy endpoints or env keys. `buildHermesArgv` passes `--provider openai-codex`.
- **Probing & failover:** HTTP preflight probing is skipped for `openai-codex`, while probe or runtime failure (such as HTTP 429 rate limit) falls through to the next candidate.

### H3 openai-codex provider context fallback (2026-10-14)

When Hermes catalogue/cache metadata is absent, openai-codex now resolves context from the same canonical model in already-loaded registry modelMeta, including refreshed provider /models metadata. Multiple valid reports use the minimum; missing or invalid evidence still yields CONTEXT_WINDOW_UNVERIFIED. Priors never supply context. Focused coverage checks canonical aliases, refreshed metadata, conservative minimum, invalid values and refusal without same-model evidence.

Verification: TASK-AI-142 tests 160/160; changed-file Prettier and git diff --check pass. chatCommand({reselect:true,dryRun:true}) with hermes-live discovery and refreshed provider metadata returns dry_run: hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::gpt-6-luna is ranked (route rank 420, score 0), contextWindow 1050000, with no rejection. The chosen route is 9router/cl/openai/gpt-6-astra. Runtime output is isolated under a temporary root; no interactive Hermes launch is claimed.

### H3 atomic write Windows rename retry on transient lock (2026-10-14)

On Windows, atomic file updates via temporary file write and rename fail when another process briefly holds the target file lock, raising `EPERM`, `EBUSY`, or `EACCES`. A shared `atomicRenameSync` helper (`tools/ai-brain/atomic-rename.js`) now retries transient rename failures up to 10 attempts with synchronous backoff (50ms growing to ~500ms via `Atomics.wait` on a `SharedArrayBuffer`). When all attempts fail, the leftover `.tmp` file is unlinked and the original error is rethrown. Wired into `route-health.js` (`model-route-health.json`), `cli.js` (`writeJsonFile`, rollback, csv), `goals.js` (`writeJsonAtomic`, register csv), `approval-registry.js`, and `hermes-session.js`. Focused verification: `node --test tools/ai-brain/test/task-ai-142*.test.js` passed 165/165.

### H3 live: skip exhausted accounts (2026-10-14)

The Hermes reasoning probe spent its whole budget on one exhausted account (31 requesty routes returning 402). Once an account reports credit, quota, auth or entitlement failure, the remaining candidates on that account are skipped without spending an attempt. Verification: task-ai-142 tests 159/159; live probe dry-run chooses a live route.

### H3 concurrent reasoning probes and dead-provider skips (2026-10-14)

Rebased onto `origin/main` 11aa3640 (PR #306 account-skip behavior retained). Hermes reasoning probes now use only the 180 s wall-clock budget; caller `maxAttempts` no longer limits selection. At most eight account domains overlap, with one route per account at a time. Routes start in rank order and selection waits for higher-ranked routes before choosing a successful live probe. Credit/quota/auth/entitlement failures exclude the gateway+upstream prefix for the remaining selection; account and durable provider cooldowns stay excluded. Each eligibility/provider/account/budget skip has a refusal decision, and the final decision records the successful route. No successful HTTP probe is fabricated for `openai-codex`.

`chat4-run.out` proves 30 probes and only two Astra probes. The old decision log capped rejected rows at ten, losing individual Astra exclusions among thousands of context refusals; the exact six historical exclusions cannot be reconstructed from that log. Current stored metadata lacks verified context for other Astra routes and records `requesty/gpt-6-astra` in provider cooldown, but is not the original in-memory refreshed snapshot. The retained eight-route regression demonstrates two eligible routes, five unverified-context refusals and one cooldown, without claiming those fixture counts as live evidence. Each rejected route is now also written as an individual refusal so capped summary records cannot hide it.

Verification: `node --test tools/ai-brain/test/task-ai-142*.test.js` passed 174/174. Includes provider skips, eight-account overlap/rank priority, serialization, a successful 105th probe despite `maxAttempts: 1`, and deadline abort without launch. No live launch, push or merge.

### H3 host brain gate baseline failure filtering (2026-10-14)

When the worker full brain test suite encounters failures, `runHostBrainGate` runs the suite once on the base commit (`job.baseSha` or `origin/main`) inside a temporary detached git worktree, computes failing tests on both, and caches the base results per base SHA for the session. The gate blocks (`HOST_GATE_FAILED`) only when the worker has failures that are new against the baseline; pre-existing base failures are ignored for gating and recorded in `hostGateFailures` (`newFailures`, `baselineFailures`). If the base run itself cannot be executed, strict blocking behavior is preserved. Verification: `node --test tools/ai-brain/test/task-ai-142*.test.js` (163/163 pass).

### H3 pool and Codex writer jsonSchema proof (2026-10-14)

`jsonSchema` means a validated structured writer result, not JSON telemetry or a working model route. OpenCode currently inherits declared catalogue/account capabilities; its HTTP preflight does not verify a result schema. Pool/Codex writers now run a read-only, nonce-bound probe before selection, cache proof per seven-part candidate for that Controller run, and record precise refusals. Codex passes `--output-schema` inside the existing CLOSED isolation boundary using a separate probe worker; normal launches validate the final response too. Pool `result.json` is process telemetry; the worker answer in `out.txt.response` is validated against the contract supplied in `job.json`. Busy accounts, stale answers, wrong candidate bindings and malformed output never prove capability.

Verification: TASK-AI-142 tests 173/173; related executor, TASK-AI-141, candidates, TASK-AI-126 and TASK-AI-130 tests 159/159. Installed `codex exec --help` confirms `--output-schema`; official reference: https://learn.chatgpt.com/docs/non-interactive-mode. Tests use injected harnesses; live account capability remains unverified until the Controller probe succeeds. Existing context, quota, isolation and proof-floor gates still apply.

### H3 CI no-hardcode guard for models, scores and caps (2026-10-14)

Operator rule strictly forbids hardcoded model IDs, model lists, benchmark/quality scores, provider/account lists, or numeric attempt/probe caps in the Controller; these must originate exclusively from live sources (provider `/models`, leaderboards, route health, config). An automated guard (`scripts/ai/check-no-hardcode.mjs`) scans changed files (`git diff --name-only origin/main...HEAD`, default) or all files (`--all`) under `tools/ai-brain` (excluding test/ and fixtures) and `tools/ai-brain/data/*.json`. The checker flags model ID string literals, model-score pairs in object/array literals, and numeric literals assigned to attempt/probe/budget/quality caps. Genuine safety invariants (atomic rename retry count, Hermes minimum context window) are explicitly tracked in `scripts/ai/hardcode-allowlist.json`. Pre-existing violations on main are captured in a baseline report (`scripts/ai/hardcode-baseline.json`, 345 violations) and CI fails on any violation not in the baseline or if the baseline grows. Wired as a required step in `.github/workflows/ai-brain-tests.yml` and pre-push in `lefthook.yml`.

Verification: sequential `tools/ai-brain/test/task-ai-142*.test.js` passed 190/190; checker test suite (`task-ai-142-no-hardcode.test.js`) passed 9/9 covering detection, allowlist filtering, baseline accounting, and CLI execution; `prettier --check` and `git diff --check` passed.

H3 review repair: the guard resolves the merge-base with the configured PR base (origin/main by default) and fails on Git, read or parse errors. Baselines must have a consistent total and can only remove entries compared by file, rule and snippet; a baseline introduced by this PR is explicitly validated. Full scans include JavaScript modules and cap detection includes parameter and destructuring defaults. Verification: `node --test tools/ai-brain/test/task-ai-142-no-hardcode.test.js` passed 20/20; `node scripts/ai/check-no-hardcode.mjs` passed with 4 files scanned, 6 baseline instances and 0 new violations. The CI step and pre-push hook invoke the guard, and AGENTS.md requires it.

### H3 live public priors auto refresh (2026-10-14)

Operator-authorized extension: priors refresh defaults to the checked-in public leaderboard descriptor. Artificial Analysis Next.js Flight JSON supplies Intelligence Index; BenchLM models.json supplies published displayScore and AA coding/agentic indices. Scores retain source URL and retrieval timestamp; effort variants use the highest published AA index per canonical model. Historical benchmarks remain after current observations. Unknown models receive a neutral role-score median with priorUnknown, without overriding measured internal quality.

Live refresh at 2026-10-14T08:14:57.542Z: scored canonical models 61 -> 544. AA indices: gpt-6-luna 38.1245186869738; mercury-2.5 12.3408453757638; gemini-3.8-flash 40.9262321765904; grok-4.7 46.4465506302286; deepseek-v4.1-flash 39.456167472527; gpt-6-astra 52.673669395513. JSON reports 572 unmatched advertised catalogue IDs; catalogue advertisement is not live-route proof. No invented benchmark values or model probes. Historical snapshot assertions use a frozen fixture so public refresh does not invalidate routing regressions.

Verification: requested prior/TASK-AI-142 tests 176/176; injected fetch covers both payload formats, null scores and schema drift. Prettier and git diff --check pass. No push or merge.

### H3 account-level cooldown on exhaustion (2026-10-14)

Exhausted accounts cool down as a whole across model routes sharing the same account key (`extractAccountKey`). When a Hermes probe encounters `upstream_credit_exhausted`, `quota_exhausted`, `account_auth_failed`, or `upstream_entitlement`, the account is cooled down in `model-route-health.json` (`store.accounts[accountKey]`). Subsequent selections reject candidates on the cooled-down account with `PROBE_COOLDOWN_ACCOUNT: <account> until <timestamp>`, avoiding wasteful probes against exhausted accounts.

### H3 live: writer probe without count caps (2026-10-14)

GOAL-AUTOCLAW-REPOS-1 failed with PROBE_BUDGET_EXHAUSTED because writer probing was capped at 20 attempts and 2 routes per model. Both caps are removed for writers; only the wall-clock budget remains, and candidates on an account that reported a provider-level failure are skipped without probing. Follow-up: the reviewer path still has a 2-route cap (REVIEWER_CANONICAL_MODEL_CAP).

### H3 live: concurrent writer probing (2026-10-14)

After #312 writer routes were still probed one at a time within the 180 s budget. Writer routes are now probed concurrently (up to 8 accounts, reusing the Hermes concurrent probe) before selection; failed routes are recorded with reasons in the intake decisions. A live dry-run with real keys selected live writers.

### H3 live: writer probes known-live routes first (2026-10-15)

On 14/10 22:49 the concurrent pre-probe spent the 180 s budget on dead routes and live accounts were never reached; a failed launch of the probe winner ended NO_ALTERNATE_FAILURE_DOMAIN. Probe order now puts routes with a fresh ok route-health record first, then unprobed, then failed (rank kept inside each group; scores unchanged), and a failed launch continues to the next live route. The cause of the 22:49 ag/gemini-3.8-flash launch failure was not found in the stored artifacts.

### H3 live: stale isolation verdict refreshed automatically (2026-10-15)

A verdict older than 24h no longer waits for a human: intake and the isolation launcher run Test-WorkerIsolation.ps1 once, re-read and re-validate the verdict, and block with the original error plus exit code and stderr only if it is still stale, missing or not closed. Decisions ISOLATION_VERDICT_REFRESHED / _REFRESH_FAILED. Follow-up P2: a verifier that writes a valid verdict but exits non-zero still blocks.

### H3 live: Controller refuses to abandon an active goal run (2026-10-15)

Hermes stopped item runs that were still working (six abandoned item-1 runs on 13-14/10). goal stop now refuses with GOAL_RUN_ACTIVE while the run lock is live or the checkpoint shows activity within SHIPDE_GOAL_STALE_MIN (default 90 min); --operator bypasses; each refusal is a decision; the Hermes skill states the rule.

### H3 live: writer jsonSchema proofs share the probe budget (2026-10-15)

On 15/10 GOAL-AUTOCLAW-REPOS-1 spent 24 minutes before NO_ALTERNATE_FAILURE_DOMAIN: during writer selection every agy-pool model was proven one at a time with a real pool job and a blocking wait of up to 60 s, on pool accounts that were busy, so the writer probe budget ran out before the live 9Router route was reached. Proofs now share PROBE_BUDGET_MS (each pool proof waits at most the remaining budget); a pool account whose proof fails (busy, timeout, quota, login, error) is not proven again for its other models; routes left when the budget ends are WRITER_SCHEMA_NOT_VERIFIED_BUDGET and are not cached, so the next selection retries them.

### H3 live: resume, budget and writer launch results (2026-10-15)

Resume skips only items in PASSED, MERGED or COMPLETED; an old PASS verdict no longer hides a blocked item. Token budgets take the tightest of the complexity and role caps; defaults only fill missing fields. Every writer, host-gate repair and review repair invocation records a writer-launch-result decision (run id, candidate, exit code, session id, redacted stderr up to 4096 chars); replays are not recorded again. Probes not attempted because the budget ran out or the route had no configuration exclude the route only in that run and are retried on resume.

### H3 live: reviewer probing has no per-model route cap (2026-10-15)

The reviewer lane probed at most 2 routes per canonical model (REVIEWER_CANONICAL_MODEL_CAP), so a model whose first two providers were down was never reached through a third. The cap is removed, as it was for writers in #312; only the wall-clock probe budget bounds reviewer probing.

### H3 live: operator sources, isolation verifier exit, pre-push revision (2026-10-15)

Operator keys AiHubMix, The Grid 1-2, b.ai 1-7, Scaleway 1-2 and PGSGrove map to their vendor endpoints in source discovery; a GET /models 200 only lists models and does not prove inference or quota (b.ai needs a deposit, Scaleway returns 403, AgentRouter 401). Numbered keys without a known endpoint stay separate credentials with a null endpoint. The isolation verifier may exit non-zero while still writing a valid CLOSED verdict; that verdict is accepted, anything stale, missing or not closed still blocks. The no-hardcode guard reads code, allowlist and baseline from the same revision (HEAD for pre-push, the index for --staged, --rev when given), so neither an uncommitted fix nor an uncommitted exemption changes the result.

### H3 live: Hermes without Codex credentials reselects its brain (2026-10-15)

After #311 the Controller chose openai-codex as the Hermes brain because the Codex CLI is logged in, but Hermes keeps its own credential store and exited with "No Codex credentials stored". That exit was classified unknown, so Hermes stopped instead of trying the next brain. The classifier now treats "No ... credentials stored" as account_auth_failed (account scope), so the candidate is excluded and the brain is reselected. No credential file is read.

### H3 live: tests never write the real route-health store (2026-10-15)

Several CLI paths (next --loop, dispatch, orchestrate, assembleForDispatch) and route-health helpers fell back to tools/ai-brain/data/model-route-health.json when a test passed root or deps but no explicit file, so test fixtures (some future-dated) polluted the live store the Controller reads. The health file now resolves from args, then deps, then the given root, and only then the default; the affected tests use isolated stores, and a new test proves the default file is untouched.

### H3 live: SovInfra source (2026-10-15)

Operator key SOVINFRA_API_KEY maps to https://api.sovinfra.ai/v1. Live check on 15/10: GET /models listed sovapi, gemma-4-31b, qwen3.8-27b, qwen3-coder-next; chat completions on qwen3-coder-next and qwen3.8-27b answered. Model selection stays with the Controller (live probe and ranking).

### H3 live: writer selection from the live router inventory (2026-10-15)

Writer selection refreshes each enabled router's /models inventory once per orchestration and expands candidates independently of the OpenCode catalogue. Listed, configured and probed evidence stay separate: a listing never counts as a successful probe or benchmark. Credential, route, task and quota gates still apply; a reported zero quota excludes a route even after a successful probe, and missing quota stays unknown. Unchanged JEV assessments are cached per run with the deterministic Controller fallback on JEV failure. The inventory is attached to the selection decision record instead of a separate leading warning, and writer launch results redact injected worker-environment secrets.

### H3 live: writer probing cannot be starved by one large account (2026-10-15)

Live run GOAL-AUTOCLAW-REPOS-1 (15/10) ended `NO_ALTERNATE_FAILURE_DOMAIN` with no probe failing: `probeRankedRoutes` (`tools/ai-brain/hermes-session.js`) accepted a success only after every higher-ranked route had an outcome, and probes one route per account at a time, so a large higher-ranked account consumed the 180 s budget while the known-good route on a live account was never accepted. Ranking work before the pre-probe also started the writer budget early (`tools/ai-brain/orchestrate.js`).

- A lower success now wins once each higher account has had its best-ranked probe resolved; the rest of that account's queue no longer blocks it.
- The writer probe clock starts after ranking (jsonSchema proofs keep their own budget).
- Routes left unprobed when the budget ends are recorded as `WRITER_ROUTE_PROBE_SKIPPED` but stay selectable as fallback instead of being excluded.
- Evidence: `tools/ai-brain/test/task-ai-142-writer-probe-starvation.test.js` (fails before, passes after).

### H3 live: logged-in Codex CLI is a writer candidate (2026-10-15)

`candidates.js` `implicitCliLoginAccount` binds a source with `harness: codex` and `modelsFrom: account` to an implicit `codex-cli` account (`binding: cli-login`) when `~/.codex/auth.json` exists (existence only, never read) and no registry account is bound; model ids come only from `~/.codex/config.toml` through the Hermes reader in strict mode (no default id). Registry accounts still win. The isolated jsonSchema probe gate in `orchestrate.js` is unchanged. Live check: `codex::cli::::codex::codex-cli::codex-cli::gpt-6.1-sol`.

### H3 live: tests never rewrite the live isolation verdict (2026-10-15)

Twice on 15/10 a full test run in another worktree triggered the stale-verdict refresh with the real verifier, which rewrote the machine-wide isolation verdict for that worktree; every live launch from hermes-live then failed ISOLATION_VERDICT_INVALID (worktree mismatch) until TURN_BUDGET_EXCEEDED. Inside node --test (NODE_TEST_CONTEXT set) the refresh now never spawns the real verifier unless a runner is injected; it reports the original refusal instead.

### H3 live: logged-in Codex CLI is a writer candidate (2026-10-15)

`candidates.js` `implicitCliLoginAccount` binds a source with `harness: codex` and `modelsFrom: account` to an implicit `codex-cli` account (`binding: cli-login`) when `~/.codex/auth.json` exists (existence only, never read) and no registry account is bound; model ids come only from `~/.codex/config.toml` through the Hermes reader in strict mode (no default id). Registry accounts still win. The isolated jsonSchema probe gate in `orchestrate.js` is unchanged. Live check: `codex::cli::::codex::codex-cli::codex-cli::gpt-6.1-sol`.

### H3 live: JEV failures name their cause (2026-10-15)

Live run GOAL-AUTOCLAW-REPOS-1 (15/10) recorded every JEV assessment as `JEV_UNDECIDED:UNREACHABLE`, so the Controller fell back to BALANCED weights and ranked a fast, cheap writer first, while a direct JEV call returned QUALITY_FIRST. `advise` (`tools/ai-brain/jev.js`) and the routing catch (`tools/ai-brain/routing.js`) mapped every non-timeout error to `UNREACHABLE`, hiding the cause.

- Failures are now recorded as `CREDENTIAL_MISSING`, `TIMEOUT`, `HTTP_<status>`, `INVALID_RESPONSE` or `NETWORK_ERROR` (e.g. `JEV_UNDECIDED:HTTP_422`); no credential or response body is recorded.
- The deterministic Controller fallback is unchanged and every named cause still counts as a provider failure.
- Evidence: `tools/ai-brain/test/task-ai-142-jev-failure-reason.test.js`.

### H3 live: host-independent test fixtures (2026-10-16)

- Base: origin/main `97d8d3d68036240dc97ff8ea4288d83571d413f8`. Follow-up resolves the standalone validation gap at `e0164b1ab7c09c40f511de2b23f36f9bf1b3d26e`.
- TASK-AI-89 fixtures inject source/candidate/account defaults and unavailable advisory stubs. Its missing-registry test still omits the registry argument and mocks only the default reader; capability and account-union assertions remain intact.
- TASK-AI-141 loop fixtures use isolated roots/config. Qualification-builder fixtures now have unique temporary roots, preventing parallel runs from deleting each other's intake fixture. The default-decision-dir guard intercepts this process's append/write calls instead of comparing the live shared log before/after; attempted default writes fail and local decision records are still required.
- Both 200 ms Hermes deadline tests use Node mock Date/timers. Time advances only after pending probes have started or the lower-ranked live result has settled. Abort, concurrency, no-launch, winner identity, and persisted route-health assertions remain enforced. No Hermes production change or Task 5 overlay is needed.
- Before: new host-reader regression on unchanged main pass 0/fail 1; standalone original deadline flake 117/1. Parallel runs also reproduced shared-log snapshot and fixed-intake-directory races. After: named files task-ai-141b.test.js, task-ai-89.test.js, task-ai-142-hermes-session.test.js pass 118/fail 0/cancelled 0 in every run.
- Final stress validation: 10 full named-file runs with Windows User/Machine env loaded (NINEROUTER key present) and 10 with credential variables removed (key absent), both groups concurrently; all 20 exit codes 0. Credential values are never printed.
- Host gate and production routing are unchanged. The historical live run's exact ten failures are not claimed replayed; the isolated reader/timer/concurrent-fixture faults are directly reproduced and repaired.

### H3 live: a Hermes brain without its login is reselected (2026-10-16)

#323 classified "No Codex credentials stored" as an account failure, but Hermes prints it and exits 0, so the run counted as completed and the classifier never ran (live launch 16/10 06:03). The output scanner now treats that startup line as route evidence, so the run fails and the brain is reselected. No credential file is read.

### H3 live: per-attempt writer probe budget (2026-10-16)

- Base: origin/main `97d8d3d68036240dc97ff8ea4288d83571d413f8`.
- Retry ranking starts a fresh probe window, excluding prior writer runtime. A probe budget stop after a launch preserves the last writer failure cause.
- Regression: two injected-clock cases run a writer for 30 simulated minutes, then require a real fallback probe; both normal fallback and a later probe-budget stop retain TOKEN_BUDGET_EXCEEDED.
- Before (new tests on unchanged base): pass 0, fail 2, assertion `retry must actually probe after the long writer`.
- After: `node --test tools/ai-brain/test/task-ai-142-writer-probe.test.js`: pass 15, fail 0. Offline fixtures only; no live provider run.

### H3 live: JEV weights fall back per dimension (2026-10-16)

- Base: origin/main `97d8d3d68036240dc97ff8ea4288d83571d413f8`. Follow-up to `7239c5f0919f720dea764500f11a13b259f58199` separates numeric weighting confidence from closed-choice confidence.
- `routing.assessTask` reads optional source.weightingMinConfidence for score dimensions; `jev.advise` applies it only to scores. Preset-only/other closed choices retain source.minConfidence or DEFAULT_MIN_CONFIDENCE. The existing default remains 0.7.
- The exact live scores 4.11/1.98/1.08 and confidences 0.56/0.23/0.57 yield mixed quality/cost JEV plus preset latency with a source weighting threshold of 0.5: weights quality 52, latency 34, cost 14, logged confidence 0.23. Risk/role policy and all-low fallback remain intact. Zero trusted score mass retains preset weights/provenance.
- Before follow-up: 1 pass/2 fail for the three new policy/provenance cases on the previous commit. After: weighting file pass 13/fail 0; weighting + request-schema + failure-reason files pass 21/fail 0. All advisory responses are offline stubs.
- The operator authorized the sources.json extension on 2026-10-16. The committed JEV source now sets weightingMinConfidence: 0.5 while retaining minConfidence: 0.7 for choice answers; its policy comment distinguishes both.
- Activation regression reads the committed source and passes a stubbed HTTP response through buildJevAsk and writer-selection.assessOnce. Before this configuration change: pass 0/fail 1 (`approved weighting policy must be active`). After: the exact live example returns mixed weights 52/34/14 and confidence 0.23. Weighting file pass 14/fail 0; the three named JEV files pass 22/fail 0. No real JEV/provider request was made.

### H3 live: the isolated writer receives its context pack (2026-10-16)

The prompt told the writer to read the focused context pack at its host path, which the isolated worker cannot read (File not found), so the writer explored the repository instead and hit the 150k token budget before writing (live run 15/10 17:05, GOAL-AUTOCLAW-REPOS-1). The launcher now copies the pack into the worker's .shipde/ directory and points the prompt at the copy.

### H3 live: a dead run no longer claims its Work Item (2026-10-15)

next-runner treated every intake run without a terminal checkpoint as open for 4 h, so a killed Hermes run kept GOAL-AUTOCLAW-REPOS-1 "claimed by open run" and every goal resume skipped it. A run now counts as open only while its recorded process is alive; runs without a recorded pid keep the TTL behaviour.

### H3 live: live writer selection offers the logged-in Codex CLI (2026-10-15)

The dry-run listed the auto-bound codex-cli writer but every live run had no codex candidate: candidates.js treated the disabled Codex CLI inventory entry as an already-bound account and skipped the auto-bind. The disabled inventory binding no longer blocks it; the jsonSchema proof gate is unchanged.

### H3 live: JEV requests match the API schema (2026-10-15)

On 15/10 the live Controller got HTTP 422 then 400 from JEV and fell back to BALANCED weights, which let a weak writer rank first. Score questions now send their rubric as `criteria` (not `levels`) and use at most the API limit of 10 levels. A live call through routing.assessTask now returns a JEV decision (LOW_CONFIDENCE for the GOAL-AUTOCLAW-REPOS-1 profile) instead of an HTTP error.

### H3 live: worker token discipline (2026-10-15)

The operator observed Codex using about 174k and agy 0.5-0.8M input tokens per task, versus 60-90k for disciplined agents, mostly from whole-file reads, unfiltered test output and repeated full-suite runs. Every compiled writer and repair prompt now carries a short token-discipline block (search first, then read only a line range with the read tool; run only the named tests and keep their summary and failure lines; the Controller runs the full suite). The rule names no POSIX-only command because the isolated worker shell is PowerShell; the live 15/10 17:05 writer read whole 50-56k-character files and hit the 150k budget.

### H3 live: work-evidence W-R02 follows the canonical key shape (2026-10-16)

Direct-route candidate keys (such as `codex::cli::::codex::codex-cli::codex-cli::<model>` for the auto-bound Codex CLI) have an empty gateway segment. `tools/ai-brain/work-evidence.js` W-R02 previously required every part to be non-empty, rejecting valid direct writer keys with `WRITER_KEY_INVALID` and preventing published work from being recorded. Writer validation now uses `parseCandidateKey` from `tools/ai-brain/discovery/identity.js`, requiring non-empty harness, accessPath, upstream, and modelId, while allowing gateway, account, and quotaScope to be empty per the canonical key contract.

### H3 live: dispatch dry-run ranks via live task profile and priors (2026-10-16)

`node tools/ai-brain/cli.js dispatch --dry-run` previously routed through legacy `ranking.rankAndRecord`, scoring every candidate 26 points and ignoring priors and profile dimensions. The dispatch dry-run now routes through `routing.rankForProfile`, matching the live writer ranking order, scores, and advisory JEV caching without side effects.

### H3 live: custom candidate without gateway uses upstream instead of openai (2026-10-16)

When a candidate key had an empty gateway (e.g. `hermes::https://developer.amd.com.cn/radeon/api/v1::::amd-radeon::...`), `writeProvidersConfig` defaulted the gateway to `openai`. Hermes treated this as its built-in provider, reported "No Codex credentials stored", and exited 0. `writeProvidersConfig` now names the provider after the upstream route when the gateway is empty, and `custom` when neither is known.

### H3 live: transient probe failure (status 0) uses short cooldown instead of 24h lockout (2026-10-16)

When an upstream probe got no response (httpStatus 0, e.g. network glitch, socket hangup, connection refused, or timeout), `route-probe.js` previously classified it as `ROUTE_UNAVAILABLE` when the error body did not contain "timeout", and `route-health.js` gave `ROUTE_UNAVAILABLE` a 24-hour cooldown. This locked routes for 24 hours due to a single transient glitch ("Không trả lời != route chết; khóa ngắn và chỉ đúng model").

- `classifyProbeFailure` in `route-probe.js` now classifies status 0 failures as `TIMEOUT` (when body indicates timeout) or transient `PROBE_NO_RESPONSE`, never permanent `ROUTE_UNAVAILABLE`. Provider credentials regex check is bypassed when status is 0.
- `probeCooldownMs` in `route-health.js` assigns short cooldown (0.5 hours / 30 min) to `ROUTE_UNAVAILABLE`, `TIMEOUT`, and `PROBE_NO_RESPONSE`. Only permanent non-existent models (`HTTP_404`, `ALIAS_MISMATCH`) receive 24 hours.
- When status is 0 in `rememberProbe`, it is strictly scoped to that specific candidate route/model path record, never setting a provider-level or account-level cooldown.
- Evidence: `tools/ai-brain/test/task-ai-142-probe-transient.test.js` and updated `task-ai-142-probe-memory.test.js`.

### H3 live: detect 413 request loops and fix progress stall detection (2026-10-16)

When a model route encountered HTTP 413 (Payload Too Large / context length exceeded) or tokens-per-minute (TPM) rate limits, the worker process previously remained unclassified or hung until the launcher timeout (30 minutes). The isolation launcher now monitors worker event streams and output for HTTP 413 / Request Too Large / TPM limit signals and aborts immediately with failure reason `REQUEST_TOO_LARGE` (mapped to model scope with 15-minute cooldown in `failure-classifier.js` and `orchestrate.js`), allowing the Controller to switch to an alternative model immediately. Furthermore, stall detection (`STALLED_NO_PROGRESS`) now counts progress only on genuine worktree file signature changes, verified tool use events (`tool_use`), or monotonically increasing cumulative token usage across the session, preventing fluctuating per-step token usage from resetting the progress timer.

### H3 live: unknown cost does not penalize candidates against free models (2026-10-16)

When an unpriced candidate has unknown cost (`cost: null`), `scoreForProfile` previously divided the total score by the full weight sum (e.g. 100) including `wCost` unless `assessment.renormalizeKnownScores` was explicitly set. Consequently, candidates with unpriced routes received 0 points for the cost dimension while free models (`cost: 0`) received 100 points, allowing lower quality free models to outscore higher quality unpriced models even under quality-focused JEV assessments. `scoreForProfile` now renormalizes over known dimensions unconditionally per its contract ("Unknown sub-scores are excluded and the total renormalised over the weights that are present"), ensuring missing cost data never scores as 0 or penalizes a candidate against known or free models. Unit tests in `tools/ai-brain/test/task-ai-142-unknown-cost-scoring.test.js` verify both score calculation and dispatch ranking.

### H3 live: router candidate filtering strips gateway prefix and requires upstream (2026-10-16)

Aggregator routers like 9Router require model IDs to carry an upstream provider prefix (`cl/...`, `ag/...`, `ocz/...`, `kr/...`, `gh/...`, `groq/...`). Bare model names (e.g. `ninerouter/gpt-6-astra`, `ninerouter/muse-spark-1-3`) resulted in 404 ("Model not found") from 9Router, and candidates for OpenCode reaching 9Router incorrectly inherited `upstream: ninerouter` instead of their true upstream failure domain (`cl`, `ag`). `resolveRouterModel` in `tools/ai-brain/candidates.js` strips router prefixes (`source.modelPrefix`, `source.id + '/'`, or dispatch modelPrefix), extracts the true upstream provider, and rejects bare models or recursive router names. Candidates for OpenCode, router catalogue, and Hermes OpenAI-compatible paths now carry the true upstream provider as their failure domain and filter out unroutable bare model names. Unit test: `tools/ai-brain/test/task-ai-142-router-model-prefix.test.js`.

### H3 live: per-model capabilities derivation and no fake 200k on 9Router (2026-10-16)

- Problem: Account `ninerouter` in `tools/ai-brain/seed-accounts.js` declared blanket capabilities `{ jsonSchema: true, tools: true, contextWindow: 200000 }`. In `tools/ai-brain/candidates.js`, candidate generation for router routes (`source.kind === 'router'`, `source.reachedVia`, and `openCodeIds`/`catalogue` loops for OpenCode) copied account capabilities wholesale onto generated candidates. Upstream models routed through 9Router (such as Groq GPT-OSS 120b with actual context 131k / 8k TPM limit) falsely inherited a 200k context window and tool capabilities, bypassing writer qualification and causing infinite 413 request loops.
- Fix:
  1. Removed blanket capabilities `{ jsonSchema: true, tools: true, contextWindow: 200000 }` from account `ninerouter` in `tools/ai-brain/seed-accounts.js`.
  2. Implemented `resolveCandidateCapabilities(acc, modelId, opts)` in `tools/ai-brain/candidates.js`: for gateway/router routes, strips blanket `contextWindow` from gateway accounts and derives `contextWindow`, `tools`, and `jsonSchema` per-model from `item` (catalogue), `row` (account model row), or source/routerSource `modelMeta`. Unverified models retain `contextWindow: undefined`.
  3. Integrated `resolveCandidateCapabilities` across router catalogue candidates, reachedVia model sources, and agent-cli (OpenCode) loops.
- Verification: `tools/ai-brain/test/task-ai-142-capabilities.test.js` (pass 3/fail 0), plus all candidate and context window suites pass clean.

### H3 live: opencode-direct lane preservation, pool probe latency adaptation, and isolation launcher repair (2026-10-18)

- Trial 11 post-fix analysis and resolution across four root causes:
  1. `opencode-direct` decision log presence & candidate propagation:
     - Root cause: `probe-order.js` filtered `result.isolatedLaneRejected` using `['agy-pool', 'codex'].includes(c.harness)`, completely excluding `opencode-direct`. `decisions.js` caps general `rejected` to 10 entries (all occupied by preceding `paseo` candidates). `cli.js` also omitted `sourceModels`, `catalogue`, and `discoveryCatalogue` from `runOrchestration` options, and `candidates.js` pushOpencodeProviderWriters dropped model metadata capabilities.
     - Fix: Added `opencode-direct` to `isolatedLaneRejected` and `priority(row)` (priority -1) in `probe-order.js`. Forwarded `catalogue`, `sourceModels`, and `discoveryCatalogue` from `cli.js` to `runOrchestration`. Scoped `catEntry` and `dcEntry` to propagate declared model capabilities and context windows to `opencode-direct` candidates.
  2. `agy-pool` 9x `WRITER_SCHEMA_POOL_POOL_TIMEOUT`:
     - Real latency measurement: `out.txt` records Antigravity CLI duration `17.5810159s`; `runs.jsonl` records 9.09s–26.28s (up to 82.8s under prompt load). `result.json` total run is ~26.65s.
     - Timeout defect: `sources.resolveProbeTimeout` defaulted to `cfg.probeTimeoutMs = 8000` (8s) because `candidate.elapsedMs` and `record.elapsedMs` were undefined for `agy-pool`. 8s < 17.58s caused `waitForResult` to time out while the background task was still running. In `orchestrate.js`, the first timeout recorded a failure for account `agy-pool::ShipDe\ShipDe-agy01`, immediately failing all 8 subsequent candidates on the account.
     - Fix: Implemented `readLastRunElapsedMs(accountId, options)` in `agy-pool-runtime.js`. In `sources.resolveProbeTimeout` and `writer-schema.js`, `agy-pool` wait time is governed by measured pool latency + `safetyMarginMs` (from PR #389 `cfg.probeSafetyMarginMs = 2000`), or uses `cfg.schemaProbeBudgetMs = 180000` (from PR #389) bounded by `remainingMs`, without inventing arbitrary constants.
  3. `codex` 2x `WRITER_SCHEMA_CODEX_LAUNCH_FAILED`:
     - Real error extracted from decision log:
       `node.exe : node:internal/modules/cjs/loader:1479 ... & "C:\Program Files\nodejs\node.exe" login status *> $null ... Cannot find module 'login'`.
     - Defect: `isolation-launcher.js` line 414 invoked `& "${exeFile}" login status` without prefix arguments, attempting to execute `node.exe login` instead of `node.exe codex.js login status`. Codex was verified logged in (`Logged in using ChatGPT`, exit code 0); not an OpenAI quota issue.
     - Fix: `buildWorkerLaunchScript` now accepts `exePrefixArgs` and executes `& "${exeFile}" ${exePrefixArgsStr}login status`.
  4. 2x `TOOL_CALL_NOT_OBSERVED`:
     - Candidate: `agy-pool::ShipDe\ShipDe-agy01::::antigravity::agy01::agy01:gemini::gemini-3.8-flash-high`.
     - Diagnosis: The probe prompt asked the model to inspect the schema file with a tool, but also appended the full schema JSON to the prompt text. The model responded directly in 1 turn (`num_turns: 1`) without using tools. Moreover, `writerSchema.observedToolUse` only recognized Claude/Codex/OpenCode event streams, failing to parse Antigravity's JSON completion envelope. Finally, `candidates.js` line 2051 dropped `harnessCapabilities` (`tools: true`) when `modelCapabilities` was empty, subjecting the model to redundant tool verification.
     - Fix: Preserved `harnessCapabilities` in `candidates.js` when `modelCapabilities` is not specified, and updated `observedToolUse` in `writer-schema.js` to recognize Antigravity's completion envelope.
- Verification: `node --test tools/ai-brain/test/task-ai-142-goal-writer-pool-2.test.js` passed 7/7. Full offline test suite executed with `AI_BRAIN_MACHINE_DATA=none` and without `NINEROUTER_API_KEY`.

### H3 live: live route prioritization, HTTP account quota short-circuit, and agy-pool capability probe verification (2026-10-18)

- Trial 12 post-fix analysis and resolution across four root causes:
  1. `agy-pool` & `codex` disappearance from trial 12 decision log:
     - Root cause: PR #391 added `opencode-direct` to `isolatedLaneRejected`. Because `candidatesApi.generateCandidates` emitted 5,742 `opencode-direct` candidates ahead of `agy-pool` (98) and `codex` (1), `isolatedLaneRejected.slice(0, 10)` in `decisions.js` captured only the first 10 `opencode-direct` items, pushing `agy-pool` and `codex` past index 5742 and completely truncating them from the 10-item decision log window. Evidence in `evidence.json` confirmed `codex` and `agy-pool` (`ShipDe-agy01`, `02`, `03`, `05`, `07`) were actually probed at `2026-10-18T02:38:01.356Z`. Additionally, `codex` was rejected in `routing.js` with `NATIVE_WRITER_QUOTA_UNVERIFIED` because `readCodexSessionQuota()` returned `status: 'unknown'` due to stale rollout log (>300 min window).
     - Fix: Updated `preferKnownGood` in `tools/ai-brain/probe-order.js` to prioritize CLI lanes (`codex`, `agy-pool`) and probed direct candidates ahead of bulk unprobed direct candidates when ranking `isolatedLaneRejected`.
  2. JsonSchema probe duration & 30 candidates hitting `WRITER_SCHEMA_NOT_VERIFIED_BUDGET`:
     - Real latency measurements from `evidence.json`:
       - `opencode-direct`: median 257ms, avg 263ms (min 250ms, max 1682ms).
       - `direct-http`: median 264ms, avg 271ms (min 83ms, max 1060ms).
       - `codex`: 16,152ms (~16.15s).
       - `agy-pool`: success 18,935ms (~18.9s); pool timeout 12,180ms.
       - `paseo`: median 1,585ms, avg 1,608ms (~1.6s).
     - Budget exhaustion root cause: `orderCandidatesForProbe` assigned `opencode-direct` priority 2 ahead of live routes (`record.status === 'AVAILABLE'`, priority 3). Nguồn `source-aihubmix` ran out of quota/credits (403 / `UPSTREAM_CREDIT_OR_QUOTA`). `capability-probe.js` lacked account-level failure caching for HTTP accounts, probing all 326 models of `aihubmix` sequentially (326 * 260ms * 2 = ~170s), draining the entire 180s budget before live routes were evaluated. The 30 candidates in the log correspond to Attempt 1 (10 paseo in `rejected` + 10 opencode-direct in `isolatedLaneRejected`) and Attempt 2 (10 paseo in `rejected`).
     - Fix: In `tools/ai-brain/capability-probe.js`:
       - Prioritized live available routes (`record.status === 'AVAILABLE'` or recent route success) at priority 1, ahead of unprobed direct candidates.
       - Implemented account-level short-circuiting (`failedHttpAccounts` Map) for HTTP routes: when an account encounters `UPSTREAM_CREDIT_OR_QUOTA`, `AUTH_NEEDED`, or related account-level refusal, all subsequent models sharing that account/endpoint are immediately short-circuited without making redundant HTTP calls.
  3. 2x `WRITER_RESULT_INVALID_JSON`:
     - Candidate models: `aihubmix/qwen3.8-flash-free` and `aihubmix/qwen3.8-max-free` (account: `source-aihubmix`).
     - Raw output (redacted): The gateway returned HTTP 200 containing plain text in `choices[0].message.content`: `"Sorry, to prevent abuse of free resources, accounts that have not been recharged can only try 10 times. You can increase the free quota after recharging; https://console.aihubmix.com/topup"`.
     - Diagnosis: The upstream gateway intercepted the request and returned a plain-text quota refusal under HTTP 200 instead of a structured JSON response. `schemaApi.validate` failed with `SyntaxError` on `JSON.parse`, mapping to `WRITER_RESULT_INVALID_JSON`.
     - Fix: Updated `httpProof` in `tools/ai-brain/capability-probe.js` to inspect `message.content` under HTTP 200 for quota and recharge refusal patterns, classifying them accurately as `UPSTREAM_CREDIT_OR_QUOTA` and populating `failedHttpAccounts`. Also broadened insufficient credit regex in `tools/ai-brain/route-probe.js`.
  4. Real writer capability verification:
     - Design rule: PR #388 established that inventory and harness declarations do not authorize unprobed capability or grant implicit tools capability.
     - Diagnosis: Test 4 in `task-ai-142-goal-writer-pool-3.test.js` failed on Linux CI because it lacked mock pool accounts/models and incorrectly asserted default inheritance of `tools: true` from the harness.
     - Fix: In `tools/ai-brain/candidates.js`, preserved the PR #388 contract that candidates without catalogue capabilities do not inherit harness tools by default. In `tools/ai-brain/test/task-ai-142-goal-writer-pool-3.test.js`, self-contained test fixtures construct isolated registry/accounts/catalogue definitions, asserting unverified default capability and confirming that `tools` capability is acquired through runtime probe verification (`probeCli`).
- Verification: Unit tests in `tools/ai-brain/test/task-ai-142-goal-writer-pool-3.test.js` (6/6 pass), `task-ai-142-goal-writer-pool-2.test.js` (7/7 pass), and `task-ai-142-goal-writer-pool.test.js` (5/5 pass). Full test suite passes offline with `AI_BRAIN_MACHINE_DATA=none` and without `NINEROUTER_API_KEY`.

### H3 live: rolling source onboarding step 1 (9router)

- Implementation of rolling source onboarding framework (`tools/ai-brain/source-onboarding.js`, `tools/ai-brain/cli.js`):
  1. CLI subcommands `sources onboard <sourceId> [--record|--replay] [--json]` and `sources onboard --all --replay`.
  2. Six-stage pipeline:
     - Gắn: Source endpoint & credential verification without secret leakage.
     - Danh sách model: GET /models discovery and classification.
     - Gọi thử: Live route probe via `route-probe.js` recognizing SSE stream 200 chunk responses as live.
     - Chấm điểm: Mapping models and response alias targets (`model` field) to benchmark priors (`model-priors-live.json` / `priors.js`), assigning `QUALITY_UNKNOWN` without dropping unbenchmarked models.
     - Ghi bằng chứng: Isolated health and evidence recording with canonical 7-part keys.
     - Kiểm Controller thấy: End-to-end candidate generation (`candidates.js`) and ranking (`routing.js`) under task profile, explicitly diagnosing and reporting filtering layers and refusal reasons for unranked models.
  3. Live 9router verification:
     - 919 discovered models; 14 representative models probed and recorded into `tools/ai-brain/test/fixtures/sources/9router/`.
     - 9 models live (200 OK): `ag/gemini-3.8-flash`, `ag/gemini-3.8-flash-high`, `ag/gemini-3.8-flash-medium`, `ag/gemini-3.8-flash-low`, `gcli/grok-4.7`, `gh/gpt-4o`, `gh/gpt-4o-mini`, `ag/claude-sonnet-4-6`, `vinh` (alias).
     - 5 sample error types recorded: 400 (`HTTP_400`), 401 (`AUTH_NEEDED`), 402/503 (`UPSTREAM_UNAVAILABLE`), 404 (`PROVIDER_UNAVAILABLE`), 451 (`GEO_BLOCKED`).
     - 8 live router models enter Controller ranking under `paseo` harness; unranked models diagnosed accurately (e.g. `vinh` missing upstream prefix caught at candidate generation layer).
  4. Secret and token sanitization:
     - All keys (`sk-`), authorization headers (`Bearer`), email addresses (`@`), and token identifiers completely scrubbed from recorded fixtures. Verified clean with `grep -iE "sk-|bearer|@|token"`.
  5. Regression test suite:
     - `tools/ai-brain/test/sources-replay.test.js` exercises deterministic offline replay across all source fixtures with zero network calls, verifying deep equality against `expected.json`.
  6. Defect 5 resolution:
     - Fixed tests in `tools/ai-brain/test/task-ai-142-probe-config.test.js` to isolate `routeHealthFile` in temporary directories, preventing mutation of the production store `tools/ai-brain/data/model-route-health.json`. Covered by `tools/ai-brain/test/task-ai-142-route-health-isolation.test.js`.

### H3 live: opencode writer path (2026-10-18)

- Investigation and repair of isolated OpenCode writer execution (`opencode-direct` adapter):
  1. Root cause analysis of provider routing and stream parsing defects:
     - Model `ninerouter/tokenrouter/openai/gpt-5.6-sol`: In 9Router/upstream, returned `Content-Type: text/event-stream` with a raw non-SSE JSON payload lacking `data: ` line prefixes. OpenCode's SSE parser received 0 stream chunks, exiting with code 0 and empty text (`> build · ...` only).
     - Model `ninerouter/tokenrouter/qwen/qwen3.8-max`: Non-stream fallback from 9Router appended `data: [DONE]` directly to JSON body without delimiter, breaking standard JSON parsers with `UnknownError: Unexpected server error`. In OpenCode configuration, `tokenrouter/qwen/qwen3.8-max` was missing from declared `models` map.
     - Model `explabs/muse-spark-1.3`: The direct provider `explabs` had 0 models declared in `opencode.json` (`models: {}`), causing OpenCode to fail to route or resolve capabilities.
     - Permission boundary: In unattended execution, OpenCode auto-denied `external_directory` access for files outside the worker root (such as Controller report and usage logs), causing premature termination.
     - Empty response failure classification: An exit code 0 producing no content or tool calls was not flagged by the harness.
  2. Controller repairs in `isolation-launcher.js`, `harness.js`, and `executor.js`:
     - Dynamic `opencode.json` generation in `tools/ai-brain/isolation-launcher.js`:
       - Populated `models` map with wire ID, relative model ID, output limits (`limit.output`), and context window (`limit.context`).
       - Propagated source options (`options`, `headers`, `timeout`, `max_tokens`) from source data into `provider.<id>.options`.
       - Scoped `permission.external_directory` strictly to `workerRoot` and designated Controller report paths (`usageDir`, `usageFile`), preventing whole-machine wildcard while enabling headless operation.
       - Enforced `{env:KEY_NAME}` credential format, preventing token leakage into disk configuration.
     - Empty response detection in `tools/ai-brain/executor.js`:
       - Added `hasHarnessResponse` checking for real text or tool use events while filtering build banner lines.
       - Mapped empty responses to named error `HARNESS_EMPTY_RESPONSE` in `readSessionId`.
     - Session naming in `tools/ai-brain/harness.js`:
       - Ensured consistent `--title` fallback to work item ID or task name.
  3. Verification:
     - New unit tests in `tools/ai-brain/test/task-ai-142-opencode-writer.test.js` verifying config generation for SSE/JSON sources, permission scoping, secret redaction, and `HARNESS_EMPTY_RESPONSE` handling.

### H3 live: launcher supports direct-http writer and rejects unsupported harnesses (2026-10-19)

- Fixed UNKNOWN_HARNESS: direct-http defect where direct-http candidates were selected for writer tasks but failed at launch:
  1. Root cause: Direct model sources declaring harness `direct-http` (such as Mercury 2.5 on Inception) were admitted into writer selection and preflight, but `executor.js` / `harness.js` lacked `direct-http` in `runsOpenCodeHarness` and `HARNESSES`. When launched, the launcher failed with `UNKNOWN_HARNESS: direct-http`.
  2. Resolution: Launcher writer adapter now supports `direct-http` by routing through `opencodeDirect` (`opencode-direct`), enabling OpenCode to run direct HTTP OpenAI-compatible endpoints with dynamic config generation. Additionally, candidates whose harness has no launcher writer adapter are rejected during writer ranking and orchestrator preflight gates with `reasonCode: 'HARNESS_WRITER_UNSUPPORTED'` derived dynamically from launcher data (`listHarnesses()` in `tools/ai-brain/harness.js`) and OpenCode source aliases, with fail-closed validation and test harness injection via options.
  3. Verification: Covered by `tools/ai-brain/test/task-ai-142-direct-http-writer.test.js` and full brain test suite.

### H3 live: strict priority source lookup and credential binding in executor resolveRoute (2026-10-19)

- Fixed P1 review finding in `tools/ai-brain/executor.js`:
  1. Root cause: `resolveRoute` source lookup evaluated multiple conditions in a single `.find()` call including a loose `s.models.includes(model)` fallback, allowing an earlier aggregator or decoy source listing the same model to win over an exact provider ID match, and resolved endpoint and apiKeyEnv independently risking credential misbinding. Furthermore, credential environment variables were assigned without format validation.
  2. Resolution: Sources are now resolved in strict priority order (`provider` -> `source` -> `upstream` -> `gateway`) by exact ID match. The loose model-membership fallback is dropped (fails closed without endpoint/apiKeyEnv if no exact source ID matches). Endpoint and apiKeyEnv are always bound from the same source (or both from the assignment), preventing credential misbinding, and environment variable names are strictly validated against valid identifier format (`/^[A-Za-z0-9_]+$/`).
  3. Verification: Regression tests added to `tools/ai-brain/test/task-ai-142-direct-http-writer.test.js` covering decoy avoidance, priority order, fail-closed handling, credential misbinding prevention, and env identifier validation.

### H3 live: strong models prioritized in capability probes and fair round-robin source dispatch (2026-10-19)

- Root cause:
  - In `capability-probe.js`, candidate probe ordering prioritized prior work and recent live route success but sorted unverified candidates strictly by cost and array index without quality prior scores (`priorFor`).
  - Large catalog sources (such as 9Router with thousands of models) consumed the probe budget (`schemaProbeBudgetMs`), starving high-prior unprobed models on other sources from being probed, causing them to be rejected as `CAPABILITY_UNVERIFIED:tools / WRITER_SCHEMA_NOT_VERIFIED_BUDGET`.
- Repairs:
  - In `tools/ai-brain/capability-probe.js`:
    - Updated `orderCandidatesForProbe` to sort candidates within each work/live bucket in descending order of benchmark prior score via `priorFor`. Unscored candidates sort after scored candidates while remaining probe-eligible.
    - Added fair round-robin dispatch across sources/gateways using `probeRoundRobinBatch` from dispatch configuration, ensuring no single source exhausts the probe window.
    - Strictly validated `probeRoundRobinBatch` as a positive integer fail-closed limit (raising `DISPATCH_CONFIG_INVALID` on non-positive or invalid input) and guarded progression by `take.length > 0`.
    - Snapshotted and threaded `priors` through `probeCapabilities` into `orderCandidatesForProbe` so ordering and subsequent ranking reuse the identical snapshot without reloading machine data.
    - Guarded `preflightHttp` with `Date.now() < deadline` so budget exhaustion does not trigger HTTP preflight after deadline.
  - In `tools/ai-brain/sources.json` and `tools/ai-brain/sources.js`:
    - Added configurable `probeRoundRobinBatch` in `dispatch` configuration and exposed it via `getDispatchConfig`.
  - Trade-offs & Known Limitations:
    - Round-robin interleaves models across sources up to `probeRoundRobinBatch` per turn to guarantee source diversity and prevent large single sources from monopolizing the probe window. This deliberately trades strict cross-source prior order for source starvation prevention (inside each source, models are strictly sorted descending by benchmark prior score, with cost and index as tie-breakers).
  - Verification:
    - New tests in `tools/ai-brain/test/task-ai-142-probe-strong-first.test.js` verifying:
      - High-prior model (prior 90) on a secondary source probed before budget exhaustion ahead of 50 weak models from a large source.
      - Fail-closed validation of `probeRoundRobinBatch` when missing, negative, zero, or invalid.
      - Multi-source round-robin fairness across sources with configurable batch size and prior-descending ordering within source.
      - HTTP preflight skipping after budget deadline without cooldown recording.
      - Snapshot threading of `ranking.priors` into probe ordering.

### Launch faults are not model quality failures (2026-10-19)

FEAT-AUTH-05 run 2026-10-19 18:38 chose Qwen3.8-27B (score 55) because GPT-6 Astra, Muse Spark 1.3, Qwen 3.8 Max and Grok 4.6 carried failed evidence from Controller faults (`writeUsageReportFromHarnessResult is not defined`, worker `EPERM`, `UNKNOWN_HARNESS: direct-http` before #405, `TOKEN_BUDGET_UNVERIFIED`). Those launches never reached the model. `evidence.isQualityFailure` now counts only model-scoped or non-launch failures; routing proof, prior usability, probation and reliability use it.

### A purchase-locked model never blocks its whole account (2026-10-19)

explabs returns HTTP 429 `model_requires_purchase` for premium models such as `aion-2.0` while `gpt-6-astra` on the same key returns 200. The probe classifier read the body's `insufficient_quota` as `UPSTREAM_CREDIT_OR_QUOTA`, an account-level failure, so one locked model removed GPT-6 Astra, Muse Spark 1.3 and every other explabs model from FEAT-AUTH-05 writer selection. The classifier now returns `MODEL_LOCKED`, which is model-scoped.

### Capability probes run concurrently across accounts (2026-10-19)

FEAT-AUTH-05 runs at 18:38, 20:40 and 21:41 chose Qwen3.8-27B. Simulation on the 21:41 intake snapshot: `buildCandidates` yields 14,693 candidates including 648 explabs ones, and `rankForProfile` on cached proofs ranks GPT-6 Astra (64) above Qwen3.8-27B (55). In the probe order, however, Muse Spark 1.3 sits at position 122 and GPT-6 Astra at 183, and `probeCapabilities` probed strictly one candidate at a time inside the 180 s schema budget, so neither was ever reached. Probes now run up to `dispatch.maxConcurrentProbes` at once. One account's models stay serial, so account-level failures still short-circuit that account.

### A live-probed writer is not penalized for missing quota headers (2026-10-20)

FEAT-AUTH-05 run 2026-10-20 00:08 ranked claude-opus-5 (quality 82, live probe 200) at 67, below Qwen3.8-27B (quality 70) at 70, because explabs sends no rate-limit headers and unknown headroom cost a flat 15 points. Qwen stalled twice and the item hit the one-hour limit. A successful live route probe for the exact candidate now removes the unknown-headroom penalty; unprobed unknown and tight headroom keep theirs. Both penalties live in `dispatch.headroomUnknownPenalty` and `dispatch.headroomTightPenalty`.

### Pool writer tests no longer race the Linux file clock (2026-10-20)

`task-ai-142-agy-writer-session.test.js` failed intermittently on CI after 120 s and 30 min. `waitForResult` accepts only a `result.json` modified at or after submission, and the coarse Linux file clock could stamp the fixture's result before the submit `Date.now()`. The fixtures now mark their result as written one second later. Production waiting is unchanged.
