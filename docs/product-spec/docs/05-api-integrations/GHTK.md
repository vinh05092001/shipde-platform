# GHTK Integration

Evidence level: VERIFIED_OFFICIAL for the documented OpenAPI surface; actual token permissions and account behavior require sandbox verification.

Official documentation: https://docs.giaohangtietkiem.vn/

Observed public capabilities include:

- Token authentication with configurable access permissions.
- Submit shipment.
- Shipment status.
- Solution/service list.
- Fee calculation.
- Label printing.
- Cancellation.
- Pickup-address list and address/product support.
- Status webhook.
- Enterprise/partner flows including account-related APIs subject to partner permissions.

## Required implementation rules

- Token permissions are least-privilege and stored per shop account.
- X-Client-Source/partner code is configuration, not hardcoded.
- Account-creation APIs are not treated as generally available; enable only after GHTK partner permission.
- Persist GHTK tracking label and shop reference.
- Separate explicit rejection from transport timeout.
- If no documented reliable lookup by client reference is confirmed, unknown create outcome remains manual/partner reconciliation rather than blind retry.
- Parse fee response into normalized components while retaining raw response.
- Use webhook plus polling reconciliation when needed.

## Mandatory sandbox cases

- Authentication and permission-denied per method.
- Fee quote and special address behavior.
- Create and duplicate client reference behavior.
- Create timeout reconciliation path.
- Label response formats.
- Cancel in allowed/disallowed statuses.
- Webhook duplicate/out-of-order delivery.
- Token expiry/revocation.

