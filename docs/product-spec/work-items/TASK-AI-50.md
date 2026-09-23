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
| Branch | `feat/task-ai-50-hermes-and-jev` |
| Pull Request | `TBD` |

## Business outcome

TASK-AI-49 closed the two open gaps in its own limitations: Hermes Agent had a
registry entry and was not installed, and Jev lived in a shell script beside the
dispatcher where nothing in the brain could use it.

Both cost the same thing. A registry row for a program that is absent is a
promise the scheduler cannot keep, and a decision layer outside the brain means
the brain still answers closed questions with an expensive model — or, worse,
with a hardcoded default. Every Work Item in the register was ranked as
`author.foundation`, so a fixture task and a foundation migration competed for
the same top-grade model.

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

- TASK-AI-49 merged or in review: this branch is based on it and uses
  `harness.js`, `sources.js` and `decisions.js`.
- 9Router reachable on `127.0.0.1:20128`; Hermes is configured to reach its
  models through it.
- `TYPESAFE_API_KEY`, or `~/.typesafe-key`, for Jev. Absent, Jev reports
  unavailable and every caller keeps its previous behaviour.

## Author boundary

`CLAUDE` authors it: it changes the dispatch path and adds a new harness, which
is outside the 9Router boundary. It writes no product code and no migration.

One decision stays with the human: whether a Jev verdict may ever *raise* an
item to `author.foundation` as well as lower it to `author.lowrisk`. This
implementation lets it do both, because a register default of "foundation" is
not evidence either.

## In scope

- Hermes Agent installed (`hermes-agent` 0.21.4) and configured to take its
  models from 9Router, with no model pinned.
- A `hermes` harness adapter: launch, resume, and a durable handle.
- `runHarness` supports a detached adapter, so a harness with no background
  mode does not hold the dispatching process for the length of a Work Item.
- `tools/ai-brain/jev.js`: the closed-question decision layer, with
  `classifyTask`, `pickLane`, `classifyFailure` and `classifyJob`.
- `cli.js dispatch` asks Jev which role each ready item needs, logs the
  verdict, and falls back to the register default when Jev is unsure or
  unavailable. `--no-jev` turns it off.

## Out of scope

- Retiring `.worktrees/logs/jev.py`. The dispatcher still calls it; switching
  that over is a change to the shell lane, not to the brain.
- Letting Hermes spawn subagents under the executor's accounting. It can, and
  nothing here counts those children against the ceiling.
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
5. A `planner.default` or `reviewer.primary` verdict does not reassign an item
   the register has already marked ready for an author; only the two authoring
   roles are acted on.
6. Hermes runs detached. Its durable handle is the workspace directory, because
   `-z` prints no session id and `--resume latest --in <dir>` is what actually
   continues the session.
7. A detached start that throws is a failure, not a launch.

## UI states

No user-facing screen changes.

## API, event and data impact

No API, database or migration change. Configuration added outside the repo:
`%LOCALAPPDATA%/hermes/config.yaml` and its `.env`, which holds the 9Router key
and is not committed.

## Acceptance matrix

| ID | Scenario | Evidence |
|---|---|---|
| AC-AI-50-01 | Hermes is installed and answers through 9Router | `hermes --version` → 0.21.4; `hermes -z "Reply with exactly: HERMES-OK" -m mistral/codestral-latest` → `HERMES-OK` |
| AC-AI-50-02 | A Hermes session resumes with its history | stored `4417` in one run, recalled it in the next via `--resume latest --in` |
| AC-AI-50-03 | The executor launches Hermes | `LAUNCHED SLICE-HERMES … session dir:…/hermes-slice`; `hermes sessions list` shows the session in that workspace |
| AC-AI-50-04 | The executor resumes Hermes on the same workspace | second dispatch → `0 launched, 1 resumed` |
| AC-AI-50-05 | A detached harness does not block the caller | `jev.test.js` "a detached run does not wait"; a failed start is exit -1 |
| AC-AI-50-06 | Jev cannot be asked an open question | `jev.test.js` rejects a non-closed type, a one-option choice, and an empty call |
| AC-AI-50-07 | A low-confidence answer is discarded | `jev.test.js` "an unsure answer is discarded and says so" |
| AC-AI-50-08 | An unreachable Jev leaves the decision where it was | `jev.test.js` "an unreachable service is undecided" |
| AC-AI-50-09 | Jev only offers roles the capability registry defines | `jev.test.js` asserts every offered role exists in `ROLES` |
| AC-AI-50-10 | A live classification is logged with its confidence | real call on TASK-AI-44 → `planner.default`, confidence 0.98, written to the decision log |
| AC-AI-50-11 | A non-authoring verdict does not reassign the author | same run kept `author.foundation` for TASK-AI-44 |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"`
- `npx eslint tools/ai-brain/*.js tools/ai-brain/test/jev.test.js`
- `npx prettier --check` on every changed file
- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/cli.js dispatch --dry-run` (live Jev)
- `node tools/ai-brain/cli.js dispatch --plan <hermes plan> --execute --no-jev`

## Codex review record

Pending. The author does not review its own work.

## Residual limitations

- Hermes has no background mode, so the adapter starts it detached and nothing
  watches it afterwards. Paseo sessions can be listed, stopped and inspected;
  a Hermes run can only be found through `hermes sessions list`.
- Nothing yet stops a Hermes run: the adapter has no `stop`.
- Subagents Hermes spawns are not counted against the implementation ceiling.
- `.worktrees/logs/jev.py` still exists and the shell dispatcher still uses it.
  Two implementations of the same contract can drift.
- Jev's live verdict on TASK-AI-44 was `planner.default` at 0.98 — that item
  may genuinely need planning before an author takes it, which is a product
  decision for the human, not something this change acts on.
- Hermes loads its own tools and rules, so a small-context model refuses the
  request outright ("grown too large"). The pool must prefer models with a
  large context for this harness, and nothing enforces that yet.
