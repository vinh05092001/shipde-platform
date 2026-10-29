# FEAT-ORG-01 — Shop profile

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-ORG-01` |
| Feature ID      | `FEAT-ORG-01` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 15 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `database ownership`, `auth`, `audit` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-ORG-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/app.module.ts`, `apps/api/src/shops/*`, `apps/api/package.json`, `apps/web/src/app/settings/shop/*`, `apps/web/src/components/ShopProfileForm.tsx`, `apps/web/src/tests/shop-profile.test.ts`, `apps/web/package.json` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-org-01-shop-profile` |
| Pull Request    | Pending |

## Business outcome

A shop owner (`OWNER`) or authorized administrator (holding the `iam:shop_config` capability) can view and update their shop's organizational profile, encompassing legal identity (brand display name, legal registered business name, tax code, contact email, contact phone, legal registered address), billing profile (billing recipient name, billing email for electronic VAT invoices, billing address, bank settlement details: bank name, account number, beneficiary account name, branch), and operational defaults (canonical timezone e.g. `Asia/Ho_Chi_Minh`, currency `VND`, default shipping fee payer `SHOP` or `RECIPIENT`, default weight unit `g` or `kg`, automated carrier routing toggle, operating delivery notes). The system guarantees that tenant data is strictly isolated server-side, permissions are verified authoritatively, Vietnamese tax code and bank account format rules are enforced, all mutations produce immutable audit log entries, and the UI presents full state coverage (loading, view, edit, validation errors, server errors, forbidden access, success, and recovery) at `SCR-SHOP-01` (`/settings/shop`).

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-ORG-01`: Shop profile ("Legal, billing and operating defaults").
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — DEC-002 ("Shops use their own carrier accounts/contracts by default").
- `docs/product-spec/docs/02-business/END-TO-END-PROCESSES.md` — PR-01 Onboard a shop (Step 3: "Create shop, billing profile, first warehouse and return address"; Step 6: "Configure defaults, notifications and optional OMS").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Shop configuration" (`iam:shop_config`): Owner has full action (`A`), Ops manager has scoped action (`S`), Finance has view (`V`), others denied (`–`). Enforcement rules: "Backend is authoritative; hidden UI controls are insufficient", "Permission evaluation includes tenant, branch, warehouse and carrier-account scope".
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — Route catalog: `SCR-SHOP-01` (`/settings/shop` — "Hồ sơ shop").
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — Section SCR-ONB-01 (Step 1: "Shop/legal and billing profile", Step 5: "Operating defaults/notifications").
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Identity and tenancy aggregate: `Tenant`, `Shop`, `User`.
- `docs/product-spec/docs/04-data/schema.dbml` — `Table shops { id uuid, tenant_id uuid, name varchar, legal_name varchar, tax_code varchar, created_at timestamptz }`.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Section Resource groups: `/shops` ("Shop, branches and warehouses"); API conventions (base path `/api/v1`, timestamps ISO-8601 UTC, money integer VND, tenant derived from authorized session, canonical error envelopes).
- `docs/product-spec/contracts/openapi.yaml` — `/shops` endpoints and `ShopInput` schema (`name`, `legal_name`, `tax_code`, `timezone`).
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Tenant isolation in repository/query layer, backend RBAC and resource scope authorization, immutable audit logs, zero secret or unmasked PII leaks.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, establishing the multi-tenant `merchants` baseline table, user credentials, and audit logging primitives.
- `FEAT-AUTH-06` is merged, providing `SessionGuard` and session resolution.
- `FEAT-RBAC-01` is merged, establishing dynamic roles, `PermissionsGuard`, `@RequirePermissions`, and canonical platform capability `iam:shop_config`.

## Author boundary

`GEMINI` is required because shop profile requires schema extensions on the multi-tenant merchant core, server-side tenant isolation enforcement, RBAC permission evaluation (`iam:shop_config`), immutable audit logging, OpenAPI and contract schema synchronization, and full-state UI implementation on `/settings/shop`.

## In scope

1. `GET /api/v1/shops/profile` — Retrieve current authenticated merchant's shop profile including legal, billing, and operating defaults.
2. `PATCH /api/v1/shops/profile` — Update current merchant's shop profile (legal identity, billing profile, operating defaults) with validation, tenant isolation, and audit logging.
3. `GET /api/v1/shops` — List authorized shops for the caller's session (single-tenant returns current shop profile).
4. `GET /api/v1/shops/:id` — Retrieve shop profile by ID with strict server-side tenant scoping (rejected with 403 `FORBIDDEN` or 404 for foreign merchant IDs).
5. `PATCH /api/v1/shops/:id` — Update shop profile by ID with strict server-side tenant scoping and permission enforcement.
6. Validation rules:
   - Display name: required, 2–255 characters.
   - Legal name: optional, max 255 characters.
   - Tax code: optional, must match Vietnamese standard (10 digits or 10 digits followed by hyphen and 3 digits: `^[0-9]{10}(-[0-9]{3})?$`).
   - Contact email and billing email: optional, valid email format.
   - Contact phone: optional, normalized Vietnamese phone number format (`^0[35789][0-9]{8}$` or `^\+84[35789][0-9]{8}$`).
   - Bank settlement info: bank name (optional, max 128 characters), account number (optional, 6–30 alphanumeric/numeric characters), account name (optional, max 255 characters, uppercase normalized), branch (optional, max 255 characters).
   - Operating defaults: timezone (valid IANA timezone e.g. `Asia/Ho_Chi_Minh`), currency (default `VND`), default fee payer (`SHOP` | `RECIPIENT`), default weight unit (`g` | `kg`), auto-routing flag (boolean), operating notes (max 1000 characters).
7. RBAC & Access control:
   - Mutation (`PATCH`) requires `iam:shop_config` capability via `PermissionsGuard` and `@RequirePermissions('iam:shop_config')`.
   - Read (`GET`) is permitted for `OWNER`, `FINANCE`, or any user holding `iam:shop_config`.
   - Unauthorized roles (such as `WAREHOUSE` or `OPS_CSKH` lacking `iam:shop_config`) receive 403 `FORBIDDEN`.
8. Immutable audit logging:
   - Every mutation records `SHOP_PROFILE_UPDATED` in `audit_logs` containing actor, target merchant, correlation ID, client IP hash, and diff of changed fields without logging sensitive data.
9. Database migration:
   - Extends `merchants` table in `prisma/schema.prisma` with legal, billing, and operating default columns with zero-downtime default values.
10. Contracts & OpenAPI:
    - Update `docs/product-spec/contracts/openapi.yaml` and `@shipde/contracts` with `ShopProfileResponse`, `UpdateShopProfileInput`, and updated `/shops` route definitions.
11. Web UI:
    - Implement `SCR-SHOP-01` at `apps/web/src/app/settings/shop/page.tsx` with `ShopProfileForm` supporting view mode, edit mode, loading skeleton, validation errors, server error retry, forbidden state, success toast, and network recovery.
12. Comprehensive automated tests:
    - Unit tests (`shops.unit.spec.ts`) validating DTO transformations, validation rules, and edge cases.
    - Supertest integration tests (`shops.supertest.spec.ts`) validating HTTP endpoints, tenant isolation, RBAC permissions, validation errors, and audit log generation.
    - Web UI tests (`apps/web/src/tests/shop-profile.test.ts`) validating form rendering, state transitions, validation, and accessibility.

## Out of scope

- Multi-branch CRUD management (`FEAT-ORG-02`).
- Warehouse pickup/return address management (`FEAT-WH-01`).
- Carrier account credentials and connection (`FEAT-CAR-01`).
- Platform operator administrative shop creation / listing (`FEAT-AUTH-02`, already implemented under `/admin/shops`).
- Guided onboarding wizard orchestration (`FEAT-ONB-01`).

## Business rules and edge cases

- `BR-ORG-01 — Tenant Scoping`: All shop profile operations are strictly isolated to the caller's authenticated `merchant_id`. Cross-tenant queries or mutations return 403 `FORBIDDEN`.
- `BR-ORG-02 — RBAC Authority`: Modifying shop profile requires the `iam:shop_config` capability. Users lacking this capability are rejected with 403 `FORBIDDEN`.
- `BR-ORG-03 — Legal Identity Validation`: Display name is required (2–255 characters). Tax code (if provided) must conform to Vietnamese tax format (`^[0-9]{10}(-[0-9]{3})?$`). Contact email and phone must be valid formats.
- `BR-ORG-04 — Billing Profile Validation`: If bank settlement details are provided, bank account number must be 6–30 characters, and bank account name must be uppercase normalized without special characters. Billing email must be valid email format.
- `BR-ORG-05 — Operating Defaults`: Validates timezone against standard list (defaults to `Asia/Ho_Chi_Minh`), currency (defaults to `VND`), default fee payer (`SHOP` or `RECIPIENT`), default weight unit (`g` or `kg`).
- `BR-ORG-06 — Immutable Audit Trail`: Every profile mutation writes an audit log to `audit_logs` capturing actor, target merchant, modified fields, correlation ID, and client IP hash.
- `BR-ORG-07 — Concurrency / Idempotency`: Empty payload is a valid no-op returning 200 OK without corrupting existing data. Multiple updates apply changes atomically.

## UI states

The shop profile interface in `SCR-SHOP-01` (`/settings/shop`) must implement:

- **Loading:** Skeleton list displayed during profile fetching; save buttons display inline spinner during mutation.
- **View / Active:** Formatted display of current shop profile information with "Chỉnh sửa" (Edit) action.
- **Edit:** Interactive form fields with tabbed or sectioned layout (Thông tin pháp lý, Thanh toán & Đối soát, Mặc định vận hành).
- **Validation:** Inline Vietnamese error messages on invalid fields (tax code format, phone format, email format, empty name).
- **Error:** Persistent error banner with "Thử lại" (Retry) action preserving user input.
- **Forbidden:** 403 banner for users lacking `iam:shop_config` or view permissions, disabling or hiding edit controls.
- **Success:** Toast notification "Đã cập nhật hồ sơ shop thành công".
- **Recovery:** Safe reload upon network failure without data loss.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence / Real test result |
| --- | --- | --- | --- |
| `AC-ORG-01-01` | Authenticated owner requests shop profile (`GET /api/v1/shops/profile`) | 200 OK with legal, billing, and operating default fields | PASS — Verified in `shops.supertest.spec.ts` (returns 200 with complete Merchant profile) |
| `AC-ORG-01-02` | Authenticated user with `iam:shop_config` updates legal profile (`PATCH /api/v1/shops/profile`) | 200 OK; updated fields persisted to DB; audit `SHOP_PROFILE_UPDATED` logged | PASS — Verified in `shops.supertest.spec.ts` (DB assertion on `legal_name`, `tax_code`, `audit_logs` record confirmed) |
| `AC-ORG-01-03` | Authenticated user updates billing profile (bank details, billing email) | 200 OK; bank details and billing info persisted to DB; bank account name uppercase normalized | PASS — Verified in `shops.supertest.spec.ts` (account name normalized to `NGUYEN VAN A`, DB assertion confirmed) |
| `AC-ORG-01-04` | Authenticated user updates operating defaults (`default_fee_payer`, `default_weight_unit`, `auto_routing_enabled`) | 200 OK; operating defaults persisted to DB | PASS — Verified in `shops.supertest.spec.ts` (DB assertion on `default_fee_payer: 'RECIPIENT'`, `default_weight_unit: 'kg'`) |
| `AC-ORG-01-05` | Update request with invalid tax code format (e.g. `12345`) | 400 `VALIDATION_ERROR` with field details on `tax_code` | PASS — Verified in `shops.unit.spec.ts` & `shops.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-ORG-01-06` | Update request with invalid contact email or phone | 400 `VALIDATION_ERROR` with field details on `contact_email` / `contact_phone` | PASS — Verified in `shops.unit.spec.ts` & `shops.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-ORG-01-07` | Update request with invalid bank account number format | 400 `VALIDATION_ERROR` with field details on `bank_account_number` | PASS — Verified in `shops.unit.spec.ts` & `shops.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-ORG-01-08` | Update request with invalid `default_fee_payer` enum | 400 `VALIDATION_ERROR` with field details on `default_fee_payer` | PASS — Verified in `shops.unit.spec.ts` & `shops.supertest.spec.ts` (returns 400 VALIDATION_ERROR) |
| `AC-ORG-01-09` | User lacking `iam:shop_config` attempts profile update; FINANCE user gets view-only access | 403 `FORBIDDEN` on mutation; 200 OK on GET for FINANCE | PASS — Verified in `shops.supertest.spec.ts` (WAREHOUSE role rejected with 403 FORBIDDEN; FINANCE user view-only GET verified with 200 OK and mutation rejected with 403 FORBIDDEN per RBAC matrix) |
| `AC-ORG-01-10` | Cross-tenant actor attempts to view or update foreign shop profile (`/api/v1/shops/:foreignId`) | 403 `FORBIDDEN` canonical error; foreign profile unmodified | PASS — Verified in `shops.supertest.spec.ts` (cross-tenant access rejected with 403 FORBIDDEN) |
| `AC-ORG-01-11` | Unauthenticated request to shop endpoints | 401 `SESSION_INVALID` / `UNAUTHORIZED` canonical error | PASS — Verified in `shops.supertest.spec.ts` (returns 401 UNAUTHORIZED) |
| `AC-ORG-01-12` | List shops query (`GET /api/v1/shops`) | 200 OK with list containing caller's shop profile | PASS — Verified in `shops.supertest.spec.ts` (returns 200 with single-tenant list of 1 shop) |
| `AC-ORG-01-13` | UI state contract on `/settings/shop` (loading, view, edit, validation errors, server error retry, forbidden banner, success toast) | All mandatory states verified in component test harness | PASS — Verified in `apps/web/src/tests/shop-profile.test.ts` (all 8 states rendered and asserted via `renderToStaticMarkup`) |
| `AC-ORG-01-14` | Audit log security inspection & masking | No plaintext secrets logged, sensitive fields (full bank account numbers, phone, email) masked in old/new values | PASS — Verified in `shops.supertest.spec.ts` & `shops.unit.spec.ts` (sensitive fields like `bank_account_number: '007****567'` masked in audit diffs; full plaintext account numbers never logged) |

## Verification commands

- `pnpm install --frozen-lockfile` — PASSED (dependencies up-to-date)
- `pnpm db:generate` — PASSED (Prisma Client v6.19.3 generated)
- `pnpm lint` — PASSED (12 tasks successful, 0 errors)
- `pnpm format:check` — PASSED (all 14 changed files 100% compliant)
- `pnpm typecheck` — PASSED (12 tasks successful, 0 errors)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json --test src/shops/shops.unit.spec.ts` — PASSED (all 25 unit tests passed)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/shops/shops.supertest.spec.ts` — PASSED (all 16 supertest acceptance criteria passed including FINANCE view-only and audit masking)
- `pnpm --filter @shipde/web exec tsx src/tests/shop-profile.test.ts` — PASSED (all 9 UI state and form validation tests passed)
- `pnpm contract:check` — PASSED (56 endpoints validated, 0 drift between OpenAPI 3.1.0 and @shipde/contracts)
- `node scripts/ai/check-no-hardcode.mjs` — PASSED (0 raw instances, 0 new)
- `git diff --check` — PASSED (clean, 0 whitespace errors)

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `9aa1a1fdaf56d527db6a1dab61f756c8260b3219` | `CHANGES_REQUIRED` | Resolved in Round 2: (1) P0 Blocker: Added missing `operating_notes VARCHAR(1000)` column to `migration.sql`; (2) P2 Medium: Validated `timezone` against IANA standard list (`isValidTimeZone`) rejecting invalid formats/zones; (3) P2 Medium: Validated `currency` strictly to `VND` in `validateUpdateShopProfileDto` and web form; (4) P2 Low: Aligned `operating_notes` column to `@db.VarChar(1000)` in `prisma/schema.prisma` matching DTO and specification constraints. Merged `origin/main` (FEAT-USR-02). |
| 2 | `6c401a8d1024d9000ffc2e9e623f546713871b83` | `CHANGES_REQUIRED` | Resolved in Round 3: (1) P1: Added supertest coverage for FINANCE user GET shop profile (view-only) and mutation rejection (403) per RBAC matrix, with custom role resolution in ShopsController; (2) P2: Audit logs mask sensitive fields such as bank account number, phone, email, and bank account name using maskIdentifier in before/after diffs; (3) P2: Aligned timezone validation between API and web using single source list SUPPORTED_TIMEZONES and isValidTimeZone from @shipde/contracts. |
| 3 | Pending | Pending | Ready for independent Codex review |

## Residual limitations

None
