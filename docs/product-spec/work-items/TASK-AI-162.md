# TASK-AI-162 — Shared pre-push check for every writer lane

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-162` |
| Feature ID | N/A — shared author tooling |
| Status | `IN_PROGRESS` |
| Delivery order | `273` |
| Dependencies | None — existing root gates and Lefthook are on origin/main |
| Assigned author | Codex — direct operator assignment, 2026-11-02 |
| Risk | LOW |
| Allowed paths | `scripts/ai/prepush-check.mjs`, `tools/ai-brain/test/task-ai-162-prepush-check.test.js`, `package.json`, `lefthook.yml`, this file, `docs/product-spec/docs/10-ai-collaboration/{AI-TOOLCHAIN-DECISIONS.md,WORK-ITEM-TEMPLATE.md,FEATURE-DELIVERY-REGISTER.csv}`, `.oc/pr-body.md` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/task-ai-162-shared-prepush` |
| Pull Request | [#499](https://github.com/vinh05092001/shipde-platform/pull/499) — this repair remains local under the sandbox instruction |

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
- [x] `T02` Implement checker, alias and optional hook.
- [x] `T03` Complete author checklist, decision record, register and PR body.
- [ ] `T04` Run frozen install, checker, new tests, no-hardcode and diff checks; record exact results.
- [ ] `T05` Coordinator commits with existing hooks; no commit or push from this sandbox, per operator decision 2026-11-02.

## Author checklist

- [x] Run pnpm ai:check and paste its summary in the PR. Executed locally; the recorded secrets failure keeps T04 incomplete.

## Verification commands

From the isolated worktree (use `pnpm.cmd` on Windows where PowerShell blocks the `.ps1` shim):

```text
pnpm install --frozen-lockfile
pnpm ai:check
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @shipde/api test
node --test tools/ai-brain/test/task-ai-162-prepush-check.test.js
node scripts/ai/check-no-hardcode.mjs
git diff --check
git diff --check origin/main...HEAD
```

Repair evidence, 2026-11-02: eight new negative tests were observed failing before the repair (24 tests: 16 pass, 8 fail); that repair's focused suite passed all 25 tests, including the earlier gate, hook and output-suppression regressions. The repair validates committed, staged and unstaged changed-file coverage before narrowing tests, requires runnable Turbo tasks for every affected workspace/dependent, and rejects failed or malformed selection probes. Its red/green logs are retained in `.oc/tmp/task-ai-162-{red,green}.log`.

Repair evidence, 2026-11-03: two additional negative tests were observed failing before the fix (27 tests: 25 pass, 2 fail). A successful Turbo process with missing or malformed task metadata now requires full tests, including absent stdout and JSON fragments inside diagnostic output. Valid bare JSON and LF/CRLF Turbo banners remain supported, and a failed Turbo process still uses the verified pnpm fallback. All 27 focused tests pass without skips; the earlier 25 regressions remain covered. Logs: `.oc/tmp/task-ai-162-round2-red.log`, `.oc/tmp/task-ai-162-round2-incomplete-red.log`, and `.oc/tmp/task-ai-162-round2-green.log`.

Frozen installs, focused tests, lint, typecheck, the full API command and explicit no-hardcode checks pass locally. The API run uses three missing environment values from repository test fixtures and canonical LF OpenAPI bytes; no contract content changed. A configured root run (`TURBO_ENV_MODE=loose` to preserve those test variables) passes all 12 main test tasks, then fails in the unchanged regression audit's separate fixture install with `ERR_SQLITE_ERROR`. The default strict Turbo run drops the required test variables and fails shop configuration validation. No Turbo or gate configuration was changed.

Full validation remains incomplete: the secrets gate still reports two existing `DASHBOARD.html:115` findings, and the regression audit needs coordinator verification. The audit creates separate Git fixtures internally, so it was not retried after discovering that conflict with the operator's no-clone/no-Git-write boundary. Docker lifecycle and publication remain assigned to the coordinator. Exact commands, results, safe checker output and finding-to-test mappings are in `.oc/pr-body.md`; local results do not establish remote CI or independent review.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| None | None | Pending independent review | None |

The repair request references `.oc/review.txt` and optional `.oc/history.md`, but neither file was present. A read-only GitHub lookup of PR #499 confirmed head `5380fc06b510546488c7b8365a6f0c1f840876d6`, matching this checkout, and returned zero submitted reviews, comments and review threads. No reviewer finding IDs or earlier verdicts can be reconstructed from these inputs; the PR body distinguishes the author's acceptance self-check from an independent review. No GitHub state was changed.

## Residual limitations

Local hook installation is optional; the operator owns installation in writer workspaces and CI remains authoritative. The coordinator must supply the missing review artifacts and resolve/re-run the outstanding full gates before claiming complete acceptance. Fetch, merge and commit are deferred to the coordinator under the sandbox instruction; no Git metadata writes, remote validation or push occurred in this repair.
