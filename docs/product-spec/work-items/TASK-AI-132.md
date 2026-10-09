# TASK-AI-132 — The Controller picks the next dependency-ready Work Item and runs it through intake, with no supervisor dispatch

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-132` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `246` |
| Dependencies | `TASK-AI-131` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/cli.js`; `tools/ai-brain/next-runner.js`; `tools/ai-brain/decisions.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/scheduler.js`; `tools/ai-brain/test/task-ai-132.test.js`; `docs/product-spec/work-items/TASK-AI-132.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-132-next-loop` |
| Pull Request | `Pending` |

## Business Outcome

The operator wants the core to coordinate by itself, with Claude only supervising. Previously the supervisor had to pick every next item by hand. While intake (TASK-AI-131) turned a single Work Item ID into a full unattended run, nothing chose the next item automatically.

TASK-AI-132 provides `node tools/ai-brain/cli.js next [--run] [--loop]`:
- NX-R01: reads the register in order and returns the first Work Item where status is READY_FOR_AUTHOR (or BACKLOG with every dependency MERGED), every dependency is MERGED, and no open run or writer claim already holds it. It prints the reason each skipped item was skipped (dependency not merged, BLOCKED with reason, claimed).
- NX-R02: `--run` calls `intake --run` for that item, enforcing the concurrency ceiling read from existing ceiling data (DEFAULTS with governed decision clamp for writers, DEFAULTS for reviewers), never hard-coded twice.
- NX-R03: `--loop` repeats after each item reaches a terminal state (published, merged, blocked or refused). It stops cleanly when no item is ready (`NO_READY_ITEM`), when every candidate lane is unavailable (`ALL_LANES_UNAVAILABLE`, waiting until the earliest reset time), or when a stop file exists. Every iteration writes a decision record with no busy loop.
- NX-R04: preserves Work Item product meaning, never edits the register except through the existing status-transition code path, and never picks items marked BLOCKED.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| NX-R01 | Dependency gating & skipped reasons | Unmerged dependencies, BLOCKED items, and claimed items are skipped with clear reasons; first ready item returned | Test |
| NX-R02 | Concurrency ceiling enforcement | `--run` checks active writers (governed ceiling clamp, default 1) and reviewers (default 2) from decision data and refrains from launching when at ceiling | Test |
| NX-R03 | Loop mode & clean termination | `--loop` stops cleanly on `NO_READY_ITEM`, `ALL_LANES_UNAVAILABLE` (waiting until reset time), or stop file | Test |
| NX-R04 | Invariant preservation | Never changes product meaning, never picks BLOCKED items, uses existing status transitions | Test |
| NX-R05 | Full test coverage | All 7 scenarios covered with fixture register under `.upstream-tmp` and fake intake | Test |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-132.test.js`

## Fail-Before / Pass-After

- Fail-before: On `origin/main`, `cli.js next` command and `next-runner.js` do not exist (`Lệnh không rõ: next`), so `tools/ai-brain/test/task-ai-132.test.js` fails completely.
- Pass-after: `node --test tools/ai-brain/test/task-ai-132.test.js` passes 15/15 tests with `NINEROUTER_API_KEY` removed. Modified modules (`decisions.js`, `scheduler.js`, `cli.js`, `intake.js`) pass all regression tests. `prettier --check` and `git diff --check` are clean.

## Residual Limitations

None.
