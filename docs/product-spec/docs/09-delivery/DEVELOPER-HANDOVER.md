# Developer Handover

## Handover objective

The human developer receives a runnable, tested AI-generated product and focuses on review, provider reality, security, performance and production hardening—not rediscovering business requirements.

## Required handover bundle

- Clean repository and tagged baseline.
- README and one-command local setup.
- Environment variable catalog with no secrets.
- Migrations and seed data.
- OpenAPI and generated API client.
- Mock carrier server/scenario catalog.
- Test command results and coverage summary.
- Architecture/ADR and module map.
- Carrier capability evidence and sandbox results.
- Known limitations and technical-debt register.
- Deployment/rollback and operations runbooks.

## Developer review checklist

### Architecture/code

- Module boundaries and dependency direction.
- Transaction/outbox/inbox correctness.
- Database indexes/constraints and migration safety.
- Async retry/dead-letter behavior.
- Error and logging consistency.

### Security

- Auth/session/MFA.
- Tenant/resource authorization.
- Secret/PII/file access.
- Webhook verification.
- Injection/XSS/CSRF and rate limiting.

### Carrier integrations

- Current official/partner contracts.
- Permission and status constraints.
- Timeout/idempotency/client-reference behavior.
- Error mapping and raw evidence sanitization.
- Sandbox/production differences.

### Financial correctness

- Integer money and rounding.
- Approved effective rules.
- Detail/summary invariants.
- Processing status versus findings.
- Batch allocation and four money evidence levels.

### Production

- Performance/load.
- Backup/restore.
- Metrics/alerts.
- Feature flags and rollback.
- Support access and retention.

## Completion record

For each reviewed module record:

- Reviewer/date/commit.
- Issues found and severity.
- Fix/acceptance decision.
- Tests added.
- Residual risk/owner.
