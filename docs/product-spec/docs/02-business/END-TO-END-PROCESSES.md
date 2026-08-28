# End-to-End Processes

## Process map

\`\`\`mermaid
flowchart LR
  A[Register and configure shop] --> B[Connect carrier accounts]
  B --> C[Create or import source order]
  C --> D[Normalize address]
  D --> E[Check serviceability]
  E --> F[Get live quotes]
  F --> G[Recommend and select carrier]
  G --> H[Create shipment]
  H --> I[Label and pickup]
  I --> J[Track]
  J --> K{Exception?}
  K -- Yes --> L[Workbox and recovery action]
  L --> J
  K -- Return --> M[Receive return with evidence]
  K -- Delivered --> N[Settlement eligibility]
  N --> O[Import carrier statement]
  O --> P[Match and audit]
  P --> Q[Batch and bank reconciliation]
  Q --> R{Finding?}
  R -- No --> S[Close period]
  R -- Yes --> T[Case and claim]
  T --> U[Carrier outcome and recovery]
  U --> S
\`\`\`

## PR-01 Onboard a shop

1. Owner registers or receives an operator-created account.
2. Verify identity and accept terms/privacy.
3. Create shop, billing profile, first warehouse and return address.
4. Invite operational users and assign scopes.
5. Connect a carrier account; test credentials and capabilities.
6. Configure defaults, notifications and optional OMS.
7. Run a test serviceability/quote/create flow using non-production or approved test data.

Failure handling:

- Setup can be resumed.
- Incomplete dependencies are shown as blocking checklist items.
- Sensitive actions are disabled until roles and account permissions are valid.

## PR-02 Quote and create a shipment

1. Create/import source order and parcel.
2. Normalize origin/destination with user confirmation when ambiguous.
3. Check serviceability across connected eligible accounts.
4. Mark each account AVAILABLE, UNSUPPORTED or UNKNOWN_ERROR.
5. Request quotes only from AVAILABLE candidates.
6. Normalize fee components, VAT, SLA and quote expiry.
7. Recommend cheapest, fastest and balanced options with explanation.
8. User selects or an approved routing policy selects.
9. Requote if the selected quote is stale or inputs changed.
10. Submit create command with idempotency key.
11. If timeout occurs, query by client order reference before retry.
12. On success, persist waybill, remote payload snapshot and selected quote.
13. Retrieve/generate label and offer pickup request.
14. Sync waybill/status to OMS.

No-carrier flow:

- Show per-carrier reason.
- Let the user edit only affected inputs and retry without re-entry.
- Save draft or record a manually selected external carrier.

## PR-03 Manage an active shipment

1. Receive webhook and/or poll carrier.
2. Preserve raw event and map to canonical status.
3. Update derived current state only after dedupe/order checks.
4. Detect pickup/delivery exceptions.
5. Prioritize and assign work.
6. Perform a supported update/redelivery only after permission and confirmation.
7. Use carrier-specific manual checklist if action API is unavailable.
8. Track resolution and metrics.

## PR-04 Receive a return

1. Shipment enters return status and expected-return queue.
2. Warehouse scans waybill.
3. System validates tenant/warehouse and prevents duplicate receipt.
4. Operator completes condition checklist.
5. Capture media directly with server timestamp and actor.
6. Create issue case if missing/wrong/damaged.
7. Confirm receipt and sync inventory/OMS where configured.

## PR-05 Audit a settlement

1. Freeze a period scope and approved rule versions.
2. Import source orders, carrier statements and actual shop contract rate.
3. Optionally import bank transactions.
4. Validate raw/control totals and promote valid revisions.
5. Match exact keys; queue ambiguity for human resolution.
6. Select effective rate/settlement rules.
7. Compute expected fee components and COD.
8. Store one processing status and zero-to-many findings.
9. Classify source-only orders into six missing states.
10. Reconcile carrier batches and optional bank allocations.
11. Create discrepancy cases where appropriate.
12. Review, close period or carry cases forward.

## PR-06 Manage a claim

1. Classify claim and select effective Claim Policy.
2. Compute deadline and evidence checklist.
3. Assemble existing evidence; identify gaps.
4. Internally verify amount and claim.
5. Submit after user confirmation or eligible policy authorization.
6. Store carrier reference/response.
7. Track full/partial acceptance, rejection, supplement and unpaid state.
8. Link actual recovery to bank evidence when available.
9. Close with recovered-full or closed-unrecovered outcome.

