# Codex Feature Review Prompt

Use this in the Codex app after the Pull Request is open. Replace the placeholders. Codex remains reviewer-only during this task.

```text
Independently review Ship Dễ Pull Request <PR_URL> for exactly <WORK_ITEM_ID>. Do not modify code and do not merge.

Review procedure:
1. Read the repository root AGENTS.md completely and apply its Code Review Rules.
2. Read the Work Item, its FEATURE-DELIVERY-REGISTER row, source requirement documents, contracts and acceptance scenarios.
3. Inspect the entire PR diff and enough surrounding code to trace each changed user action from UI through API/application logic, persistence, external adapter and audit behavior.
4. Verify this PR contains only one Work Item and does not hide unrelated changes.
5. Check each acceptance row individually, including failure, permission, tenant, duplicate, timeout, recovery, loading, empty and accessibility states where applicable.
6. Check migrations, compatibility, idempotency, carrier evidence, money invariants, sensitive data and observability.
7. Run or independently inspect the required lint, typecheck, unit, integration, E2E and build evidence. A test that never exercises the changed behavior is not evidence.
8. Compare implementation against the full Definition of Done. Existing demo UI or a success toast is not sufficient.
9. Post actionable findings on the Pull Request with file/line, violated requirement and expected safe behavior.
10. Return exactly one verdict: PASS, CHANGES_REQUIRED or BLOCKED. Do not return PASS with an unresolved acceptance gap.

Required review report:
- PR, Work Item, reviewed commit SHA
- scope-integrity result
- requirement/acceptance matrix: ID | result | evidence | finding
- commands/tests independently verified
- findings ordered by P0/P1/P2/P3
- regression and residual-risk assessment
- final verdict

PASS requires: all acceptance rows pass, CI evidence is valid, no unresolved consequential finding exists, and the implementation is a real vertical feature rather than a mock or UI-only path.
```

For the semi-manual handoff, the human opens a fresh Codex task in the dedicated Codex worktree with the Pull Request URL. Any GitHub quick review is optional and never replaces the deeper requirement-by-requirement acceptance review.

