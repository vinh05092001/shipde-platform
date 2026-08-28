# Data Lifecycle, Sources and Imports

## Source-of-truth matrix

| Data | Primary source | Notes |
|---|---|---|
| Source order/COD expected | OMS/manual approved source | Versioned snapshot |
| Address canonical selection | User-confirmed Ship Dễ mapping | Carrier IDs are adapter mappings |
| Pre-shipment availability/quote | Carrier API response for exact account/input | Time-bound evidence |
| Shipment/waybill result | Carrier action response plus reconciliation lookup | Unknown outcome remains explicit |
| Tracking raw event | Carrier webhook/poll response | Canonical state is derived |
| Expected charge | Approved actual contract rate version | Not current public quote by default |
| Actual charged amount | Carrier settlement statement | Carrier claim, not bank proof |
| Actual receipt | Bank/payment evidence | Batch-level allocation |
| Claim acceptance | Carrier response evidence | Separate from payment |

## Import lifecycle

1. UPLOADED: private object stored; malware check and hash.
2. VALIDATING: format/header/type/control totals.
3. BLOCKED: key/control error prevents promotion.
4. STAGED: rows normalized; nonblocking gaps retained.
5. PROMOTED: immutable revision eligible for snapshots.
6. SUPERSEDED: newer confirmed logical revision replaces future use.

No silent partial import:

- Missing/invalid keys and control-total mismatch block promotion.
- Optional field absence marks only dependent checks data-incomplete.
- Every excluded row has a visible issue record.

## Required source-order fields

- Carrier/account if shipment exists.
- Waybill if shipment exists.
- Source order ID.
- Expected COD.
- Delivery status, source and status_as_of.
- Delivered/created/handover dates as available.
- Declared weight/dimensions.
- Service, route/zone, payer, declared value and return status.

## Carrier statement fields

- Carrier/account, waybill, source order ID if present.
- Batch reference.
- Carrier COD.
- Individual fee components.
- Carrier charged weight.
- Batch totals.
- Actual carrier close/report dates.

## Bank fields

- Transaction ID, transfer reference, posting date, amount and direction.
- Unrelated transaction PII should be masked/removed before ingestion where practical.

## Lineage

Every normalized record stores:

- source_file_id, revision, sheet and row.
- raw payload/hash.
- mapping version.
- normalization version.
- promotion time and actor.

Every audit result stores exact input revisions and rule versions.

## Retention

Retention periods are configuration plus legal/product policy, not hardcoded. Deletion:

- Must preserve legally/business-required audit metadata.
- Removes or irreversibly anonymizes PII when eligible.
- Is logged with actor, scope, reason and outcome.
- Never breaks financial lineage without an approved archival representation.

