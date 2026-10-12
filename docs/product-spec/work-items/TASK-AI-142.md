# TASK-AI-142 — Hermes chat brain wired to the Controller

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-142` |
| Feature ID | `N/A` |
| Status | `IN_PROGRESS` |
| Delivery order | `252` |
| Dependencies | `TASK-AI-141; TASK-AI-132; TASK-AI-50` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Complexity | `standard` |
| Allowed paths | `tools/ai-brain/hermes-session.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/skills/shipde-controller/SKILL.md`; `scripts/ai/hermes-chat.ps1`; `tools/ai-brain/test/task-ai-142-hermes-session.test.js`; `docs/product-spec/work-items/TASK-AI-142.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-142-hermes-session` |
| Pull Request | `Pending` |

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
  - Hermes argv construction: `-m <modelId> --provider <provider-name> --resume <sessionId>` plus skill `-s`.
  - Relaunch loop with same `--resume <sessionId>` on route/quota/model failure; local failure does not cool down model.
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
   - Interactive chat command: `hermes chat [-m MODEL] [--provider P] [--resume SESSION_ID] [-s SKILLS]`. The `chat` subcommand is standard.
4. **Session resumption semantics:**
   - Sessions persist under `$HERMES_HOME/sessions`. Passing `--resume <sessionId>` connects to the persistent session state.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-142-H2-01` | Candidate selection for reasoning | 7-part key with `harness=hermes`, ranked by quality/priors, decision recorded | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-02` | Provider config generation | Written under `data/hermes/`, contains base_url and key env var NAME, zero secrets | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-03` | Hermes argv construction | Emits `-m <modelId> --provider <provider-name> --resume <sessionId>` and `-s` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-04` | Session persistence | Stored in `data/hermes/session.json` with `{sessionId, candidateKey, goalIds}` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-05` | Route/model failure recovery | Reselects candidate and relaunches with same `--resume <sessionId>` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-06` | Local failure handling | Local environment failure does not cool down or exclude the model | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-07` | CLI entries | `chat` and `goal session` commands work and output JSON | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-08` | Skill & script integration | Skill forbids unauthorized behaviors; powershell entry point forwards to CLI | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-142-hermes-session.test.js`
- `npx prettier --write tools/ai-brain/hermes-session.js tools/ai-brain/cli.js tools/ai-brain/skills/shipde-controller/SKILL.md scripts/ai/hermes-chat.ps1 tools/ai-brain/test/task-ai-142-hermes-session.test.js docs/product-spec/work-items/TASK-AI-142.md`
- `git diff --check`

## Residual limitations

- Real binary verification is deferred to Part H3 live acceptance per prompt requirements (no binary or provider keys in this account).

## Part H1 record (goal store and Controller contract)

### Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-142` |
| Feature ID | `N/A` |
| Status | `IN_PROGRESS` |
| Delivery order | `252` |
| Dependencies | `TASK-AI-109`, `TASK-AI-132`, `TASK-AI-141` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/goals.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-142-goals.test.js`; `docs/product-spec/work-items/TASK-AI-142.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-142-goal-contract` |
| Pull Request | `Pending` |

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

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| H1-R01 | `goal start --text "<goal>"` | Creates `data/goals/<goalId>/goal.json`; identical text is idempotent | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R02 | `goal amend <goalId> --text "<extra>"` | Appends constraint to `constraints[]`, updates `updatedAt`, no new run | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R03 | `goal plan` missing sources/verification/criteria | Returns `status: BLOCKED` with concrete questions in `questions[]` | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R04 | `goal plan` with valid plan | Writes Work Item docs and register rows; status `PLANNED` | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R05 | `goal run` single instance | Detached start creates `run.lock`; second call reports running pid | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R06 | `goal status` per item inspection | Returns state, candidate key, branch, commit SHA, test result, review verdict, last decision id | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R07 | `goal stop` and `goal resume` | Stops running pid, writes stop file; resume skips `PASSED`/`MERGED` items | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R08 | Decision log linking | Entries link `goalId -> workItemId -> candidateKey -> session -> commit -> review` | `tools/ai-brain/test/task-ai-142-goals.test.js` |
| H1-R09 | CLI JSON output | All subcommands output JSON on stdout; non-zero exit code on refusal | `tools/ai-brain/test/task-ai-142-goals.test.js` |

### Verification commands

- `node --test tools/ai-brain/test/task-ai-142-goals.test.js`
- `npx prettier --check tools/ai-brain/goals.js tools/ai-brain/cli.js tools/ai-brain/test/task-ai-142-goals.test.js`
- `git diff --check`

### Residual limitations

- Part H2 Hermes session selection, custom config binding, and `shipde-controller` skill file are delivered in Part H2.
- Live acceptance across chat and controller runs in Part H3 following merge of H1 and H2.
