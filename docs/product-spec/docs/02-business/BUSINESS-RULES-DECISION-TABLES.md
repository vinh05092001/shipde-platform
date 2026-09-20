# Business Rules and Decision Tables

## Authentication and Self-registration

- BR-AUTH-01: Registration requires merchant/shop name, owner full name, at least one valid identifier (email or phone), password satisfying policy BR-AUTH-05, and explicit terms acceptance (BR-AUTH-04). Missing required fields return VALIDATION_ERROR with field-level details.
- BR-AUTH-02: New registrations start in PENDING_VERIFICATION state. An account cannot log in until at least one contact channel (email or phone) is verified. Verifying a second channel is optional but tracked.
- BR-AUTH-03: Email and phone are globally unique across the platform. An already-verified identifier returns a field-level VALIDATION_ERROR. Submitting an identifier with an existing unverified account re-issues a new verification token rather than creating duplicate rows.
- BR-AUTH-04: Terms of service and privacy policy acceptance is mandatory. Terms version and timestamp are permanently recorded with the user.
- BR-AUTH-05: Passwords must be at least 8 characters and hashed with a memory-hard algorithm (scrypt/argon2). Plaintext passwords must never be logged or returned.
- BR-AUTH-06: Verification tokens and OTPs are single-use with bounded expiration (15 minutes for OTP, 24 hours for email token). Consumed or expired tokens return an explicit error.
- BR-AUTH-07: Registration attempts are rate-limited per IP (max 5/hour) and per identifier (max 3/hour). Exceeding the threshold returns RATE_LIMITED with retry-after hint.
- BR-AUTH-08: Resend verification is bounded by a dedicated rate limit (1 request per 60 seconds cooldown, max 5/hour per identifier).
- BR-AUTH-09: All registration, verification, and rate-limit events produce immutable audit records containing actor context and hashed IP without leaking passwords or verification tokens.
- BR-AUTH-10: Concurrent submissions with the same unverified identifier must resolve idempotently; exactly one tenant/owner pair persists.
- BR-AUTH-11: Admin shop creation requires a valid `x-operator-token` header matching the server-side `OPERATOR_SECRET`. Missing token returns 401 UNAUTHORIZED; invalid token returns 403 FORBIDDEN. This endpoint bypasses public self-registration rate limits.
- BR-AUTH-12: Admin-created accounts start directly in ACTIVE status. The provided email or phone is marked as verified (`email_verified_at` / `phone_verified_at` populated) at creation time, bypassing the PENDING_VERIFICATION state used in FEAT-AUTH-01.
- BR-AUTH-13: Admin creation requires merchant_name (min 2 chars), full_name (min 2 chars), password (min 8 chars), and at least one of email or phone. Terms acceptance is implicit for operator-created accounts. Validation errors return 400 with field-level details.
- BR-AUTH-14: Duplicate email or phone on admin creation returns 400 VALIDATION_ERROR with field code DUPLICATE, identical to self-registration conflict behavior.

### Self-registration decision

| Identifier status | Terms accepted | Password valid | Rate limit  | Result                             | Next action                       |
| ----------------- | -------------- | -------------- | ----------- | ---------------------------------- | --------------------------------- |
| New / Available   | Yes            | Yes            | Under limit | 201 Created (PENDING_VERIFICATION) | Send verification token           |
| Already verified  | Yes            | Yes            | Under limit | 400 VALIDATION_ERROR (Conflict)    | Show duplicate error + login link |
| Exists unverified | Yes            | Yes            | Under limit | 200 Re-issued verification         | Resend verification token         |
| Any               | No             | Any            | Any         | 400 VALIDATION_ERROR               | Prompt terms acceptance           |
| Any               | Yes            | No (<8 chars)  | Any         | 400 VALIDATION_ERROR               | Prompt valid password             |
| Any               | Any            | Any            | Exceeded    | 429 RATE_LIMITED                   | Display cooldown window           |

## Address and availability

- BR-ADR-01: Canonical administrative address must be confirmed when normalization has multiple candidates.
- BR-AVL-01: Carrier response AVAILABLE is valid only for the exact account, origin, destination, parcel, service and COD inputs.
- BR-AVL-02: Timeout, authentication error and provider outage produce UNKNOWN_ERROR, never UNSUPPORTED.
- BR-AVL-03: An automatic routing policy may select only AVAILABLE and unexpired options.

### Serviceability decision

| Carrier response                | Input valid | Result                  | User action      |
| ------------------------------- | ----------: | ----------------------- | ---------------- |
| Supported services returned     |         Yes | AVAILABLE               | Quote            |
| Explicit route/parcel rejection |         Yes | UNSUPPORTED             | Show reason/edit |
| Timeout/5xx                     |         Yes | UNKNOWN_ERROR           | Retry/manual     |
| Authentication/permission error |         Yes | ACCOUNT_ACTION_REQUIRED | Fix connection   |
| Input invalid                   |          No | INPUT_REQUIRED          | Correct fields   |

## Quote and recommendation

- BR-QTE-01: Quote components are normalized but raw response remains immutable.
- BR-QTE-02: A changed price-affecting input invalidates existing quotes.
- BR-QTE-03: A selected expired quote must be refreshed before create.
- BR-SEL-01: Cheapest uses total payable cost, not base fee alone.
- BR-SEL-02: Recommendation score and inputs are stored and explainable.
- BR-SEL-03: Historical performance may influence ranking only after minimum sample/configuration; it cannot create availability.

## Shipment commands

- BR-IDEM-01: Create idempotency key is tenant + source order + attempt lineage.
- BR-IDEM-02: A retry after timeout must first query remote state using client order reference.
- BR-SHP-01: Update/cancel/switch actions are constrained by canonical and carrier-specific status.
- BR-SHP-02: A price-affecting update triggers serviceability/requote and requires confirmation.
- BR-LBL-01: Cancel/switch invalidates prior label for operational use.

### Create command decision

| Local command         | Carrier response        | Remote lookup                                 | Next action                           |
| --------------------- | ----------------------- | --------------------------------------------- | ------------------------------------- |
| New                   | Success with waybill    | Not needed                                    | Confirm created                       |
| New                   | Explicit business error | Not needed                                    | Fail with action                      |
| New                   | Timeout/connection loss | Found by client reference                     | Confirm created                       |
| New                   | Timeout/connection loss | Not found after bounded reconciliation window | Retry same idempotency lineage        |
| Existing completed    | Any duplicate request   | Existing waybill                              | Return existing result                |
| Unknown beyond policy | Unknown                 | Unknown                                       | Manual reconciliation; no blind retry |

## Tracking and exceptions

- BR-TRK-01: Raw event ledger is append-only.
- BR-TRK-02: Duplicate provider event does not create a second domain transition.
- BR-TRK-03: Unknown carrier status remains raw and enters mapping work queue.
- BR-EXC-01: Exception priority considers COD, age, attempts, SLA and return risk.
- BR-EXC-02: Redelivery requires action permission, confirmation/policy and idempotency.

## Rate and audit

- BR-RATE-01: Only approved effective rules can declare a carrier charge wrong.
- BR-RATE-02: Unapproved/ambiguous rules produce suspected or data-incomplete results.
- BR-AUD-01: Compare each fee component; matching totals do not hide offsetting component errors.
- BR-AUD-02: Missing data affects only checks requiring that data.
- BR-AUD-03: One waybill has exactly one processing status and zero-to-many findings.
- BR-AUD-04: Carrier weight greater than shop weight is suspected weight; rate discrepancy uses carrier weight and still finds incorrect charge.
- BR-AUD-05: Late-delivery fee waiver is only suspected until policy and causal exclusions are verified.

## Missing statement classification

Milestones are predicted from Settlement Policy:

- A: expected eligibility.
- B: next expected batch close.
- C: expected carrier transfer.

| Condition                                           | Classification                |
| --------------------------------------------------- | ----------------------------- |
| Before A                                            | NOT_ELIGIBLE                  |
| A ≤ now < B                                         | ELIGIBLE_WAITING_BATCH        |
| B ≤ now < C                                         | BATCH_CLOSED_WAITING_TRANSFER |
| now ≥ C, no statement line, no valid exclusion      | OVERDUE_MISSING_COD_SUSPECTED |
| Account-level threshold/carry rule proves exclusion | VALID_EXCLUSION               |
| Any required milestone cannot be calculated         | DATA_INCOMPLETE               |

BR-MIS-01: Minimum remittance threshold is evaluated at account/batch aggregate plus opening carry-forward, never each waybill independently.

## Batch and bank

- BR-BAT-01: Carrier transfer status and bank reconciliation status are independent.
- BR-BNK-01: Exact batch reference may auto-match; amount/date/counterparty alone is suggestion-only.
- BR-BNK-02: Many-to-many links require allocated amount.
- BR-BNK-03: Sum allocated from a transaction cannot exceed its amount.
- BR-BNK-04: Actually received/recovered amount requires bank/payment evidence.

## Cases and claims

- BR-CAS-01: Each finding has a separate case unless an explicit merge rule is later approved.
- BR-CAS-02: Suspected, internally verified, carrier accepted and actually received values remain separate.
- BR-CAS-03: Carry-forward is independent of case status.
- BR-CLM-01: Claim deadline uses an effective, sourced policy and correct trigger event; legal periods are not hardcoded without current verification.
- BR-CLM-02: Automatic submission requires shop opt-in, eligible claim type, verified rules, complete evidence, monetary limit, unexpired deadline and idempotency.

### Claim submission decision

| Complete evidence | Policy verified | Within deadline | Auto enabled/limit | Result                          |
| ----------------: | --------------: | --------------: | -----------------: | ------------------------------- |
|                No |             Any |             Any |                Any | NEEDS_EVIDENCE                  |
|               Yes |              No |             Any |                Any | MANUAL_REVIEW                   |
|               Yes |             Yes |              No |                Any | EXPIRED_DO_NOT_PROMISE_RECOVERY |
|               Yes |             Yes |             Yes |                 No | READY_FOR_CONFIRMATION          |
|               Yes |             Yes |             Yes |                Yes | AUTO_SUBMIT_ELIGIBLE            |

## Billing

- BR-BIL-01: Bill once at first conclusive audit using tenant + carrier account + waybill.
- BR-BIL-02: No billing for not-eligible or data-incomplete.
- BR-BIL-03: Rerun, revision, carry-forward and claim follow-up do not rebill.
