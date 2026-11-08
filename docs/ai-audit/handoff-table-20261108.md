# TASK-AI-171 handoff table, 2026-11-08

Governing document: `docs/ai-handoffs/ShipDe-Claude-Overnight.md` at 380e57a2. Nothing here is merged.
Status words follow that document. Owner of all rows: Claude as coordinator, Codex as writer or reviewer where named.

## Sections 0 to 10

| Section | Status | Evidence | Open item |
| --- | --- | --- | --- |
| 0 Monitoring | PARTIAL | Watchers per job, RAM guard on suites | Two idle gaps by the coordinator, see Limits |
| 1 Cache #528 | LIVE PASS | Merged `d82e0db4`; dispatch 280 s to 2 s offline | None |
| 2 No silent inference | OFFLINE PASS | #534 `6c709ca8`, Codex PASS, 21/21 | CI `contract` |
| 3 Trace 61 vs 76 | OFFLINE PASS | #536, structured JSON; supervisor reads it | S3 head `a9c7055c` needs a fresh verdict; `route.js` review open |
| 4 Score and policy | PARTIAL | #526 `2bc5eef9` Codex PASS; head `6438cde0` is format only; 6 models scored, 55 unknown | Latency, cost, reliability unmeasured |
| 5 JEV call path | LIVE PASS, one case | #535 `9efeb40f` Codex PASS; live `DECIDED`, 560 ms, 2095 in, 101 out | Model choice question not exercised live |
| 6 Fallback and mock | OFFLINE PASS | OpenCode 1.18.31: `max_tokens` honoured; 402 no resend; 429 9 requests over 77 s; restart and limit | `route.js` is outside the repo |
| 7 Offline full flow | OFFLINE PASS | Replay hash equal twice, `d3fd47e6e5888bcf` at `f50cac91`; #530 `b4e3c390` Codex PASS | Replay not repeated after P5 |
| 8 Live calls | LIVE PASS, small | Controller-selected ticket `414b623c` on `agy04`, rerun 9/9, Codex PASS; decision-supervised ticket `9bdccdfb` on `cmc`, 5/5, Codex PASS | A product ticket is still unproven |
| 9 Repo and tools | PARTIAL | #531 `899725f8` Codex PASS, audit 69 rows, 57 without execution evidence | 0/65 AGY list found, backlog below |
| 10 Review and handoff | THIS FILE | Integration #537 Codex PASS at `661a7b55` | Merge decision belongs to the operator |

Scans (isolated files, health and evidence stores untouched): Controller full scan 126 alive of 2111 routes on 17 sources; 9Router 150 of 1232 returned 200; free models through OpenCode 62 of 148.

Full suite on `037df02a`, serial: 3428 tests, 3384 pass, 43 fail, 1 skip, against 44 fail on `d82e0db4`. Integration `661a7b55`: Codex PASS, 101/101 on changed test files; CI `ai-brain-tests` green on Linux. R3 is the only failing name outside the base list and it also fails on main in isolation.

## Requirements

| ID | Status | Evidence or blocker |
| --- | --- | --- |
| R01 | PARTIAL | Parallel worktrees used; writers chosen by the coordinator while the Controller lacked routes |
| R02 | PARTIAL | Rule broken twice, see Limits |
| R03 | BLOCKED | Original list of 65 not found; 140 PRs mention agy |
| R04 | PARTIAL | #531; audit shows most tools have no execution evidence |
| R05 | OFFLINE PASS | Merged #527 |
| R06 | PARTIAL | Scans are per route; 503 groups not classified |
| R07 | TODO | Not replayed on TASK-AI-169 in this run |
| R08 | PARTIAL | 70 rules inventoried, 37 numeric hardcodes, 35 unjustified; quality scale sourced |
| R09 | LIVE PASS, one case | Low confidence on two dimensions fell back to preset |
| R10 | LIVE PASS, small | See section 8 |
| R11 | OFFLINE PASS | Root causes recorded per commit |
| R12 | PARTIAL | Reviews per SHA; integration exceeds 400 lines and needs splitting or an operator exception |
| R13 to R16 | PARTIAL | Two review paths used; AgentRouter paused without a replacement, see Limits |
| A to E | OFFLINE PASS | Merged in #527 |
| F | LIVE PASS, one case | Section 5 |
| G | OFFLINE PASS | #531 |
| H | OFFLINE PASS | #530 |

## Limits

- Live proof covers two small test-only tickets, not product work.
- The coordinator stayed idle from 21:52 to 22:24 and paused reviewers while Codex was out of quota.
- A blocked `route.js` run overwrote `lastSuccessfulAt` in the scratch catalogue at 21:48. A real list-only discovery replaced it. `discovery.js:164` still records success when one source lists; changing it is a gate decision for the operator.
- Earlier refresh runs at about 17:50 and 18:10 made inference calls whose routes and cost cannot be traced.
- `ag/` routes have no credential in 9Router, 27 of 27.
- 503 results on `cl`, `bzl`, `nous` conflict with earlier successful free calls and are unclassified.
- `opencode-zen` AUTH results conflict with successful OpenCode CLI calls.
- `route.js` review still reports one finding: a crash inside the small recovery window leaves a gate file that blocks that worktree until removed by hand; it fails closed.
- `route.js` lives outside the repository, and its AA ordering can differ from the Controller's first rank by the operator decision of 2026-11-04.
- Backlog not started: old PRs, 19 stale register rows, OneDrive, worktree cleanup, hooks, ai-memory drain.
