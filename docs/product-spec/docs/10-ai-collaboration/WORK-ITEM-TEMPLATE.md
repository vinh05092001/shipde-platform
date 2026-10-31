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

Deliver in tightly bounded vertical increments to cut review rounds and prevent reviewer fatigue:
- Decompose complex features into an API/backend slice first, followed by a separate UI slice.
- Target ~400 changed lines (excluding lockfiles, generated fixtures, and migration snapshots) per Work Item Pull Request.

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
- [ ] **Tests-first per acceptance row**: Unit and integration tests for each acceptance row must be written and failing before production implementation begins.

## UI states

Define loading, empty, validation, error, forbidden, partial, success and recovery states for affected screens.

## API, event and data impact

Describe commands/queries, idempotency, errors, migrations, entities, events, jobs and compatibility impact.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `<ID>` | `<Given/When>` | `<Then>` | `<test/screenshot/log>` |

## Task breakdown

Numbered implementation sequence following test-first ordering. Independent tasks that can be developed or executed in parallel are tagged with `[P]`:

- [ ] `T01` [P] Write failing unit/integration tests for acceptance row `<AC-ID>`.
- [ ] `T02` Implement API/backend domain logic, persistence, and authorization to pass `T01`.
- [ ] `T03` [P] Write failing component/journey tests for UI states.
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
