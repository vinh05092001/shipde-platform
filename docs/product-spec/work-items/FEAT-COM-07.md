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
- **Host Screen Integrations (FEAT-COM-07 Completion Boundary):**
  - `apps/web/src/app/settings/shop/page.tsx` — Shop profile activity drawer/tab.
  - `apps/web/src/components/BranchManagementView.tsx` — Branch history drawer.
  - `apps/web/src/components/WarehouseManagementView.tsx` — Warehouse history drawer.
  - *Domain Screens Deferral:* Direct embedding into domain screens (`SCR-SHIP-01` Shipment details, `SCR-EXC-01` Exception details, `SCR-CASE-01` Claim details) is explicitly deferred to subsequent vertical feature Work Items (`FEAT-SHP-01`, `FEAT-EXC-01`, `FEAT-CLM-01`). The shared component is authored as an exportable, standalone component accepting standard props (`entityType`, `entityId`).
- **Automated Tests:** Frontend component state tests (`apps/web/src/tests/activity-timeline-states.test.ts`) and Playwright E2E tests (`apps/web/e2e/activity.spec.ts`).

## In scope

1. **Durable Activity Retrieval:** Query immutable `AuditLog` events matching `merchant_id`, `entity_type`, and `entity_id`.
2. **Actor Attribution:** Disclose who acted (User name, System, Carrier, Unknown) with resilience against deleted/deactivated users.
3. **Temporal Accuracy:** Render exact UTC timestamps formatted to merchant local display time and relative intervals ("X phút trước").
4. **Before/After Changes:** Render field-level diffs (`old_value` vs `new_value`) for audited mutations with sensitive field redaction, including one-sided creation and deletion preservation.
5. **Correlation ID Tracing:** Surface original action correlation ID with one-click copy button, preserving correlation through to API requests.
6. **Multi-tenant Server Isolation:** Strict enforcement of `merchant_id` filter in database queries; cross-tenant requests fail closed (404/403).
7. **Resource Scope & RBAC:** Enforce parent entity read permissions and branch/warehouse resource scopes; non-permitted users receive canonical 403 `FORBIDDEN`.
8. **PII and Financial Masking:** Field-level masking for recipient phone/email (`0901****567`) and financial rates/amounts based on caller capabilities.
9. **Keyset Pagination:** Stable descending keyset pagination using base64 cursors (`created_at`, `id`) supporting high-volume histories.
10. **Legacy Row Support:** Backward compatibility for historical rows lacking explicit correlation or before/after snapshots without fabricating data.
11. **Shared Component & Host Screen Integration:** Deliver reusable UI timeline component integrated into Shop, Branch, and Warehouse management screens (domain screens explicitly deferred to domain work items).
12. **Full State Coverage & A11y:** Complete coverage of all 10 shared UI states with WCAG AA compliance and screen reader support.

## Out of scope

- Direct integration into domain screens (`SCR-SHIP-01`, `SCR-EXC-01`, `SCR-CASE-01`), which is explicitly deferred to subsequent vertical feature Work Items (`FEAT-SHP-01`, `FEAT-EXC-01`, `FEAT-CLM-01`).
- Global administrative audit log browsing (`FEAT-ADM-03` / `/admin/audit`).
- Carrier real-time tracking ingestion and checkpoint calculation (`FEAT-TRK-04`).
- Recipient-facing public tracking timeline (channel-neutral public view).
- Cross-tenant platform administrator search (`FEAT-SUP-01` / `/admin/search`).
- Modifying historical audit rows or executing destructive schema rewrites.
- External logging infrastructure or third-party audit aggregators.
- Modifying domain state or triggering carrier side-effects from timeline queries.

## Business rules and edge cases

- `BR-COM-07-01 — Tenant Scoping, Isolation & Historical Entity Resolution`: Every activity query must be scoped server-side to the authenticated session's `merchant_id`. If an entity does not exist in the primary table (e.g. it was physically deleted), the service performs an authorized historical lookup against retained `AuditLog` records for `(entity_type, entity_id)` (`ORDER BY created_at DESC`). The system resolves tenant isolation from the retained record's `merchant_id`. If no audit log record exists, or if the entity/audit record belongs to another tenant (`merchant_id !== session.merchantId`), the API must return 404 `NOT_FOUND` (fail closed) without disclosing the entity's existence or activity count. For scoped entities, resource scope is determined via a verified terminal snapshot or authoritative historical scope record (see BR-COM-07-03); if unavailable, scoped callers fail closed with 403 `FORBIDDEN`.
- `BR-COM-07-02 — Entity-Permission Access Control`: Viewing an entity's activity timeline requires the caller to hold read permissions for that specific entity type plus server-side tenant matching (`entity.merchant_id === session.merchantId`, evaluated against live entity or historical tombstone record). Blanket administrative `audit:view` capability is NOT required for contextual entity activity. Access is governed by the exhaustive mapping table below with explicit AND/OR semantics:
  - `TenantMatch` (Mandatory `AND`): `entity.merchant_id === session.merchantId`. If false, fail closed with 404 `NOT_FOUND`.
  - `CapabilityMatch` (`OR` condition within entity type): Caller must hold at least one of the listed capabilities:
    - `SHOP`: `shop:read` OR `organization:view`
    - `BRANCH`: `branch:read`
    - `WAREHOUSE`: `warehouse:read`
    - `USER`: `user:read` OR self-inspection (`session.userId === entity_id`)
    - `ORDER`: `order:read`
    - `SHIPMENT`: `shipment:read` OR `shipment:track_exceptions`
    - `EXCEPTION_CASE`: `exception:read` OR `shipment:track_exceptions`
    - `CLAIM`: `claim:view` OR `claim:read`
  - If `CapabilityMatch` is false, reject with canonical 403 `FORBIDDEN`.
- `BR-COM-07-03 — Resource Scope Enforcement (FEAT-RBAC-02)`: When an entity is associated with a branch or warehouse, the caller's active session must possess that store/warehouse scope (evaluated against live entity or historical tombstone snapshot):
  - If caller role has tenant-wide scope (`is_scoped = false`), resource scope check unconditionally passes.
  - If caller role has scoped access (`is_scoped = true`):
    - For `BRANCH`: `session.branchIds` must contain `entity.id` (or deleted branch `id`).
    - For `WAREHOUSE`: `session.warehouseIds` must contain `entity.id` (or deleted warehouse `id`).
    - For `ORDER`, `SHIPMENT`, `EXCEPTION_CASE`: Evaluated against assigned `branch_id` and `warehouse_id`:
      - *Both associations populated (`branch_id != null && warehouse_id != null`):* Evaluated using **Disjunctive OR** (`session.branchIds.includes(entity.branch_id) || session.warehouseIds.includes(entity.warehouse_id)`). A caller whose branch matches (`session.branchIds` contains `entity.branch_id`) but whose warehouse does NOT match (`session.warehouseIds` does not contain `entity.warehouse_id`) is **GRANTED** access (HTTP 200). Likewise, a caller whose warehouse matches but branch does not match is **GRANTED** access. Access is **DENIED** (HTTP 403 `FORBIDDEN`) if and only if neither dimension matches.
      - *Only `branch_id` populated (`warehouse_id == null`):* Caller's `session.branchIds` must contain `entity.branch_id`. Mismatch returns 403 `FORBIDDEN`.
      - *Only `warehouse_id` populated (`branch_id == null`):* Caller's `session.warehouseIds` must contain `entity.warehouse_id`. Mismatch returns 403 `FORBIDDEN`.
      - *Neither populated (`branch_id == null && warehouse_id == null`):* Scoped callers cannot establish resource affinity and are **DENIED** (HTTP 403 `FORBIDDEN`); only unscoped tenant-wide roles may view unassigned records.
    - For `SHOP`, `USER`, `CLAIM`: Tenant global scope (USER additionally permits self-inspection `session.userId === entity_id`).
  - *Deleted-Resource Authoritative Scope Resolution:* For physically deleted entities (not found in live tables), resource scope cannot be read from live rows and must be evaluated against the entity's **authoritative terminal scope**:
    - *Verified Terminal Deletion Event:* If the latest retained audit record is a verified deletion event (`action` indicates terminal physical removal, e.g. `_DELETED`, `_REMOVED`, `_PURGED`, with `new_value == null`), scope is extracted from its verified pre-deletion snapshot in `old_value` (`old_value.branch_id`, `old_value.warehouse_id`).
    - *Mutation / Reassignment Event as Latest Retained Event:* If the latest retained audit record is an update or reassignment action (e.g. `ORDER_REASSIGNED`, `ORDER_UPDATED`, where an order was reassigned from B1 to B2), the terminal scope resulting from that action is extracted from `new_value` (`new_value.branch_id = 'B2'`), **NEVER** from `old_value` (which would improperly authorize the prior scope B1).
    - *Authoritative Scope Traversal:* If the latest record lacks complete scope fields, the service traverses retained audit logs in reverse chronological order (`created_at DESC`) to locate the most recently assigned `branch_id` and `warehouse_id` (inspecting `old_value` for deletion events or `new_value` for mutations).
    - *Fail Closed when Unavailable:* If no verified terminal snapshot or authoritative historical record establishes the entity's scope (`branch_id` or `warehouse_id`), scoped callers (`is_scoped = true`) cannot establish resource affinity and the system must **fail closed** with canonical HTTP 403 `FORBIDDEN`. (Unscoped tenant-wide roles pass).
  - If resource scope check fails, reject with canonical 403 `FORBIDDEN`.
- `BR-COM-07-04 — Secrets & Credential Redaction`: Password hashes, session tokens, OTP codes, recovery keys, webhook secrets, and private keys must NEVER be returned in activity diffs or stored in UI logs. They must be unconditionally replaced with `"[REDACTED]"`.
- `BR-COM-07-05 — PII & Confidential Data Masking`: Recipient phone numbers and email addresses in before/after snapshots must be masked (e.g. `0901****567`) unless the caller possesses the `pii:unmask` capability. Raw client IP addresses stored in `AuditLog` are stripped from timeline responses.
- `BR-COM-07-06 — Financial Figure Masking`: Sensitive monetary values (carrier contract rates, COD collected amounts, discrepancy settlement values) in diffs must be masked unless the caller holds reconciliation permissions (`reconciliation:view_contract_rates` or `reconciliation:run_review_audit`) or the Owner role.
- `BR-COM-07-07 — Correlation ID Handling & Legacy Fallback`: The correlation ID must represent the original execution/request ID that generated the event. If `correlation_id` is null on a legacy row, the service parses `reason` for `correlation_id:...`. If absent, return `null`. The system must NEVER replace the event correlation ID with the query request's correlation ID or fabricate a UUID.
- `BR-COM-07-08 — Actor Attribution Resilience`: If the user who performed an action has been deleted or suspended, the timeline displays their last recorded name or `"[Người dùng đã xóa]"` (`actor.type = 'USER'`). System actions are attributed to `"Hệ thống"` (`actor.type = 'SYSTEM'`), and carrier webhook events to the carrier code (`actor.type = 'CARRIER'`). If unknown, return `"Không xác định"` (`actor.type = 'UNKNOWN'`).
- `BR-COM-07-09 — Keyset Pagination Stability`: Timeline results must be deterministically ordered by `created_at DESC, id DESC`. Keyset pagination cursors encode both timestamp and ID to prevent dropped or duplicate records when multiple events share identical millisecond timestamps.
- `BR-COM-07-10 — Read-Only Idempotency`: Querying or retrying an activity timeline is strictly read-only and idempotent. It must never trigger external carrier commands, re-run business logic, or mutate database state.
- `BR-COM-07-11 — Execution Status Semantics`: Every activity item includes a top-level `status` property with enum values `['SUCCESS', 'FAILED']`. Committed business transactions recorded in `AuditLog` default to `'SUCCESS'`. Logged execution failures, rejected commands, or failed remote dispatches recorded for compliance are marked `'FAILED'`.
- `BR-COM-07-12 — Lifecycle Classification, Snapshot Preservation & Partial Diff Handling`: Field-level diff computation must classify event lifecycle using the `action` and preserve available evidence across all event states:
  - *Action-Based Lifecycle Classification:*
    - **Creation Actions** (actions indicating entity initialization, e.g. ending in `_CREATED`, `_REGISTERED`, `_INVITED`, `_INITIALIZED`, or verb prefixes `CREATE_`, `REGISTER_`): When `old_value == null && new_value != null`, this is an initial creation event. Prior state is *known absent*. All properties in `new_value` are projected into `changes` with `old_value = null` and `new_value = <value>`. Item is marked with `is_partial = false`.
    - **Deletion Actions** (actions indicating terminal physical removal, e.g. ending in `_DELETED`, `_REMOVED`, `_PURGED`, or verb prefixes `DELETE_`, `REMOVE_`, `PURGE_`; **strictly excluding cancellation state transitions**): When `old_value != null && new_value == null`, this is a verified entity deletion event. Succeeding state is *known absent*. All properties in `old_value` are projected into `changes` with `old_value = <value>` and `new_value = null`. Item is marked with `is_partial = false`.
    - **Cancellation & State Transition Actions** (actions indicating business state changes, e.g. ending in `_CANCELLED`, `_STATUS_CHANGED`, `_CLOSED`, or verb prefix `CANCEL_`, e.g. `ORDER_CANCELLED`, `SHIPMENT_CANCELLED`): A cancelled entity remains persisted in the database (`orders` or `shipments` table). Cancellation is a status mutation, NOT an entity deletion. When a cancellation action has `old_value != null && new_value == null`, subsequent state telemetry was unrecorded by legacy producer and is **unavailable** (succeeding state is NOT absent). Project all properties of `old_value` into `changes` with `old_value = <value>` and `new_value = null`, and mark the item with `is_partial = true`. Missing subsequent telemetry cannot establish entity absence.
    - **Update / Mutation Actions** (all other actions, e.g. ending in `_UPDATED`, `_MODIFIED`, `_ACTIVATED`, `_DEACTIVATED`, `_ASSIGNED`, `_REASSIGNED`, etc.):
      - *Complete Update (`old_value != null && new_value != null`):* Project only fields where `old_value[k] !== new_value[k]`, with `old_value: old_value[k]`, `new_value: new_value[k]`. Item is marked with `is_partial = false`.
      - *Partial Update with Missing `old_value` (`old_value == null && new_value != null`):* Previous state was unrecorded by legacy producer and is **unavailable** (NOT absent). Project all properties of `new_value` into `changes` with `old_value = null` and `new_value = <value>`, and set `is_partial = true` on the item. This explicitly distinguishes an unavailable previous state (`is_partial = true`) from a known absent initial creation state (`is_partial = false`).
      - *Partial Update with Missing `new_value` (`old_value != null && new_value == null`):* Subsequent state was unrecorded by legacy producer and is **unavailable** (the entity was NOT deleted). Project all properties of `old_value` into `changes` with `old_value = <value>` and `new_value = null`, and set `is_partial = true` on the item. This explicitly distinguishes an unavailable next state (`is_partial = true`) from a known absent terminal deletion state (`is_partial = false`).
  - *Unavailable Snapshot Events across any action (`old_value == null && new_value == null`):* Return `changes: []` and set `is_partial = true`. The API returns HTTP 200 OK with complete event metadata (actor, timestamp, correlation ID, action, status). This distinguishes unavailable historical telemetry from an absent entity (which fails closed with 404 `NOT_FOUND`).
  - Sensitive field redaction (BR-COM-07-04), PII masking (BR-COM-07-05), and financial masking (BR-COM-07-06) apply to all projected fields.

## Approved product decisions (formerly blocking gaps G1–G4)

On 2026-10-31, the product owner (operator) formally APPROVED all recommended decisions for gaps G1 through G4 as written below (`HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31` in `BASELINE-AND-DECISIONS.md`). The gaps are converted into binding architectural and product decisions:

### Decision G1 (DEC-COM07-01): Entity Coverage & Delivery Entry Points
- **Gap context (G1):** Catalog says only four fields; Shared screen contract requires history for business-critical entities; SCR-SHIP-01/EXC-01/CASE-01 describe domain timelines. No COM-07 use case lists delivery entities, existing producer actions, host screens or minimum vertical acceptance path.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Entity Coverage:* FEAT-COM-07 covers primary operational and configuration entities: `Shop` (`SHOP`), `Branch` (`BRANCH`), `Warehouse` (`WAREHOUSE`), `User` (`USER`), `Order` (`ORDER`), `Shipment` (`SHIPMENT`), `ExceptionCase` (`EXCEPTION_CASE`), and `Claim` (`CLAIM`).
  2. *Minimum Vertical Acceptance Path:* Author implementation must deliver end-to-end vertical integration on `Shop` (`apps/web/src/app/settings/shop/page.tsx`), `Branch` (`BranchManagementView.tsx`), and `Warehouse` (`WarehouseManagementView.tsx`), where real mutations (updates, activations, deactivations) produce durable audit records that are queried and displayed in the live activity timeline.
  3. *Domain Screen Integration Deferral:* Direct integration into domain screens (`SCR-SHIP-01` Shipment details, `SCR-EXC-01` Exception details, `SCR-CASE-01` Claim details) is explicitly deferred to subsequent vertical feature Work Items (`FEAT-SHP-01`, `FEAT-EXC-01`, `FEAT-CLM-01`). The host screen completion boundary for FEAT-COM-07 is strictly limited to Shop (`apps/web/src/app/settings/shop/page.tsx`), Branch (`BranchManagementView.tsx`), and Warehouse (`WarehouseManagementView.tsx`). The shared `ActivityTimeline` component is authored with a clean, decoupled prop contract (`entityType`, `entityId`) for seamless adoption by subsequent domain Work Items without modifying activity module code.
  4. *Mock Prohibition:* Substituting the mock `UnifiedTrackingModal.tsx` for live activity is strictly prohibited; all timelines must query durable backend records from `GET /api/v1/activity`.

### Decision G2 (DEC-COM07-02): Access Control, Entity Permissions, Resource Scopes & Data Visibility
- **Gap context (G2):** `View immutable audit log` denies operational roles that otherwise view shipments/exceptions; global activity capability has no permission mapping. Existing `audit:view` proves a capability exists, not that every entity timeline must use it.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Entity-Permission Governed:* Viewing an entity's timeline requires read permission for the underlying entity plus tenant isolation. The global administrative capability `audit:view` is NOT required for contextual entity activity (it remains reserved for admin-wide audit browsing in `FEAT-ADM-03`).
  2. *Exhaustive Entity-to-Capability and Resource Scope Mapping:*

| Target `entity_type` | Required Capability (`OR` condition within cell) | Tenant Scope (Mandatory `AND`) | Resource Scope (FEAT-RBAC-02) (Mandatory `AND` if scoped) | Behavior on Failure |
|---|---|---|---|---|
| `SHOP` | `shop:read` OR `organization:view` | `session.merchantId === entity.id` | Tenant global | Tenant mismatch: 404 `NOT_FOUND`. Missing capability: 403 `FORBIDDEN`. |
| `BRANCH` | `branch:read` | `session.merchantId === entity.merchant_id` | Scoped role: `session.branchIds` contains `entity.id` (or deleted branch `id`). Tenant-wide: allowed. | Tenant mismatch: 404 `NOT_FOUND`. Missing capability or scope: 403 `FORBIDDEN`. |
| `WAREHOUSE` | `warehouse:read` | `session.merchantId === entity.merchant_id` | Scoped role: `session.warehouseIds` contains `entity.id` (or deleted warehouse `id`). Tenant-wide: allowed. | Tenant mismatch: 404 `NOT_FOUND`. Missing capability or scope: 403 `FORBIDDEN`. |
| `USER` | `user:read` OR caller querying own user activity (`session.userId === entity_id`) | `session.merchantId === entity.merchant_id` | Tenant global | Tenant mismatch: 404 `NOT_FOUND`. Missing capability and not self: 403 `FORBIDDEN`. |
| `ORDER` | `order:read` | `session.merchantId === entity.merchant_id` | Scoped role: matching branch or warehouse scope via **Disjunctive OR** (`session.branchIds` contains `order.branch_id` OR `session.warehouseIds` contains `order.warehouse_id`). Caller with matching branch but unassigned/mismatched warehouse is granted. If single association exists, matching scope required. If neither assigned, scoped denied. Tenant-wide: allowed. | Tenant mismatch: 404 `NOT_FOUND`. Missing capability or scope: 403 `FORBIDDEN`. |
| `SHIPMENT` | `shipment:read` OR `shipment:track_exceptions` | `session.merchantId === entity.merchant_id` | Scoped role: matching branch or warehouse scope via **Disjunctive OR** (`session.branchIds` contains `shipment.branch_id` OR `session.warehouseIds` contains `shipment.warehouse_id`). Caller with matching branch but unassigned/mismatched warehouse is granted. If single association exists, matching scope required. If neither assigned, scoped denied. Tenant-wide: allowed. | Tenant mismatch: 404 `NOT_FOUND`. Missing capability or scope: 403 `FORBIDDEN`. |
| `EXCEPTION_CASE` | `exception:read` OR `shipment:track_exceptions` | `session.merchantId === entity.merchant_id` | Scoped role: matching branch or warehouse scope via **Disjunctive OR** (`session.branchIds` contains `exception_case.branch_id` OR `session.warehouseIds` contains `exception_case.warehouse_id`). Caller with matching branch but unassigned/mismatched warehouse is granted. If single association exists, matching scope required. If neither assigned, scoped denied. Tenant-wide: allowed. | Tenant mismatch: 404 `NOT_FOUND`. Missing capability or scope: 403 `FORBIDDEN`. |
| `CLAIM` | `claim:view` OR `claim:read` | `session.merchantId === entity.merchant_id` | Tenant global | Tenant mismatch: 404 `NOT_FOUND`. Missing capability: 403 `FORBIDDEN`. |

  3. *Explicit Evaluation Logic:*
     - Step 1 (Parent Existence, Retained Tombstone Resolution & Tenant Isolation — Mandatory `AND`):
       - Step 1a: Attempt to locate target entity in primary live database table (`prisma[entityType].findUnique({ where: { id: entity_id } })`).
       - Step 1b (Authorized Historical Tombstone Lookup for Deleted Entities): If not found in primary table (entity physically deleted), query `AuditLog` table: `SELECT id, merchant_id, old_value, new_value, action, created_at FROM audit_logs WHERE entity_type = :entity_type AND entity_id = :entity_id ORDER BY created_at DESC`. If no audit log record exists, fail closed with 404 `NOT_FOUND`. Resolve tenant context `resolved_merchant_id = audit_logs[0].merchant_id`.
       - Step 1c (Tenant Isolation — Mandatory `AND`): Check `resolved_merchant_id === session.merchantId`. If mismatch, fail closed with 404 `NOT_FOUND` (never 403, preventing entity enumeration across tenants).
       - Step 1d (Authoritative Historical Scope Resolution for Deleted Entities): When the entity is physically deleted, resource scope cannot be read from the live database table. The service derives the entity's authoritative terminal scope (`resolved_branch_id`, `resolved_warehouse_id`) from the retained audit records:
         1. *Verified Terminal Deletion Event:* If the latest retained audit record is a verified deletion event (`action` ends in `_DELETED`, `_REMOVED`, `_PURGED`, or has verb prefix `DELETE_`, `REMOVE_`, `PURGE_`, with `new_value == null`), inspect `old_value` as the verified terminal snapshot. If `old_value` contains `branch_id` and/or `warehouse_id`, those values establish the authoritative terminal scope.
         2. *Mutation / Reassignment as Latest Retained Event:* If the latest retained audit record is an update or reassignment action (e.g. `ORDER_REASSIGNED`, `ORDER_UPDATED`, where an entity was reassigned from B1 to B2), the authoritative terminal scope resulting from that event is extracted from `new_value` (`new_value.branch_id = 'B2'`), **NEVER** from `old_value` (which holds prior scope B1). Authorizing using `old_value` would improperly grant access to the superseded scope B1 and deny the legitimate scope B2.
         3. *Authoritative Scope Traversal:* If the latest audit record lacks complete scope fields (e.g. partial snapshot or diff where only unrelated fields were captured), traverse retained audit records in reverse chronological order (`created_at DESC`) to locate the most recent authoritative scope assignment:
            - For deletion events: inspect `old_value` for `branch_id` / `warehouse_id`.
            - For non-deletion events: inspect `new_value` for `branch_id` / `warehouse_id`.
         4. *Fail-Closed Policy when Scope is Unavailable:* If no verified terminal snapshot or authoritative historical record establishes the entity's scope (`branch_id` or `warehouse_id`) for a scoped entity (`BRANCH`, `WAREHOUSE`, `ORDER`, `SHIPMENT`, `EXCEPTION_CASE`), scoped callers (`is_scoped = true`) CANNOT verify resource affinity. The service must **FAIL CLOSED** and return HTTP 403 `FORBIDDEN`. Unscoped tenant-wide roles (`is_scoped = false`, e.g. Owner) are permitted (HTTP 200 OK with `is_partial: true`).
     - Step 2 (Entity Capability — `OR` within entity type): Caller must hold at least one capability in the entity's allowed set. If none held, return 403 `FORBIDDEN`.
     - Step 3 (Resource Scope — Mandatory `AND` if scoped): If caller has a role constrained by branch or warehouse (`is_scoped = true` per `FEAT-RBAC-02`), evaluate scope against live entity fields (from Step 1a) or against the authoritative historical scope (`resolved_branch_id`, `resolved_warehouse_id` from Step 1d):
       - For `BRANCH`: `session.branchIds` must contain `entity.id` (or deleted branch `id`).
       - For `WAREHOUSE`: `session.warehouseIds` must contain `entity.id` (or deleted warehouse `id`).
       - For `ORDER`, `SHIPMENT`, `EXCEPTION_CASE`: Evaluated using **Disjunctive OR** when both associations exist (`session.branchIds.includes(effective_branch_id) || session.warehouseIds.includes(effective_warehouse_id)`).
         - *Mixed-Scope Concrete Decision:* A caller whose branch matches (`session.branchIds` contains `effective_branch_id`) but whose warehouse does NOT match (`session.warehouseIds` does not contain `effective_warehouse_id`) is **GRANTED** access (HTTP 200). Likewise, a caller whose warehouse matches but whose branch does not match is **GRANTED** access. Access is **DENIED** with HTTP 403 `FORBIDDEN` if and only if neither branch nor warehouse matches.
         - If only `branch_id` is populated, caller's `session.branchIds` must contain `effective_branch_id`.
         - If only `warehouse_id` is populated, caller's `session.warehouseIds` must contain `effective_warehouse_id`.
         - If neither is populated (or historical scope is unavailable), scoped caller is DENIED with 403 `FORBIDDEN` (fail closed).
       - Unscoped roles pass. Mismatch returns 403 `FORBIDDEN`.
  4. *Field-Level Privacy & Redaction:*
     - Secrets, tokens, hashes, and OTPs are unconditionally replaced with `"[REDACTED]"`.
     - Recipient PII (phone number, address) is masked (`0901****567`) unless caller holds `pii:unmask`.
     - Financial values (rates, COD, bank accounts) are masked unless caller holds reconciliation capabilities or Owner role.
     - Raw client IP addresses are stripped from timeline responses.
  5. *Platform Support:* Support staff have no permanent browsing rights; access requires an explicit, active, time-bound delegated session (`FEAT-SUP-01`).

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
  4. *Item Envelope & Status Semantics:*
     - Envelope: `{ id, entity_type, entity_id, action, actor: { id, name, type }, timestamp, correlation_id, changes: [{ field, old_value, new_value, is_sensitive }], reason, status, is_partial }`.
     - `status` Definition: Enum `['SUCCESS', 'FAILED']`. Indicates execution outcome of the logged activity. Committed transactions in `AuditLog` default to `'SUCCESS'`. Logged execution failures, rejected commands, or failed remote operations recorded for compliance are marked `'FAILED'`.
     - Complete item and envelope schema definitions are formalized in the OpenAPI contract below (`ActivityTimelineItem`, `ActivityChangeItem`, `ActivityActor`, `ActivityActorType`, `ActivityStatus`, `ActivityEntityType`).
  5. *Canonical Error Handling:*
     - 400 `VALIDATION_ERROR`: Invalid parameters, out-of-bounds limit, malformed cursor.
     - 401 `UNAUTHORIZED`: Missing or invalid session token.
     - 403 `FORBIDDEN`: Lacking read capability for target entity or out-of-scope resource.
     - 404 `NOT_FOUND`: Entity does not exist and has no historical audit records, or belongs to another tenant (fail closed). Physically deleted entities with existing audit records remain queryable to authorized callers via historical tombstone lookup.

### Decision G4 (DEC-COM07-04): Persistence Model, Additive Schema, Correlation ID, Legacy Rows & Attribution
- **Gap context (G4):** Conceptual `audit_events` requires correlation; `AuditLog` has none and stores free-text reasons. Shop writer embeds correlation in reason; profile writer omits it and persists personal snapshots/raw client IP. No approved legacy, field projection or attribution policy exists.
- **Approved Decision (Operator approval 2026-10-31):**
  1. *Additive Schema:* Add nullable column `correlation_id String?` to Prisma model `AuditLog` with compound indexes `@@index([merchant_id, entity_type, entity_id])` and `@@index([merchant_id, created_at])`. No destructive table rewrites or column drops.
  2. *Legacy Row Compatibility, Lifecycle Classification & Snapshot Evidence Preservation:*
     - *Correlation parsing:* If `correlation_id` column is null, parse `reason` for `correlation_id:([a-zA-Z0-9_-]+)`. If matched, extract as `correlation_id`. If absent, return `null`. Never invent synthetic correlation IDs or substitute the query request's correlation ID.
     - *Action-Based Lifecycle Classification & Snapshot Preservation:*
       - *Creation Events (`is_creation_action && old_value == null && new_value != null`):* Initial creation event. Prior state is *known absent*. Preserve all attributes in `new_value`. Project each property into `changes` with `old_value: null` and `new_value: <value>`. Item is marked with `is_partial: false`.
       - *Deletion Events (`is_deletion_action && old_value != null && new_value == null`):* Entity deletion event. Action indicates terminal physical removal (`_DELETED`, `_REMOVED`, `_PURGED`, `DELETE_`, `REMOVE_`, `PURGE_`; **strictly excluding cancellation actions such as `_CANCELLED` or `CANCEL_`**). Succeeding state is *known absent*. Preserve all attributes in `old_value`. Project each property into `changes` with `old_value: <value>` and `new_value = null`. Item is marked with `is_partial: false`.
       - *Cancellation Events (`is_cancellation_action && old_value != null && new_value == null`):* Action indicates a cancellation state transition (e.g. `ORDER_CANCELLED`, `SHIPMENT_CANCELLED`, or prefix `CANCEL_`). The underlying entity remains persisted in the database (`orders` or `shipments` table). Succeeding state is **NOT absent**. Missing subsequent telemetry indicates that the legacy producer did not capture the post-cancellation snapshot. Project all properties of `old_value` into `changes` with `old_value: <value>` and `new_value = null`, and set `is_partial: true` (marking subsequent snapshot telemetry as unavailable, NOT absent/deleted).
       - *Complete Update Events (`!is_creation_action && !is_deletion_action && !is_cancellation_action && old_value != null && new_value != null`):* Project only modified fields where `old_value[key] !== new_value[key]`. Item is marked with `is_partial: false`.
       - *Partial Update Events with Missing `old_value` (`!is_creation_action && old_value == null && new_value != null`):* Prior state was unrecorded by legacy producer and is **unavailable** (NOT absent). Project all properties of `new_value` into `changes` with `old_value: null` and `new_value: <value>`, and set `is_partial: true` on the item. This explicitly distinguishes unavailable previous state (`is_partial: true`) from known absent initial creation state (`is_partial: false`).
       - *Partial Update Events with Missing `new_value` (`!is_deletion_action && !is_cancellation_action && old_value != null && new_value == null`):* Subsequent state was unrecorded by legacy producer and is **unavailable** (the entity was NOT deleted). Project all properties of `old_value` into `changes` with `old_value: <value>` and `new_value: null`, and set `is_partial: true` on the item. This explicitly distinguishes unavailable next state (`is_partial: true`) from known absent terminal deletion state (`is_partial: false`).
       - *Unavailable Snapshot Events across any action (`old_value == null && new_value == null`):* Return `changes: []` and set `is_partial: true`. Event metadata (id, actor, timestamp, action, correlation_id) is returned with HTTP 200 OK. This distinguishes unavailable historical diffs from an absent entity (which returns 404 `NOT_FOUND`).
     - *Field Masking & Redaction:* Unconditionally redact secrets to `"[REDACTED]"`; mask recipient PII unless caller holds `pii:unmask`; mask financial figures unless caller holds reconciliation capabilities. Strip raw client IP addresses.
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

components:
  schemas:
    ActivityEntityType:
      type: string
      enum: [SHOP, BRANCH, WAREHOUSE, USER, ORDER, SHIPMENT, EXCEPTION_CASE, CLAIM]
      description: Target business entity type
    ActivityStatus:
      type: string
      enum: [SUCCESS, FAILED]
      description: Execution outcome of the audited activity (SUCCESS for committed operations, FAILED for rejected or error operations)
    ActivityActorType:
      type: string
      enum: [USER, SYSTEM, CARRIER, UNKNOWN]
      description: Category of the actor performing the activity
    ActivityActor:
      type: object
      required: [name, type]
      properties:
        id:
          type: string
          nullable: true
          description: Actor unique identifier if user, or null if system or carrier
        name:
          type: string
          description: Display name of the actor (user display name, "Hệ thống", carrier code, or "[Người dùng đã xóa]")
        type:
          $ref: '#/components/schemas/ActivityActorType'
    ActivityChangeItem:
      type: object
      required: [field, is_sensitive]
      properties:
        field:
          type: string
          description: Name of the property that changed
        old_value:
          nullable: true
          description: Value before the change, or null for creation events or partial updates lacking recorded prior state
        new_value:
          nullable: true
          description: Value after the change, or null for deletion events or partial updates lacking recorded subsequent state
        is_sensitive:
          type: boolean
          description: Whether this field contained sensitive data requiring masking or redaction
    ActivityTimelineItem:
      type: object
      required: [id, entity_type, entity_id, action, actor, timestamp, changes, status, is_partial]
      properties:
        id:
          type: string
          format: uuid
          description: Unique audit event identifier
        entity_type:
          $ref: '#/components/schemas/ActivityEntityType'
        entity_id:
          type: string
          description: Target entity identifier
        action:
          type: string
          description: Specific action code (e.g. SHOP_UPDATED, BRANCH_ACTIVATED, USER_INVITED)
        actor:
          $ref: '#/components/schemas/ActivityActor'
        timestamp:
          type: string
          format: date-time
          description: Exact UTC timestamp when the event was recorded
        correlation_id:
          type: string
          nullable: true
          description: Original execution/request correlation ID connecting the action to its execution context
        changes:
          type: array
          items:
            $ref: '#/components/schemas/ActivityChangeItem'
          description: Field-level before/after diffs; preserves all fields for creation/deletion, modified fields for full updates, populated side for partial updates, empty array for unavailable historical snapshots
        reason:
          type: string
          nullable: true
          description: Human-readable note, business reason, or failure cause
        status:
          $ref: '#/components/schemas/ActivityStatus'
        is_partial:
          type: boolean
          description: True if this event has missing snapshot data (e.g. partial update missing unrecorded old_value or new_value, or both snapshots null) or legacy unparsed correlation, distinguishing unavailable telemetry from known-absent creation/deletion states
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
| AC-COM-07-01 / TEST-COM-07-READY | Planning completeness verification. | G1–G4 approved decisions recorded; delivery boundary strictly bounded to Shop/Branch/Warehouse host screens with domain screens deferred; exhaustive 8-entity RBAC mapping; OpenAPI ActivityTimelineItem schema with status enum; one-sided snapshot preservation for creations and deletions; status READY_FOR_AUTHOR. | Source diff and Work Item review. |
| AC-COM-07-02 / TEST-COM-07-VERTICAL | Authorized user mutates Shop/Branch/Warehouse and opens Activity Timeline in respective host screens (`settings/shop`, `BranchManagementView`, `WarehouseManagementView`). | Live timeline displays new event with exact actor, timestamp, field-level before/after diffs, and original correlation ID matching database record. Direct domain screen integrations (`SCR-SHIP-01`, `SCR-EXC-01`, `SCR-CASE-01`) explicitly deferred. | Real Supertest integration + Playwright browser journey with screenshot. |
| AC-COM-07-03 / TEST-COM-07-TENANT | Tenant A requests activity of Tenant B's entity or manipulates merchant headers. | Server rejects request with 404 `NOT_FOUND` (fail closed); zero foreign event, actor, count, or correlation leakage (E2E-10). | Two-tenant Supertest test suite. |
| AC-COM-07-04 / TEST-COM-07-SCOPE | Permitted user lacks access to entity's assigned branch or warehouse scope. | Server denies request with 403 `FORBIDDEN`. Access granted immediately when matching scope is active in session. | Scoped Supertest integration test across role permissions. |
| AC-COM-07-05 / TEST-COM-07-RBAC | Roles with entity read permission (Owner, Ops Manager, Staff) vs unprivileged roles across all 8 entity types (SHOP, BRANCH, WAREHOUSE, USER, ORDER, SHIPMENT, EXCEPTION_CASE, CLAIM). | Privileged roles view timeline without requiring `audit:view`; self-query (`session.userId === entity_id`) succeeds for USER; unprivileged roles receive canonical 403 `FORBIDDEN`. | Table-driven RBAC capability unit and integration tests across all 8 entity types. |
| AC-COM-07-06 / TEST-COM-07-PRIVACY | Activity diff contains synthetic passwords, OTPs, phone numbers, and financial rates. | Passwords/OTPs unconditionally replaced with `"[REDACTED]"`; phone/address masked unless caller holds `pii:unmask`; rates masked unless caller holds reconciliation capabilities. | Privacy projection unit tests and API response assertions. |
| AC-COM-07-07 / TEST-COM-07-LEGACY | Querying historical audit records with null `correlation_id` or legacy `reason: "correlation_id:xyz"`. | Service extracts correlation from reason when present; returns null when absent; never replaces event correlation with query request correlation. | Unit tests using legacy database fixtures. |
| AC-COM-07-08 / TEST-COM-07-READONLY | Repeated timeline queries, retries after network drop, or rapid page refreshes. | Query is strictly read-only; no modified database state, no duplicate domain events, zero carrier side-effects. | Before/after database state assertions and carrier spy checks. |
| AC-COM-07-09 / TEST-COM-07-PAGING | Entity with >50 activity events traversed via keyset pagination with cursor. | Stable descending order (`created_at DESC, id DESC`); zero omitted or duplicated records across page boundaries. | Pagination traversal unit and Supertest tests. |
| AC-COM-07-10 / TEST-COM-07-STATES | Render all 10 UI states: loading, empty, validation, server error, 403, 404, partial, success, recovery, a11y. | All 10 states render cleanly matching design system rules; interactive retry button functional; correlation copy toast functional. | Component tests (`activity-timeline-states.test.ts`) and Playwright visual screenshots. |
| AC-COM-07-11 / TEST-COM-07-A11Y | Keyboard user navigates timeline cards, expands diffs, and copies correlation ID. | Focus outline visible; all icon buttons have `aria-label`; axe accessibility scanner reports 0 violations; mobile responsive layout verified. | `verify-a11y.ts` script run, Playwright axe test, and viewport checks. |
| AC-COM-07-12 / TEST-COM-07-COMPAT | Apply additive migration to PostgreSQL and verify existing profile/shop/RBAC writers. | Additive schema migration executes cleanly; existing audit writers function without regressions; `pnpm contract:check` passes with updated OpenAPI. | Migration status, contract check, and existing suite regression runs. |
| AC-COM-07-13 / TEST-COM-07-SNAPSHOT-CREATION | Entity creation event with `old_value == null` and populated `new_value`. | API preserves all populated initial fields in `changes` array with `old_value: null` and `new_value: <value>`; sensitive fields properly masked/redacted. | Supertest API assertion asserting non-empty `changes` with null `old_value`. |
| AC-COM-07-14 / TEST-COM-07-SNAPSHOT-DELETION | Real delete-then-query test: entity (e.g. Branch) created, updated, and physically deleted via management API (`DELETE /api/v1/branches/:id`). Authorized caller queries `GET /api/v1/activity?entity_type=BRANCH&entity_id=<deleted_id>`. | API performs authorized historical tombstone lookup against retained audit logs; verifies `merchant_id`; validates that the terminal audit record represents a verified terminal deletion event (`action: 'BRANCH_DELETED'`) where `old_value` preserves verified terminal scope fields, `new_value: null`, `is_partial: false`, and sensitive fields are masked; returns HTTP 200 OK with complete history. Foreign tenant receives 404 `NOT_FOUND`, unprivileged role receives 403 `FORBIDDEN`, and non-existent ID receives 404 `NOT_FOUND`. | Real delete-then-query Supertest integration test verifying physical row deletion followed by historical activity timeline retrieval. |
| AC-COM-07-15 / TEST-COM-07-SNAPSHOT-UNAVAILABLE | Historical legacy event with both `old_value == null` and `new_value == null`. | API returns HTTP 200 OK with `changes: []`, `is_partial: true`, preserving actor, timestamp, action, and correlation ID (distinguished from 404 entity not found). | Supertest API assertion comparing 200 OK partial event vs 404 nonexistent entity. |
| AC-COM-07-16 / TEST-COM-07-SNAPSHOT-PARTIAL-UPDATE-NO-OLD | Update action (e.g. `SHOP_UPDATED`) where legacy producer provided `new_value` but `old_value == null`. | API returns HTTP 200 OK; projects `new_value` fields into `changes` array with `old_value: null` and `new_value: <value>`; marks item `is_partial: true` to indicate unavailable historical prior state (distinguished from creation `is_partial: false`). | Supertest API assertion asserting `is_partial === true` on update action with null `old_value`. |
| AC-COM-07-17 / TEST-COM-07-SNAPSHOT-PARTIAL-UPDATE-NO-NEW | Update action (e.g. `BRANCH_UPDATED`) where legacy producer provided `old_value` but `new_value == null`. | API returns HTTP 200 OK; projects `old_value` fields into `changes` array with `old_value: <value>` and `new_value: null`; marks item `is_partial: true` to indicate unavailable historical next state (distinguished from deletion `is_partial: false`). | Supertest API assertion asserting `is_partial === true` on update action with null `new_value`. |
| AC-COM-07-18 / TEST-COM-07-SCOPE-MIXED | Caller session has branch scope `['B1']` and warehouse scope `['W1']`. Queries: (1) Order with `branch_id = 'B1'`, `warehouse_id = 'W2'` (branch match, warehouse mismatch); (2) Shipment with `branch_id = 'B2'`, `warehouse_id = 'W1'` (branch mismatch, warehouse match); (3) ExceptionCase with `branch_id = 'B2'`, `warehouse_id = 'W2'` (neither matches); (4) Order with null branch and null warehouse. | Scenarios (1) and (2) return HTTP 200 OK under Disjunctive OR scope evaluation. Scenario (3) returns HTTP 403 `FORBIDDEN`. Scenario (4) returns HTTP 403 `FORBIDDEN` for scoped caller (allowed only for tenant-wide unconstrained caller). | Multi-scenario scoped Supertest authorization tests covering all four mixed-scope conditions. |
| AC-COM-07-19 / TEST-COM-07-CANCELLATION-NOT-DELETION | Cancelled entity remains persisted with missing subsequent snapshot telemetry: Order or Shipment is cancelled (`action: 'ORDER_CANCELLED'` or `'SHIPMENT_CANCELLED'`). The entity remains persisted in the database table (`orders` / `shipments` with `status: 'CANCELLED'`). The audit log row records populated `old_value` and missing `new_value == null`. | Server resolves entity from live database table; executes capability and scope check; returns HTTP 200 OK. Diff computation classifies action as cancellation state transition (strictly excluded from deletion classification); projects `old_value` properties into `changes` with `old_value = <value>` and `new_value = null`; marks item `is_partial: true` (unavailable subsequent telemetry, distinguishing it from terminal deletion `is_partial: false`). Succeeding state is not marked absent. | Supertest API test verifying live entity resolution of cancelled order/shipment, non-deletion classification, and `is_partial === true` on cancellation event with null `new_value`. |
| AC-COM-07-20 / TEST-COM-07-REASSIGNMENT-BEFORE-DELETION | Reassignment before deletion authorization: Scoped callers query physically deleted Order with reassignment history (created at Branch B1, reassigned to Branch B2 via `action: 'ORDER_REASSIGNED'`, then physically deleted from live `orders` table):<br>(1) Explicit terminal deletion event (`action: 'ORDER_DELETED'` with verified terminal snapshot `old_value: { branch_id: 'B2' }`, `new_value: null`);<br>(2) Legacy deleted order where `ORDER_REASSIGNED` from B1 to B2 is the latest retained event (terminal scope resolved from `new_value` `branch_id = 'B2'`);<br>(3) Deleted order whose retained audit records lack `branch_id` and `warehouse_id` (unavailable historical scope). | For (1) and (2): Caller with active scope B2 is GRANTED access (HTTP 200 OK); caller with prior scope B1 is DENIED (HTTP 403 `FORBIDDEN`), proving scope is evaluated against terminal assignment B2 and never exposes history to superseded B1 scope.<br>For (3): Scoped callers fail closed with HTTP 403 `FORBIDDEN` due to unavailable scope; tenant-wide unscoped role (Owner) is GRANTED HTTP 200 OK with `is_partial: true`. Foreign tenant receives 404 `NOT_FOUND`. | Multi-scenario Supertest integration tests covering reassignment before deletion, terminal snapshot verification, new_value resolution on legacy mutations, and fail-closed denial on unavailable historical scope. |

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
| Planning review 1, 2026-10-31 | `0867b611` | CHANGES_REQUIRED | Resolved P1-G1 (domain screens explicitly deferred to vertical items; completion boundary strictly limited to Shop, Branch, Warehouse); P1-G2 (exhaustive 8-entity RBAC capability & resource-scope mapping with explicit AND/OR logic); P2-G3 (OpenAPI ActivityTimelineItem schema defined, status enum semantics SUCCESS/FAILED); NEW P1-G4 (preserved one-sided creation/deletion snapshots, distinguished unavailable history from 404 absent entity, added acceptance cases AC-COM-07-13 to 15); governance records aligned. |
| Planning review 2, 2026-10-31 | `49847397` | CHANGES_REQUIRED | Findings on mixed-scope resource authorization (P1-G2), partial update snapshot preservation (P1-G4), carrier planning artifact preservation (NEW P1), and deletion acceptance vs parent-existence authorization (NEW P1). |
| Planning review 3, 2026-10-31 | `3c8b55ab` | CHANGES_REQUIRED | Findings on deleted-resource authorization taking latest audit row's old_value without verifying deletion, exposing reassigned entities to wrong scope (Previous P1); and cancellation action with populated old_value and missing new_value incorrectly establishing entity absence / classified as deletion (NEW P1). |
| Review reconciliation, 2026-10-31 | Current review fix commit | READY_FOR_CODEX | Resolved all review findings: Deleted-resource authorization (required verified terminal snapshot or authoritative historical scope record resolved from new_value on mutations, fail closed with 403 FORBIDDEN when scope unavailable, added reassignment-before-deletion acceptance case AC-COM-07-20); Cancellation absence classification (strictly excluded cancellation state transitions from deletion classification, recognized cancelled entities remain persisted, marked missing telemetry is_partial: true, added cancellation acceptance case AC-COM-07-19). |

## Residual limitations

None. All review findings (P1-G1, P1-G2, P2-G3, P1-G4, carrier planning preservation, deleted-resource authorization & reassignment-before-deletion, cancellation state transition vs deletion classification, governance alignment) are resolved with concrete decisions, exhaustive capability mappings, OpenAPI component schemas, authoritative historical scope derivation, and snapshot preservation rules. Work Item is unblocked, complete, and ready for author dispatch.
