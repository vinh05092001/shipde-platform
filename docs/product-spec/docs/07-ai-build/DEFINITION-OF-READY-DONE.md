# Definition of Ready and Done

## Feature Definition of Ready

A feature may enter implementation only when:

- Feature/use-case/rule/screen IDs exist.
- Actor and permission are defined.
- Preconditions, inputs, outputs and errors are defined.
- State transition is valid.
- Entity/API impact is identified.
- External capability evidence/fallback is known.
- Acceptance and test data exist.
- Dependency is complete or explicitly mocked under contract.
- No unresolved high-impact business decision remains.

## Feature Definition of Done

- Frontend and backend are connected.
- Database migration and rollback/forward path exist.
- Authorization and tenant isolation are enforced/tested.
- Loading, empty, error, forbidden and success states exist.
- External commands use idempotency/reconciliation.
- Audit/history is recorded as specified.
- Unit/integration/E2E tests pass.
- OpenAPI/schema/docs and traceability are updated.
- Lint/typecheck/build pass from clean checkout.
- No production hardcode, fake primary action or hidden TODO.
- Accessibility and responsive checks are complete for affected screens.
- Known residual issue is registered and explicitly accepted.

## Slice Definition of Done

In addition:

- End-to-end slice journey passes using deterministic mocks.
- Regression suite from prior slices passes.
- Seed/demo data works.
- Observability is present for async/external behavior.
- Human review checkpoint completed for sensitive changes.

## Release Definition of Done

- All CORE features targeted for the release satisfy DoD.
- No critical/high security defect.
- No known duplicate-command or financial invariant failure.
- Backup/restore and rollback rehearsed.
- Production carrier capabilities have partner evidence.
- UAT sign-off and operational runbooks complete.

