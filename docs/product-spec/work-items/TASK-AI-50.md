# TASK-AI-50 — A planning harness that is installed, and a fast decision layer inside the brain

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-50` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `181` |
| Dependencies | `TASK-AI-49` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/**`, `docs/product-spec/work-items/TASK-AI-50.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-50-hermes-jev-clean` |
| Pull Request | `TBD` |

## Business outcome

TASK-AI-49 closed the two gaps in its own limitations: Hermes Agent had a
registry entry and was not installed, and Jev lived in a shell script beside
the dispatcher where nothing in the brain could use it.

Both cost the same thing. A registry row for a program that is absent is a
promise the scheduler cannot keep, and a decision layer outside the brain means
the brain still answers closed questions with an expensive model — or, worse,
with a hardcoded default.

This branch is the reworked, review-record-decision changes applied to a clean
branch at the TASK-AI-49 merge point. It ships the Hermes adapter and the Jev
module; wiring `cli.js dispatch` to ask Jev per item is the next Work Item, not
part of this one.

## Source references

- `docs/product-spec/work-items/TASK-AI-49.md` — Risks and limitations: "Hermes
  Agent has a registry entry and is not installed"; "Jev is registered as a
  decision service … moving that into `tools/ai-brain` is separate work".
- `AGENTS.md` — author routing: 9Router is for work that is already fully
  specified, bounded and deterministically provable; everything else is
  foundation work. That distinction is what Jev is asked to make.
- `tools/ai-brain/capabilities.js` — `ROLES`, the closed set Jev chooses from.
- `.worktrees/logs/jev.py` — the shell prototype this replaces, including the
  confidence floor it arrived at by losing a turn without one.

## Preconditions and dependencies

- TASK-AI-49 merged: this branch is based on `origin/main` at `7253614`, which
  carries `harness.js`, `sources.js` and `decisions.js`.
- 9Router reachable on `127.0.0.1:20128`; Hermes is configured to reach its
  models through it (`%LOCALAPPDATA%/hermes/config.yaml`, no model pinned).
- `TYPESAFE_API_KEY`, or `~/.typesafe-key`, for Jev. Absent, Jev reports
  unavailable and every caller keeps its previous behaviour.

## Author boundary

`CLAUDE` authors it: it changes the dispatch path and adds a new harness, which
is outside the 9Router boundary. It writes no product code and no migration.

One decision stays with the human: whether a Jev verdict may ever *raise* an
item to `author.foundation` as well as lower it to `author.lowrisk`.
`classifyTask` can return either; the wiring that would act on it is the next
Work Item, so no reassignment happens until that decision is made.

## In scope

- Hermes Agent installed (`hermes-agent` 0.21.4) and configured to take its
  models from 9Router, with no model pinned (config change outside the repo).
- A `hermes` harness adapter in `harness.js`: launch, resume, stop, and a
  durable handle (the workspace directory), closing the first-review gaps:
  - **Gap 1** — detached, inspectable, stop-able: the adapter owns the pid,
    `stop` returns `{ kill: <pid>, tree: true }`, the executor records the pid.
  - **Gap 2** — never fire-and-forget: `inspect` returns an executable argv
    probe (`hermes sessions list`), and `runHarness` runs probes with `sync:
    true` even for detached adapters so a probe completes instead of being
    handed a pid nobody reads.
  - **Gap 3** — no internal-subagent deception: dispatch passes a single `-z`
    process and never toolset/subagent flags; the implementation ceiling counts
    processes, and Paseo spawns separate workers.
  - **Gap 4** — a per-harness context floor (32k for Hermes), enforced by the
    executor before it launches; an unrecorded context window is not a refusal.
- `runHarness` supports a detached adapter, so a harness with no background
  mode does not hold the dispatching process for the length of a Work Item.
- `tools/ai-brain/jev.js`: the canonical closed-question decision layer with
  `classifyTask`, `pickLane`, `classifyFailure` and `classifyJob`.
  - **Gap 5** — one canonical Jev: `.worktrees/logs/jev.py` and
    `.worktrees/logs/jev-verdict.py` are reduced to shims that only do I/O and
    delegate every decision to `jev.js`.
  - **Gap 6** — closed questions only: no free-text/prose mode; structurally
    cannot stop a work item as done or reassign on prose.
  - **Gap 7** — unreachable or below confidence (floor 0.7) is undecided,
    never a guess.
  - **Gap 8** — role choice criteria come from `capabilities.listRoles()`, not
    hard-coded names (AC-AI-50-09).

## Out of scope

- Wiring `cli.js dispatch` to ask Jev which role each ready item needs and
  acting on the verdict (register-row reassignment). Deliberately left to the
  next Work Item so the module and its evidence land reviewed before anything
  reassigns queue rows.
- Letting Hermes spawn subagents under the executor's accounting. It can, and
  nothing here counts those children against the ceiling.
- Repairing the operator's 9Router wiring so every model route answers; see
  `Residual limitations`.
- Any change to benchmark, fitness, offering or quota scoring.

## Business rules and edge cases

1. Jev may only be asked closed questions. `validateQuestions` refuses a
   question with no option set, and refuses a "choice" with fewer than two
   options; the module has no free-text mode, so it cannot be asked to write
   code or to decide that a Work Item is finished.
2. An answer below the confidence floor (0.7) is discarded. The rejected choice
   is still reported and logged, so an operator can see what was not trusted.
3. An unreachable Jev, or a missing credential, is undecided — never a guess.
   Nothing is sent when there is no credential.
4. An answer to a question that was not asked is ignored.
5. A `planner.default` or `reviewer.primary` verdict is returned as data only;
   nothing in this branch reassigns a register row (the acting logic is the
   next Work Item and the human-decision on raising items is still open).
6. Hermes runs detached. Its durable handle is the workspace directory, because
   `-z` prints no session id and `--resume latest --in <dir>` is what actually
   continues the session.
7. A detached start that throws is a failure, not a launch.
8. Each Hermes assignment is one `-z` process; dispatch passes no toolset or
   subagent flags, and the ceiling counts Hermes processes, not the subagents
   Hermes may fan out inside its own process.

## UI states

No user-facing screen changes.

## API, event and data impact

No API, database or migration change. Configuration added outside the repo:
`%LOCALAPPDATA%/hermes/config.yaml` and its `.env`, which holds the 9Router key
and is not committed.

## Acceptance matrix

| ID | Scenario | Evidence |
|---|---|---|
| AC-AI-50-01 | Hermes is installed and its CLI answers | `hermes --version` → 0.21.4; `hermes sessions list` exit 0 with a table (used as the live probe). A full `-z` one-shot is verified with `-m mistral/codestral-latest` in PR-138; on this clean branch the same call is blocked by the gateway wiring — see residual limitations — and `test/live-run.js` records the blocking error instead of faking success |
| AC-AI-50-02 | A Hermes session resumes with its history | PR-138 stored `4417` in one run and recalled it in the next via `--resume latest --in`; clean-branch evidence is the resume argv + live-probe gate: `executor.test.js` "a hermes writer resumes after a live probe, never a blind send" (probe `sessions list` runs `sync`, resume is `--resume latest`, no `--new-branch`) |
| AC-AI-50-03 | The executor launches Hermes | `jev.test.js` "one assignment is one hermes process, counted against the implementation ceiling"; "a hermes launch never asks for subagents or a toolset"; `live-run.js` builds the launch argv and runs the real CLI |
| AC-AI-50-04 | The executor probes before resuming Hermes | `executor.test.js` "a hermes writer resumes after a live probe"; "a hermes probe that fails refuses, and does not guess" → REFUSED SESSION_STATE_UNKNOWN |
| AC-AI-50-05 | A detached harness does not block the caller | `jev.test.js` "a detached run does not wait, and reports the start with a pid"; "a detached start that throws fails closed"; "a probe runs to completion for a detached adapter when sync is set" |
| AC-AI-50-06 | Jev cannot be asked an open question | `jev.test.js` rejects a non-closed type, a one-option choice, and an empty call |
| AC-AI-50-07 | A low-confidence answer is discarded | `jev.test.js` "an unsure answer is discarded and says so"; "the floor is configurable per call"; "a missing confidence is not confidence" |
| AC-AI-50-08 | An unreachable Jev leaves the decision where it was | `jev.test.js` "an unreachable service is undecided, not a guess"; "no credential means unavailable, and nothing is sent"; "a throttled service is unavailable, never parsed as a verdict" |
| AC-AI-50-09 | Jev only offers roles the capability registry defines | `jev.test.js` "classifyTask offers only roles capabilities.js defines" — two-way membership against `ROLES` |
| AC-AI-50-10 | A live classification returns with confidence | `test/live-run.js` real `classifyTask` on a TASK-AI-50-shaped item → `decided`, `planner.default`, confidence 0.81 (real call, keyed via env file, never printed) |
| AC-AI-50-11 | A non-authoring verdict never reassigns | Nothing in this branch reassigns register rows; acting on verdicts is the documented next Work Item |
| AC-AI-50-12 | A model too small for the harness is refused before launch | `jev.test.js` "the executor refuses before launching, not after the model does"; the runner is never called; "a model below the floor is refused for hermes" |
| AC-AI-50-13 | A missing context window is not a refusal | `jev.test.js` "an unrecorded context window is not a refusal"; "a harness with no floor accepts anything" |
| AC-AI-50-14 | A detached run keeps its pid so it can be stopped | `jev.test.js` "a detached launch keeps its pid, so the run can be stopped"; "stop returns the tree-kill for the pid when a pid is known"; `process-lifecycle.js` launches a real detached process and removes it with the adapter-returned `taskkill /PID /F /T` |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"` — full suite, no failures
- `npx prettier --check` on every changed file
- `git diff --check`
- `node tools/ai-brain/test/live-run.js` — real Hermes CLI + real Jev (records
  the current gateway limit honestly)
- `node tools/ai-brain/test/process-lifecycle.js` — real detached process tree
  killed via the adapter instruction
- Python shim smoke: `python logs/jev.py lane <one lane>`, `python -c "import
  sys; sys.path.insert(0, r'<logs>'); import jev; jev.ask(...)"` — decisions
  return from `jev.js`, keys from env only

## Codex review record

Pending. The author does not review its own work.

## Residual limitations

- Hermes has no background mode, so nothing watches a run after it starts.
  Paseo sessions can be listed and inspected; a Hermes run is found through
  `hermes sessions list` or its recorded pid.
- `stop` works only for a run whose pid was recorded at launch. A run started
  by something else, or whose record was lost, can be stopped only by hand —
  the adapter returns null rather than pretending otherwise.
- Subagents Hermes spawns are not counted against the implementation ceiling.
- `cli.js dispatch` does not yet ask Jev; the register row is not reassigned by
  a verdict. That wiring is the next Work Item.
- **Environment gate on this machine:** only `groq/openai/gpt-oss-120b`
  (128k) answers Hermes' requests end-to-end through the 9Router gateway
  (matrix-tested 2026-09-25: `cc/`, `bzl/`, `ag/`, groq-llama4 and groq-qwen
  routes never return for Hermes' payload; `--ignore-rules`,
  `--ignore-user-config` and `--safe-mode` do not shrink it below 128k). A
  full `-z` plan completion is therefore blocked by gateway wiring, not by the
  adapter; `test/live-run.js` exercises the real CLI and records that error.
- The context floor is a per-harness constant (32k for Hermes), not something
  measured. A model that clears it can still be too small for a long task.

## Next Work (decided, not claimed)

1. Wire `cli.js dispatch` to call `jev.classifyTask` per ready item, log the
   verdict with confidence, and — subject to the open human decision — lower
   to `author.lowrisk` or raise to `author.foundation`; `--no-jev` opt-out.
2. After the gateway wiring is repaired, complete one live supported-model
   `-z` plan and record it as AC-AI-50-01 updated evidence.