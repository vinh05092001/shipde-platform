# Security, Privacy, NFR and Observability

## Security controls

- Password hashing with a current memory-hard algorithm.
- Short-lived access tokens and rotating/revocable sessions.
- MFA/step-up for owners, finance and sensitive operations.
- Backend RBAC and resource scope authorization.
- Tenant isolation enforced in repository/query layer and tested.
- Credential values stored only in secret manager/encrypted vault.
- TLS in transit and encryption at rest.
- Private object storage with short-lived authorized downloads.
- File type/size/malware validation.
- Webhook authenticity and replay controls where provider supports them.
- CSRF/XSS/SQL injection protections and secure headers.
- Rate limit auth, OTP, public tracking and webhook routes.
- Sensitive data masking in UI/log/export.
- Immutable security/audit events.

## Threat highlights

| Threat | Primary control |
|---|---|
| Cross-tenant data leak | Tenant-scoped repository, authorization and integration tests |
| Token exposure | Secret reference only, log scrubbing, rotation |
| Duplicate carrier command | Persistent idempotency and remote reconciliation |
| Forged/replayed webhook | Signature/secret, timestamp, inbox dedupe and polling validation |
| Malicious upload | Type/size/malware scan and private staging |
| Support misuse | Shop consent, time-limited grant and audit |
| Claim spam | Policy limits, evidence completeness and idempotency |
| Incorrect financial conclusion | Approved version, snapshot, lineage and evidence level |

## Privacy

- Collect only fields required for fulfillment, evidence or compliance.
- PII classification controls view/export permissions.
- Recipient tracking exposes the minimum via signed link/OTP.
- Retention is configurable and documented; deletion is audited.
- Raw source/evidence access is narrower than normalized operational data.

## NFR targets

Initial targets, to be validated before production:

- Web API p95 under 500 ms excluding external carrier wait.
- Quote aggregation presents available partial results within configured budget, default 8 seconds.
- User commands acknowledge durably within 2 seconds before async provider work where applicable.
- No loss of accepted webhook/import/command records.
- Duplicate shipment effects: zero under retry/concurrency test.
- 99.5% monthly platform availability target excluding provider incidents, with provider health shown separately.
- Audit run baseline capacity: at least 100,000 source plus 100,000 statement rows with measured completion target set after prototype.
- RPO 15 minutes and RTO 4 hours initial target; production owner must approve.

## Observability

Logs:

- Structured JSON, correlation_id, tenant/account hashed identifiers.
- No password, OTP, token, full bank data or unmasked recipient PII.

Metrics:

- API latency/error, auth failures.
- Carrier latency/error/circuit by capability/account.
- Command unknown outcome and reconciliation aging.
- Queue depth, retries, dead-letter count.
- Webhook verification/dedupe/lag.
- Tracking freshness/unmapped codes.
- Import and audit duration/errors.
- Claim deadline jobs.

Alerts:

- Unknown create outcome aging.
- Cross-tenant/security control failure.
- Repeated credential failures.
- Queue backlog/dead-letter.
- Carrier incident threshold.
- Audit summary invariant failure.
- Backup/restore failure.

