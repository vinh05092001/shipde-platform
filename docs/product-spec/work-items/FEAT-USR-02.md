# FEAT-USR-02 — User lifecycle

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-USR-02` |
| Feature ID      | `FEAT-USR-02` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 12 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `auth`, `security`, `tenant isolation`, `database ownership` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/users/*`, `apps/api/src/session/*`, `apps/api/src/app.module.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-USR-02.md`, `apps/web/src/components/UserManagementTab.tsx`, `apps/web/src/app/settings/users/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-usr-02-user-lifecycle` |
| Pull Request    | Pending |

## Business outcome

A shop owner or authorized administrator can manage the full lifecycle of merchant team members: view user profiles, edit display names, adjust roles and branch/warehouse scopes, suspend rogue or inactive users (atomically revoking all active sessions), reinstate suspended accounts, and permanently deactivate accounts, with rigorous server-side enforcement preventing self-suspension or removal of the shop's last remaining owner.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-USR-02`: User lifecycle ("Create, edit, activate, suspend, revoke sessions").
- `docs/product-spec/docs/02-business/STATE-MACHINES.md` — Section "User registration and lifecycle (ST-USER)": `ACTIVE --> SUSPENDED: admin suspension (FEAT-USR-02)`, `SUSPENDED --> ACTIVE: admin reinstate`, `ACTIVE --> DISABLED: account deactivation`.
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-USR-01`: Invite and authorize a user (Rules: "cannot remove the last owner; cannot grant permissions the actor does not possess. Audit: invite, resend, role/scope change, revoke").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Manage users/roles": Owner full action (`A`), Ops manager scoped action (`S`), others denied (`-`). Rules: "A user cannot grant a permission they do not hold", "Backend is authoritative; hidden UI controls are insufficient", "Permission evaluation includes tenant, branch, warehouse and carrier-account scope."
- `docs/product-spec/docs/02-business/BUSINESS-RULES-DECISION-TABLES.md` — `BR-AUTH-13`: Login of a `suspended` or `disabled` user is rejected with distinct canonical error envelopes (`AUTH_ACCOUNT_SUSPENDED`, `AUTH_ACCOUNT_DISABLED`) and audit records.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section "Tenant and user": `User.status` (`ACTIVE`, `SUSPENDED`, `DISABLED`), `User.role`, `Membership.scope_json`.
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-USR-01` (`/settings/users`).
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — `/users` module ownership and tenant isolation.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Immediate session revocation on account status change, tenant boundary verification, immutable audit logging.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and quality gates.
- `FEAT-AUTH-06` is merged, providing `SessionService.revokeTargetUserSessions` for atomic device session revocation upon account suspension or deactivation.
- `FEAT-AUTH-03` is merged, providing status gate checks (`AUTH_ACCOUNT_SUSPENDED`, `AUTH_ACCOUNT_DISABLED`) on login.

## Author boundary

`GEMINI` is required because this Work Item modifies user authority, executes multi-table database transactions (updating user status while cascading session invalidation), enforces tenant isolation, and touches core security audit logging.

## In scope

1. `GET /api/v1/users` — List all users belonging to caller's merchant tenant, supporting pagination, role filtering, and search by name/email/phone.
2. `GET /api/v1/users/:id` — Retrieve detailed user record within merchant, including role, status, store scopes, warehouse scopes, and last active timestamp.
3. `PATCH /api/v1/users/:id` — Update user full name, assigned role, store scopes, and warehouse scopes.
4. `POST /api/v1/users/:id/suspend` — Transition user status from `ACTIVE` to `SUSPENDED`; requires a non-empty suspension reason; atomically invokes session revocation for all active device sessions of the target user; logs `USER_SUSPENDED`.
5. `POST /api/v1/users/:id/activate` — Reinstate user status from `SUSPENDED` back to `ACTIVE`; logs `USER_ACTIVATED`.
6. `POST /api/v1/users/:id/deactivate` — Transition user status to `DISABLED`; revokes all active device sessions; logs `USER_DEACTIVATED`.
7. Last Owner Invariant: Reject any attempt to suspend, deactivate, or change the role of the sole remaining `ACTIVE` user with role `OWNER` in the merchant.
8. Self-Mutation Guard: Prevent actors from suspending or deactivating their own accounts.
9. Privilege Ceiling: Ensure an actor cannot promote a user to a role higher than their own or grant scopes outside their own authority.
10. Web UI integration in `UserManagementTab` (`apps/web/src/components/UserManagementTab.tsx`): connect user list, edit modal, suspend/activate action buttons, and confirmation dialogs.
11. Comprehensive integration and security test suite covering lifecycle transitions, audit logging, and authorization boundaries.

## Out of scope

- Initial shop owner creation (`FEAT-AUTH-01`, `FEAT-AUTH-02`).
- User invitation dispatch and token acceptance (`FEAT-USR-01`).
- Dynamic custom role creation editor (`FEAT-RBAC-01`).
- Permanent GDPR/PII hard erasure or data scrubbing (`FEAT-SEC-01`).
- Self-service personal profile editing (`FEAT-PRO-01`).

## Business rules and edge cases

- `BR-USR-01 — Sole Owner Protection`: A tenant must have at least one active user with role `OWNER`. Any mutation (`suspend`, `deactivate`, or role demotion) that leaves zero active `OWNER` accounts in the tenant is rejected with 400 `CANNOT_REMOVE_LAST_OWNER`.
- `BR-USR-02 — Self-Disruption Prohibition`: An authenticated actor cannot suspend or deactivate their own user account (`targetUserId === actorUserId`). Self-actions return 400 `SELF_SUSPENSION_PROHIBITED`.
- `BR-USR-03 — Immediate Session Invalidation`: When a user is suspended or deactivated, the system atomically updates the user status and revokes all active `device_sessions` for that user using `revokeTargetUserSessions`. Any subsequent request with existing tokens is rejected by `SessionGuard` with 401 `SESSION_INVALID`.
- `BR-USR-04 — Status Transition Safety`:
  - `suspend` is valid ONLY when current status is `ACTIVE`.
  - `activate` is valid ONLY when current status is `SUSPENDED`.
  - `deactivate` is valid from `ACTIVE` or `SUSPENDED`.
  - Invalid transitions return 409 `INVALID_STATUS_TRANSITION`.
- `BR-USR-05 — Privilege Boundary Check`: An actor cannot assign a role or scopes they do not possess. Non-owners cannot assign `OWNER` role.
- `BR-USR-06 — Tenant Scoping`: All operations are strictly validated against caller's `merchant_id`. Targeting a user from another tenant returns 403 `FORBIDDEN` without revealing target existence.
- `BR-USR-07 — Mandatory Suspension Reason`: Suspending a user requires a non-blank `reason` in the request body for auditing purposes. Omission returns 400 `VALIDATION_ERROR`.
- `BR-USR-08 — Immutable Audit Logging`: Every lifecycle event (`USER_UPDATED`, `USER_SUSPENDED`, `USER_ACTIVATED`, `USER_DEACTIVATED`) writes an immutable record to `audit_logs` inside the same database transaction.

## UI states

The user management interface in `SCR-USR-01` (`/settings/users`) must implement:

- **Loading:** Skeleton rows displayed during user list retrieval; action buttons (Suspend, Activate, Save) show spinner and disable during request.
- **Empty:** When no users match search/filter criteria, display message: "Không tìm thấy người dùng phù hợp".
- **Validation:** Missing full name, empty suspension reason, or invalid scope selections render inline field errors.
- **Error:** Network or server errors display a persistent banner with retry capability without discarding modal form changes.
- **Forbidden:** Non-owner actors viewing users receive view-only or scoped controls; unauthorized mutation attempts show 403 error toast.
- **Success:** Status changes update the table row badge immediately and display confirmation toast: "Đã tạm dừng người dùng thành công".
- **Recovery:** Network failure on action allows safe retry without inconsistent user state.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-USR-02-01` | Owner lists tenant users | 200 OK with paginated list of users for merchant; password hashes omitted | Supertest integration test |
| `AC-USR-02-02` | Owner retrieves single user by ID | 200 OK with user profile, role, scopes, and status | Supertest integration test |
| `AC-USR-02-03` | Owner updates user full name and warehouse scopes | 200 OK with updated user; audit `USER_UPDATED` logged | Supertest integration test + DB assertion |
| `AC-USR-02-04` | Owner suspends an active operator with valid reason | 200 OK; status updated to `SUSPENDED`; all active device sessions revoked; audit `USER_SUSPENDED` logged | Supertest integration test + DB check |
| `AC-USR-02-05` | Suspended user attempts API request with pre-existing session token | 401 `SESSION_INVALID`; request rejected | Supertest integration test |
| `AC-USR-02-06` | Suspended user attempts login with correct credentials | 403 `AUTH_ACCOUNT_SUSPENDED` canonical error; no session issued (`BR-AUTH-13`) | Supertest integration test |
| `AC-USR-02-07` | Owner reinstates a suspended user | 200 OK; status transitions `SUSPENDED -> ACTIVE`; audit `USER_ACTIVATED` logged; user can log in again | Supertest integration test |
| `AC-USR-02-08` | Owner deactivates an active user | 200 OK; status transitions to `DISABLED`; all sessions revoked; audit `USER_DEACTIVATED` logged | Supertest integration test + DB check |
| `AC-USR-02-09` | Disabled user attempts login | 403 `AUTH_ACCOUNT_DISABLED` canonical error; request rejected | Supertest integration test |
| `AC-USR-02-10` | Owner attempts to suspend or deactivate themselves | 400 `SELF_SUSPENSION_PROHIBITED` canonical error; status remains `ACTIVE` | Supertest integration test |
| `AC-USR-02-11` | Owner attempts to suspend or deactivate the sole remaining OWNER | 400 `CANNOT_REMOVE_LAST_OWNER` canonical error; operation blocked | Supertest integration test |
| `AC-USR-02-12` | Actor attempts to suspend a user with blank or missing reason | 400 `VALIDATION_ERROR` with field details on `reason` | Supertest integration test |
| `AC-USR-02-13` | Actor attempts invalid status transition (e.g. suspend already suspended user) | 409 `INVALID_STATUS_TRANSITION` canonical error | Supertest integration test |
| `AC-USR-02-14` | Non-owner manager attempts to promote another user to `OWNER` | 403 `FORBIDDEN` (Privilege ceiling exceeded); user role unmodified | Supertest integration test |
| `AC-USR-02-15` | Cross-tenant actor attempts to view or mutate another merchant's user | 403 `FORBIDDEN`; no target metadata leaked | Supertest integration test |
| `AC-USR-02-16` | User lacking `Manage users/roles` permission attempts user mutation | 403 `FORBIDDEN`; operation rejected | Supertest integration test |
| `AC-USR-02-17` | Audit logging fails during suspension | Database transaction rolls back; 500 error returned; user status remains `ACTIVE` and sessions remain valid | Supertest integration test |
| `AC-USR-02-18` | Inspection of user endpoints and audit logs | Passwords, tokens, and sensitive hashes are never exposed in responses or logs | Security assertion + `pnpm security:secrets` |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm contract:check`
- `pnpm build`
- `apps/api pnpm run test`
- `npx tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/users/users.unit.spec.ts`
- `npx tsx --tsconfig apps/api/tsconfig.json apps/api/src/users/users.supertest.spec.ts`
- `npx tsx apps/web/src/app/settings/users/users-page-states.test.ts`
- `node scripts/ai/check-no-hardcode.mjs`
- `git diff --check`

## Acceptance evidence

### AC-USR-02-01 to AC-USR-02-18 Acceptance Verification

Every acceptance requirement is proven by automated integration and unit test suites:

| AC/Test ID | Scenario | Result | Evidence File & Method |
| --- | --- | --- | --- |
| `AC-USR-02-01` | Owner lists tenant users | PASS | `users.supertest.spec.ts`: GET `/api/v1/users`, 200 OK, paginated, passwords omitted |
| `AC-USR-02-02` | Owner retrieves single user by ID | PASS | `users.supertest.spec.ts`: GET `/api/v1/users/:id`, 200 OK with full profile & scopes |
| `AC-USR-02-03` | Owner updates user full name and warehouse scopes | PASS | `users.supertest.spec.ts`: PATCH `/api/v1/users/:id`, 200 OK, audit `USER_UPDATED` logged in DB |
| `AC-USR-02-04` | Owner suspends an active operator with valid reason | PASS | `users.supertest.spec.ts`: POST `/api/v1/users/:id/suspend`, 200 OK, `SUSPENDED` status, sessions revoked, audit `USER_SUSPENDED` |
| `AC-USR-02-05` | Suspended user attempts API request with pre-existing session token | PASS | `users.supertest.spec.ts`: request with revoked session rejected with 401 `SESSION_INVALID` |
| `AC-USR-02-06` | Suspended user attempts login with correct credentials | PASS | `users.supertest.spec.ts`: login rejected with 403 `AUTH_ACCOUNT_SUSPENDED` (`BR-AUTH-13`) |
| `AC-USR-02-07` | Owner reinstates a suspended user | PASS | `users.supertest.spec.ts`: POST `/api/v1/users/:id/activate`, 200 OK, status `ACTIVE`, audit `USER_ACTIVATED`, login succeeds |
| `AC-USR-02-08` | Owner deactivates an active user | PASS | `users.supertest.spec.ts`: POST `/api/v1/users/:id/deactivate`, 200 OK, status `DISABLED`, sessions revoked, audit `USER_DEACTIVATED` |
| `AC-USR-02-09` | Disabled user attempts login | PASS | `users.supertest.spec.ts`: login rejected with 403 `AUTH_ACCOUNT_DISABLED` |
| `AC-USR-02-10` | Owner attempts to suspend or deactivate themselves | PASS | `users.supertest.spec.ts`: rejected with 400 `SELF_SUSPENSION_PROHIBITED` (`BR-USR-02`) |
| `AC-USR-02-11` | Owner attempts to suspend or deactivate the sole remaining OWNER | PASS | `users.supertest.spec.ts`: rejected with 400 `CANNOT_REMOVE_LAST_OWNER` (`BR-USR-01`) |
| `AC-USR-02-12` | Actor attempts to suspend a user with blank or missing reason | PASS | `users.supertest.spec.ts`: rejected with 400 `VALIDATION_ERROR` (`BR-USR-07`) |
| `AC-USR-02-13` | Actor attempts invalid status transition (e.g. suspend already suspended user) | PASS | `users.supertest.spec.ts`: rejected with 409 `INVALID_STATUS_TRANSITION` (`BR-USR-04`) |
| `AC-USR-02-14` | Non-owner manager attempts to promote another user to `OWNER` | PASS | `users.supertest.spec.ts`: rejected with 403 `FORBIDDEN` (Privilege ceiling, `BR-USR-05`) |
| `AC-USR-02-15` | Cross-tenant actor attempts to view or mutate another merchant's user | PASS | `users.supertest.spec.ts`: rejected with 403 `FORBIDDEN` (`BR-USR-06`) |
| `AC-USR-02-16` | User lacking `Manage users/roles` permission attempts user mutation | PASS | `users.supertest.spec.ts`: rejected with 403 `FORBIDDEN` |
| `AC-USR-02-17` | Audit logging fails during suspension | PASS | `users.supertest.spec.ts`: transaction rollback, 500 error, status & sessions preserved |
| `AC-USR-02-18` | Inspection of user endpoints and audit logs | PASS | `users.supertest.spec.ts`: zero secret leakage; sensitive keys (password/hash/secret/token/auth/apikey) and created secrets (passwords, tokens, hashes, TOTP) verified strictly without regex over display names |

### Detailed Test Execution Evidence

- **Implementation Commits**:
  - `e108d0c0`: `[FEAT-USR-02] feat(contracts): add user lifecycle schemas and contracts`
  - `87142a86`: `[FEAT-USR-02] feat(api): implement user lifecycle endpoints and tests`
  - `de2d550f`: `[FEAT-USR-02] feat(web): implement user lifecycle management UI and states`
  - `a002d29f`: `[FEAT-USR-02] test: scope secret-leak check to sensitive fields and values`
- **Reviewed HEAD SHA**: `a002d29fb67be7b442fb41004e15b592af0cdae3`

1. **User Unit Tests** (`apps/api/src/users/users.unit.spec.ts`):
   - Executed: `npx tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/users/users.unit.spec.ts`
   - Result: 23/23 tests passed, 0 failures, 8 test suites.
   - Verified: List filters, cross-tenant isolation, last owner protection, self-suspension guard, status transitions, audit rollbacks, permission checks.

2. **User Supertest Suite** (`apps/api/src/users/users.supertest.spec.ts`):
   - Executed: `npx tsx --tsconfig apps/api/tsconfig.json apps/api/src/users/users.supertest.spec.ts`
   - Result: `ALL 18 FEAT-USR-02 ACCEPTANCE CRITERIA PASSED SUCCESSFULLY!`.
   - Verified: Live PostgreSQL test against seeded merchant, real signed v1. access tokens, atomic session revocation through `SessionService.revokeTargetUserSessions`, audit log persistence.

3. **User Management Web UI States** (`apps/web/src/app/settings/users/users-page-states.test.ts`):
   - Executed: `npx tsx apps/web/src/app/settings/users/users-page-states.test.ts`
   - Result: `ALL SCR-USR-01 UI STATE AND CONTRACT TESTS PASSED`.
   - Verified: Loading, Empty, Validation, Error with Retry, Forbidden toast, Success toast, and Action dialogs.

4. **API Regression Test Suite** (`apps/api pnpm run test`):
   - Executed: `pnpm --filter @shipde/api run test`
   - Result: All test suites passed cleanly (Config, Health, Outbox, Auth, Session, Invitations, RBAC, TOTP, Admin-shops, Users MFA Reset).

5. **Quality Gate Audits**:
   - `pnpm install --frozen-lockfile`: Scope 8 workspace projects, up to date.
   - `pnpm db:generate`: Prisma Client v6.19.3 generated.
   - `pnpm lint`: 12/12 tasks successful, 0 errors across 7 packages.
   - `pnpm typecheck`: 12/12 tasks successful, 0 type errors across 7 packages.
   - `pnpm format:check`: 13 modified files compliant with Prettier, 0 format errors.
   - `pnpm contract:check`: 54 endpoints verified, 0 contract drift.
   - `pnpm build`: 8/8 turbo tasks successful, 27 static pages generated.
   - `scripts/ai/check-no-hardcode.mjs`: 0 raw instances, 0 new violations.
   - `git diff --check`: 0 whitespace errors.

## Open questions

1. **Hard Deletion / Right to be Forgotten:** Current specification defines lifecycle deactivation (`DISABLED` status) with full audit preservation. Whether an explicit hard-deletion / GDPR anonymization endpoint is required is deferred to `FEAT-SEC-01` (Privacy controls).
2. **Two-Person Approval on Last Owner Transfer:** When transferring ownership or demoting an owner in a multi-owner shop, does the operation require two-person rule / maker-checker confirmation? Currently enforced via sole-owner check only; formal multi-owner transfer workflow is pending product specification.
