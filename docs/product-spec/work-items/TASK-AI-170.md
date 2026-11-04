# TASK-AI-170 — Prompt giao việc và chọn reviewer (gói 4 của audit)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-170` |
| Feature ID | N/A — AI workflow dispatch prompts and reviewer selection |
| Status | `READY_FOR_CODEX` |
| Delivery order | `303` |
| Dependencies | `TASK-AI-162`, `TASK-AI-165` |
| Assigned author | GEMINI |
| Risk | LOW |
| Allowed paths | `scripts/ai/templates/author-header.md`, `scripts/ai/templates/review-contract.md`, `scripts/ai/templates/task-fix.md`, `scripts/ai/templates/task-prbody.md`, `scripts/ai/templates/pr-body.md`, `scripts/ai/render-task.mjs`, `scripts/ai/select-reviewer.mjs`, `scripts/ai/test/render-task.test.mjs`, `scripts/ai/test/select-reviewer.test.mjs`, `docs/product-spec/work-items/TASK-AI-170.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Codex PASS eafc4f8 |
| Branch | `feat/task-ai-170-dispatch-prompts` |
| Pull Request | `UNKNOWN` |

## Business outcome

Bring proven dispatch prompts, structured review contract, and independent reviewer selection into repository source control for Controller and Hermes automation, replacing transient scratchpad templates and preventing self-review or non-independent reviewer routing.

## Source references

- `AGENTS.md`: Role separation, unit of delivery, code review rules, security invariants.
- `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md`: Handoff documents, author and reviewer boundaries.
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`: Pinned toolchain, module reuse.
- `tools/ai-brain/review-manifest.js`: Independent reviewer verification rules (M-R04).

## Preconditions and dependencies

- Base branch `origin/main` at baseline.
- Node.js test runner (`node:test`) available.
- No-hardcode guard (`scripts/ai/check-no-hardcode.mjs`) operational.

## Ambiguity and clarification markers

None. All prompt formats, scope rules, and reviewer independence conditions are explicitly specified.

## Author boundary

GEMINI implements bounded tooling scripts, prompt templates, and unit tests. No product application architecture, database schemas, or production security gates are modified.

## Slice sizing rule

Focused single vertical tooling slice (< 400 lines per script file).

## In scope

- Repository templates: `author-header.md`, `review-contract.md`, `task-fix.md`, `task-prbody.md`, `pr-body.md`.
- `scripts/ai/render-task.mjs`: Template renderer with scope evaluation (conditional tenant/RBAC requirement, conditional .github scope rule, and structured WHERE/WRONG/GOAL/VERIFY review findings).
- `scripts/ai/select-reviewer.mjs`: Reviewer candidate selector excluding shared account, model, gateway, or upstream with author candidate, falling back to BLOCKED with reason when no candidate qualifies, and providing stub with "chưa nối" when selection API is unmerged.
- Comprehensive unit tests under `scripts/ai/test/`.

## Out of scope

- Direct modifications to `.github/`, gate configs, allowlists, baselines, or semgrep rules.
- Production product endpoints or database tables.

## Business rules and edge cases

- AI-170-R01: Templates use generic placeholders (`{{WORK_ITEM}}`, `{{PR}}`, `{{FILES}}`, `{{TEST_CMD}}`) without task-specific examples or machine-specific paths.
- AI-170-R02: `render-task.mjs` inspects Work Item metadata; it only adds tenant/RBAC testing requirements when the Work Item touches tenant/auth, and does not forbid `.github/` when the Work Item scope permits it.
- AI-170-R03: Review findings are formatted strictly as `WHERE:`, `WRONG:`, `GOAL:`, and `VERIFY:` fields.
- AI-170-R04: `select-reviewer.mjs` enforces independence across account, model, gateway, and upstream; returns `status: BLOCKED` if no independent candidate is available.
- AI-170-R05: No hardcoded model or provider names; missing data records `UNKNOWN`.

## Constitution check

- [x] Tenant scope and RBAC: test not applicable; authoring tooling and prompt generation scripts only.
- [x] Audit and sensitive data: no secrets or credentials handled or logged.
- [x] VND integer arithmetic: test not applicable; no monetary logic.
- [x] Tests at lowest useful level: `node:test` covering CI vs feature scope rendering and reviewer filtering.

## UI states

N/A — command-line tooling and markdown templates only.

## API, event and data impact

None. Internal AI workflow scripts and markdown templates.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-170-01 | Render CI Work Item with permitted .github | Scope rule allows .github/, omits tenant/RBAC testing requirement | unit: `scripts/ai/test/render-task.test.mjs` |
| AC-AI-170-02 | Render Feature Work Item with tenant/auth | Scope rule forbids .github/, includes tenant/RBAC test requirement | unit: `scripts/ai/test/render-task.test.mjs` |
| AC-AI-170-03 | Format review findings | Formats WHERE, WRONG, GOAL, and VERIFY fields without prose | unit: `scripts/ai/test/render-task.test.mjs` |
| AC-AI-170-04 | Reviewer shares writer upstream or gateway | Excluded from selection; returns BLOCKED if no candidate remains | unit: `scripts/ai/test/select-reviewer.test.mjs` |
| AC-AI-170-05 | Independent reviewer available | Successfully selected with matching candidate key | unit: `scripts/ai/test/select-reviewer.test.mjs` |
| AC-AI-170-06 | Selection API unmerged | Returns BLOCKED with reason mentioning stub "chưa nối" | unit: `scripts/ai/test/select-reviewer.test.mjs` |
| AC-AI-170-07 | No hardcoded model names | `node scripts/ai/check-no-hardcode.mjs` passes with zero violations | CLI execution log |

## Task breakdown

- [x] `T01` [P] Create templates under `scripts/ai/templates/`.
- [x] `T02` Implement `scripts/ai/render-task.mjs`.
- [x] `T03` Implement `scripts/ai/select-reviewer.mjs`.
- [x] `T04` [P] Write and run unit tests in `scripts/ai/test/`.
- [x] `T05` Verify no-hardcode policy and diff cleanly.

## Author checklist

- [x] Unit tests pass via `node --test scripts/ai/test/render-task.test.mjs scripts/ai/test/select-reviewer.test.mjs`.
- [x] No hardcoded models/accounts/limits (`scripts/ai/check-no-hardcode.mjs` passes).
- [x] Register row added with delivery_order = 303.

## Review record

- Codex review: PASS at commit `eafc4f8`.
- Follow-up in `dbce7e3`: treat explicitly empty modelId and accountId as invalid.
- Address review of `52acbbe`: add unit test verifying pr-body template and PR body contain zero unchecked mandatory checklist items (- [ ]), resolving CI contract gate failure.
