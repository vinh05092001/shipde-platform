# TASK-AI-157 — Adopt spec-kit checklists into Work Item workflow

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-157` |
| Feature ID | `N/A — docs-only workflow improvement adopting spec-kit checklists` |
| Status | `IN_PROGRESS` |
| Delivery order | `269` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`; `docs/product-spec/docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md`; `docs/product-spec/docs/10-ai-collaboration/GEMINI-START-PROMPT.md`; `docs/product-spec/docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-157.md`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-157-spec-kit` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Adopt proven specification-driven development patterns from GitHub Spec Kit (MIT) into Ship Dễ's Work Item workflow as documentation-only standards. This cuts review rounds and prevents AI hallucination/guessing by introducing explicit ambiguity markers (`[NEEDS CLARIFICATION]`), a pre-implementation Constitution check (tenant scope, RBAC, audit masking, VND integer math, carrier reconciliation, tests-first per acceptance row), a numbered task breakdown with test-first ordering and `[P]` parallel markers, and a slice size rule (~400 changed lines, API slice then UI slice), without installing external tooling or altering the repository status flow.

## Source references

- `AGENTS.md` (Role separation, Definition of a complete feature, Foundation verification commands, Code review rules)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- Upstream reference: `github/spec-kit` (MIT License) templates (`spec-template.md`, `plan-template.md`, `tasks-template.md`, `checklist.md`)
- Business rules: `BR-SPEC-01`, `BR-SPEC-02`, `BR-SPEC-03`, `BR-SPEC-04`
- Acceptance criteria: `AC-AI-157-01`, `AC-AI-157-02`, `AC-AI-157-03`, `AC-AI-157-04`, `AC-AI-157-05`

## Preconditions and dependencies

- Operator approval granted on 2026-10-31 for docs-only adoption of spec-kit checklists.
- Branch `feat/task-ai-157-spec-kit` on worktree `p-task-ai-157` clean and synchronized with `origin/main`.
- Node.js and pnpm environment active.

## Ambiguity and clarification markers

None. All requirements are bounded and explicitly defined.

## Author boundary

GEMINI is assigned as author to update documentation templates, prompt specifications, and toolchain decisions. The author is prohibited from installing spec-kit CLI or npm packages, changing existing Work Items, modifying repository status flows, gate configs, allowlists, baselines, semgrep, or `.github/` workflows.

## Slice sizing rule

Docs-only slice strictly under 400 changed lines across collaboration prompts, template, decisions, and work item record.

## In scope

- Add Ambiguity / `[NEEDS CLARIFICATION]` rule to `WORK-ITEM-TEMPLATE.md`.
- Add Constitution check to `WORK-ITEM-TEMPLATE.md`.
- Add Numbered task breakdown with test-first ordering and `[P]` parallel markers to `WORK-ITEM-TEMPLATE.md`.
- Add Slice size rule (~400 changed lines, API then UI slice) to `WORK-ITEM-TEMPLATE.md`.
- Add matching pre-authoring specification checklist to `CODEX-PLANNING-PROMPT.md`.
- Add matching pre-implementation checklist to `GEMINI-START-PROMPT.md` and `NINEROUTER-START-PROMPT.md`.
- Credit `github/spec-kit` (MIT) in `AI-TOOLCHAIN-DECISIONS.md`.
- Register `TASK-AI-157` in `FEATURE-DELIVERY-REGISTER.csv`.
- Create `TASK-AI-157.md` and `.oc/pr-body.md`.

## Out of scope

- Installing `spec-kit` CLI, npm dependencies, or modifying `.specify/` configurations.
- Modifying existing completed Work Items or other register rows.
- Changing controller automation, status flows, or CI workflow files.

## Business rules and edge cases

- `BR-SPEC-01`: Authors must never guess or invent behavior when `[NEEDS CLARIFICATION]` is present; must stop with `BLOCKED`.
- `BR-SPEC-02`: Constitution check items are non-negotiable invariants (tenant isolation, RBAC, audit masking, VND integer math, carrier reconciliation, tests-first).
- `BR-SPEC-03`: Slices target ~400 changed lines, prioritizing API/backend slice before UI slice.
- `BR-SPEC-04`: Docs-only adoption: no external tooling or runtime package is installed.

## Constitution check

- [x] **Tenant scope**: Preserved; no tenant logic modified.
- [x] **RBAC & permissions**: Preserved; no permissions modified.
- [x] **Audit & sensitive data**: Preserved; no secrets or tokens handled.
- [x] **VND integer arithmetic**: Preserved; no currency logic modified.
- [x] **Carrier reconciliation**: Preserved; no carrier operations modified.
- [x] **Tests-first per acceptance row**: Verified; documentation validation, formatting, and no-hardcode checks pass.

## UI states

N/A — documentation and workflow prompts only; no user interface is modified.

## API, event and data impact

N/A — no database models, migrations, or HTTP endpoints modified.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-157-01 | Ambiguity rule in WORK-ITEM-TEMPLATE.md | Author stop-and-block rule on `[NEEDS CLARIFICATION]` is documented | File content inspection |
| AC-AI-157-02 | Constitution check in template and prompts | Pre-implementation check covers tenant scope, RBAC, audit masking, VND integer, carrier reconcile, tests-first | File content inspection |
| AC-AI-157-03 | Numbered task breakdown with [P] markers | Template and prompts include numbered tasks with test-first order and parallel markers | File content inspection |
| AC-AI-157-04 | Slice sizing rule documented | Bounded vertical increments (~400 changed lines, API then UI) documented in template and prompts | File content inspection |
| AC-AI-157-05 | Spec-kit MIT credit | GitHub Spec Kit (MIT License) credited in AI-TOOLCHAIN-DECISIONS.md without installing tooling | File content inspection |

## Task breakdown

- [x] `T01` [P] Update `WORK-ITEM-TEMPLATE.md` with ambiguity markers, constitution check, numbered task breakdown with `[P]` markers, and slice sizing rule.
- [x] `T02` [P] Add matching pre-authoring specification checklist to `CODEX-PLANNING-PROMPT.md`.
- [x] `T03` [P] Add matching pre-implementation checklist to `GEMINI-START-PROMPT.md` and `NINEROUTER-START-PROMPT.md`.
- [x] `T04` [P] Add Spec Kit credit and adoption section in `AI-TOOLCHAIN-DECISIONS.md`.
- [x] `T05` Append `TASK-AI-157` row to `FEATURE-DELIVERY-REGISTER.csv`.
- [x] `T06` Create `docs/product-spec/work-items/TASK-AI-157.md` and `.oc/pr-body.md`.
- [x] `T07` Run documentation validation, format checks, no-hardcode scan, and whitespace check.

## Verification commands

- `pnpm format:check`
- `node scripts/ai/check-no-hardcode.mjs`
- `git diff --check origin/main...HEAD`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | pending | READY_FOR_CODEX | Initial submission |

## Residual limitations

None
