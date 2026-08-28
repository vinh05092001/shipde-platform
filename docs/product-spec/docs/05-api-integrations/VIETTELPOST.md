# Viettel Post Integration

Current status: PARTNER_CONFIRMATION_REQUIRED.

Public searches indicate partner APIs and third-party tracking integrations exist, but a current, complete and authoritative public Vietnam partner specification was not verified for all required shipping actions.

## Allowed implementation now

- Implement the CarrierAdapter shell.
- Implement capability configuration and manual/file fallback.
- Implement mocks based on Ship Dễ canonical contracts, clearly labeled simulation.
- Implement public tracking only if terms and data access are confirmed.
- Do not encode unofficial endpoint paths or payloads as production truth.

## Required partner evidence

- Authentication/token issue and scopes.
- Address/service master.
- Serviceability and price.
- Create/query/update/cancel.
- Label and pickup.
- Tracking/webhook/signature.
- Redelivery/returns.
- Settlement and claims.
- Sandbox, rate limits, idempotency/client reference and status rules.

Production capability switches remain disabled until evidence is recorded and contract tests pass.
