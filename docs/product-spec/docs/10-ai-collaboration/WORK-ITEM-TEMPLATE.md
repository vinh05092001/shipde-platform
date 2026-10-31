# <WORK_ITEM_ID> — <Outcome>

## Control

| Field | Value |
|---|---|
| Work Item ID | `<WORK_ITEM_ID>` |
| Feature ID | `<FEAT-ID or N/A>` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `<number>` |
| Dependencies | `<merged IDs>` |
| Assigned author | `<GEMINI or 9ROUTER>` |
| Risk | `<LOW/MEDIUM/HIGH>` |
| Allowed paths | `<explicit paths>` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `<branch>` |
| Pull Request | `<URL>` |

## Business outcome

State what becomes possible for which actor and why the product needs it.

## Source references

List exact feature, actor, rule, use case, screen, API, entity, state and acceptance IDs. A filename without a relevant heading or ID is insufficient.

## Preconditions and dependencies

List technical and business prerequisites with evidence that they are merged or available under an approved deterministic mock.

## Ambiguity and clarification markers

Every ambiguous requirement, rule gap, unresolved dependency, or unverified assumption must be explicitly tagged with `[NEEDS CLARIFICATION]`. If an unresolved `[NEEDS CLARIFICATION]` marker remains when assigned, the author must STOP immediately and mark the item `BLOCKED` with written evidence; the author must never guess, assume intent, or silently choose an interpretation.

## Author boundary

Explain why the selected author is appropriate. For `9ROUTER`, enumerate allowed files, deterministic proof and every prohibited boundary. For `GEMINI`, identify consequential architecture/security/product decisions that still require human approval.

## Slice sizing rule

Keep each Work Item Pull Request a single vertical delivery (one Work Item, one branch, one Pull Request per AGENTS.md) sized to cut review rounds and prevent reviewer fatigue:
- Target ~400 changed lines (excluding lockfiles, generated fixtures, and migration snapshots) per Work Item Pull Request.
- API/backend work precedes UI work as implementation ordering inside the same Pull Request (failing tests -> API/backend -> UI); one Work Item is never split into a backend Pull Request plus a separate UI Pull Request.
- If the work cannot stay within the budget while remaining vertical, the planner splits it before authoring into independently scoped prerequisite Work Items: each successor gets its own Work Item file, register row, branch, Pull Request and acceptance matrix; the register `dependencies` field links each successor to its prerequisites; and no predecessor or intermediate item may declare the overall feature complete until the terminal dependent Work Item is `MERGED`.

## In scope

List observable behaviors, including frontend, backend, persistence, permission, errors, audit and tests where applicable.

## Out of scope

Explicitly list adjacent behavior that must not be added in this Pull Request.

## Business rules and edge cases

Use rule IDs and include negative, timeout, duplicate, permission and recovery behavior.

## Constitution check

Pre-implementation quality and safety invariants verified by author before coding and by Codex during review:

- [ ] **Tenant scope**: Every database query and mutation is strictly scoped to the authenticated tenant server-side; client-supplied tenant ownership is never trusted.
- [ ] **RBAC & permissions**: Every route and action verifies actor roles and permissions explicitly; unauthorized access returns canonical forbidden responses.
- [ ] **Audit & sensitive data**: PII, tokens, and secrets are masked in logs, audits, and error outputs; sensitive actions record audit events.
- [ ] **VND integer arithmetic**: All monetary amounts in VND use integer arithmetic only (no floating-point calculations).
- [ ] **Carrier reconciliation**: External carrier operations (create, cancel, redelivery, claim) reconcile remote state before retry; timeouts never trigger blind retries.
- [ ] **Tests at the lowest useful level, test-first where executable**: Each acceptance row declares its evidence level (`unit`, `integration`, `e2e`, `docs-inspection`, `screenshot` or `log`). Rows with an executable level have their tests written and observed failing before production implementation begins, per AGENTS.md ("lowest useful level plus the Work Item acceptance path"). Rows with a non-executable level (e.g. documentation-only, screenshot-only) instead record `test not applicable: <justification>` in the acceptance matrix; no universal unit-plus-integration gate applies.

## UI states

Define loading, empty, validation, error, forbidden, partial, success and recovery states for affected screens.

## API, event and data impact

Describe commands/queries, idempotency, errors, migrations, entities, events, jobs and compatibility impact.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `<ID>` | `<Given/When>` | `<Then>` | `<unit/integration/e2e test, docs-inspection, screenshot or log; "test not applicable: <justification>" if the row is non-executable>` |

## Task breakdown

Numbered implementation sequence ordered API/backend before UI, with the failing-test task for each executable acceptance row placed before the implementation task it covers. Independent tasks that can be developed or executed in parallel are tagged with `[P]`:

- [ ] `T01` [P] Write failing tests at the lowest useful level for each executable acceptance row `<AC-ID>`; for non-executable rows record `test not applicable: <justification>` in the acceptance matrix.
- [ ] `T02` Implement API/backend domain logic, persistence, and authorization to pass `T01`.
- [ ] `T03` [P] Write failing component/journey tests for UI rows that are executable.
- [ ] `T04` Implement UI screens and state transitions to pass `T03`.
- [ ] `T05` Run full verification suite, verify no hardcoded production values, and attach evidence.

## Verification commands

List exact repository commands. All must run from a clean checkout.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

Write `None` or list each limitation with owner, risk, next action and human acceptance.
