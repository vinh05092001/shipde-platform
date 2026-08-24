# ZCode Start Prompt

Use one new ZCode task per Work Item. Replace the placeholders and paste the block below after opening the repository root as the ZCode workspace.

```text
Implement exactly one Ship Dễ Work Item: <WORK_ITEM_ID> on the Codex-prepared branch <BRANCH>.

Mandatory operating contract:
1. Read the root AGENTS.md completely.
2. Read docs/product-spec/docs/10-ai-collaboration/ZCODE-CODEX-WORKFLOW.md, the relevant row in FEATURE-DELIVERY-REGISTER.csv, and the Work Item.
3. Follow the specification precedence in AGENTS.md. Existing prototype code is not proof of completion.
4. Use Plan mode first. Verify Definition of Ready and dependencies before editing.
5. If any material business rule, acceptance condition or dependency is missing, mark the Work Item BLOCKED with evidence and stop. Do not invent behavior.
6. Fetch and checkout <BRANCH>. Verify it contains the Codex-prepared Work Item and READY_FOR_ZCODE register row. Do not create a different branch.
7. Implement only this Work Item as a complete vertical feature: UI, backend, persistence, authorization, error/recovery states, audit, contracts and tests where applicable.
8. Do not add another feature, broad cleanup or unrelated refactor.
9. Run every required validation command from a clean state. Never report a command as passed unless you actually ran it and captured the result.
10. Update the Work Item and traceability with implementation evidence. Fill every section of the Pull Request template.
11. Commit, push the branch and open one Pull Request titled `[<WORK_ITEM_ID>] <business outcome>`.
12. Set the item to READY_FOR_CODEX and stop. Do not merge and do not start the next Work Item.

Your final response must contain only:
- Work Item and branch
- Pull Request URL
- implemented requirement IDs
- commands actually run and results
- evidence locations
- assumptions, limitations or blockers
```

## Review-fix prompt for the same ZCode task

```text
Read all new Codex review findings on Pull Request <PR_URL>. Fix every actionable finding for <WORK_ITEM_ID> on the existing branch. Do not dismiss a finding without code/test evidence or a human-approved specification decision. Rerun the full required verification set, update the PR evidence, push the fixes, set status back to READY_FOR_CODEX and stop.
```
