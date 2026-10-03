# FEAT-AUTH-05 — Two-factor authentication

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `FEAT-AUTH-05` |
| Feature ID | `FEAT-AUTH-05` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `9` |
| Dependencies | `TASK-FOUND-04` — `MERGED` by PR `#13` at `9d101f4e5d9de9b880cc4311126ce8fe06de4206`; the implementation baseline also contains merged `FEAT-AUTH-01` registration/verification (PR `#14`, merge `4f32b93b18db6087559169f34eaa619cfd56da49`) and `FEAT-AUTH-03` login/session issuance (PR `#124`, merge `57a0f3c22013fa0739d99eb18fb78a5fa92feefe`) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/FEAT-AUTH-05.md`; `docs/product-spec/docs/00-control/TRACEABILITY.md`; `docs/product-spec/docs/02-business/BUSINESS-RULES-DECISION-TABLES.md`; `docs/product-spec/docs/02-business/USE-CASES.md`; `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md`; `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md`; `docs/product-spec/docs/04-data/DATA-DICTIONARY.md`; `docs/product-spec/docs/08-testing/ACCEPTANCE-AND-E2E.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/contracts/openapi.yaml`; `prisma/schema.prisma`; `prisma/migrations/**`; `apps/api/src/auth/**`; `apps/api/src/users/**`; `apps/web/src/app/settings/security/**`; `apps/web/src/components/auth/**`; `apps/web/src/components/users/**`; `apps/web/src/context/AuthContext.tsx`; `packages/config/**`; `packages/contracts/**`; `packages/testkit/**`; `infra/docker/seed.ts` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/feat-auth-05-two-factor-authentication` |
| Pull Request | `Pending` |

## Business outcome

An active Ship Dễ user can protect their account with an authenticator-app second factor, complete the second-factor challenge during login, and use a one-time recovery code when the authenticator is unavailable. Owners and finance users cannot enter the tenant application until MFA enrollment is complete. An authorized tenant administrator can reset another user's lost factor without learning its secret or recovery codes; the reset revokes the target user's sessions and leaves an immutable audit trail.

This closes the `FEAT-AUTH-05` catalog outcome — “Setup, verify, recovery and admin reset” — and completes the MFA portion of `AC-AUTH-01`. It also establishes an authentication-assurance signal that later sensitive operations can require without inventing a second MFA mechanism.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-AUTH-05`: “MFA — Setup, verify, recovery and admin reset.”
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-AUTH-01` main and alternative flows: successful login creates a scoped session; MFA challenge is an explicit alternative; invalid credentials and lockout are failures; success/failure metadata is audited without password or OTP.
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — `SCR-AUTH-01`: login includes an MFA challenge and recovery code; the shared screen contract requires loading, empty, validation, recoverable error, forbidden, submit lock, permission-aware controls and recovery behavior.
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — “Manage users/roles” grants Owner full access and Ops manager/Ship Dễ operator only scoped access; backend authorization is authoritative; sensitive actions require a fresh session or step-up authentication when configured.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — MFA/step-up is required for owners, finance and sensitive operations; OTP/auth routes are rate-limited; credentials are encrypted at rest; password, OTP and token values are prohibited from logs; security/audit events are immutable.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — `/auth` owns MFA and login; `/me` owns user preferences/sessions; `/users` owns user administration; bearer identity and tenant membership are server-derived; APIs use the canonical error envelope.
- `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` — `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT` and `RATE_LIMITED` semantics; same-state conflicts must be refetched rather than silently overwritten.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — `User`, `Membership` and `UserSession` identity boundaries; restricted credentials must not be exposed; tenant identity is never inferred from a client payload.
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — identity aggregate contains `User`, `Membership`, `Role`, `Permission` and `UserSession`; business tables carry tenant and actor metadata where meaningful; timestamps are UTC.
- `docs/product-spec/docs/08-testing/ACCEPTANCE-AND-E2E.md` — `AC-AUTH-01`: only after login and MFA succeed may an active verified user enter authorized tenant/scope; failed attempts are rate-limited and audited; `E2E-10` requires cross-tenant attacks to fail without metadata leakage.
- `docs/product-spec/docs/07-ai-build/DEFINITION-OF-READY-DONE.md` — frontend/backend connection, migration, authorization, state coverage, audit, unit/integration/E2E evidence, contract/docs sync, accessibility and clean-checkout gates.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` — NestJS/Prisma API, Next.js web, shared OpenAPI-generated contracts, server-authoritative state transitions, tenant-scoped repositories and Vitest/Supertest/Playwright evidence.
- `docs/product-spec/contracts/openapi.yaml` — `AuthResponse.status` already reserves `MFA_REQUIRED`; `/auth/login` and `/auth/login/otp/verify` are the two primary-login paths that must return an MFA challenge instead of a session for an enrolled user.
- `docs/product-spec/work-items/FEAT-AUTH-03.md` — merged login decisions establish real `device_sessions`, signed access tokens, generic invalid-credential responses, configured OTP login and the reserved `MFA_REQUIRED` response. This Work Item extends that contract; it does not create a parallel login/session design.

The implementation Pull Request must add the feature-specific traceability identifiers that the approved aggregate sources do not yet contain: `UC-AUTH-03` (enroll and use MFA), `BR-AUTH-14..19`, `SCR-AUTH-03` (`/settings/security`), `API-AUTH-MFA-*`, `ENT-MFA-FACTOR`, `ENT-MFA-RECOVERY-CODE`, `ENT-MFA-CHALLENGE`, and `AC-AUTH-05`. Those additions are part of this Work Item and must preserve the behavior specified below.

## Preconditions and dependencies

- The register's declared dependency `TASK-FOUND-04` is merged. It supplies OpenAPI generation/drift checks, test infrastructure and the repository quality gates.
- `FEAT-AUTH-01` is present on `origin/main` and supplies active/verified users, password re-authentication, verification delivery patterns, rate limiting and immutable auth audit behavior.
- `FEAT-AUTH-03` is present on `origin/main` and supplies password/configured-OTP primary login, `MFA_REQUIRED` in `AuthResponse`, signed tokens and persisted device sessions. MFA must extend these paths and must not issue a full session before the second factor succeeds.
- `FEAT-AUTH-04` and `FEAT-AUTH-06` are not prerequisites. This Work Item may reuse session-revocation helpers if they have merged before authoring; otherwise it implements only the bounded target-session revocation needed for admin reset inside the existing auth module. It must not build password recovery or the session-management UI.
- No external carrier, email, SMS or payment capability is involved. Authenticator-app TOTP and locally generated recovery codes are deterministic and testable without a third-party provider.

## Author boundary

`GEMINI` is required because this is a high-risk authentication and authorization change spanning secret storage, login state, session issuance/revocation, tenant-scoped administration, UI, API contracts, migrations and security tests. It is prohibited work for `9ROUTER` under `AGENTS.md`.

The author must stay within the allowed paths and the decisions in this Work Item. Any proposal to add SMS/email as the second factor, let a trusted device bypass MFA, weaken the owner/finance requirement, expose the TOTP seed/recovery codes after initial display, permit cross-tenant or self-admin reset, or issue a tenant session before successful MFA is a consequential security/product change and requires human approval before implementation continues.

## In scope

- Authenticator-app TOTP enrollment for an authenticated, active user after fresh primary re-authentication.
- A setup transaction that returns an `otpauth://` provisioning URI and manual key once, stores the seed encrypted at rest, remains `PENDING`, and expires if not verified.
- Verification of setup with a current TOTP before the factor becomes `ACTIVE`; failed/expired verification never activates the factor.
- Atomic generation of exactly 10 high-entropy, single-use recovery codes upon activation; plaintext codes are displayed once and only non-reversible verifiers are stored.
- Login integration for both password and configured-OTP primary login: an enrolled user receives `MFA_REQUIRED` plus an opaque, short-lived, single-purpose challenge instead of an access token/device session; successful TOTP or recovery-code verification then creates the normal scoped session.
- Mandatory MFA enrollment for active `OWNER` and `FINANCE` role users. After successful primary login, a required-but-unenrolled user receives `MFA_ENROLLMENT_REQUIRED` and a setup-only token; the token authorizes only setup/status/logout endpoints and never tenant data. Other roles may enroll voluntarily.
- Self-service MFA status and recovery-code regeneration under `/settings/security`. Regeneration requires fresh primary re-authentication plus a current TOTP, atomically invalidates all old unused recovery codes, and displays the replacement set once.
- Tenant-scoped admin reset of another user's MFA by an `OWNER` or a manager who currently has delegated `Manage users/roles` permission over the target. The actor must have completed MFA in the current fresh session. The endpoint must reject self-reset, cross-tenant targets, insufficient scope and a target that has no active/pending factor.
- Admin reset atomically disables/deletes the target factor material, invalidates pending MFA challenges and all recovery codes, revokes all target device sessions, records actor/target/reason/correlation ID, and leaves the target subject to mandatory enrollment on next login when their role requires it.
- Security events and metrics for setup started/completed/expired, challenge success/failure/rate limit, recovery-code use/regeneration and admin reset. No event/log/error/snapshot contains the TOTP seed, provisioning URI, raw TOTP, raw recovery code or access/setup/challenge token.
- OpenAPI/generated-contract, Prisma migration, data dictionary, business rule, use case, screen, traceability and acceptance documentation updates.
- Unit, API integration, component/accessibility and Playwright E2E evidence for the complete matrix below.

## Out of scope

- Password reset (`FEAT-AUTH-04`) and general session listing, refresh, logout-all or device-management UI (`FEAT-AUTH-06`).
- SMS, email, push, passkey/WebAuthn, hardware-key or biometric second factors.
- Trusted-device MFA bypass. `remember_device` may affect the primary session only; every new login for an enrolled user requires MFA in this Work Item.
- Self-service disable/replace of an active factor. A user can regenerate recovery codes; a lost factor uses a recovery code to sign in and then an authorized administrator performs the audited reset.
- Ship Dễ support-operator reset without an active tenant-scoped, time-bound support grant (`FEAT-SEC-02`). No support bypass or global reset permission may be introduced here.
- Role/permission editor implementation (`FEAT-RBAC-01`/`FEAT-RBAC-02`), user lifecycle implementation (`FEAT-USR-02`), notification-center delivery (`FEAT-COM-09`) or policy UI for changing which roles require MFA.
- Retrofitting future finance/export/carrier commands with step-up checks. This Work Item exposes server-verifiable assurance (`mfa_verified_at`/assurance level) so each later sensitive-feature Work Item can enforce it.

## Business rules and edge cases

- `BR-AUTH-14 — Factor setup`: Only an authenticated `ACTIVE` user may start setup, and fresh primary re-authentication is required. Starting setup invalidates any older `PENDING` setup for that user but never replaces an `ACTIVE` factor. The TOTP seed is generated with a cryptographically secure RNG, encrypted at rest with a dedicated configured key, returned only during that setup response, and never returned by status/read endpoints.
- `BR-AUTH-15 — Activation`: A factor becomes `ACTIVE` only after a valid TOTP proves possession. Use interoperable TOTP defaults (6 digits, 30-second period) with a maximum verification window of one step before/current/one step after. A time step already accepted for the same factor cannot be replayed. Setup expires after 10 minutes; expired setup must restart with a new seed.
- `BR-AUTH-16 — Login challenge`: A successful primary credential for a user with an active factor returns an opaque MFA challenge, not a session/access token. The challenge is hashed at rest, bound to user + primary-login transaction + intended tenant, expires after 5 minutes, is single-use and is consumed on success or after 5 failed attempts. At most 5 failures per user and 10 per source IP are allowed per 15 minutes; excess returns `RATE_LIMITED` with a retry hint. TOTP errors do not reveal whether the challenge, user or factor exists.
- `BR-AUTH-17 — Recovery codes`: Activation and regeneration create exactly 10 independent high-entropy codes. Plaintext is shown once; stored values are non-reversible verifiers. Matching and consumption occur atomically so concurrent use of one code creates at most one session. A consumed code cannot be replayed. Successful use returns the number of unused codes remaining and emits a security event; zero remaining codes never silently disables MFA.
- `BR-AUTH-18 — Required roles and assurance`: `OWNER` and `FINANCE` users require an active factor before tenant access. An unenrolled required user may authenticate only into the bounded setup flow. A session created after MFA carries a server-verifiable `mfa_verified_at` and `auth_assurance=MFA`; client claims alone never satisfy step-up. Suspending/disabling the user or resetting the factor invalidates outstanding MFA challenges and blocks session issuance.
- `BR-AUTH-19 — Admin reset`: Reset is a tenant-scoped, high-risk command. The actor must be a different user, hold current manage-users permission over the target, have an MFA-verified fresh session, and provide a non-blank reason. Reset is atomic and idempotent for the same request key: it removes usable factor/recovery/challenge material, revokes every target session, records immutable before/after state without secrets, and returns only sanitized status. A repeated request with the same key returns the original result; a different request with the same key returns `CONFLICT`.
- Concurrent setup verification accepts only one activation; the loser receives `CONFLICT` and no second recovery-code set.
- Concurrent recovery-code submissions consume the code once and issue at most one session.
- TOTP verification uses server time. A clock outside the accepted window returns an actionable invalid-code error without disclosing skew; no wider fallback window is permitted.
- An active factor's seed and codes are never exposed by GET, admin reset, database fixture, logs, errors, audit payloads, screenshots or test snapshots.
- A challenge issued before admin reset, suspension, disablement or factor replacement fails closed even if its TOTP is otherwise valid.
- Tenant/resource lookup for admin reset returns the repository's non-leaking forbidden/not-found behavior; changing a target UUID must never disclose another tenant's user or MFA status.

## UI states

`SCR-AUTH-03` at `/settings/security` and the MFA portion of `SCR-AUTH-01` must satisfy the shared screen and accessibility contracts.

- **Loading:** status/setup/regeneration/reset requests use skeletons or inline progress; each command locks its submit control and prevents duplicate submission.
- **Empty/not enrolled:** security settings explains MFA, role requirement and the primary action. Required-role users in the bounded setup flow cannot navigate into tenant application screens.
- **Setup:** show QR plus manual key, issuer/account label, verification field, expiration hint and restart action. The seed is not recoverable after leaving; navigation warns that returning starts a new setup.
- **Validation:** empty/malformed TOTP, recovery code and admin reason render field errors from the canonical envelope; screen-reader focus moves to the error summary.
- **MFA challenge:** after primary login, show TOTP input, recovery-code alternative and return-to-login action. It must not briefly route/render the tenant dashboard before verification.
- **Recovery:** recovery-code input is explicitly one-time; success reports remaining-code count without showing stored codes. Invalid/used codes share a non-enumerating error shape.
- **Success:** activation/regeneration shows all 10 codes exactly once with copy/download acknowledgment and a required “I saved these codes” confirmation before leaving. Subsequent visits show only active status and remaining count.
- **Expired:** expired setup/challenge explains that no session/factor change occurred and offers a safe restart from primary authentication.
- **Rate limited:** show retry timing and preserve only non-secret input; clear TOTP/recovery-code fields.
- **Error/recovery:** network/server errors state whether the command committed. Refetch status before offering setup/regenerate/reset again; never guess success.
- **Forbidden/not found:** admin reset control is hidden when unauthorized, but direct calls are rejected server-side. Cross-tenant/not-found responses do not render target metadata.
- **Admin reset confirmation:** `SCR-USR-01` identifies target user, states that MFA material and all sessions will be revoked, requires a reason, and requires an explicit destructive confirmation. Self-reset is unavailable.
- **Responsive/accessibility:** setup, challenge and code-save flows work at mobile width; QR has a labeled manual-key alternative; inputs have programmatic labels, visible focus, live async announcements and no color-only status.

## API, event and data impact

### API and contracts

- Extend `POST /auth/login` and `POST /auth/login/otp/verify`: enrolled users return `200 AuthResponse(status=MFA_REQUIRED, mfa_challenge_id, expires_at)` without `access_token`, `user`, `merchant` or a persisted device session. Required-but-unenrolled users return `MFA_ENROLLMENT_REQUIRED` plus a setup-only token.
- `GET /auth/mfa/status` — authenticated or setup-token query returning `NOT_ENROLLED`, `PENDING` or `ACTIVE`, `required`, and recovery-code count only; never seed/code material.
- `POST /auth/mfa/setup` — fresh primary re-authentication; returns one-time provisioning URI/manual key and setup expiry.
- `POST /auth/mfa/setup/verify` — TOTP activation; returns the one-time 10-code set and MFA-authenticated session (or upgrades the bounded setup context).
- `POST /auth/mfa/challenge/verify` — opaque challenge + TOTP; consumes challenge and creates the same `AuthResponse(status=AUTHENTICATED)`/device session shape as `FEAT-AUTH-03`.
- `POST /auth/mfa/recovery/verify` — opaque challenge + recovery code; atomically consumes both as applicable and creates the same authenticated session plus `recovery_codes_remaining`.
- `POST /auth/mfa/recovery-codes/regenerate` — authenticated active session, fresh primary re-authentication and current TOTP; invalidates old codes and returns replacement plaintext once.
- `POST /users/{user_id}/mfa/reset` — authenticated admin command with `Idempotency-Key`, reason and target path ID; returns sanitized reset/session-revocation counts and correlation ID.
- Add documented errors: `MFA_ENROLLMENT_REQUIRED`, `MFA_ALREADY_ENABLED`, `MFA_SETUP_EXPIRED`, `MFA_CHALLENGE_INVALID`, `MFA_CHALLENGE_EXPIRED`, `MFA_CODE_INVALID`, `MFA_RECOVERY_CODE_INVALID`, `MFA_FRESH_AUTH_REQUIRED`, alongside existing `VALIDATION_ERROR`, `FORBIDDEN`, `CONFLICT` and `RATE_LIMITED`.
- All new operations and schemas are added to `docs/product-spec/contracts/openapi.yaml`, generated into `packages/contracts`, and proven drift-free by `pnpm contract:check`.

### Data and events

- Add `MfaFactor`: user ID (unique active factor per user), tenant/merchant binding where required by repository convention, type `TOTP`, encrypted-secret ciphertext/key-version metadata, status `PENDING|ACTIVE|RESET`, setup expiry, activated/reset timestamps, last accepted TOTP step, created/updated actor and timestamps. Never persist the raw provisioning URI.
- Add `MfaRecoveryCode`: factor ID, non-reversible verifier, created/consumed timestamps and consuming correlation/session reference. No plaintext column.
- Add `MfaChallenge`: hashed opaque token, user/tenant, primary-login transaction reference, purpose, expiry, failed-attempt count, consumed/invalidated timestamp and correlation metadata. Raw challenge token is never stored.
- Extend `DeviceSession` or its canonical session metadata with `mfa_verified_at` and authentication assurance. Existing non-MFA sessions remain distinguishable and cannot be treated as stepped up.
- Add forward-only Prisma migration and deterministic seed/test fixtures containing encrypted test factor material and hashed recovery codes only. Migration rollback/forward notes must explain key availability and fail closed when the MFA encryption key is absent in production.
- Add immutable events: `AUTH_MFA_SETUP_STARTED`, `AUTH_MFA_SETUP_COMPLETED`, `AUTH_MFA_SETUP_EXPIRED`, `AUTH_MFA_CHALLENGE_SUCCEEDED`, `AUTH_MFA_CHALLENGE_FAILED`, `AUTH_MFA_RATE_LIMITED`, `AUTH_MFA_RECOVERY_USED`, `AUTH_MFA_RECOVERY_REGENERATED`, `AUTH_MFA_ADMIN_RESET`. Event payloads contain actor/target IDs, tenant, outcome, reason where required and correlation ID, never secrets/codes.
- Existing users are not silently marked enrolled. Owners/finance become setup-required at their next primary login; other roles retain normal login until voluntarily enrolled. No existing public request shape is removed; contract changes are additive except that successful primary login may now return the already-reserved `MFA_REQUIRED` status.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-AUTH-05-01` | Active user freshly re-authenticates and starts setup | Pending factor with encrypted seed and 10-minute expiry; QR/manual key returned once; logs/audit/database contain no plaintext seed or URI | Unit + Supertest + secret/log assertion |
| `AC-AUTH-05-02` | User verifies setup with valid current TOTP | Exactly one active factor and 10 one-time recovery codes are created atomically; authenticated MFA session has assurance metadata | Supertest integration test |
| `AC-AUTH-05-03` | Setup verification uses invalid, replayed-step or expired TOTP/setup | Activation fails closed; no recovery codes/session; replayed accepted time step is rejected | Unit clock-vector tests + Supertest |
| `AC-AUTH-05-04` | Two setup-verification requests race | One activation/code set succeeds; the other returns `CONFLICT`; one active factor exists | Concurrent database integration test |
| `AC-AUTH-05-05` | Enrolled user completes correct password login | Response is `MFA_REQUIRED` only; no access token or device session exists yet | Supertest + database assertion |
| `AC-AUTH-05-06` | Enrolled user completes configured-OTP primary login | Same `MFA_REQUIRED` behavior; primary OTP does not count as MFA | Supertest integration test |
| `AC-AUTH-05-07` | Valid TOTP verifies an unexpired MFA challenge | Challenge consumed once; one normal scoped device session issued with `auth_assurance=MFA` and `mfa_verified_at` | Supertest + token/session assertion |
| `AC-AUTH-05-08` | Challenge is expired, already consumed, invalidated or reaches five failures | No session; non-enumerating canonical error; rate limit/retry hint and audit are correct | Unit + Supertest |
| `AC-AUTH-05-09` | Valid unused recovery code verifies a challenge | Code consumed atomically, one session issued, remaining count returned, security event recorded without code | Supertest + database/log assertion |
| `AC-AUTH-05-10` | Same recovery code is submitted concurrently or replayed | At most one request/session succeeds; other request gets the same invalid-code shape | Concurrent integration test |
| `AC-AUTH-05-11` | Active user regenerates codes with fresh primary auth + current TOTP | Old unused codes fail; exactly 10 new codes display once; later status returns count only | Supertest + Playwright screenshot |
| `AC-AUTH-05-12` | Owner/finance without a factor finishes primary login | `MFA_ENROLLMENT_REQUIRED`; setup-only token cannot call a tenant data route; successful setup yields MFA session | API integration + authorization test |
| `AC-AUTH-05-13` | Optional-role user without a factor logs in | Existing authenticated login behavior remains compatible; no forced enrollment | Regression integration test |
| `AC-AUTH-05-14` | Authorized, MFA-verified owner resets another in-scope user's factor with reason | Factor/challenges/codes invalidated, all target sessions revoked, idempotent result returned and immutable actor/target/reason audit recorded | Supertest + database assertions |
| `AC-AUTH-05-15` | Admin reset is self-targeted, cross-tenant, out-of-scope, lacks permission/fresh MFA, or omits reason | Request fails closed with non-leaking `FORBIDDEN`/`VALIDATION_ERROR`; no target state/session changes | Security integration matrix |
| `AC-AUTH-05-16` | Suspended/disabled/reset target uses a pre-existing MFA challenge | Challenge fails and no session is issued even with a valid TOTP | Supertest regression test |
| `AC-AUTH-05-17` | Setup, challenge, recovery and admin reset UI states are exercised | All specified loading, validation, success, expired, rate-limited, forbidden, destructive-confirmation and recovery states are distinct, responsive and keyboard/screen-reader usable | Component/axe + Playwright E2E + screenshots |
| `AC-AUTH-05-18` | Attacker inspects logs, errors, audit, snapshots and stored records | No plaintext seed, provisioning URI, TOTP, recovery code or raw challenge/setup token is present | Automated secret/redaction test + `pnpm security:secrets` |
| `AC-AUTH-05-19` | OpenAPI/docs/generated contracts are checked | Feature traceability IDs, rules/use case/screens/data and generated types agree with implementation; zero contract drift | `pnpm contract:check` + diff review |
| `AC-AUTH-05-20` | Existing auth suites run after MFA changes | Registration and non-MFA login behavior remains green; no fake session or client-only bypass is introduced | Full unit/integration/E2E regression logs |

## Verification commands

Run from a clean checkout on the implementation branch:

```text
pnpm install --prod --frozen-lockfile
pnpm install --frozen-lockfile
pnpm db:generate
pnpm contract:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:baseline
pnpm security:secrets
pnpm build
```

Feature-focused evidence must additionally include the repository's actual filtered commands for the new API auth unit/Supertest suites and the Playwright MFA journey; record the exact commands and results in the implementation PR rather than substituting manual claims.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| — | — | — | Not yet implemented; fresh independent review required after author evidence and green CI |

## Residual limitations

None. Alternative second-factor methods, trusted-device bypass, support-operator reset and enforcement on future sensitive domain operations are explicitly out of scope, not incomplete behavior in this Work Item.
