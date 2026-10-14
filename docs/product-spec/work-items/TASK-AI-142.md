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

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-142-H2-01` | Candidate selection for reasoning | 7-part key with `harness=hermes`, ranked by quality/priors, decision recorded | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-02` | Provider config generation | Written under `data/hermes/`, contains base_url and key env var NAME, zero secrets | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-03` | Hermes argv construction | Emits `-m <modelId> --provider <provider-name> --continue <sessionId> --create-if-missing` and `-s` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-04` | Session persistence | Stored in `data/hermes/session.json` with `{sessionId, candidateKey, goalIds}` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-05` | Route/model failure recovery | Reselects candidate and relaunches with same `--continue <sessionId>` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
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


Verification: sequential TASK-AI-141 199/199, TASK-AI-142 136/136, TASK-AI-64 129/129, dispatch-wiring 7/7 and decisions 28/28 passed. Additional candidate/routing regressions passed 74/74. Changed JavaScript passes ESLint no-undef; changed files pass Prettier and git diff --check. Live logs remain untouched and runtime data is excluded from commits.

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

### H3 atomic write Windows rename retry on transient lock (2026-10-14)

On Windows, atomic file updates via temporary file write and rename fail when another process briefly holds the target file lock, raising `EPERM`, `EBUSY`, or `EACCES`. A shared `atomicRenameSync` helper (`tools/ai-brain/atomic-rename.js`) now retries transient rename failures up to 10 attempts with synchronous backoff (50ms growing to ~500ms via `Atomics.wait` on a `SharedArrayBuffer`). When all attempts fail, the leftover `.tmp` file is unlinked and the original error is rethrown. Wired into `route-health.js` (`model-route-health.json`), `cli.js` (`writeJsonFile`, rollback, csv), `goals.js` (`writeJsonAtomic`, register csv), `approval-registry.js`, and `hermes-session.js`. Focused verification: `node --test tools/ai-brain/test/task-ai-142*.test.js` passed 165/165.

### H3 live: skip exhausted accounts (2026-10-14)

The Hermes reasoning probe spent its whole budget on one exhausted account (31 requesty routes returning 402). Once an account reports credit, quota, auth or entitlement failure, the remaining candidates on that account are skipped without spending an attempt. Verification: task-ai-142 tests 159/159; live probe dry-run chooses a live route.
