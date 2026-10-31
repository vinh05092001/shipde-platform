# FEAT-CAR-01 — Shops can identify carriers, services, canonical statuses and fee components

## Control

| Field | Value |
|---|---|
| Work Item ID | `FEAT-CAR-01` |
| Feature ID | `FEAT-CAR-01` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `30`, slice `S02`, epic `EPIC-CAR` |
| Dependencies | `TASK-FOUND-04` MERGED; `FEAT-AUTH-01` MERGED; `FEAT-AUTH-06` MERGED; `FEAT-RBAC-01` MERGED; `FEAT-RBAC-02` MERGED; `FEAT-ORG-01` MERGED |
| Assigned author | `GEMINI` |
| Risk | `HIGH` — shared taxonomy affects tenant boundaries, shipment state and financial interpretation |
| Allowed paths | `docs/product-spec/work-items/FEAT-CAR-01.md`, `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`, `docs/product-spec/docs/00-control/TRACEABILITY.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `prisma/schema.prisma`, `prisma/migrations/**`, `infra/docker/seed.ts`, `packages/testkit/src/carriers/catalog/**`, `apps/api/src/app.module.ts`, `apps/api/src/rbac/rbac.constants.ts`, `apps/api/src/carrier-catalog/**`, `apps/api/package.json`, `apps/web/src/app/settings/carriers/**`, `apps/web/src/features/carriers/**`, `apps/web/src/tests/carrier-catalog*.test.ts`, `apps/web/e2e/carrier-catalog*.spec.ts`, `apps/web/package.json`, `docs/product-spec/evidence/FEAT-CAR-01/**` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/feat-car-01` |
| Pull Request | Pending |

## Business outcome

Shop owners and permitted operational/finance users can browse and identify carriers, their standard services, canonical shipment statuses, and fee component definitions used by Ship Dễ. Catalog identity is authoritative reference knowledge and must never imply that a shop has connected that carrier account, that a route is available, that a carrier command is executed, or that a price is verified. The resulting reference contracts and UI catalog tab establish a shared domain language supporting downstream account connection (`FEAT-CAR-02`), capability discovery (`FEAT-CAR-04`), quoting (`FEAT-QTE-01`), tracking (`FEAT-TRK-01`), and settlement audit (`FEAT-AUD-01`) without copying provider-specific meanings or codes into consumer screens.

This is the **Carrier catalog** feature defined in section 3 of `MASTER-FEATURE-CATALOG.md`. Account connection is `FEAT-CAR-02`; connection testing is `FEAT-CAR-04`; capability evidence is `FEAT-CAR-06`. Browsing or seeding the catalog does not create merchant carrier accounts or complete carrier onboarding steps.

## Delivery Slices (Slice A & Slice B)

Due to the cross-layer scope of this feature spanning database schema, shared contracts, REST APIs, RBAC authorization, and user-facing web screens, the work is explicitly partitioned into two implementable delivery slices:

### Slice A — Core Carrier Catalog API, Data Model, Contracts, Seeding & Taxonomy Reference

1. **Database Schema & Migrations (`prisma/schema.prisma`, `prisma/migrations/**`)**:
    - `Carrier`: Platform-owned carrier reference (`id` UUID primary key, `catalog_revision` string, `code` enum `CarrierCodeEnum`, `name` string, `logo_url` string optional, `is_active` boolean default true, `evidence_level` string, `description` string optional, `created_at` timestamptz, `updated_at` timestamptz). Unique constraint on `[catalog_revision, code]` and index on `catalog_revision`. Carrier codes are unique per revision (not globally unique across the table), enabling immutable multi-revision publication.
    - `CarrierService`: Supported carrier service catalog (`id` UUID primary key, `carrier_id` UUID foreign key referencing `Carrier.id` with onDelete Cascade, `catalog_revision` string, `carrier_code` enum `CarrierCodeEnum`, `code` string, `name` string, `service_type` string exactly `STANDARD` or `FAST`, `description` string, `is_active` boolean default true, `evidence_level` string inherited from parent carrier and stored denormalized, `source_revision` string, `created_at` timestamptz, `updated_at` timestamptz). Unique constraint on `[catalog_revision, carrier_code, code]`, with indices on `carrier_id` and `[catalog_revision, carrier_code]`.
    - `CanonicalStatusReference`: Canonical shipment status taxonomy (`id` UUID primary key, `catalog_revision` string, `code` string, `category` string exactly one of `COMMAND` / `OPERATIONAL_PRE_TRANSIT` / `OPERATIONAL_IN_TRANSIT` / `OPERATIONAL_TERMINAL`, `label` string, `description` string, `stage_order` integer, `created_at` timestamptz, `updated_at` timestamptz). Unique constraint on `[catalog_revision, code]` and index on `catalog_revision`.
    - `FeeComponentReference`: Canonical fee component definitions (`id` UUID primary key, `catalog_revision` string, `code` string, `name` string, `category` string exactly one of `BASE` / `SURCHARGE` / `COD` / `INSURANCE` / `RETURN` / `VAT`, `description` string, `is_refundable` boolean, `vat_applicable` boolean, `created_at` timestamptz, `updated_at` timestamptz). Unique constraint on `[catalog_revision, code]` and index on `catalog_revision`. `VAT` is the tax line itself and is never itself VAT-applicable.
    - `CatalogCompatibilityMapping`: Versioned raw-to-canonical rows (`id` UUID primary key, `catalog_revision` string, `carrier_code` nullable enum `CarrierCodeEnum`, `domain` string exactly `CARRIER_ALIAS` / `STATUS` / `FEE`, `raw_key` string, `canonical_code` string nullable, `disposition` string exactly `MAPPED` or `UNMAPPED`, `created_at` timestamptz, `updated_at` timestamptz). Unique constraint on `[catalog_revision, carrier_code, domain, raw_key]` and index on `[catalog_revision, domain]`. A null `canonical_code` is legal only when `disposition` is `UNMAPPED`.
 2. **Deterministic Seed Data (`infra/docker/seed.ts`, `packages/testkit/src/carriers/catalog/**`)**:
    - Seed catalog revision `CATALOG-2026-10-31` only. The exact carrier, service, status, fee and mapping rows are the pinned dataset in "Approved catalog revision `CATALOG-2026-10-31`" below. Do not invent additional codes.
3. **Contracts & OpenAPI (`docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`)**:
   - Define `/api/v1/carrier-catalog/carriers`, `/api/v1/carrier-catalog/carriers/{code}`, `/api/v1/carrier-catalog/statuses`, `/api/v1/carrier-catalog/fee-components`.
   - Schemas: `CarrierResponse`, `CarrierDetailResponse`, `CarrierServiceResponse`, `CanonicalStatusResponse`, `FeeComponentResponse`.
   - Boundary alias normalization for `VTP` -> `VIETTEL_POST` and `JT_EXPRESS` -> `JT`.
4. **RBAC Authorization (`apps/api/src/rbac/rbac.constants.ts`)**:
   - Add canonical permission `iam:carrier_catalog:read` (`carrier:catalog:read`).
   - Default assignment in dynamic role templates: `OWNER`, `OPS_MANAGER`, `ORDER_OPERATOR`, `FINANCE`.
5. **Backend Implementation (`apps/api/src/carrier-catalog/**`, `apps/api/src/app.module.ts`)**:
   - NestJS module with controller, service, DTOs, repository queries.
   - Enforce `@UseGuards(SessionGuard, PermissionsGuard)` and `@RequirePermissions('iam:carrier_catalog:read')`.
   - Server-side tenant session validation; return canonical error envelopes on failure.
   - Comprehensive unit (`carrier-catalog.unit.spec.ts`) and supertest integration (`carrier-catalog.supertest.spec.ts`) test suites.

### Slice B — Web UI Presentation, Detail Views & Acceptance Journey

1. **Screen Location & Navigation (`apps/web/src/app/settings/carriers/**`)**:
   - Extend `SCR-CAR-01` (`/settings/carriers`) by adding a dedicated "Carrier Catalog" tab (`Danh mục hãng vận chuyển`) alongside existing carrier accounts.
   - Clean tab separation: catalog browsing is isolated from account linking/credential actions.
2. **Catalog Presentation Components (`apps/web/src/features/carriers/catalog/**`)**:
   - `CarrierCatalogView`: Master container with tab navigation and filter controls.
   - `CarrierGrid` / `CarrierCard`: Cards displaying carrier brand name, canonical code, logo placeholder, active status, and evidence level badge (`VERIFIED_OFFICIAL` vs `CONFIRMATION_REQUIRED` warning badge).
    - `CarrierServiceList`: Detail drawer or section listing carrier services, service codes, delivery speed types, and the service evidence-level badge inherited from the parent carrier.
   - `CanonicalStatusReferenceModal`: Reference view explaining decoupled command states vs operational shipment states and descriptions.
   - `FeeTaxonomyReferenceModal`: Reference view explaining canonical fee types, VAT applicability, and refundability.
3. **Mandatory UI State Coverage (`docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md`)**:
   - Loading: Accessible skeleton table/grid with `aria-busy="true"`.
   - Empty: Clear zero-state message when filters return no matches, with a "Clear filters" button.
   - Validation: Inline error messages when search or filter parameters are malformed.
   - Error: Sanitized error state displaying correlation ID and a functional "Retry" action.
   - Forbidden: 403 banner informing the user that their role lacks `iam:carrier_catalog:read`.
   - Partial: Explicit indicator badge for confirmation-required partner evidence.
   - Success: Fully rendered carrier cards and service tables.
   - Recovery: Safe retry preserving active tab and search filters.
4. **Automated UI & E2E Testing (`apps/web/src/tests/**`, `apps/web/e2e/**`)**:
   - Component tests (`carrier-catalog.test.ts`) covering all state transitions and interactions.
   - Playwright E2E spec (`carrier-catalog.spec.ts`) verifying the real browser catalog browsing journey and accessibility (`pnpm test:a11y`).

## Source references

Links are relative to this Work Item:

| Source | Applicable heading / IDs and consequence |
|---|---|
| [Baseline](../docs/00-control/BASELINE-AND-DECISIONS.md#product-decisions) | DEC-002 own accounts; DEC-003 no inferred availability; DEC-004 three price evidence layers; DEC-005 reconcile unknown commands; DEC-013 maker-checker; `HUMAN-DECISION-FEAT-CAR-01-2026-10-31` |
| [Vision](../docs/01-product/PRODUCT-VISION-SCOPE.md#before-shipment) | Before shipment; Boundaries; canonical GHN, GHTK, VIETTEL_POST, JT; VTP and J&T require partner evidence confirmation (OI-001/002) |
| [Feature catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md#3-carrier-accounts-and-configuration) | FEAT-CAR-01 Carrier catalog; section 11 FEAT-ADM-01 reference/config management CRUD is separate |
| [Actors](../docs/01-product/ACTORS-PERSONAS.md#actors-and-personas) | SHOP_OWNER, OPS_MANAGER, ORDER_OPERATOR, FINANCE, SHIPDE_OPERATOR, SYSTEM_ADMIN |
| [Business rules](../docs/02-business/BUSINESS-RULES-DECISION-TABLES.md) | BR-AVL-01/02/03, BR-QTE-01, BR-TRK-01/02/03, BR-RATE-01/02, BR-AUD-01 |
| [State machines](../docs/02-business/STATE-MACHINES.md) | Shipment lifecycle; Carrier account lifecycle; raw states never replace canonical history; command states decoupled |
| [RBAC](../docs/02-business/RBAC-APPROVAL-MATRIX.md) | Capability `iam:carrier_catalog:read` approved for Owner, Ops manager, Order operator, Finance; platform mutation reserved for admin |
| [Screens](../docs/03-ux/SCREEN-SPECIFICATIONS.md#scr-car-01-carrier-accounts) | SCR-CAR-01 `/settings/carriers`; catalog presented as dedicated reference tab |
| [Navigation](../docs/03-ux/INFORMATION-ARCHITECTURE.md#route-catalog) | Route catalog: SCR-CAR-01 `/settings/carriers` |
| [UX rules](../docs/03-ux/DESIGN-SYSTEM-UX-RULES.md) | Full UI state contract: loading, empty, validation, error, forbidden, partial, success, recovery, accessibility |
| [Domain](../docs/04-data/DOMAIN-MODEL-ERD.md#carrier-and-shipping) | Carrier, CarrierService, CarrierAccount, CarrierCapability; versioned reference data |
| [Dictionary](../docs/04-data/DATA-DICTIONARY.md#carrier-account) | Canonical carrier_code: GHN, GHTK, VIETTEL_POST, JT; aliases VTP, JT_EXPRESS normalized at API boundaries |
| [Conceptual schema](../docs/04-data/schema.dbml) | carriers, carrier_services, canonical_status_references, fee_component_references |
| [API semantics](../docs/05-api-integrations/INTERNAL-API.md) | `/carrier-catalog` endpoints, canonical error envelope with correlation_id |
| [OpenAPI](../contracts/openapi.yaml) | `/carrier-catalog/carriers`, `/carrier-catalog/statuses`, `/carrier-catalog/fee-components` |
| [Capability matrix](../docs/05-api-integrations/CARRIER-CAPABILITY-MATRIX.md) | Evidence levels: VERIFIED_OFFICIAL (GHN, GHTK), CONFIRMATION_REQUIRED (VIETTEL_POST, JT) |
| [Architecture](../docs/06-architecture/ADR.md) | ADR-001/002/003/006/007; NestJS, Prisma/Postgres, immutable reference provenance |
| [Security](../docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md) | Tenant isolation, session guard, RBAC permission guard, zero secret or unmasked PII leak |
| [Traceability](../docs/00-control/TRACEABILITY.md) | Traces FEAT-CAR-01 to UC-CAR-01, BR-CAR-01..09, SCR-CAR-01, AC-CAR-01-01..12 |

## Preconditions and dependencies

| Prerequisite | Merged evidence | Integration boundary |
|---|---|---|
| TASK-FOUND-04 | `9d101f4e` / PR #13; MERGED | Monorepo structure, OpenAPI generator, verification gates |
| FEAT-AUTH-01 | `473f8be0` / PR #447; MERGED | Multi-tenant merchant baseline, user credentials |
| FEAT-AUTH-06 | `9daaeaec` / PR #457; MERGED | `SessionGuard`, session resolution from token/cookie |
| FEAT-RBAC-01 | `7969cad9` / PR #459; MERGED | Dynamic role assignment, `PermissionsGuard`, `@RequirePermissions` |
| FEAT-RBAC-02 | `699da31b` / PR #474; MERGED | Resource scoping (branch, warehouse, account) |
| FEAT-ORG-01 | `86ca9832` / PR #458; MERGED | Shop profile and tenant context |

## Author boundary

`GEMINI` is the assigned author: this is vertical full-stack work spanning database modeling, Prisma migrations, NestJS backend architecture, OpenAPI contract synchronization, RBAC permission extension, and user-facing Next.js UI development with accessibility and state coverage.

The author must respect the following constraints:
1. No mutation of production carrier accounts or execution of external carrier adapter commands.
2. No client-only mock state: all UI presentations must bind to real `/api/v1/carrier-catalog` backend endpoints.
3. No hardcoded carrier codes outside the approved canonical set (`GHN`, `GHTK`, `VIETTEL_POST`, `JT`).
4. Strict fail-closed error handling: unauthorized access returns 403 `FORBIDDEN`; unknown carriers return 404 `RESOURCE_NOT_FOUND`.
5. PII and secrets must never appear in logs, error envelopes, or UI components.

## In scope

1. **Slice A (Backend & Contracts)**:
   - Persisted reference tables `carriers`, `carrier_services`, `canonical_status_references`, `fee_component_references` in `prisma/schema.prisma` with zero-downtime migration.
   - Seed scripts in `infra/docker/seed.ts` populating canonical carriers (GHN, GHTK, VIETTEL_POST, JT), services, statuses, and fee components.
   - Updated OpenAPI contract in `docs/product-spec/contracts/openapi.yaml` and regenerated `@shipde/contracts`.
   - New NestJS feature module `apps/api/src/carrier-catalog/` registered in `apps/api/src/app.module.ts`.
   - Endpoints:
     - `GET /api/v1/carrier-catalog/carriers` (query options: `?is_active=true`)
     - `GET /api/v1/carrier-catalog/carriers/:code` (returns carrier detail with service array; normalizes `VTP` -> `VIETTEL_POST`, `JT_EXPRESS` -> `JT`)
     - `GET /api/v1/carrier-catalog/statuses` (returns canonical status list with category metadata)
     - `GET /api/v1/carrier-catalog/fee-components` (returns canonical fee components with VAT and refundability flags)
   - RBAC capability `iam:carrier_catalog:read` registered in `apps/api/src/rbac/rbac.constants.ts`.
   - Unit tests and supertest integration tests for all endpoints.
2. **Slice B (Frontend & E2E)**:
   - Dedicated "Carrier Catalog" tab in `SCR-CAR-01` at `/settings/carriers`.
   - Components in `apps/web/src/features/carriers/catalog/` rendering carrier cards, service lists, status taxonomy modal, and fee taxonomy modal.
   - Complete UI state handling: loading, empty, validation, error, forbidden, partial, success, recovery.
   - Accessible keyboard navigation and WCAG AA compliance.
   - Component unit tests and Playwright E2E browser tests.

## Out of scope

1. Tenant-specific carrier account connection and credentials encryption (`FEAT-CAR-02`).
2. Live carrier credential testing and capability discovery (`FEAT-CAR-04`).
3. Real-time rate quoting and price calculation (`FEAT-QTE-01`).
4. Live serviceability route checks (`FEAT-AVL-01`).
5. Live shipment booking, waybill generation, or carrier order cancellation (`FEAT-SHP-01`).
6. Webhook ingestion and tracking state machine transition execution (`FEAT-TRK-01`).
7. Settlement file import, rate reconciliation, and discrepancy auditing (`FEAT-AUD-01`).
8. Platform administrative mutation UI for reference catalogs (`FEAT-ADM-01`).

## Business rules and edge cases

| Rule ID | Name | Required observable behavior |
|---|---|---|
| `BR-CAR-01` | Platform-Owned Reference Catalog | The carrier catalog is a global, platform-owned reference repository. Tenants have read-only access. Tenant-specific overrides or private catalog overlays are prohibited. Every read response includes `catalog_revision`. The only approved revision is `CATALOG-2026-10-31`. A later revision is a new immutable row set published by `FEAT-ADM-01`; this Work Item never updates a published revision in place. All reference tables enforce revision-scoped uniqueness (`@@unique([catalogRevision, code])`), guaranteeing that multiple revisions can coexist without primary key collisions or overwrites. |
| `BR-CAR-02` | Canonical Carrier Codes & Boundary Aliases | Authoritative carrier codes are strictly `GHN`, `GHTK`, `VIETTEL_POST`, and `JT`. Boundary adapters and query parameters transparently map legacy aliases `VTP` -> `VIETTEL_POST` and `JT_EXPRESS` -> `JT`. Unknown carrier codes return 404 `RESOURCE_NOT_FOUND`. |
| `BR-CAR-03` | Catalog Separation from Account & Capability | Catalog membership does not create a merchant carrier account, grant operational capabilities, or mark routes available. Browsing the catalog triggers zero third-party carrier API calls. |
| `BR-CAR-04` | Decoupled Command vs Operational Statuses | Pre-transit shipment command execution states (`CREATING`, `CREATED`, `CREATE_FAILED`, `CREATE_OUTCOME_UNKNOWN`) are strictly separated from post-creation operational shipment lifecycle states (`DRAFT`, `READY_TO_PICK`, `PICKING`, `PICKED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `RETURNING`, `RETURNED`, `CANCELLED`, `LOST`, `DAMAGED`). |
| `BR-CAR-05` | Raw Status & Fee Key Preservation | Downstream tracking and settlement must preserve original provider strings. The catalog provides authoritative canonical mapping definitions; encountering an unknown provider status or unmapped fee key yields `null`/unmapped, never defaulting to `IN_TRANSIT` or zero fee. |
| `BR-CAR-06` | Evidence Level Transparency | Every carrier and every service record surfaces `evidence_level`. Services inherit the parent carrier level and store it denormalized: `VERIFIED_OFFICIAL` for GHN and GHTK, `CONFIRMATION_REQUIRED` for VIETTEL_POST and JT. A service must not claim a stronger level than its carrier. The UI displays a warning badge on both the carrier card and each of its services when the level is `CONFIRMATION_REQUIRED` (OI-001/OI-002). |
| `BR-CAR-07` | RBAC & Tenant Scoping | Querying catalog endpoints requires an active user session and the `iam:carrier_catalog:read` permission. Unauthenticated callers receive 401 `UNAUTHORIZED`; unauthorized roles receive 403 `FORBIDDEN`. Global catalog queries never join or expose private tenant account rows. |
| `BR-CAR-08` | Fee Taxonomy Semantics | The approved fee catalog is exactly the eight keys in the fee table below. Categories are `BASE`, `SURCHARGE`, `COD`, `INSURANCE`, `RETURN` and `VAT`. `vat_applicable` means the component is a VAT base, not that VAT has been calculated. `VAT` itself has `vat_applicable=false`. No fee row stores an amount, rate or currency. An unmapped raw fee key stays unmapped and is never coerced to `BASE_FREIGHT` or zero. |
| `BR-CAR-09` | Immutable Platform Audit | Platform administrative changes to the catalog (deferred to `FEAT-ADM-01`) produce immutable audit logs (`PLATFORM_CARRIER_CATALOG_UPDATED`). Unauthorized catalog read attempts trigger security audit events. |

## UI states

The catalog view on `SCR-CAR-01` (`/settings/carriers?tab=catalog`) must implement all required UI states:

| State | Required observable behavior |
|---|---|
| Loading | Accessible skeleton grid/table with `aria-busy="true"` and `aria-label="Loading carrier catalog"`. No stale or test account data shown. |
| Empty | Informative empty state displayed when filters (e.g. search term) match zero carriers, with a "Clear search filters" button. |
| Validation | Immediate field-level feedback if search queries contain illegal characters. Preserves current filter text. |
| Error | Sanitized error card displaying human-readable failure message and `correlation_id`. Includes a functional "Try again" button that re-executes the query. |
| Forbidden | 403 banner explaining that the caller's role lacks the `iam:carrier_catalog:read` permission, directing the user to their shop administrator. |
| Not found | Displayed when navigating to a non-existent carrier code (`/settings/carriers?tab=catalog&carrier=UNKNOWN`), with a button to return to the full catalog. |
| Partial | Warning badge displayed on carrier cards with `CONFIRMATION_REQUIRED` evidence level (`VIETTEL_POST`, `JT`), stating that live connection requires partner confirmation. |
| Success | High-contrast carrier cards showing logo, name, code, status, and evidence badge. Clickable service list modal and taxonomy reference guides. |
| Recovery | Network retry preserves the active tab and filter state without resetting the view or losing user context. |
| Responsive / A11y | Labeled controls, keyboard tab order, ARIA dialog attributes for taxonomy modals, WCAG AA contrast, and narrow-screen responsive grid down to 320px. |

## API, event and data impact

### Endpoints (Slice A)

Every successful catalog response is an object `{ "catalog_revision": "CATALOG-2026-10-31", "data": ... }`. List endpoints return `data` as an array sorted by the order in the pinned tables. There is no pagination in this revision.

1. `GET /api/v1/carrier-catalog/carriers`:
   - Query params: `is_active` (boolean, optional). Omit it to return every seeded carrier.
   - `data[]` of `CarrierResponse`: `id`, `code`, `name`, `logo_url`, `is_active`, `evidence_level`, `description`, `catalog_revision`.
2. `GET /api/v1/carrier-catalog/carriers/:code`:
   - Path params: canonical `GHN`, `GHTK`, `VIETTEL_POST`, `JT`, or boundary aliases `VTP` and `JT_EXPRESS` only. Matching is case-sensitive. `vtp`, `ViettelPost`, `J&T` and any other token are unrecognized.
   - `data` is `CarrierDetailResponse`: the carrier fields plus `services[]` of `CarrierServiceResponse` (`id`, `code`, `name`, `service_type`, `description`, `is_active`, `evidence_level`, `source_revision`).
   - Error: `404 RESOURCE_NOT_FOUND` for any unrecognized code. The body is the canonical error envelope and contains no catalog rows.
3. `GET /api/v1/carrier-catalog/statuses`:
   - `data[]` of `CanonicalStatusResponse`: `code`, `category`, `label`, `description`, `stage_order`, `catalog_revision`.
4. `GET /api/v1/carrier-catalog/fee-components`:
   - `data[]` of `FeeComponentResponse`: `code`, `name`, `category`, `description`, `is_refundable`, `vat_applicable`, `catalog_revision`.
5. `GET /api/v1/carrier-catalog/compatibility`:
   - Query params, all optional and combinable: `domain` (`CARRIER_ALIAS` | `STATUS` | `FEE`), `carrier_code` (canonical code; aliases are normalized before filter), `raw_key` (exact string).
   - `data[]` of `CompatibilityMappingResponse`: `catalog_revision`, `carrier_code` (null for carrier-independent rows), `domain`, `raw_key`, `canonical_code` (null when unmapped), `disposition` (`MAPPED` | `UNMAPPED`).
   - A query that matches nothing returns `200` with `data: []`. It does not 404.
   - Lookup rule used by `AC-CAR-01-06`: exact `(catalog_revision, carrier_code, domain, raw_key)` first; if none, exact `(catalog_revision, null, domain, raw_key)`; if none, result is `{ canonical_code: null, disposition: "UNMAPPED" }`. Never substitute `IN_TRANSIT`, `BASE_FREIGHT` or `0`.

### Database Models (`prisma/schema.prisma`)

```prisma
model Carrier {
  id              String           @id @default(uuid()) @db.Uuid
  catalogRevision String           @map("catalog_revision") @db.VarChar(40)
  code            CarrierCodeEnum
  name            String           @db.VarChar(100)
  logoUrl         String?          @map("logo_url") @db.VarChar(500)
  isActive        Boolean          @default(true) @map("is_active")
  evidenceLevel   String           @map("evidence_level") @db.VarChar(50)
  description     String?          @db.Text
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)
  services        CarrierService[]

  @@unique([catalogRevision, code])
  @@index([catalogRevision])
  @@map("carriers")
}

model CarrierService {
  id              String          @id @default(uuid()) @db.Uuid
  carrierId       String          @map("carrier_id") @db.Uuid
  catalogRevision String          @map("catalog_revision") @db.VarChar(40)
  carrierCode     CarrierCodeEnum @map("carrier_code")
  code            String          @db.VarChar(100)
  name            String          @db.VarChar(150)
  serviceType     String          @map("service_type") @db.VarChar(50)
  description     String          @db.Text
  isActive        Boolean         @default(true) @map("is_active")
  evidenceLevel   String          @map("evidence_level") @db.VarChar(50)
  sourceRevision  String          @map("source_revision") @db.VarChar(80)
  createdAt       DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)
  carrier         Carrier         @relation(fields: [carrierId], references: [id], onDelete: Cascade)

  @@unique([catalogRevision, carrierCode, code])
  @@index([carrierId])
  @@index([catalogRevision, carrierCode])
  @@map("carrier_services")
}

model CanonicalStatusReference {
  id              String   @id @default(uuid()) @db.Uuid
  catalogRevision String   @map("catalog_revision") @db.VarChar(40)
  code            String   @db.VarChar(50)
  category        String   @db.VarChar(50)
  label           String   @db.VarChar(100)
  description     String   @db.Text
  stageOrder      Int      @map("stage_order")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([catalogRevision, code])
  @@index([catalogRevision])
  @@map("canonical_status_references")
}

model FeeComponentReference {
  id              String   @id @default(uuid()) @db.Uuid
  catalogRevision String   @map("catalog_revision") @db.VarChar(40)
  code            String   @db.VarChar(50)
  name            String   @db.VarChar(100)
  category        String   @db.VarChar(50)
  description     String   @db.Text
  isRefundable    Boolean  @default(false) @map("is_refundable")
  vatApplicable   Boolean  @default(true) @map("vat_applicable")
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([catalogRevision, code])
  @@index([catalogRevision])
  @@map("fee_component_references")
}

model CatalogCompatibilityMapping {
  id              String           @id @default(uuid()) @db.Uuid
  catalogRevision String           @map("catalog_revision") @db.VarChar(40)
  carrierCode     CarrierCodeEnum? @map("carrier_code")
  domain          String           @db.VarChar(20)
  rawKey          String           @map("raw_key") @db.VarChar(100)
  canonicalCode   String?          @map("canonical_code") @db.VarChar(50)
  disposition     String           @db.VarChar(20)
  createdAt       DateTime         @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime         @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([catalogRevision, carrierCode, domain, rawKey])
  @@index([catalogRevision, domain])
  @@map("catalog_compatibility_mappings")
}
```

`evidenceLevel` has no database default. Seed writes the pinned value. `catalogRevision` on every seeded row of this Work Item is `CATALOG-2026-10-31`.

## Approved catalog revision `CATALOG-2026-10-31`

Owner of this revision: platform catalog, published read-only by FEAT-CAR-01. Mutation owner remains `FEAT-ADM-01`. Provenance is the `catalog_revision` column across all reference models (`Carrier`, `CarrierService`, `CanonicalStatusReference`, `FeeComponentReference`, `CatalogCompatibilityMapping`) plus `source_revision` on each service. Revision identity is scoped per table via composite unique constraints `[catalog_revision, code]` and UUID primary keys, allowing subsequent revisions published by `FEAT-ADM-01` to coexist immutably as distinct row sets without overwriting or schema migrations. Carrier services link directly to their parent carrier via `carrier_id` foreign key with cascade deletion. Responses echo `catalog_revision` so a client can detect which published set it read. This Work Item does not add an update endpoint.

### Carriers

| code | name | evidence_level | is_active | description |
|---|---|---|---|---|
| `GHN` | Giao Hàng Nhanh | `VERIFIED_OFFICIAL` | true | Official public API surface recorded in `docs/product-spec/docs/05-api-integrations/GHN.md`. Catalog membership is not an account grant. |
| `GHTK` | Giao Hàng Tiết Kiệm | `VERIFIED_OFFICIAL` | true | Official public OpenAPI surface recorded in `docs/product-spec/docs/05-api-integrations/GHTK.md`. Catalog membership is not an account grant. |
| `VIETTEL_POST` | Viettel Post | `CONFIRMATION_REQUIRED` | true | Partner confirmation required (`OI-001`). Reference identity only. |
| `JT` | J&T Express Vietnam | `CONFIRMATION_REQUIRED` | true | Partner confirmation required (`OI-002`). Reference identity only. |

`logo_url` is null for every carrier in this revision. The UI renders a text monogram from `code`. Do not invent a logo URL.

### Services

Service identity is a Ship Dễ reference code, not a provider service id. `source_revision` records why the row exists. `evidence_level` is copied from the parent carrier. Labels are Vietnamese display names. No other service is seeded.

| carrier_code | code | name | service_type | evidence_level | source_revision | description |
|---|---|---|---|---|---|---|
| `GHN` | `GHN_STANDARD` | GHN tiêu chuẩn | `STANDARD` | `VERIFIED_OFFICIAL` | `GHN-PUBLIC-API-2026-08-24` | Reference bucket for GHN available-service results whose delivery class is standard. Not a pinned GHN `service_id`. |
| `GHN` | `GHN_FAST` | GHN hoả tốc | `FAST` | `VERIFIED_OFFICIAL` | `GHN-PUBLIC-API-2026-08-24` | Reference bucket for GHN available-service results whose delivery class is express. Not a pinned GHN `service_id`. |
| `GHTK` | `GHTK_STANDARD` | GHTK tiết kiệm | `STANDARD` | `VERIFIED_OFFICIAL` | `GHTK-OPENAPI-2026-08-24` | Reference bucket for GHTK solution/service-list results whose class is standard. Not a pinned GHTK solution id. |
| `GHTK` | `GHTK_FAST` | GHTK nhanh | `FAST` | `VERIFIED_OFFICIAL` | `GHTK-OPENAPI-2026-08-24` | Reference bucket for GHTK solution/service-list results whose class is express. Not a pinned GHTK solution id. |
| `VIETTEL_POST` | `VTP_STANDARD` | Viettel Post tiêu chuẩn | `STANDARD` | `CONFIRMATION_REQUIRED` | `OI-001-UNCONFIRMED` | Placeholder identity pending partner service master. Do not call a Viettel Post API to fill it. |
| `VIETTEL_POST` | `VTP_FAST` | Viettel Post hoả tốc | `FAST` | `CONFIRMATION_REQUIRED` | `OI-001-UNCONFIRMED` | Placeholder identity pending partner service master. Do not call a Viettel Post API to fill it. |
| `JT` | `JT_STANDARD` | J&T tiêu chuẩn | `STANDARD` | `CONFIRMATION_REQUIRED` | `OI-002-UNCONFIRMED` | Placeholder identity pending Vietnam partner service master. Do not copy another country's J&T service id. |
| `JT` | `JT_FAST` | J&T nhanh | `FAST` | `CONFIRMATION_REQUIRED` | `OI-002-UNCONFIRMED` | Placeholder identity pending Vietnam partner service master. Do not copy another country's J&T service id. |

`VTP_STANDARD` and `VTP_FAST` keep the `VTP_` code prefix as the approved service code. Their `carrier_code` is `VIETTEL_POST`, never `VTP`. All eight `is_active` values are true.

### Canonical statuses

Command rows are not shipment-lifecycle rows. Operational rows are the shipment lifecycle. `stage_order` is the display order, not a legal transition. Transitions stay in `STATE-MACHINES.md`.

| code | category | stage_order | label |
|---|---|---|---|
| `CREATING` | `COMMAND` | 10 | Đang tạo vận đơn |
| `CREATED` | `COMMAND` | 20 | Đã tạo vận đơn |
| `CREATE_FAILED` | `COMMAND` | 30 | Tạo vận đơn thất bại |
| `CREATE_OUTCOME_UNKNOWN` | `COMMAND` | 40 | Chưa xác định kết quả tạo |
| `DRAFT` | `OPERATIONAL_PRE_TRANSIT` | 110 | Nháp |
| `READY_TO_PICK` | `OPERATIONAL_PRE_TRANSIT` | 120 | Sẵn sàng lấy |
| `PICKING` | `OPERATIONAL_PRE_TRANSIT` | 130 | Đang lấy |
| `PICKED` | `OPERATIONAL_PRE_TRANSIT` | 140 | Đã lấy |
| `IN_TRANSIT` | `OPERATIONAL_IN_TRANSIT` | 210 | Đang luân chuyển |
| `OUT_FOR_DELIVERY` | `OPERATIONAL_IN_TRANSIT` | 220 | Đang giao |
| `DELIVERY_FAILED` | `OPERATIONAL_TERMINAL` | 310 | Giao thất bại |
| `RETURNING` | `OPERATIONAL_TERMINAL` | 320 | Đang hoàn |
| `RETURNED` | `OPERATIONAL_TERMINAL` | 330 | Đã hoàn |
| `DELIVERED` | `OPERATIONAL_TERMINAL` | 340 | Đã giao |
| `CANCELLED` | `OPERATIONAL_TERMINAL` | 350 | Đã huỷ |
| `LOST` | `OPERATIONAL_TERMINAL` | 360 | Thất lạc |
| `DAMAGED` | `OPERATIONAL_TERMINAL` | 370 | Hư hỏng |

`description` for each status is the label plus ": canonical shipment status. Not a provider raw status." `DELIVERY_FAILED` is terminal for this taxonomy's category, while the state machine still allows redelivery back to `IN_TRANSIT` and return to `RETURNING`. Do not collapse those transitions.

### Fee components

Amounts are out of scope. `is_refundable=true` means a later settlement credit may reverse the component. It does not mean the component is always refunded.

| code | name | category | is_refundable | vat_applicable | description |
|---|---|---|---|---|---|
| `BASE_FREIGHT` | Cước chính | `BASE` | true | true | Core transport charge before surcharges and tax. |
| `SURCHARGE` | Phụ phí | `SURCHARGE` | true | true | Catch-all surcharge that has no narrower approved key. |
| `REMOTE_AREA_SURCHARGE` | Phụ phí vùng xa | `SURCHARGE` | true | true | Remote-area surcharge. Not part of `BASE_FREIGHT`. |
| `COD_FEE` | Phí thu hộ | `COD` | true | true | Carrier fee for collecting COD. Not the COD principal. |
| `INSURANCE_FEE` | Phí bảo hiểm | `INSURANCE` | true | true | Declared-value insurance charge. |
| `RETURN_FEE` | Phí hoàn | `RETURN` | false | true | Return-shipping charge. Not refundable in this revision. |
| `OTHER_FEE` | Phí khác | `SURCHARGE` | true | true | Provider component recognised as a fee but not classified more narrowly. |
| `VAT` | Thuế GTGT | `VAT` | false | false | VAT amount line. Not itself a VAT base. Never store a VAT rate here. |

### Compatibility mappings

Carrier-alias rows use `carrier_code` null because the raw token is the carrier identity. Status rows are carrier-specific. Fee rows are carrier-independent (`carrier_code` null) because this revision defines no provider fee-key crosswalk beyond the canonical keys. A raw fee string equal to a canonical code maps to itself. Any other raw fee string resolves `UNMAPPED`.

| carrier_code | domain | raw_key | canonical_code | disposition |
|---|---|---|---|---|
| null | `CARRIER_ALIAS` | `VTP` | `VIETTEL_POST` | `MAPPED` |
| null | `CARRIER_ALIAS` | `JT_EXPRESS` | `JT` | `MAPPED` |
| null | `CARRIER_ALIAS` | `GHN` | `GHN` | `MAPPED` |
| null | `CARRIER_ALIAS` | `GHTK` | `GHTK` | `MAPPED` |
| null | `CARRIER_ALIAS` | `VIETTEL_POST` | `VIETTEL_POST` | `MAPPED` |
| null | `CARRIER_ALIAS` | `JT` | `JT` | `MAPPED` |
| `GHN` | `STATUS` | `ready_to_pick` | `READY_TO_PICK` | `MAPPED` |
| `GHN` | `STATUS` | `picking` | `PICKING` | `MAPPED` |
| `GHN` | `STATUS` | `money_collect_picking` | `PICKING` | `MAPPED` |
| `GHN` | `STATUS` | `picked` | `PICKED` | `MAPPED` |
| `GHN` | `STATUS` | `storing` | `IN_TRANSIT` | `MAPPED` |
| `GHN` | `STATUS` | `sorting` | `IN_TRANSIT` | `MAPPED` |
| `GHN` | `STATUS` | `transporting` | `IN_TRANSIT` | `MAPPED` |
| `GHN` | `STATUS` | `delivering` | `OUT_FOR_DELIVERY` | `MAPPED` |
| `GHN` | `STATUS` | `money_collect_delivering` | `OUT_FOR_DELIVERY` | `MAPPED` |
| `GHN` | `STATUS` | `delivered` | `DELIVERED` | `MAPPED` |
| `GHN` | `STATUS` | `delivery_fail` | `DELIVERY_FAILED` | `MAPPED` |
| `GHN` | `STATUS` | `waiting_to_return` | `RETURNING` | `MAPPED` |
| `GHN` | `STATUS` | `return` | `RETURNING` | `MAPPED` |
| `GHN` | `STATUS` | `returned` | `RETURNED` | `MAPPED` |
| `GHN` | `STATUS` | `cancel` | `CANCELLED` | `MAPPED` |
| `GHN` | `STATUS` | `lost` | `LOST` | `MAPPED` |
| `GHN` | `STATUS` | `damage` | `DAMAGED` | `MAPPED` |
| `GHTK` | `STATUS` | `1` | `READY_TO_PICK` | `MAPPED` |
| `GHTK` | `STATUS` | `2` | `PICKING` | `MAPPED` |
| `GHTK` | `STATUS` | `3` | `IN_TRANSIT` | `MAPPED` |
| `GHTK` | `STATUS` | `4` | `OUT_FOR_DELIVERY` | `MAPPED` |
| `GHTK` | `STATUS` | `5` | `DELIVERED` | `MAPPED` |
| `GHTK` | `STATUS` | `6` | `DELIVERED` | `MAPPED` |
| `GHTK` | `STATUS` | `7` | `DELIVERY_FAILED` | `MAPPED` |
| `GHTK` | `STATUS` | `8` | `DELIVERY_FAILED` | `MAPPED` |
| `GHTK` | `STATUS` | `9` | `DELIVERY_FAILED` | `MAPPED` |
| `GHTK` | `STATUS` | `10` | `RETURNING` | `MAPPED` |
| `GHTK` | `STATUS` | `11` | `RETURNING` | `MAPPED` |
| `GHTK` | `STATUS` | `12` | `IN_TRANSIT` | `MAPPED` |
| `GHTK` | `STATUS` | `13` | null | `UNMAPPED` |
| `GHTK` | `STATUS` | `20` | `RETURNING` | `MAPPED` |
| `GHTK` | `STATUS` | `21` | `RETURNED` | `MAPPED` |
| `GHTK` | `STATUS` | `-1` | `CANCELLED` | `MAPPED` |
| null | `FEE` | `BASE_FREIGHT` | `BASE_FREIGHT` | `MAPPED` |
| null | `FEE` | `SURCHARGE` | `SURCHARGE` | `MAPPED` |
| null | `FEE` | `REMOTE_AREA_SURCHARGE` | `REMOTE_AREA_SURCHARGE` | `MAPPED` |
| null | `FEE` | `COD_FEE` | `COD_FEE` | `MAPPED` |
| null | `FEE` | `INSURANCE_FEE` | `INSURANCE_FEE` | `MAPPED` |
| null | `FEE` | `RETURN_FEE` | `RETURN_FEE` | `MAPPED` |
| null | `FEE` | `OTHER_FEE` | `OTHER_FEE` | `MAPPED` |
| null | `FEE` | `VAT` | `VAT` | `MAPPED` |

Golden lookup cases the author must assert, in addition to every `MAPPED` row above:

| carrier_code | domain | raw_key | canonical_code | disposition | Why |
|---|---|---|---|---|---|
| `GHN` | `STATUS` | `delivery_fail` | `DELIVERY_FAILED` | `MAPPED` | Must not map to `RETURNING`. |
| `GHN` | `STATUS` | `some_weird_unknown_status_xyz` | null | `UNMAPPED` | Must not fall back to `IN_TRANSIT`. |
| `GHTK` | `STATUS` | `9999` | null | `UNMAPPED` | Must not fall back to `IN_TRANSIT`. |
| `GHTK` | `STATUS` | `9` | `DELIVERY_FAILED` | `MAPPED` | Undeliverable is not yet `RETURNING`. |
| `GHTK` | `STATUS` | `13` | null | `UNMAPPED` | Raw status 13 is 'Đơn hàng bồi thường' (compensation). Compensation can follow loss as well as damage; must resolve to UNMAPPED / null to preserve raw status without misclassifying as DAMAGED or LOST. |
| `GHTK` | `STATUS` | `20` | `RETURNING` | `MAPPED` | GHTK status 20 is 'Đang trả hàng' (return in progress, per official GHTK docs https://docs.giaohangtietkiem.vn/), must not map to LOST. |
| null | `FEE` | `mystery_fee` | null | `UNMAPPED` | Must not become `BASE_FREIGHT` or amount `0`. |
| null | `FEE` | `VAT` | `VAT` | `MAPPED` | Identity mapping of the tax line. |
| null | `CARRIER_ALIAS` | `VTP` | `VIETTEL_POST` | `MAPPED` | Boundary alias. |
| null | `CARRIER_ALIAS` | `vtp` | null | `UNMAPPED` | Alias match is case-sensitive. |

No Viettel Post or J&T raw status is mapped in this revision. Their raw statuses resolve `UNMAPPED` until partner evidence names them. GHTK status crosswalk evidence is verified against official GHTK OpenAPI documentation (`https://docs.giaohangtietkiem.vn/`): status `10` ('Delay trả hàng'), status `11` ('Đã duyệt hoàn'), and status `20` ('Đang trả hàng' / return in progress) map to canonical `RETURNING`; status `21` ('Đã trả hàng') maps to canonical `RETURNED`; status `13` ('Đơn hàng bồi thường' / compensation) resolves to `UNMAPPED` / `null` because compensation can follow loss as well as damage, so preserving raw provider status without premature coercion to `DAMAGED` or `LOST` prevents corrupting downstream tracking and claims data. Raw status `20` must never map to `LOST`. Adapter code that still defaults unknown GHN/GHTK statuses to `IN_TRANSIT` is a `FEAT-TRK-01` defect. This catalog's lookup result is the contract those adapters must later follow. FEAT-CAR-01 does not edit adapter runtime code.

## Recorded product decisions (formerly blocking gaps CAR-GAP-01 through CAR-GAP-07)

On 2026-10-31, the product owner (operator) formally approved all recommended decisions (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`):

| Gap ID & Title | Gap Context & Previous Dilemma | Recorded Decision & Authority |
|---|---|---|
| **CAR-GAP-01** — Ownership and lifecycle | Master catalog FEAT-CAR-01 promises taxonomy; FEAT-ADM-01 separately promises reference/config management. Domain model names Carrier/CarrierService but dictionary and DBML define neither, and do not say whether catalog data is platform-wide or tenant-owned, editable or seeded. | **DECIDED**: Platform-owned, versioned, read-only reference catalog for FEAT-CAR-01. Mutation UI is deferred to FEAT-ADM-01; tenant-private overlays are strictly prohibited. Multi-revision coexistence without in-place mutation or table collisions is guaranteed by schema design: every reference entity (`Carrier`, `CarrierService`, `CanonicalStatusReference`, `FeeComponentReference`, `CatalogCompatibilityMapping`) has UUID primary key `id` and explicit `catalog_revision` column. Revision-scoped uniqueness is enforced: `Carrier` uses `@@unique([catalogRevision, code])` (carrier codes are unique per revision, NOT globally unique across revisions); `CarrierService` links to `Carrier.id` via `carrier_id` UUID with `onDelete: Cascade` and enforces `@@unique([catalogRevision, carrierCode, code])`; `CanonicalStatusReference` and `FeeComponentReference` enforce `@@unique([catalogRevision, code])`; `CatalogCompatibilityMapping` enforces `@@unique([catalogRevision, carrierCode, domain, rawKey])`. This ensures subsequent catalog revisions published by `FEAT-ADM-01` coexist immutably as distinct row sets without overwriting or schema migrations. Read queries in FEAT-CAR-01 filter by active revision `CATALOG-2026-10-31`. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-02** — Actor journey and screen | SCREEN-SPECIFICATIONS SCR-CAR-01 and route `/settings/carriers` cover accounts, health, tokens and connect/test/rotate actions. There is no catalog screen/use case/AC/traceability row. Existing ORG-01/02, WH-01 and ONB-01 Work Items incorrectly attribute account linking/OAuth to FEAT-CAR-01, contrary to master FEAT-CAR-02/04. | **DECIDED**: FEAT-CAR-01 is confirmed strictly catalog-only. A dedicated read-only catalog tab at `/settings/carriers` (`SCR-CAR-01` tab "Carrier Catalog" / "Danh mục đơn vị vận chuyển") is approved, presenting carriers, services, canonical status taxonomy, and fee component definitions. Account linking/testing actions remain in FEAT-CAR-02 and FEAT-CAR-04. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-03** — RBAC, tenant and audit | RBAC matrix has shop configuration, quote and rate access but no catalog read or platform catalog write capability. SYSTEM_ADMIN has no default tenant browsing; merged permissions have no catalog-specific code. Global-master versus tenant audit scope is unspecified. | **DECIDED**: Approved explicit canonical read permission `iam:carrier_catalog:read` with default grants to `OWNER`, `OPS_MANAGER`, `ORDER_OPERATOR`, and `FINANCE`. Denied for unauthenticated callers, recipients, or public traffic; no implicit support tenant access without consent. Tenant isolation is strictly enforced (catalog is global platform reference, but tenant session is verified server-side; tenant reads never join unscoped private accounts). Platform catalog writes are reserved for administrative permission in FEAT-ADM-01 with immutable platform-scoped audit (`PLATFORM_CARRIER_CATALOG_UPDATED`). Catalog read access is logged under standard security audit policies for denials/access violations. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-04** — Carrier identity mismatch | Dictionary CarrierAccount.carrier_code says GHN/GHTK/VTP/JT/custom; OpenAPI CarrierAccountInput says GHN/GHTK/VIETTEL_POST/JT_EXPRESS; shared CarrierCode and Prisma say GHN/GHTK/VIETTEL_POST/JT and exclude custom. | **DECIDED**: Approved canonical persisted carrier codes: `GHN`, `GHTK`, `VIETTEL_POST`, `JT` (matching existing Prisma enum `CarrierCodeEnum` and `@shipde/contracts` `CarrierCode`). Custom providers are deferred. Documented legacy/external aliases `VTP` (maps to `VIETTEL_POST`) and `JT_EXPRESS` (maps to `JT`) are explicitly normalized at API/adapter boundaries. OpenAPI and dictionary are updated to match canonical codes with documented boundary aliases. No silent rename of persisted database rows. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-05** — API and executable taxonomy | INTERNAL-API/OpenAPI have only account APIs, no catalog query/response/errors. Shipment state machine includes CREATING, CREATED, CREATE_FAILED, CREATE_OUTCOME_UNKNOWN, READY_TO_PICK, PICKED, DELIVERY_FAILED absent from merged enums, which additionally have PICKING/OUT_FOR_DELIVERY/LOST/DAMAGED. No exhaustive canonical fee keys, VAT semantics, service identifiers or raw-to-canonical version contract exist; statement schema accepts arbitrary fee keys. | **DECIDED**: Approved dedicated catalog REST API under `/api/v1/carrier-catalog` with 4 reference schemas: (1) `Carriers`, (2) `CarrierServices`, (3) `CanonicalShipmentStatuses`, (4) `FeeComponents`. Decouple command states (`CREATING`, `CREATED`, `CREATE_FAILED`, `CREATE_OUTCOME_UNKNOWN`) from operational shipment lifecycle states (`DRAFT`, `READY_TO_PICK`, `PICKING`, `PICKED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `RETURNING`, `RETURNED`, `CANCELLED`, `LOST`, `DAMAGED`). Entities and schemas are revision-scoped with UUID primary keys and composite natural unique keys (`[catalogRevision, code]`), preserving immutable multi-revision publication. Crosswalk mapping pins provider evidence from official carrier docs: GHN name is 'Giao Hàng Nhanh' (`VERIFIED_OFFICIAL`, `docs/product-spec/docs/05-api-integrations/GHN.md`); GHTK status `20` maps to canonical `RETURNING` ('Đang trả hàng' / return in progress per official GHTK docs `https://docs.giaohangtietkiem.vn/`), not `LOST`; GHTK status `13` ('Đơn hàng bồi thường') resolves to `UNMAPPED` / `null` to avoid conflating compensation with damage; unknown raw statuses resolve to `UNMAPPED` / `null` without defaulting to `IN_TRANSIT`. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-06** — Merged mapping conflict | GHN and GHTK normalizeStatus default unknown input to IN_TRANSIT, conflicting with BR-TRK-03, UC-TRK-01, nullable TrackingEvent.canonical_status and AC-TRK-01. GHN delivery_fail maps to RETURNING despite separate DELIVERY_FAILED in the approved state machine. | **DECIDED**: Preserving raw status and returning an explicit `null`/unmapped canonical status is affirmed. The catalog establishes the canonical taxonomy and golden reference mapping. Adapter runtime fixes for existing web prototype adapters (`ghn.adapter.ts`, `ghtk.adapter.ts`) are scheduled under governed adapter repair / tracking Work Item (FEAT-TRK-01); catalog reference contracts explicitly enforce that unknown raw statuses resolve to `UNMAPPED` / `null`, never defaulted to `IN_TRANSIT`, and `delivery_fail` maps to canonical `DELIVERY_FAILED`. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |
| **CAR-GAP-07** — Service dataset/evidence | GHN/GHTK source docs identify available-service surfaces but supply no pinned service-code/label dataset; VTP/J&T require partner confirmation (OI-001/002); capability matrix is dated 2026-08-24 and proves no account grants. No production catalog fixture/source revision is approved. | **DECIDED**: Approved initial baseline catalog dataset for the 4 canonical carriers: `GHN` (`VERIFIED_OFFICIAL`), `GHTK` (`VERIFIED_OFFICIAL`), `VIETTEL_POST` (`CONFIRMATION_REQUIRED`), `JT` (`CONFIRMATION_REQUIRED`). Production capabilities remain gated per partner evidence under OI-001/002; reference catalog clearly flags evidence levels (`VERIFIED_OFFICIAL` vs `CONFIRMATION_REQUIRED`). Synthetic test fixtures remain test-scoped. *Authority: Operator approval 2026-10-31 (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`).* |

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-CAR-01-01` / `TEST-CAR-01-CATALOG-LIST` | Authorized actor requests list of carriers (`GET /api/v1/carrier-catalog/carriers`) | Returns 200 OK with the 4 canonical carriers (GHN, GHTK, VIETTEL_POST, JT), their display names, logos, active status, and evidence levels. | API supertest integration test (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-02` / `TEST-CAR-01-CARRIER-DETAIL` | Authorized actor requests carrier details by code (`GET /api/v1/carrier-catalog/carriers/:code`) | Returns 200 OK with carrier fields and array of associated services (code, name, service_type). | API supertest integration test (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-03` / `TEST-CAR-01-ALIAS-RESOLUTION` | Client requests carrier detail using legacy alias `VTP` or `JT_EXPRESS` | Returns 200 OK resolving `VTP` to `VIETTEL_POST` and `JT_EXPRESS` to `JT` with identical canonical payloads. | API supertest integration test (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-04` / `TEST-CAR-01-STATUSES` | Client requests canonical statuses (`GET /api/v1/carrier-catalog/statuses`) | Returns 200 OK with complete canonical statuses, distinguishing command states from operational lifecycle states. | API supertest integration test (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-05` / `TEST-CAR-01-FEES` | Client requests fee components (`GET /api/v1/carrier-catalog/fee-components`) | Returns 200 OK with canonical fee definitions, categories (BASE, SURCHARGE, COD, INSURANCE, RETURN), VAT flags, and refundability. | API supertest integration test (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-06` / `TEST-CAR-01-UNKNOWN-STATUS` | Lookup of an unknown raw provider status or fee key against catalog mapping rules | Returns `null` / unmapped canonical status; never falls back to `IN_TRANSIT` or zero amount. | Unit contract test (`carrier-catalog.unit.spec.ts`) |
| `AC-CAR-01-07` / `TEST-CAR-01-AUTHZ-DENIED` | Anonymous request or authenticated user lacking `iam:carrier_catalog:read` requests catalog | Returns 401 `UNAUTHORIZED` or 403 `FORBIDDEN` with canonical error envelope without leaking internal catalog metadata. | API negative security supertest (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-08` / `TEST-CAR-01-TENANT-ISOLATION` | Tenant A queries catalog endpoints | Returns platform-owned reference data; zero private account credentials, tokens, or custom configurations of Tenant B are leaked. | Two-tenant isolation supertest (`carrier-catalog.supertest.spec.ts`) |
| `AC-CAR-01-09` / `TEST-CAR-01-NO-SIDE-EFFECTS` | User browses catalog and views services | Triggers zero third-party carrier network requests, inserts zero `carrier_accounts` rows, and does not alter onboarding state. | Mock spy assertion + DB row count test |
| `AC-CAR-01-10` / `TEST-CAR-01-UI-STATES` | Web user navigates to `/settings/carriers?tab=catalog` across all state scenarios | Verifies observable loading skeleton, empty filter result, error retry card, 403 forbidden banner, and confirmation-required badges. | React Testing Library unit tests (`carrier-catalog.test.ts`) |
| `AC-CAR-01-11` / `TEST-CAR-01-UI-A11Y` | Keyboard and screen-reader user navigates the carrier catalog tab and modals | Full keyboard focus management, ARIA dialog roles, accessible table/grid headers, WCAG AA contrast compliance. | Playwright accessibility test (`pnpm test:a11y` / `carrier-catalog.spec.ts`) |
| `AC-CAR-01-12` / `TEST-CAR-01-CONTRACT-SYNC` | Author regenerates shared contracts from OpenAPI spec | `pnpm contract:generate` succeeds and `pnpm contract:check` passes with zero schema drift. | CI contract validation gate |

## Verification commands

Authoritative monorepo root commands:

```text
pnpm install --prod --frozen-lockfile
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm contract:generate
pnpm contract:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:baseline
pnpm test:brain
pnpm security:secrets
node scripts/ai/check-no-hardcode.mjs
pnpm build
```

## Definition of Ready assessment

| Gate | Result | Notes |
|---|---|---|
| Feature identity / requested selection | PASS | Master catalog FEAT-CAR-01; explicitly selected in delivery order 30 |
| Foundation availability | PASS | TASK-FOUND-04 merged; monorepo architecture and OpenAPI generator active |
| Live base freshness | PASS | Baseline commit inspected on origin/main |
| Dedicated use case, screen and AC source IDs | PASS | Resolved by CAR-GAP-02: SCR-CAR-01 catalog tab, UC-CAR-01, AC-CAR-01-01..12 |
| Actor permissions and ownership/audit boundary | PASS | Resolved by CAR-GAP-01/03: platform-owned, `iam:carrier_catalog:read`, admin write audit |
| Inputs, outputs, errors, entities, state compatibility | PASS | Resolved by CAR-GAP-04/05: canonical codes GHN/GHTK/VIETTEL_POST/JT, 4 schemas |
| Capability evidence/fallback boundary | PASS | Resolved by CAR-GAP-07: VERIFIED_OFFICIAL vs CONFIRMATION_REQUIRED flagged |
| Golden acceptance data and complete traceability | PASS | Defined in acceptance matrix, traced in TRACEABILITY.md |
| No unresolved high-impact decision | PASS | CAR-GAP-01 through 07 resolved by operator approval (`HUMAN-DECISION-FEAT-CAR-01-2026-10-31`) |

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| Planning round 1 (2026-10-30) | `b52f3af7` | BLOCKED | Identified CAR-GAP-01 through CAR-GAP-07 requiring product owner decisions |
| Planning round 2 (2026-10-31) | `9a9b6437` | CHANGES_REQUIRED | Resolved: (1) Corrected GHN carrier name to "Giao Hàng Nhanh" (VERIFIED_OFFICIAL, citing GHN.md and public API docs); (2) Corrected GHTK raw status 20 mapping to canonical RETURNING ("Đang trả hàng" / return in progress per official GHTK docs https://docs.giaohangtietkiem.vn/) with provider evidence and golden assert; (3) Resolved schema revision identity and relationships for immutable multi-revision publication: UUID PKs across all models, explicit catalog_revision, Carrier @@unique([catalogRevision, code]), CarrierService @@unique([catalogRevision, carrierCode, code]) with carrier_id UUID FK (onDelete: Cascade), CanonicalStatusReference and FeeComponentReference @@unique([catalogRevision, code]), CatalogCompatibilityMapping @@unique([catalogRevision, carrierCode, domain, rawKey]). |
| Planning round 3 (2026-10-31) | `a5a3f053` | CHANGES_REQUIRED | Findings 1-3 confirmed resolved by Codex review. Finding 4 (NEW P1): GHTK status 13 ('Đơn hàng bồi thường' / compensation) mapped to UNMAPPED / null, preserving raw status without incorrectly classifying as DAMAGED. |

## Residual limitations

- Carrier account connection, encrypted credentials storage, and account rotation are delivered separately in `FEAT-CAR-02`.
- Real-time connection testing and granted capability discovery are delivered separately in `FEAT-CAR-04`.
- Live quote calculation and serviceability checks require valid merchant carrier accounts and are delivered in `FEAT-QTE-01` and `FEAT-AVL-01`.
- Live partner verification for `VIETTEL_POST` and `JT` remains tracked under open issues `OI-001` and `OI-002`; their catalog services are marked `CONFIRMATION_REQUIRED` until partner evidence is verified.
- Existing prototype adapter cleanup for `ghn.adapter.ts` and `ghtk.adapter.ts` unknown status defaults is governed under tracking feature `FEAT-TRK-01`.
