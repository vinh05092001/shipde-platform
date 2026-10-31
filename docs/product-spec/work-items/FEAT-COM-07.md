# FEAT-COM-07 — Trace business activity to actor, changes and correlation

## Control

| Field | Value |
|---|---|
| Work Item ID | `FEAT-COM-07` |
| Feature ID | `FEAT-COM-07` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 26, S01, Shared platform |
| Dependencies | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-ORG-01` (merged) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Risk domains | `tenant isolation`, `rbac`, `pii masking`, `financial data privacy`, `immutable audit`, `activity timeline` |
| Allowed paths | `docs/product-spec/work-items/FEAT-COM-07.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `prisma/schema.prisma`, `prisma/migrations/*feat_com_07_activity*`, `apps/api/src/activity/*`, `apps/api/src/app.module.ts`, `apps/api/src/shops/shops.service.ts`, `apps/api/src/users/me.service.ts`, `apps/api/src/branches/branches.service.ts`, `apps/api/src/warehouses/warehouses.service.ts`, `apps/web/src/components/activity/*`, `apps/web/src/app/settings/shop/page.tsx`, `apps/web/src/components/BranchManagementView.tsx`, `apps/web/src/components/WarehouseManagementView.tsx`, `apps/web/src/tests/activity*.test.ts`, `apps/web/e2e/activity.spec.ts` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/feat-com-07` |
| Pull Request | TBD upon author opening PR |
| Inspected baseline | Clean checkout on branch `feat/feat-com-07`, 2026-10-31 |

## Business outcome

An authorized shop user or platform operator can inspect the activity timeline of any business-critical entity in Ship Dễ (e.g., Shop, Branch, Warehouse, User, Order, Shipment, Exception Case) and establish who acted, when, what changed before/after, and the correlation ID connecting the action to its execution. History is queried from durable, append-only `AuditLog` records, strictly scoped server-side to the caller's authorized tenant (`merchant_id`) and store/branch/warehouse scope.

Access to an entity's timeline is governed by the user's permission to view the parent entity itself (e.g. `shop:read`, `branch:read`, `warehouse:read`, `shipment:track_exceptions`), eliminating the need for a blanket administrative `audit:view` permission. Sensitive secrets and credentials are unconditionally redacted; recipient PII (phone number, customer address) is masked unless the caller holds `pii:unmask`; and confidential financial figures (rates, COD amounts, settlement totals) are masked unless the caller holds financial audit capabilities. Legacy audit rows lacking explicit correlation IDs fall back safely to parsed reason patterns or null without fabricating synthetic values.

## Source references

Links resolve relative to this Work Item:

| Source / exact heading or ID | Requirement and boundary |
|---|---|
| [Baseline and Decisions](../docs/00-control/BASELINE-AND-DECISIONS.md#product-decisions), `HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31` | Operator approval on 2026-10-31 of all recommended decisions (G1–G4): entity coverage, entity-permission access model, query semantics/API contract, and correlation data model unblocking FEAT-COM-07 to `READY_FOR_AUTHOR`. |
| [Product Vision and Scope](../docs/01-product/PRODUCT-VISION-SCOPE.md#who-it-serves), `After shipment`, `Boundaries` | Operational, finance, and owner actors require activity trails; strict tenant isolation with no cross-tenant leakage. |
| [Master Feature Catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md#2-shared-platform), `FEAT-COM-07` | Shared Activity timeline: "Actor, time, before/after and correlation ID". Distinct from `FEAT-ADM-03` (global admin immutable audit log) and `FEAT-TRK-04` (carrier tracking ledger). |
| [Actors and Personas](../docs/01-product/ACTORS-PERSONAS.md#persona-principles) | Finance needs immutable evidence; operational staff need contextual explanation; support has time-bound access; no default cross-tenant browsing. |
| [RBAC and Approval Matrix](../docs/02-business/RBAC-APPROVAL-MATRIX.md#enforcement), capabilities | Access to entity activity is derived from parent entity view permissions (`shop:read`, `branch:read`, `warehouse:read`, `shipment:track_exceptions`, `claim:view`) plus resource scope (`FEAT-RBAC-02`), rather than requiring global `audit:view`. |
| [Business Rules](../docs/02-business/BUSINESS-RULES-DECISION-TABLES.md), `BR-AUTH-09`, `BR-AUTH-13`, `BR-AUTH-19`, `BR-COM-04` | Security events omit secrets; PII redaction rules; activity query must not mutate domain state. |
| [Screen Specifications](../docs/03-ux/SCREEN-SPECIFICATIONS.md#shared-screen-contract), `SCR-SHIP-01`, `SCR-EXC-01`, `SCR-CASE-01` | History on business-critical details; 10 shared UI states (loading, empty, validation, error/timeout, forbidden, not-found, partial, success, recovery, a11y). |
| [Design System and UX Rules](../docs/03-ux/DESIGN-SYSTEM-UX-RULES.md#canonical-components) | Timeline/event ledger, actionable content, accessible icon buttons with `aria-label`, WCAG AA contrast, responsive mobile layouts. |
| [Domain Model](../docs/04-data/DOMAIN-MODEL-ERD.md#modeling-rules), aggregate `AuditEvent` | Append-only audit storage, tenant ID, actor identity, action type, resource type/ID, correlation ID, UTC timestamps. |
| [Internal API](../docs/05-api-integrations/INTERNAL-API.md#api-conventions) | `/api/v1`, session-derived tenant, ISO-8601 UTC timestamps, keyset pagination, canonical error envelopes. |
| [Security NFR & Observability](../docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md#privacy) | Zero secret/credential leakage, PII masking, no raw IP disclosure in operational timeline responses. |
| [Acceptance & E2E](../docs/08-testing/ACCEPTANCE-AND-E2E.md#e2e-10-tenant-attack) | E2E-10 cross-tenant isolation enforcement; forbidden and not-found fail-closed behaviors. |

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test harness, and baseline verification.
- `FEAT-AUTH-01` & `FEAT-AUTH-06` are merged, providing `merchants`, `users`, `SessionGuard`, and session token authentication.
- `FEAT-RBAC-01` & `FEAT-RBAC-02` are merged, providing dynamic roles, capability permissions, and resource scope enforcement (`RbacService`, `PermissionsGuard`).
- `FEAT-ORG-01` is merged, providing multi-tenant shop profile baseline and tenant validation.
- All blocking gaps G1–G4 are formally resolved and approved by the product owner (operator) on 2026-10-31 (`HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31`).

## Author boundary and delivery slices

`GEMINI` is assigned as primary author for this vertical deliverable. Because FEAT-COM-07 spans database schema migrations, backend query APIs, security masking, and reusable UI timeline components across multiple screens, the work is explicitly structured into two sequential delivery slices:

### Slice A — API, Data Model & Scoped Query Engine
- **Persistence & Migration:** Add additive nullable `correlation_id` column to `AuditLog` in `prisma/schema.prisma` with compound indexes on `[merchant_id, entity_type, entity_id]` and `[merchant_id, created_at]`.
- **API Module:** Implement `apps/api/src/activity/` with `activity.controller.ts`, `activity.service.ts`, `activity.dto.ts`, and register in `apps/api/src/app.module.ts`.
- **Endpoint:** `GET /api/v1/activity` (and `/activity` alias) accepting `entity_type`, `entity_id`, `limit`, and `cursor`.
- **Security & Scope:** Server-side tenant isolation (`merchant_id`), entity-permission checks (`shop:read`, `branch:read`, `warehouse:read`, etc.), and store-scope validation (`FEAT-RBAC-02`).
- **Privacy Engine:** Mask PII unless caller has `pii:unmask`; mask financial fields unless caller has reconciliation permissions; unconditionally redact credentials/tokens; strip raw client IPs.
- **Legacy Row Parser:** Extract correlation ID from `reason` field (`correlation_id:...`) if the column is null; return `null` if absent (never fabricate).
- **Audit Writers:** Update existing producers (`shops.service.ts`, `me.service.ts`, `branches.service.ts`, `warehouses.service.ts`) to populate `correlation_id` directly from request context.
- **Contracts:** Add OpenAPI paths/schemas to `docs/product-spec/contracts/openapi.yaml` and export TypeScript types in `packages/contracts/src/index.ts`.
- **Automated Tests:** Supertest and unit tests for authorization, multi-tenant isolation (E2E-10), keyset pagination, masking, and legacy row compatibility.

### Slice B — Shared UI Timeline Component & Screen Integrations
- **Shared Component:** Create `apps/web/src/components/activity/ActivityTimeline.tsx` and `ActivityTimelineDrawer.tsx` (reusable across all business entity screens).
- **Visual Presentation:** Chronological timeline cards with actor badge, action summary, relative/UTC time, expandable before/after field changes with color diffs, and copyable correlation ID pill with toast notification.
- **Full 10 UI States:** Accessible loading skeleton (`aria-busy`), empty state card, validation errors, server error banner with retry button, 403 forbidden banner, 404 not found, partial legacy indicator, success list with keyset "Load more" button, recovery, and keyboard/ARIA accessibility (`role="feed"` / `role="article"`, focus outlines, `aria-label`).
- **Host Screen Integrations:**
  - `apps/web/src/app/settings/shop/page.tsx` — Shop profile activity drawer/tab.
  - `apps/web/src/components/BranchManagementView.tsx` — Branch history drawer.
  - `apps/web/src/components/WarehouseManagementView.tsx` — Warehouse history drawer.
- **Automated Tests:** Frontend component state tests (`apps/web/src/tests/activity-timeline-states.test.ts`) and Playwright E2E tests (`apps/web/e2e/activity.spec.ts`).

## In scope

1. **Durable Activity Retrieval:** Query immutable `AuditLog` events matching `merchant_id`, `entity_type`, and `entity_id`.
2. **Actor Attribution:** Disclose who acted (User name, System, Carrier, Unknown) with resilience against deleted/deactivated users.
3. **Temporal Accuracy:** Render exact UTC timestamps formatted to merchant local display time and relative intervals ("X phút trước").
4. **Before/After Changes:** Render field-level diffs (`old_value` vs `new_value`) for audited mutations with sensitive field redaction.
5. **Correlation ID Tracing:** Surface original action correlation ID with one-click copy button, preserving correlation through to API requests.
6. **Multi-tenant Server Isolation:** Strict enforcement of `merchant_id` filter in database queries; cross-tenant requests fail closed (404/403).
7. **Resource Scope & RBAC:** Enforce parent entity read permissions and branch/warehouse resource scopes; non-permitted users receive canonical 403 `FORBIDDEN`.
8. **PII and Financial Masking:** Field-level masking for recipient phone/email (`0901****567`) and financial rates/amounts based on caller capabilities.
9. **Keyset Pagination:** Stable descending keyset pagination using base64 cursors (`created_at`, `id`) supporting high-volume histories.
10. **Legacy Row Support:** Backward compatibility for historical rows lacking explicit correlation or before/after snapshots without fabricating data.
11. **Shared Component & Screen Integration:** Deliver reusable UI timeline component integrated into Shop, Branch, and Warehouse management screens.
12. **Full State Coverage & A11y:** Complete coverage of all 10 shared UI states with WCAG AA compliance and screen reader support.

## Out of scope

- Global administrative audit log browsing (`FEAT-ADM-03` / `/admin/audit`).
- Carrier real-time tracking ingestion and checkpoint calculation (`FEAT-TRK-04`).
- Recipient-facing public tracking timeline (channel-neutral public view).
- Cross-tenant platform administrator search (`FEAT-SUP-01` / `/admin/search`).
- Modifying historical audit rows or executing destructive schema rewrites.
- External logging infrastructure or third-party audit aggregators.
- Modifying domain state or triggering carrier side-effects from timeline queries.

## Business rules and edge cases

- `BR-COM-07-01 — Tenant Scoping & Isolation`: Every activity query must be scoped server-side to the authenticated session's `merchant_id`. If an entity belongs to another tenant, the API must return 404 `NOT_FOUND` (fail closed) without disclosing the entity's existence or activity count.
- `BR-COM-07-02 — Entity-Permission Access Control`: Viewing an entity's activity timeline requires the caller to hold read permissions for that specific entity type (e.g. `shop:read` / `organization:view` for Shop, `branch:read` for Branch, `warehouse:read` for Warehouse, `shipment:track_exceptions` for Shipment, `claim:view` for Claim). Global `audit:view` capability is NOT required for contextual entity activity.
- `BR-COM-07-03 — Resource Scope Enforcement (FEAT-RBAC-02)`: When an entity is associated with a specific branch or warehouse, the caller's active session must possess access to that store/warehouse scope. If scope is revoked during a session, subsequent activity queries must return 403 `FORBIDDEN`.
- `BR-COM-07-04 — Secrets & Credential Redaction`: Password hashes, session tokens, OTP codes, recovery keys, webhook secrets, and private keys must NEVER be returned in activity diffs or stored in UI logs. They must be unconditionally replaced with `"[REDACTED]"`.
- `BR-COM-07-05 — PII & Confidential Data Masking`: Recipient phone numbers and email addresses in before/after snapshots must be masked (e.g. `0901****567`) unless the caller possesses the `pii:unmask` capability. Raw client IP addresses stored in `AuditLog` are stripped from timeline responses.
- `BR-COM-07-06 — Financial Figure Masking`: Sensitive monetary values (carrier contract rates, COD collected amounts, discrepancy settlement values) in diffs must be masked unless the caller holds reconciliation permissions (`reconciliation:view_contract_rates` or `reconciliation:run_review_audit`) or the Owner role.
- `BR-COM-07-07 — Correlation ID Handling & Legacy Fallback`: The correlation ID must represent the original execution/request ID that generated the event. If `correlation_id` is null on a legacy row, the service parses `reason` for `correlation_id:...`. If absent, return `null`. The system must NEVER replace the event correlation ID with the query request's correlation ID or fabricate a UUID.
- `BR-COM-07-08 — Actor Attribution Resilience`: If the user who performed an action has been deleted or suspended, the timeline displays their last recorded name or `"[Người dùng đã xóa]"` (`actor.type = 'USER'`). System actions are attributed to `"Hệ thống"` (`actor.type = 'SYSTEM'`), and carrier webhook events to the carrier code (`actor.type = 'CARRIER'`). If unknown, return `"Không xác định"` (`actor.type = 'UNKNOWN'`).
- `BR-COM-07-09 — Keyset Pagination Stability`: Timeline results must be deterministically ordered by `created_at DESC, id DESC`. Keyset pagination cursors encode both timestamp and ID to prevent dropped or duplicate records when multiple events share identical millisecond timestamps.
- `BR-COM-07-10 — Read-Only Idempotency`: Querying or retrying an activity timeline is strictly read-only and idempotent. It must never trigger external carrier commands, re-run business logic, or mutate database state.

## Approved product decisions (formerly blocking gaps G1–G4)

On 2026-10-31, the product owner (operator) formally APPROVED all recommended decisions for gaps G1 through G4 as written below (`HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31` in `BASELINE-AND-DECISIONS.md`). The gaps are converted into binding architectural and product decisions:

### Decision G1 (DEC-COM07-01): Entity Coverage & Delivery Entry Points
- **Gap context (G1):** Catalog says only four fields; Shared screen contract requires history for business-critical entities; SCR-SHIP-01/EXC-01/CASE-01 describe domain timelines. No COM-07 use case lists delivery entities, existing producer actions, host screens or minimum vertical acceptance path.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Entity Coverage:* FEAT-COM-07 covers primary operational and configuration entities: `Shop` (`SHOP`), `Branch` (`BRANCH`), `Warehouse` (`WAREHOUSE`), `User` (`USER`), `Order` (`ORDER`), `Shipment` (`SHIPMENT`), `ExceptionCase` (`EXCEPTION_CASE`), and `Claim` (`CLAIM`).
  2. *Minimum Vertical Acceptance Path:* Author implementation must deliver end-to-end vertical integration on `Shop` (`apps/web/src/app/settings/shop/page.tsx`), `Branch` (`BranchManagementView.tsx`), and `Warehouse` (`WarehouseManagementView.tsx`), where real mutations (updates, activations, deactivations) produce durable audit records that are queried and displayed in the live activity timeline.
  3. *Domain Screen Integration:* Domain screens (`SCR-SHIP-01`, `SCR-EXC-01`, `SCR-CASE-01`) will consume the shared `ActivityTimeline` component via standard props (`entityType`, `entityId`).
  4. *Mock Prohibition:* Substituting the mock `UnifiedTrackingModal.tsx` for live activity is strictly prohibited; all timelines must query durable backend records from `GET /api/v1/activity`.

### Decision G2 (DEC-COM07-02): Access Control, Entity Permissions, Resource Scopes & Data Visibility
- **Gap context (G2):** `View immutable audit log` denies operational roles that otherwise view shipments/exceptions; global activity capability has no permission mapping. Existing `audit:view` proves a capability exists, not that every entity timeline must use it.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Entity-Permission Governed:* Viewing an entity's timeline requires read permission for the underlying entity (`shop:read` / `organization:view`, `branch:read`, `warehouse:read`, `shipment:track_exceptions`, `claim:view`) plus tenant isolation. The global administrative capability `audit:view` is NOT required for contextual entity activity (it remains reserved for admin-wide audit browsing in `FEAT-ADM-03`).
  2. *Resource Scopes (FEAT-RBAC-02):* For entities assigned to branches or warehouses, the user's active session must possess the matching store/warehouse scope. Denied scopes return 403 `FORBIDDEN`.
  3. *Field-Level Privacy & Redaction:*
     - Secrets, tokens, hashes, and OTPs are unconditionally replaced with `"[REDACTED]"`.
     - Recipient PII (phone number, address) is masked (`0901****567`) unless caller holds `pii:unmask`.
     - Financial values (rates, COD, bank accounts) are masked unless caller holds reconciliation capabilities or Owner role.
     - Raw client IP addresses are stripped from timeline responses.
  4. *Platform Support:* Support staff have no permanent browsing rights; access requires an explicit, active, time-bound delegated session (`FEAT-SUP-01`).

### Decision G3 (DEC-COM07-03): API Contract, Query Semantics, Keyset Pagination & Canonical Errors
- **Gap context (G3):** Machine contract contains no activity endpoint/schema; tracking GET only describes canonical/raw-safe timeline. No approved timeline filter/order/page contract or activity screen contract.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Approved Endpoint:* `GET /api/v1/activity` (and `/activity` alias).
  2. *Query Parameters:*
     - `entity_type` (string, required): Enum matching registered entity types (`SHOP`, `BRANCH`, `WAREHOUSE`, `USER`, `ORDER`, `SHIPMENT`, `EXCEPTION_CASE`, `CLAIM`).
     - `entity_id` (string, required): Identifier of target entity.
     - `limit` (integer, optional, default 20, min 1, max 100).
     - `cursor` (string, optional): Base64-encoded cursor containing `created_at` timestamp and `id` for deterministic keyset pagination.
  3. *Ordering & Pagination:* Strictly ordered by `created_at DESC, id DESC`. Keyset pagination returns `items`, `next_cursor`, and `has_more`.
  4. *Item Envelope:* `{ id, entity_type, entity_id, action, actor: { id, name, type }, timestamp, correlation_id, changes: [{ field, old_value, new_value, is_sensitive }], reason, status }`.
  5. *Canonical Error Handling:*
     - 400 `VALIDATION_ERROR`: Invalid parameters, out-of-bounds limit, malformed cursor.
     - 401 `UNAUTHORIZED`: Missing or invalid session token.
     - 403 `FORBIDDEN`: Lacking read capability for target entity or out-of-scope resource.
     - 404 `NOT_FOUND`: Entity does not exist or belongs to another tenant (fail closed).

### Decision G4 (DEC-COM07-04): Persistence Model, Additive Schema, Correlation ID, Legacy Rows & Attribution
- **Gap context (G4):** Conceptual `audit_events` requires correlation; `AuditLog` has none and stores free-text reasons. Shop writer embeds correlation in reason; profile writer omits it and persists personal snapshots/raw client IP. No approved legacy, field projection or attribution policy exists.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Additive Schema:* Add nullable column `correlation_id String?` to Prisma model `AuditLog` with compound indexes `@@index([merchant_id, entity_type, entity_id])` and `@@index([merchant_id, created_at])`. No destructive table rewrites or column drops.
  2. *Legacy Row Compatibility:*
     - If `correlation_id` column is null, parse `reason` for `correlation_id:([a-zA-Z0-9_-]+)`. If matched, extract as `correlation_id`.
     - If no correlation is present, return `null`. Never invent synthetic correlation IDs or substitute the query request's correlation ID.
     - If `old_value` or `new_value` are null, return empty `changes: []` without throwing errors.
  3. *Actor Attribution Policy:*
     - Human actor: Resolved to current or snapshot display name; deleted users render as `"[Người dùng đã xóa]"`.
     - System actor: Render as `"Hệ thống"` (`actor.type = 'SYSTEM'`).
     - Carrier actor: Render as carrier name (`actor.type = 'CARRIER'`).
     - Unknown actor: Render as `"Không xác định"` (`actor.type = 'UNKNOWN'`).
  4. *Producer Alignment:* Update existing producers (`shops.service.ts`, `me.service.ts`, `branches.service.ts`, `warehouses.service.ts`) to populate `correlation_id` directly from request correlation context upon insert.

## UI states

The shared `ActivityTimeline` component implements the full 10-state contract from `SCREEN-SPECIFICATIONS.md`:

| State | Required behavior / evidence |
|---|---|
| 1. Loading | Accessible skeleton loader displaying 3 animated placeholder cards with `aria-busy="true"` and `role="status"` while fetching real records. |
| 2. Empty | Clear empty card stating `"Chưa có hoạt động nào được ghi nhận cho mục này"`, with subtle icon and no sample or fabricated items. |
| 3. Validation | Immediate inline validation error if `entity_id` is invalid or query parameters exceed bounds, preventing invalid queries. |
| 4. Server / Network Error | Amber alert banner stating `"Không thể tải lịch sử hoạt động"`, displaying canonical error code with interactive `"Thử lại"` retry button. |
| 5. Forbidden (403) | Authorization failure banner explaining missing permissions for the requested entity or branch scope, with link to return to allowed views. |
| 6. Not Found (404) | Fail-closed message stating entity not found, identical whether entity does not exist or belongs to a foreign tenant. |
| 7. Partial | For historical legacy records lacking correlation IDs or diff snapshots, render available metadata cleanly with a subtle `"Dữ liệu lịch sử thu gọn"` pill. |
| 8. Success | Chronological cards showing actor pill (User, System, Carrier), relative time, UTC tooltip, action badge, expandable diff table, copyable correlation ID pill with copy button and toast notification, and `"Tải thêm"` pagination button. |
| 9. Recovery | Safe query retry button on error; auto re-fetch on session token refresh; cache purge when switching active tenant or selected entity. |
| 10. A11y & Responsive | Keyboard navigable (`Tab`, `Enter`, `Esc`), WCAG AA contrast, all icon-only buttons have explicit `aria-label`, responsive layout collapsing diffs to vertical stacks on mobile viewports (<640px). |

## API, event and data impact

### OpenAPI Contract (`GET /api/v1/activity`)

```yaml
/activity:
  get:
    tags: [Activity]
    summary: Query entity activity timeline (FEAT-COM-07)
    description: Retrieve chronological activity and audit history for a specific business entity with actor attribution, field-level diffs, and correlation IDs.
    operationId: getEntityActivity
    security:
      - bearerAuth: []
    parameters:
      - name: entity_type
        in: query
        required: true
        schema:
          type: string
          enum: [SHOP, BRANCH, WAREHOUSE, USER, ORDER, SHIPMENT, EXCEPTION_CASE, CLAIM]
      - name: entity_id
        in: query
        required: true
        schema:
          type: string
      - name: limit
        in: query
        required: false
        schema:
          type: integer
          minimum: 1
          maximum: 100
          default: 20
      - name: cursor
        in: query
        required: false
        schema:
          type: string
    responses:
      200:
        description: Activity timeline retrieved successfully
        content:
          application/json:
            schema:
              type: object
              required: [items, has_more]
              properties:
                items:
                  type: array
                  items:
                    $ref: '#/components/schemas/ActivityTimelineItem'
                next_cursor:
                  type: string
                  nullable: true
                has_more:
                  type: boolean
      400:
        $ref: '#/components/responses/ValidationError'
      401:
        $ref: '#/components/responses/UnauthorizedError'
      403:
        $ref: '#/components/responses/ForbiddenError'
      404:
        $ref: '#/components/responses/NotFoundError'
```

### Database Schema Migration (`prisma/schema.prisma`)

Additive changes to model `AuditLog`:
```prisma
model AuditLog {
  id             String    @id @default(uuid())
  merchant_id    String?
  user_id        String?
  actor          String
  action         String
  entity_type    String
  entity_id      String
  correlation_id String?   // ADDITIVE: FEAT-COM-07 explicit correlation ID
  old_value      Json?
  new_value      Json?
  reason         String?
  ip_address     String?
  created_at     DateTime  @default(now())

  merchant       Merchant? @relation(fields: [merchant_id], references: [id], onDelete: Cascade)
  user           User?     @relation(fields: [user_id], references: [id], onDelete: SetNull)

  @@index([merchant_id, created_at])
  @@index([merchant_id, entity_type, entity_id])
  @@index([correlation_id])
  @@map("audit_logs")
}
```

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-COM-07-01 / TEST-COM-07-READY | Planning completeness verification. | G1–G4 approved decisions recorded; Slice A and Slice B bounded; paths and contracts defined; status READY_FOR_AUTHOR. | Source diff and Work Item review. |
| AC-COM-07-02 / TEST-COM-07-VERTICAL | Authorized user mutates Shop/Branch/Warehouse and opens Activity Timeline. | Live timeline displays new event with exact actor, timestamp, field-level before/after diffs, and original correlation ID matching database record. | Real Supertest integration + Playwright browser journey with screenshot. |
| AC-COM-07-03 / TEST-COM-07-TENANT | Tenant A requests activity of Tenant B's entity or manipulates merchant headers. | Server rejects request with 404 `NOT_FOUND` (fail closed); zero foreign event, actor, count, or correlation leakage (E2E-10). | Two-tenant Supertest test suite. |
| AC-COM-07-04 / TEST-COM-07-SCOPE | Permitted user lacks access to entity's assigned branch or warehouse scope. | Server denies request with 403 `FORBIDDEN`. Access granted immediately when matching scope is active in session. | Scoped Supertest integration test across role permissions. |
| AC-COM-07-05 / TEST-COM-07-RBAC | Roles with entity read permission (Owner, Ops Manager, Staff) vs unprivileged roles (Rate viewer). | Privileged roles view timeline without requiring `audit:view`; unprivileged roles receive canonical 403 `FORBIDDEN`. | Table-driven RBAC capability unit and integration tests. |
| AC-COM-07-06 / TEST-COM-07-PRIVACY | Activity diff contains synthetic passwords, OTPs, phone numbers, and financial rates. | Passwords/OTPs unconditionally replaced with `"[REDACTED]"`; phone/address masked unless caller holds `pii:unmask`; rates masked unless caller holds reconciliation capabilities. | Privacy projection unit tests and API response assertions. |
| AC-COM-07-07 / TEST-COM-07-LEGACY | Querying historical audit records with null `correlation_id` or legacy `reason: "correlation_id:xyz"`. | Service extracts correlation from reason when present; returns null when absent; never replaces event correlation with query request correlation. | Unit tests using legacy database fixtures. |
| AC-COM-07-08 / TEST-COM-07-READONLY | Repeated timeline queries, retries after network drop, or rapid page refreshes. | Query is strictly read-only; no modified database state, no duplicate domain events, zero carrier side-effects. | Before/after database state assertions and carrier spy checks. |
| AC-COM-07-09 / TEST-COM-07-PAGING | Entity with >50 activity events traversed via keyset pagination with cursor. | Stable descending order (`created_at DESC, id DESC`); zero omitted or duplicated records across page boundaries. | Pagination traversal unit and Supertest tests. |
| AC-COM-07-10 / TEST-COM-07-STATES | Render all 10 UI states: loading, empty, validation, server error, 403, 404, partial, success, recovery, a11y. | All 10 states render cleanly matching design system rules; interactive retry button functional; correlation copy toast functional. | Component tests (`activity-timeline-states.test.ts`) and Playwright visual screenshots. |
| AC-COM-07-11 / TEST-COM-07-A11Y | Keyboard user navigates timeline cards, expands diffs, and copies correlation ID. | Focus outline visible; all icon buttons have `aria-label`; axe accessibility scanner reports 0 violations; mobile responsive layout verified. | `verify-a11y.ts` script run, Playwright axe test, and viewport checks. |
| AC-COM-07-12 / TEST-COM-07-COMPAT | Apply additive migration to PostgreSQL and verify existing profile/shop/RBAC writers. | Additive schema migration executes cleanly; existing audit writers function without regressions; `pnpm contract:check` passes with updated OpenAPI. | Migration status, contract check, and existing suite regression runs. |

## Verification commands

Author implementation must verify all gates using the authoritative commands:

```powershell
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate
pnpm contract:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm security:secrets
node scripts/ai/check-no-hardcode.mjs
pnpm build
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| Planning readiness, 2026-10-30 | Initial planning draft | BLOCKED | G1–G4 unresolved; awaiting operator decisions. |
| Planning finalisation, 2026-10-31 | Current planning commit | READY_FOR_AUTHOR | G1–G4 formally approved by operator on 2026-10-31 (`HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31`); Work Item complete, implementable, and split into Slice A (API/data) and Slice B (UI). |

## Residual limitations

None. All blocking gaps G1–G4 have been approved and recorded under governed decision `HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31`. Work Item is unblocked, complete, and ready for author dispatch.
