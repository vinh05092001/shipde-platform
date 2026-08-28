# Error, Idempotency and Retry Contract

## Canonical error classes

| Code | Meaning | Retry |
|---|---|---|
| VALIDATION_ERROR | Invalid user/input data | After correction |
| FORBIDDEN | Permission/scope denied | No |
| CONFLICT | Version/state/idempotency conflict | Re-fetch |
| CARRIER_UNSUPPORTED | Explicit capability/route rejection | No until input/config changes |
| CARRIER_AUTH_REQUIRED | Invalid/insufficient credentials | After account fix |
| CARRIER_RATE_LIMITED | Provider limit | Scheduled retry per header/policy |
| CARRIER_TIMEOUT | No timely response | Reads may retry; commands reconcile first |
| CARRIER_UNAVAILABLE | Provider outage/circuit open | Deferred retry/manual |
| CARRIER_RESPONSE_INVALID | Schema/unexpected response | Quarantine and adapter incident |
| COMMAND_OUTCOME_UNKNOWN | External effect may have occurred | Remote reconciliation only |
| DATA_INCOMPLETE | Evidence missing for a rule | Add data |
| RULE_NOT_APPROVED | Rule cannot support conclusion | Approve/fix version |
| IMPORT_BLOCKED | Key/control validation failed | Correct revision |

## Idempotency

- Required for create shipment, update/cancel, pickup, redelivery, claim submission, period close, bank confirmation and billing event.
- Store tenant, operation, key, request hash, command state, result reference and expiry policy.
- Same key + same request returns existing command/result.
- Same key + different request returns IDEMPOTENCY_CONFLICT.
- Idempotency records outlive typical client retry windows and are never deleted before external reconciliation guarantees.

## Retry policy

Safe automatic retry:

- Read-only GET/query.
- Webhook/event processing after durable dedupe.
- Background calculations using immutable snapshot.

Conditional retry:

- Rate-limited read/write only when provider declares safety or client idempotency is proven.
- External commands only after provider lookup proves not applied.

Never blind retry:

- Shipment create with unknown outcome.
- Cancel/update/redelivery when remote state is unknown.
- Claim submission.
- Bank allocation confirmation.

## Circuit breaker

Per carrier account and capability:

- Closed: normal.
- Open: fail fast with TEMPORARILY_UNAVAILABLE/manual fallback.
- Half-open: bounded probe.

An account auth failure does not open the carrier globally. A provider incident does not disable unrelated carriers.

