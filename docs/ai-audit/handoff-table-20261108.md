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
| 4 Score and policy | PARTIAL | AA policy live on main: #539 restored #526 (dropped by #537), #544 deprecated AA records, #545 origin names, #542 scale label; dispatch measured by the coordinator on `64fc87cf` after merge: 103 of 236 models (the #545 branch measured 102 of 235 before merge, against an earlier catalogue) on `policy:AA-II-5.0.1-percentile-v1:0-1` | 133 models absent from AA or of unknown origin; latency, cost, reliability unmeasured |
| 5 JEV call path | LIVE PASS, one case | #535 `9efeb40f` Codex PASS; live `DECIDED`, 560 ms, 2095 in, 101 out | Model choice question not exercised live |
| 6 Fallback and mock | OFFLINE PASS | OpenCode 1.18.31: `max_tokens` honoured; 402 no resend; 429 9 requests over 77 s; restart and limit | `route.js` is outside the repo |
| 7 Offline full flow | OFFLINE PASS | Replay hash equal twice, `d3fd47e6e5888bcf` at `f50cac91`; #530 `b4e3c390` Codex PASS | Replay not repeated after P5 |
| 8 Live calls | LIVE PASS | Two test tickets (`414b623c`, `9bdccdfb`); product ticket FEAT-CAR-01 Slice B #543: writers chosen by the Controller through route.js (grok-4.7, deepseek-v4.1-flash), review fixes by Codex, Codex PASS at `74a4bdf6` after six rounds (local), merged `ce434dca` | Live-API journey spec gated by `SHIPDE_LIVE_CATALOG=1`, not yet run |
| 9 Repo and tools | PARTIAL | #531 audit; #540 register (17 rows to MERGED after five exhaustive rounds); #541 49 open PRs classified (12 stale-conflict, 25 active, 12 unknown) | 0/65 AGY list found; OneDrive, worktree cleanup, hooks, ai-memory not started |
| 10 Review and handoff | THIS FILE | #537 to #545 merged (git); Codex PASS and CI green checked before each merge (local, GitHub checks) | None |

Scans (isolated files, health and evidence stores untouched): Controller full scan 126 alive of 2111 routes on 17 sources; 9Router 150 of 1232 returned 200; free models through OpenCode 62 of 148.

Full suite on `037df02a`, serial: 3428 tests, 3384 pass, 43 fail, 1 skip, against 44 fail on `d82e0db4`. Integration `661a7b55`: Codex PASS, 101/101 on changed test files; CI `ai-brain-tests` green on Linux. R3 is the only failing name outside the base list and it also fails on main in isolation.

Evidence levels in this table: **git** = verifiable from commits; **GitHub** = public PR, check run or run ID; **local** = coordinator runs and Codex review transcripts kept on the operator machine, not committed (no raw logs or prompts are published). Codex PASS and CI green before each merge were checked locally; each merge used the exact head (`--match-head-commit`).

## Requirements

| ID | Status | Evidence or blocker |
| --- | --- | --- |
| R01 | PARTIAL | Parallel worktrees used; writers chosen by the coordinator while the Controller lacked routes |
| R02 | PARTIAL | Rule broken twice, see Limits |
| R03 | BLOCKED | Original list of 65 not found in the repo; local count: 114 PR bodies name AGY as author, no batch of 65; operator must point to the source |
| R04 | PARTIAL | #531; audit shows most tools have no execution evidence |
| R05 | OFFLINE PASS | Merged #527 |
| R06 | PARTIAL | Controller quota-scan already reads the inner status of a 9Router 503 (`quota-scan.js:248`); scratch scan classified (#538); no backoff rescan |
| R07 | OFFLINE PASS (local) | Real TASK-AI-169 failed-check logs (GitHub runs, public): contract run 42048167186 gives a PR-body-only task without RunLedger text; ai-brain-tests run 42033756309 names the check and first error |
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
- 503 from 9Router wraps the upstream status; classified from the inner code over 895 results in the 9Router scan: 386 rate limit (429), 182+11+19 no credit, 88+3+4 model gone, 57+2+1 auth, the rest other (87 of them `codebuddy-intl` 403 `request illegal`). `cl`: 341 rate limit, 96 no credit, 2 auth, 1 model gone, 1 server error; `bzl`: 30 rate limit, 3 no credit; `nous`: 82 model gone. The conflict with earlier free calls is a burst rate limit during the scan, not a dead route; the scan did not retry after backoff.
- `opencode-zen` AUTH results conflict with successful OpenCode CLI calls.
- `route.js` review still reports one finding: a crash inside the small recovery window leaves a gate file that blocks that worktree until removed by hand; it fails closed.
- `route.js` lives outside the repository, and its AA ordering can differ from the Controller's first rank by the operator decision of 2026-11-04.
- Backlog done: stale register rows (#540), open PR classification (#541). Not started: OneDrive, worktree cleanup, hooks, ai-memory drain.

- (local) JEV from route.js failed with `spawnSync node ENOENT` (deleted worktree path) and was recorded as UNRATED; fixed in route.js, live `DECIDED` hard 0.96.
- (local) route.js ranked unknown-quality routes above known ones and mixed scales; fixed to Controller order and AA percentile. route.js stays outside the repo.
- (local) Idle gap 08:10 to 12:52: a CI watcher looped forever on a red check (`gh pr checks` exits non-zero); watchers now capped.