# FEAT-AUTH-03 — Login with password or configured OTP

| Field | Value |
| --- | --- |
| Work Item ID | `FEAT-AUTH-03` |
| Feature ID | `FEAT-AUTH` |
| Title | Login with password or configured OTP (incl. disabled/unverified states) |
| Status | `READY_FOR_CODEX` |
| Assigned author | `GEMINI` (Claude assistant author session on worktree `b03-run`) |
| Branch | `feat/feat-auth-03-login` |
| Pull Request | [#124](https://github.com/vinh05092001/shipde-platform/pull/124) |

## Business outcome

A registered user of a Ship Dễ shop can log in to the web console with their identifier (email or phone) plus password, or — when the operator has enabled the OTP login alternative — with a single-use one-time code delivered to a verified contact channel. The login produces a real, auditable session (a `device_sessions` row plus a signed access token), and every blocked or failed attempt produces a distinct, actionable outcome: wrong credentials, unverified account, suspended account, disabled account, not-yet-accepted invitation, or rate limiting. Until this Work Item ships, the target `apps/api` backend cannot start any authenticated session: register/verify (`FEAT-AUTH-01`) ends at an `ACTIVE` user, and every screen behind the auth gate is reachable only through a client-only mock session (`AuthContext` auto-seeds a fake owner session and `login()` fabricates a token without the network).

`AC-AUTH-01` — _"Given an active verified user with valid credentials, when login and MFA succeed, then the user enters only authorized tenant/scope; failed attempts are rate-limited and audited"_ — becomes implementable end-to-end with this Work Item (the MFA challenge itself remains `FEAT-AUTH-05`).

## Source references

Existing, directly authoritative:

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-AUTH-03` "Login with password or configured OTP (incl. disabled/unverified states)".
- `docs/product-spec/docs/02-business/USE-CASES.md:7-16` — `UC-AUTH-01` Log in: actor any registered user; preconditions active + verified; trigger "submit credentials or approved OTP"; main result "create scoped session and route to permitted home"; alternatives "MFA challenge; select organization; forced password change"; failures "invalid credentials, lockout, suspended account, expired invite".
- `docs/product-spec/docs/02-business/BUSINESS-RULES-DECISION-TABLES.md:5-14` — `BR-AUTH-02` (cannot log in until a channel is verified), `BR-AUTH-05` (memory-hard password hashing; never log plaintext), `BR-AUTH-06` (single-use expiring tokens), `BR-AUTH-09` (immutable audit records without secrets). New login-specific rules are proposed in this Work Item (`BR-AUTH-11..13`) and added to that document in the same Pull Request.
- `docs/product-spec/docs/02-business/STATE-MACHINES.md` — `ST-USER`: `PENDING_VERIFICATION → ACTIVE → SUSPENDED → ACTIVE` and `→ DISABLED`; login must never mutate user state, only observe it.
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md:15-26` — `SCR-AUTH-01` Login: "Email or phone. Password with show/hide. Remember trusted device. Login, OTP alternative if configured, forgot password. MFA challenge and recovery code." Route and full state coverage are added to the document in this Pull Request.
- `docs/product-spec/docs/08-testing/ACCEPTANCE-AND-E2E.md:5-7` — `AC-AUTH-01`.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — `User.status` lifecycle values; `DeviceSession` as the session entity.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md:19` — `/auth` prefix purpose includes "login, MFA, refresh, logout, recovery".
- `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` — canonical error classes; `RATE_LIMITED` with retry hint.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md:5,16,59` — memory-hard password hashing; "Rate limit auth, OTP, public tracking and webhook routes"; no password/OTP/token in logs.
- `docs/product-spec/contracts/openapi.yaml` — `/auth/login` + `LoginRequest` + `AuthResponse` + `ErrorResponse`/`Meta` schemas exist; response coverage (403/429) and the OTP alternative paths are added in this Pull Request.
- `docs/product-spec/work-items/FEAT-AUTH-01.md` — sibling Work Item that produced register/verify; its status casing (`active`/`pending_verification` lowercase in Prisma vs. `ACTIVE`/`PENDING_VERIFICATION` in contracts) is the established convention this Work Item follows.
- `infra/docker/seed.ts` — seeded users previously carried a fake `password_hash` that no algorithm can verify; this Pull Request replaces it with a real scrypt hash of a documented test password so seeded accounts are loginable end-to-end.
- `packages/testkit/src/auth/mock-verification-adapter.ts` — deterministic delivery adapter reused to prove OTP login delivery in tests.

Implementation evidence (not business authority):

- `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `rate-limit.service.ts`, `password.util.ts` (FEAT-AUTH-01) — canonical error shape, audit helper, rate-limit windows, scrypt verify.
- `apps/web/src/context/AuthContext.tsx`, `apps/web/src/components/auth/LoginView.tsx` — prototype login with fabricated token and hard-coded demo credentials; must be replaced by real API behavior.

## Risk rationale

This is not "UI + one endpoint". Login is the first issuer of credentials that grant access to tenant data, and the repository has no existing session infrastructure to reuse: no JWT library is present anywhere in the dependency tree, no guard validates incoming tokens, and no API route has ever issued one. The risk concentrates in five areas:

1. **Session/token design** — an incorrect design either blocks FEAT-AUTH-05/06 (MFA, session management) or hard-codes an unrevocable token into every future route. The decision below is documented and minimal, not maximal.
2. **Account state gate bypass** — a login that only checks the password would let `pending_verification`, `suspended`, `disabled` and `invited` users obtain sessions. Each state is a distinct canonical outcome (UC-AUTH-01 failure list).
3. **Credential stuffing / brute force** — login must be rate-limited per IP and per identifier (SECURITY-NFR-OBSERVABILITY.md:16) with identical error responses for unknown identifier and wrong password (no account enumeration).
4. **OTP as a second front door** — an OTP login channel is a passwordless login primitive: single-use, short TTL, hashed at rest, bounded attempts, verified-channel-only delivery, and disabled by default until configured.
5. **Secret management** — the token signing secret must fail closed in production and never appear in logs, errors or fixtures (BR-AUTH-09, SECURITY-NFR line 59).

## Consequential decisions (proposed defaults, human-confirmed via PR review)

| ID | Decision | Rationale and alternatives |
| --- | --- | --- |
| CD-1 | **Stateless compact token** `v1.<base64url payload>.<base64url HMAC-SHA256>` issued by the API, carrying `sub` (user id), `sid` (device session id), `mid` (merchant id), `role`, `st` (user status), `iat`, `exp`, `jti`. No external JWT library is added. | Zero new dependencies (`node:crypto` HMAC is the standard primitive); the payload shape is JWT-compatible so a library can replace the encoder later without changing consumers. Alternatives rejected: opaque random token + DB lookup on every request (requires guard/interceptor infra that no route uses yet — deferred to FEAT-AUTH-06); JWT library now (adds a dependency for encoding only). |
| CD-2 | **One `device_sessions` row per successful login.** `device_id` = `web-<sha256(user-agent+ip)[0..15]>`; token `sid` claim references it. `is_revoked` stays false; revocation/refresh flows belong to `FEAT-AUTH-06`. | UC-AUTH-01 says "create scoped session" — a DB row makes the session a real, auditable, revocable entity instead of an unforgeable string only. |
| CD-3 | **Signing secret `AUTH_TOKEN_SECRET`**: required, ≥ 32 chars, when `NODE_ENV=production` (fail-closed in `validateConfig`); optional otherwise — dev/test processes generate an ephemeral random secret per boot (restarts invalidate tokens; documented). TTL via `AUTH_TOKEN_TTL_SECONDS`, default 43200 (12 h). | Prevents the prototype from silently running with a guessable secret in production. Alternatives rejected: hard-coded dev default (secret in source), reusing `DATABASE_URL` as HMAC key (secret rotation coupling). |
| CD-4 | **OTP login is configuration-gated** by `AUTH_LOGIN_OTP_ENABLED` (default `false`), per SCR-AUTH-01 "OTP alternative **if configured**". When disabled, `POST /auth/login/otp/request` returns `403 AUTH_OTP_LOGIN_DISABLED`. | The spec explicitly makes OTP login an operator-configured alternative, not an always-on second door. |
| CD-5 | **Login OTP tokens** reuse `verification_tokens` with a new `purpose` column (`VERIFICATION` default, `LOGIN` for login OTP): 6-digit OTP, 5-minute TTL (tighter than BR-AUTH-06's 15-minute verification OTP because a login OTP has a higher blast radius), SHA-256 hashed at rest, single-use, max 5 failed verifications per 15 min per identifier (reuses FEAT-AUTH-01's attempt counters), 60 s cooldown + max 5 requests/hour per identifier, max 10 requests/hour per IP. Delivered via the existing `IVerificationDeliveryAdapter` **only to channels the user has verified**. | Reuses one token store and one adapter instead of inventing parallel infrastructure; the `purpose` column prevents a verification OTP from ever being replayed as a login credential (and vice versa). |

| CD-6 | **Status gates before session issuance** (UC-AUTH-01/ST-USER): `pending_verification` → `403 AUTH_PENDING_VERIFICATION` (next action: verify/resend from the register flow); `suspended` → `403 AUTH_ACCOUNT_SUSPENDED`; `disabled` → `403 AUTH_ACCOUNT_DISABLED`; `invited` → `403 AUTH_INVITATION_PENDING` (invite flow is FEAT-USR-01). All blocked attempts are audited without credentials. | Distinct, actionable outcomes are the spec's explicit failure list; collapsing them into one 401 would hide suspended-account abuse and dead-end unverified users. |
| CD-7 | **Anti-enumeration**: unknown identifier and wrong password return the **identical** `401 INVALID_CREDENTIALS` body; the same applies to `POST /auth/login/otp/request` for unknown identifiers (generic success response, no delivery). Trade-off: `suspended`/`disabled`/`invited` responses are intentionally distinct (spec-mandated), so those three states are enumerable behind the password/OTP gate — accepted because UC-AUTH-01 explicitly lists them as separate failures. | FEAT-AUTH-01 precedent: enumerate only what the user supplied themselves. |
| CD-8 | **MFA_REQUIRED / ORG_SELECTION_REQUIRED** remain declared response statuses in `AuthResponse` but are never returned by this Work Item (MFA = FEAT-AUTH-05; org selection has no Work Item yet). Login routes the user to their single merchant context; multi-organization selection is out of scope. | The openapi contract already declares them; keeping them typed prevents a breaking contract change later. |
| CD-9 | **Rate limits (proposed BR-AUTH-11 defaults)**: password login — max 10 attempts/15 min per IP, max 5 failures/15 min per identifier; both return `429 RATE_LIMITED` with `retry_after`. A successful login resets the identifier failure counter; the IP counter is not reset (IP is shared infrastructure). | Mirrors BR-AUTH-07/08 granularity (IP = infra abuse, identifier = targeted abuse). Constants live in code with the other auth thresholds; thresholds are config-independent by precedent. |
| CD-10 | **Web removes the fabricated default session.** `AuthContext` no longer auto-seeds a mock owner session and `LoginView` no longer hard-codes demo credentials; login fields start empty and every state is API-driven. | UI quality rule: "placeholder data presented as live" and fake primary actions are rejected; the mock session also silently bypassed the real auth gate this Work Item introduces. |

## In scope

- `packages/contracts`: `LoginRequest`, `AuthSessionData`, `AuthResponse`, `LoginOtpRequestRequest`, `LoginOtpVerifyRequest`, `LoginOtpChallengeResponse`, `AuthenticatedUser`, `AuthenticatedMerchant` types (canonical, snake_case).
- `packages/config`: `AUTH_TOKEN_SECRET`, `AUTH_TOKEN_TTL_SECONDS`, `AUTH_LOGIN_OTP_ENABLED` fields + fail-closed validation (production secret requirement; strict boolean parsing).
- `apps/api` auth module:
  - `POST /auth/login` — identifier (email or VN phone) + password + optional `remember_device`; success issues token + device session row; canonical errors `VALIDATION_ERROR`, `INVALID_CREDENTIALS`, `AUTH_PENDING_VERIFICATION`, `AUTH_ACCOUNT_SUSPENDED`, `AUTH_ACCOUNT_DISABLED`, `AUTH_INVITATION_PENDING`, `RATE_LIMITED`.
  - `POST /auth/login/otp/request` — sends a login OTP to the identifier's verified channel (email token or SMS OTP) via the delivery adapter.
  - `POST /auth/login/otp/verify` — verifies the OTP, consumes the token atomically, issues the same session as password login.
  - Rate limiting per CD-5/CD-9 in `RateLimitService`; audit events (`AUTH_LOGIN_SUCCESS`, `AUTH_LOGIN_FAILED`, `AUTH_LOGIN_BLOCKED_STATUS`, `AUTH_LOGIN_RATE_LIMITED`, `AUTH_LOGIN_OTP_REQUESTED`, `AUTH_LOGIN_OTP_SUCCESS`, `AUTH_LOGIN_OTP_FAILED`, `AUTH_LOGIN_OTP_RATE_LIMITED`) via the existing `logAudit` helper.
  - Token issuance/verification helpers (`signAccessToken`, `verifyAccessToken`) with unit coverage; no guard middleware yet (no protected route exists to protect — `FEAT-AUTH-06` owns request-time guard/refresh).
- `prisma`: `verification_tokens.purpose` column (default `VERIFICATION`) + index + migration; FEAT-AUTH-01 token lookups scoped to `purpose = 'VERIFICATION'`.
- `infra/docker/seed.ts`: real scrypt `password_hash` for seeded users (documented test password; not a production secret).
- `apps/web`: real `AuthContext.login`, `requestLoginOtp`, `verifyLoginOtp` with error-code mapping; `LoginView` rewritten to SCR-AUTH-01 with loading/empty/validation/invalid-credential/pending-verification/suspended/disabled/invited/rate-limited/OTP/network states; demo quick-login buttons and pre-filled credentials removed.
- `docs`: new `BR-AUTH-11..13` in BUSINESS-RULES-DECISION-TABLES.md; `SCR-AUTH-01` route + state coverage in SCREEN-SPECIFICATIONS.md; TRACEABILITY row; FEATURE-DELIVERY-REGISTER row update.
- Tests: token unit tests + supertest acceptance suite covering the AC matrix below (reusing `MockVerificationDeliveryAdapter` and seeded users).

## Out of scope (explicitly)

- `FEAT-AUTH-04` forgot password / recovery. The SCR-AUTH-01 "forgot password" action renders as a disabled link with an explanatory message.
- `FEAT-AUTH-05` MFA challenge, recovery codes, `challenge_id` issuance (`MFA_REQUIRED` stays reserved in the contract).
- `FEAT-AUTH-06` session management: token refresh, logout revocation, device listing, request-time `AuthGuard` on protected routes (none exist yet — every current API route is public).
- Multi-organization session routing (`ORG_SELECTION_REQUIRED` stays reserved).
- Admin-created accounts (`FEAT-AUTH-02`) and the invitation acceptance flow (FEAT-USR-01); `invited` users are only blocked with an actionable error here.
- Carrier integrations, money, tenant data routes — untouched by this Work Item.

## Business rules and edge cases (proposed BR additions, summarized)

- `BR-AUTH-11` — Login attempts are rate-limited per IP (max 10/15 min) and per identifier (max 5 failures/15 min); exceeding returns `RATE_LIMITED` with a retry-after hint. Unknown identifier and wrong password return identical `INVALID_CREDENTIALS` responses.
- `BR-AUTH-12` — OTP login is enabled by configuration only. Login OTPs are single-use, 5 minutes, hashed at rest, bounded (5 requests/hour/identifier, 60 s cooldown, 10 requests/hour/IP, 5 failed verifications/15 min) and delivered only to verified channels. A verification OTP can never authorize a login and vice versa (`purpose` column).
- `BR-AUTH-13` — Login of a `pending_verification`, `suspended`, `disabled` or `invited` user is rejected with a distinct canonical error and an audit record that never contains the password or OTP.

Edge cases: `+84`-prefixed phone matches its `0`-prefixed stored form; concurrent logins create independent device sessions (no uniqueness constraint on sessions); a user suspended between OTP request and verify is blocked at verify time; consumed/expired/unknown login OTPs return `OTP_ALREADY_CONSUMED`/`OTP_EXPIRED`/`INVALID_OTP` respectively; the 5th failed OTP attempt consumes the token and returns `OTP_MAX_ATTEMPTS_EXCEEDED` (mirrors FEAT-AUTH-01 semantics).

## Acceptance matrix

| AC ID | Scenario (Given/When/Then) | Level | Result / evidence |
| --- | --- | --- | --- |
| AC-AUTH-01-01 | Given seeded `active` owner with the documented password, when `POST /auth/login` with email + password, then `200` with `AUTHENTICATED` status, `access_token` (verifiable, carries sub/sid/mid/role), `user`, `merchant`, `meta.correlation_id`; a `device_sessions` row exists; audit `AUTH_LOGIN_SUCCESS` recorded. | supertest | `auth.login.supertest.spec.ts` TEST 1 |
| AC-AUTH-01-02 | Given the same user, when login with VN phone `0901234567` instead of email, then identical `200` behavior (identifier flexibility); a second independent `device_sessions` row exists. | supertest | TEST 2 |
| AC-AUTH-01-03 | Given a registered active user, when login with wrong password, then `401 INVALID_CREDENTIALS`; when login with an unknown identifier, then the **same** status/code/message shape (no enumeration). | supertest | TEST 3 |
| AC-AUTH-01-04 | Given a `pending_verification` seeded user with correct password, then `403 AUTH_PENDING_VERIFICATION` with next action pointing to verification; no token, no session row. | supertest | TEST 4 |
| AC-AUTH-01-05 | Given a `suspended` user with correct password, then `403 AUTH_ACCOUNT_SUSPENDED`; given a `disabled` user, then `403 AUTH_ACCOUNT_DISABLED`; given an `invited` user, then `403 AUTH_INVITATION_PENDING`; each audited. | supertest | TEST 5 |
| AC-AUTH-01-06 | Given 5 consecutive wrong-password attempts for one identifier, then further attempts return `429 RATE_LIMITED` with a retry hint; audit `AUTH_LOGIN_RATE_LIMITED`. | supertest | TEST 6 |
| AC-AUTH-01-07 | Given missing identifier or password, then `400 VALIDATION_ERROR` with field-level details. | supertest | TEST 7 |
| AC-AUTH-01-08 | Given OTP login disabled (default config), when `POST /auth/login/otp/request`, then `403 AUTH_OTP_LOGIN_DISABLED`. | supertest | TEST 8 |
| AC-AUTH-01-09 | Given OTP login enabled and an active user with verified phone, when OTP requested, then `200 OTP_SENT` and the mock adapter captured a phone message containing a 6-digit OTP; a `purpose=LOGIN` token row exists (hashed, 5-min expiry). | supertest | TEST 9 |
| AC-AUTH-01-10 | Given a delivered login OTP, when verify with the correct OTP, then `200 AUTHENTICATED` with the same session shape as password login; token consumed (`consumed_at` set); second verify of the same OTP → `OTP_ALREADY_CONSUMED`. | supertest | TEST 10 |
| AC-AUTH-01-11 | Given a delivered login OTP, when verify with a wrong OTP 5 times, then `INVALID_OTP` errors and finally `OTP_MAX_ATTEMPTS_EXCEEDED` with the token consumed; the correct OTP afterwards → `OTP_ALREADY_CONSUMED`. | supertest | TEST 11 |
| AC-AUTH-01-12 | Given a login OTP past its 5-minute expiry, when verify, then `OTP_EXPIRED`; when verify an unknown OTP → `INVALID_OTP`. | supertest | TEST 12 |
| AC-AUTH-01-13 | Given a `pending_verification` user (or unknown identifier), when OTP requested, then generic `200 OTP_SENT` with **no** adapter delivery (anti-enumeration, CD-7). | supertest | TEST 13 |
| AC-AUTH-01-14 | Given a signed token, when verified by `verifyAccessToken`, then the payload round-trips (sub/sid/mid/role/exp); a tampered payload rejects; an expired token rejects. | unit | token tests in login spec |
| AC-AUTH-01-15 | Given any login response/log/audit row or mock adapter message, then no password, OTP or token value appears. | supertest | per-test audit assertions |
| AC-AUTH-01-16 | Given `pnpm contract:check` after the openapi changes, then no drift between `openapi.yaml` and generated contract types. | CI | contract:check pass |

## Verification commands

Run from the workspace root (TASK-FOUND-02 authoritative commands):

- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test` (includes `contract:check` after openapi regeneration)
- `pnpm test:baseline`
- `pnpm security:secrets`
- `pnpm build`

Live supertest suites additionally require `pnpm infra:up` (PostgreSQL on :5433); offline runs skip with a warning by design (the `CI` environment throws instead).

## Residual limitations

- No request-time guard/refresh/revocation yet: every existing API route is public, so `verifyAccessToken` ships as a verified primitive + tests, with route protection owned by `FEAT-AUTH-06`.
- Dev/test token secret is ephemeral per process (restart invalidates sessions); production requires an explicit `AUTH_TOKEN_SECRET` (fail-closed).
- `suspended`/`disabled`/`invited` outcomes are intentionally distinct (spec) and therefore status-enumerable behind the credential/OTP gate — accepted trade-off (CD-7).
- OTP login availability is discovered by the web client at request time (`AUTH_OTP_LOGIN_DISABLED`); no separate options endpoint was added.
- The seed password is a documented test-only credential for local/CI fixtures (`TestPassword123!`); production user provisioning is out of scope.
- `verifyPhone`'s legacy tolerance for plaintext seed OTPs is retained from FEAT-AUTH-01; new login OTPs are always hashed.
