# Master Feature Catalog

All features below are in the target product. Build order is a dependency sequence, not an instruction to discard later modules.

## 1. Identity and organization

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-AUTH-01 | Self-registration | Email/phone verification, terms acceptance, anti-abuse |
| FEAT-AUTH-02 | Admin-created shop account | Operator can create initial owner without public signup |
| FEAT-AUTH-03 | Login | Password or configured OTP; disabled/unverified states handled |
| FEAT-AUTH-04 | Password recovery | Expiring one-time reset; revoke previous sessions |
| FEAT-AUTH-05 | MFA | Setup, verify, recovery and admin reset |
| FEAT-AUTH-06 | Session management | List/revoke sessions, inactivity expiry, logout all |
| FEAT-USR-01 | User invitations | Send, resend, cancel, accept and expire |
| FEAT-USR-02 | User lifecycle | Create, edit, activate, suspend, revoke sessions |
| FEAT-RBAC-01 | Roles and permissions | Default/custom roles with resource/action scopes |
| FEAT-RBAC-02 | Scope assignment | Shop, branch, warehouse and carrier-account scope |
| FEAT-ORG-01 | Shop profile | Legal, billing and operating defaults |
| FEAT-ORG-02 | Branches | CRUD, activate/deactivate and reporting scope |
| FEAT-WH-01 | Warehouses | Pickup/return address, schedule, contacts and printer defaults |
| FEAT-ONB-01 | Guided onboarding | Shop → warehouse → user → carrier → test quote/order |
| FEAT-PRO-01 | Personal profile | Contact, language/timezone, defaults and notification preferences |

## 2. Shared platform

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-COM-01 | Global search | Orders, waybills, batches, cases and transactions |
| FEAT-COM-02 | Lists | Filter, sort, pagination, saved views and column settings |
| FEAT-COM-03 | Bulk actions | Permission-aware, progress and partial failure report |
| FEAT-COM-04 | Imports | Template, preview, row errors, checksum and revisions |
| FEAT-COM-05 | Exports | Permission-aware CSV/XLSX/PDF with generation metadata |
| FEAT-COM-06 | Attachments | Private upload, hash, access audit and retention |
| FEAT-COM-07 | Activity timeline | Actor, time, before/after and correlation ID |
| FEAT-COM-08 | Draft recovery | Preserve user input after timeout/session expiry |
| FEAT-COM-09 | Notification center | In-app/email, unread, severity, dedupe and deep link |
| FEAT-SUP-01 | Support requests | Context links, attachments, status and consented support access |

## 3. Carrier accounts and configuration

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-CAR-01 | Carrier catalog | Carrier/service/canonical status and fee taxonomy |
| FEAT-CAR-02 | Account connection | Multiple shop-owned accounts, encrypted credentials |
| FEAT-CAR-03 | Permission profiles | Observe and action permissions separated |
| FEAT-CAR-04 | Connection test | Authentication and granted capability discovery |
| FEAT-CAR-05 | Credential lifecycle | Expiry, revoke, rotate and no-secret logging |
| FEAT-CAR-06 | Capability registry | Per account and environment, evidence level included |
| FEAT-CAR-07 | Connector health | Availability, latency, error and data freshness |
| FEAT-CAR-08 | Failure isolation | One carrier/account does not block another |
| FEAT-CAR-09 | Manual/file fallback | Explicit when API is unavailable or unsupported |

## 4. Orders, addresses and quotes

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-SRC-01 | Manual source order | Sender, recipient, items, parcel, COD, payer and notes |
| FEAT-SRC-02 | OMS/file import | Idempotent order ingestion with lineage |
| FEAT-SRC-03 | Order validation | Required values, prohibited goods acknowledgment and duplicate checks |
| FEAT-ADR-01 | Address normalization | Canonical administrative codes with user confirmation |
| FEAT-ADR-02 | Carrier address mapping | Canonical-to-carrier identifiers, versioned |
| FEAT-AVL-01 | Serviceability | Route, service, parcel, COD and restricted-goods eligibility |
| FEAT-AVL-02 | No-option recovery | Explain reasons, edit input, retry, save draft or manual carrier |
| FEAT-QTE-01 | Parallel live quote | Query eligible connected accounts with timeout isolation |
| FEAT-QTE-02 | Normalized quote | Components, VAT, SLA, pickup window and expiry |
| FEAT-QTE-03 | Quote snapshot | Immutable chosen request/response and evidence metadata |
| FEAT-SEL-01 | Comparison | Cheapest, fastest, balanced and historical performance |
| FEAT-SEL-02 | Explainable recommendation | Shop-configurable weights and reason display |
| FEAT-SEL-03 | Auto-routing | Policy selection with deterministic fallback and override |

## 5. Shipment, pickup and labels

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-SHP-01 | Shipment draft | Versioned draft linked to source order |
| FEAT-SHP-02 | Create shipment | Idempotent command; unknown outcome reconciled before retry |
| FEAT-SHP-03 | Bulk creation | Per-row outcome; no all-or-nothing ambiguity |
| FEAT-SHP-04 | Manual waybill link | For carrier portal/manual creation with audit |
| FEAT-SHP-05 | Update shipment | Capability/status constrained; requote when price-affecting |
| FEAT-SHP-06 | Cancel shipment | Confirmation, carrier state reconciliation and source sync |
| FEAT-SHP-07 | Switch carrier | Only before pickup/handover unless an approved exception flow exists |
| FEAT-PUP-01 | Pickup request | Shift/window, batch grouping and status |
| FEAT-PUP-02 | Pickup handover | Expected vs handed-over parcel evidence |
| FEAT-LBL-01 | Label retrieval/generation | Carrier label or approved normalized rendering |
| FEAT-LBL-02 | Print and reprint | Single/bulk, size/printer preference and audit |
| FEAT-LBL-03 | Label invalidation | Old label unusable after cancel/switch |

## 6. Tracking, recipient and exceptions

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-TRK-01 | Webhook ingestion | Signature, dedupe, raw preservation and replay safety |
| FEAT-TRK-02 | Polling/backfill | For missing webhooks and initial history |
| FEAT-TRK-03 | Canonical tracking | Versioned mapping; unknown raw status preserved |
| FEAT-TRK-04 | Timeline/current state | Event history plus derived current state and freshness |
| FEAT-RECIP-01 | Protected tracking page | Signed link or OTP, minimum necessary data |
| FEAT-RECIP-02 | Recipient action | Reschedule/instructions only if carrier capability allows |
| FEAT-EXC-01 | Exception detection | Slow pickup, stuck, delivery failure and return risk |
| FEAT-EXC-02 | Prioritized workbox | COD value, age, attempts and SLA |
| FEAT-EXC-03 | Task workflow | Assign, acknowledge, snooze, note, resolve and reopen |
| FEAT-EXC-04 | Redelivery | Confirmed/idempotent carrier command or manual checklist |
| FEAT-EXC-05 | Outcome metrics | Rescue success, time and prevented return |

## 7. Returns

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-RET-01 | Expected returns | Queue from tracking/canonical status |
| FEAT-RET-02 | Scan receipt | Duplicate prevention and ownership validation |
| FEAT-RET-03 | Condition checklist | Package/seal/item/quantity/damage |
| FEAT-RET-04 | Direct evidence capture | Original media, server time, actor, waybill and checksum |
| FEAT-RET-05 | Chain of custody | Handover and access history |
| FEAT-RET-06 | Return issue case | Missing/wrong/damaged goods create discrepancy evidence |

## 8. Rate, policy and import governance

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-RATE-01 | Contract documents | Private source files with page/clause references |
| FEAT-RATE-02 | Structured rate rules | Service, zone, weight, rounding, VAT and components |
| FEAT-RATE-03 | Maker-checker approval | Author cannot approve own version |
| FEAT-RATE-04 | Effective version selection | Date basis and non-overlapping approved coverage |
| FEAT-RATE-05 | Rate simulator/explanation | Test examples and reproducible calculation |
| FEAT-SET-01 | Settlement policy | Eligibility, batch schedule, holidays and transfer lag |
| FEAT-SET-02 | Threshold/carry-forward | Account-level, not per-waybill |
| FEAT-CLP-01 | Claim policy | Category, source, deadline and evidence version |
| FEAT-IMP-01 | Raw immutable import | Hash, metadata, revision and lineage |
| FEAT-IMP-02 | Staging validation | Blocking vs non-blocking errors; no silent loss |
| FEAT-IMP-03 | Source order import | Canonical fields and quality metrics |
| FEAT-IMP-04 | Carrier statement import | Fee components, batch and totals |
| FEAT-IMP-05 | Bank statement import | Inbound transactions, privacy and dedupe |

## 9. Matching and audit

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-MAT-01 | Primary exact match | Carrier account + normalized waybill |
| FEAT-MAT-02 | Secondary exact match | Source order ID only if one unique candidate |
| FEAT-MAT-03 | Manual match queue | Link/unlink with reason and audit |
| FEAT-MAT-04 | Processing status | matched/source-only/carrier-only/ambiguous/data-incomplete |
| FEAT-AUD-01 | Expected fee calculation | Approved rate version and component-by-component result |
| FEAT-AUD-02 | COD discrepancy | Expected source COD vs carrier COD |
| FEAT-AUD-03 | Fee discrepancy | Freight, insurance, return, VAT and surcharges |
| FEAT-AUD-04 | Weight findings | Suspected weight vs rate discrepancy kept separate |
| FEAT-AUD-05 | Duplicate deductions | Preserve line ledger and detect abnormal repetition |
| FEAT-AUD-06 | Late-delivery candidate | Suspicion only unless verified policy/cause evidence |
| FEAT-AUD-07 | Multiple findings | Zero-to-many per waybill, each explainable |
| FEAT-AUD-08 | Immutable runs | Snapshot inputs/rules; rerun creates a new run |
| FEAT-MIS-01 | Missing statement classification | Six states based on predicted milestones A/B/C |
| FEAT-MIS-02 | Re-evaluation | Time/data/policy changes recompute without losing history |

## 10. Settlement, bank, cases and claims

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-BAT-01 | Settlement periods/batches | Period→batches→waybills with control totals |
| FEAT-BAT-02 | Dual batch status | Carrier reported transfer and bank match are independent |
| FEAT-BAT-03 | Period close/reopen | Immutable close; controlled reopen/adjustment |
| FEAT-BNK-01 | Exact-reference match | Exact batch reference may auto-match |
| FEAT-BNK-02 | Suggested match | Amount/date/counterparty requires human confirmation |
| FEAT-BNK-03 | Many-to-many allocation | Amount on each link; allocation constraints |
| FEAT-COD-01 | COD ledger | Expected, carrier reported and bank received |
| FEAT-CAS-01 | Finding case | Evidence, assignment, notes and timeline |
| FEAT-CAS-02 | Four money levels | Suspected/verified/accepted/received separately |
| FEAT-CAS-03 | Outcome workflow | Full/partial accept, reject, supplement, unpaid and recovery installments |
| FEAT-CAS-04 | Carry-forward | Independent case-to-period relation |
| FEAT-CLM-01 | Deadline calculation | Versioned policy and correct trigger event |
| FEAT-CLM-02 | Evidence checklist/package | Auto-assemble available evidence |
| FEAT-CLM-03 | Claim submission modes | Confirm-first or policy-authorized automatic |
| FEAT-CLM-04 | Claim tracking | Reference, responses, supplements, outcome and aging |

## 11. Reporting, billing and administration

| ID | Feature | Key behavior |
|---|---|---|
| FEAT-DASH-01 | Role dashboard | Today’s work and outcome metrics |
| FEAT-DASH-02 | Carrier performance | Cost, SLA, success, exception and return |
| FEAT-DASH-03 | Audit dashboard | Data quality, statuses, findings and four money levels |
| FEAT-DASH-04 | Batch/COD dashboard | Carrier report vs bank evidence |
| FEAT-REP-01 | Drill-down reports | Summary to source row/rule/evidence |
| FEAT-BIL-01 | Billable event | One event at first conclusive audit |
| FEAT-BIL-02 | Usage statement | Explainable per-waybill ledger and adjustments |
| FEAT-ADM-01 | Reference/config management | Carriers, services, fees, statuses and calendars |
| FEAT-ADM-02 | Job/queue operations | Inspect, retry safely and dead-letter recovery |
| FEAT-ADM-03 | Audit log | Immutable actor/action/resource/change history |
| FEAT-SEC-01 | Privacy controls | Minimize, mask, export, retain and delete |
| FEAT-SEC-02 | Support access | Tenant-approved, time-bound and audited |

