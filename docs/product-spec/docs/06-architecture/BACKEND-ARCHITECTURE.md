# Backend Architecture

## Stack

- NestJS modular monolith initially.
- PostgreSQL with Prisma or an equivalent migration-first ORM selected in ADR.
- Redis and BullMQ for jobs/scheduling.
- S3-compatible object storage for private files/evidence.
- OpenAPI generated from the authoritative contract/code with drift check.

## Why a modular monolith

- The domain is broad but the initial team is small.
- Strong transaction and traceability needs are easier to manage.
- Clear module boundaries allow later extraction without premature distributed complexity.

## Layers

- Domain: entities, value objects, rules and state transitions.
- Application: use cases, commands, queries and authorization.
- Infrastructure: PostgreSQL, object storage, queues, mail and adapters.
- Interface: REST, webhook and worker handlers.

## Key patterns

### Outbox/inbox

- Local state change and outgoing event commit together.
- Incoming provider events use inbox dedupe.
- Workers are at-least-once; handlers are idempotent.

### External command saga

1. Validate permission/state.
2. Persist command PENDING and outbox.
3. Worker sends adapter request.
4. Apply SUCCEEDED/REJECTED/OUTCOME_UNKNOWN.
5. Unknown starts reconciliation job/work item.
6. Emit state/notification events.

### Audit run

1. Validate promoted imports and approved rule coverage.
2. Build immutable input snapshot.
3. Match records.
4. Calculate expected components.
5. Produce processing result plus findings.
6. Aggregate summaries from details.
7. Mark completed; human/system selects official run.

## Database rules

- All tenant data includes tenant_id.
- Composite unique constraints enforce provider/account identities and billing idempotency.
- Money is bigint integer VND.
- State transitions occur through application services, not arbitrary CRUD.
- Raw/evidence/audit tables are immutable.
- Optimistic version guards editable aggregates.

## Background jobs

- Carrier quote fan-out and timeout collection.
- External shipment commands/reconciliation.
- Tracking polling/backfill.
- Exception detection and escalation.
- File validation/promotion.
- Audit runs.
- Claim deadline notifications and authorized submission.
- Report/export generation.
- Retention/deletion.
