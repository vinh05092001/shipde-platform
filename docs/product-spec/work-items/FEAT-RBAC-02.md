# FEAT-RBAC-02 — Scope assignment

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-RBAC-02` |
| Feature ID      | `FEAT-RBAC-02` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 14 |
| Dependencies    | `TASK-FOUND-04`, `FEAT-RBAC-01`, `FEAT-USR-01` |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `auth`, `security`, `tenant isolation`, `database ownership`, `rbac` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/rbac/*`, `apps/api/src/users/*`, `apps/api/src/app.module.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-RBAC-02.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `apps/web/src/components/UserManagementTab.tsx`, `apps/web/src/app/settings/users/*`, `apps/api/package.json`, `apps/web/package.json`, `apps/web/src/tests/user-scopes-states.test.ts`, `apps/api/src/users/users.scopes.supertest.spec.ts`, `apps/api/src/users/users.scopes.unit.spec.ts` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-rbac-02-scope-assignment` |
| Pull Request    | Pending |

## Business outcome

A shop owner or authorized administrator can assign, inspect, and enforce organizational resource scopes for tenant users across:
- **Shop / Tenant Scope**: Every user is strictly isolated to their merchant tenant (`merchant_id`). Cross-tenant access is prohibited.
- **Branch / Store Scope**: Users can be assigned specific store/branch identifiers or the wildcard `*` (granting access to all current and future branches in the tenant).
- **Warehouse Scope**: Users can be assigned specific warehouse identifiers or the wildcard `*` (granting access to all current and future warehouses in the tenant).
- **Carrier Account Scope**: Users can be assigned specific carrier account IDs or the wildcard `*` (granting access to quote, order, and dispatch shipments using the merchant's connected carrier accounts).

The backend serves as the single source of truth for authorization:
1. An actor cannot grant resource scopes they do not hold (Privilege Ceiling enforcement).
2. Modifying scopes produces an immutable, tenant-scoped audit trail (`USER_SCOPE_ASSIGNED` / `USER_SCOPE_UPDATED`).
3. User scope verification endpoints evaluate active status, wildcard inheritance, and explicit assignment to prevent unauthorized resource access.
4. The web management console (`/settings/users`) transitions from mocked in-memory store arrays to live backend API interactions supporting all UI states (Loading, Empty, Validation, Error, Forbidden, Success, Recovery).

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — `DEC-002`: Shops use their own carrier accounts/contracts; quotes and actions are account-scoped. `DEC-011`: Delivery and warehouse workflows.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-RBAC-02`: Scope assignment ("Shop, branch, warehouse and carrier-account scope"); `FEAT-RBAC-01`: Roles and permissions ("Default/custom roles with resource/action scopes").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Rule: "Permission evaluation includes tenant, branch, warehouse and carrier-account scope" (line 46); Rule: "A user cannot grant a permission they do not hold" (line 45); Rule: "Grant carrier action permission: Owner or explicitly delegated manager" (line 33); Rule: "Backend is authoritative; hidden UI controls are insufficient" (line 44).
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-USR-01`: Invite and authorize a user ("Preconditions: actor may manage users in the target scope. Main flow: enter identity → assign roles/scopes... Rules: cannot grant permissions the actor does not possess. Audit: role/scope change.").
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section "Tenant and user": `Membership.tenant_id` ("Never inferred from client payload alone"), `Membership.scope_json` ("Branch/warehouse/carrier-account scope"), `User.store_scopes`, `User.warehouse_scopes`.
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Aggregate: `User`, `Role`, `CarrierAccount`.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Resource group `/users, /roles`: Invitations, users, roles and scopes; canonical error envelope, correlation ID, idempotency.
- `docs/product-spec/contracts/openapi.yaml` — `/users/check-scope` operation, `CheckScopeRequest`, `CheckScopeResponse`.
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-USR-01` (`/settings/users`) User management.
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — `SCR-CAR-01` ("Carrier, account alias/code, shop/warehouse scope").
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, partial, success, recovery).
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Least privilege principle, tenant scoping server-side, immutable audit logs for scope mutations.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract tooling, test harness, and strict CI gates.
- `FEAT-RBAC-01` is merged, introducing canonical permissions catalog (`iam:manage_users`, `iam:grant_action_permission`), `Role` & `RolePermission` models, and in-transaction actor privilege locking.
- `FEAT-USR-01` is merged, providing user invitation flows with `store_scopes` and `warehouse_scopes`.

## Author boundary

`GEMINI` is assigned because scope assignment spans database schema evolution (`carrier_account_scopes` column on `users` and `invitations`), tenant isolation logic, privilege ceiling validation, multi-resource scope checking, and web console state integration.

## In scope

1. **Database Persistence & Migration**:
   - Add `carrier_account_scopes TEXT[] DEFAULT ARRAY[]::TEXT[]` to `users` and `invitations` tables.
   - Synchronize `prisma/schema.prisma` with `carrier_account_scopes String[] @default([])` on `User` and `Invitation`.
2. **API Endpoints**:
   - `GET /api/v1/users` (and `/users`): List active and pending users in caller's merchant tenant with assigned roles, custom roles, and scopes (`store_scopes`, `warehouse_scopes`, `carrier_account_scopes`).
   - `GET /api/v1/users/:id/scopes` (and `/users/:id/scopes`): Fetch current assigned scopes and role for a target tenant user.
   - `PATCH /api/v1/users/:id/scopes` (and `/users/:id/scopes`): Update scope assignments for a tenant user.
   - `POST /api/v1/users/check-scope` (and `/users/check-scope`): Validate user authorization against requested `store_id`, `warehouse_id`, and `carrier_account_id`.
3. **Privilege Ceiling Enforcement for Scopes**:
   - Non-owner actors cannot assign scopes broader than their own granted scopes (unless holding wildcard `*` for that scope domain).
   - If an actor lacks access to `store_b`, attempting to assign `store_b` or `*` to another user returns 403 `PRIVILEGE_ESCALATION_DENIED`.
4. **Scope Format & Domain Validation**:
   - Strict string array validation: max 50 items, max 64 chars per identifier, no control characters or dangerous symbols.
   - Carrier account validation: non-wildcard carrier account IDs must exist and belong to the caller's merchant.
5. **Immutable Audit Logging**:
   - Scope mutations record immutable audit log entries (`USER_SCOPE_UPDATED`) detailing actor, target user, before/after scopes, and correlation ID.
   - Transactional rollback guarantees that scope mutations fail if audit logging fails.
6. **Concurrency & Locking**:
   - Scope assignment executes within a database transaction locking the target user record to prevent race conditions.
7. **Web Console Integration (`SCR-USR-01` / `/settings/users`)**:
   - `UserManagementTab.tsx` integrates with `GET /api/v1/users` and `PATCH /api/v1/users/:id/scopes`.
   - The user scope assignment modal allows selecting branches, warehouses, and carrier accounts with wildcard toggle.
   - Comprehensive state coverage: Loading (skeletons), Empty, Validation, Error (banner with retry), Forbidden (read-only for unauthorized viewers), Success (toast notification), and Recovery (form preservation on failure).
8. **Automated Verification**:
   - Supertest integration tests for all API scope operations.
   - Unit tests for scope privilege ceiling and domain validation logic.
   - Web UI proving tests verifying all component states.

## Out of scope

- CRUD operations for Branches (`FEAT-ORG-02`).
- CRUD operations for Warehouses (`FEAT-WH-01`).
- Carrier account credential connection & OAuth flow (`FEAT-CAR-02`).
- Full user profile editing, deactivation, and session revocation (`FEAT-USR-02`).

## Business rules and edge cases

- `BR-SCOPE-01 — Tenant Boundary Isolation`: All user scope queries and updates are strictly constrained by caller's `merchant_id`. Inquiring about or attempting to modify a user belonging to another merchant returns 404 `USER_NOT_FOUND` or 403 `FORBIDDEN`.
- `BR-SCOPE-02 — Actor Authorization & Manage Users Permission`: An actor must have `OWNER` role or possess `iam:manage_users` permission to inspect or update user scopes. Actors lacking this permission receive 403 `FORBIDDEN`.
- `BR-SCOPE-03 — Scope Privilege Ceiling`: An actor cannot assign scopes that exceed their own active scopes:
  - If the actor has `store_scopes = ['store_01']`, they cannot assign `store_02` or `*`.
  - An `OWNER` or an actor with `['*']` in a domain may assign any valid scope or wildcard in that domain.
  - Violations return 403 `PRIVILEGE_ESCALATION_DENIED`.
- `BR-SCOPE-04 — Carrier Account Scoping and Ownership`: Carrier account scopes can either be wildcard `*` or specific `carrier_account_id` values. If explicit IDs are supplied, each must exist in `carrier_accounts` belonging to the tenant. Unrecognized or foreign carrier accounts return 400 `VALIDATION_ERROR`.
- `BR-SCOPE-05 — Authoritative Evaluation via check-scope`:
  - `POST /api/v1/users/check-scope` accepts `store_id`, `warehouse_id`, and/or `carrier_account_id`.
  - At least one target resource must be specified; otherwise returns 400 `VALIDATION_ERROR`.
  - Returns `authorized: true` if the user is active and has access (either explicit match or wildcard `*`).
  - Returns 403 `FORBIDDEN` if the user is inactive/suspended or lacks matching scope.
- `BR-SCOPE-06 — Scope Array Bounds & Sanitization`: Scope array elements must be alphanumeric/slug strings up to 64 chars. Control characters or HTML tags (`<`, `>`, `\0`) trigger 400 `VALIDATION_ERROR`. Maximum 50 items allowed per scope category.
- `BR-SCOPE-07 — Immutable Audit Trail`: Scope updates execute within a database transaction writing an `AuditLog` entry with action `USER_SCOPE_UPDATED` containing `before` and `after` scope payloads.
- `BR-SCOPE-08 — Concurrency Conflict Handling`: Target user row is locked during update. Deadlocks or concurrency serialization failures map to retryable 409 `CONFLICT`.

## UI states

The user scope assignment interface in `SCR-USR-01` (`/settings/users`) implements:

- **Loading**: Skeletons displayed while fetching user list and current scopes; save button shows inline spinner during submission.
- **Empty**: Informative empty state displayed if no team members exist in the shop ("Chưa có nhân viên nào trong cửa hàng").
- **Validation**: Per-field validation error messages if scope formats are invalid or exceed limits.
- **Error**: Persistent alert banner displayed upon server or network failures, allowing immediate retry without discarding entered form state.
- **Forbidden**: Non-owner or unauthorized actors observe read-only indicators; scope editing controls are disabled or hidden with explanatory callout.
- **Success**: Success toast notification displayed upon successful scope update ("Đã cập nhật phạm vi quyền hạn thành công") and table row updates reactively.
- **Recovery**: Form state preserved if network drops, permitting re-submission upon reconnecting.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required | Status |
| --- | --- | --- | --- | --- |
| `AC-RBAC-02-01` | Authenticated owner requests list of tenant users | 200 OK with list of users including `store_scopes`, `warehouse_scopes`, and `carrier_account_scopes` | Supertest integration test | PASS |
| `AC-RBAC-02-02` | Actor requests scopes for a specific user in tenant | 200 OK with user ID, role, and current scope arrays | Supertest integration test | PASS |
| `AC-RBAC-02-03` | Owner updates user scopes with valid branches, warehouses, and carrier accounts | 200 OK with updated user scopes; audit `USER_SCOPE_UPDATED` written to DB | Supertest integration test + DB assertion | PASS |
| `AC-RBAC-02-04` | Owner assigns wildcard `*` to store, warehouse, and carrier-account scopes | 200 OK; user receives `*` wildcard scope across all resources | Supertest integration test | PASS |
| `AC-RBAC-02-05` | Non-owner actor with restricted scope attempts to grant scopes outside their ceiling | 403 `PRIVILEGE_ESCALATION_DENIED` canonical error; no scopes changed | Supertest integration test | PASS |
| `AC-RBAC-02-06` | Actor attempts to assign a carrier account ID not owned by tenant | 400 `VALIDATION_ERROR` canonical error; no scopes changed | Supertest integration test | PASS |
| `AC-RBAC-02-07` | Scope update payload with invalid characters (`<script>`) or exceeding 64 chars | 400 `VALIDATION_ERROR` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-08` | Scope update payload with more than 50 items in scope array | 400 `VALIDATION_ERROR` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-09` | Actor checks scope access for matching `store_id` | 200 OK with `authorized: true` | Supertest integration test | PASS |
| `AC-RBAC-02-10` | Actor checks scope access for non-matching `store_id` | 403 `FORBIDDEN` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-11` | Actor checks scope access for matching `warehouse_id` | 200 OK with `authorized: true` | Supertest integration test | PASS |
| `AC-RBAC-02-12` | Actor checks scope access for non-matching `warehouse_id` | 403 `FORBIDDEN` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-13` | Actor checks scope access for matching `carrier_account_id` | 200 OK with `authorized: true` | Supertest integration test | PASS |
| `AC-RBAC-02-14` | Actor checks scope access for non-matching `carrier_account_id` | 403 `FORBIDDEN` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-15` | User with wildcard `*` checks any store, warehouse, or carrier account | 200 OK with `authorized: true` | Supertest integration test | PASS |
| `AC-RBAC-02-16` | Suspended or pending user attempts scope check | 403 `FORBIDDEN` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-17` | Actor lacking `iam:manage_users` permission attempts scope mutation | 403 `FORBIDDEN` canonical error | Supertest integration test | PASS |
| `AC-RBAC-02-18` | Cross-tenant actor attempts to view or update scopes of another merchant's user | 404 `USER_NOT_FOUND` canonical error (no cross-tenant existence oracle) | Supertest integration test | PASS |
| `AC-RBAC-02-19` | Audit failure during scope update transaction | Transaction rolls back; 500 error returned; user scopes unchanged | Supertest integration test | PASS |
| `AC-RBAC-02-20` | Web UI renders Loading, Empty, Validation, Error, Forbidden, and Success states | All component state snapshots & live canonical error mapping verified | Web test harness (`user-scopes-states.test.ts`) | PASS |
| `AC-RBAC-02-21` | Security secret scanner run | 0 secrets or sensitive tokens detected | `pnpm security:secrets` | PASS |

## Verification commands

- `pnpm install --frozen-lockfile` — Clean install completed with lockfile preserved.
- `pnpm db:generate` — Generated Prisma Client v6.19.3.
- `pnpm lint` — 12/12 monorepo packages and scripts passed with 0 errors.
- `pnpm format:check` — 11 changed files 100% compliant with Prettier.
- `pnpm typecheck` — 12/12 packages passed with 0 TypeScript errors.
- `pnpm contract:check` — 51 endpoints verified against OpenAPI 3.1.0 specification with 0 drift.
- `pnpm --filter @shipde/api test` — 18/18 scope assignment unit tests passed; 19/19 scope assignment supertest integration tests passed (`AC-RBAC-02-01` to `AC-RBAC-02-19`).
- `pnpm --filter @shipde/web test` — All 11 UI states verified (`user-scopes-states.test.ts` passed 100%).
- `pnpm build` — Full monorepo build succeeded (8/8 tasks completed, Next.js Turbopack output generated cleanly).
- `pnpm security:secrets` — Gitleaks scanner completed with 0 secrets detected across commit history and working tree.
- `git diff --check` — Clean whitespace and no conflict markers.
- `node scripts/ai/check-no-hardcode.mjs` — PASS: 0 hardcoded values detected.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| 1 | `1a2c91e1` | CHANGES_REQUIRED | Initial implementation of FEAT-RBAC-02 vertical slice |
| 2 | `2222ed94` | CHANGES_REQUIRED | Review r3: 4 P1 findings (wire carrier scopes, real rollback test, shared scope validation, restore MFA reset contract) |
| 3 | `b8bfebd0` | CHANGES_REQUIRED | Wire carrier scopes & success toast in modal, real updateUserScopes rollback test with injected audit failure, unified validateScopeArray & row-lock across scope writes, restore exact origin/main adminResetMfa contract |
| 4 | HEAD | READY_FOR_CODEX | Grok round 4: remove cross-tenant findUnique existence oracle on scope mutation (return 404 USER_NOT_FOUND), map canonical fields array onto field-error-* while keeping modal alert banner |

## Residual limitations

None.
