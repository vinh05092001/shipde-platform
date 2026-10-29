# FEAT-ORG-02 — Branches

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-ORG-02` |
| Feature ID      | `FEAT-ORG-02` |
| Status          | `IN_PROGRESS` |
| Delivery order  | 16 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-ORG-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `database ownership`, `auth`, `audit` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-ORG-02.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/*`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/app.module.ts`, `apps/api/src/branches/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-org-02-branches` |
| Pull Request    | Pending |

## Business outcome

A shop owner (`OWNER`) or authorized administrator (holding the `iam:shop_config` capability) can manage organizational branches / business units (CRUD, activate/deactivate, set default branch, address, contact phone, and code). Team members with scoped store permissions (`store_scopes` established in `FEAT-RBAC-02`) are restricted to viewing and operating within their assigned branches, while owners and wildcard users (`*`) have full visibility across all branches for operational routing and reporting scope. All mutations strictly enforce tenant isolation server-side, generate immutable audit trails (`BRANCH_CREATED`, `BRANCH_UPDATED`, `BRANCH_ACTIVATED`, `BRANCH_DEACTIVATED`), and return canonical API error structures.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-ORG-02`: Branches ("CRUD, activate/deactivate and reporting scope").
- `docs/product-spec/docs/00-control/GLOSSARY.md` — Branch: "Business unit under a shop".
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Shop configuration" (`iam:shop_config`): Owner has full action (`A`), Ops manager has scoped action (`S`), Finance has view (`V`), others denied (`–`). Rule: "Permission evaluation includes tenant, branch, warehouse and carrier-account scope".
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Aggregates: `SHOP ||--o{ BRANCH : has`, `BRANCH ||--o{ WAREHOUSE : has`.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — `Membership.scope_json` ("Branch/warehouse/carrier-account scope"), `User.store_scopes`.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Section Resource groups: `/shops` ("Shop, branches and warehouses"), API conventions, canonical error envelopes.
- `docs/product-spec/work-items/FEAT-RBAC-02.md` — User store/branch scope model (`store_scopes`, wildcard `*`).
- `docs/product-spec/work-items/FEAT-ORG-01.md` — Organization shop profile, audit logging conventions, and RBAC guard integration.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, establishing the multi-tenant `merchants` baseline table, user credentials, and audit logging primitives.
- `FEAT-AUTH-06` is merged, providing `SessionGuard` and session resolution.
- `FEAT-RBAC-01` is merged, establishing dynamic roles, `PermissionsGuard`, `@RequirePermissions`, and canonical platform capability `iam:shop_config`.
- `FEAT-RBAC-02` is merged, establishing user `store_scopes` array (`String[]`), scope enforcement, and privilege ceiling checks.
- `FEAT-ORG-01` is merged, establishing shop profile management and audit log diff masking patterns.

## Author boundary

`GEMINI` is required because branch management introduces the `branches` database table, multi-tenant isolation, RBAC capability checks (`iam:shop_config`), user branch scope enforcement, immutable audit logging, and contract synchronization between OpenAPI and `@shipde/contracts`.

## In scope

1. `GET /api/v1/branches` (and `/branches`) — List branches for the authenticated tenant. Users with `OWNER` role or `*` in `store_scopes` see all tenant branches; users with restricted `store_scopes` see only assigned branches. Supports optional `status` filter query parameter (`ACTIVE` | `INACTIVE`).
2. `POST /api/v1/branches` (and `/branches`) — Create a new branch with `name`, `code`, `address`, `phone`, `is_default`, and `status`. Validates unique code per tenant, enforces single default branch, and writes `BRANCH_CREATED` to `audit_logs`.
3. `GET /api/v1/branches/:id` (and `/branches/:id`) — Retrieve branch details by ID with strict tenant scoping. If the user has restricted `store_scopes`, verifies that the requested branch is in their scope, otherwise returns 403 `FORBIDDEN`.
4. `PATCH /api/v1/branches/:id` (and `/branches/:id`) — Update branch fields (`name`, `code`, `address`, `phone`, `is_default`, `status`). Validates code uniqueness per tenant, maintains single default branch guarantee, and records `BRANCH_UPDATED` in `audit_logs`.
5. `POST /api/v1/branches/:id/activate` (and `/branches/:id/activate`) — Activate branch (`status = 'ACTIVE'`). Records `BRANCH_ACTIVATED` in `audit_logs`.
6. `POST /api/v1/branches/:id/deactivate` (and `/branches/:id/deactivate`) — Deactivate branch (`status = 'INACTIVE'`). Prevents deactivating a branch currently designated as `is_default: true` without designating another default branch first. Records `BRANCH_DEACTIVATED` in `audit_logs`.
7. `DELETE /api/v1/branches/:id` (and `/branches/:id`) — Delete branch. Rejects deletion if branch is the default branch or if referenced. Records `BRANCH_DELETED` in `audit_logs`.
8. Validation & Normalization rules:
   - Branch `name`: required, 2–255 characters.
   - Branch `code`: required, 2–64 characters, uppercase alphanumeric, hyphens, and underscores (`^[A-Za-z0-9_-]+$`). Automatically trimmed and normalized to uppercase.
   - Branch `address`: optional, max 1000 characters.
   - Branch `phone`: optional, normalized Vietnamese phone format (`^0[35789][0-9]{8}$` or `^\+84[35789][0-9]{8}$`).
   - Branch `status`: enum `'ACTIVE'` | `'INACTIVE'`, default `'ACTIVE'`.
   - Branch `is_default`: boolean, default `false`. Setting `true` resets any other branch in the merchant to `false` in a transaction.
9. RBAC & Access control:
   - Mutation endpoints (`POST`, `PATCH`, `activate`, `deactivate`, `DELETE`) require `iam:shop_config` capability via `PermissionsGuard` and `@RequirePermissions('iam:shop_config')`.
   - Read endpoints (`GET`) permit `OWNER`, `OPS_CSKH`, `FINANCE`, or any authenticated member holding `iam:shop_config`.
   - Branch reporting/scope enforcement: Team members with restricted `store_scopes` are filtered to only their assigned branches in list responses and blocked with 403 `FORBIDDEN` when accessing branches outside their scope.
10. Immutable audit logging:
    - Every mutation writes to `audit_logs` capturing `merchant_id`, `user_id`, `actor`, `action`, `entity_type: 'branch'`, `entity_id`, before/after diffs with phone numbers masked, client IP hash, and correlation ID.
11. Persistence & Migration:
    - Creates `branches` table in `prisma/schema.prisma` with foreign key to `merchants` (`onDelete: Cascade`), unique index on `[merchant_id, code]`, and index on `[merchant_id, status]`.
12. Comprehensive automated tests:
    - Unit tests (`branches.unit.spec.ts`) validating DTOs, code normalization, phone validation, and scope filtering logic.
    - Supertest integration tests (`branches.supertest.spec.ts`) validating all endpoints, tenant isolation, RBAC checks, store scoping, audit logs, and canonical error cases.

## Out of scope

1. Multi-branch Web UI screen (Step 2 next run).
2. Warehouse inventory assignment per branch (`FEAT-WH-01`).
3. Carrier account routing assignment per branch (`FEAT-CAR-01`).
4. Order routing engine multi-branch fulfillment logic (`FEAT-ORD-01`).

## Business rules and edge cases

- `BR-BRANCH-01 — Tenant Scoping`: All branch operations are strictly isolated to the caller's authenticated `merchant_id`. Cross-tenant requests return 403 `FORBIDDEN` or 404 `BRANCH_NOT_FOUND`.
- `BR-BRANCH-02 — Unique Branch Code`: Branch `code` must be unique within each merchant tenant (case-insensitive). Duplicate code returns 409 `BRANCH_CODE_EXISTS`.
- `BR-BRANCH-03 — Default Branch Invariant`: At most one branch per merchant can have `is_default = true`. When a branch is set to `is_default = true`, all other branches in that merchant are atomically updated to `is_default = false`.
- `BR-BRANCH-04 — Default Branch Protection`: A default branch cannot be deactivated or deleted. Attempting to deactivate a default branch returns 400 `CANNOT_DEACTIVATE_DEFAULT_BRANCH`.
- `BR-BRANCH-05 — User Store Scoping`: Users with non-wildcard `store_scopes` (e.g. `['HCM-Q3']`) can only view and interact with branches whose ID or code is in their `store_scopes`. Attempting to access an unassigned branch returns 403 `FORBIDDEN`.
- `BR-BRANCH-06 — RBAC Authority`: Branch mutations require `iam:shop_config`. Users lacking this capability are rejected with 403 `FORBIDDEN`.
- `BR-BRANCH-07 — Immutable Audit Trail`: All branch lifecycle events (`BRANCH_CREATED`, `BRANCH_UPDATED`, `BRANCH_ACTIVATED`, `BRANCH_DEACTIVATED`, `BRANCH_DELETED`) generate immutable audit logs with masked sensitive fields (phone).
- `BR-BRANCH-08 — First Branch Default`: If a merchant has no existing branches, the first created branch automatically defaults to `is_default = true`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence / Real test result |
|---|---|---|---|
| `AC-ORG-02-01` | Authenticated OWNER requests branch list (`GET /api/v1/branches`) | 200 OK with list of all tenant branches | PASS — Verified in `branches.supertest.spec.ts` (returns 200 with all tenant branches) |
| `AC-ORG-02-02` | User with restricted `store_scopes` lists branches | 200 OK with filtered list containing only assigned branches | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (filtered strictly to assigned scopes) |
| `AC-ORG-02-03` | User with `iam:shop_config` creates new branch (`POST /api/v1/branches`) | 201 Created with branch data; `BRANCH_CREATED` recorded in `audit_logs` | PASS — Verified in `branches.supertest.spec.ts` (DB persistence and audit log confirmed) |
| `AC-ORG-02-04` | Attempt to create branch with duplicate code in same tenant | 409 `BRANCH_CODE_EXISTS` canonical error | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (returns 409) |
| `AC-ORG-02-05` | Attempt to create branch with invalid data (empty name, invalid phone) | 400 `VALIDATION_ERROR` with field details | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (returns 400 with field details) |
| `AC-ORG-02-06` | Update branch details (`PATCH /api/v1/branches/:id`) | 200 OK with updated branch; `BRANCH_UPDATED` recorded in `audit_logs` | PASS — Verified in `branches.supertest.spec.ts` (DB update and audit log confirmed) |
| `AC-ORG-02-07` | Setting a branch as `is_default = true` | 200 OK; previous default branch reset to `is_default = false` | PASS — Verified in `branches.supertest.spec.ts` (atomic single-default invariant preserved) |
| `AC-ORG-02-08` | Activate an inactive branch (`POST /api/v1/branches/:id/activate`) | 200 OK; status set to `ACTIVE`; `BRANCH_ACTIVATED` recorded in `audit_logs` | PASS — Verified in `branches.supertest.spec.ts` (status updated to ACTIVE, audit log written) |
| `AC-ORG-02-09` | Deactivate an active non-default branch (`POST /api/v1/branches/:id/deactivate`) | 200 OK; status set to `INACTIVE`; `BRANCH_DEACTIVATED` recorded in `audit_logs` | PASS — Verified in `branches.supertest.spec.ts` (status updated to INACTIVE, audit log written) |
| `AC-ORG-02-10` | Attempt to deactivate default branch | 400 `CANNOT_DEACTIVATE_DEFAULT_BRANCH` canonical error | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (returns 400) |
| `AC-ORG-02-11` | Scoped user attempts to retrieve branch outside their `store_scopes` | 403 `FORBIDDEN` canonical error | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (returns 403 FORBIDDEN) |
| `AC-ORG-02-12` | Cross-tenant request to get or update foreign branch | 404 `BRANCH_NOT_FOUND` / 403 `FORBIDDEN`; foreign branch unmodified | PASS — Verified in `branches.supertest.spec.ts` (returns 404, foreign branch unmodified) |
| `AC-ORG-02-13` | User lacking `iam:shop_config` attempts branch mutation | 403 `FORBIDDEN` canonical error | PASS — Verified in `branches.supertest.spec.ts` (WAREHOUSE role rejected with 403) |
| `AC-ORG-02-14` | Unauthenticated request to branch endpoints | 401 `UNAUTHORIZED` canonical error | PASS — Verified in `branches.supertest.spec.ts` (returns 401 UNAUTHORIZED) |
| `AC-ORG-02-15` | Audit logs capture diffs with masked phone numbers | Audit log verified; plaintext phone never logged | PASS — Verified in `branches.supertest.spec.ts` & `branches.unit.spec.ts` (phone masked e.g. 090****567) |
| `AC-ORG-02-16` | Route alias without `/api/v1` prefix (`GET /branches`, `POST /branches`) | 200 OK / 201 Created | PASS — Verified in `branches.supertest.spec.ts` (/branches returns 200) |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json --test src/branches/branches.unit.spec.ts`
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/branches/branches.supertest.spec.ts`
- `node scripts/ai/check-no-hardcode.mjs`
- `pnpm contract:check`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Initial implementation of Branches API and persistence |

## Residual limitations

- UI screen (`SCR-BRANCH-01` or Settings Branch tab) scheduled for Step 2 next run.
