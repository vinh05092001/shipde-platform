# FEAT-AUTH-06 — Session management

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-AUTH-06` |
| Feature ID      | `FEAT-AUTH-06` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 10 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `MEDIUM` |
| Risk domains    | `auth`, `security`, `tenant isolation`, `database ownership` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/session/*`, `apps/api/src/app.module.ts`, `packages/testkit/src/msw/handlers.ts`, `packages/contracts/src/index.ts`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-AUTH-06.md`, `apps/web/src/app/sessions/*`, `apps/web/src/components/sessions/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-auth-06-sessions` |
| Pull Request    | [#446](https://github.com/vinh05092001/shipde-platform/pull/446) |

## Business outcome

An authenticated merchant user can list all active sessions across devices, revoke any specific session, revoke all other sessions at once (logout everywhere), and maintain active session freshness via heartbeat while inactive (30 days) and expired (90 days) sessions are systematically terminated and rejected.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-AUTH-06`: Session management ("List/revoke sessions, inactivity expiry, logout all").
- `docs/product-spec/evidence/PROTOTYPE-GAPS-AND-RISKS.md` — Section "Session & Token Management": replace hardcoded prototype tokens and in-memory session mocks with database-backed revocable sessions.
- `docs/product-spec/contracts/openapi.yaml` — Operations `listSessions` (`API-SESSION-LIST`), `revokeSession` (`API-SESSION-REVOKE`), `heartbeatSession` (`API-SESSION-HEARTBEAT`), and `revokeAllSessions` (`API-SESSION-REVOKE-ALL`); Schemas `SessionInfo`, `ListSessionsResponse`, `RevokeSessionResponse`, `RevokeAllSessionsRequest`, `RevokeAllSessionsResponse`, `HeartbeatSessionResponse`.
- `prisma/schema.prisma` — Model `DeviceSession` (fields `id`, `user_id`, `merchant_id`, `session_token_hash`, `device_id`, `device_model`, `user_agent`, `ip_address`, `is_revoked`, `status`, `last_active_at`, `expires_at`, `revoked_at`, `revoked_by`, `revoke_reason`, `created_at`).
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — `/sessions` ownership and tenant-scoping rules.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Token hashing (SHA-256), IP pseudonymization via HMAC-SHA256 in audit logs, and zero secret leakage.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing repository contracts, linting, and quality test gates.
- `prisma/schema.prisma` contains the `DeviceSession` model and `SessionStatusEnum` (`ACTIVE`, `REVOKED`, `EXPIRED`, `INACTIVE`).
- PostgreSQL database is accessible and migrations are generated via `pnpm db:generate`.

## Author boundary

`GEMINI` is assigned as the primary implementation author because session lifecycle touches authentication tokens, database transactions, audit logging, and tenant isolation boundaries.

## In scope

1. `POST /api/v1/sessions` — Internal creation of session records during successful login.
2. `GET /api/v1/sessions` — List active sessions for the calling user within their merchant tenant, flagging `is_current=true` for the active token.
3. `DELETE /api/v1/sessions/:sessionId` — Revoke a single session owned by the caller; idempotent if already revoked.
4. `POST /api/v1/sessions/revoke-all` — Revoke all sessions for current user with optional `include_current` flag.
5. `PATCH /api/v1/sessions/:sessionId/heartbeat` — Update `last_active_at` for the current active session only.
6. Inactivity expiry threshold (30 days) and absolute lifetime (90 days).
7. `SessionGuard` — Request-time Bearer token verification against `DeviceSession`, rejecting expired/revoked/inactive sessions.
8. Transactional audit logging for `SESSION_REVOKED` and `SESSIONS_REVOKED_ALL` with transaction rollback upon failure.
9. IP address hashing using HMAC-SHA256 with `AUDIT_IDENTIFIER_HMAC_KEY` in audit records.
10. Supertest integration test suite covering positive, negative, and edge-case scenarios.

## Out of scope

- Login credentials validation and initial token issuance UI (`FEAT-AUTH-03`).
- Multi-factor authentication challenges and step-up verification (`FEAT-AUTH-05`).
- Password recovery and reset tokens (`FEAT-AUTH-04`).
- Distributed Redis caching or token blacklist infrastructure.
- Third-party social logins or SSO identity providers.

## Business rules and edge cases

- `BR-SESS-01 — Tenant and User Scoping`: Every session lookup and revocation is scoped server-side to `merchant_id` and `user_id`. Accessing or revoking another user's or tenant's session returns 403 `FORBIDDEN`.
- `BR-SESS-02 — Token Hashing`: Raw session tokens are never persisted or returned by the API. The API stores and searches by `session_token_hash` (SHA-256).
- `BR-SESS-03 — Absolute Lifetime`: Every session has an absolute lifetime of 90 days (`expires_at`). Sessions past this date are marked `EXPIRED` and cannot be revived.
- `BR-SESS-04 — Inactivity Threshold`: A session with `last_active_at` older than 30 days is treated as `EXPIRED` and rejected by `SessionGuard`.
- `BR-SESS-05 — Heartbeat Scope`: `PATCH /api/v1/sessions/:sessionId/heartbeat` is permitted solely for the caller's current session (`sessionId === req.sessionId`) and requires `ACTIVE` status. Non-current or non-active sessions return 403 `FORBIDDEN`.
- `BR-SESS-06 — Idempotent Revocation`: Revoking a session that is already in `REVOKED` status returns 200 OK without error and without duplicating revocation timestamps.
- `BR-SESS-07 — Audit Transactionality`: Revocation mutations and audit log insertions run inside a Prisma transaction. An audit failure rolls back the session revocation and returns 500.
- `BR-SESS-08 — Revoke All Exclusions`: `POST /api/v1/sessions/revoke-all` with `include_current=false` revokes all active sessions except the calling session. With `include_current=true`, all sessions including the calling session are revoked.
- `BR-SESS-09 — Zero Secret Disclosure`: Listing endpoints and error payloads never disclose session tokens or hashes. Client IP addresses are HMAC-hashed in audit records.
- `BR-SESS-10 — Malformed Identifier Protection`: Malformed UUID session parameters return canonical 404 `SESSION_NOT_FOUND` identical to non-existent UUIDs to prevent enumeration.

## UI states

Affected UI surfaces (e.g. `UserManagementTab` remote sessions subtab and `/sessions` view) must implement:

- **Loading:** Display skeleton card/table rows while `GET /api/v1/sessions` is in flight; submit buttons display inline spinner and are locked against duplicate clicks.
- **Empty:** When no remote sessions exist, display clear message: "Không có thiết bị đăng nhập nào khác".
- **Validation:** Malformed sessionId parameters in URL paths or payloads display validation errors from the canonical error envelope.
- **Error:** Server or network errors display an alert banner with retry capability without blanking current UI state.
- **Forbidden:** Cross-tenant or unauthorized revocation attempts display a permission-denied notice (403 `FORBIDDEN`).
- **Success:** Successful revocation immediately updates row status or removes card, displaying confirmation toast with revoked count.
- **Recovery:** Failed actions allow immediate user retry; idempotent backend endpoints ensure duplicate clicks do not produce error states.

## Acceptance matrix

| AC/Test ID | Scenario | Action | Expected outcome | Evidence required |
| --- | --- | --- | --- | --- |
| `AC-SESS-01` | Active user logs in | Session creation | `DeviceSession` row created in DB with `ACTIVE` status, SHA-256 token hash, 90-day `expires_at`, and `last_active_at` | Database assertion |
| `AC-SESS-02` | Authenticated user requests session list | `GET /api/v1/sessions` with Bearer token | 200 OK with `ListSessionsResponse`; returns sessions for user and merchant; caller's session marked `is_current=true`; token hash omitted | Supertest integration test |
| `AC-SESS-03` | User with only current session requests list | `GET /api/v1/sessions` (Empty remote state) | 200 OK with list containing only current session; UI renders empty remote sessions state | Supertest integration test + UI render |
| `AC-SESS-04` | Session list request in flight | `GET /api/v1/sessions` (Loading state) | Client renders skeleton loading placeholder and interactive revocation buttons remain disabled | UI component test |
| `AC-SESS-05` | Session exceeds 30-day inactivity threshold | `GET /api/v1/sessions` | Session status evaluated as `EXPIRED` in listing; subsequent auth attempt with that token returns 401 `SESSION_INVALID` | Supertest integration test |
| `AC-SESS-06` | Session exceeds 90-day absolute lifetime | Authentication attempt with expired token | 401 `SESSION_INVALID` with `next_action: LOGIN`; request rejected | Supertest integration test |
| `AC-SESS-07` | Owner revokes own active session | `DELETE /api/v1/sessions/:sessionId` | 200 OK with status `REVOKED`; database record updated (`is_revoked=true`, `revoked_at` set); audit log `SESSION_REVOKED` created | Supertest integration test + DB assertion |
| `AC-SESS-08` | Owner revokes already revoked session | `DELETE /api/v1/sessions/:sessionId` (Idempotent / Recovery) | 200 OK with status `REVOKED` and idempotent message; no duplicated audit or timestamp mutation | Supertest integration test |
| `AC-SESS-09` | User attempts to revoke session of another user | `DELETE /api/v1/sessions/:sessionId` (Forbidden cross-user) | 403 `FORBIDDEN` canonical error; target session status remains unmodified | Supertest integration test |
| `AC-SESS-10` | User attempts to revoke session of another merchant | `DELETE /api/v1/sessions/:sessionId` (Forbidden cross-tenant) | 403 `FORBIDDEN` canonical error; target session status remains unmodified | Supertest integration test |
| `AC-SESS-11` | User requests revocation with nonexistent UUID | `DELETE /api/v1/sessions/:nonexistentId` (Not found) | 404 `SESSION_NOT_FOUND` canonical error | Supertest integration test |
| `AC-SESS-12` | User requests revocation with malformed ID | `DELETE /api/v1/sessions/invalid-uuid` (Validation / Not found) | 404 `SESSION_NOT_FOUND` canonical error matching nonexistent ID shape | Supertest integration test |
| `AC-SESS-13` | Current active session sends heartbeat | `PATCH /api/v1/sessions/:currentSessionId/heartbeat` | 200 OK with updated `last_active_at` timestamp | Supertest integration test |
| `AC-SESS-14` | User sends heartbeat for non-current session | `PATCH /api/v1/sessions/:otherSessionId/heartbeat` (Forbidden) | 403 `FORBIDDEN` canonical error; timestamp not updated | Supertest integration test |
| `AC-SESS-15` | User sends heartbeat for inactive session | `PATCH /api/v1/sessions/:inactiveSessionId/heartbeat` | 403 `SESSION_NOT_ACTIVE` canonical error | Supertest integration test |
| `AC-SESS-16` | User revokes all sessions excluding current | `POST /api/v1/sessions/revoke-all` with `{ include_current: false }` | 200 OK with `revoked_count` matching remote sessions; current session remains `ACTIVE`; audit `SESSIONS_REVOKED_ALL` recorded | Supertest integration test |
| `AC-SESS-17` | User revokes all sessions including current | `POST /api/v1/sessions/revoke-all` with `{ include_current: true }` | 200 OK with `revoked_count` including current; subsequent requests with caller token return 401 `SESSION_INVALID` | Supertest integration test |
| `AC-SESS-18` | User revokes all sessions when none active | `POST /api/v1/sessions/revoke-all` (Empty state) | 200 OK with `revoked_count: 0` and message indicating no sessions to revoke | Supertest integration test |
| `AC-SESS-19` | Request sent without Authorization header | Request to any `/api/v1/sessions` endpoint (Unauthenticated) | 401 `UNAUTHENTICATED` canonical error | Supertest integration test |
| `AC-SESS-20` | Audit logging fails during revocation | `DELETE /api/v1/sessions/:sessionId` (Error rollback) | Transaction rolls back; 500 error returned; session remains `ACTIVE` in database | Supertest integration test + DB check |
| `AC-SESS-21` | Security inspection of API responses and logs | Audit logs, API responses, error envelopes | Zero raw tokens or SHA-256 hashes returned; client IP stored as HMAC-SHA256 hash | Supertest assertion + `pnpm security:secrets` |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `npx tsx apps/api/src/session/session.supertest.spec.ts`

## Verification evidence (AC-SESS-21)

```
$ pnpm security:secrets
================================================================
🔒 SHIP DỄ — BỘ QUÉT BẢO MẬT & CHỐNG LỘ BÍ MẬT (SECRET SCANNER)
================================================================

Đã nạp thành công 4 quy tắc từ .gitleaks.toml:
 - [generic-api-key] Generic High-Entropy Secret or Token
 - [private-key] Private Key Header
 - [aws-secret-key] AWS / S3 Secret Key Pattern
 - [shipde-carrier-live-token] Live Carrier Production Token (GHN, GHTK, ViettelPost, J&T)

❌ LỖI: Không tìm thấy native binary Gitleaks CLI (gitleaks) trong PATH hoặc môi trường hệ thống!
   Gate bảo mật secret bắt buộc phải có Gitleaks native CLI để đảm bảo toàn bộ quy tắc mặc định và quy tắc mở rộng hoạt động đầy đủ.
Exit code: 2 (Gitleaks binary absent in local Windows dev environment; Gitleaks 8.24.0 authoritative in CI pipeline)

Local Defense-in-Depth Staged Secret Scan (lefthook pre-commit / AI-36-R05):
$ node tools/ai-guard/cli.js staged-secrets
STAGED_SCAN_CLEAN: 0 secrets detected

$ node tools/ai-guard/cli.js check
SECRET_SURFACE_CLEAN
files scanned: 785
```

## Open questions

1. **Canonical Error Catalog Alignment:** `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` does not catalog `SESSION_NOT_FOUND`, `SESSION_NOT_ACTIVE`, or `SESSION_INVALID`. While implemented and tested in OpenAPI contracts, formal catalog inclusion requires product sign-off.
2. **UI Surface Specification:** `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` does not define a dedicated `SCR-SESS-*` screen specification. Remote device sessions currently exist only as an in-memory prototype subtab in `apps/web/src/components/UserManagementTab.tsx`. Product guidance is required on whether `FEAT-AUTH-06` delivers a standalone `/settings/sessions` route or defers the UI surface to `FEAT-USR-01`.
3. **Explicit Refresh Token Endpoint:** Current specs use heartbeat to update `last_active_at`, but whether a sliding token exchange (`POST /sessions/refresh`) is required alongside the compact stateless access token is not specified in `openapi.yaml`.
