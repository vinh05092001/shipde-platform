# TASK-AI-162 — Shared pre-push check for every writer lane

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-162` |
| Feature ID | N/A — shared author tooling |
| Status | `IN_PROGRESS` |
| Delivery order | `272` |
| Dependencies | None — existing root gates and Lefthook are on origin/main |
| Assigned author | Codex — direct operator assignment, 2026-11-02 |
| Risk | LOW |
| Allowed paths | `scripts/ai/prepush-check.mjs`, `tools/ai-brain/test/task-ai-162-prepush-check.test.js`, `package.json`, `lefthook.yml`, this file, `docs/product-spec/docs/10-ai-collaboration/{AI-TOOLCHAIN-DECISIONS.md,WORK-ITEM-TEMPLATE.md,FEATURE-DELIVERY-REGISTER.csv}`, `.oc/pr-body.md` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/task-ai-162-shared-prepush` |
| Pull Request | None — operator requested local commit only |

## Business outcome

Every writer lane runs one local command before committing/pushing and attaches its safe summary to the PR, catching mechanical failures before independent review. CI remains authoritative.

## Source references

- Operator approval, 2026-11-02: TASK-AI-162 requirements 1–4 and delivery instructions.
- `docs/00-control/BASELINE-AND-DECISIONS.md`: DEC-016, TypeScript monorepo.
- `docs/01-product/PRODUCT-VISION-SCOPE.md`: Boundaries; no product behavior changes.
- `docs/01-product/MASTER-FEATURE-CATALOG.md`: product catalog; Feature ID N/A for author tooling.
- `docs/07-ai-build/TECH-STACK-REPOSITORY.md`: Required root commands; Environment principles.
- `docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`: Git hook manager: Lefthook; Shared author pre-push check (TASK-AI-162).
- `docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`: Constitution check; Author checklist.

## Preconditions and dependencies

`origin/main` is available at baseline `c6e71fcb9354cd2b14d1f5dcaed794abff306991`. Root scripts, pnpm filtering and explicit Lefthook installation already exist. Node, frozen dependencies and native Gitleaks are runtime prerequisites; missing prerequisites must fail, never pass silently.

## Ambiguity and clarification markers

None. The operator explicitly authorizes this tooling implementation and an optional local hook; CI and existing gate policy remain unchanged.

## Author boundary

Codex implements this bounded, deterministic tooling task under direct operator authorization. No product architecture, authorization, tenancy, money, carrier side effects or database ownership is touched. Authoring does not confer independent review approval.

## Slice sizing rule

One Work Item, branch and local commit; aim for approximately 400 changed lines excluding generated files. No API or UI slice applies.

## In scope

Node-only ordered fail-fast checker, root alias, optional Lefthook pre-push invocation with an explicit skip variable, offline command-stub tests, author instructions and delivery evidence.

## Out of scope

`.github/`, gate configs, allowlists, baselines, Semgrep rules, dependency additions, product code, automatic fetching, pushing and merging. The requested addition to `lefthook.yml` is the only hook wiring change.

## Business rules and edge cases

- AI-162-R01: Run format, lint, typecheck, secrets, diff whitespace, then tests in that order; stop on first failure, including spawn errors/signals.
- AI-162-R02: Pin incremental gates to `origin/main`; reuse their existing dirty-file behavior. Select affected workspace tests and dependents from the merge-base using pnpm filtering. Root changes, untracked files, empty selection or unavailable filtering conservatively run full root tests. A failing filtered test never retries as full tests.
- AI-162-R03: Print one PASS/FAIL line per executed gate and a final verdict; suppress all child output and exception text. Never print secrets or environment values.
- AI-162-R04: Installing local hooks stays optional and explicit. The installed shared check runs unless `SHIPDE_SKIP_AI_CHECK=1` is explicitly set for the hook. Direct `pnpm ai:check` cannot be skipped by that variable. Existing hooks stay intact; CI remains the authority.

## Constitution check

- [x] Tenant scope and RBAC: test not applicable; no product routes or queries.
- [x] Audit and sensitive data: child output suppressed, including failing commands.
- [x] VND arithmetic and carrier reconciliation: test not applicable; no domain changes.
- [x] Tests at the lowest useful level: offline `node:test` assertions written first and observed failing because the checker module was absent.

## UI states

N/A — command-line summaries only; no screen changes.

## API, event and data impact

None. No schemas, migrations, API routes, jobs or persisted application data change.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-162-01 | All gates succeed | Exact order, six summaries and final PASS; exit zero | unit; local ai:check log |
| AC-AI-162-02 | Any gate fails or cannot launch | Stop immediately, safe FAIL summaries, nonzero exit | unit with stubbed commands |
| AC-AI-162-03 | Workspace-only changes vs shared/unknown scope | Filter affected workspaces and dependents; conservative full fallback | unit with stubbed selection metadata |
| AC-AI-162-04 | Hook installation and explicit exception | Shared alias wired without changing existing hooks; only explicit variable skips it | docs-inspection; test not applicable: hook configuration and documented opt-out |
| AC-AI-162-05 | Author handoff | Checklist, one register row, ten-section PR body, no push | docs-inspection; test not applicable: documentation deliverables |

## Task breakdown

- [x] `T01` Write and observe failing offline command-stub tests for executable acceptance rows.
- [ ] `T02` Implement checker, alias and optional hook.
- [ ] `T03` Complete author checklist, decision record, register and PR body.
- [ ] `T04` Run frozen install, checker, new tests, no-hardcode and diff checks; record exact results.
- [ ] `T05` Commit the requested message with existing hooks; do not push.

## Author checklist

- [ ] Run pnpm ai:check and paste its summary in the PR.

## Verification commands

From the isolated worktree (use `pnpm.cmd` on Windows where PowerShell blocks the `.ps1` shim):

```text
pnpm install --frozen-lockfile
pnpm ai:check
node --test tools/ai-brain/test/task-ai-162-prepush-check.test.js
node scripts/ai/check-no-hardcode.mjs
git diff --check
git diff --check origin/main...HEAD
```

Evidence pending; local results do not establish remote CI or independent review.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| None | None | Pending independent review | None |

## Residual limitations

Local hook installation is optional; the operator owns installation in writer workspaces and CI remains authoritative. No remote validation or push is requested.
