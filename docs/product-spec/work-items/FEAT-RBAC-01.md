# FEAT-RBAC-01 — Roles and permissions

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-RBAC-01` |
| Feature ID      | `FEAT-RBAC-01` |
| Status          | `IN_PROGRESS` |
| Delivery order  | 13 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `auth`, `security`, `tenant isolation`, `database ownership` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/rbac/*`, `apps/api/src/users/*`, `apps/api/src/app.module.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-RBAC-01.md`, `apps/web/src/components/UserManagementTab.tsx`, `apps/web/src/app/settings/roles/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-rbac-01-roles-permissions` |
| Pull Request    | Pending |

## Business outcome

A shop owner or authorized administrator can view platform permissions, inspect default built-in system roles (`OWNER`, `OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`, `FINANCE`), and define custom tenant roles with granular resource/action capabilities (such as PII unmasking, order rescue execution, and reconciliation maker-checker approvals). The system guarantees that permissions are authoritative server-side, non-owners cannot escalate their privileges, and immutable system roles cannot be corrupted.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-RBAC-01`: Roles and permissions ("Default/custom roles with resource/action scopes").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Complete role-to-capability permissions matrix (20 defined capabilities across 9 roles; enforcement rules: "Backend is authoritative; hidden UI controls are insufficient", "A user cannot grant a permission they do not hold", "Permission evaluation includes tenant, branch, warehouse and carrier-account scope", "Sensitive export/action checks require a fresh session or step-up authentication").
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-USR-01`: Invite and authorize a user (Rule: "cannot grant permissions the actor does not possess. Audit: role/scope change").
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Identity and access aggregate: `User`, `Membership`, `Role`, `Permission`, `UserSession`.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section "Tenant and user": `Membership.scope_json`, `User.role`.
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-RBAC-01` (`/settings/roles`) and `SCR-USR-01` (`/settings/users`).
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — `/roles` and `/users` API boundaries and canonical error responses.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Least-privilege principle, immutable audit logs for role creation/mutation, protection against unauthorized privilege escalation.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and quality gates.
- `FEAT-AUTH-01` is merged, providing base user identity and `RoleEnum`.
- `FEAT-USR-02` is authored, defining user-role assignment endpoints and lifecycle.

## Author boundary

`GEMINI` is required because role and permission management defines the security foundation of the multi-tenant platform, requiring database schema extensions for dynamic roles, guard interceptors for granular capability checks, and tamper-proof protection against privilege escalation.

## In scope

1. `GET /api/v1/permissions` — List all canonical platform capability permissions categorized by domain (IAM, Orders, Shipments, Reconciliation, Claims, Audit).
2. `GET /api/v1/roles` — List system built-in roles and tenant-created custom roles with their permission summaries.
3. `GET /api/v1/roles/:id` — Retrieve detailed role definition, including full capability permission list and count of assigned users.
4. `POST /api/v1/roles` — Create a custom role with a name, description, and selected capability permissions within caller's merchant tenant.
5. `PATCH /api/v1/roles/:id` — Update custom role name, description, and permission mappings. System roles (`is_system=true`) are read-only and reject modification with 403 `SYSTEM_ROLE_IMMUTABLE`.
6. `DELETE /api/v1/roles/:id` — Delete a custom role; rejected with 400 `ROLE_IN_USE` if any active user is currently assigned to the role.
7. Privilege Ceiling Enforcement: An actor cannot create or edit a role with permissions that the actor does not currently possess.
8. System Role Protection: System roles (`OWNER`, `OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`, `FINANCE`) are pre-seeded and cannot be deleted or mutated.
9. Tenant Isolation: Custom roles are strictly scoped to `merchant_id`. Actors cannot view, modify, or delete roles belonging to another merchant.
10. UI integration in `SCR-RBAC-01` (`/settings/roles`) and the granular permissions matrix in `UserManagementTab` (`apps/web/src/components/UserManagementTab.tsx`).
11. Comprehensive integration tests verifying system role immutability, privilege escalation prevention, and deletion safeguards.

## Out of scope

- Specific branch and warehouse scope assignments to individual users (`FEAT-RBAC-02`).
- Carrier account permission profiles L0/L1/L2 (`FEAT-CAR-03`).
- Approval workflow editor for financial maker-checker thresholds (`FEAT-RATE-03`).
- Self-registration role defaults (`FEAT-AUTH-01`).

## Business rules and edge cases

- `BR-RBAC-01 — System Role Immutability`: Built-in system roles (`OWNER`, `OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`, `FINANCE`) have `is_system=true`. Attempts to modify (`PATCH`) or delete (`DELETE`) a system role return 403 `SYSTEM_ROLE_IMMUTABLE`.
- `BR-RBAC-02 — Privilege Ceiling`: An actor cannot create or grant a role containing permissions that the actor does not possess. An attempt to include unauthorized permissions returns 403 `PRIVILEGE_ESCALATION_DENIED`.
- `BR-RBAC-03 — Role In-Use Safeguard`: Deleting a custom role requires that no active user in the merchant is currently assigned that role. If user count > 0, deletion returns 400 `ROLE_IN_USE` with the active user count.
- `BR-RBAC-04 — Tenant Scoping`: All custom roles are strictly bound to `merchant_id`. Cross-tenant queries or mutations return 403 `FORBIDDEN`.
- `BR-RBAC-05 — Name Uniqueness within Tenant`: Custom role names must be unique within a merchant (case-insensitive). Duplicate role names return 400 `ROLE_NAME_EXISTS`.
- `BR-RBAC-06 — Granular Capability Identifiers`: Platform permissions use standardized canonical identifiers (e.g. `iam:manage_users`, `pii:unmask`, `order:create`, `shipment:cancel`, `reconciliation:maker_checker`, `audit:view`).
- `BR-RBAC-07 — Immutable Audit Trail`: Role creation, updates, and deletions write immutable audit records to `audit_logs` capturing actor, target role, before/after permissions, and correlation ID.

## UI states

The role and permission management interface in `SCR-RBAC-01` (`/settings/roles`) must implement:

- **Loading:** Skeleton list displayed during role and permission catalogue fetching; save buttons display inline spinner during mutation.
- **Empty:** When no custom roles exist, displays built-in system roles with callout: "Chưa có vai trò tùy chỉnh nào".
- **Validation:** Missing role name, empty permission selection, or duplicate name render inline field errors.
- **Error:** Server or network errors display a persistent error banner with retry option without losing filled form state.
- **Forbidden:** Non-owner actors viewing roles receive view-only permissions; unauthorized edit actions display 403 `FORBIDDEN` error.
- **Success:** Role creation or update displays toast: "Đã lưu vai trò phân quyền thành công" and refreshes role list.
- **Recovery:** Network failure allows safe retry; idempotent role update ensures no duplicate permission rows.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-RBAC-01-01` | Authenticated user requests platform permissions catalog | 200 OK with list of all canonical permissions grouped by category | Supertest integration test |
| `AC-RBAC-01-02` | Owner lists merchant roles | 200 OK with list of system roles and merchant-scoped custom roles | Supertest integration test |
| `AC-RBAC-01-03` | Owner creates new custom role with valid permissions | 201 Created; role stored with `is_system=false` and permissions mapped; audit `ROLE_CREATED` logged | Supertest integration test + DB assertion |
| `AC-RBAC-01-04` | Owner creates custom role with duplicate name in tenant | 400 `ROLE_NAME_EXISTS` canonical validation error | Supertest integration test |
| `AC-RBAC-01-05` | Non-owner actor attempts to create role with permissions they lack | 403 `PRIVILEGE_ESCALATION_DENIED` canonical error; no role created | Supertest integration test |
| `AC-RBAC-01-06` | User attempts to modify built-in system role | 403 `SYSTEM_ROLE_IMMUTABLE` canonical error; system role unmodified | Supertest integration test |
| `AC-RBAC-01-07` | User attempts to delete built-in system role | 403 `SYSTEM_ROLE_IMMUTABLE` canonical error; system role unmodified | Supertest integration test |
| `AC-RBAC-01-08` | Owner updates permissions of a custom role | 200 OK with updated role and permissions; audit `ROLE_UPDATED` logged | Supertest integration test + DB assertion |
| `AC-RBAC-01-09` | Owner attempts to delete custom role that is assigned to active user | 400 `ROLE_IN_USE` canonical error with active user count; role preserved | Supertest integration test |
| `AC-RBAC-01-10` | Owner deletes unassigned custom role | 200 OK; role deleted; audit `ROLE_DELETED` logged | Supertest integration test + DB assertion |
| `AC-RBAC-01-11` | Cross-tenant actor attempts to view or edit custom role | 403 `FORBIDDEN` canonical error; target role unmodified | Supertest integration test |
| `AC-RBAC-01-12` | Missing required role name during creation | 400 `VALIDATION_ERROR` with field errors on `name` | Supertest integration test |
| `AC-RBAC-01-13` | Creation request with empty permission array | 400 `VALIDATION_ERROR` (At least one permission required) | Supertest integration test |
| `AC-RBAC-01-14` | User lacking `Manage users/roles` permission attempts role mutation | 403 `FORBIDDEN`; request rejected | Supertest integration test |
| `AC-RBAC-01-15` | Audit logging failure during role mutation | Transaction rolls back; 500 error returned; role state unmodified | Supertest integration test |
| `AC-RBAC-01-16` | Security inspection of role endpoints and audit logs | No sensitive secrets or tokens exposed; actor and permission changes audit-tracked | Security assertion + `pnpm security:secrets` |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Open questions

1. **Role Inheritance vs. Flat Roles:** Current specification defines roles with flat permission arrays. Whether custom roles can inherit from a base system role (e.g. `OPS_CSKH` plus `pii:unmask`) is deferred to future authorization refactoring.
2. **Dual-Authorization for Sensitive Role Permissions:** Granting high-risk permissions (such as financial discrepancy approvals `p_discrepancy` or unrestricted PII export) is currently restricted to `OWNER`. Whether delegating these permissions requires two-person approval (maker-checker) is pending policy resolution.
