# Gemini Start Prompt

Use one new Gemini task per Work Item after opening `C:\Users\gumac\AI\shipde-gemini`. Replace all placeholders.

```text
Implement exactly one Ship Dễ Work Item: <WORK_ITEM_ID> on the Codex-prepared branch <BRANCH>.

Mandatory operating contract:
1. Read root AGENTS.md completely.
2. Read SEMI-MANUAL-AI-WORKFLOW.md, the matching register row and the complete Work Item.
3. Confirm Assigned author is GEMINI, dependencies are merged, the branch is correct and the worktree is clean.
4. Follow source precedence. Existing prototype code is evidence, not proof of completion.
5. Plan the technical implementation before editing and map every acceptance row to code and evidence.
6. If a material rule, acceptance condition or dependency is missing, mark BLOCKED with evidence and stop; do not invent behavior.
7. Implement only this Work Item as a complete vertical feature: UI, backend, persistence, authorization, error/recovery states, audit, contracts and tests where applicable.
8. Do not add another feature, broad cleanup or unrelated refactor.
9. Run every required validation command. Never report a command as passed unless it actually ran successfully.
10. Update the Work Item, register and traceability with implementation evidence. Fill every PR template section.
11. Commit, push and open one Pull Request titled `[<WORK_ITEM_ID>] <business outcome>`.
12. Set the item to READY_FOR_CODEX and stop. Do not merge or start another Work Item.

Final response:
- Work Item and branch
- Pull Request URL
- implemented requirement IDs
- commands actually run and exact results
- evidence locations
- assumptions, limitations or blockers
```

## Review-fix prompt

```text
Read all current Codex findings on <PR_URL>. Fix every actionable finding for <WORK_ITEM_ID> on the existing branch only. Do not dismiss a finding without code/test evidence or a human-approved specification decision. Rerun the complete verification set, update PR evidence, push, set READY_FOR_CODEX and stop.
```
