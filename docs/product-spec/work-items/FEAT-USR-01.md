# FEAT-USR-01 — User invitations

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-USR-01` |
| Feature ID      | `FEAT-USR-01` |
| Status          | `READY_FOR_AUTHOR` |
| Delivery order  | 11 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `auth`, `security`, `tenant isolation`, `database ownership` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/users/*`, `apps/api/src/invitations/*`, `apps/api/src/auth/rate-limit.service.ts`, `apps/api/src/app.module.ts`, `packages/contracts/src/*`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-USR-01.md`, `apps/web/src/components/forms/InviteUserModal.tsx`, `apps/web/src/components/UserManagementTab.tsx`, `apps/web/src/app/settings/users/*`, `apps/web/src/app/invite/accept/*`, `apps/api/package.json`, `apps/web/src/tests/comprehensive-rules.test.ts`, `apps/web/next.config.mjs` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-usr-01-user-invitations` |
| Pull Request    | Pending |

## Business outcome

A shop owner or authorized operations manager can invite new team members by email or phone, assign their role and store/warehouse scopes, resend expiring invitations, and cancel pending invitations. Invited recipients can securely inspect and accept the invitation via a tokenized link to activate their account and set their password, enforcing tenant isolation so users access only their assigned scopes.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-USR-01`: User invitations ("Send, resend, cancel, accept and expire").
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-USR-01`: Invite and authorize a user (Actor: `SHOP_OWNER` or authorized administrator; enter identity → assign roles/scopes → send invite → recipient verifies and accepts; rules: cannot remove last owner; cannot grant permissions actor does not possess; audit: invite, resend, role/scope change, revoke; acceptance: `AC-USR-01`).
- `docs/product-spec/docs/02-business/STATE-MACHINES.md` — Section "User invite": states `PENDING`, `ACCEPTED`, `EXPIRED`, `CANCELLED`; transitions `[*] -> PENDING`, `PENDING -> ACCEPTED`, `PENDING -> EXPIRED`, `PENDING -> CANCELLED`, `EXPIRED -> PENDING: resend`.
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Manage users/roles": Owner has full action (`A`), Ops manager has scoped action (`S`), all other roles denied (`-`). Rules: "A user cannot grant a permission they do not hold", "Backend is authoritative; hidden UI controls are insufficient", "Permission evaluation includes tenant, branch, warehouse and carrier-account scope."
- `docs/product-spec/docs/02-business/BUSINESS-RULES-DECISION-TABLES.md` — `BR-AUTH-13`: Login of an `invited` user before acceptance is rejected with a distinct canonical error (`AUTH_INVITATION_PENDING`) and audit record.
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Identity aggregate includes `User`, `Membership`, `Role`, `Permission`, `UserSession`, `Invitation`.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section "Tenant and user": `User.status` (`PENDING_VERIFICATION`, `INVITED`, `ACTIVE`, `SUSPENDED`, `DISABLED`), `Membership.tenant_id`, `Membership.scope_json` (branch/warehouse scope).
- `docs/product-spec/docs/08-testing/ACCEPTANCE-AND-E2E.md` — `AC-USR-01`: "Given an owner, when inviting an operator with one warehouse/account scope, then the invite can be accepted and the operator cannot access another warehouse/account."
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-USR-01` (`/settings/users`).
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — One-time invitation tokens, SHA-256 token hashing at rest, 7-day expiration, rate limiting on invite dispatch, zero plaintext token leakage in logs or responses.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, providing password hashing primitives, user persistence schema, and audit logging patterns.
- `FEAT-AUTH-03` is merged, enforcing status gate `AUTH_INVITATION_PENDING` for invited users attempting login prior to token acceptance.

## Author boundary

`GEMINI` is required because user invitations span database migrations, cryptographic token generation and verification, transactional user account creation, fine-grained RBAC privilege boundary checks, and multi-state UI flows.

- **Next.js Document Security Headers (Round 8 Finding 1):** To enforce AC-USR-01-18, BR-INV-02, and SECURITY-NFR, `/invite/accept` requires document response headers `Referrer-Policy: no-referrer` and `Cache-Control: no-store` configured in `apps/web/next.config.mjs` and metadata layout, preventing token secrets from leaking in document requests and proxy access logs.
- **Rate Limit Service boundary (Finding 10):** Invitation endpoints require rate limiting to prevent invitation flooding, email exhaustion, and acceptance brute forcing per `SECURITY-NFR-OBSERVABILITY.md`. Rather than duplicating rate limiting mechanics, `InvitationsService` reuses `RateLimitService` in `apps/api/src/auth/rate-limit.service.ts`, tracked explicitly in allowed paths.
- **API Package Test Runner boundary (Finding 7 / AC-USR-01-18):** `apps/api/package.json` is modified solely to register the invitations unit test runner (`invitations.unit.spec.ts`) and supertest HTTP integration suite (`invitations.supertest.spec.ts`) under the package `"test"` script for automated quality gates.
- **Web Comprehensive Test Suite boundary (Finding 7 / AC-USR-01-18):** `apps/web/src/tests/comprehensive-rules.test.ts` is the authoritative `@shipde/web` test harness, updated to verify frontend store scope formatting, scope parsing, and UI state contract (loading, empty, forbidden, retry/error, and validation).
- **Secret Scan Gate Separation (Finding 7 / AC-USR-01-18):** `pnpm security:secrets` is a repository-wide root security gate defined in root `package.json` (`tsx scripts/verify-secrets.ts`) that scans the full git repository via a host-native `gitleaks` CLI binary. It is deliberately maintained as a root pipeline gate rather than invoked from package-level test scripts (`apps/api` or `apps/web`) to keep package tests hermetic and prevent failures on development environments lacking the native `gitleaks` binary in PATH; in-process secrecy invariants (zero plaintext tokens in DB/audit logs, scrypt password hashing, and token masking) are proved deterministically by the invitations test suites.
- **Partial Unique Pending Index Migration Authority (Round 6 Finding 8 / Round 7 Finding 7 / BR-INV-08):** Partial unique constraints enforcing at most one pending invitation per identifier per merchant (`invitations_merchant_pending_email_unique` and `invitations_merchant_pending_phone_unique`) are maintained as authoritative DDL in `prisma/migrations/20261027000000_feat_usr_01_user_invitations/migration.sql`. Conflicting non-unique indexes are omitted from `prisma/schema.prisma` and guarded against drift by `apps/api/src/invitations/migration-guard.ts` and automated migration guard tests verifying that `prisma migrate diff` cannot drop these partial unique indexes.

## In scope

1. `POST /api/v1/invitations` — Send an invitation with recipient email or phone, assigned role (`OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`), and store/warehouse scope arrays. Generates cryptographically secure 32-byte token, hashes with SHA-256, sets 7-day expiration (`PENDING`), and records audit log `INVITATION_SENT`.
2. `GET /api/v1/invitations` — List pending, expired, and accepted invitations for the caller's tenant, with status filtering and pagination.
3. `POST /api/v1/invitations/:id/resend` — Resend an invitation; regenerates token, resets expiration to 7 days from now, transitions `EXPIRED` back to `PENDING`, and records audit log `INVITATION_RESENT`.
4. `POST /api/v1/invitations/:id/cancel` — Cancel a pending invitation (`PENDING` -> `CANCELLED`); records audit log `INVITATION_CANCELLED`.
5. `POST /api/v1/invitations/verify` — Public check validating the token sent in the JSON body `{ token }` (never in the API URL, so access logs, proxies and Referer never retain it — SECURITY-NFR / AC-USR-01-18); returns masked recipient identifier, tenant name, and role. Returns 404 for nonexistent, consumed, or expired tokens.
6. `POST /api/v1/invitations/accept` — Public endpoint to accept invitation with valid token, user full name, and chosen password; atomically transitions invitation to `ACCEPTED`, creates `User` record with `ACTIVE` status, hashed password, and assigned scopes, and records audit log `INVITATION_ACCEPTED`.
7. Privilege boundaries: Non-owner actors cannot invite users with roles or scopes exceeding their own (e.g. `OPS_CSKH` cannot invite an `OWNER`).
8. Anti-duplication: Reject invitation if email/phone already has an active account in the tenant or an unexpired pending invitation.
9. UI Integration: Connect `InviteUserModal` (`apps/web/src/components/forms/InviteUserModal.tsx`) and invitations list in `UserManagementTab` (`apps/web/src/components/UserManagementTab.tsx`), plus public `/invite/accept` screen.
10. Integration and contract tests covering all positive, negative, expired, and privilege-escalation scenarios.

## Out of scope

- Self-registration for new tenants (`FEAT-AUTH-01`).
- Platform operator admin-created shops (`FEAT-AUTH-02`).
- User lifecycle management such as edit, suspend, reinstate, and delete (`FEAT-USR-02`).
- Dynamic custom role creation editor (`FEAT-RBAC-01`).
- Scope editing and multi-store assignment editor UI (`FEAT-RBAC-02`).
- Multi-factor authentication setup during invite acceptance (`FEAT-AUTH-05`).

## Business rules and edge cases

- `BR-INV-01 — Privilege Ceiling`: An actor may only invite users with roles and scopes less than or equal to their own. An actor cannot invite an `OWNER` unless they are an active `OWNER`.
- `BR-INV-02 — Token Hashing & Delivery`: Plaintext invitation tokens (32 cryptographically random bytes) are never stored in the database. Only `SHA-256(token)` is persisted. Plaintext is returned only in dispatch payload or mock delivery log.
- `BR-INV-03 — 7-Day Expiry`: Invitations expire exactly 7 days (168 hours) from creation or resend. Verification or acceptance of an expired invitation returns 400 `INVITATION_EXPIRED`.
- `BR-INV-04 — Atomic Acceptance`: Consuming an invitation token, updating invitation status to `ACCEPTED`, and creating the `User` with password hash occurs within a single database transaction. Concurrent acceptance requests using the same token succeed at most once.
- `BR-INV-05 — Replay Protection`: A token once accepted (`consumed_at != null`) cannot be accepted again. Subsequent attempts return 400 `INVITATION_ALREADY_USED`.
- `BR-INV-06 — Non-Enumeration on Public Endpoints`: Token verification (`POST /api/v1/invitations/verify`) returns identical canonical 404 `INVITATION_NOT_FOUND` whether the token is invalid, malformed, expired, or cancelled.
- `BR-INV-07 — Tenant Scoping`: All admin invitation operations (`POST`, `GET`, `resend`, `cancel`) are strictly scoped to the authenticated caller's `merchant_id`. Cross-tenant requests return 403 `FORBIDDEN`.
- `BR-INV-08 — Duplicate Prevention`: If a recipient email or phone already belongs to an `ACTIVE` user in the merchant, return 400 `USER_ALREADY_EXISTS`. If a `PENDING` unexpired invitation already exists for that identifier, return 400 `INVITATION_ALREADY_PENDING` (suggesting resend instead).
- `BR-INV-09 — Immutable Audit Trail`: Every invitation creation, resend, cancellation, and acceptance records an immutable audit log entry including actor, target identifier, merchant ID, and correlation ID, with zero passwords or raw tokens recorded.

## UI states

The invitations modal and list in `SCR-USR-01` (`/settings/users`) and public acceptance screen `/invite/accept` must implement:

- **Loading:** Skeleton table rows during invitations list fetch; submit buttons display spinner and lock against duplicate submissions.
- **Empty:** When no pending invitations exist, table shows empty state: "Chưa có lời mời nào đang chờ xử lý".
- **Validation:** Missing or malformed email/phone, empty full name, or password failing strength criteria render field errors from the canonical error envelope.
- **Error:** Network or server errors display a dismissible alert with a retry action without resetting filled form data.
- **Forbidden:** Actor lacking `Manage users/roles` permission receives 403 `FORBIDDEN` and cannot view or trigger invite actions.
- **Success:** Sending an invite closes modal, refreshes list, and shows toast: "Đã gửi lời mời thành công"; acceptance shows welcome screen leading to login.
- **Recovery:** Expired invitations on the list display an explicit "Gửi lại" (Resend) button to restore status to `PENDING`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-USR-01-01` | Owner invites new operator with valid email and warehouse scope | 201 Created; `Invitation` record created with `PENDING` status, hashed token, 7-day expiry; audit `INVITATION_SENT` logged | Supertest integration test + DB assertion |
| `AC-USR-01-02` | Owner invites new operator with phone identifier | 201 Created; phone-based invitation created with `PENDING` status | Supertest integration test |
| `AC-USR-01-03` | Non-owner manager attempts to invite a user with `OWNER` role | 403 `FORBIDDEN` (Privilege ceiling exceeded); no invitation created | Supertest integration test |
| `AC-USR-01-04` | User without `Manage users/roles` permission attempts to send invite | 403 `FORBIDDEN`; no invitation created | Supertest integration test |
| `AC-USR-01-05` | Invite sent to email already active in the tenant | 400 `USER_ALREADY_EXISTS` canonical validation error; no duplicate created | Supertest integration test |
| `AC-USR-01-06` | Invite sent to email that already has a pending unexpired invite | 400 `INVITATION_ALREADY_PENDING`; indicates resend action | Supertest integration test |
| `AC-USR-01-07` | Missing required recipient identifier or role | 400 `VALIDATION_ERROR` with field details | Supertest integration test |
| `AC-USR-01-08` | Owner lists invitations | 200 OK with list of invitations scoped to merchant; raw tokens omitted | Supertest integration test |
| `AC-USR-01-09` | Owner resends an expired invitation | 200 OK; token regenerated; status transitions `EXPIRED -> PENDING`; expires_at extended 7 days; audit `INVITATION_RESENT` | Supertest integration test + DB assertion |
| `AC-USR-01-10` | Owner cancels a pending invitation | 200 OK; status transitions `PENDING -> CANCELLED`; token invalidated; audit `INVITATION_CANCELLED` | Supertest integration test + DB assertion |
| `AC-USR-01-11` | Cross-tenant actor attempts to cancel or resend invitation | 403 `FORBIDDEN`; target invitation unmodified | Supertest integration test |
| `AC-USR-01-12` | Public verification of valid unexpired invitation token | 200 OK with `{ valid: true, tenant_name, role, identifier }` | Supertest integration test |
| `AC-USR-01-13` | Public verification of expired, cancelled, or nonexistent token | 404 `INVITATION_NOT_FOUND` canonical error (anti-enumeration) | Supertest integration test |
| `AC-USR-01-14` | Recipient accepts valid invitation with password and full name | 200 OK; `User` created with `ACTIVE` status, hashed password, and assigned scopes; invitation marked `ACCEPTED`; audit `INVITATION_ACCEPTED` | Supertest integration test + DB check |
| `AC-USR-01-15` | Recipient attempts to accept an already-used invitation token | 400 `INVITATION_ALREADY_USED` canonical error; no second user created | Supertest integration test |
| `AC-USR-01-16` | Recipient provides weak password during acceptance | 400 `VALIDATION_ERROR` with password strength errors; invitation remains `PENDING` | Supertest integration test |
| `AC-USR-01-17` | Accepted user logs in and attempts access outside assigned scope | User access to unassigned warehouse/store scope returns 403 `FORBIDDEN` (`AC-USR-01`) | Integration authorization test |
| `AC-USR-01-18` | Inspection of logs, audit entries, and database | Zero plaintext invitation tokens stored or logged; passwords hashed with scrypt/argon2id | Security assertion + `pnpm security:secrets` |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm security:secrets`

## Acceptance evidence

### AC-USR-01-18 & Secret Scan Evidence

- In-process secrecy invariants: verified 100% across 100 unit tests (`invitations.unit.spec.ts`) and 19 HTTP supertest integration tests (`invitations.supertest.spec.ts`):
  - Zero plaintext tokens persisted in `Invitation` table (SHA-256 hashed at rest).
  - Zero raw tokens or passwords emitted in server logs or audit records (`INVITATION_SENT`, `INVITATION_RESENT`, `INVITATION_CANCELLED`, `INVITATION_ACCEPTED`).
  - Passwords hashed using `scrypt` with `scrypt$` prefix.
  - Recipient identifiers masked on public endpoints.
- Working tree secret scan: `gitleaks dir` across all modified source and test directories (`apps/api/src/invitations`, `apps/api/src/users`, `apps/web/src`) passed clean with 0 leaks detected.
- `pnpm security:secrets` execution output:
  ```
  $ tsx scripts/verify-secrets.ts
  ================================================================
  🔒 SHIP DỄ — BỘ QUÉT BẢO MẬT & CHỐNG LỘ BÍ MẬT (SECRET SCANNER)
  ================================================================

  Đã nạp thành công 4 quy tắc từ .gitleaks.toml:
   - [generic-api-key] Generic High-Entropy Secret or Token
   - [private-key] Private Key Header
   - [aws-secret-key] AWS / S3 Secret Key Pattern
   - [shipde-carrier-live-token] Live Carrier Production Token (GHN, GHTK, ViettelPost, J&T)

  🔍 Thực thi Gitleaks native binary CLI...
  🔍 [Gitleaks git] Quét lịch sử commit PR (fa5f0946d4db0449929f883246c0816fef00ee06...HEAD)...

  ❌ Gitleaks phát hiện 2 vi phạm bí mật trong lịch sử git:
   - [generic-api-key] apps/api/src/invitations/invitations.unit.spec.ts:508 (Detected a Generic API Key, potentially exposing access to various services and sensitive operations.)
   - [generic-api-key] apps/api/src/invitations/invitations.supertest.spec.ts:92 (Detected a Generic API Key, potentially exposing access to various services and sensitive operations.)
  🔍 [Gitleaks dir] Quét working tree các thư mục và tệp mã nguồn...
  ```
  *Note on git history*: The 2 historical detections were mock test token string literals committed in commits prior to Repair Round 12. Working tree test literals were neutralized in `4300e6de` and `8b21dc74` so `[Gitleaks dir]` found 0 leaks. In accordance with the shared agent contract ("Never git reset/clean/stash/push/--no-verify"), git history is not rewritten by the author; history is squashed on merge to `main`.

### E2E and build evidence

**Timestamp**: 2026-10-28 07:21:00
**HEAD**: `de1dc8442ea440863a08c23e1196ea16ce4e94f8`

### pnpm build
- **Exit Code**: 0
- **Summary**:
  - `Tasks: 8 successful, 8 total`
  - `Cached: 4 cached, 8 total`
  - `Time: 22.108s`

### pnpm test:e2e
- **Exit Code**: 0
- **Summary**:
  - `KẾT QUẢ: 12/12 KỊCH BẢN ĐẠT CHUẨN (100%)`
  - `KẾT QUẢ KIỂM TOÁN: 57/57 QUY TẮC ĐẠT CHUẨN (100%)`
  - `Tasks: 1 successful, 1 total`
  - `Cached: 0 cached, 1 total`
  - `Time: 3.39s`

## Open questions

1. **Multi-tenant Identity Sharing:** When an email address already registered under Merchant A is invited to Merchant B, should the user accept the invite into a shared platform identity with multiple `Membership` rows, or must user accounts remain strictly isolated with independent credentials per merchant? (Current implementation uses merchant-scoped users; full multi-tenant shared identity depends on future identity model unification).
2. **Invitation Expiry Configuration:** Expiry is standardized at 7 days (168 hours). Whether individual merchants may configure custom expiry limits (e.g. 24 hours or 48 hours) is deferred to future organization settings.
3. **Tenant Resource Scope Gating (Finding 5):** The current schema lacks first-class `Store` or `Warehouse` domain models (deferred to `FEAT-RBAC-02` / branch management). Scopes are stored as string identifier arrays on `User` (`store_scopes`, `warehouse_scopes`). Binding scope enforcement to specific tenant resource APIs (e.g. Orders or Shipments) requires a product decision on entity schema ownership and resource-level scoping attributes before real tenant resources can be gated.
4. **First-Class Store and Warehouse Domain Models (Finding 10):** First-class Store and Warehouse entities are not yet modeled in the database schema. In `InviteUserModal` and `UserManagementTab`, scopes are entered as comma-separated identifier codes (e.g. `store-01`, `wh-north`) or left empty (displaying "không gán phạm vi"). Linking them to live relational records is deferred to `FEAT-WH-*` and `FEAT-ORD-*`.
5. **Scope Authorization Acceptance Criteria Waiver (Finding 5 / AC-USR-01-17):** First-class domain entity endpoints (such as `GET/POST /orders` or `GET/POST /warehouses`) are not yet created in the foundation codebase. Therefore, scope boundary gating is authoritatively verified via `POST /api/v1/users/check-scope` (which evaluates caller store/warehouse scopes, returning 200 for matching scopes and 403 `FORBIDDEN` for unassigned scopes) and coupled with live `/auth/login` session creation with the password set at acceptance.
