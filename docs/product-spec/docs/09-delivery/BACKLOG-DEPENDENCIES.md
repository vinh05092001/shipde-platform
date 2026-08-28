# Backlog and Dependencies

## Epics

| Epic | Scope | Depends on |
|---|---|---|
| EPIC-FND | Repository, identity, tenancy, shop, users, roles, warehouse | — |
| EPIC-CAR | Carrier accounts, capability, secrets, adapters and mocks | FND |
| EPIC-ORDER | Source orders, address, imports and validation | FND |
| EPIC-QUOTE | Serviceability, quote, recommendation and routing | CAR, ORDER |
| EPIC-SHIP | Create/update/cancel, label and pickup | QUOTE |
| EPIC-TRACK | Webhook/polling, recipient and exceptions | CAR, SHIP |
| EPIC-RETURN | Expected return, scan/evidence/case | TRACK |
| EPIC-RULE | Contract rate, policies, approvals and simulator | FND, CAR |
| EPIC-IMPORT | Statement/bank imports, staging and lineage | FND |
| EPIC-AUDIT | Matching, audit, missing states and results | RULE, IMPORT, ORDER |
| EPIC-MONEY | Batches, bank allocation and COD ledger | AUDIT |
| EPIC-CLAIM | Cases, deadlines, evidence and submission | AUDIT, MONEY, TRACK/RETURN |
| EPIC-REPORT | Dashboards, reports, notifications and billing | All domain epics |
| EPIC-HARDEN | Security, performance, accessibility, deployment and runbooks | All |

## Dependency graph

\`\`\`mermaid
flowchart TB
  FND --> CAR
  FND --> ORDER
  CAR --> QUOTE
  ORDER --> QUOTE
  QUOTE --> SHIP
  SHIP --> TRACK
  TRACK --> RETURN
  FND --> RULE
  FND --> IMP
  CAR --> RULE
  RULE --> AUDIT
  IMP --> AUDIT
  ORDER --> AUDIT
  AUDIT --> MONEY
  AUDIT --> CLAIM
  MONEY --> CLAIM
  TRACK --> CLAIM
  RETURN --> CLAIM
  CLAIM --> REPORT
  REPORT --> HARDEN
\`\`\`

## Story template

- Story ID/title.
- Feature/use-case/rule/test IDs.
- Actor and value.
- Preconditions/dependencies.
- UI/API/data/state impacts.
- Acceptance criteria.
- Nonfunctional/security considerations.
- Test fixtures.
- Estimate and owner.

## Planning rules

- No story is “backend only” when a user-facing end-to-end slice is expected; split technical tasks under one deliverable story.
- Carrier integration stories require capability evidence or explicit confirmation-required stub outcome.
- Financial rule stories require golden examples before implementation.
- Every external command story includes timeout/unknown outcome/idempotency tests.

