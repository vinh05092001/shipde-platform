# TASK-AI-49 — Dispatch reaches a running agent again, through Paseo and a source registry

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-49` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `180` |
| Dependencies | `TASK-AI-24; TASK-AI-42; TASK-AI-46` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/**`, `docs/product-spec/work-items/TASK-AI-49.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-49-paseo-dispatch-adapter` |
| Pull Request | `TBD` |

## Business outcome

The operator hands over a Work Item and the system runs it. Today it cannot:
`executor.js` builds one argument vector, `ao spawn`, and AO was retired on
2026-09-22 because its controller held idle processes whose RAM was the reason
for removing it. Every plan the brain produces therefore ends in a launch
against a program that is not there.

This restores the path end to end — plan, launch, watch, resume — on Paseo, and
removes the two habits that made the old path brittle: a provider table hidden
in code, and a dispatch decision that left no evidence behind.

## Source references

- `AGENTS.md` — "Semi-automatic workspaces"; one Work Item per branch and Pull
  Request; the author never approves its own work.
- `docs/product-spec/work-items/TASK-AI-24.md` — rules R01–R09 of the executor,
  which this Work Item keeps and re-targets.
- `docs/product-spec/work-items/TASK-AI-42.md` — the implementation ceiling is a
  governed decision, not a setting.
- `docs/product-spec/work-items/TASK-AI-46.md` — benchmark evidence carries
  `verified`, and an unverified score is not proof of quality.
- `HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08` — the controller may
  route artefacts but may not invent product meaning.

## Preconditions and dependencies

- Paseo 0.8.0 installed and its daemon reachable on `127.0.0.1:6767`
  (`paseo ls -g --json` answers).
- 9Router reachable on `127.0.0.1:20128` for the OpenCode provider path.
- `tools/ai-brain` scheduler, offerings, fitness and quota modules as merged by
  TASK-AI-46. This Work Item adds no second evaluator and changes none of their
  scoring.

## Author boundary

`CLAUDE` authors it: the change is cross-layer (registry, adapter, executor,
planner ceiling) and touches the dispatch rules that keep concurrent work safe,
which is outside the 9Router boundary. It writes no product code and no
migration. Two decisions remain the human's: the concurrent implementation
ceiling, which stays a governed decision, and whether the measured per-agent
memory figure (350 MB) is the one to plan against.

## In scope

- A source registry (`tools/ai-brain/sources.json` + `sources.js`) classifying
  every dashboard source as model-source, router, agent-cli, harness,
  orchestrator or decision-service, with credential presence reported as
  present, absent or unknown — never inferred.
- Harness adapters (`tools/ai-brain/harness.js`) for Paseo and Cline, with
  `launch`, `resume`, `stop` and session-id extraction. The retired AO name
  throws rather than resolving.
- `executor.js` launches through the adapter chosen by the registry, and
  resumes an open writer rather than starting a second one.
- A decision log (`tools/ai-brain/decisions.js`): work item, candidates,
  rejected sources with reasons, chosen source, harness, session id, outcome —
  credentials scrubbed at every depth.
- `scheduler.js` lowers the implementation ceiling to what measured free memory
  can hold, only when the caller asks to be measured.
- `cli.js dispatch` passes `--cwd`, `--base`, `--decision-dir`, `--free-mb`,
  `--per-agent-mb`, `--governed-decision` and reports resumed sessions.

## Out of scope

- Any change to benchmark scoring, fitness grading or quota accounting.
- Hermes Agent as a running harness: it has a registry entry and a dispatch
  row, and it is not installed on this host. Nothing dispatches to it yet.
- Jev: `.worktrees/logs/jev.py` already asks it closed questions with a
  confidence gate. Moving that into `tools/ai-brain` is separate work.
- Moving AI state into PostgreSQL. The decision log is local JSONL on purpose.

## Business rules and edge cases

1. A router or a harness is never counted as model capacity. 9Router's catalog
   is the union of the accounts logged into it, so its size is evidence of
   routing and not of supply.
2. A source whose `kind` is unknown is refused at load. Defaulting it to
   model-source is the error the file exists to prevent, and it would stay
   invisible until the scheduler over-planned against it.
3. An OAuth session held in a credential manager reports `present: null`.
   Claiming absence retires a working account; claiming presence plans against
   one that is logged out.
4. One writer per work item and per branch, within a plan and across restarts.
   "Nothing is running" is not evidence a branch is free — only the log is.
5. A harness with no `resume` cannot take over an open writer; that assignment
   is refused rather than started again.
6. A resumed session is told not to repeat any action with an external effect
   before checking whether it already happened.
7. Free memory only ever lowers the ceiling. Spare RAM is not authorisation to
   exceed what a human agreed to.
8. The decision log never carries a credential, at any depth.

## UI states

No user-facing screen changes. The dashboard reads the same source ids; their
classification is now data it can show rather than a guess.

## API, event and data impact

No API, database or migration change. Two new local artefacts:
`tools/ai-brain/sources.json` (checked in) and `~/.shipde/decisions/*.jsonl`
(append-only, per day, local).

## Acceptance matrix

| ID | Scenario | Evidence |
|---|---|---|
| AC-AI-49-01 | A plan launches a real Paseo session and records its id | `cli.js dispatch --execute` → `LAUNCHED … session f67e7615-03c4-4f5f-bdac-8cf110591fb4`; `paseo inspect` shows `"Status": "running"` |
| AC-AI-49-02 | Nothing dispatches to AO | `getHarness('ao')` throws `RETIRED_HARNESS`; executor refuses the assignment without calling the runner |
| AC-AI-49-03 | Two independent work items run at once, one writer each | `executor.test.js` "two independent work items run in parallel"; live run in the slice log |
| AC-AI-49-04 | An interrupted work item resumes its own session | `executor.test.js` "an open writer is probed, then resumed on its own session"; `send <id>` with no `--new-branch`; the session is probed with `inspect <id> --json` first |
| AC-AI-49-05 | A harness that cannot resume refuses instead of starting a second writer | `executor.test.js` "a harness that cannot resume refuses" |
| AC-AI-49-06 | A source with no capacity is never counted as capacity | `sources.test.js` "only capacity kinds count as capacity" |
| AC-AI-49-07 | A new source routes with no code change | `sources.test.js` "a new source needs no code change" |
| AC-AI-49-08 | Measured memory lowers a governed ceiling and says so | `ceiling-governance.test.js` "measured memory lowers a governed ceiling" |
| AC-AI-49-09 | An unmeasured caller plans the same way every time | `ceiling-governance.test.js` "a caller that does not ask about memory is not measured" |
| AC-AI-49-10 | No credential reaches the decision log | `decisions.test.js` "a credential never reaches the log" |
| AC-AI-49-12 | An unreadable decision log stops a writer rather than launching one | `decisions.test.js` "the executor refuses to write when the log cannot be trusted"; a review in the same plan still runs |
| AC-AI-49-13 | A truncated final line is an interruption, not damage | `decisions.test.js` "a truncated final line is still a readable log" |
| AC-AI-49-14 | A resume never reaches a session the daemon no longer has | `executor.test.js` "a session the daemon no longer has is refused, not sent to" (`WRITER_SESSION_GONE`) and "a probe that cannot be read refuses rather than guessing" (`SESSION_STATE_UNKNOWN`); live probe against the running daemon on 2026-09-23: gone session → `WRITER_SESSION_GONE`, running session → `alive`, resumed |
| AC-AI-49-11 | An exhausted source is refused with its reason, not retried blindly | live probe: `kr/*` 402, `gh/*` 403, `ag/*` unavailable; the run selected `groq/openai/gpt-oss-120b` |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"` → 700 tests, 700 pass, 0 fail
- `npx eslint tools/ai-brain/executor.js tools/ai-brain/test/executor.test.js` → clean
- `npx prettier --check tools/ai-brain/{sources,harness,decisions,executor,scheduler,cli}.js tools/ai-brain/sources.json` → clean
- `node tools/ai-brain/cli.js dispatch --dry-run`
- `node tools/ai-brain/cli.js dispatch --plan <plan> --execute --cwd <worktree> --decision-dir <dir>`
- Live probe of the resume path against the running daemon (2026-09-23): a
  logged session that no longer exists → `REFUSED WRITER_SESSION_GONE`; a
  running session → probe verdict `alive` through
  `paseo inspect <id> --json` (exit 0), a gone one → exit 1 with
  `INSPECT_FAILED / Agent not found`.

## Codex review record

Independent review of commit `e4d0152` returned CHANGES_REQUIRED
(2026-09-23; reviewer noted in the PR — a non-Codex model, no review grade,
so its findings are evidence, not an authoritative verdict). Findings:

1. `readDecisions` collapsed missing/corrupted/truncated into "empty", so a
   lost log read as "no writer" — fixed in `086aa5c`
   (AC-AI-49-12, AC-AI-49-13).
2. The resume path sent to a session without checking it still exists —
   fixed by this change: the session is probed before every resume, a gone
   session is refused `WRITER_SESSION_GONE`, an unreadable probe refuses
   `SESSION_STATE_UNKNOWN`, and a live but idle session still resumes
   (AC-AI-49-14).
3. The old `ao` mapping on `main` — follow-up; this branch's executor has no
   `ao` path.
4–6. Credential scrubbing, test behaviour and contract compliance confirmed
   correct.

## Residual limitations

- Hermes Agent is registered and not installed; no dispatch reaches it.
- Cline has no resume, so an interrupted Cline writer must be released by a
  human before that work item can move.
- The 350 MB per-agent figure is measured from Cline workers; a Paseo session
  that runs Codex or Claude may cost more, and nothing measures a live session
  yet.
- The decision log is local to this host. A second machine dispatching the same
  register would not see its writers.
- There is no lock on it either. Two `executePlan` calls running at the same
  instant can both read the log before either appends, and both launch. The
  one-writer rule holds against restarts, not against a race between two
  dispatchers on one machine. Raised by the independent review of PR #136.
- `paseo stop` interrupts a session but nothing yet marks the work item
  completed or failed in the log, so a stopped session still reads as an open
  writer until something records the end.
