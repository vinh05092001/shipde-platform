# Product Vision and Scope

## Product statement

Ship Dễ is an independent multi-carrier shipping operations and control platform for Vietnamese shops. It uses the shop’s own carrier accounts and contracts to reduce manual work and provide a trustworthy chain from quote to final money reconciliation.

## Who it serves

Primary target:

- Shops with stable order volume.
- Shops using one or more own carrier accounts/contracts.
- Teams currently operating across OMS/POS and multiple carrier portals.
- Initial integration preference: Pancake POS plus GHN/GHTK, with Viettel Post and J&T adapters added after partner confirmation.

Operational users:

- Shop owner and operations manager.
- Order operator and customer service.
- Warehouse receiver.
- Finance/accounting.
- Ship Dễ operator and rate reviewer.
- Recipient through a protected tracking experience.

## Jobs to be done

1. Find a carrier that can serve the shipment.
2. Compare normalized live prices and SLA without opening many carrier portals.
3. Create, print, pick up and manage a shipment without re-entering data.
4. Detect delivery problems early and take the safest supported action.
5. Receive returns with evidence.
6. Prove what the carrier should charge and remit under the shop’s real contract.
7. Detect missing, duplicated or abnormal charges and COD.
8. Build and track a claim before the deadline.

## Product scope

### Before shipment

- Authentication, users, roles, shop, branches and warehouses.
- Carrier account connection and capability discovery.
- Order creation/import.
- Address normalization and carrier serviceability.
- Live quotes, comparison and explainable recommendation.
- Shipment creation/update/cancel, pickup and labels.

### In transit

- Canonical tracking ledger.
- Recipient tracking page/PWA.
- Exception detection and workbox.
- Redelivery or documented manual fallback.
- Return monitoring and warehouse receipt.

### After shipment

- Contract rate/policy normalization and approval.
- Source order, statement and optional bank imports.
- Matching, audit and missing-settlement classification.
- Settlement batch and COD ledger.
- Discrepancy cases, evidence, deadlines and claims.
- Billing usage ledger, reports and audit log.

## Boundaries

- No direct custody of shop COD without a separately approved licensed arrangement.
- No fake carrier availability, rate or external command result.
- No claim is submitted without explicit shop policy authorization.
- No ownership of fleet/warehouse is required; workflows support shop/partner assets.
- No financial conclusion without the corresponding evidence level.
- No cross-tenant access.

## Definition of full product

The product is complete only when the primary end-to-end journey runs without database/admin intervention:

Create shop → connect carrier → create/import order → serviceability → quote → select → create waybill → label/pickup → tracking/exception/return → settlement audit → claim/report.

