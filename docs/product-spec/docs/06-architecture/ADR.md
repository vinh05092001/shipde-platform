# Architecture Decision Records

## ADR-001 TypeScript monorepo

- Status: Accepted.
- Decision: Next.js frontend, NestJS backend and shared TypeScript contracts.
- Reason: AI generation consistency, shared types and easier small-team handover.

## ADR-002 Modular monolith first

- Status: Accepted.
- Decision: One deployable backend plus separate workers, with strict domain modules.
- Reason: Reduces operational complexity while preserving boundaries.

## ADR-003 PostgreSQL as system of record

- Status: Accepted.
- Reason: Transactions, constraints, financial integrity and reporting.

## ADR-004 Redis/BullMQ for asynchronous work

- Status: Accepted.
- Scope: Provider commands, reconciliation, polling, imports, audit and exports.

## ADR-005 S3-compatible private object storage

- Status: Accepted.
- Scope: Raw files, labels, contract sources and evidence.

## ADR-006 Carrier adapter boundary

- Status: Accepted.
- Decision: Domain/frontend never use provider-specific endpoints or statuses.

## ADR-007 Immutable event/evidence and audit snapshots

- Status: Accepted.
- Decision: Raw tracking/import/evidence and completed audit-run inputs are not overwritten.

## ADR-008 Web/PWA recipient experience first

- Status: Accepted.
- Reason: Lowest recipient friction; native app can reuse APIs if justified.

## ADR-009 No direct COD custody

- Status: Accepted.
- Decision: COD ledger/bank proof only; money movement requires separately approved licensed partner architecture.

## ADR template

New ADRs state context, considered options, decision, consequences, status and affected IDs.

