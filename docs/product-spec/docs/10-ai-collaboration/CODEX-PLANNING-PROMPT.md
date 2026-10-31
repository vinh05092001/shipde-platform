# Codex Work Item Planning Prompt

Use this in a planning-only Codex task before assigning implementation. The user may say: **“Chuẩn bị Work Item tiếp theo.”**

```text
Prepare the next dependency-ready Ship Dễ Work Item. Do not implement production code.

1. Read root AGENTS.md, SEMI-MANUAL-AI-WORKFLOW.md, the delivery register, backlog dependencies, Definition of Ready, traceability and all source documents linked to the candidate item.
2. Select the earliest eligible row. Every dependency must be MERGED. Do not skip an earlier blocked item without recording why.
3. Create `feat/<lowercase-work-item-id>-<short-slug>` from latest `origin/main`. Do not change application code.
4. Create exactly `docs/product-spec/work-items/<WORK_ITEM_ID>.md` from `WORK-ITEM-TEMPLATE.md` (including for `TASK-FOUND-*`) and fill every business, technical-boundary and acceptance section. Do not leave an aggregate source such as `FOUNDATION-WORK-ITEMS.md` as the executable Work Item path.
5. Record exact actor, outcome, source IDs, scope, non-scope, rules, UI states, API/events/data impact, negative paths, evidence and verification commands.
6. Choose Assigned author:
   - 9ROUTER only when risk is LOW, behavior and allowed paths are bounded, deterministic checks prove completion, and no prohibited domain in AGENTS.md is touched.
   - GEMINI for every other Work Item, including all foundation, vertical, UI, security, money, carrier-effect and cross-layer work.
7. If a material product choice remains, mark BLOCKED and ask the human; do not invent it.
8. Check Definition of Ready. Only when every gate passes, update exactly that register row: set `work_item_path` to the dedicated file, set `branch` to the prepared branch, and set `status` to `READY_FOR_AUTHOR`. Do not change another row.
9. Commit and push planning documents to the prepared branch. Do not open the implementation PR yet.
10. Return Work Item ID, branch, author choice and reason, source path, readiness evidence, allowed paths and the correct start prompt with placeholders replaced.
```

Planning and later review must use separate Codex tasks. Review starts from the Pull Request evidence, not the planning conversation.

## Pre-authoring specification checklist (spec-kit)

Verify before setting `READY_FOR_AUTHOR`:
- [ ] **Ambiguity check**: Tag open questions or unverified assumptions with `[NEEDS CLARIFICATION]`. If any remain unresolved, mark `BLOCKED`; never leave the author to guess.
- [ ] **Constitution check**: Enforce non-negotiables (tenant scope, RBAC, audit masking, VND integer math, carrier reconciliation, tests at the lowest useful level with test-first ordering for executable acceptance rows and `test not applicable: <justification>` for non-executable rows).
- [ ] **Task breakdown**: Decompose work into numbered tasks ordered API/backend before UI, test-first for executable acceptance rows, with `[P]` markers for parallel-safe independent tasks.
- [ ] **Slice sizing**: Keep the Work Item a single vertical Pull Request bounded to ~400 changed lines (API/backend before UI inside the same PR). If it cannot fit while staying vertical, split it into independently scoped prerequisite Work Items (own file, register row, branch, PR and acceptance matrix each, linked via register `dependencies`); set `READY_FOR_AUTHOR` on the prerequisites, and record that the feature completes only when the terminal item merges.
