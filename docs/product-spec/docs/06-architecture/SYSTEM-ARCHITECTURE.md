# System Architecture

## Context

\`\`\`mermaid
flowchart LR
U[Shop users] --> WEB[Ship Dễ Web/PWA]
R[Recipient] --> WEB
WEB --> API[Ship Dễ API]
API --> OMS[Pancake/OMS]
API --> CARRIERS[Carrier adapters]
API --> BANK[Bank file/API]
CARRIERS --> GHN[GHN]
CARRIERS --> GHTK[GHTK]
CARRIERS --> VTP[Viettel Post]
CARRIERS --> JT[J&T Vietnam]
\`\`\`

## Containers

\`\`\`mermaid
flowchart TB
WEB[Next.js Web/PWA] --> API[NestJS API]
API --> PG[(PostgreSQL)]
API --> REDIS[(Redis)]
API --> OBJ[(S3-compatible object storage)]
API --> Q[Job queue]
Q --> WORKER[Worker service]
WORKER --> PG
WORKER --> OBJ
WORKER --> ADAPTER[Carrier adapter layer]
API --> ADAPTER
WEBHOOK[Webhook ingress] --> Q
SCHED[Scheduler] --> Q
\`\`\`

## Backend modules

- Identity and tenancy.
- Organization/warehouse.
- Carrier accounts/capabilities.
- Source orders.
- Address/serviceability.
- Quotes/routing.
- Shipments/pickup/labels.
- Tracking/events.
- Exceptions/returns.
- Files/imports.
- Rate and policy.
- Audit/reconciliation.
- Settlement/bank/COD.
- Cases/claims.
- Notifications/reports/billing.
- Admin/audit/support access.

## Architectural invariants

- Domain code never calls carrier endpoints directly; only adapters do.
- External commands are persisted before dispatch.
- Async results use correlation/idempotency identifiers.
- Raw external data is immutable; normalized state is derived/versioned.
- Tenant filtering is applied at repository/query boundary and tested.
- Financial calculations run on immutable snapshots.
- Read models/dashboard summaries can be rebuilt from authoritative records.

## Transaction boundaries

- Local command creation and outbox event are one database transaction.
- External network call is outside database transaction.
- Provider result is applied idempotently in a new transaction.
- Bank allocation confirmation locks affected transaction/batch totals.
- Official audit-run selection and period close use optimistic/pessimistic controls as appropriate.

## Availability strategy

- A carrier outage degrades only the affected capability/account.
- Quotes return partial results with explicit missing/unknown carriers.
- Tracking uses webhook plus polling/backfill.
- Manual/file paths remain for settlement and unverified providers.
- Circuit breaker, bounded retry and dead-letter recovery are observable.
