# TASK-E2E-TEST2 — End-to-end verification of autonomous AI dispatch supervision and commit production (Round 2)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-E2E-TEST2` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `999` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-E2E-TEST2.md`, `tests/e2e/e2e-test2-note.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-e2e-test2` |
| Pull Request | To be created |

## Business outcome

Provide live end-to-end validation of the AI brain dispatch supervisor and harness execution (Round 2). When a Work Item is dispatched to an autonomous worker, the supervisor monitors the session through its execution lifecycle, verifies the creation of the required commit and artifacts on the target branch, and validates that the candidate's execution succeeds without unobserved state mutations.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `AGENTS.md` § Unit of delivery
- `AGENTS.md` § Definition of a complete feature

## Preconditions and dependencies

- Monorepo foundation established (`TASK-FOUND-01` through `TASK-FOUND-04`).
- AI harness and dispatch tooling operational.
- Target branch `feat/task-e2e-test2` available for recording deliverables.

## Author boundary

`GEMINI` author assignment. Low-risk, bounded specification and acceptance proof demonstrating end-to-end worker execution, contract alignment, and clean verification.

## In scope

- Creation of `docs/product-spec/work-items/TASK-E2E-TEST2.md` defining the test work item contract.
- Creation of `tests/e2e/e2e-test2-note.md` verifying file artifact creation by the dispatched worker.
- Running authoritative quality and verification commands.
- Opening/updating Pull Request for `TASK-E2E-TEST2` on branch `feat/task-e2e-test2`.

## Out of scope

- Production schema or database migrations.
- Modification of carrier adapter logic.
- Production financial or accounting changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-E2E-01` | Worker dispatched by AI controller for `TASK-E2E-TEST2` | Dispatched worker initializes, reads specifications, implements in-scope files within allowed paths, and creates commit on target branch | Commit SHA on `feat/task-e2e-test2`, `git log` |
| `AC-E2E-02` | Quality gates execution | Formatting, contract checks, and linting pass with zero errors | Test run logs |
| `AC-E2E-03` | Pull request opened for work item | PR is created/updated with title `[TASK-E2E-TEST2] End-to-end verification of autonomous AI dispatch supervision and commit production` and status not merged | GitHub PR URL |
