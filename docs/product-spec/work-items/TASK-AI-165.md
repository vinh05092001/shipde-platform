# TASK-AI-165 — Affected-only PR CI with caching and merge-queue triggers

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-165` |
| Feature ID | `N/A — CI performance optimization and merge queue automation` |
| Status | `IN_PROGRESS` |
| Delivery order | `273` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `.github/workflows/current-application.yml`; `.github/workflows/feature-contract-gate.yml`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-165.md`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-165-ci-affected-merge-queue` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Enable high-throughput multi-agent development by cutting CI cycle times and unlocking automated queue-based merges for concurrent Pull Requests. PR CI runs `turbo run lint typecheck test build --affected` against the PR base commit (`TURBO_SCM_BASE`) with Turborepo filesystem and pnpm store caching, while preserving full non-affected runs on push to `main` and on `merge_group`. Merge queue triggers are wired to all workflows that provide required status checks (`contract` and `application-gate`), preventing serial rebase churn and head-of-line blocking across concurrent writer agents without weakening safety invariants.

## Source references

- `AGENTS.md` (Verification commands, Definition of Done, Role separation)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- Operator explicit approval on 2026-11-02 for `.github/` modifications under TASK-AI-165

## Preconditions and dependencies

- Operator explicit approval granted on 2026-11-02 to modify `.github/` workflows for this task.
- Clean worktree on branch `feat/task-ai-165-ci-affected-merge-queue` synchronized with `origin/main`.
- Turborepo 2.x and pnpm 11 workspace available in repository root.

## Ambiguity and clarification markers

None. All requirements, trigger behaviors, and scoping rules are fully specified and approved.

## Author boundary

Appropriate for GEMINI primary author. Modifies GitHub Actions workflows under explicit operator authorization. Security scanning, allowlists, baselines, semgrep rules, and `pr-agent.yml` remain untouched.

## Slice sizing rule

Bounded single vertical delivery of CI configuration, workflow triggers, architecture documentation, delivery register update, and PR body, within ~400 lines target.

## In scope

- `.github/workflows/current-application.yml`:
  - `actions/checkout` with `fetch-depth: 0`
  - pnpm store caching (`pnpm/action-setup` before `actions/setup-node` with `cache: pnpm`)
  - Turborepo caching (`actions/cache@v4` on `.turbo` keyed by `${{ runner.os }}-turbo-${{ github.sha }}`)
  - On `pull_request`: run `turbo run lint typecheck test build --affected` with `TURBO_SCM_BASE = ${{ github.event.pull_request.base.sha }}` and `pnpm exec eslint scripts`
  - On `push` to `main` and on `merge_group`: keep full non-affected runs (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`)
  - Added triggers: `push: branches: [main]` and `merge_group`
  - Preserved required status check job name `application-gate` and all verification proofs
- `.github/workflows/feature-contract-gate.yml`:
  - Added trigger: `merge_group`
  - Preserved required status check job name `contract`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`:
  - Documented what changed, expected effects, and operator instructions for branch protection merge queue configuration
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`:
  - Exactly one delivery register row for `TASK-AI-165` with status `IN_PROGRESS`
- `.oc/pr-body.md`:
  - PR handoff documentation following `.oc/pr-body-template.md`

## Out of scope

- Modifying `pr-agent.yml` or removing existing required checks.
- Altering security baseline scanning, Gitleaks rules, Trivy, Semgrep, allowlists or baseline fixtures.
- Enabling the merge queue in GitHub branch protection (manual operator action after PR merge).

## Business rules and edge cases

- `BR-CI-01`: PR workflows must never weaken or remove existing required status checks (`application-gate` and `contract`).
- `BR-CI-02`: On `pull_request`, CI runs only affected packages against the PR base commit SHA, while `push` to `main` and `merge_group` evaluate the entire codebase.
- `BR-CI-03`: Cache hits on `.turbo` must not compromise deterministic execution of database migrations, Prisma client generation, or security scans.
- `BR-CI-04`: Any non-PR event (e.g., merge group or mainline push) defaults application scope detection to `application=true` to guarantee full test execution.

## Constitution check

- [x] **Tenant scope**: N/A — CI and toolchain workflow files only.
- [x] **RBAC & permissions**: N/A — CI workflows maintain `contents: read` least privilege.
- [x] **Audit & sensitive data**: No secrets or PII introduced; secret scanning preserved intact.
- [x] **VND integer arithmetic**: N/A — CI workflows.
- [x] **Carrier reconciliation**: N/A — CI workflows.
- [x] **Tests at the lowest useful level, test-first where executable**: Acceptance rows verified via local CLI execution, syntax parsing, and documentation inspection.

## UI states

N/A — CI and toolchain infrastructure task; no user interface is modified.

## API, event and data impact

- Event triggers: Added `merge_group` and `push` to main.
- Contract drift: Zero API schema or contract changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-165-01 | Workflow triggers inspection | `current-application.yml` and `feature-contract-gate.yml` contain `merge_group` trigger | docs-inspection |
| AC-AI-165-02 | Turborepo affected run on PR | `current-application.yml` runs `turbo run lint typecheck test build --affected` with `TURBO_SCM_BASE = PR base sha` on pull_request | docs-inspection |
| AC-AI-165-03 | Full runs preserved on push/merge_group | `current-application.yml` executes full lint, typecheck, test, and build on push to main and merge_group | docs-inspection |
| AC-AI-165-04 | Caching configuration | Caches pnpm store and `.turbo` cache directory via `actions/cache@v4` | docs-inspection |
| AC-AI-165-05 | Required check names unchanged | Status check job names `contract` and `application-gate` remain identical | docs-inspection |
| AC-AI-165-06 | Toolchain documentation | `AI-TOOLCHAIN-DECISIONS.md` documents changes, expected effects, and operator merge queue setup instructions | docs-inspection |
| AC-AI-165-07 | Delivery register integrity | Exactly one row added for `TASK-AI-165` with status `IN_PROGRESS` | docs-inspection |
| AC-AI-165-08 | No hardcode verification | `node scripts/ai/check-no-hardcode.mjs` exits with code 0 | automated test |

## Task breakdown

- [x] `T01` [P] Inspect existing workflows and identify required checks and trigger configurations.
- [x] `T02` Update `.github/workflows/current-application.yml` with caching, affected-only PR commands, full mainline commands, and `merge_group` / `push` triggers.
- [x] `T03` [P] Update `.github/workflows/feature-contract-gate.yml` with `merge_group` trigger.
- [x] `T04` Document changes and branch protection setup in `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.
- [x] `T05` Create Work Item specification `docs/product-spec/work-items/TASK-AI-165.md` and add delivery register row.
- [x] `T06` Prepare `.oc/pr-body.md` with complete evidence.
- [x] `T07` Run repository verification suite (`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, affected tests, `git diff --check origin/main...HEAD`).

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm exec turbo run lint typecheck test build --affected
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5cd2b56` | CHANGES_REQUIRED | Initial PR CI failure (eslint: command not found) |
| 3 | `48435c5` | CHANGES_REQUIRED | CI failing: worker build missing @shipde/config |
| 31 | `3a61b28` | CHANGES_REQUIRED | Unverified CI execution and formerly failing build path |
| 32 | pending | READY_FOR_CODEX | Resolved Finding 9: added `.oc/*` to scope detection ignored paths, restored `pnpm build` before integration tests with Turborepo caching |

## Residual limitations

None. Operator must manually enable "Require merge queue" in GitHub branch protection settings after PR merge.
