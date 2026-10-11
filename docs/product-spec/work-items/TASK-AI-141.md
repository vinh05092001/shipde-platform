# TASK-AI-141 — The Controller uses every source

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-141` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `251` |
| Dependencies | `TASK-AI-131; TASK-AI-130` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Complexity | `standard` |
| Allowed paths | `tools/ai-brain/candidates.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/test/task-ai-141.test.js`; `docs/product-spec/work-items/TASK-AI-141.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-141-use-every-source` |
| Pull Request | `Pending` |

## Business Outcome

An intake run that enables `--external-workers agy-pool` offers its discovered backend models to the seven agy-pool accounts. Every resulting candidate is ranked or carries a named rejection reason.

### Part A root cause

`intake.runIntake` writes `catalogue.models` to `catalogue.json` as a JSON array of model-id strings (`tools/ai-brain/intake.js`, `runIntake`). `cli.js` `orchestrateCommand` reads that file and passes the array and `--external-workers` value to `generateCandidates`. The flag enables `poolAccountCandidates`, but its catalogue loop previously accepted only object entries with `upstream` or `source` metadata (`tools/ai-brain/candidates.js`, `poolAccountCandidates`). The actual intake strings such as `ag/<model-id>` were ignored, leaving the pool model set empty even though the lane was enabled. The fix recognizes supported model families in plain strings and strips the `ag/` or `antigravity/` alias before constructing candidates.

## Source References

- `TASK-AI-141-spec.md`, Part A.
- `TASK-AI-131`: intake-built catalogue and account inputs.
- `TASK-AI-130`: agy-pool account discovery and candidate rules.
- `AGENTS.md`: source-of-truth, evidence and review requirements.

## Preconditions and Dependencies

Intake persists catalogue model IDs as strings. Candidate generation receives those inputs together with the external-worker flag and discovers the available agy-pool accounts.

## Author Boundary

This Work Item is assigned to GEMINI. Codex independently reviews the resulting commit and does not approve or merge the author’s work.

## In Scope — Part A and supervisor-directed proof transfer

- Recognize supported backend model IDs and `ag/` or `antigravity/` aliases from intake’s string catalogue in agy-pool candidate generation.
- Reject aliased models outside the supported family policy and empty normalized IDs; report unknown family models with a named generation rejection.
- Add an intake-built-input regression using accounts read from an actual temporary account registry plus discovered pool run directories. Check that each generated model candidate is ranked or rejected with a named reason.
- Allow proof transfer only for an exact normalized backend model identity when both source evidence and the candidate's own path remain valid. Candidate path failures, active blocks and exhausted quota prevent transfer.
- Record the proven root cause and verification evidence in this Work Item.

The supervisor explicitly directed that proof transfer be handled in Part A. This supersedes the original scope note that placed transfer solely in Part B.

## Follow-up Within This Work Item — Parts B to E

These spec parts remain follow-up scope under TASK-AI-141 and are not implemented in this revision:

- **Part B:** bounded automatic qualification of candidates that lack proof, with caps and exact-SHA independent review.
- **Part C:** isolated Codex worker lane and worker login-state handling.
- **Part D:** intake risk-domain and complexity derivation plus the QUALITY_FIRST safety floor.
- **Part E and addenda:** live gateway model discovery/probing, same-model alternate-path fallback, temporary parking and due rechecks.

## Part C — Codex lane inside the isolated worker

The Codex harness runs `codex exec --dangerously-bypass-approvals-and-sandbox` only through the isolated launcher. Direct harness use and attempts outside a worker path fail with `CODEX_REQUIRES_ISOLATION`. The launcher probes `codex login status` under the worker account before execution; a missing login is returned as the local failure `CODEX_NOT_LOGGED_IN`, allowing orchestration to continue to another candidate. The worker uses its own HOME and USERPROFILE and no host `~/.codex` credential file is read or copied.

Verification: focused Part C tests cover the isolation requirement, flag placement, worker-scoped login probe, credential non-copying, and local login failure result. The operator login steps are in `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md`.

## Out of Scope for This Revision

- Automatic qualification, intake risk/complexity derivation, and live gateway discovery/fallback/rechecks (Parts B to E), except the supervisor-directed proof transfer above.
- Product Work Item execution as qualification, automatic merge, or reading/copying Codex credentials.
- Live account probing or changes to agy-pool quota policy.

## Business Rules and Edge Cases

- Only model IDs accepted by the existing agy-pool family policy are candidates.
- Normalize the supported upstream alias before candidate identity is built, while preserving account-scoped candidate identity.
- A candidate excluded by routing must retain a named reason; an absent candidate is not an acceptable outcome.

## UI States

No product screen changes. Candidate ranking or rejection remains visible in the controller’s existing decision output.

## API, Event and Data Impact

No API, persisted product data, or external side effects change. Candidate generation consumes intake’s existing `catalogue.json` and `accounts.json` artifacts.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| A1 | Intake-built string catalogue plus `--external-workers agy-pool` | The discovered backend model yields candidates for pool accounts; each is ranked or rejected with a named reason | `task-ai-141.test.js` |
| A2 | Aliased unknown or empty model | No candidate with an empty/unknown model is admitted; unknown family is reported by name | `task-ai-141.test.js` |
| A3 | Proof transfer across routes | Only exact normalized model identity and currently valid source/candidate evidence can transfer; blocked, failed or exhausted target path cannot inherit proof | `task-ai-141.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-141.test.js`
- `node --test tools/ai-brain/test/candidates.test.js`
- `node --test tools/ai-brain/test/task-ai-130.test.js tools/ai-brain/test/task-ai-131.test.js`
- `node --test tools/ai-brain/test/*.test.js` with `NINEROUTER_API_KEY` unset
- `./node_modules/.bin/prettier --check tools/ai-brain/candidates.js tools/ai-brain/routing.js tools/ai-brain/intake.js tools/ai-brain/test/task-ai-141.test.js docs/product-spec/work-items/TASK-AI-141.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before on an `origin/main` archive with the intake registry-options seam enabled for the isolated fixture: `node --test tools/ai-brain/test/task-ai-141.test.js` → 4 tests, 0 passed, 4 failed. The intake regression failed because no named unknown-family diagnostic existed; proof-transfer tests failed because target-path state was ignored and distinct full model IDs collapsed or the helper was unavailable.
- Pass-after: `task-ai-141.test.js`, `candidates.test.js`, `task-ai-130.test.js` and `task-ai-131.test.js` → 75/75 passed. The full brain suite with `NINEROUTER_API_KEY` unset → 1,722/1,722 passed. Prettier check and `git diff --check` passed.
- Regression against existing dispatch: `task-ai-68.test.js` passes, confirming unprefixed gateway catalogue IDs do not leak into pool candidate generation unless the agy-pool external lane is explicitly enabled.

## Codex Review Record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Pending |

## Residual Limitations

- Parts B and D to E and their acceptance criteria remain open follow-up work within TASK-AI-141, except proof transfer now included above by supervisor direction.
- This change consumes the models already discovered by intake; it does not add live per-account pool probing.

## Part B — bounded automatic qualification

- Added `tools/ai-brain/qualification-auto.js` and the `qualify --auto --candidates <json>` CLI surface. Automatic qualification admits only rejected candidates whose sole reason is `PROOF_FLOOR_NOT_MET`; currently blocked candidates and candidates with any additional rejection are excluded.
- Qualification work is selected only from `tools/ai-brain/data/qualification-items.json`, whose entries are explicitly `kind: qualification` and `risk: low`. The coordinator refuses malformed lists and refuses to grant evidence unless the isolated orchestration adapter returns an independent `PASS` whose `reviewedSha` exactly equals its 40-character commit SHA.
- Successful runs record `WORK_ITEM_PASS` on the candidate's evidence identity. Per-run and per-day limits are configurable through the coordinator (`perRun`, `perDay`, defaults 1 and 3); usage is tracked by UTC day in `.shipde/qualification-usage.json`. Qualification output is never published or merged by this path.
- `next --loop` offers an injected qualification slot only after the product register has no ready Work Item. The slot is bounded by the qualification coordinator and remains separate from product intake.
- Added fake-driven tests for qualification candidate selection, caps, exact-SHA independent review, and rejection of product work. The normal isolated orchestration/reviewer implementation must be supplied as `runIsolatedReviewed`; without it, `qualify --auto` fails closed with `QUALIFICATION_RUNNER_UNAVAILABLE`.

## Part D

Intake derives risk domains and complexity from the Work Item scope, acceptance criteria, and allowed paths, and records the derivation in each run directory. JEV receives the resulting risk domains and complexity; the Controller enforces a `QUALITY_FIRST` floor for auth, security, money, or tenant-isolation work and records the override reason. Regressions cover a 15-AC MFA-like item and a docs-only item.

### Part A follow-up: infrastructure failures do not revoke proof transfer

`tools/ai-brain/routing.js` now preserves a source path's `WORK_ITEM_PASS` when that path is blocked or has failed evidence due to infrastructure conditions such as quota exhaustion, rate limits, timeouts, or launch/harness failures. Transfer still requires exact normalized backend model identity and a viable target path; model-scope failures, quality outcomes such as `CHANGES_REQUIRED`, and revoked proof disqualify the source. Three regressions cover infrastructure enum classification while preserving model failures, model/quality failures disqualifying transfer, and exhausted target paths not inheriting proof (`classifier enum values recognize infrastructure and preserve model failures`, `a model-quality failure on the source path disqualifies the proof transfer`, `an exhausted target path never inherits the transferred proof`).
