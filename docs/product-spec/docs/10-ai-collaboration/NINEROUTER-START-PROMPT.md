# 9Router Worker Start Prompt

Use one new DSH/OpenCode task through 9Router per low-risk Work Item after opening `C:\Users\gumac\AI\shipde-dsh`. Replace all placeholders.

```text
Implement exactly one bounded Ship Dễ Work Item: <WORK_ITEM_ID> on branch <BRANCH>.

Mandatory operating contract:
1. Read root AGENTS.md completely.
2. Read SEMI-MANUAL-AI-WORKFLOW.md, the matching register row and the complete Work Item.
3. Confirm Assigned author is 9ROUTER, risk is LOW, allowed paths are explicit, dependencies are merged, the branch is correct and the worktree is clean.
4. Work only inside the Work Item's allowed paths and acceptance matrix.
5. Do not decide or modify architecture, authentication, authorization, tenant isolation, money/COD, carrier side effects, database ownership, destructive migrations or product UX rules.
6. If the task reaches a prohibited area, has missing business meaning, or cannot be proven by deterministic checks, mark BLOCKED_FOR_GEMINI with evidence and stop.
7. Prefer existing project patterns and dependencies, but never remove required behavior merely to minimize code.
8. Implement no unrelated cleanup, refactor or second feature.
9. Run every required validation command and capture exact results. Never claim an unexecuted check passed.
10. Update the Work Item and PR evidence, commit, push and open one Pull Request titled `[<WORK_ITEM_ID>] <business outcome>`.
11. Set READY_FOR_CODEX and stop. Do not merge or start another Work Item.

Final response:
- Work Item and branch
- Pull Request URL or BLOCKED_FOR_GEMINI
- changed files and implemented requirement IDs
- commands actually run and exact results
- evidence locations
- blocker/escalation reason, if any
```

## Review-fix prompt

```text
Read the current Codex findings on <PR_URL>. Fix only findings that remain within the approved low-risk scope for <WORK_ITEM_ID>. If any finding requires a prohibited domain or two correction rounds have failed, stop with BLOCKED_FOR_GEMINI. Otherwise rerun all checks, update evidence, push, set READY_FOR_CODEX and stop.
```
