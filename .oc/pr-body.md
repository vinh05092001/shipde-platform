## Work Item

- Work Item ID: TASK-AI-165
- Feature ID: N/A — CI performance optimization and merge queue automation
- Work Item file: docs/product-spec/work-items/TASK-AI-165.md
- Assigned implementation author: GEMINI
- Business outcome: Accelerate CI feedback cycles and enable high-throughput concurrent agent PR delivery by running affected-only Turborepo tasks on pull_request with pnpm and .turbo caching, retaining full verification on main and merge_group, and adding merge_group triggers to all required status checks.

## Source requirements

- Feature/use case/rule IDs: BR-CI-01, BR-CI-02, BR-CI-03, BR-CI-04, AC-AI-165-01, AC-AI-165-02, AC-AI-165-03, AC-AI-165-04, AC-AI-165-05, AC-AI-165-06, AC-AI-165-07, AC-AI-165-08
- Screen/API/entity/state IDs: N/A — CI and toolchain workflows; no user interface or backend database entity modified
- Source documents: docs/00-control/BASELINE-AND-DECISIONS.md, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md, docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md, docs/product-spec/work-items/TASK-AI-165.md, operator explicit approval (2026-11-02)

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: N/A — CI and toolchain workflow files only; no UI modified.
- API/application behavior:
  - `.github/workflows/current-application.yml`:
    - Before triggers: `pull_request` (opened, edited, synchronize, reopened, ready_for_review).
    - After triggers: `pull_request` (opened, edited, synchronize, reopened, ready_for_review), `push` (branches: [main]), and `merge_group`.
    - Detect scope step: Added `EVENT_NAME` handling so push and merge_group runs default to full application verification (`application=true`).
    - Setup & Caching: Kept `actions/checkout` with `fetch-depth: 0`, cached pnpm store via `actions/setup-node` (`cache: pnpm`), and added Turborepo cache restoration via `actions/cache@v4` on `.turbo`.
    - Before commands: Ran fixed sequence of `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`.
    - After commands: Conditional on `github.event_name`: on `pull_request`, runs `TURBO_SCM_BASE="${{ github.event.pull_request.base.sha }}" pnpm exec turbo run lint typecheck test build --affected` followed by `eslint scripts`; on `push` and `merge_group`, runs full `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
    - Preserved checks: Job names `application-gate` and `current-application` remain unchanged. All contract, promptfoo, specs, formatting negative proofs, git diff checks, integration tests, and security scans remain untouched.
  - `.github/workflows/feature-contract-gate.yml`:
    - Before triggers: `pull_request` (opened, edited, synchronize, reopened, ready_for_review).
    - After triggers: `pull_request` (opened, edited, synchronize, reopened, ready_for_review) and `merge_group`.
    - Job name: `contract` remains unchanged.
  - Workflows untouched: `pr-agent.yml`, `ai-brain-tests.yml`, `product-spec-validation.yml`, and `security-baseline.yml` were not modified.
- Data/migrations: N/A — no database tables or migrations modified.
- Permissions/tenancy/audit: N/A — CI workflow configurations; `contents: read` maintained.
- External adapters/jobs: Added `merge_group` trigger support for GitHub Merge Queue.

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                                                                                                                  | Visual/manual evidence |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| AC-AI-165-01 | PASS   | Inspection confirms `merge_group` trigger in `current-application.yml` and `feature-contract-gate.yml`                                                              | Diff inspection        |
| AC-AI-165-02 | PASS   | `current-application.yml` runs `turbo run lint typecheck test build --affected` with `TURBO_SCM_BASE = ${{ github.event.pull_request.base.sha }}` on `pull_request` | Diff inspection        |
| AC-AI-165-03 | PASS   | `current-application.yml` runs full `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` on `push` to main and `merge_group`                                    | Diff inspection        |
| AC-AI-165-04 | PASS   | Caches pnpm store and `.turbo` cache directory via `actions/cache@v4`                                                                                               | Diff inspection        |
| AC-AI-165-05 | PASS   | Status check job names `contract` and `application-gate` remain identical                                                                                           | Diff inspection        |
| AC-AI-165-06 | PASS   | `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` documents changes, expected effects, and operator merge queue branch protection instructions | File inspection        |
| AC-AI-165-07 | PASS   | Exactly one row added for `TASK-AI-165` in `FEATURE-DELIVERY-REGISTER.csv` with status `IN_PROGRESS`                                                                | CSV inspection         |
| AC-AI-165-08 | PASS   | `node scripts/ai/check-no-hardcode.mjs` exits with code 0 (0 new hardcodes)                                                                                         | Terminal output        |

## Verification

| Command                                                    | Result | Evidence/notes                                 |
| ---------------------------------------------------------- | ------ | ---------------------------------------------- |
| `pnpm install --frozen-lockfile`                           | PASS   | Lockfile up to date, all dependencies resolved |
| `pnpm lint`                                                | PASS   | All workspace packages pass ESLint             |
| `pnpm format:check`                                        | PASS   | Prettier formatting compliant                  |
| `pnpm typecheck`                                           | PASS   | TypeScript check passes across all packages    |
| `pnpm exec turbo run lint typecheck test build --affected` | PASS   | Executes clean affected run                    |
| `node scripts/ai/check-no-hardcode.mjs`                    | PASS   | 0 new hardcode violations                      |
| `git diff --check origin/main...HEAD`                      | PASS   | Zero whitespace or conflict marker errors      |

- [x] Clean install completed.
- [x] Lint/typecheck completed.
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed.
- [x] Production build completed.
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: N/A — CI workflows.
- Authorization: N/A — CI workflows.
- Idempotency/reconciliation: Caches use GitHub Actions content-addressed hashing (`${{ runner.os }}-turbo-${{ github.sha }}`) with prefix fallback; safe across cache eviction or cache misses.
- Sensitive data/secrets: No secrets or credentials handled or logged.
- Error, timeout and recovery paths: If Turborepo cache is cold or corrupted, turbo recalculates task outputs normally; if `TURBO_SCM_BASE` is identical to HEAD or empty, turbo falls back cleanly.
- Carrier capability/evidence level: N/A.

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

None. To activate the merge queue after this PR merges, the operator must enable "Require merge queue" in GitHub repository branch protection settings as documented in `AI-TOOLCHAIN-DECISIONS.md`.

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: pending
- Verdict: READY_FOR_CODEX

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.
