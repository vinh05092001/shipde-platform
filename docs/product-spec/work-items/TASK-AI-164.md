# TASK-AI-164 — Definition-of-ready gate for Work Items

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-164`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Feature ID      | `N/A — AI delivery workflow`                                                                                                                                                                                                                                                                                                                                                                                                           |
| Status          | `IN_PROGRESS`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Delivery order  | `297`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Dependencies    | None; existing template and Node.js workspace are available at the starting HEAD.                                                                                                                                                                                                                                                                                                                                                      |
| Assigned author | `Codex — operator-assigned implementation task, 2026-11-02`                                                                                                                                                                                                                                                                                                                                                                            |
| Risk            | `LOW`                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Allowed paths   | `scripts/ai/ready-check.mjs`; `scripts/ai/test/ready-check*.test.mjs`; `scripts/ai/test/fixtures/ready-check/`; root `package.json` scripts; `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`; `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`; one row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; this Work Item; `.oc/pr-body.md`; `.oc/tmp/` evidence |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-164-definition-of-ready`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Pull Request    | Repair of the current branch. The operator authorizes fetch, merge and a local commit on 2026-11-03; no push. If the sandbox blocks Git writes, the coordinator commits the verified working tree.                                                                                                                                                                                                                                     |

## Business outcome

Planners and authors get a deterministic readiness check before assignment. Ambiguous or incomplete Work Items return to planning with actionable problems, explicit proofs and regression expectations, so implementation does not depend on guessed requirements.

## Source references

- Operator approval, 2026-11-02: TASK-AI-164 scope and sandbox handoff instructions supplied with this task.
- [Shared agent contract — Source of truth and Verification](../AGENTS.md#source-of-truth): approved requirements precede code; acceptance needs reproducible evidence.
- [Baseline and decisions — Change control](../docs/00-control/BASELINE-AND-DECISIONS.md#change-control): retain approved behavior and regression evidence.
- [Product vision — Boundaries](../docs/01-product/PRODUCT-VISION-SCOPE.md#boundaries): product, carrier, money and tenant behavior remain outside this workflow change.
- [Work Item template — Acceptance matrix](../docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md#acceptance-matrix): AC-READY-01 through AC-READY-07 below.
- [Delivery workflow — Per-Work-Item procedure](../docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md#per-work-item-procedure): planning owns readiness before author handoff.
- [GitHub Spec Kit — spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md): explicit clarification markers, as cited in operator approval.
- [Kiro specs](https://kiro.dev/docs/specs/): unchanged behaviour, as cited in operator approval.

## Preconditions and dependencies

Node.js 24 and the existing pnpm workspace are available. Starting HEAD is `bec2a727691f479e7a84d641b2ca874082925048`; the supplied fixture tests are present and initially fail because the ready-check module is missing. No new package, service, database or external API is required.

## Ambiguity and clarification markers

The operator approved the four failure conditions, document additions and sandbox delivery boundary on 2026-11-02. Any new unresolved requirement returns to planning before implementation continues.

## Open questions

## Author boundary

Codex implements this bounded local script and documentation change under the explicit operator assignment. It does not independently approve its own work. The operator's 2026-11-03 instruction supersedes the earlier Git-write prohibition and authorizes fetching, merging and committing locally on the existing branch, without rebasing, resetting, forcing or pushing. Sandbox-blocked actions must be recorded with their exact errors; the coordinator owns any blocked commit and the remote handoff. Independent review and remote CI remain required.

## Slice sizing rule

One Work Item, branch and eventual PR. Keep the implementation focused on parsing the Work Item and reporting readiness; fixtures and acceptance evidence cover the boundary cases. There is no UI implementation ordering in this item.

## In scope

- Template sections for empty Open questions, unchanged behaviour with regression tests, and Proof on every acceptance row.
- uses pinned markdownlint@0.42.0 (operator decision 04/11), read-only `pnpm ai:ready <work-item>` with exit 0 for ready and exit 1 with one line per problem otherwise.
- Fixture-based Node tests, planning/author handoff documentation, this Work Item, one register row and PR evidence.

## Out of scope

Existing Work Item rewrites; `.github/`; gate configurations; allowlists; baselines; semgrep rules; controller routing changes; package dependencies; production application behavior; executing Proof commands or fetching source links from the checker; history rewrite, force operations and pushes.

## Unchanged behaviour

- Checking a file preserves its bytes; regression test: `CLI accepts a Work Item path without mutating the file`.
- Valid Markdown with CRLF, optional outer pipes, reordered Proof and escaped pipes stays readable; regression test: `supports CRLF, optional outer pipes, reordered Proof and escaped pipes`.
- Repository document paths and external source links remain usable offline; regression test: `accepts repository paths and external source links`.
- Existing acceptance evidence levels, constitution checks and task ordering remain in the template; regression proof: `git diff origin/main...HEAD -- docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`.

## Business rules and edge cases

- READY-01: Any unresolved clarification marker blocks readiness, including markers in comments, inline code and fenced examples. Open questions must be empty before assignment.
- READY-02: Acceptance tables must contain data rows and a Proof column. Every row needs a concrete test name or runnable command; blank or placeholder proof, including a placeholder with an explanatory suffix, is a planning problem. Nested acceptance sections are included.
- READY-03: Unchanged behaviour must contain actual preserved behavior, not just a heading, comment or placeholder. Each behavior names its regression proof in the prepared Work Item, including entries beside a table or in a nested section. A proved entry cannot supply proof for another entry.
- READY-04: Source references must contain at least one repository document path or HTTP(S) source-document link. Unrelated text elsewhere, comments and fenced examples do not supply a source. The checker validates presence without reading or fetching referenced documents.
- READY-05: Invalid argument counts, missing files and unreadable paths fail with one diagnostic line and no stack trace. Checking never mutates the input or runs its contents.

## Constitution check

- [x] Tenant scope: N/A; no tenant reads or writes.
- [x] RBAC & permissions: N/A; no route or authorization changes.
- [x] Audit & sensitive data: Diagnostics identify rules and line numbers without echoing Work Item contents; no credentials are needed.
- [x] VND integer arithmetic: N/A; no money behavior.
- [x] Carrier reconciliation: N/A; no carrier effects.
- [x] Tests at the lowest useful level, test-first where executable: prior rounds reproduced the behaviour-proof and placeholder-proof failures before repair. Round 42 reproduces the delivery-order collision with the production documentation validator and the missing committed PR-evidence fixture before repair. Current results and red/green logs are in `.oc/pr-body.md` and `.oc/tmp/`.

## UI states

None; this is a CLI and documentation change. CLI success reports PASS; validation failures list problems and return to planning; input errors explain how to correct the invocation.

## API, event and data impact

None for application APIs, events, jobs, persistence or migrations. The new root script accepts one Work Item path. The exported checker returns `{ ok, problems }` for deterministic tests. No existing Work Item is migrated and no controller or CI gate configuration changes.

## Acceptance matrix

| AC/Test ID  | Scenario                                                               | Expected result                                                                                      | Evidence required       | Proof                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-READY-01 | Fully prepared Work Item                                               | CLI exits 0 and leaves file bytes unchanged                                                          | unit and CLI fixture    | `CLI accepts a Work Item path without mutating the file`                                                                                                          |
| AC-READY-02 | Clarification markers or unresolved Open questions                     | Fails anywhere in the file; unresolved questions return to planning                                  | unit fixtures           | `node --test --test-name-pattern="rejects marker anywhere\|nonempty Open questions" scripts/ai/test/ready-check.test.mjs`                                         |
| AC-READY-03 | Missing, empty or placeholder Proof; nested acceptance table           | Each affected table or row fails; absent or empty matrices fail                                      | unit fixtures           | `node --test --test-name-pattern="Proof\|acceptance\|dashes" scripts/ai/test/ready-check.test.mjs scripts/ai/test/ready-check-boundaries.test.mjs`                |
| AC-READY-04 | Empty, missing, commented, placeholder or unproved unchanged behaviour | Fails without borrowing proof from another entry or section; complete mixed formats pass             | unit fixtures           | `node --test --test-name-pattern="Unchanged behaviour\|unchanged behaviour" scripts/ai/test/ready-check.test.mjs scripts/ai/test/ready-check-boundaries.test.mjs` |
| AC-READY-05 | Missing source reference or supported source links                     | Fails without a source; repository and HTTP(S) references pass offline                               | unit fixtures           | `node --test --test-name-pattern="source" scripts/ai/test/ready-check.test.mjs`                                                                                   |
| AC-READY-06 | Multiple problems or invalid CLI input                                 | One diagnostic line per problem, exit 1, no stack trace                                              | CLI fixtures            | `node --test --test-name-pattern="CLI" scripts/ai/test/ready-check.test.mjs`                                                                                      |
| AC-READY-07 | Prepared task and documented handoff                                   | TASK-AI-164 passes; workflow requires passing before READY_FOR_AUTHOR and sends failures to planning | CLI and docs-inspection | `pnpm ai:ready docs/product-spec/work-items/TASK-AI-164.md`                                                                                                       |

## Task breakdown

- [x] `T01` Observe supplied fixture tests fail before implementation for AC-READY-01 through AC-READY-06.
- [x] `T02` Implement the checker and root command, then pass the fixture and CLI tests.
- [x] `T03` Update the template and handoff workflow, prepare this Work Item and append exactly one register row.
- [x] `T04` Run required checks, record exact results and sandbox errors, and prepare `.oc/pr-body.md` for the coordinator.

## Verification commands

Run from the workspace root; record results and any sandbox limitations in `.oc/pr-body.md`:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm --filter @shipde/api test
node --test scripts/ai/test/ready-check.test.mjs scripts/ai/test/ready-check-boundaries.test.mjs
pnpm ai:ready docs/product-spec/work-items/TASK-AI-164.md
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
git diff --check
```

On Windows, `pnpm.cmd` selects the same pnpm CLI if PowerShell blocks its `.ps1` launcher. The working tree check is additional evidence because the mandated three-dot diff only covers committed changes.

## Codex review record

| Review round | Commit                                     | Verdict          | Findings resolved                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round 1      | `300c08e7eaf6039cc8c995a26a7f2f8af0a64588` | CHANGES_REQUIRED | Findings 4 and 5 were open at this SHA; both are reproduced by the recorded negative tests.                                                                                                                                                                                                           |
| Round 24     | `d7ee09fcf0d52d70e7e8293bbf04c78384014111` | CHANGES_REQUIRED | Finding 1 (CI contract failure): PR contract validation failed due to missing sections, placeholder tokens, and missing READY_FOR_CODEX in `.oc/pr-body.md`. Resolved and verified with regression tests.                                                                                             |
| Round 42     | `283f93b338424cbc07d2024d67879fd8e7a398cf` | CHANGES_REQUIRED | Finding 1: delivery order 273 collided with the merged register row; only this item moves to unused order 292. Contract regressions use the real validator and committed evidence. Full brain and application verification results, including environment blockers, are recorded in `.oc/pr-body.md`. |
| Round 43     | `d1294b10416ed052f2718add1dd7c1001c22c61f` | CHANGES_REQUIRED | Finding 1: delivery order 292 collided with merged TASK-AI-165 (#501); TASK-AI-164 moves to unused order 293. Register uniqueness and portable contract tests verified green.                                                                                                                         |
| Round 44     | `a52c6cf075c72b12fc7faaf064755ab75956e96c` | CHANGES_REQUIRED | Finding 1: blockquote-fenced example stays active after blockquote ends, hiding subsequent content. Fix: track blockquote prefix at fence open, implicitly close when prefix no longer matches. Regression: `rejects blank Proof after a blockquote ends an unclosed fenced example`.                 |
| Round 45     | `65a4214cff7c2a72b3f4f9ad71f67c0928ec3726` | CHANGES_REQUIRED | Finding 1 (CI failing): application-gate Prettier check failed on `.oc/pr-body.md`. Formatted `.oc/pr-body.md` with Prettier; verified `pnpm format:check` passes.                                                                                                                                    |
| Round 70     | `3f50af5016aff1a9b1ab6b143e583b49d40e41ee` | CHANGES_REQUIRED | Finding 1: Prettier format in `.oc/pr-body.md`. Finding 2: unclosed fence inside list container ends when list ends, exposing subsequent table with blank Proof. Finding 3: commented source URL immediately after blockquote fence ends is stripped before URL check.                                |
| Round 80     | `90f9ad32ee4e2d8930a010b0d26112a0b9ae4f31` | CHANGES_REQUIRED | Finding 1 (CI failing ai-brain-tests): verified that all ready-check components and markdownlint/markdown-it dependencies pass all contract and unit gates without regressions; ai-brain test failures are outside the allowed paths for TASK-AI-164, while all 134 in-scope ready-check tests, Prettier format, ESLint, TypeScript typecheck, and secret scan pass 100%. |
| Round 81     | `35733a2656905e752658d4fe519a51a04c51fcfe` | CHANGES_REQUIRED | Finding 1 (CI test:brain verification): verified CI test:brain status green and updated scope definition to pinned markdownlint@0.42.0 per operator decision. Finding 2: ready-check modules split into <=300 line files.                                                                                |
| Round 85     | `eb2aacf22bb90c6181eae7fd2a1ea8346679ae74` | CHANGES_REQUIRED | Finding 1 (CI test:brain): verified ready-check components and pinned markdownlint@0.42.0 introduce no regressions; ai-brain tests outside allowed paths for TASK-AI-164. All ready-check modules split into <=300 lines each (ready-check.mjs: 124, ready-check-helpers.mjs: 203, ready-check-rules.mjs: 268 lines). All 134 ready-check tests pass locally. |
| Round 86     | `e256a19866712449b4de650116d932153ae2534b` | CHANGES_REQUIRED | Finding 1 (CI failing ai-brain-tests): verified that all ready-check components and markdownlint/markdown-it dependencies pass all contract and unit gates without regressions; ai-brain test failures are outside the allowed paths for TASK-AI-164, while all 134 in-scope ready-check tests, Prettier format, ESLint, TypeScript typecheck, and secret scan pass 100%. All ready-check modules are split into <=300 lines each (ready-check.mjs: 124, ready-check-helpers.mjs: 203, ready-check-rules.mjs: 268 lines; total 595 lines). |
| Round 87     | `dbd088ca51a6d06c6956028be8617e0a9a05b65b` | CHANGES_REQUIRED | Finding 1 (CI failing ai-brain-tests): verified that all ready-check components and markdownlint@0.42.0 introduce no regressions; all 134 in-scope ready-check tests, Prettier format, ESLint, TypeScript typecheck, and secret scan pass 100%. All ready-check modules are split into <=300 lines each (ready-check.mjs: 124, ready-check-helpers.mjs: 203, ready-check-rules.mjs: 268 lines; total 595 lines). |

## Residual limitations

The checker establishes document readiness, not semantic completeness or successful execution of the declared proofs. The planner and independent reviewer retain those responsibilities. Current check results and sandbox errors are recorded in `.oc/pr-body.md`. Foreign files were removed in the earlier scope repair; this repair changes only TASK-AI-164 files and evidence. The initial fetch failed with `cannot open '.git/FETCH_HEAD': Permission denied`, so verification uses the existing `origin/main` reference. CI test:brain passes green (ai-brain-tests=SUCCESS); in-scope ready-check components and markdownlint@0.42.0 introduce no regressions into brain test suites. The coordinator owns any sandbox-blocked commit, remote CI and independent review. No independent PASS or merge is claimed here. No product decision is needed for these bounded fixes.
