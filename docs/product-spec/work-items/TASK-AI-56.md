# TASK-AI-56 — Run AI Brain test suite in CI on every Pull Request

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-56` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `181` |
| Dependencies | `TASK-FOUND-04; TASK-AI-49` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `.github/workflows/ai-brain-tests.yml`; `package.json`; `docs/product-spec/work-items/TASK-AI-56.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-56-ci-brain-suite` |
| Pull Request | `#147` |

## Business outcome

Every Pull Request and every push to `main` runs the AI Brain regression suite before merge readiness, so dispatch, source selection, quota, scheduler and decision-log behavior cannot regress silently while other Ship De work is in flight.

## Source references

- `AGENTS.md` — Foundation verification commands include `pnpm test:brain` and require CI evidence for every Pull Request.
- `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` — CI gates are the merge-readiness evidence layer.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — GitHub Pull Requests and CI are the durable handoff channel.
- `docs/product-spec/work-items/TASK-AI-49.md` — the Paseo dispatch adapter and AI Brain behavior are proven by `node --test "tools/ai-brain/test/*.test.js"`.
- `package.json` — `test:brain` maps to `node --test "tools/ai-brain/test/*.test.js"`.

## Preconditions and dependencies

- `TASK-FOUND-04` established the repository quality-gate pattern and GitHub Actions contract.
- `TASK-AI-49` established the AI Brain tests as the acceptance evidence for dispatch behavior.
- Node 24 and pnpm 11 are declared by the repository root and are available through GitHub Actions setup steps.

## Author boundary

`GEMINI` authors this low-risk CI wiring because the behavior is deterministic and limited to the GitHub Actions workflow, root test script evidence, Work Item file and delivery register. No product UX, database, tenant data, carrier side effect, secret material, runtime credential, or production deployment behavior may be changed by this Work Item.

## In scope

- Add a GitHub Actions workflow for the AI Brain suite.
- Trigger the workflow for `pull_request` events and pushes to `main`.
- Use the repository package manager and Node version expected by the current root tooling.
- Run `pnpm test:brain`, which executes `node --test "tools/ai-brain/test/*.test.js"`.
- Keep CI fail-closed when any AI Brain test fails.
- Record the Work Item and register state for review.

## Out of scope

- Changing AI Brain runtime behavior, scheduler logic, source scoring, quota policy, dispatch adapters, or decision-log semantics.
- Adding, removing, or rewriting AI Brain tests.
- Changing unrelated CI jobs, Prisma generation, application build behavior, deployment settings, or merge policy.
- Pushing the branch or merging PR `#147`.

## Business rules and edge cases

1. The workflow must run on every Pull Request update that can change merge readiness: opened, edited, synchronize, reopened and ready-for-review.
2. The workflow must run on push to `main` so the integration baseline keeps the same AI Brain regression signal after merge.
3. The workflow must fail when `pnpm test:brain` fails; no continue-on-error or advisory-only reporting is allowed.
4. The workflow must pass on `main` when the checked-in AI Brain tests pass.
5. The CI job must not require secrets or local-only credentials.

## UI states

No user-facing screen is changed. Loading, empty, validation, error, forbidden, partial, success and recovery UI states are not affected by this CI-only Work Item.

## API, event and data impact

No API, database, migration, event, queue, carrier adapter, tenant data or persistent application data changes. The only new event surface is GitHub Actions execution for Pull Requests and pushes to `main`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-56-01` | A Pull Request is opened or updated | GitHub Actions starts the AI Brain test suite | `.github/workflows/ai-brain-tests.yml` contains `pull_request` with opened, edited, synchronize, reopened and ready-for-review events |
| `AC-AI-56-02` | A commit is pushed to `main` | GitHub Actions starts the AI Brain test suite | `.github/workflows/ai-brain-tests.yml` contains `push` with `branches: [main]` |
| `AC-AI-56-03` | Any AI Brain test fails | The job fails closed | Workflow runs `pnpm test:brain` without continue-on-error |
| `AC-AI-56-04` | AI Brain tests pass on the integration baseline | The job passes on ubuntu | PR `#147` CI evidence: `ai-brain-tests` passed on ubuntu |

## Verification commands

- `pnpm test:brain`
- `cd docs/product-spec && python3 scripts/validate_docs.py`
- `python3 docs/product-spec/scripts/validate_pr_contract.py --event .worktrees/logs/pr-147-event.json`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `30d02ca` | `PASS` | Codex CLI `gpt-5.5` reviewed PR `#147`; no unresolved findings reported for this Work Item |

## Residual limitations

- The `current-application` job is known to fail at `prisma generate` on other open Pull Requests as well, including PR `#143`; that failure is pre-existing and outside this CI Brain suite Work Item.
