# TASK-AI-164 — Definition-of-ready gate for Work Items

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-164` |
| Feature ID | `N/A — AI delivery workflow` |
| Status | `IN_PROGRESS` |
| Delivery order | `273` |
| Dependencies | None; existing template and Node.js workspace are available at the starting HEAD. |
| Assigned author | `Codex — operator-assigned implementation task, 2026-11-02` |
| Risk | `LOW` |
| Allowed paths | `scripts/ai/ready-check.mjs`; `scripts/ai/test/ready-check*.test.mjs`; `scripts/ai/test/fixtures/ready-check/`; root `package.json` scripts; `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`; `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`; one row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; this Work Item; `.oc/pr-body.md`; `.oc/tmp/` evidence |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-164-definition-of-ready` |
| Pull Request | None; the operator requires one local commit with the prescribed message and no push; the coordinator prepares the remote Pull Request handoff. |

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

Codex implements this bounded local script and documentation change under the explicit operator assignment. It does not independently approve its own work. The operator requires one local commit with the prescribed message and explicitly prohibits pushing; independent review and remote CI remain required.

## Slice sizing rule

One Work Item, branch and eventual PR. Keep the implementation focused on parsing the Work Item and reporting readiness; fixtures and acceptance evidence cover the boundary cases. There is no UI implementation ordering in this item.

## In scope

- Template sections for empty Open questions, unchanged behaviour with regression tests, and Proof on every acceptance row.
- Dependency-free, read-only `pnpm ai:ready <work-item>` with exit 0 for ready and exit 1 with one line per problem otherwise.
- Fixture-based Node tests, planning/author handoff documentation, this Work Item, one register row and PR evidence.

## Out of scope

Existing Work Item rewrites; `.github/`; gate configurations; allowlists; baselines; semgrep rules; controller routing changes; package dependencies; production application behavior; executing Proof commands or fetching source links; history rewrite, force operations, pushes, and any local commit other than the single operator-prescribed `[TASK-AI-164] Definition-of-ready gate for Work Items` commit.

## Unchanged behaviour

- Checking a file preserves its bytes; regression test: `CLI accepts a Work Item path without mutating the file`.
- Valid Markdown with CRLF, optional outer pipes, reordered Proof and escaped pipes stays readable; regression test: `supports CRLF, optional outer pipes, reordered Proof and escaped pipes`.
- Repository document paths and external source links remain usable offline; regression test: `accepts repository paths and external source links`.
- Existing acceptance evidence levels, constitution checks and task ordering remain in the template; regression proof: `git diff -- docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`.

## Business rules and edge cases

- READY-01: Any unresolved clarification marker blocks readiness, including markers in comments, inline code and fenced examples. Open questions must be empty before assignment.
- READY-02: Acceptance tables must contain data rows and a Proof column. Every row needs a concrete test name or runnable command; blank or placeholder proof is a planning problem. Nested acceptance sections are included.
- READY-03: Unchanged behaviour must contain actual preserved behavior, not just a heading, comment or placeholder. Each behavior names its regression proof in the prepared Work Item.
- READY-04: Source references must contain at least one repository document path or HTTP(S) source-document link. Unrelated text elsewhere, comments and fenced examples do not supply a source. The checker validates presence without reading or fetching referenced documents.
- READY-05: Invalid argument counts, missing files and unreadable paths fail with one diagnostic line and no stack trace. Checking never mutates the input or runs its contents.

## Constitution check

- [x] Tenant scope: N/A; no tenant reads or writes.
- [x] RBAC & permissions: N/A; no route or authorization changes.
- [x] Audit & sensitive data: Diagnostics identify rules and line numbers without echoing Work Item contents; no credentials are needed.
- [x] VND integer arithmetic: N/A; no money behavior.
- [x] Carrier reconciliation: N/A; no carrier effects.
- [x] Tests at the lowest useful level, test-first where executable: supplied node:test fixtures failed before implementation with `ERR_MODULE_NOT_FOUND`; all executable acceptance paths use the local checker or CLI.

## UI states

None; this is a CLI and documentation change. CLI success reports PASS; validation failures list problems and return to planning; input errors explain how to correct the invocation.

## API, event and data impact

None for application APIs, events, jobs, persistence or migrations. The new root script accepts one Work Item path. The exported checker returns `{ ok, problems }` for deterministic tests. No existing Work Item is migrated and no controller or CI gate configuration changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required | Proof |
|---|---|---|---|---|
| AC-READY-01 | Fully prepared Work Item | CLI exits 0 and leaves file bytes unchanged | unit and CLI fixture | `CLI accepts a Work Item path without mutating the file` |
| AC-READY-02 | Clarification markers or unresolved Open questions | Fails anywhere in the file; unresolved questions return to planning | unit fixtures | `node --test --test-name-pattern="rejects marker anywhere\|nonempty Open questions" scripts/ai/test/ready-check.test.mjs` |
| AC-READY-03 | Missing, empty or placeholder Proof; nested acceptance table | Each affected table or row fails; absent or empty matrices fail | unit fixtures | `node --test --test-name-pattern="Proof\|acceptance\|dashes" scripts/ai/test/ready-check.test.mjs` |
| AC-READY-04 | Empty, missing, commented or placeholder unchanged behaviour | Fails without taking content from the next section | unit fixtures | `node --test --test-name-pattern="Unchanged behaviour" scripts/ai/test/ready-check.test.mjs` |
| AC-READY-05 | Missing source reference or supported source links | Fails without a source; repository and HTTP(S) references pass offline | unit fixtures | `node --test --test-name-pattern="source" scripts/ai/test/ready-check.test.mjs` |
| AC-READY-06 | Multiple problems or invalid CLI input | One diagnostic line per problem, exit 1, no stack trace | CLI fixtures | `node --test --test-name-pattern="CLI" scripts/ai/test/ready-check.test.mjs` |
| AC-READY-07 | Prepared task and documented handoff | TASK-AI-164 passes; workflow requires passing before READY_FOR_AUTHOR and sends failures to planning | CLI and docs-inspection | `pnpm ai:ready docs/product-spec/work-items/TASK-AI-164.md` |

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
node --test scripts/ai/test/ready-check.test.mjs scripts/ai/test/ready-check-boundaries.test.mjs
pnpm ai:ready docs/product-spec/work-items/TASK-AI-164.md
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
git diff --check
```

On Windows, `pnpm.cmd` selects the same pnpm CLI if PowerShell blocks its `.ps1` launcher. The working tree check is additional evidence because the mandated three-dot diff only covers committed changes.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| Pending | None; sandbox working tree | Independent review pending | None |

## Residual limitations

The checker establishes document readiness, not semantic completeness or successful execution of the declared proofs. The planner and independent reviewer retain those responsibilities. The full formatting check fails only on two uncommitted TASK-AI-155 quarantine files under `.oc/tmp/`; exact paths and task-owned formatting evidence are in `.oc/pr-body.md`. The operator requires one local commit with the prescribed message and no push; the coordinator owns the remote Pull Request handoff, remote CI and independent review after this sandbox handoff; no independent PASS or merge is claimed here.
