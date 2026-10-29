# FEAT-WH-01 — Warehouses

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-WH-01` |
| Feature ID      | `FEAT-WH-01` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 17 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-ORG-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `database ownership`, `rbac`, `audit` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-WH-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/app.module.ts`, `apps/api/src/warehouses/*`, `apps/web/package.json`, `apps/web/src/app/settings/warehouses/*`, `apps/web/src/components/WarehouseManagementView.tsx`, `apps/web/src/tests/warehouses-page-states.test.ts` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-wh-01-warehouses` |
| Pull Request    | Pending |

## Business outcome

A shop owner (`OWNER`) or authorized operator holding the `iam:shop_config` capability can create, configure, inspect, update, deactivate, and designate default warehouses for physical dispatch and return operations. Each warehouse defines:
1. **Pickup Address**: Primary sender contact (name, phone, email) and postal address (street, ward, district, city/province) used for carrier pickup bookings.
2. **Return Address**: Configurable return destination (mirrors pickup address by default, or defines custom contact and facility address for failed deliveries).
3. **Operating Schedule**: Daily operating hours, pickup cutoff time (e.g. `16:00`), and operating instructions/notes for drivers.
4. **Contacts**: Primary dispatch manager contact and secondary emergency/escalation contacts.
5. **Printer Defaults**: Thermal label printing preferences including paper size (`A6`, `A5`, `A4`, `K80`), resolution (`203` or `300` DPI), printer device name, and auto-print triggers.

The backend acts as the authoritative boundary:
- All queries and mutations are strictly scoped server-side to the caller's tenant (`merchant_id`). Cross-tenant access returns 404 `NOT_FOUND` or 403 `FORBIDDEN`.
- Mutations (`POST`, `PATCH`, `DELETE`) require the `iam:shop_config` capability.
- Scoped operators (e.g. `WAREHOUSE`, `OPS_CSKH`) have their warehouse list and detail access restricted strictly to their assigned `User.warehouse_scopes` (with `*` granting universal tenant warehouse access).
- Setting a warehouse as default atomically unsets any prior default warehouse in the tenant. The first warehouse created for a tenant automatically becomes default.
- Every state change writes an immutable audit record (`WAREHOUSE_CREATED`, `WAREHOUSE_UPDATED`, `WAREHOUSE_SET_DEFAULT`, `WAREHOUSE_DEACTIVATED`) with sensitive contact PII masked.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-WH-01`: Warehouses ("Pickup/return address, schedule, contacts and printer defaults"); `FEAT-RBAC-02`: Scope assignment ("Shop, branch, warehouse and carrier-account scope").
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — `DEC-011`: Warehouse and fulfillment dispatch workflows.
- `docs/product-spec/docs/02-business/END-TO-END-PROCESSES.md` — `PR-01` Onboard a shop (Step 3: "Create shop, billing profile, first warehouse and return address").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Shop configuration" (`iam:shop_config`): Owner full action (`A`), Ops manager scoped (`S`), Finance view (`V`), others denied (`–`). Rule: "Permission evaluation includes tenant, branch, warehouse and carrier-account scope".
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-WH-01` (`/settings/warehouses` — "Chi nhánh/kho").
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — Section `SCR-ONB-01` (Step 2: "First warehouse/pickup/return address"); `SCR-ORD-02` (Section "Sender/warehouse"); `SCR-CAR-01` ("shop/warehouse scope").
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Aggregate: `Tenant`, `Shop`, `Warehouse`.
- `docs/product-spec/docs/04-data/schema.dbml` — `Table warehouses { id uuid, tenant_id uuid, shop_id uuid, name varchar, address_json jsonb, return_address_json jsonb, status varchar }`.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Resource groups: `/shops` ("Shop, branches and warehouses"), `/warehouses`.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Tenant isolation in query layer, server-side scope enforcement, immutable audit logging, PII masking.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract tools, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, establishing `merchants` baseline table, user credentials, and audit logging primitives.
- `FEAT-AUTH-06` is merged, providing `SessionGuard` and session resolution.
- `FEAT-RBAC-01` is merged, establishing dynamic roles, `PermissionsGuard`, `@RequirePermissions`, and capability `iam:shop_config`.
- `FEAT-RBAC-02` is merged, establishing `User.warehouse_scopes` and scope validation primitives.
- `FEAT-ORG-01` is merged, providing tenant organization profile and audit masking patterns.

## Author boundary

`GEMINI` is assigned because `FEAT-WH-01` introduces a core multi-tenant aggregate (`warehouses` table, Prisma model, and migration), implements RESTful API endpoints with server-side tenant isolation and RBAC scope filtering (`User.warehouse_scopes`), enforces audit trail generation with PII masking, updates contracts and OpenAPI schemas, and verifies end-to-end integration with Supertest and unit tests.

## In scope

1. **Database Persistence & Migration**:
   - Create `warehouses` table in PostgreSQL and `Warehouse` model in `prisma/schema.prisma`.
   - Fields: `id`, `merchant_id`, `name`, `code`, `status`, `is_default`, pickup address columns (`contact_name`, `contact_phone`, `contact_email`, `address_line`, `ward`, `district`, `city`, `postal_code`, `address_json`), return address columns (`use_different_return_address`, `return_contact_name`, `return_contact_phone`, `return_address_line`, `return_ward`, `return_district`, `return_city`, `return_address_json`), schedule (`operating_hours`, `cutoff_time`, `schedule_notes`), contacts (`contacts_json`), printer defaults (`printer_paper_size`, `printer_dpi`, `printer_name`, `printer_auto_print`, `printer_config`), `created_at`, `updated_at`.
   - Database indexes: `@@unique([merchant_id, code])`, `@@index([merchant_id, status])`, `@@index([merchant_id, is_default])`.
2. **API Endpoints (`apps/api/src/warehouses/`)**:
   - `GET /api/v1/warehouses` (and `/warehouses`): List warehouses for caller's merchant. Users with `*` scope or `iam:shop_config` view all warehouses; scoped users see only warehouses permitted in `warehouse_scopes`.
   - `POST /api/v1/warehouses` (and `/warehouses`): Create a new warehouse. Requires `iam:shop_config`. First warehouse created automatically becomes `is_default = true`.
   - `GET /api/v1/warehouses/:id` (and `/warehouses/:id`): Get warehouse detail by ID. Enforces tenant isolation and `warehouse_scopes`.
   - `PATCH /api/v1/warehouses/:id` (and `/warehouses/:id`): Update warehouse details. Requires `iam:shop_config`.
   - `POST /api/v1/warehouses/:id/default` (and `/warehouses/:id/default`): Set warehouse as default pickup warehouse. Atomically resets previous default in tenant.
   - `DELETE /api/v1/warehouses/:id` (and `/warehouses/:id`): Soft-delete / deactivate warehouse. Requires `iam:shop_config`.
3. **RBAC & Scope Authorization**:
   - Mutations (`POST`, `PATCH`, `DELETE`, set default) require `iam:shop_config` via `PermissionsGuard`.
   - Read access (`GET`) checks caller's `User.warehouse_scopes`:
     - `OWNER` or users holding `iam:shop_config` can access any warehouse in their merchant.
     - Scoped users (e.g. `WAREHOUSE`, `OPS_CSKH`) can only view warehouses where `warehouse.id IN (warehouse_scopes)` OR `warehouse.code IN (warehouse_scopes)`.
     - Requesting an out-of-scope warehouse returns 403 `FORBIDDEN` (`WAREHOUSE_SCOPE_UNAUTHORIZED`).
     - Cross-tenant requests return 404 `NOT_FOUND` (`WAREHOUSE_NOT_FOUND`).
4. **Validation Rules**:
   - `name`: required, 2–255 characters.
   - `code`: required or normalized alphanumeric code (2–64 characters, unique per merchant).
   - `contact_phone` and `return_contact_phone`: Vietnamese phone number format (`^0[35789][0-9]{8}$` or `^\+84[35789][0-9]{8}$`).
   - `contact_email`: optional, valid email format.
   - `cutoff_time`: optional, `HH:mm` format (e.g. `16:00`).
   - `printer_paper_size`: optional, must be one of `A6`, `A5`, `A4`, `K80` (default `A6`).
   - `printer_dpi`: optional, must be `203` or `300` (default `203`).
5. **Immutable Audit Logging**:
   - Mutations record `WAREHOUSE_CREATED`, `WAREHOUSE_UPDATED`, `WAREHOUSE_SET_DEFAULT`, `WAREHOUSE_DEACTIVATED` in `audit_logs`.
   - Audit diffs mask sensitive fields (`contact_phone`, `contact_email`, `return_contact_phone`).
6. **Contracts & OpenAPI**:
   - Update `docs/product-spec/contracts/openapi.yaml` and `@shipde/contracts` with warehouse endpoints and schemas.
7. **Automated Verification**:
   - Unit tests (`warehouses.unit.spec.ts`) validating DTOs, normalization, and phone/schedule validation.
   - Supertest integration tests (`warehouses.supertest.spec.ts`) verifying CRUD, tenant isolation, scope enforcement, RBAC, and audit log generation.
8. **Web UI (SCR-WH-01)**:
   - Implement warehouse settings screen at `apps/web/src/app/settings/warehouses/page.tsx` with `WarehouseManagementView.tsx`.
   - Complete state coverage: loading skeleton, empty state, view/card list, search & status filters, create/edit modal (pickup address, return address, operating schedule, printer defaults), inline validation errors, server error banner with retry recovery, forbidden banner, scoped access banner, and success notification.
   - Comprehensive web UI tests (`apps/web/src/tests/warehouses-page-states.test.ts`) covering all 14 UI states.

## Out of scope

- Carrier account linking per warehouse (`FEAT-CAR-01`).
- Source order dispatch and routing (`FEAT-ORD-01`, `FEAT-ORD-02`).

## Business rules and edge cases

- `BR-WH-01 — Tenant Boundary Isolation`: All warehouse operations are strictly constrained to the caller's authenticated `merchant_id`. Inquiring about or attempting to modify a warehouse belonging to another merchant returns 404 `NOT_FOUND`.
- `BR-WH-02 — RBAC Authority`: Creating, updating, deactivating, or setting default warehouse requires the `iam:shop_config` capability. Users lacking this capability receive 403 `FORBIDDEN`.
- `BR-WH-03 — Scope Enforcement`: A user whose `warehouse_scopes` does not contain `*` may only view warehouses whose ID or code is explicitly listed in their `warehouse_scopes`. Requesting an unassigned warehouse returns 403 `FORBIDDEN` (`WAREHOUSE_SCOPE_UNAUTHORIZED`).
- `BR-WH-04 — Code Uniqueness`: Warehouse `code` must be unique per merchant tenant. Attempting to create or rename a warehouse to an existing code returns 409 `CONFLICT` (`WAREHOUSE_CODE_EXISTS`).
- `BR-WH-05 — Single Default Warehouse`: A merchant tenant has at most one default warehouse (`is_default = true`). Setting a warehouse as default atomically resets any other warehouse in the tenant to `is_default = false`. The first warehouse created for a merchant automatically receives `is_default = true`.
- `BR-WH-06 — Return Address Mirroring`: When `use_different_return_address` is false, the return address automatically reflects the pickup address. When set to true, return contact name, phone, address line, district, and city are mandatory.
- `BR-WH-07 — Immutable Audit Trail`: Every warehouse creation, update, deactivation, and default designation produces an audit log entry with correlation ID, actor info, client IP hash, and masked contact details.

## UI states (SCR-WH-01 / /settings/warehouses)

The warehouse settings screen at `/settings/warehouses` implements all mandatory UI states:
- **Loading:** Skeleton list of warehouse cards (`data-testid="warehouse-loading-state"`) during fetch.
- **View / List:** Paginated card grid or table (`data-testid="warehouse-list-state"`) showing warehouse name, code, default badge, status badge, pickup address, return address, operating hours, schedule notes, and printer defaults.
- **Create / Edit Modal:** Tabbed modal (`data-testid="warehouse-modal"`) with 4 tabs: (1) Thông tin kho & Địa chỉ lấy, (2) Địa chỉ hoàn hàng, (3) Lịch hoạt động, (4) Cấu hình in nhãn.
- **Validation:** Real-time inline field errors (`error-warehouse-*`) for Vietnamese phone, required address fields, and code collision.
- **Forbidden:** Read-only view (`data-testid="warehouse-forbidden-banner"`) for users lacking `iam:shop_config` with mutation actions hidden.
- **Empty:** Onboarding empty state (`data-testid="warehouse-empty-state"`) prompting owner to create their first pickup warehouse.
- **Scoped Access:** Info banner (`data-testid="warehouse-scoped-banner"`) indicating restricted `warehouse_scopes`.
- **Error & Recovery:** Error banner (`data-testid="warehouse-error-banner"`) with retry action (`data-testid="retry-error-button"`).
- **Success:** Notification toast (`data-testid="warehouse-success-banner"`).

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence / Real test result |
| --- | --- | --- | --- |
| `AC-WH-01-01` | Owner or user with `iam:shop_config` lists warehouses (`GET /api/v1/warehouses`) | 200 OK with list of all warehouses in tenant | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 200 with both warehouses for merchant A) |
| `AC-WH-01-02` | User with specific `warehouse_scopes` lists warehouses | 200 OK with list filtered strictly to permitted warehouses | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (scoped user receives exactly 1 permitted warehouse) |
| `AC-WH-01-03` | User with specific `warehouse_scopes` views permitted warehouse (`GET /api/v1/warehouses/:id`) | 200 OK with warehouse details | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 200 OK with warehouse details) |
| `AC-WH-01-04` | User with specific `warehouse_scopes` attempts to view unassigned warehouse | 403 `FORBIDDEN` / `WAREHOUSE_SCOPE_UNAUTHORIZED` | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 403 WAREHOUSE_SCOPE_UNAUTHORIZED) |
| `AC-WH-01-05` | Cross-tenant access attempt (`GET /api/v1/warehouses/:foreignId`) | 404 `NOT_FOUND` / 403 `FORBIDDEN`; no data leakage | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 404 WAREHOUSE_NOT_FOUND, zero cross-tenant leakage) |
| `AC-WH-01-06` | Create warehouse with valid pickup address, schedule, contacts, and printer defaults (`POST /api/v1/warehouses`) | 201 Created; record persisted; audit `WAREHOUSE_CREATED` logged | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (DB persistence and audit log confirmed) |
| `AC-WH-01-07` | First created warehouse automatically becomes `is_default: true` | 201 Created; `is_default` is `true` | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (is_default: true verified in DB) |
| `AC-WH-01-08` | Create warehouse with duplicate code within same tenant | 409 `CONFLICT` (`WAREHOUSE_CODE_EXISTS`) | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 409 WAREHOUSE_CODE_EXISTS) |
| `AC-WH-01-09` | Create warehouse with invalid Vietnamese phone number | 400 `VALIDATION_ERROR` with field details on `contact_phone` | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-WH-01-10` | Create warehouse with invalid cutoff time format (e.g. `25:99`) | 400 `VALIDATION_ERROR` with field details on `cutoff_time` | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-WH-01-11` | Create warehouse with invalid printer paper size (e.g. `LETTER`) | 400 `VALIDATION_ERROR` with field details on `printer_paper_size` | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-WH-01-12` | Update warehouse details (`PATCH /api/v1/warehouses/:id`) | 200 OK; updated fields persisted; audit `WAREHOUSE_UPDATED` logged with masked PII | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (DB updated, audit before/after diff has masked phone 090****567) |
| `AC-WH-01-13` | Set warehouse as default (`POST /api/v1/warehouses/:id/default`) | 200 OK; previous default atomically unset; audit `WAREHOUSE_SET_DEFAULT` logged | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (previous default atomically set to false, new default to true) |
| `AC-WH-01-14` | Deactivate warehouse (`DELETE /api/v1/warehouses/:id`) | 200 OK; warehouse status updated to `inactive`; audit `WAREHOUSE_DEACTIVATED` logged | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (status updated to inactive, audit logged) |
| `AC-WH-01-15` | Actor lacking `iam:shop_config` (e.g. `WAREHOUSE` role) attempts mutation | 403 `FORBIDDEN` canonical error | PASS — Verified in `warehouses.supertest.spec.ts` (POST, PATCH, DELETE, set default all return 403 FORBIDDEN) |
| `AC-WH-01-16` | Unauthenticated request to warehouse endpoints | 401 `UNAUTHORIZED` canonical error | PASS — Verified in `warehouses.supertest.spec.ts` (returns 401 UNAUTHORIZED) |
| `AC-WH-01-17` | Audit trail security: sensitive contact phone/email masked in audit log diffs | Sensitive fields masked (`090****567`); plaintext never logged | PASS — Verified in `warehouses.unit.spec.ts` & `warehouses.supertest.spec.ts` (all audit entries checked, zero secrets/unmasked PII) |
| `AC-WH-01-18` | UI state contract on `/settings/warehouses` (loading, view, create/edit modal, return address tab, schedule tab, printer defaults tab, inline validation errors, server error retry, forbidden banner, scoped access banner, success notification) | All 14 mandatory UI states verified in component test harness | PASS — Verified in `apps/web/src/tests/warehouses-page-states.test.ts` (all 14 UI states asserted via `renderToStaticMarkup`) |

## Verification commands

- `pnpm install --frozen-lockfile` — PASSED
- `pnpm db:generate` — PASSED (Prisma Client v6.19.3 generated)
- `pnpm lint` — PASSED (12 tasks successful, 0 errors)
- `pnpm format:check` — PASSED (14 changed files 100% compliant)
- `pnpm typecheck` — PASSED (12 tasks successful, 0 errors)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json --test src/warehouses/warehouses.unit.spec.ts` — PASSED (25/25 unit tests)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/warehouses/warehouses.supertest.spec.ts` — PASSED (17/17 supertest checks)
- `pnpm --filter @shipde/web exec tsx src/tests/warehouses-page-states.test.ts` — PASSED (14/14 UI states verified)
- `pnpm --filter @shipde/web test` — PASSED (all web test suites passed)
- `pnpm contract:check` — PASSED (61 endpoints validated, 0 drift)
- `node scripts/ai/check-no-hardcode.mjs` — PASSED (0 raw instances, 0 new)

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Ready for independent Codex review |

## Residual limitations

None
