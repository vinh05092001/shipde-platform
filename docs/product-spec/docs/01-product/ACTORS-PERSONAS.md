# Actors and Personas

| Actor | Primary jobs | Sensitive access |
|---|---|---|
| SHOP_OWNER | Configure shop, approve policies, see all outcomes | All shop financial and PII data |
| OPS_MANAGER | Manage routing, orders, exceptions and carrier performance | Operational data; configurable finance access |
| ORDER_OPERATOR | Create/import orders, quote, create/cancel shipments, print labels | Recipient data and assigned carrier accounts |
| CUSTOMER_SERVICE | View tracking, contact context, request redelivery under permission | Masked/limited recipient data |
| WAREHOUSE_OPERATOR | Pickup handover, label, return scanning and evidence | Warehouse-scoped PII |
| FINANCE | Rates, statements, bank allocations, COD, cases and billing | Full financial data; limited operational PII |
| RATE_AUTHOR | Normalize contract/policies | Contract documents |
| RATE_REVIEWER | Approve/reject versions | Contract documents; cannot approve own version |
| SHIPDE_OPERATOR | Support imports, mappings, review and claims under granted access | Time-bound tenant support scope |
| SYSTEM_ADMIN | Platform configuration and incident response | No default business-data browsing |
| RECIPIENT | Track own shipment and authorized delivery actions | Only token/OTP-scoped shipment |
| CARRIER_SYSTEM | Serviceability, quote, shipment and tracking provider | External system |
| OMS_SYSTEM | Source order/status provider | External system |
| BANK_SOURCE | Receipt evidence provider | External system |

## Persona principles

- Operators need speed, bulk actions and precise recovery guidance.
- Finance needs immutable evidence and reproducible calculations.
- Owners need decisions and exceptions, not raw integration noise.
- Warehouse users need scan-first screens and minimal typing.
- Recipients should not be forced to install an app.
- Support users never receive implicit permanent tenant access.

