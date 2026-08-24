# Glossary

| Term | Definition |
|---|---|
| Shop | Customer organization using Ship Dễ |
| Tenant | Technical isolation boundary, normally one shop organization |
| Branch | Business unit under a shop |
| Warehouse | Pickup/return operating location |
| Carrier account | Shop-owned account/contract at a carrier |
| Source order | Order received from OMS/POS or created manually |
| Quote | Time-bound carrier response for service, fee and SLA |
| Quote snapshot | Immutable request/response selected before shipment creation |
| Shipment | Ship Dễ delivery object linked to a source order |
| Waybill | Carrier-issued tracking code scoped by carrier account |
| Serviceability | Whether a carrier/service can serve a route and parcel |
| Carrier capability | An action supported for a specific carrier account/integration |
| Tracking event | Immutable raw/canonical movement or status event |
| Exception | Operational issue requiring attention |
| Return receipt | Warehouse evidence that returned goods were received and inspected |
| Rate contract | Approved structured version of the shop’s actual carrier agreement |
| Settlement policy | Eligibility, batch, threshold and COD transfer rules |
| Claim policy | Claim type, deadline, evidence and submission rules |
| Settlement statement | Carrier-provided line/batch report |
| Settlement batch | Carrier settlement/remittance grouping of many waybills |
| Finding | One audit observation; a waybill may have zero to many |
| Discrepancy case | Workflow/evidence record for one finding |
| Suspected amount | Machine-detected value not yet internally verified |
| Internally verified amount | Shop/Ship Dễ verified; carrier has not accepted |
| Carrier-accepted amount | Carrier acknowledged value, possibly unpaid |
| Actually received amount | Value proven by bank/payment evidence |
| Carry-forward | Balance/case relation continuing into a later period |
| Idempotency key | Client key preventing duplicate command effects |
| Unknown outcome | Command timed out and remote success/failure is not yet known |

