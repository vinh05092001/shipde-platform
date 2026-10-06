# TASK-AI-114 — Orchestrate reviews dependencies before dependents and hands off their commit

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-114` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `226` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-114.test.js`; `docs/product-spec/work-items/TASK-AI-114.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-114-orchestrate-dependency-review` |
| Pull Request | `Pending` |

## Business Outcome

The gate 5 live run (evidence: `tools/ai-brain/orchestrate.js` on main `56a42e8`)
showed three orchestration defects. A reviewer launch failure (for example an
HTTP 429 quota error) was returned as `{verdict:'CHANGES_REQUIRED',
launchFailed:true}`, pushed into `recordedReviewRounds` and checkpointed as
`review_round_completed`, so after a resume the item read as reviewed and the
fake verdict even triggered a repair. A launch failure is not a verdict. A work
item with plan `dependencies` was launched from the global `--base-sha` instead
of the dependency's last reviewed worker SHA, so the dependent could not require
the dependency's files. And a dependent was launched while its dependency had no
PASS.

Now only a real parsed verdict (`PASS` / `CHANGES_REQUIRED`) creates a review
round: a reviewer launch failure stays a classified failed reviewer attempt with
the existing failure classification and reviewer re-selection, never a
`CHANGES_REQUIRED` verdict and never a repair, and an old checkpoint round whose
result carries `launchFailed === true` is discarded and reviewed again. When
the failed launches exhaust a reviewer failure domain (its attempt cap is
reached) and no alternate domain remains, the item keeps the existing `BLOCKED`
`NO_ALTERNATE_FAILURE_DOMAIN`; `REVIEWER_UNAVAILABLE` is only for the other
exhaustion, where every reviewer candidate failed to launch without exhausting
any reviewer failure domain. Dependencies are worked and reviewed before their
dependents, a dependent launches from its dependency's PASS commit (recorded in
the checkpoint and the decision log as `baseSha` with `baseFrom: <dependency
id>`), and a dependent whose dependency has no PASS is `BLOCKED` with
`DEPENDENCY_NOT_PASSED` without ever being launched. Multiple dependencies fail
closed with `MULTI_DEPENDENCY_BASE_UNSUPPORTED`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| R01 | Reviewer launch fails (HTTP 429 quota) | Recorded as a failed reviewer attempt with the existing failure classification and reviewer re-selection; never a review round, never a `CHANGES_REQUIRED` verdict, no repair; all candidates exhausted → `BLOCKED` `REVIEWER_UNAVAILABLE`, while launch failures that exhaust a reviewer failure domain with no alternate domain keep `BLOCKED` `NO_ALTERNATE_FAILURE_DOMAIN` | R01 tests in `tools/ai-brain/test/task-ai-114.test.js` |
| R02 | Resume of a checkpoint whose review round has `result.launchFailed === true` | That round is discarded and the commit is reviewed again | R02 test in `tools/ai-brain/test/task-ai-114.test.js` |
| R03 | Work item with one dependency | Launch `baseSha` is the dependency PASS SHA; checkpoint and decision log record `baseSha` with `baseFrom: <dependency id>`; multiple dependencies → `MULTI_DEPENDENCY_BASE_UNSUPPORTED`, no launch | R03 tests in `tools/ai-brain/test/task-ai-114.test.js` |
| R04 | Dependent while the dependency has no PASS | No dependent launch before the dependency is PASS; dependency `BLOCKED` → dependent `BLOCKED` `DEPENDENCY_NOT_PASSED`; dependencies are reviewed before dependents even when the plan lists the dependent first | R04 tests in `tools/ai-brain/test/task-ai-114.test.js` |
| R05 | Test style and regressions | `node:test` with injected/fake launchers and reviewers, no network, no real opencode; existing tests unchanged and green | `node --test tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-60.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-102.test.js` |
| R06 | Handoff documents | Work Item document plus one register row numbered `226`, status `READY_FOR_CODEX`, branch `fix/task-ai-114-orchestrate-dependency-review` | this document and `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-60.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-102.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-114.test.js docs/product-spec/work-items/TASK-AI-114.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (main `56a42e8` + new tests): all seven new tests fail — the
  launch failure is checkpointed as a `CHANGES_REQUIRED` review round and
  reappears after a resume, the dependent launches from the global `--base-sha`,
  the dependent launches before its dependency passes, and multi-dependents
  launch at all.
- Pass-after: all seven new tests pass; TASK-AI-60, TASK-AI-102, TASK-AI-105 and
  TASK-AI-113 stay green (41 tests, 0 failures).

## Residual Limitations

- Multiple dependencies are refused (`MULTI_DEPENDENCY_BASE_UNSUPPORTED`)
  instead of merged: one launch base cannot be several commits at once, and the
  refused rule would be "all dependencies share one PASS SHA lineage". Work that
  needs two dependencies must be split or sequenced.
- The handoff commit is the dependency's reviewed PASS SHA resolvable from this
  run's review records or a valid checkpoint receipt. A dependency whose
  checkpoint receipt cannot be validated blocks its dependent fail-closed with
  `DEPENDENCY_NOT_PASSED`.
- A launched reviewer that produces no usable verdict file
  (`VERDICT_FILE_MISSING`, `VERDICT_FILE_MALFORMED`, `VERDICT_INVALID`,
  `STALE_REVIEW_SHA`) is still a real review attempt recorded as
  `CHANGES_REQUIRED`; only a launch failure is treated as "no verdict".
- Reviewer re-selection after a launch failure stays inside the run's candidate
  pool and failure-domain rules; two failed 9Router-class attempts still
  escalate rather than retry forever.
