# Use Cases

## Use-case template

Every implementation use case includes actor, preconditions, trigger, main flow, alternatives, validation, permissions, outputs, audit and acceptance IDs.

## UC-AUTH-01 Log in

- Actor: any registered user.
- Preconditions: active, verified account.
- Trigger: submit credentials or approved OTP.
- Main result: create scoped session and route to permitted home.
- Alternatives: MFA challenge; select organization; forced password change.
- Failures: invalid credentials, lockout, suspended account, expired invite.
- Audit: success/failure metadata without password/OTP.
- Acceptance: AC-AUTH-01.

## UC-AUTH-02 Self-register

- Actor: prospective shop owner (anonymous user).
- Preconditions: none (public access).
- Trigger: submit self-registration form (shop name, full name, email/phone, password, terms acceptance).
- Main result: atomically create new Merchant (tenant) and User with role OWNER in PENDING_VERIFICATION state; issue single-use verification token/OTP via configured channels.
- Alternatives: verification via email link; verification via phone OTP; resend verification token.
- Postconditions: upon verifying at least one channel, user transitions to ACTIVE state with verified timestamp; tenant becomes usable for onboarding (FEAT-ONB-01).
- Failures: missing required fields, weak password, unaccepted terms, duplicate verified identifier, rate limit exceeded, expired/consumed verification token.
- Audit: registration event and verification events logged with hashed IP and actor context; never log plaintext passwords, OTPs, or verification tokens.
- Acceptance: AC-AUTH-02.

## UC-USR-01 Invite and authorize a user

- Actor: SHOP_OWNER or authorized administrator.
- Preconditions: actor may manage users in the target scope.
- Main flow: enter identity → assign roles/scopes → send invite → recipient verifies and accepts.
- Rules: cannot remove the last owner; cannot grant permissions the actor does not possess.
- Audit: invite, resend, role/scope change, revoke.
- Acceptance: AC-USR-01.

## UC-SHIP-01 Find shipping options

- Actor: ORDER_OPERATOR.
- Preconditions: valid source order, parcel, warehouse and at least one active account.
- Main flow: normalize address → serviceability → quote → normalized option list.
- Alternatives: unsupported route, partial carrier outage, stale quote.
- Output: candidate list with evidence status, price, SLA and reasons.
- Acceptance: AC-AVL-01 and AC-QTE-01.

## UC-SHIP-02 Select a carrier

- Actor: ORDER_OPERATOR or approved routing policy.
- Main flow: calculate ranking → explain → choose → persist decision.
- Rules: exclude unavailable/unknown accounts from automatic selection; human may choose only an AVAILABLE candidate.
- Audit: candidate data, algorithm version, chosen option and override reason.
- Acceptance: AC-SEL-01.

## UC-SHIP-03 Create a shipment

- Actor: ORDER_OPERATOR.
- Preconditions: selected unexpired quote or explicitly refreshed quote; action permission.
- Main flow: validate → create idempotency record → call adapter → reconcile response → store waybill.
- Unknown outcome: query by client reference; do not blindly call create again.
- Output: shipment/waybill or actionable failure.
- Acceptance: AC-SHP-01.

## UC-SHIP-04 Print labels and request pickup

- Actor: ORDER_OPERATOR or WAREHOUSE_OPERATOR.
- Preconditions: shipment created; label/pickup capability.
- Main flow: retrieve/generate label → select printer/format → print → request pickup window.
- Failure: carrier label unavailable uses documented carrier-compliant fallback only.
- Acceptance: AC-LBL-01.

## UC-TRK-01 Track a shipment

- Actor: system, shop users and protected recipient.
- Main flow: ingest event → verify → dedupe → canonicalize → update current state → notify.
- Unknown status: preserve raw, mark mapping required, do not guess.
- Acceptance: AC-TRK-01.

## UC-EXC-01 Resolve a delivery exception

- Actor: OPS_MANAGER, CUSTOMER_SERVICE or authorized operator.
- Main flow: detect → prioritize → assign → contact/checklist → redelivery/manual action → monitor → resolve.
- Rules: external command requires idempotency and permission.
- Acceptance: AC-EXC-01.

## UC-RET-01 Receive a returned parcel

- Actor: WAREHOUSE_OPERATOR.
- Main flow: scan → validate → checklist → direct evidence → issue case if necessary → confirm.
- Rules: duplicate receipt blocked; evidence metadata immutable.
- Acceptance: AC-RET-01.

## UC-RATE-01 Create and approve a rate version

- Actor: RATE_AUTHOR and RATE_REVIEWER.
- Main flow: upload source → normalize rules/citations → simulate → submit → approve/reject.
- Rules: maker cannot approve; ambiguity is explicit; approved version immutable.
- Acceptance: AC-RATE-01.

## UC-AUD-01 Run settlement audit

- Actor: FINANCE or SHIPDE_OPERATOR with access.
- Main flow: validate sources → freeze snapshot → match → calculate → find → summarize.
- Rules: no fuzzy auto-match; no conclusion without required evidence; findings are multi-valued.
- Acceptance: AC-AUD-01.

## UC-BNK-01 Allocate bank receipt

- Actor: FINANCE.
- Main flow: exact-reference match or review suggestion → allocate amounts → validate totals → confirm.
- Rules: many-to-many; total allocation cannot exceed transaction amount.
- Acceptance: AC-BNK-01.

## UC-CLM-01 Submit and track a claim

- Actor: FINANCE/SHOP_OWNER or authorized automation.
- Main flow: classify → deadline → evidence → approval/policy → submit → monitor outcome.
- Rules: deadline policy versioned; automatic submission must satisfy all guardrails.
- Acceptance: AC-CLM-01.
