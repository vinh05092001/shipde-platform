# GHN Integration

Evidence level: VERIFIED_OFFICIAL for the public API surface listed below; shop permission and sandbox behavior still require verification.

Official documentation home: https://api.ghn.vn/home/docs

Observed public capabilities include:

- Province/district/ward master data.
- Available services.
- Fee calculation and expected delivery time.
- Create, preview, detail by waybill/client order code.
- Update, cancel, return, print and pickup shifts.
- Update COD and delivery again.
- Status callback/webhook and status/failure reason catalog.
- Ticket surface.

## Required implementation rules

- Store GHN shop_id/account scope and token secret reference.
- Use GHN IDs only inside adapter mappings; domain keeps canonical address.
- Query available services before quote/create.
- Persist selected service and raw fee components.
- Use client_order_code as reconciliation reference when supported.
- On timeout, query order by client reference before create retry.
- Respect status-specific update/COD/cancel/redelivery constraints from current documentation.
- Verify callback authenticity using the current supported mechanism; if no strong signature is documented for the account, combine allow-list/secret strategy with polling reconciliation and record the residual risk.

## Mandatory sandbox cases

- Supported and unsupported route.
- Fee components and volumetric weight.
- Create success, validation failure and timeout/unknown simulation.
- Query by client reference.
- Cancel before and after pickup.
- Update COD in allowed/disallowed states.
- Delivery-again in allowed/disallowed states.
- Duplicate/out-of-order callback.
- Unknown status/failure code.

Endpoint paths are not duplicated here as immutable truth; the adapter configuration and tests are pinned to the provider version verified at implementation time.
