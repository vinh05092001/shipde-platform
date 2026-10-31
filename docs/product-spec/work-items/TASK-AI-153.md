# TASK-AI-153 — Cut review rounds

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-153` |
| Feature ID | `N/A — delivery workflow` |
| Status | `IN_PROGRESS` |
| Delivery order | `270` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `apps/api/AGENTS.md`; `apps/web/AGENTS.md`; `AGENTS.md` (Unit of delivery section only); `docs/product-spec/work-items/TASK-AI-153.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-153-agent-checklists` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

AI and human authors working in `apps/api` or `apps/web` see the mandatory checklists in the same directory they edit, so the P1 findings that recur across Codex review rounds — missing server-side tenant scoping, empty scope arrays, missing auth/RBAC guards, unmasked audit metadata, missing cross-tenant negative tests, stale OpenAPI contracts, and incomplete UI state coverage — are caught while authoring instead of in review. The root contract additionally caps PR size and forces API/UI slice separation, keeping each review unit small. Expected effect: fewer `CHANGES_REQUIRED` rounds per Pull Request.

## Source references

- `AGENTS.md` — Unit of delivery; Code review rules (Security and tenancy, User experience, Verification); Required handoff documents.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — status flow `IN_PROGRESS -> READY_FOR_CODEX` and review round handling.
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` — structure of this Work Item.
- Recurring review P1 findings distilled into the app-level checklists: tenant-owned query scoping, empty scope arrays, endpoint auth+RBAC guards, masked audit metadata, cross-tenant negative supertest per new endpoint, OpenAPI contract update, UI loading/empty/error/forbidden/success state coverage.
- Condensed framework rule sources (CC0-1.0): PatrickJS/awesome-cursorrules, `rules/typescript-nestjs-best-practices-cursorrules-promp.mdc` and `rules/nextjs-app-router-cursorrules-prompt-file.mdc`.

## Preconditions and dependencies

- Operator approval 2026-10-31 (recorded in `.oc/task.md`) authorizes this Work Item.
- Monorepo layout with `apps/api` (NestJS) and `apps/web` (Next.js) is in place; `origin/main` is available locally.
- No other Work Item must be merged first; none is listed as a dependency.

## Author boundary

`9ROUTER` is assigned because every routing condition holds: the behavior is fully specified in `.oc/task.md`; allowed files and expected output are bounded to five repository files; completion is deterministically provable (files exist with the required gates, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `git diff --check origin/main...HEAD` pass); no high-risk domain is touched (documentation and register only, no application code, authentication, money, carrier or product UX behavior); and failure can be escalated to `GEMINI` without partial external effects. Prohibited: gate configs, allowlists, baselines, semgrep rules, `.github/`, `package.json` command changes, and any application code change. An independent Codex review remains required.

## In scope

- `apps/api/AGENTS.md`: mandatory author checklist with the Review P1 gates (tenant-owned queries scoped server-side by `merchantId`; empty scope arrays deny; every endpoint has an auth guard plus RBAC guard; audit metadata always masked; each new endpoint has a cross-tenant negative supertest; OpenAPI contract updated in the same change) and condensed NestJS plus Prisma rules with CC0 source attribution.
- `apps/web/AGENTS.md`: mandatory author checklist with the UI state gates (loading, empty, error, forbidden and success covered; validation, partial and recovery when the screen spec requires them; forbidden is a dedicated state; no fake primary actions or placeholder-as-live data; data comes from the API) and condensed Next.js rules with CC0 source attribution.
- Root `AGENTS.md`: one added bullet in Unit of delivery — keep each PR under ~400 changed lines excluding lockfiles and generated files; split an API slice and a UI slice into separate Pull Requests. No other change to the file, no command changes.
- This Work Item file and exactly one register row for `TASK-AI-153` with status `IN_PROGRESS`.
- Local handoff `.oc/pr-body.md` with the ten template sections and `Review status: READY_FOR_CODEX`.

## Out of scope

- Gate configs, allowlists, baselines, semgrep rules and `.github/` workflows.
- `package.json` scripts or root `AGENTS.md` verification commands.
- Any application code, test, migration or UI change in `apps/api` or `apps/web`.
- Changes to `docs/product-spec/AGENTS.md` or other specification documents.

## Business rules and edge cases

- `BR-AI-153-01`: The app-level files are mandatory checklists, not optional advice; each required P1 gate appears verbatim in the file for its app, and the root `AGENTS.md` still wins on conflict.
- `BR-AI-153-02`: Third-party rules are condensed, not copied; the source repository and CC0-1.0 license notice are retained in each condensed section. No code is copied from non-MIT/Apache/CC0 sources.
- `BR-AI-153-03`: The root `AGENTS.md` diff contains exactly one added bullet in the Unit of delivery section and nothing else; no command or gate text changes.
- `BR-AI-153-04`: Exactly one register row exists for `TASK-AI-153`; its status is `IN_PROGRESS`, its work item path and branch match this Work Item, and no other row is added or reordered.
- `BR-AI-153-05`: Every file added or modified in this Work Item uses LF line endings and passes `git diff --check origin/main...HEAD`.

## UI states

N/A — documentation and register data only; no screen is added or changed.

## API, event and data impact

None. The register CSV schema is unchanged; exactly one row is appended. No endpoints, migrations, entities, events or jobs are touched.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-153-01` | Author opens `apps/api/AGENTS.md` before an API change | File contains all six Review P1 gates plus condensed NestJS and Prisma rules with CC0 source attribution | File content; `git diff` |
| `AC-AI-153-02` | Author opens `apps/web/AGENTS.md` before a UI change | File contains the UI state gates plus condensed Next.js rules with CC0 source attribution | File content; `git diff` |
| `AC-AI-153-03` | Review the root `AGENTS.md` diff | Unit of delivery gains only the ~400-line and API/UI split bullet; no other line changes, no command changes | `git diff AGENTS.md` |
| `AC-AI-153-04` | Register and Work Item consistency | Exactly one `TASK-AI-153` row, status `IN_PROGRESS`, matching path and branch; Work Item file status `IN_PROGRESS` with operator approval 2026-10-31 recorded | CSV diff; file content |
| `AC-AI-153-05` | Handoff PR body exists | `.oc/pr-body.md` contains all ten `##` sections of `.oc/pr-body-template.md` and `Review status: READY_FOR_CODEX` | File content |
| `AC-AI-153-06` | Repository verification passes | `pnpm lint`, `pnpm typecheck`, `pnpm test`, `git diff --check origin/main...HEAD` and `node scripts/ai/check-no-hardcode.mjs` all pass; new files use LF endings | Command output |
| `AC-AI-153-07` | Prohibited paths untouched | No diff touches gate configs, allowlists, baselines, semgrep rules, `.github/` or `package.json` | `git diff --name-only origin/main...HEAD` |

## Verification commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
git diff --name-only origin/main...HEAD
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Awaiting independent review | None |

## Residual limitations

- The checklists reduce but do not eliminate review rounds; their effect is measured over the following merged Pull Requests by the operator comparing `CHANGES_REQUIRED` round counts. Owner: operator; risk: LOW; next action: track round counts on the next five merged PRs; human acceptance: by observation, no decision needed.
