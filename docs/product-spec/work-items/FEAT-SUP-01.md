# FEAT-SUP-01 — Shop users can request contextual support with explicit consent

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `FEAT-SUP-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Feature ID      | `FEAT-SUP-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Delivery order  | `29`, slice `S01`, Shared platform                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged); attachment and support-access boundaries governed by approved decisions G05–G07 (COM-06 private attachment contract, SEC-02 consent enforcement alignment) under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`                                                                                                                          |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Risk            | `HIGH` — tenant access, restricted files, support identity and consent                                                                                                                                                                                                                                                                                                                                                                                                  |
| Allowed paths   | `apps/api/src/support/*`, `apps/api/src/app.module.ts`, `apps/api/src/rbac/rbac.constants.ts`, `apps/api/src/rbac/rbac.dto.ts`, `prisma/schema.prisma`, `prisma/migrations/*`, `infra/docker/seed.ts`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/openapi.ts`, `packages/contracts/src/index.ts`, `apps/web/src/app/support/*`, `apps/web/src/components/support/*`, `apps/web/src/components/navigation/*`, `apps/web/e2e/support.spec.ts`, `docs/product-spec/work-items/FEAT-SUP-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` |
| Reviewer        | Codex — fresh independent task                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Branch          | `feat/feat-sup-01`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Pull Request    | To be opened upon implementation                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Planning assessment: 2026-10-31. On 2026-10-31, the product owner (operator) APPROVED ALL recommended decisions G01–G09 as written. All former planning gaps have been converted into recorded decisions under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`. Product decisions are resolved; author handoff remains blocked until the inherited-content checks below pass and the planning PR receives an independent review PASS.

## Business outcome

Shop users operating in Ship Dễ need to request technical and operational assistance directly within the context of specific business entities (orders, shipments, carrier statements, exception cases, claims, or discrepancies). They must be able to attach private diagnostic evidence (screenshots, documents), view full message history, and track ticket status.

To safeguard shop confidentiality and tenant isolation:
1. Creating a support request never implicitly grants a Ship Dễ operator access to tenant business data.
2. An operator may inspect tenant business data only when an explicit, time-bound, scoped, read-only consent grant (`SupportAccessGrant`) is issued by an authorized shop user (`SHOP_OWNER`).
3. The consent grant specifies a mandatory purpose, explicit duration (default 4 hours, maximum 24 hours), and can be revoked immediately by `SHOP_OWNER` at any time.
4. All ticket operations (create, reply, transition) and operator consent accesses produce immutable audit records with masked sensitive PII.

Supported actors:
- `SHOP_OWNER`: Authority to create/read/reply to support requests, grant support consent, and revoke support consent.
- `SHOP_ADMIN`: Authority to create/read/reply to support requests.
- `SHOP_STAFF`: Authority to create/read/reply to support requests.
- `SHIPDE_OPERATOR`: Authority to view requests, post operator replies, and transition ticket progress (`OPEN` → `IN_PROGRESS` → `WAITING_FOR_SHOP` → `RESOLVED`). Allowed to view tenant business data strictly when an active `SupportAccessGrant` exists.
- `SYSTEM_ADMIN`: Platform operations, no default business-data browsing without active consent grant.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — Precedence order; `HUMAN-DECISION-FEAT-SUP-01-2026-10-31` approving G01–G09.
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — Section 3: Operational user workflows; tenant isolation boundaries.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — Section 2: `FEAT-SUP-01` Support requests; `FEAT-COM-06` Private attachments; Section 11: `FEAT-SEC-02` Support access.
- `docs/product-spec/docs/01-product/ACTORS-PERSONAS.md` — `SHIPDE_OPERATOR`, `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`; temporary access principles.
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Granular support capabilities: `support:request_create`, `support:request_read`, `support:request_reply`, `support:request_transition`, `support:grant_manage`.
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — Shared screen contract (loading, empty, validation, error, forbidden, not-found, partial, success, recovery, consent); `SCR-SUP-01` to `SCR-SUP-04`.
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — Navigation structure; support routes `/support`, `/support/new`, `/support/:id`.
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Design system guidelines, responsive layouts, WCAG AA accessibility, keyboard navigation.
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Aggregates: `SupportRequest`, `SupportReply`, `SupportAttachment`, `SupportAccessGrant`, `AuditEvent`.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Classification of restricted files, confidential financial context, masking rules.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Base path `/api/v1/support/requests`, canonical response and error envelopes, idempotency.
- `docs/product-spec/contracts/openapi.yaml` — OpenAPI v3 specification for support endpoints and schemas.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Server-side tenant scoping (`merchant_id`), short-lived presigned URLs, immutable audit trail, PII masking.
- `docs/product-spec/docs/07-ai-build/DEFINITION-OF-READY-DONE.md` — Feature Definition of Ready and Done gates.
- `docs/product-spec/docs/08-testing/TEST-STRATEGY.md` & `ACCEPTANCE-AND-E2E.md` — Multi-tenant attack tests, golden test datasets, E2E acceptance tests.

## Preconditions and dependencies

1. Identity and security foundation (`TASK-FOUND-04`, `FEAT-AUTH-01`, `FEAT-AUTH-06`, `FEAT-RBAC-01`, `FEAT-RBAC-02`) is merged. `SessionGuard` provides authenticated `userId`, `merchant_id`, and roles.
2. Tenant boundary is `merchant_id` (`Merchant` model in `prisma/schema.prisma`).
3. Attachment dependency (G05): Reusable private attachment contract follows COM-06 guidelines (S3 storage, malware clean verification before linkage, short-lived presigned download URLs, prohibited public URLs).
4. Consent access boundary (G06/G07): Scoped grant enforcement data contract and token validation is delivered in Slice A of this Work Item, perfectly aligned with SEC-02 architecture.
5. All 9 planning gaps (G01–G09) are officially approved and resolved by the product owner on 2026-10-31 under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`.

## Vertical slicing and author boundary

### Preserve inherited Work Items

This planning PR contains the support Work Item, its register row, and its approved BASELINE decision, and preserves inherited main records; `.oc/pr-body.md` records the local review handoff. The implementation paths below authorize the future support implementation. All inherited behavior and workflow history must remain intact.

- Merge `origin/main` before handing this branch back for review. Preserve the complete FEAT-CAR-01 implementation introduced by `c6e71fcb9354cd2b14d1f5dcaed794abff306991` (PR #490): the carrier controller, DTO, module, service and tests; application module/package integration; RBAC permission; OpenAPI and generated contracts; catalog fixtures and seed integration; Prisma models and `prisma/migrations/20261031000000_feat_car_01_carrier_catalog/migration.sql`. These are inherited main artifacts, not support changes. Future support additions to shared files must retain them.
- Preserve the carrier catalog's authenticated read contract from [FEAT-CAR-01, API, event and data impact](FEAT-CAR-01.md#api-event-and-data-impact): an active tenant session and permission `iam:carrier_catalog:read`, with default assignments to `OWNER`, `OPS_MANAGER`, `ORDER_OPERATOR`, and `FINANCE`. Its scope is read-only platform reference data; catalog reads expose no merchant carrier accounts or credentials, grant no carrier action permissions, and invoke no carrier APIs. G04 support capabilities and G06 support consent confer no additional catalog permissions. Preserve all five endpoints and their OpenAPI/generated payload schemas listed below.
- Resolve register conflicts by Work Item ID, retaining exactly one row for every Work Item. At the inspected main commit above, retain FEAT-CAR-01 as `IN_PROGRESS` on `feat/feat-car-01-impl` and FEAT-COM-09 as `READY_FOR_AUTHOR` on `feat/feat-com-09`; retain this branch's FEAT-SUP-01 row as `READY_FOR_AUTHOR` on `feat/feat-sup-01`. Preserve the other Work Items' complete rows, Work Item documents, decisions, and traceability. If a later fetched main advances their records, retain that newer main state.
- Preserve `docs/product-spec/work-items/FEAT-CAR-01.md` from main, including its `IN_PROGRESS` status, `feat/feat-car-01-impl` branch, and implementation review rounds 4–5. Restoring only the CSV row leaves its handoff document regressed. Preserve the FEAT-COM-09 Work Item, its approved BASELINE entry, and its traceability row as well.
- Verify ancestry with `git merge-base --is-ancestor origin/main HEAD`, verify inherited code/contracts with `git diff --exit-code origin/main HEAD -- apps infra packages prisma docs/product-spec/contracts/openapi.yaml`, and verify inherited handoff documents with `git diff --exit-code origin/main HEAD -- docs/product-spec/work-items/FEAT-CAR-01.md docs/product-spec/work-items/FEAT-COM-09.md docs/product-spec/docs/00-control/TRACEABILITY.md`. Compare the register by `work_item_id`: every main Work Item must appear exactly once, and every complete row except FEAT-SUP-01 must match fetched main. Finally run `git diff --check origin/main...HEAD`. All ancestry, content-equality, and register checks must pass before the carrier-removal P1 can be recorded as resolved; a clean three-dot documentation diff alone does not prove the current main implementation is present.

Inherited catalog success payloads use `{ "catalog_revision": "CATALOG-2026-10-31", "data": ... }`; list `data` is an array in pinned dataset order with no pagination. Preserve the following contracts exactly; their field types and nullability remain defined by FEAT-CAR-01 and its OpenAPI schemas.

| Endpoint | Inputs | Preserved `data` payload |
|---|---|---|
| `GET /api/v1/carrier-catalog/carriers` | Optional boolean `is_active`; omission returns all seeded carriers. | `CarrierResponse[]`: `id`, `code`, `name`, `logo_url`, `is_active`, `evidence_level`, `description`, `catalog_revision`. |
| `GET /api/v1/carrier-catalog/carriers/{code}` | Case-sensitive `GHN`, `GHTK`, `VIETTEL_POST`, `JT`; aliases `VTP` → `VIETTEL_POST`, `JT_EXPRESS` → `JT`. | `CarrierDetailResponse`: the carrier fields above plus `services[]` of `CarrierServiceResponse` (`id`, `code`, `name`, `service_type`, `description`, `is_active`, `evidence_level`, `source_revision`). |
| `GET /api/v1/carrier-catalog/statuses` | No filters. | `CanonicalStatusResponse[]`: `code`, `category`, `label`, `description`, `stage_order`, `catalog_revision`. |
| `GET /api/v1/carrier-catalog/fee-components` | No filters. | `FeeComponentResponse[]`: `code`, `name`, `category`, `description`, `is_refundable`, `vat_applicable`, `catalog_revision`. |
| `GET /api/v1/carrier-catalog/compatibility` | Optional combinable `domain` (`CARRIER_ALIAS`, `STATUS`, `FEE`), `carrier_code` (canonical code or normalized alias), and exact `raw_key`. | `CompatibilityMappingResponse[]`: `catalog_revision`, nullable `carrier_code`, `domain`, `raw_key`, nullable `canonical_code`, `disposition` (`MAPPED`, `UNMAPPED`). No matches returns `200` with `data: []`. |

Preserve canonical error envelopes: unauthenticated reads return `401 UNAUTHORIZED`, unauthorized or tenantless reads return `403 FORBIDDEN`, and an unrecognized carrier detail code returns `404 RESOURCE_NOT_FOUND` without catalog rows. The support planning repair changes none of these inputs, outputs, or authorization rules.

Assign `GEMINI` as primary implementation author. Due to full-stack depth (Prisma migration, RBAC constants, NestJS API module, OpenAPI contract generation, and multi-state Next.js frontend with E2E tests), the delivery is partitioned into two distinct vertical slices:

### Slice A — Core API, Persistence, Contracts & Consent Security
- **Prisma Schema & Migrations**:
  - Add models: `SupportRequest`, `SupportReply`, `SupportAttachment`, `SupportAccessGrant`.
  - Add enum types: `SupportRequestStatusEnum` (`OPEN`, `IN_PROGRESS`, `WAITING_FOR_SHOP`, `RESOLVED`), `SupportContextTypeEnum` (`NONE`, `ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`), `SupportGrantStatusEnum` (`ACTIVE`, `REVOKED`, `EXPIRED`), `SupportAttachmentStatusEnum` (`STAGED`, `ATTACHED`, `QUARANTINED`, `EXPIRED`), `SupportAttachmentScanStatusEnum` (`PENDING`, `CLEAN`, `INFECTED`, `REJECTED`).
  - Add additive migration in `prisma/migrations/`.
  - Add seed fixtures for Tenant A and Tenant B in `infra/docker/seed.ts`.
- **RBAC & Authorization**:
  - Add canonical capability permissions in `apps/api/src/rbac/rbac.constants.ts`:
    - `support:request_create` (shop roles)
    - `support:request_read` (shop roles tenant-scoped; SHIPDE_OPERATOR platform-wide support queue)
    - `support:request_reply` (shop roles own tenant; SHIPDE_OPERATOR platform-wide)
    - `support:request_transition` (SHIPDE_OPERATOR progress/resolve; shop roles reopen within 14 days)
    - `support:grant_manage` (strictly SHOP_OWNER)
- **NestJS Support Module (`apps/api/src/support/`)**:
  - `support.controller.ts`: REST endpoints with `SessionGuard`, `RbacGuard`, `@Permissions()`.
  - `support.service.ts`: Business logic, optimistic locking (`version`), context validation, audit logging.
  - `support-storage.service.ts`: Staging presigned upload generation, virus scan verification, attachment linkage, presigned download.
  - `support-context.service.ts`: Consented domain record reader for ORDER, SHIPMENT, STATEMENT, CLAIM, DISCREPANCY with active grant verification and PII masking.
  - DTOs with `class-validator`: `CreateSupportRequestDto`, `CreateSupportReplyDto`, `UpdateSupportStatusDto`, `CreateSupportGrantDto`, `PresignAttachmentUploadDto`, `ScanVerifyAttachmentDto`.
  - Unit and integration tests (`apps/api/src/support/*.spec.ts`).
- **Contracts**:
  - Update `docs/product-spec/contracts/openapi.yaml`.
  - Regenerate client contracts in `packages/contracts/`.
- **Slice A Acceptance**: Passes AC-SUP-01 to AC-SUP-10, AC-SUP-13.

### Slice B — User Interface, Navigation & End-to-End Verification
- **Next.js Pages & Components (`apps/web/src/app/support/`, `apps/web/src/components/support/`)**:
  - `/support` (`SCR-SUP-01`): Paginated request list, status chips, context filters, "Tạo yêu cầu hỗ trợ" button.
  - `/support/new` (`SCR-SUP-02`): Creation form with subject, description, entity context picker, file uploader, optional consent grant toggle.
  - `/support/[id]` (`SCR-SUP-03`): Thread conversation, reply box, optimistic concurrency handling, status badge, context link.
  - Support access consent card (`SCR-SUP-04`): Displays active grant, countdown timer, purpose, and instant "Thu hồi quyền" button for `SHOP_OWNER`.
  - Operator view (`/support/operator` or admin view): Ticket queue, active grant validation badge, transition action buttons.
  - Implementation of all shared states: loading skeleton, empty state, validation summary, error banner, 403 forbidden, 404 not found, partial upload recovery, draft recovery.
- **Navigation**: Add "Hỗ trợ" to primary shell navigation.
- **E2E Acceptance**: Playwright E2E tests in `apps/web/e2e/support.spec.ts` covering AC-SUP-11, AC-SUP-12, AC-SUP-14.

## In scope

1. Persisted support request aggregate with tenant isolation (`merchant_id`), creator tracking, and context linking (`ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`).
2. Multi-party conversation thread (shop replies and operator replies) with timestamped history.
3. Strict state machine transitions (`OPEN` → `IN_PROGRESS` → `WAITING_FOR_SHOP` → `RESOLVED`, with reopen to `OPEN`) protected by optimistic concurrency (`version`).
4. Private attachment upload, virus scan validation, and short-lived presigned URL generation (prohibiting public URLs).
5. Explicit, time-bound, scoped support access grants (`SupportAccessGrant`) created exclusively by `SHOP_OWNER`, with immediate revocation.
6. Server-side RBAC enforcement using live registry permissions (`support:*`).
7. Complete immutable audit trail (`AuditLog`) for all request events, transitions, grants, revocations, and operator data access.
8. Masking of sensitive PII (phone, email, bank details) across all audit logs and error messages.
9. Full UI state coverage (loading, empty, validation, error, forbidden, not found, partial, success, recovery, consent status).
10. OpenAPI schema updates and generated client package synchronization.

## Out of scope

1. External carrier ticket submission or automated carrier claims (covered by carrier integration features).
2. Direct customer COD payout or banking mutation.
3. Permanent or unrestricted operator impersonation.
4. Unconsented platform-admin browsing of shop business records.
5. Push notifications or external SMS/email delivery (deferred until notification center delivery; in-app polling/refreshes used for v1).
6. SLA automation, automatic ticket closure bots, or escalation timers.

## Business rules and edge cases

### Recorded decisions (Operator approval 2026-10-31)

All 9 former planning gaps have been resolved with explicit operator approval on 2026-10-31 and recorded under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`:

#### G01 — Support Request Workflow, Inputs, and Message Policy
- **Context**: Catalog §2 gives only a sentence; Use Cases and Business Rules contain no support flow, inputs or message policy. A complete form and backend cannot be specified.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - `UC-SUP-01` (Create Request): An authenticated shop user submits a request with required `subject` (string, 5–200 characters), required `description` (string, 10–5000 characters), optional `context_type` (`NONE`, `ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`), optional `context_id` (string, validated server-side to belong to caller's `merchant_id`), and optional `attachment_ids` (array of UUIDs; must be previously staged and verified clean by caller's merchant, max 5).
  - `UC-SUP-02` (Reply Thread): Authenticated shop users and operators post replies (string, 1–5000 characters) with optional `attachment_ids` (max 5). All replies are shop-visible; internal private operator notes are excluded from this release. Posting an operator reply sets `author_role = 'SHIPDE_OPERATOR'` and automatically transitions ticket from `OPEN` or `WAITING_FOR_SHOP` to `IN_PROGRESS`.
  - `BR-SUP-01` (Immutability): Once created, the subject, description, and context of a request are immutable. New information must be submitted as replies.
  - `BR-SUP-02` (Context Verification): If `context_id` is supplied, the backend verifies that the entity exists and belongs to the caller's `merchant_id`. Invalid context returns canonical 400 Bad Request (`INVALID_CONTEXT_ENTITY`).

#### G02 — UI Routes, Screen Specifications, and Operator Queue
- **Context**: Screen Specifications and IA route catalog have no support screen ID, tenant route, operator queue or detailed consent surface. Shared states alone do not define the product UX.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Routes approved:
    - `/support` (`SCR-SUP-01`): Shop support dashboard and request list.
    - `/support/new` (`SCR-SUP-02`): Contextual request creation form.
    - `/support/[id]` (`SCR-SUP-03`): Request conversation thread, status banner, context return link, reply input.
    - Support Access Consent Panel (`SCR-SUP-04`): Sub-panel inside `/support/[id]` for viewing active grant status, duration countdown, and "Thu hồi quyền" button.
    - `/support/operator` (`SCR-SUP-05`): Operator request triage queue with grant validation pill and status controls.
  - Shared screen states: full coverage of loading skeleton, empty state, validation summary, error recovery, 403 forbidden, 404 not found, partial upload recovery, and draft recovery.

#### G03 — Request and Access Grant State Machine Lifecycle
- **Context**: State Machines has no request/grant lifecycle; catalog says only “status.” No transition actor, terminal/reopen policy or concurrency behavior exists.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification (`ST-SUP-01`)**:
  - Request Statuses: `OPEN`, `IN_PROGRESS`, `WAITING_FOR_SHOP`, `RESOLVED`.
  - Initial Status: `OPEN` upon creation.
  - Allowed Transitions:
    - `OPEN` → `IN_PROGRESS`: Executed by `SHIPDE_OPERATOR` when taking ownership.
    - `IN_PROGRESS` → `WAITING_FOR_SHOP`: Executed by `SHIPDE_OPERATOR` when requesting shop feedback.
    - `WAITING_FOR_SHOP` → `IN_PROGRESS`: Executed automatically upon shop reply, or manually by operator.
    - `IN_PROGRESS` → `RESOLVED`: Executed by `SHIPDE_OPERATOR` when resolution is provided.
    - `RESOLVED` → `OPEN`: Reopened by shop user (`SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`) within 14 days by submitting a non-empty reply reason. After 14 days, ticket is locked.
  - No automatic closure or silent timeout transitions.
  - Concurrency Control: Optimistic locking using integer `version` field. Stale update returns 409 Conflict (`CONCURRENT_MODIFICATION`).
  - Access Grant Lifecycle: Kept strictly independent: `ACTIVE`, `REVOKED`, `EXPIRED`.

#### G04 — Granular RBAC Capabilities, Roles, Operator Permissions, and Scopes
- **Context**: RBAC matrix has temporary access approval but no support request actions or consent approver. Current registry has neither support capabilities nor a support operator role.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31; amended with explicit operator read/reply permissions and platform tenant scoping).
- **Specification**:
  - Capability permissions added to `apps/api/src/rbac/rbac.constants.ts`:
    - `support:request_create`:
      - Permitted roles: `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`.
      - Tenant scope: Scoped strictly to caller's `session.merchant_id`. Creates ticket with `merchant_id = session.merchant_id`, `creator_id = session.user.id`.
    - `support:request_read`:
      - Permitted roles: `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`, `SHIPDE_OPERATOR` (and `PLATFORM_ADMIN`).
      - Tenant scope:
        - For shop roles: strictly tenant-isolated (`WHERE merchant_id = session.merchant_id`). Attempting to read another tenant's ticket returns 404 Not Found.
        - For `SHIPDE_OPERATOR`: platform-wide support scope. Operators can query `GET /api/v1/support/requests` across all tenants (or filter by `merchant_id`, `status`, `context_type`) to populate the triage queue (`SCR-SUP-05`), and can view ticket metadata, thread history, and diagnostic attachments for any ticket via `GET /api/v1/support/requests/:id`.
        - Security boundary: Ticket read permission (`support:request_read`) allows inspecting only the support conversation thread, metadata, and diagnostic attachments; it confers **zero** default access to underlying shop business records (orders, shipments, statements, claims, discrepancies). Inspecting linked business records via `GET /api/v1/support/requests/:id/context-data` enforces strict dual authorization:
          1. For shop callers: caller must possess both `support:request_read` AND the specific native domain capability corresponding to the ticket's `context_type` (`order:view_create` for `ORDER`, `shipment:track_exceptions` for `SHIPMENT`, `reconciliation:run_review_audit` for `STATEMENT`/`DISCREPANCY`, `claim:verify_submit` for `CLAIM`).
          2. For operator callers: caller must possess `support:request_read` AND an active, unexpired, unrevoked `SupportAccessGrant` issued specifically for that operator by the `SHOP_OWNER`.
    - `support:request_reply`:
      - Permitted roles: `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`, `SHIPDE_OPERATOR` (and `PLATFORM_ADMIN`).
      - Tenant scope:
        - For shop roles: scoped strictly to caller's `session.merchant_id`.
        - For `SHIPDE_OPERATOR`: platform-wide scope. Allowed to reply to any ticket, recorded with `author_role = 'SHIPDE_OPERATOR'`. Posting an operator reply automatically updates ticket status from `WAITING_FOR_SHOP` or `OPEN` to `IN_PROGRESS`.
    - `support:request_transition`:
      - Permitted roles: `SHIPDE_OPERATOR` (to progress/resolve: `OPEN` → `IN_PROGRESS`, `IN_PROGRESS` → `WAITING_FOR_SHOP`, `IN_PROGRESS` → `RESOLVED`) and shop roles (`SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF` to reopen `RESOLVED` → `OPEN` within 14 days with reason).
    - `support:grant_manage`:
      - Permitted roles: strictly `SHOP_OWNER`. Scoped to caller's `merchant_id`. Operators and non-owner shop roles are rejected with 403 Forbidden (`FORBIDDEN_ROLE_RESTRICTED`).
  - Native domain authorization for shop inspection: Shop users calling `GET /api/v1/support/requests/:id/context-data` are evaluated against their tenant roles and permissions; possessing `support:request_read` alone does not bypass shop domain boundaries. Lacking the required domain permission rejects with 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`).
  - Operator business data access: Operator has no default access to shop business records without an active `SupportAccessGrant`. Consented access is executed exclusively through `GET /api/v1/support/requests/:id/context-data` and validated dynamically against active grants.
  - Masking: PII (customer phone, email, recipient street address, bank account numbers) is always masked in audit logs and diagnostic errors. Authorized responses and UI may unmask only when the caller possesses explicit `pii:unmask` capability; this capability never disables audit/log masking.

#### G05 — Private Diagnostic Attachments Contract, Protected Promotion, and Staging Lifecycle
- **Context**: Catalog requires attachments; COM-06 is BACKLOG; Data Dictionary/schema/contract lack generic attachment ownership, permitted MIME/size/count, upload staging, scan verification, and retention. S3 readiness is insufficient.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31; amended with protected clean promotion of the exact scanned bytes via a single staging fetch, immutable version binding, and consistent null-until-commit staging linkage).
- **Specification**:
  - Lifecycle and Ownership:
    1. **Staging Intent (`POST /api/v1/support/attachments/presign-upload`)**:
       - Authenticated shop user (or operator) calls endpoint with `{ file_name, mime_type, file_size, target_request_id? }`.
       - Requires `support:request_create` or `support:request_reply`.
       - If `target_request_id` is supplied (staging attachment intended for a reply to an existing ticket):
         - Backend validates that the target `SupportRequest` exists.
         - For shop users: validates that `ticket.merchant_id == session.merchant_id`. If foreign or nonexistent, returns 404 Not Found.
         - For operator callers: validates that ticket exists and caller holds `support:request_reply`. If nonexistent, returns 404 Not Found.
       - If `target_request_id` is omitted (staging attachment intended for a new ticket creation):
         - Staged attachment has `target_request_id: null`.
       - Backend allocates UUID `attachment_id`, sets S3 staging key `support/staging/{merchant_id}/{attachment_id}/{file_name}`, generates S3 presigned PUT URL (15-minute expiry, strict Content-Type and Content-Length limits), and creates `SupportAttachment` record with:
         - `status: 'STAGED'`
         - `scan_status: 'PENDING'`
         - `merchant_id: session.merchant_id` (or target ticket's `merchant_id` for operator reply attachments)
         - `uploader_id: session.user.id`
         - `request_id: null` (strictly NULL during staging; staging linkage remains null until atomic commit)
         - `reply_id: null` (strictly NULL during staging)
         - `target_request_id: target_request_id ?? null` (records validated target ticket scope)
       - Returns `{ attachment_id, upload_url, file_key, expires_at }`.
    2. **Binary Upload**: Client PUTs raw binary file directly to S3 staging key using the presigned URL.
     3. **Scan Verification & Protected Promotion (`POST /api/v1/support/attachments/:attachmentId/scan-verify`)**:
        - Client confirms upload completion. Backend performs exactly one S3 GET of the staging object `support/staging/{merchant_id}/{attachment_id}/{file_name}` and streams the full object into a bounded in-memory buffer (memory is bounded by the 10 MB per-file limit). A missing object returns 400 Bad Request (`ATTACHMENT_UPLOAD_INCOMPLETE`) and leaves `scan_status: 'PENDING'`.
        - All verification, scanning, hashing and promotion in this step derive exclusively from that single fetched byte buffer. The backend never re-reads the staging key, so a client re-PUT to the staging key (the step-1 presigned PUT remains valid for 15 minutes) landing between the scan and the promotion cannot change the bytes that get promoted.
        - Backend verifies the buffer's actual byte size and MIME magic bytes against declared limits. Mismatch returns 400 Bad Request (`ATTACHMENT_SIZE_MISMATCH` or `ATTACHMENT_MIME_MISMATCH`), retains the staging object, and leaves `scan_status: 'PENDING'`.
        - Backend streams the buffer through antivirus/malware scanner adapter (ClamAV stream) and computes the cryptographic SHA-256 digest (`checksum_sha256`) of that same buffer.
        - If malware detected: sets `status = 'QUARANTINED'`, `scan_status = 'INFECTED'`, `scan_result = 'INFECTED: <signature>'`, permanently deletes file from S3 staging, logs security audit alert, and returns 400 Bad Request (`ATTACHMENT_MALWARE_DETECTED`).
        - If clean (Protected Promotion of the exact scanned bytes):
          - Backend uploads the exact scanned byte buffer — not an S3 server-side copy of the mutable staging key — to protected clean prefix `support/clean/{merchant_id}/{attachment_id}/{file_name}` using platform service credentials. Clients NEVER receive presigned PUT URLs for `support/clean/*`.
          - Backend captures the immutable promoted S3 Object Version ID (`s3_version_id`) from the upload response header (`x-amz-version-id`). A missing version ID aborts the promotion with 500 Internal Server Error (`ATTACHMENT_PROMOTION_INTEGRITY_ERROR`): the clean prefix is versioned and `s3_version_id` is mandatory for linkage.
          - Backend verifies promotion integrity before commit: re-fetches the clean object and confirms its SHA-256 equals the scanned `checksum_sha256`. On mismatch, deletes the clean object, retains the staging object for retry, leaves `scan_status: 'PENDING'`, and returns 500 Internal Server Error (`ATTACHMENT_PROMOTION_INTEGRITY_ERROR`).
          - Backend immediately deletes the staging object at `support/staging/{merchant_id}/{attachment_id}/{file_name}`.
         - Backend atomically updates `SupportAttachment`:
           - `file_key: 'support/clean/{merchant_id}/{attachment_id}/{file_name}'`
           - `checksum_sha256: '<64-character lowercase hex SHA-256>'`
           - `s3_version_id: '<s3_version_id>'`
           - `file_size: actual_bytes`
           - `scan_status: 'CLEAN'`
           - `scan_result: 'CLEAN_VERIFIED'`
           - `scanned_at: now()`
         - Returns 200 OK `{ attachment_id, status: "STAGED", scan_status: "CLEAN", checksum_sha256 }`.
    4. **Atomic Linkage (`POST /api/v1/support/requests` or `POST /api/v1/support/requests/:id/replies`)**:
       - Ticket creation and reply endpoints accept `attachment_ids: string[]` (max 5).
       - Backend enforces:
         a) All IDs exist in `SupportAttachment`.
         b) Staging ownership: `attachment.merchant_id == session.merchant_id` (or for operator replies, `attachment.uploader_id == session.user.id`).
         c) Staged state and target consistency:
            - `status == 'STAGED'` AND `request_id IS NULL` AND `reply_id IS NULL` (strictly enforcing that staging linkage was null, preventing re-attachment or cross-ticket hijacking).
            - For ticket creation (`POST /api/v1/support/requests`): requires `attachment.target_request_id IS NULL` (ensuring attachments staged specifically for an existing ticket reply cannot be attached to a new ticket; rejects with 400 Bad Request `ATTACHMENT_TARGET_MISMATCH`).
            - For reply creation (`POST /api/v1/support/requests/:id/replies`): requires `attachment.target_request_id IS NULL OR attachment.target_request_id == ticket.id` (ensuring attachments targeted for ticket A cannot be linked to ticket B; rejects mismatch with 400 Bad Request `ATTACHMENT_TARGET_MISMATCH`).
         d) Scan and immutability verification:
            - `scan_status == 'CLEAN'`, `checksum_sha256 IS NOT NULL`, `s3_version_id IS NOT NULL`, and `file_key` points to promoted clean path `support/clean/*` (rejects unverified `PENDING` or `INFECTED` attachments with 400 Bad Request `ATTACHMENT_UNVERIFIED_OR_INFECTED`).
       - On success, in a single database transaction updates `request_id = ticket.id` (and `reply_id = reply.id` if reply), sets `target_request_id = ticket.id`, and updates `status = 'ATTACHED'`.
    5. **Immutable Version-Bound Downloads (`GET /api/v1/support/requests/:id/attachments/:fileId`)**:
       - Validates session and `support:request_read` permission (shop user for own tenant, or operator).
       - Resolves `SupportAttachment` record.
       - Generates S3 presigned GET URL pointing to `attachment.file_key` (under `support/clean/`) with explicit version binding: `VersionId: attachment.s3_version_id` and 15-minute expiration.
       - Content-Disposition header sets sanitized original `file_name`.
       - Public S3 URLs are strictly prohibited; downloads are cryptographically and version-bound to the exact byte stream verified by the malware scanner.
  - Constraints: Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`. File size limit: 10 MB per file. File count limit: max 5 attachments per request or reply.
  - Retention & Cleanup: Staged attachments that remain unlinked (`status: 'STAGED'`, `request_id IS NULL`) after 24 hours are permanently purged by an automated background cleanup job. Attached files are retained for 30 days following ticket resolution, then purged in compliance with data retention policy.

#### G06 — Support Access Grant and Consented Inspection Path
- **Context**: RBAC/Actors/Security require consent, scope and expiry, but define no grant identity, maximum duration, revocation, in-flight access behavior or operator authentication. Domain model merely names SupportAccessGrant, and the inspection read path is unspecified.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31; amended with native domain authorization for shop callers and explicit consented inspection path `GET /api/v1/support/requests/:id/context-data`).
- **Specification**:
  - Entity `SupportAccessGrant`: Bound to `request_id`, `merchant_id`, named `operator_id` (User ID), `granted_by` (User ID of `SHOP_OWNER`).
  - Mandatory purpose: String (10–500 characters) describing the diagnostic reason.
  - Expiry: Configurable duration: default 4 hours, maximum 24 hours. Evaluated dynamically on every read request.
  - Instant Revocation: `SHOP_OWNER` can trigger immediate revocation via `DELETE /api/v1/support/requests/:id/grants/:grantId`, setting `status = 'REVOKED'`, `revoked_at = now()`. Any subsequent read by operator immediately fails with 403 Forbidden (`SUPPORT_GRANT_REVOKED`).
  - **Consented Inspection Path (`GET /api/v1/support/requests/:id/context-data`)**:
    - Dedicated read endpoint in support module (`apps/api/src/support/`), eliminating need to modify existing domain controllers.
    - Required base permission: `support:request_read`.
    - Authorization rule:
      - **Shop caller (`session.merchant_id == ticket.merchant_id`)**:
        - Ticket read permission (`support:request_read`) alone is insufficient to view underlying domain records. To view context data, the shop caller MUST also possess the native domain capability corresponding to `ticket.context_type`:
          - `ORDER`: requires `order:view_create`. Lacking it returns 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`, "Yêu cầu quyền order:view_create để xem dữ liệu đơn hàng.").
          - `SHIPMENT`: requires `shipment:track_exceptions`. Lacking it returns 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`, "Yêu cầu quyền shipment:track_exceptions để xem dữ liệu vận đơn.").
          - `STATEMENT`: requires `reconciliation:run_review_audit`. Lacking it returns 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`, "Yêu cầu quyền reconciliation:run_review_audit để xem dữ liệu bảng kê đối soát.").
          - `CLAIM`: requires `claim:verify_submit`. Lacking it returns 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`, "Yêu cầu quyền claim:verify_submit để xem dữ liệu hồ sơ khiếu nại.").
          - `DISCREPANCY`: requires `reconciliation:run_review_audit`. Lacking it returns 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`, "Yêu cầu quyền reconciliation:run_review_audit để xem dữ liệu sai lệch cước.").
          - `NONE`: allowed with `support:request_read`; returns `{ context_type: "NONE", context_id: null, data: null }`.
      - **Operator caller (`session.user.role == 'SHIPDE_OPERATOR'` or `PLATFORM_ADMIN`)**:
        1. Confirms caller has `support:request_read`.
        2. Checks database for active `SupportAccessGrant` on `ticket.id` where `operator_id == session.user.id`.
        3. If grant missing: returns 403 Forbidden (`SUPPORT_GRANT_REQUIRED`, "Yêu cầu cần có quyền truy cập chẩn đoán (SupportAccessGrant) do Chủ cửa hàng phê duyệt.").
        4. If grant `status == 'REVOKED'`: returns 403 Forbidden (`SUPPORT_GRANT_REVOKED`, "Quyền truy cập dữ liệu đã bị Chủ cửa hàng thu hồi.").
        5. If grant `expires_at <= now()`: dynamically updates grant to `EXPIRED` and returns 403 Forbidden (`SUPPORT_GRANT_EXPIRED`, "Quyền truy cập dữ liệu chẩn đoán đã hết hạn.").
    - Response Scope (Strictly Read-Only, scoped to `ticket.context_type` and `ticket.context_id`):
      - `ORDER`: Resolves `Order` with `merchant_id = ticket.merchant_id` and `id = ticket.context_id`. Returns sanitized order data: `{ id, order_code, status, total_amount, shipping_fee, cod_amount, recipient_name, recipient_phone (masked), shipping_address (street masked), carrier_code, items: [{ sku, name, quantity, price }] }`.
      - `SHIPMENT`: Resolves `Shipment` with `id = ticket.context_id`. Returns tracking number, carrier code, parcel weight, dimensions, tracking status events, carrier status code.
      - `STATEMENT`: Resolves carrier statement summary: statement code, carrier code, period start/end, total order count, net settlement amount, discrepancy count.
      - `CLAIM`: Resolves claim file: claim code, carrier code, incident date, claimed amount, status, evidence file list.
      - `DISCREPANCY`: Resolves fee discrepancy: discrepancy code, tracking number, type, expected amount, billed amount, difference amount.
      - `NONE`: Returns `{ context_type: "NONE", context_id: null, data: null }`.
    - PII Protection: Recipient phone (`098***1234`), email, and street address are masked by default for both shop and operator callers. Unmasked data is returned only if the caller holds explicit `pii:unmask` capability.
    - Audit Trail: Every operator read of `/context-data` writes an immutable `AuditLog` entry with `action: 'SUPPORT_OPERATOR_ACCESS'`, `merchant_id: ticket.merchant_id`, `actor_id: session.user.id`, `reason: grant.purpose`, `details: { grant_id: grant.id, context_type: ticket.context_type, context_id: ticket.context_id }`. Transaction fails if audit logging fails (fail-closed).

#### G07 — Dependency Architecture and Vertical Slicing
- **Context**: FEAT-SUP-01 promises consented access at order 29 while SEC-02 defines support access at order 134/later admin slice. Generic register dependencies name only foundation; no support mock is approved.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - The delivery is decoupled from full platform-wide administrative impersonation (`FEAT-SEC-02`).
  - `FEAT-SUP-01` delivers request-bound consent grant data modeling, authorization checks, dedicated consented inspection endpoint `GET /api/v1/support/requests/:id/context-data`, and UI toggle in Slice A and Slice B.
  - One Work Item per PR; no placeholder or disabled buttons without real backing functionality.

#### G08 — Internal API Contracts, Data Schemas, Canonical Errors, and Idempotency
- **Context**: Internal API/OpenAPI and data schemas lack request/reply/context/grant commands, schemas, errors, event contracts and retention. Conceptual tenant_id and implemented merchant_id need an explicit feature mapping.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Tenant mapping: Conceptual `tenant_id` maps strictly to `merchant_id` (`@db.Uuid` referencing `Merchant`).
  - REST Endpoints under `/api/v1/support`:
    - `POST /api/v1/support/requests`: Create request. Supports `Idempotency-Key` header (24-hour replay cache).
    - `GET /api/v1/support/requests`: List requests (shop roles scoped to `merchant_id`; `SHIPDE_OPERATOR` platform triage queue; filters: `status`, `context_type`, pagination: `limit`, `offset`).
    - `GET /api/v1/support/requests/:id`: Get request detail, reply history, attachments, and grant status.
    - `POST /api/v1/support/requests/:id/replies`: Post a reply (shop roles and `SHIPDE_OPERATOR`).
    - `PATCH /api/v1/support/requests/:id/status`: Update status (body: `{ status, version, reason }`).
    - `POST /api/v1/support/requests/:id/grants`: Create support access grant (restricted to `SHOP_OWNER`).
    - `DELETE /api/v1/support/requests/:id/grants/:grantId`: Revoke support access grant (restricted to `SHOP_OWNER`).
    - `POST /api/v1/support/attachments/presign-upload`: Generate presigned S3 upload URL for staging attachment before ticket creation or reply (under `support/staging/*`, with optional `target_request_id` and null linkage).
    - `POST /api/v1/support/attachments/:attachmentId/scan-verify`: Confirm upload, execute synchronous malware scan verification, execute protected promotion to immutable storage (`support/clean/*`) with SHA-256 and S3 version ID capture, and delete staging object.
    - `GET /api/v1/support/requests/:id/attachments/:fileId`: Generate temporary 15-minute presigned download URL for private attachment bound to promoted immutable S3 `versionId`.
    - `GET /api/v1/support/requests/:id/context-data`: Read-only inspection of linked business entity with dual authorization (native domain permissions for shop roles, active consent grant for operators), PII masking, and audit logging.
  - Canonical errors: 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict.
  - Concurrency & Idempotency: `version` increment on update; duplicate idempotency key with identical payload returns cached result; duplicate key with altered payload returns 409 Conflict (`IDEMPOTENCY_CONFLICT`).

#### G09 — Acceptance Traceability, Synthetic Datasets, and Notification Boundary
- **Context**: Traceability/Acceptance/Test Data lack support IDs, golden examples and UAT; Notifications has no support audience/channel/SLA policy. Existing outbox dispatch is smoke-only.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Acceptance matrix covers AC-SUP-01 to AC-SUP-14 with synthetic test data (Tenant A and Tenant B fixtures).
  - Traceability mapping: `UC-SUP-01/02`, `BR-SUP-01..05`, `SCR-SUP-01..04`, `API-SUP-01..06`, `ENT-SUP-01..03`, `ST-SUP-01`.
  - Notifications boundary: v1 relies on in-app UI state polling/refresh. External SMS/email and automated SLA guarantees are excluded until dedicated notification center delivery.

## UI states

The table below defines the required observable behavior across all support screens (`/support`, `/support/new`, `/support/:id`, `/support/operator`):

| State                          | Observable UI behavior and copy requirements                                                                                                                                                                                                               | Recovery and accessibility behavior                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading                        | Render accessible table/card skeletons. On form submission, primary button shows spinning indicator, label updates to "Đang gửi yêu cầu...", and duplicate submits are locked.                                                                           | `aria-busy="true"`, focus locked in modal/form, announce state to screen readers.                                                               |
| Empty                          | Display centered illustration, title "Chưa có yêu cầu hỗ trợ nào", description "Tạo yêu cầu mới khi bạn cần trợ giúp kỹ thuật hoặc vận hành từ đội ngũ Ship Dễ", and primary action button "Tạo yêu cầu hỗ trợ".                                      | Clear keyboard focus on primary action button.                                                                                                   |
| Validation                     | Inline field error messages below invalid inputs (e.g. "Tiêu đề phải từ 5 đến 200 ký tự", "Mô tả phải từ 10 đến 5000 ký tự", "Tệp đính kèm vượt quá 10MB"). Form summary alert displayed at top. Valid inputs are preserved.                           | Move focus to the first invalid field or top error summary banner; announce error counts.                                                        |
| Error                          | Dismissible alert banner: "Không thể gửi yêu cầu hỗ trợ. Vui lòng kiểm tra lại kết nối và thử lại." Includes "Thử lại" action button. Never displays false success toast on API failure.                                                                  | Error logged to console/monitoring without PII; inputs remain intact for retry.                                                                  |
| Forbidden                      | Full-page or inline 403 banner: "Bạn không có quyền truy cập vào yêu cầu hỗ trợ này." When non-owners attempt consent management, the grant button is hidden with an informative tooltip: "Chỉ Chủ cửa hàng (SHOP_OWNER) mới có quyền cấp quyền truy cập." | Screen reader announcement; navigation link to return to `/support` dashboard.                                                                   |
| Not found                      | 404 message: "Yêu cầu hỗ trợ không tồn tại hoặc đã bị xóa." When a user manipulates an ID belonging to another tenant, a generic 404 is returned to prevent tenant enumeration.                                                                          | Navigation button "Quay lại danh sách yêu cầu".                                                                                                  |
| Partial                        | When 1 of multiple attachments fails upload or scan, mark the failed file with red badge "Tải lên thất bại: tệp không hợp lệ", while retaining successfully uploaded attachments. Provide retry/remove action for failed file.                             | Prevents form submission until failed attachment is either removed or re-uploaded successfully.                                                   |
| Success                        | Toast notification: "Yêu cầu hỗ trợ đã được tạo thành công (#SUP-XXXXX)". Form resets; UI redirects to ticket detail view showing ticket summary, initial status badge "Mới tiếp nhận", and active thread.                                               | `aria-live="polite"` announcement; focus moved to ticket heading.                                                                                |
| Recovery                       | If network drops or session expires during form completion, preserve unsubmitted inputs in session draft. After re-login, restore draft text and alert user: "Bản nháp đã được khôi phục". If 409 conflict occurs, prompt "Dữ liệu đã thay đổi. Tải lại." | Stored drafts are tenant-isolated and cleared upon successful commit.                                                                           |
| Consent absent/expired/revoked | Ticket detail displays consent pill: "Chưa cấp quyền", "Đang hoạt động (còn X giờ)", "Đã thu hồi", or "Đã hết hạn". Operator view displays warning banner: "Cửa hàng chưa cấp quyền truy cập dữ liệu. Bạn chỉ có thể xem nội dung yêu cầu hỗ trợ."     | `SHOP_OWNER` can click "Cấp quyền truy cập (4 giờ)" or "Thu hồi quyền" with instant confirmation modal. Screen readers announce consent changes. |

## API, event and data impact

### Prisma Schema Entities

The following additive models are defined in `prisma/schema.prisma`:

```prisma
enum SupportRequestStatusEnum {
  OPEN
  IN_PROGRESS
  WAITING_FOR_SHOP
  RESOLVED
}

enum SupportContextTypeEnum {
  NONE
  ORDER
  SHIPMENT
  STATEMENT
  CLAIM
  DISCREPANCY
}

enum SupportGrantStatusEnum {
  ACTIVE
  REVOKED
  EXPIRED
}

enum SupportAttachmentStatusEnum {
  STAGED
  ATTACHED
  QUARANTINED
  EXPIRED
}

enum SupportAttachmentScanStatusEnum {
  PENDING
  CLEAN
  INFECTED
  REJECTED
}

model SupportRequest {
  id           String                   @id @default(uuid()) @db.Uuid
  merchant_id  String                   @db.Uuid
  creator_id   String                   @db.Uuid
  subject      String                   @db.VarChar(200)
  description  String                   @db.Text
  status       SupportRequestStatusEnum @default(OPEN)
  context_type SupportContextTypeEnum   @default(NONE)
  context_id   String?                  @db.VarChar(255)
  version      Int                      @default(1)
  created_at   DateTime                 @default(now()) @db.Timestamptz
  updated_at   DateTime                 @updated_at @db.Timestamptz

  merchant     Merchant                 @relation(fields: [merchant_id], references: [id], onDelete: Cascade)
  creator      User                     @relation(fields: [creator_id], references: [id], onDelete: Restrict)
  replies      SupportReply[]
  attachments  SupportAttachment[]
  grants       SupportAccessGrant[]

  @@index([merchant_id, status])
  @@index([merchant_id, created_at])
  @@index([context_type, context_id])
  @@map("support_requests")
}

model SupportReply {
  id          String                   @id @default(uuid()) @db.Uuid
  request_id  String                   @db.Uuid
  merchant_id String                   @db.Uuid
  author_id   String                   @db.Uuid
  author_role String                   @db.VarChar(64)
  message     String                   @db.Text
  created_at  DateTime                 @default(now()) @db.Timestamptz

  request     SupportRequest           @relation(fields: [request_id], references: [id], onDelete: Cascade)
  merchant    Merchant                 @relation(fields: [merchant_id], references: [id], onDelete: Cascade)
  author      User                     @relation(fields: [author_id], references: [id], onDelete: Restrict)
  attachments SupportAttachment[]

  @@index([request_id, created_at])
  @@map("support_replies")
}

model SupportAttachment {
  id                String                          @id @default(uuid()) @db.Uuid
  request_id        String?                         @db.Uuid
  reply_id          String?                         @db.Uuid
  target_request_id String?                         @db.Uuid
  merchant_id       String                          @db.Uuid
  uploader_id       String                          @db.Uuid
  file_key          String                          @db.VarChar(512)
  file_name         String                          @db.VarChar(255)
  file_size         Int
  mime_type         String                          @db.VarChar(128)
  checksum_sha256   String?                         @db.VarChar(64)
  s3_version_id     String?                         @db.VarChar(128)
  status            SupportAttachmentStatusEnum     @default(STAGED)
  scan_status       SupportAttachmentScanStatusEnum @default(PENDING)
  scan_result       String?                         @db.VarChar(255)
  scanned_at        DateTime?                       @db.Timestamptz
  created_at        DateTime                        @default(now()) @db.Timestamptz

  request           SupportRequest?                 @relation(fields: [request_id], references: [id], onDelete: Cascade)
  reply             SupportReply?                   @relation(fields: [reply_id], references: [id], onDelete: Cascade)
  merchant          Merchant                        @relation(fields: [merchant_id], references: [id], onDelete: Cascade)
  uploader          User                            @relation("SupportAttachmentUploader", fields: [uploader_id], references: [id], onDelete: Restrict)

  @@index([request_id])
  @@index([target_request_id])
  @@index([merchant_id, status])
  @@index([uploader_id, status])
  @@map("support_attachments")
}

model SupportAccessGrant {
  id          String                   @id @default(uuid()) @db.Uuid
  request_id  String                   @db.Uuid
  merchant_id String                   @db.Uuid
  operator_id String                   @db.Uuid
  granted_by  String                   @db.Uuid
  purpose     String                   @db.Text
  scope       Json
  status      SupportGrantStatusEnum   @default(ACTIVE)
  expires_at  DateTime                 @db.Timestamptz
  revoked_at  DateTime?                @db.Timestamptz
  created_at  DateTime                 @default(now()) @db.Timestamptz

  request     SupportRequest           @relation(fields: [request_id], references: [id], onDelete: Cascade)
  merchant    Merchant                 @relation(fields: [merchant_id], references: [id], onDelete: Cascade)
  operator    User                     @relation("SupportOperator", fields: [operator_id], references: [id], onDelete: Restrict)
  granter     User                     @relation("SupportGranter", fields: [granted_by], references: [id], onDelete: Restrict)

  @@index([merchant_id, status, expires_at])
  @@index([operator_id, status, expires_at])
  @@index([request_id, operator_id, status])
  @@map("support_access_grants")
}
```

### Internal REST API Endpoints

| Method   | Path                                                | Required Permission                                 | Description                                                                                                                                                                                                                                  | Status Codes                 |
| -------- | --------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `POST`   | `/api/v1/support/requests`                          | `support:request_create`                            | Create a new contextual support request with optional pre-staged verified clean `attachment_ids`. Supports `Idempotency-Key`. Scoped to caller's `merchant_id`.                                                                             | 201, 400, 401, 403, 409      |
| `GET`    | `/api/v1/support/requests`                          | `support:request_read`                              | List support requests. For shop roles, strictly tenant-scoped (`merchant_id`). For `SHIPDE_OPERATOR`, platform-wide triage queue (`SCR-SUP-05`) with filters (`status`, `context_type`, `merchant_id`) and pagination (`limit`, `offset`).| 200, 401, 403                |
| `GET`    | `/api/v1/support/requests/:id`                      | `support:request_read`                              | Get full request detail, message thread, attachments, and consent grant status. Accessible by ticket merchant and `SHIPDE_OPERATOR`.                                                                                                         | 200, 401, 403, 404           |
| `POST`   | `/api/v1/support/requests/:id/replies`              | `support:request_reply`                             | Append a reply to the ticket thread. Permitted for shop roles (own tenant) and `SHIPDE_OPERATOR` (platform). Automatically advances `OPEN` or `WAITING_FOR_SHOP` → `IN_PROGRESS` on operator reply. Supports optional `attachment_ids`.    | 201, 400, 401, 403, 404      |
| `PATCH`  | `/api/v1/support/requests/:id/status`               | `support:request_transition`                        | Update ticket status. Requires matching optimistic `version`. Permitted for `SHIPDE_OPERATOR` (progress/resolve) and shop roles (reopen within 14 days).                                                                                  | 200, 400, 401, 403, 409      |
| `POST`   | `/api/v1/support/requests/:id/grants`               | `support:grant_manage`                              | Grant temporary read-only support access to named operator. Restricted strictly to `SHOP_OWNER`.                                                                                                                                             | 201, 400, 401, 403, 404      |
| `DELETE` | `/api/v1/support/requests/:id/grants/:grantId`      | `support:grant_manage`                              | Revoke active support access grant immediately. Restricted strictly to `SHOP_OWNER`. Operator inspection cut off instantly.                                                                                                                  | 200, 401, 403, 404           |
| `POST`   | `/api/v1/support/attachments/presign-upload`        | `support:request_create` or `support:request_reply` | Request presigned S3 PUT URL to stage private diagnostic attachment under `support/staging/*` prior to ticket or reply creation. Accepts optional `target_request_id` for reply attachments. Keeps `request_id` and `reply_id` strictly null until commit. Enforces MIME/size limits and records staging ownership. | 201, 400, 401, 403           |
| `POST`   | `/api/v1/support/attachments/:attachmentId/scan-verify` | `support:request_create` or `support:request_reply` | Confirm direct upload completion, fetch the staging object exactly once, stream the fetched bytes through malware scanner, compute SHA-256 digest of the same bytes, promote exactly those scanned bytes to clean storage prefix `support/clean/*` (platform credentials; never a server-side copy of the mutable staging key) with post-upload digest verification and immutable S3 version binding, and delete staging object. Updates scan status to `CLEAN` or quarantines infected files. Required before attachment linkage. | 200, 400, 401, 403, 404, 500 |
| `GET`    | `/api/v1/support/requests/:id/attachments/:fileId`  | `support:request_read`                              | Generate temporary 15-minute presigned download URL for private attachment, binding to promoted immutable S3 `versionId`. Validates tenant session or operator ticket access.                                                               | 200, 401, 403, 404           |
| `GET`    | `/api/v1/support/requests/:id/context-data`         | `support:request_read` plus native domain capability (`order:view_create`, `shipment:track_exceptions`, `reconciliation:run_review_audit`, `claim:verify_submit`) for shop roles; active `SupportAccessGrant` for `SHIPDE_OPERATOR` | Consented read-only inspection of linked business entity (`ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`). Validates native domain permissions for shop users, and active unexpired unrevoked consent grant for operators. Returns masked PII; logs `SUPPORT_OPERATOR_ACCESS`. | 200, 400, 401, 403, 404      |

### Audit Logging Requirements

Every mutation generates an immutable `AuditLog` entry in PostgreSQL:
- Actions: `SUPPORT_REQUEST_CREATE`, `SUPPORT_REPLY_ADD`, `SUPPORT_STATUS_TRANSITION`, `SUPPORT_GRANT_CREATE`, `SUPPORT_GRANT_REVOKE`, `SUPPORT_OPERATOR_ACCESS`.
- Payload: `merchant_id`, `user_id`, `actor`, `action`, `entity_type` (`SupportRequest`, `SupportAccessGrant`), `entity_id`, `old_value` (sanitized), `new_value` (sanitized), `reason`.
- PII Protection: All recipient phone numbers, email addresses, and financial account numbers are masked before persisting to `AuditLog`. Attachment bytes and secrets are never logged.

## Acceptance matrix

All 14 rows below remain mandatory implementation acceptance criteria. This documentation repair preserves their approved scenarios and expected results; it does not establish a runtime PASS. The support API, database, storage and browser tests must run after implementation, and the inherited-content checks must pass before author handoff.

| AC/Test ID              | Scenario                                                                                                                                           | Expected Result                                                                                                                                                       | Evidence Required                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-SUP-01 / TEST-SUP-01 | Authorized shop user (`SHOP_ADMIN` or `SHOP_OWNER`) submits a valid support request with subject, description, and valid order context ID.         | Request persists in database with status `OPEN`, `version: 1`, linked `merchant_id`, and appears immediately in tenant request list.                                  | API integration test in `support.controller.spec.ts`; DB assertion verifying tenant scoping and fields.                       |
| AC-SUP-02 / TEST-SUP-02 | Shop user submits request with missing subject (< 5 chars), description (< 10 chars), or context entity belonging to a different merchant.         | API rejects with 400 Bad Request and canonical error code (`VALIDATION_ERROR` or `INVALID_CONTEXT_ENTITY`). No records created; valid inputs preserved in UI.       | Controller validation test; DTO unit tests with `class-validator`.                                                            |
| AC-SUP-03 / TEST-SUP-03 | Concurrent create requests sent with identical `Idempotency-Key` header; or identical key replayed with modified payload.                         | Identical payload returns cached 201 response with identical request ID. Modified payload returns 409 Conflict (`IDEMPOTENCY_CONFLICT`). Single record in database.   | Concurrency and replay integration test in `support.service.spec.ts`.                                                         |
| AC-SUP-04 / TEST-SUP-04 | Operator transitions ticket `OPEN` → `IN_PROGRESS` → `RESOLVED`; shop user attempts invalid skip `OPEN` → `RESOLVED` or stale version update.    | Permitted transitions succeed and update `version`; invalid transition returns 400 Bad Request; stale version update returns 409 Conflict (`CONCURRENT_MODIFICATION`).| State machine transition unit test; optimistic concurrency test in `support.service.spec.ts`.                                 |
| AC-SUP-05 / TEST-SUP-05 | Tenant A authenticated user attempts to read, reply, transition, or download attachments belonging to Tenant B's support request.                 | API rejects with 404 Not Found (or 403 Forbidden). Zero Tenant B metadata or files disclosed. Security violation logged to `AuditLog`.                                | Multi-tenant isolation test using synthetic Tenant A and Tenant B fixtures in `support.controller.spec.ts`.                  |
| AC-SUP-06 / TEST-SUP-06 | User lacking required support capability or operator attempting out-of-scope action; shop user lacking native domain capability attempting context inspection; or user with expired/revoked session calls support endpoints. | API rejects with 401 Unauthorized or 403 Forbidden (`FORBIDDEN_PERMISSION_REQUIRED` or `FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`). Database remains unchanged. | RBAC guard and session integration tests in `apps/api/src/support/support.rbac.spec.ts`.                                      |
| AC-SUP-07 / TEST-SUP-07 | Ship Dễ operator attempts to inspect Tenant A order context via `GET /api/v1/support/requests/:id/context-data` without an active consent grant; then inspects after grant is issued; then after it expires or is revoked. Shop user without `order:view_create` attempts order context inspection. | Without grant: 403 Forbidden (`SUPPORT_GRANT_REQUIRED`). With active grant: 200 OK (read-only order data, masked PII, audited under `SUPPORT_OPERATOR_ACCESS`). After expiration/revocation: immediate 403 Forbidden (`SUPPORT_GRANT_EXPIRED` or `SUPPORT_GRANT_REVOKED`). Shop user lacking domain permission: 403 Forbidden (`FORBIDDEN_DOMAIN_PERMISSION_REQUIRED`). | Time-travel / clock-mocked integration test verifying grant status check and domain capability checks in `support.grant.spec.ts`. |
| AC-SUP-08 / TEST-SUP-08 | `SHOP_OWNER` grants support access for 4 hours to named operator; non-owner role (`SHOP_STAFF`) attempts to grant or revoke access; `SHOP_OWNER` revokes active grant. | `SHOP_OWNER` grant call succeeds (201 Created); `SHOP_STAFF` call is rejected with 403 Forbidden (`FORBIDDEN_ROLE_RESTRICTED`). `SHOP_OWNER` revocation call succeeds (200 OK), sets grant to `REVOKED`, and cuts off operator inspection immediately. | RBAC capability test asserting `support:grant_manage` strictly restricted to `SHOP_OWNER`.                                    |
| AC-SUP-09 / TEST-SUP-09 | Shop user stages 1 clean PDF and 1 infected file via `POST /api/v1/support/attachments/presign-upload` and `POST /api/v1/support/attachments/:attachmentId/scan-verify`; attempts to link both to a new support request; attempts to overwrite clean file key with late PUT; while scan-verify is processing the clean PDF, a concurrent client re-PUT replaces the staging object with different bytes (EICAR test signature) after the single staging fetch and before the clean upload completes (injected at the storage adapter seam); attempts to link reply attachment with mismatched `target_request_id`. | Infected file fails scan verification (400 Bad Request `ATTACHMENT_MALWARE_DETECTED`), quarantined and deleted from S3 staging, rejected from linkage. Clean PDF passes scan (`CLEAN`), its exact scanned bytes are promoted to `support/clean/*` with SHA-256 and `s3_version_id` captured, staging object deleted. The between-scan-and-promotion overwrite cannot alter promotion: the stored clean object is byte-identical to the fetched and scanned bytes (its SHA-256 equals the stored `checksum_sha256`), the EICAR bytes are absent from `support/clean/*`, and the stored `s3_version_id` resolves to the clean object whose content hashes to `checksum_sha256`. Subsequent late PUT to staging does not affect clean storage. Mismatched `target_request_id` rejected with 400 Bad Request `ATTACHMENT_TARGET_MISMATCH`. Clean PDF successfully linked to ticket upon creation. Presigned download URL generated binding to immutable `versionId` with 15-minute expiration; public S3 access denied. | Storage service integration test with mock scanner, late upload test, between-scan-and-promotion overwrite test (staging re-PUT injected between the single staging fetch and the clean upload, asserting promoted bytes equal scanned bytes), and presigned URL authorization test. |
| AC-SUP-10 / TEST-SUP-10 | Audit log assertions across ticket creation, status change, consent grant, and operator data access.                                              | All events present in `audit_logs` table with timestamp, `merchant_id`, actor ID, correlation ID, and masked PII. Audit write failure aborts transaction.            | Transactional audit logging test in `support.service.spec.ts`.                                                                |
| AC-SUP-11 / TEST-SUP-11 | UI state coverage on `/support`, `/support/new`, `/support/[id]`: loading, empty, validation error, server error, forbidden, not found, success. | Every shared UI state renders correctly, keyboard focus is accessible, WCAG AA contrast met, and primary actions are fully interactive.                            | Component tests in `apps/web/src/components/support/*.spec.tsx` and Storybook/Playwright accessibility checks.               |
| AC-SUP-12 / TEST-SUP-12 | Network interruption or session expiration while editing a support request draft.                                                                  | Form preserves entered subject, description, and context selection in session storage. Re-authenticating restores draft with prompt to continue.                      | Playwright browser offline/relogin recovery test in `apps/web/e2e/support.spec.ts`.                                            |
| AC-SUP-13 / TEST-SUP-13 | Prisma migration execution and OpenAPI contract verification.                                                                                      | Schema migration applies cleanly to PostgreSQL without data loss. `scripts/verify-contracts.ts` confirms 0 drift between OpenAPI spec and generated client.          | `pnpm db:migrate` and `pnpm contract:check` execution in CI pipeline.                                                         |
| AC-SUP-14 / TEST-SUP-14 | End-to-end customer journey: shop user stages attachment (null linkage, `target_request_id` validated) → scan-verify promotes to clean storage with SHA-256 and `s3_version_id` → creates contextual ticket linking attachment → operator views ticket in triage queue via `GET /api/v1/support/requests` → operator posts reply → shop owner grants consent to operator → operator inspects linked business record via `GET /api/v1/support/requests/:id/context-data` → operator resolves ticket. | Full journey completes with real database persistence, correct UI state transitions, live consent countdown, verified audit trail (`SUPPORT_OPERATOR_ACCESS`), and successful ticket resolution. | Playwright E2E customer journey test in `apps/web/e2e/support.spec.ts`.                                                        |

## Verification commands

Execute the following commands from the repository root:

```powershell
# 1. Monorepo dependencies and database preparation
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:migrate

# 2. Slice A: Backend Support Module & RBAC Tests
pnpm --filter api test apps/api/src/support/
pnpm --filter api test apps/api/src/rbac/

# 3. Contract Drift & Static Analysis
pnpm contract:check
pnpm lint
pnpm typecheck
pnpm format:check
node scripts/ai/check-no-hardcode.mjs

# 4. Slice B: Frontend Components, Accessibility & E2E Acceptance
pnpm --filter web test
pnpm exec tsx scripts/verify-a11y.ts
pnpm test:e2e -- apps/web/e2e/support.spec.ts

# 5. Production Build Verification
pnpm build
```

## Definition of Ready assessment

| Gate                                           | Result | Notes                                                                                                                  |
| ---------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Feature ID and outcome                         | PASS   | Present in catalog (`FEAT-SUP-01`); outcome explicitly defined for shop users and operators.                           |
| Use-case/rule/screen IDs and actor permissions | PASS   | `UC-SUP-01/02`, `BR-SUP-01..05`, `SCR-SUP-01..05`, and granular RBAC capabilities approved under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`. |
| Preconditions, inputs/outputs/errors           | PASS   | Exact field lengths, context enums, and canonical 400/401/403/404/409 errors specified.                                |
| Valid state transitions                        | PASS   | State machine `ST-SUP-01` fully specified with optimistic concurrency control (`version`).                              |
| Entity/API contract                            | PASS   | Prisma models, REST endpoints, and OpenAPI schemas fully detailed; tenant mapped to `merchant_id`.                     |
| External capability/fallback                   | PASS   | COM-06 private attachment contract approved with presigned URLs; no third-party carrier ticket dependency.             |
| Acceptance and test data                       | PASS   | AC-SUP-01 to AC-SUP-14 defined with synthetic Tenant A and Tenant B fixtures.                                          |
| Dependency complete or approved mock           | PASS   | Foundation merged; vertical slice strategy separates Slice A (API/Data) and Slice B (UI).                              |
| No high-impact unresolved decision             | PASS   | All gaps G01–G09 resolved with Operator approval 2026-10-31.                                                           |

Handoff instruction for GEMINI: Read `AGENTS.md`, this Work Item, and `FEATURE-DELIVERY-REGISTER.csv` on branch `feat/feat-sup-01`. The product-planning status is `READY_FOR_AUTHOR`; implementation may begin after the planning PR receives an independent PASS and is merged with all inherited-content checks passing. Then implement Slice A (API, Data, Contracts, RBAC) followed by Slice B (UI, Navigation, E2E). Strictly enforce tenant scoping on `merchant_id`, zero hardcodes, and masked PII.

## Codex review record

| Review round | Commit                   | Verdict            | Review evidence and repair state                                                     |
| ------------ | ------------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| Planning     | Planning finalization    | READY_FOR_AUTHOR   | All planning gaps G01–G09 resolved with operator approval on 2026-10-31. Work Item complete and implementable. |
| Review Round 1 | 368667aa               | CHANGES_REQUIRED   | P1 findings 1–3 raised regarding operator read/reply authorization, attachment upload staging contract, and consented inspection read path. |
| Review Round 2 | 87e6dcb1               | CHANGES_REQUIRED   | P1 #1 & #3 confirmed resolved. P1 #2 not fully resolved (contradiction in reply staging linkage). New P1 #4 raised (clean scan results not bound to immutable file contents, late overwrite vulnerability). New P1 #5 raised (shop inspection on /context-data bypasses native business-record domain permissions). |
| Review Round 3 | c8f43e5c               | CHANGES_REQUIRED   | Round 3 review (reviewed SHA c8f43e5c) left P1 #4 (scan-to-copy race) open and raised a new P1: the delta deleted/regressed the approved FEAT-COM-09 handoff (branch-behind-main drift). Previously resolved P1s (#2, #5) confirmed still resolved; carrier-scope P1 confirmed void for this delta. |
| Review Round 4 repair | debe5ab99 | READY_FOR_CODEX    | Resolved both open P1 findings from the Round 3 review: (1) Scan-to-copy race closed — `scan-verify` now performs exactly one S3 GET of the staging object and derives verification, scanning, hashing, and promotion exclusively from that single fetched byte buffer; it promotes exactly the scanned bytes to `support/clean/*` via platform-credential upload (never a server-side copy of the mutable staging key), captures `s3_version_id` from the upload response, and verifies post-upload SHA-256 integrity before commit (fail-closed `ATTACHMENT_PROMOTION_INTEGRITY_ERROR`); AC-SUP-09/TEST-SUP-09 extended with a between-scan-and-promotion overwrite test (staging re-PUT injected after the single fetch and before the clean upload must not reach `support/clean/*`). (2) FEAT-COM-09 handoff regression repaired — merged `origin/main` and restored the approved FEAT-COM-09 artifacts byte-identical to main (Work Item file, `HUMAN-DECISION-FEAT-COM-09-2026-10-31`, TRACEABILITY row, register row `READY_FOR_AUTHOR` with branch `feat/feat-com-09`); the register keeps exactly one row per Work Item, with the FEAT-SUP-01 row at `READY_FOR_AUTHOR` on branch `feat/feat-sup-01`. |
| Review Round 4 independent | debe5ab99ab0d1b8a4d32abb3a0dae3c1043f0cd | CHANGES_REQUIRED | Latest `.oc/review.txt`: carrier-removal P1 remains open; scan-to-copy and notification-handoff findings confirmed resolved; no new P0/P1. The preservation contract is prepared below the author boundary; main synchronization remains blocked as recorded under Known limitations. |

## Local repair verification (2026-11-02)

The current independent review is `.oc/review.txt`, reviewed commit `debe5ab99ab0d1b8a4d32abb3a0dae3c1043f0cd`. `.oc/history.md` is absent; the earlier review records above remain intact. Comparisons in this repair use the locally available `origin/main` at `c6e71fcb9354cd2b14d1f5dcaed794abff306991`; fetching its latest remote state is blocked.

| Review item | Verification | Current result |
|---|---|---|
| Carrier-removal P1 | `git merge-base --is-ancestor origin/main HEAD`; inherited implementation/Work Item equality; register comparison by Work Item ID | FAIL in HEAD: main is not an ancestor, carrier files/history differ, and the committed carrier row is regressed. The working register already preserves every main row except this support item, with no duplicate Work Item IDs; this alone does not close the P1. |
| Scan-to-copy P1, previously resolved | Compare G05 and AC-SUP-09 verbatim against the independently reviewed commit | PASS for planning-contract preservation, including the single fetched buffer, protected promotion, immutable version and overwrite assertions. Runtime verification remains pending. |
| Notification-handoff P1, previously resolved | Compare FEAT-COM-09 Work Item, decision, register row and traceability to local main in HEAD and the working tree | PASS: inherited artifacts are preserved. |
| All acceptance rows | Compare AC-SUP-01 through AC-SUP-14 verbatim against the independently reviewed commit | PASS for preservation of all 14 rows; functional acceptance is NOT RUN. |
| Required local checks | `pnpm.cmd lint`; `pnpm.cmd typecheck`; `git diff --check origin/main...HEAD`; `git diff --check` | PASS. Lint/typecheck each completed 12 tasks. `pnpm test` is blocked before execution by the required Docker prerequisite. |

The cross-cutting checks below apply to the existing acceptance rows and derive from the linked RBAC matrix, data model, Internal API, security and UI specifications. They introduce no new role grants or product decisions. An author must include HTTP-level negative tests where an endpoint is involved; a document-preservation assertion cannot satisfy them.

| Category | Required implementation verification |
|---|---|
| Tenant scope and RBAC | AC-SUP-05/06/07: evaluate `merchant_id` and native branch/store, warehouse and carrier-account scope on **every** context type at `GET /api/v1/support/requests/:id/context-data`. A matching domain capability alone cannot override denied resource scope; empty assignments must not become wildcard access. Test same-tenant out-of-scope records and foreign-tenant IDs, with no business data returned. Keep G04's explicit operator ticket queue separate from G06's named, request-bound consent checks. |
| Forbidden and validation paths | AC-SUP-02/05/06/08/09: send requests through HTTP guards/DTO validation for missing permissions, expired/revoked sessions, non-owner consent management, foreign attachments and invalid input; assert canonical errors, no unauthorized data and no business mutation. |
| Integer VND | AC-SUP-07/13: every financial context amount and item price follows Internal API/domain integer-VND rules. No floating-point money calculation, rounding or reinterpretation of suspected/verified/accepted/bank-received evidence is permitted. |
| Idempotency and concurrency | AC-SUP-03/04: concurrent identical create keys produce one ticket; changed payloads conflict; stale versions reject without overwriting state. Replay lookup remains tenant-scoped. |
| Audit and PII | AC-SUP-05/07/10: failed audit writes fail closed; audit/log/error evidence never contains attachment bytes, secrets or unmasked recipient/bank data. G06's explicit `pii:unmask` capability applies to authorized response/UI access, never to diagnostic logs or audit payloads. |
| UI and recovery | AC-SUP-11/12/14 and the UI-state table: include `/support/operator`, partial upload recovery, consent expiry/revocation, keyboard/focus behavior, forbidden/not-found and tenant-isolated draft recovery. No success state before a committed API outcome. |

## Known limitations

The carrier-removal P1 remains open. The required first `git fetch origin` failed with permission denied on `.git/worktrees/_t_p-sup-01/FETCH_HEAD`, so the chained merge did not run. A separate `git merge --no-edit origin/main` failed creating `ORIG_HEAD.lock` in the same protected Git directory. Earlier local repair notes recorded a committer-identity error and an `index.lock` denial; neither constitutes a successful merge or commit. The current session cannot write this shared Git metadata and cannot request elevated access. No repair commit or push has been created.

Docker API access is denied at `npipe:////./pipe/docker_engine`. Launching Docker Desktop with a hidden window did not make `docker info` succeed. The required Postgres/Redis/MinIO containers were not started by this session, and database-dependent `pnpm test` and support functional acceptance were not run. Do not report them as green or infer support acceptance from lint/typecheck.

Pre-existing unrelated working changes belong to another task, including a register addition and web files. They are preserved and must not enter this support repair commit. `.oc/pr-body.md` now describes FEAT-SUP-01 and records the exact local evidence and remaining blockers. There is no new product decision in this repair; the permission/environment failures above are not `NEEDS_DECISION` product questions. Author handoff remains blocked until the merge, all inheritance checks, required tests and independent review succeed.
