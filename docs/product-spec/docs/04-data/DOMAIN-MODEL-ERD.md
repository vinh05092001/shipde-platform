# Domain Model and ERD

## Aggregates

### Identity and tenancy

- Tenant, Shop, Branch, Warehouse.
- User, Membership, Role, Permission, UserSession, Invitation.

### Carrier and shipping

- Carrier, CarrierService, CarrierAccount, CarrierCapability, CredentialVersion.
- SourceOrder, OrderItem, Parcel.
- Address, CarrierAddressMapping.
- QuoteRequest, CarrierQuote, RoutingDecision.
- Shipment, ShipmentCommand, Label, PickupRequest.
- TrackingEvent, ShipmentCurrentState, OperationalException.
- ReturnReceipt, ReturnEvidence.

### Audit and money

- SourceFile, ImportBatch, ImportRow, ImportIssue.
- ContractDocument, RateContractVersion, RateRule.
- SettlementPolicyVersion, ClaimPolicyVersion.
- AuditPeriod, AuditRun, AuditSnapshot.
- MatchLink, ProcessingResult, Finding.
- SettlementBatch, SettlementLine.
- BankTransaction, BatchBankAllocation.
- DiscrepancyCase, CaseEvent, Evidence, ClaimSubmission, RecoveryReceipt.
- BillingEvent, UsageStatement.
- AuditEvent, Notification, SupportAccessGrant.

## Core relationships

\`\`\`mermaid
erDiagram
  TENANT ||--o{ USER_MEMBERSHIP : has
  TENANT ||--o{ SHOP : owns
  SHOP ||--o{ BRANCH : has
  BRANCH ||--o{ WAREHOUSE : has
  SHOP ||--o{ CARRIER_ACCOUNT : connects
  WAREHOUSE ||--o{ SOURCE_ORDER : originates
  SOURCE_ORDER ||--|{ ORDER_ITEM : contains
  SOURCE_ORDER ||--|{ PARCEL : packs
  SOURCE_ORDER ||--o{ QUOTE_REQUEST : requests
  QUOTE_REQUEST ||--o{ CARRIER_QUOTE : returns
  CARRIER_QUOTE ||--o| ROUTING_DECISION : selected
  SOURCE_ORDER ||--o{ SHIPMENT : fulfills
  SHIPMENT ||--o{ SHIPMENT_COMMAND : changes
  SHIPMENT ||--o{ TRACKING_EVENT : records
  SHIPMENT ||--o{ OPERATIONAL_EXCEPTION : raises
  SHIPMENT ||--o| RETURN_RECEIPT : returns
  CARRIER_ACCOUNT ||--o{ RATE_CONTRACT_VERSION : prices
  CARRIER_ACCOUNT ||--o{ SETTLEMENT_POLICY_VERSION : settles
  AUDIT_PERIOD ||--o{ AUDIT_RUN : runs
  AUDIT_RUN ||--o{ PROCESSING_RESULT : produces
  PROCESSING_RESULT ||--o{ FINDING : contains
  FINDING ||--o| DISCREPANCY_CASE : opens
  SETTLEMENT_BATCH ||--o{ SETTLEMENT_LINE : contains
  SETTLEMENT_BATCH ||--o{ BATCH_BANK_ALLOCATION : allocates
  BANK_TRANSACTION ||--o{ BATCH_BANK_ALLOCATION : allocates
  DISCREPANCY_CASE ||--o{ CASE_EVENT : history
  DISCREPANCY_CASE ||--o{ CLAIM_SUBMISSION : submits
  DISCREPANCY_CASE ||--o{ RECOVERY_RECEIPT : recovers
\`\`\`

## Modeling rules

- Every business table carries tenant_id, created_at and created_by where meaningful.
- Carrier waybill uniqueness is carrier_account_id + normalized_waybill, not global waybill.
- Raw carrier/import/event payloads are immutable and stored separately from normalized fields.
- Commands and external responses have correlation_id and idempotency_key.
- Financial values are integer VND; never floating point.
- Timestamps are UTC; business display and settlement calendar use Asia/Ho_Chi_Minh unless policy says otherwise.
- Historical snapshots reference exact rule/data versions.
- Soft delete is limited to configurable/master data. Financial, command, audit and evidence records are append-only or status-closed.

