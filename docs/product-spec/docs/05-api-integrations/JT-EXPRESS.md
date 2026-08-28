# J&T Express Vietnam Integration

Current status: PARTNER_CONFIRMATION_REQUIRED.

J&T Vietnam provides public consumer rate lookup/tracking and partner surfaces exist internationally, but those are not sufficient to infer the Vietnam partner API contract.

Official public site: https://jtexpress.vn/

## Allowed implementation now

- CarrierAdapter shell and capability flags.
- Manual/file carrier-account workflow.
- Protected link to manual partner operation where appropriate.
- Canonical mock server scenarios.
- No production endpoint/payload copied from another J&T country.

## Required Vietnam partner evidence

- Account onboarding and authentication/signature.
- Administrative address codes.
- Tariff/serviceability.
- Create/query/cancel/update.
- Label and pickup.
- Tracking and webhook.
- NDR/redelivery and return.
- Settlement/claim surfaces.
- Sandbox, rate limits, idempotency and support escalation.

Production capability switches remain disabled until partner contract tests pass.

