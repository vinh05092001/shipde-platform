# <WORK_ITEM_ID> — <Outcome>

## Control

| Field | Value |
|---|---|
| Work Item ID | `<WORK_ITEM_ID>` |
| Feature ID | `<FEAT-ID or N/A>` |
| Status | `READY_FOR_ZCODE` |
| Delivery order | `<number>` |
| Dependencies | `<merged IDs>` |
| Author | `ZCode` |
| Reviewer | `Codex` |
| Branch | `<branch>` |
| Pull Request | `<URL>` |

## Business outcome

State what becomes possible for which actor and why the product needs it.

## Source references

List exact feature, actor, rule, use case, screen, API, entity, state and acceptance IDs. A filename without a relevant heading/ID is insufficient.

## Preconditions and dependencies

List technical and business prerequisites with evidence that they are already merged or available under an approved deterministic mock.

## In scope

List observable behaviors, including frontend, backend, persistence, permission, errors, audit and tests where applicable.

## Out of scope

Explicitly list adjacent behavior that must not be added in this PR.

## Business rules and edge cases

Use rule IDs and include negative, timeout, duplicate, permission and recovery behavior.

## UI states

Define loading, empty, validation, error, forbidden, partial, success and recovery states for affected screens.

## API, event and data impact

Describe commands/queries, idempotency, errors, migrations, entities, events, jobs and compatibility impact.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `<ID>` | `<Given/When>` | `<Then>` | `<test/screenshot/log>` |

## Verification commands

List exact repository commands. All must run from a clean checkout.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

Write `None` or list each limitation with owner, risk, next action and human acceptance.

