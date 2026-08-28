# Data Dictionary

This dictionary lists high-value fields. Machine schema and migrations must expand it without changing semantics.

## Tenant and user

| Entity.field          | Type   |    Required | Notes                                    |
| --------------------- | ------ | ----------: | ---------------------------------------- |
| Tenant.id             | UUID   |         Yes | Isolation key                            |
| Tenant.name           | string |         Yes | Display name                             |
| User.id               | UUID   |         Yes | Platform identity                        |
| User.email/phone      | string | Conditional | At least one verified login identifier   |
| User.status           | enum   |         Yes | INVITED/ACTIVE/SUSPENDED/DISABLED        |
| Membership.tenant_id  | UUID   |         Yes | Never inferred from client payload alone |
| Membership.scope_json | JSON   |         Yes | Branch/warehouse/carrier-account scope   |

## Carrier account

| Entity.field                        | Type        | Required | Notes                                         |
| ----------------------------------- | ----------- | -------: | --------------------------------------------- |
| CarrierAccount.carrier_code         | enum/string |      Yes | GHN/GHTK/VTP/JT/custom                        |
| CarrierAccount.external_account_ref | string      |      Yes | Encrypted/limited display if sensitive        |
| CarrierAccount.status               | enum        |      Yes | DRAFT/TESTING/ACTIVE/DEGRADED/EXPIRED/REVOKED |
| CarrierAccount.permission_profile   | enum        |      Yes | OBSERVE/ACTION                                |
| CredentialVersion.secret_ref        | string      |      Yes | Reference to secret store, never token text   |
| CarrierCapability.capability        | enum        |      Yes | SERVICEABILITY/QUOTE/CREATE/...               |
| CarrierCapability.evidence_level    | enum        |      Yes | Official/partner/community/unverified         |

## Source order and parcel

| Entity.field                             | Type      |    Required | Notes                                    |
| ---------------------------------------- | --------- | ----------: | ---------------------------------------- |
| SourceOrder.source_system                | string    |         Yes | MANUAL/PANCAKE/...                       |
| SourceOrder.source_order_code            | string    |         Yes | Unique within tenant/source              |
| SourceOrder.status_as_of                 | timestamp | Conditional | Required for freshness-sensitive rules   |
| SourceOrder.expected_cod_vnd             | integer   |         Yes | >= 0                                     |
| SourceOrder.fee_payer                    | enum      |         Yes | SHOP/RECIPIENT/OTHER                     |
| Parcel.weight_gram                       | integer   |         Yes | > 0                                      |
| Parcel.length_cm/width_cm/height_cm      | integer   | Conditional | Required by carrier/rate when volumetric |
| Parcel.declared_value_vnd                | integer   |         Yes | >= 0                                     |
| Address.canonical_province/district/ward | string    |         Yes | User-confirmed if ambiguous              |
| Address.line1                            | string    |         Yes | PII; masked by permission                |

## Quote

| Entity.field                      | Type      |    Required | Notes                                                       |
| --------------------------------- | --------- | ----------: | ----------------------------------------------------------- |
| QuoteRequest.input_hash           | string    |         Yes | Address/parcel/service/COD version                          |
| CarrierQuote.availability         | enum      |         Yes | AVAILABLE/UNSUPPORTED/UNKNOWN_ERROR/ACCOUNT_ACTION_REQUIRED |
| CarrierQuote.total_fee_vnd        | integer   | Conditional | Required when AVAILABLE                                     |
| CarrierQuote.components_json      | JSON      |         Yes | Normalized fee components                                   |
| CarrierQuote.raw_response_ref     | string    |         Yes | Immutable evidence                                          |
| CarrierQuote.expires_at           | timestamp | Conditional | Provider or platform policy                                 |
| RoutingDecision.algorithm_version | string    |         Yes | HUMAN or version                                            |
| RoutingDecision.override_reason   | string    | Conditional | Required on policy override when configured                 |

## Shipment

| Entity.field                     | Type   |    Required | Notes                                   |
| -------------------------------- | ------ | ----------: | --------------------------------------- |
| Shipment.id                      | UUID   |         Yes | Ship Dễ ID                              |
| Shipment.carrier_account_id      | UUID   |         Yes | Scope                                   |
| Shipment.waybill                 | string | Conditional | Set after successful create/manual link |
| Shipment.normalized_waybill      | string | Conditional | Unique with carrier account             |
| Shipment.canonical_status        | enum   |         Yes | Derived lifecycle                       |
| Shipment.selected_quote_id       | UUID   | Conditional | Required for API-created shipment       |
| ShipmentCommand.idempotency_key  | string |         Yes | Unique within tenant/command type       |
| ShipmentCommand.outcome          | enum   |         Yes | PENDING/SUCCEEDED/FAILED/UNKNOWN        |
| TrackingEvent.provider_event_key | string | Conditional | Dedupe key                              |
| TrackingEvent.raw_status         | string |         Yes | Never discarded                         |
| TrackingEvent.canonical_status   | enum   | Conditional | Null if unmapped                        |

## Audit and settlement

| Entity.field                              | Type    |        Required | Notes                                          |
| ----------------------------------------- | ------- | --------------: | ---------------------------------------------- |
| RateContractVersion.effective_from/to     | date    | Yes/conditional | Non-overlap for approved versions              |
| RateRule.source_clause                    | string  |             Yes | Page/clause/evidence                           |
| RateRule.approval_status                  | enum    |             Yes | DRAFT/REVIEW/APPROVED/REJECTED                 |
| SettlementPolicyVersion.opening_carry_vnd | integer |             Yes | Confirmed source                               |
| AuditRun.input_snapshot_hash              | string  |             Yes | Immutable reproducibility                      |
| ProcessingResult.status                   | enum    |             Yes | Exactly one processing status                  |
| Finding.type                              | enum    |             Yes | COD/FEE/WEIGHT/SURCHARGE/DUPLICATE/MISSING/... |
| Finding.suspected_amount_vnd              | integer |             Yes | Separate evidence level                        |
| SettlementBatch.carrier_transfer_status   | enum    |             Yes | NOT_REPORTED/REPORTED                          |
| SettlementBatch.bank_status               | enum    |             Yes | NO_DATA/UNMATCHED/FULL/SHORT/OVER              |
| BatchBankAllocation.amount_vnd            | integer |             Yes | > 0, constrained totals                        |

## Case and claim

| Entity.field                            | Type      |    Required | Notes                                 |
| --------------------------------------- | --------- | ----------: | ------------------------------------- |
| DiscrepancyCase.status                  | enum      |         Yes | State machine value                   |
| DiscrepancyCase.internally_verified_vnd | integer   |         Yes | Not carrier accepted                  |
| DiscrepancyCase.carrier_accepted_vnd    | integer   |         Yes | May be unpaid                         |
| DiscrepancyCase.received_vnd            | integer   |         Yes | Bank/payment evidence                 |
| Evidence.sha256                         | string    |         Yes | Integrity after ingestion             |
| Evidence.server_captured_at             | timestamp | Conditional | Direct capture evidence               |
| ClaimSubmission.mode                    | enum      |         Yes | CONFIRM_FIRST/AUTO_POLICY             |
| ClaimSubmission.provider_reference      | string    | Conditional | Set after provider acknowledgment     |
| RecoveryReceipt.amount_vnd              | integer   |         Yes | One of multiple installments          |
| RecoveryReceipt.bank_transaction_id     | UUID      | Conditional | Required to state bank-proven receipt |

## Data classification

- Restricted: credentials, bank statements, raw files, recipient contact/address, evidence media.
- Confidential: contracts/rates, COD, claims, billing.
- Internal: operational statuses, system logs without secrets.
- Public: published help/status content only.
