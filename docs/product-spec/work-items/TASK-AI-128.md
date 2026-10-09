# TASK-AI-128: a resumed run adopts its own repair commit instead of refusing it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-128` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `241` |
| Dependencies | `TASK-AI-127` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/test/task-ai-128.test.js`; `docs/product-spec/work-items/TASK-AI-128.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-128-resume-repair-head` |
| Pull Request | `Pending` |

## Business Outcome

Root cause: the author committed code in the retained worker root. The format gate failed. The repair round committed on top of it. The run ended BLOCKED. The next run (resume) refused with "WORKER_HEAD_MISMATCH" because the retained worker root HEAD did not match the requested SHA.

RH-R01: when the retained worker root HEAD is a strict descendant of the requested SHA, and every extra commit was made in that root by this work item's own repair rounds, the launcher adopts that HEAD instead of refusing.

RH-R02: any other mismatch is still refused: a non-descendant HEAD, a dirty tree, or extra commits that cannot be attributed to this item's repair. The refusal must be classified as a LOCAL infra failure.

RH-R03: the repair round itself records its resulting commit SHA in the checkpoint as soon as it commits.

RH-R04: a missing retained root is reported as WORKER_ROOT_MISSING.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| RH-R01 | Descendant repair HEAD | Launcher adopts HEAD instead of refusing | Test |
| RH-R02 | Non-descendant/dirty HEAD | Refused as local with no cooldown | Test |
| RH-R03 | Repair commit recording | Repair SHA recorded in checkpoint | Test |
| RH-R04 | Missing worker root | Reported as WORKER_ROOT_MISSING | Test |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-128.test.js`

## Fail-Before / Pass-After

- Fail-before (tests on `origin/main`): every test fails.
- Pass-after: tests pass. `prettier --write` and `git diff --check` are clean.

## Residual Limitations

- Multi-commit repair rounds fall back to refusal because only the final commit is tracked by the orchestrator loop, so intermediate commits fail the strict attribution check (`extraCommits.every(...)`). This contradicts RH-R01's "every extra commit ... by this item's own repair rounds", but is accepted as a fail-closed limitation.
