# TASK-AI-58 — AI Controller MVP - automatic source selection, scoped fallback and checkpoint resume

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-58` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `183` |
| Dependencies | `` |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/candidates.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/decisions.js`, `tools/ai-brain/discovery/identity.js`, `tools/ai-brain/discovery/read.js`, `tools/ai-brain/discovery/store.js`, `tools/ai-brain/evidence.js`, `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/fitness.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/quota-store.js`, `tools/ai-brain/quota.js`, `tools/ai-brain/ranking.js`, `tools/ai-brain/scheduler.js`, `tools/ai-brain/sources.json`, `tools/ai-brain/test/candidates.test.js`, `tools/ai-brain/test/classifier-outcome.test.js`, `tools/ai-brain/test/dispatch-wiring.test.js`, `tools/ai-brain/test/failure-classifier.test.js`, `tools/ai-brain/test/mvp-contract-18.test.js`, `tools/ai-brain/test/mvp-controller-fallback.test.js`, `tools/ai-brain/test/mvp-controller.test.js`, `tools/ai-brain/test/mvp-repair.test.js`, `tools/ai-brain/test/scheduler.test.js` (scope correction requested by the operator) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/brain-mvp-controller` |
| Pull Request | `#149` |

## Business outcome

The AI controller automatically selects the source from discovery without a pinned model, falls back to a different failure domain on failure, and resumes from checkpoint without retrying cooled-down candidates. This ensures robust and autonomous AI task execution.

## Source references

`C:/Users/gumac/AI/shipde-platform/.worktrees/logs/mvp/CONTROLLER-MVP-CONTRACT.md` (sections 6.1-6.7 and the 18 tests)

## Preconditions and dependencies

None

## Author boundary

`GEMINI` is appropriate as this involves foundational architecture decisions, state machines, and scoped execution handling which falls under complex foundational behavior rather than deterministic tasks.

## In scope

- Identity, discovery/evidence, and selection logic.
- Failure scope detection and fallback handling.
- Decision logging and checkpoint/resume behavior.
- Resource constraints (writer claim, ceiling, stalled session detection).
- Implementation of the 18 contract tests mapped to `tools/ai-brain/test/mvp-contract-18.test.js`, `mvp-controller.test.js`, `mvp-controller-fallback.test.js`, `mvp-repair.test.js`.

## Out of scope

Live E2E with a real agent is NOT covered (the P0 worker guard is PARTIAL isolation, branch feat/e2e-sandbox-remote-isolation, not merged).

## Business rules and edge cases

See CONTROLLER-MVP-CONTRACT.md section 6.1 to 6.7. Includes negative behaviors such as untested elements not being chosen without exploration budget, out of quota errors not locking alternative accounts, and upstream errors not locking other upstreams.

## UI states

N/A

## API, event and data impact

N/A

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| 1 | new source by data | candidate appears | test pass |
| 2 | two accounts same upstream | two independent keys | test pass |
| 3 | model only on path A | path B cannot borrow | test pass |
| 4 | UNTESTED | not chosen without exploration budget | test pass |
| 5 | unknown cost/capability | gets no neutral score | test pass |
| 6 | account A out of quota | does not lock account B | test pass |
| 7 | upstream A 402 | does not lock upstream B | test pass |
| 8 | HTTP 000 | does not fail the model | test pass |
| 9 | firstChoice !== selected | on fallback | test pass |
| 10 | first reason | explains fallback | test pass |
| 11 | resume | skips cooldown/deferred | test pass |
| 12 | resume | does not duplicate work | test pass |
| 13 | decision log | has no credentials | test pass |
| 14 | new source | needs no controller change | test pass |
| 15 | Work Item without model/account | still gets a combination | test pass |
| 16 | resource ceiling | limits writers | test pass |
| 17 | failed writer | releases its writer claim | test pass |
| 18 | reserved candidate | not selected concurrently beyond ceiling | test pass |

## Verification commands

- `pnpm test`
- `pnpm lint`
- `pnpm format:check`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `` | `` | `` |

## Residual limitations

Live E2E with a real agent is NOT covered (the P0 worker guard is PARTIAL isolation, branch feat/e2e-sandbox-remote-isolation, not merged).
