# Carrier Capability Matrix

Evidence date: 2026-08-24. Production use requires a connected shop account and sandbox/partner verification even when public documentation exists.

Legend:

- O: VERIFIED_OFFICIAL public documentation.
- P: PARTNER_CONFIRMATION_REQUIRED.
- U: UNVERIFIED; implement interface stub and manual fallback only.

| Capability                  |                              GHN |                     GHTK |    Viettel Post |                    J&T Vietnam |
| --------------------------- | -------------------------------: | -----------------------: | --------------: | -----------------------------: |
| Address master/mapping      |                                O |                O/partial |               P |                              P |
| Serviceability/service list |                                O |  O/solution/fee response |               P |                              P |
| Live fee quote              |                                O |                        O |               P | Public web only; partner API P |
| EDD/SLA                     |                                O |     P/response-dependent |               P |                              P |
| Create shipment             |                                O |                        O |               P |                              P |
| Lookup by client reference  |                                O |                        P |               P |                              P |
| Update shipment             |             O/status constrained |                        P |               P |                              P |
| Cancel before pickup        |                                O |                        O |               P |                              P |
| Label                       |                                O |                        O |               P |                              P |
| Pickup/shift                |                                O | Account/flow dependent P |               P |                              P |
| Tracking polling            |                                O |                        O |               P | Public tracking; partner API P |
| Status webhook              |                                O |                        O |               P |                              P |
| Update COD                  |             O/status constrained |                        P |               P |                              P |
| Redelivery                  |                                O |                        P |               P |                              P |
| Return command              |                                O |                        P |               P |                              P |
| Settlement API              |                  U/file fallback |          U/file fallback | U/file fallback |                U/file fallback |
| Claim/ticket API            | O ticket surface; business fit P |                        P |               P |                              P |

## Interpretation

- This table proves interface feasibility, not automatic permission.
- A provider may expose a public endpoint but restrict it by shop/account/status.
- For Viettel Post and J&T Vietnam, public consumer pages or third-party integrations are insufficient evidence for production endpoint/schema.
- Until partner confirmation, Ship Dễ supports manual/file workflows for those capabilities and returns PARTNER_CONFIRMATION_REQUIRED.

## Confirmation checklist

For every P capability obtain:

1. Official partner documentation/version.
2. Test and production base URLs.
3. Authentication and permission scopes.
4. Sample requests/responses and errors.
5. Idempotency/client-reference behavior.
6. Status constraints.
7. Webhook signature/retry semantics.
8. Rate limits/SLA/support channel.
9. Contractual permission to store/process returned data.
10. Sandbox test evidence stored in the decision log.
