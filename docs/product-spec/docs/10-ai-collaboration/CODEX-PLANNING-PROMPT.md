# Codex Work Item Planning Prompt

Use this in a planning-only Codex task before giving a feature to ZCode. For this repository, the user may simply say: **“Chuẩn bị Work Item tiếp theo cho ZCode.”**

```text
Prepare the next dependency-ready Ship Dễ Work Item for ZCode. Do not implement production code.

1. Read root AGENTS.md, the feature delivery register, backlog dependencies, Definition of Ready, traceability and all source documents linked to the candidate feature.
2. Select the earliest eligible row. All dependencies must already be MERGED. Do not skip a blocked earlier item without recording the reason.
3. Create branch feat/<lowercase-work-item-id>-<short-slug> from the latest main. Do not change application code.
4. Create docs/product-spec/work-items/<FEAT-ID>.md from WORK-ITEM-TEMPLATE.md on that branch.
5. Fill actor, business outcome, preconditions, scope, non-scope, business rules, UI states, API/events/data impact, negative paths, acceptance scenarios, test evidence and exact verification commands.
6. Reconcile contradictions using the documented source precedence. If a material product choice remains, mark BLOCKED and ask the user; do not invent it.
7. Check Definition of Ready. Only when every gate passes, update exactly that register row to READY_FOR_ZCODE on the feature branch.
8. Commit and push the planning documents to the prepared branch. Do not open the implementation Pull Request yet.
9. Return the Work Item ID, branch, source path, readiness evidence and the exact ZCode start prompt with both placeholders already replaced.
```

Planning and later review should use separate Codex tasks so the review starts from the Pull Request evidence rather than relying on the planning conversation.
