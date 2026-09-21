# TASK-AI-49 — The dashboard reads reported events instead of re-parsing transcripts

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-49` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `181` |
| Dependencies | `TASK-AI-47` (rotation view, PR #105) |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-dashboard/*`, `tools/ai-dashboard/test/*`, `scripts/ai/emit-event.sh`, `docs/product-spec/work-items/TASK-AI-49.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `scripts/ai/README.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-49-dashboard-events` |
| Pull Request | `<URL>` |

## Business outcome

The operator can run more agents at once on the same machine, and anything the
machinery does shows on the dashboard without someone first teaching the dashboard a new
text format.

Measured on the operator host on 2026-09-21: the dashboard server holds **331 MB resident
while the transcripts it reads total 9.2 MB** — about 35x the data it consumes — and it
dies with `Reached heap limit` when capped at 192 MB, so this is working set rather than
uncollected garbage. It rebuilds that state every 5 seconds whether or not anything
changed, which is 17,280 full rebuilds a day. Every 300 MB reclaimed is roughly one more
concurrent agent at the measured 377 MB per job.

## Source references

- `AGENTS.md` — "Semi-automatic workspaces": the Work Item, branch, commits, Pull Request,
  CI evidence and review comments are the complete handoff package.
- `tools/ai-dashboard/rotation.js:125,180,212` — `readdirSync` plus `readFileSync` over
  `*-run.log` and `*.log`, the transcript re-parsing this Work Item replaces.
- `tools/ai-dashboard/server.js:363,367` — `pollIntervalMs = 5000` and the
  `setInterval(pollAndBroadcast, …)` loop.
- `tools/ai-dashboard/server.js:107-119` — the existing revision check, which suppresses a
  broadcast but only *after* the full aggregation has already run.
- `.worktrees/logs/CAN-CAN-THIEP.log` — the escalation file the watchdog writes today and
  the dashboard cannot see.

## Preconditions and dependencies

- `TASK-AI-47` (PR #105) should land first; it owns the rotation view this Work Item
  re-points at a new source, and it is currently green and mergeable.
- The emitters run on Windows under Git Bash `sh`, so the emit helper must be POSIX `sh`,
  not bash-only.

## Author boundary

`GEMINI` is required: this crosses the dashboard server, its client and the shell
machinery that runs every job. It is outside the 9Router boundary because a mistake in the
emitters can stop the whole delivery pipeline. Two decisions stay with the human: whether
transcript parsing is deleted rather than kept as a fallback, and any change to what counts
as a reportable event.

## In scope

- An append-only event log at `.worktrees/logs/events.jsonl`; one JSON object per line.
- A POSIX `sh` helper `scripts/ai/emit-event.sh` that appends one event atomically, never
  fails its caller, and never writes a secret.
- Emission from the existing machinery, **alongside** today's text logs, not replacing them
  in this Work Item: `dispatch.sh` emits `job.start`, `job.lane`, `job.lane_failed`,
  `job.push`, `job.end`; `stall-watchdog.sh` emits `watchdog.restart`, `watchdog.giveup`,
  `watchdog.orphan`; `runner.sh` emits `merge` and `merge.refused` with its reason.
- The dashboard server follows the file incrementally (`fs.watch` plus a byte offset),
  keeps only derived current state in memory, and broadcasts the delta for one event.
- A dashboard panel for `CAN-CAN-THIEP.log`, so a job that needs a human is visible.
- The client stops its SSE stream on `document.hidden` and resumes with `lastEventId`.
- Tests: emitter contract, incremental reader including truncation and rotation, and the
  panel rendering.

## Out of scope

- Deleting `rotation.js` or its transcript parsing. Both sources run side by side here so
  they can be compared; removal is a separate Work Item once they agree.
- Changing the 9Router heap limit, lane lists, or anything in `dispatch.sh` other than the
  added emit calls.
- Any new data source, such as the model scan table.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-49-R01` | A failing or missing emitter never fails the job that called it. |
| `AI-49-R02` | Events are append-only; the reader tolerates truncation and rotation and never re-reads from the start on every tick. |
| `AI-49-R03` | No API key, token, PR body or transcript text is written into an event. |
| `AI-49-R04` | An unparseable line is skipped and counted, never fatal. |
| `AI-49-R05` | With no events file present, the dashboard still serves its previous behavior. |
| `AI-49-R06` | Server memory stays bounded as the event log grows: nothing accumulates per event beyond the derived current state. |
| `AI-49-R07` | A hidden tab holds no open stream; resuming uses `lastEventId` and loses no event. |

## UI states

The escalation panel defines: empty (no job needs a human — the normal state), populated
(one row per job with its reason and time), stale (events file older than the poll window),
and unavailable (no events file yet, stated plainly rather than shown as zero).

## API, event and data impact

No HTTP API change for consumers; SSE keeps `event: state` and gains `event: delta`.
No migration. The event schema is additive: an unknown `kind` must be ignored by the reader
rather than rejected, so an emitter can ship before the dashboard understands it.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-49-01` | Job runs end to end | `job.start`, at least one `job.lane`, and `job.end` appear in order | Event log excerpt |
| `AC-AI-49-02` | Emitter helper is deleted or not executable | The job still completes | Test output |
| `AC-AI-49-03` | 10,000 events appended | Server resident memory does not grow with event count | Before/after measurement |
| `AC-AI-49-04` | Event log truncated while running | Reader recovers without duplicating or losing state | Test output |
| `AC-AI-49-05` | Tab hidden then shown | Stream closes, reopens, no event lost | Console evidence |
| `AC-AI-49-06` | Watchdog escalates a job | The escalation panel shows it within one poll window | Screenshot |
| `AC-AI-49-07` | Events and transcript parsing both on | Both produce the same job state for the same run | Comparison output |
| `AC-AI-49-08` | Dashboard capped at 192 MB heap | Serves without `Reached heap limit` | Console output |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm security:secrets`
- `pnpm build`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

- Running both sources costs a little more than the end state; that is deliberate, so
  `AC-AI-49-07` can prove they agree before anything is deleted. Owner: operator. Next
  action: a follow-up Work Item removes the transcript parsing once they do.
- `AC-AI-49-08` pins 192 MB because that is the cap at which the current server dies; it is
  a regression guard, not a claim that 192 MB is the right long-term budget.
