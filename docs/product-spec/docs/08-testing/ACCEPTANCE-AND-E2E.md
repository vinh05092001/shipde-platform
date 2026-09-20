# Acceptance Criteria and End-to-End Scenarios

## Core acceptance criteria

### AC-AUTH-01

Given an active verified user with valid credentials, when login and MFA succeed, then the user enters only authorized tenant/scope; failed attempts are rate-limited and audited.

### AC-AUTH-02

Given a prospective shop owner on SCR-AUTH-02 (/register), when submitting valid shop name, owner name, email or phone, password, and accepted terms, then exactly one Merchant and User(OWNER, PENDING_VERIFICATION) are created atomically and a single-use expiring verification token is issued; when verified with a valid token, the user transitions to ACTIVE and verified timestamp is recorded; invalid inputs, duplicate verified identifiers, unaccepted terms, expired/consumed tokens, and rate-limit violations fail closed with distinct actionable errors.

### AC-USR-01

Given an owner, when inviting an operator with one warehouse/account scope, then the invite can be accepted and the operator cannot access another warehouse/account.

### AC-AVL-01

Given valid shipment inputs, when carriers respond supported/rejected/timeout, then UI shows AVAILABLE/UNSUPPORTED/UNKNOWN_ERROR respectively and never converts timeout to unsupported.

### AC-QTE-01

Given at least two available quotes, when displayed, then all fee components, total, VAT state, SLA and expiry are normalized and raw snapshots remain traceable.

### AC-SEL-01

Given eligible options, when recommendation runs, then cheapest uses total fee, fastest uses comparable SLA, balanced exposes score, and manual override is recorded.

### AC-SHP-01

Given a valid selected quote, when create times out after reaching the carrier, then Ship Dễ reconciles by client reference and produces at most one waybill.

### AC-LBL-01

Given a created shipment, when label is printed and the shipment is cancelled/switched, then the old label is marked invalid and cannot be used in normal operations.

### AC-TRK-01

Given duplicate/out-of-order/unknown tracking events, when ingested, then raw events are preserved, duplicates do not duplicate transition, order is handled and unknown status is not guessed.

### AC-EXC-01

Given a delivery failure, when an authorized user requests redelivery twice with the same idempotency key, then only one external action is recorded; unsupported API produces a manual checklist.

### AC-RET-01

Given an expected return, when scanned twice, then the second receipt is blocked; direct evidence is linked to actor, server time, waybill and original hash.

### AC-RATE-01

Given a draft rate authored by A, when A tries to approve it, then approval is denied; reviewer B may approve after source and simulator validation.

### AC-AUD-01

Given matched, source-only, carrier-only, ambiguous and incomplete records, when audit runs, then each has exactly one processing status and zero-to-many separate findings with lineage.

### AC-BNK-01

Given one bank transaction allocated across multiple batches, when allocations exceed the transaction, then confirmation is rejected; exact-reference and suggestion states are distinguishable.

### AC-CLM-01

Given complete evidence and verified policy, when auto-submit is disabled, then claim waits for confirmation; when enabled within limit it submits once; expired/incomplete claims never auto-submit.

### AC-ADMIN-01

Given a valid platform admin key, when creating a shop with email and password, then 201 is returned with a new Merchant and User(role=OWNER, status=ACTIVE) where email_verified_at is pre-set and the password is stored as a scrypt hash.

### AC-ADMIN-02

Given a valid platform admin key, when creating a shop with phone only (no email), then 201 is returned with User.email=null, phone_verified_at pre-set, and the merchant is ACTIVE.

### AC-ADMIN-03

Given a valid platform admin key, when creating a shop without specifying a password, then 201 is returned with a `temporary_password` field containing a 16-character random string; the stored password_hash is a valid scrypt hash.

### AC-ADMIN-04

Given a valid platform admin key, when creating a shop with missing or short (<2 chars) merchant_name, then 400 VALIDATION_ERROR is returned with field-level error on `merchant_name`.

### AC-ADMIN-05

Given a valid platform admin key, when creating a shop without email and without phone, then 400 VALIDATION_ERROR is returned requiring at least one identifier.

### AC-ADMIN-06

Given a valid platform admin key, when creating a shop with an invalid email format, then 400 VALIDATION_ERROR with code INVALID_FORMAT is returned on `owner_email`.

### AC-ADMIN-07

Given a valid platform admin key, when creating a shop with an invalid phone format, then 400 VALIDATION_ERROR with code INVALID_FORMAT is returned on `owner_phone`.

### AC-ADMIN-08

Given a valid platform admin key, when creating a shop with an email that belongs to an existing ACTIVE user, then 400 VALIDATION_ERROR with code DUPLICATE is returned on `owner_email` and no new rows are created.

### AC-ADMIN-09

Given a valid platform admin key, when creating a shop with a phone that belongs to an existing ACTIVE user, then 400 VALIDATION_ERROR with code DUPLICATE is returned on `owner_phone` and no new rows are created.

### AC-ADMIN-10

Given no `X-Platform-Admin-Key` header, when calling POST /admin/shops, then 403 FORBIDDEN is returned.

### AC-ADMIN-11

Given an invalid `X-Platform-Admin-Key` header, when calling POST /admin/shops, then 403 FORBIDDEN is returned.

### AC-ADMIN-12

Given a valid admin key, when merchant creation fails after User creation (e.g. constraint violation), then the entire transaction is rolled back; no orphan Merchant or User rows persist.

### AC-ADMIN-13

Given a successful shop creation, when checking the audit_logs table, then an `ADMIN_CREATE_SHOP` record exists with correct merchant_id, user_id, identifiers, ip_address and correlation data; the record is immutable.

### AC-ADMIN-14

Given a valid admin key, when calling GET /admin/shops, then 200 is returned with a paginated list of merchants including their owner's id, full_name, email, phone and status.

### AC-ADMIN-15

Given a shop creation with a provided password, when querying the database, then the password_hash column contains a scrypt-format hash and no plaintext password appears in logs or response (except the temporary_password field when auto-generated).

### AC-ADMIN-16

Given a shop creation with both email and phone, when querying the created User, then both email_verified_at and phone_verified_at are set to non-null timestamps immediately, and status is ACTIVE.

## End-to-end scenarios

### E2E-01 Happy shipping

Register → shop/warehouse → carrier → order → serviceability → quote → select → create → label → pickup → tracking → delivered → statement → clean audit.

### E2E-02 No carrier option

Invalid/unsupported route → show reasons → edit ward/parcel → retry without re-entry → obtain option or save manual draft.

### E2E-03 Partial carrier incident

GHN timeout while GHTK succeeds → display GHTK option and GHN unknown incident → selection/create proceeds without global outage.

### E2E-04 Unknown create outcome

Create timeout → command unknown → remote lookup finds waybill → one local shipment confirmed; no second create.

### E2E-05 Delivery rescue

Delivery failure webhook → exception priority → CS notes → redelivery → delivered → rescue metric.

### E2E-06 Return issue

Returning → expected queue → scan → damage evidence → case → claim package.

### E2E-07 Fee discrepancy

Approved contract → statement fee higher → matched processing status plus fee finding → internal verify → claim → carrier accepts → bank recovery.

### E2E-08 Missing COD

Source-only delivered order progresses through A/B/C → account threshold checked → overdue suspicion → case; no early false alert.

### E2E-09 Bank many-to-many

Two transactions fund one batch and one transaction funds another batch → allocations confirmed → batch statuses full/short as calculated.

### E2E-10 Tenant attack

User changes resource UUID to another tenant → backend returns not-found/forbidden without leaking metadata; event audited.
