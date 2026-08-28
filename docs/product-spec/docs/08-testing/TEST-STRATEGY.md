# Test Strategy

## Test levels

| Level | Purpose |
|---|---|
| Unit | Rules, calculations, value objects and state transitions |
| Property/invariant | Allocation, totals, idempotency and money-level invariants |
| API integration | Database, authorization, migration and endpoint contracts |
| Carrier contract | Adapter mapping against mock/sandbox evidence |
| Worker/event | Queue retry, inbox/outbox, dedupe and dead-letter |
| Component | Forms, tables, permission and states |
| E2E | User journey across frontend/backend |
| Security | Tenant isolation, auth, secret/PII and webhook |
| Performance | Quote fan-out, tables/imports/audit/jobs |
| UAT | Business acceptance with shop/operator examples |

## Mandatory invariants

- Same create idempotency key never causes two carrier effects.
- UNKNOWN outcome never becomes safe retry without reconciliation.
- A user cannot access another tenant by changing an ID.
- Sum of bank allocation from a transaction does not exceed transaction amount.
- Summary totals equal detail aggregation.
- Four evidence money levels are not automatically summed.
- Missing optional data cannot turn into confirmed carrier error.
- Approved rate version is immutable.
- Raw event/import/evidence is not overwritten.
- Rerun does not duplicate case/billing without explicit new finding semantics.

## Test ownership

- AI agent writes and runs tests with each slice.
- Human dev reviews test quality and adds provider/production edge cases.
- Product/BA owns golden business examples and UAT expected outcomes.
- Security owner reviews auth/tenant/secrets before production.

## CI gates

- Format/lint.
- Typecheck.
- Unit/property.
- API integration with ephemeral database.
- Contract/schema validation.
- Build.
- E2E smoke.
- Dependency/secret scan.

