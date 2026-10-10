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
| Allowed paths | `tools/ai-brain/candidates.js`; `tools/ai-brain/test/task-ai-141.test.js`; `docs/product-spec/work-items/TASK-AI-141.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
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

## In Scope — Part A Only

- Recognize supported backend model IDs and `ag/` or `antigravity/` aliases from intake’s string catalogue in agy-pool candidate generation.
- Add an intake-built-input regression that exercises the `agy-pool` external-worker lane and checks that each discovered model candidate is ranked or rejected with a named reason.
- Record the proven root cause and verification evidence in this Work Item.

## Follow-up Within This Work Item — Parts B to E

These spec parts remain follow-up scope under TASK-AI-141 and are not implemented in this revision:

- **Part B:** bounded automatic qualification of candidates that lack proof, with caps and exact-SHA independent review.
- **Part C:** isolated Codex worker lane and worker login-state handling.
- **Part D:** intake risk-domain and complexity derivation plus the QUALITY_FIRST safety floor.
- **Part E and addenda:** live gateway model discovery/probing, same-model alternate-path fallback, temporary parking and due rechecks.

## Out of Scope for This Revision

- Parts B, C, D and E implementation or tests.
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

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-141.test.js`
- `node --test tools/ai-brain/test/candidates.test.js`
- `node --test tools/ai-brain/test/task-ai-130.test.js tools/ai-brain/test/task-ai-131.test.js`
- `node --test tools/ai-brain/test/*.test.js` with `NINEROUTER_API_KEY` unset
- `./node_modules/.bin/prettier --check tools/ai-brain/candidates.js tools/ai-brain/test/task-ai-141.test.js docs/product-spec/work-items/TASK-AI-141.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: with the plain intake catalogue ID `gemini-fixture-pro`, fake pool discovery returning no models, and `--external-workers agy-pool`, the regression produced 0 pool candidates instead of 7. This confirms the intake string representation was not reaching candidate construction.
- Pass-after: the same intake-built inputs produce one candidate for each of agy01–agy07. The profile ranker evaluates all seven and returns the named `PROOF_FLOOR_NOT_MET:NONE` rejection for each, without launching a worker.
- Regression against existing dispatch: `task-ai-68.test.js` passes, confirming unprefixed gateway catalogue IDs do not leak into pool candidate generation unless the agy-pool external lane is explicitly enabled.

## Codex Review Record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Pending |

## Residual Limitations

- Parts B to E and their acceptance criteria remain open follow-up work within TASK-AI-141.
- This change consumes the models already discovered by intake; it does not add live per-account pool probing.
