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

Planning assessment: 2026-10-31. On 2026-10-31, the product owner (operator) APPROVED ALL recommended decisions G01–G09 as written. All former planning gaps have been converted into recorded decisions under `HUMAN-DECISION-FEAT-SUP-01-2026-10-31`. The Work Item is complete, fully specified, and unblocked for implementation.

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

Assign `GEMINI` as primary implementation author. Due to full-stack depth (Prisma migration, RBAC constants, NestJS API module, OpenAPI contract generation, and multi-state Next.js frontend with E2E tests), the delivery is partitioned into two distinct vertical slices:

### Slice A — Core API, Persistence, Contracts & Consent Security
- **Prisma Schema & Migrations**:
  - Add models: `SupportRequest`, `SupportReply`, `SupportAttachment`, `SupportAccessGrant`.
  - Add enum types: `SupportRequestStatusEnum` (`OPEN`, `IN_PROGRESS`, `WAITING_FOR_SHOP`, `RESOLVED`), `SupportContextTypeEnum` (`NONE`, `ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`), `SupportGrantStatusEnum` (`ACTIVE`, `REVOKED`, `EXPIRED`).
  - Add additive migration in `prisma/migrations/`.
  - Add seed fixtures for Tenant A and Tenant B in `infra/docker/seed.ts`.
- **RBAC & Authorization**:
  - Add canonical capability permissions in `apps/api/src/rbac/rbac.constants.ts`:
    - `support:request_create`
    - `support:request_read`
    - `support:request_reply`
    - `support:request_transition`
    - `support:grant_manage`
- **NestJS Support Module (`apps/api/src/support/`)**:
  - `support.controller.ts`: REST endpoints with `SessionGuard`, `RbacGuard`, `@Permissions()`.
  - `support.service.ts`: Business logic, optimistic locking (`version`), context validation, audit logging.
  - DTOs with `class-validator`: `CreateSupportRequestDto`, `CreateSupportReplyDto`, `UpdateSupportStatusDto`, `CreateSupportGrantDto`.
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
  - `UC-SUP-01` (Create Request): An authenticated shop user submits a request with required `subject` (string, 5–200 characters), required `description` (string, 10–5000 characters), optional `context_type` (`NONE`, `ORDER`, `SHIPMENT`, `STATEMENT`, `CLAIM`, `DISCREPANCY`), optional `context_id` (string, validated server-side to belong to caller's `merchant_id`), and optional attachment IDs.
  - `UC-SUP-02` (Reply Thread): Authenticated shop users and operators post replies (string, 1–5000 characters). All replies are shop-visible; internal private operator notes are excluded from this release.
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

#### G04 — Granular RBAC Capabilities, Roles, and Consent Approver
- **Context**: RBAC matrix has temporary access approval but no support request actions or consent approver. Current registry has neither support capabilities nor a support operator role.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Capability permissions added to `apps/api/src/rbac/rbac.constants.ts`:
    - `support:request_create`: Permitted for `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`.
    - `support:request_read`: Permitted for `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`.
    - `support:request_reply`: Permitted for `SHOP_OWNER`, `SHOP_ADMIN`, `SHOP_STAFF`.
    - `support:request_transition`: Permitted for `SHIPDE_OPERATOR` (to progress/resolve) and shop roles (to reopen).
    - `support:grant_manage`: Permitted strictly for `SHOP_OWNER`.
  - Operator business data access: Operator has no default access to shop business records without an active `SupportAccessGrant`. Access is evaluated server-side per request.
  - Masking: PII (customer phone, email, recipient address, bank account numbers) is masked in audit logs, responses, and UI unless user possesses explicit `pii:unmask` capability.

#### G05 — Private Diagnostic Attachments Contract
- **Context**: Catalog requires attachments; COM-06 is BACKLOG; Data Dictionary/schema/contract lack generic attachment ownership, permitted MIME/size/count and retention. S3 readiness is insufficient.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Storage & Security: Files stored in private S3 bucket under path `support/{merchant_id}/{request_id}/{file_id}`.
  - Pre-upload scan: Objects must pass virus/malware check before linkage. Quarantined/infected files rejected with 400 Bad Request (`ATTACHMENT_MALWARE_DETECTED`).
  - Short-lived downloads: Presigned download URLs have a 15-minute expiration and are issued only after validating tenant session and permissions. Public URLs are strictly prohibited.
  - Constraints: Allowed MIME types: `application/pdf`, `image/png`, `image/jpeg`, `image/webp`. File size limit: 10 MB per file. File count limit: max 5 attachments per request or reply.
  - Retention: Attachments retained for 30 days following ticket resolution, then purged in compliance with data retention policy.

#### G06 — Support Access Grant Specification
- **Context**: RBAC/Actors/Security require consent, scope and expiry, but define no grant identity, maximum duration, revocation, in-flight access behavior or operator authentication. Domain model merely names SupportAccessGrant.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Entity `SupportAccessGrant`: Bound to `request_id`, `merchant_id`, named `operator_id` (User ID), `granted_by` (User ID of `SHOP_OWNER`).
  - Mandatory purpose: String (10–500 characters) describing the diagnostic reason.
  - Read-only scope: Grants read access to records directly linked to `context_type` and `context_id`. No write permissions, no configuration modifications, no bulk data exports, no access to credentials or secrets, no implicit unmasking of PII.
  - Expiry: Configurable duration: default 4 hours, maximum 24 hours. Evaluated dynamically on every read request.
  - Revocation: `SHOP_OWNER` can trigger immediate revocation via `DELETE /api/v1/support/requests/:id/grants/:grantId`. Any subsequent read by operator immediately returns 403 Forbidden (`SUPPORT_GRANT_REVOKED`).
  - Audit: Grant creation, revocation, expiration, and every data read by the operator under the grant are logged immutably in `AuditLog`.

#### G07 — Dependency Architecture and Vertical Slicing
- **Context**: FEAT-SUP-01 promises consented access at order 29 while SEC-02 defines support access at order 134/later admin slice. Generic register dependencies name only foundation; no support mock is approved.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - The delivery is decoupled from full platform-wide administrative impersonation (`FEAT-SEC-02`).
  - `FEAT-SUP-01` delivers request-bound consent grant data modeling, authorization checks, and UI toggle in Slice A and Slice B.
  - One Work Item per PR; no placeholder or disabled buttons without real backing functionality.

#### G08 — Internal API Contracts, Data Schemas, Canonical Errors, and Idempotency
- **Context**: Internal API/OpenAPI and data schemas lack request/reply/context/grant commands, schemas, errors, event contracts and retention. Conceptual tenant_id and implemented merchant_id need an explicit feature mapping.
- **Recorded Decision**: Approved as written (Operator approval 2026-10-31).
- **Specification**:
  - Tenant mapping: Conceptual `tenant_id` maps strictly to `merchant_id` (`@db.Uuid` referencing `Merchant`).
  - REST Endpoints under `/api/v1/support/requests`:
    - `POST /api/v1/support/requests`: Create request. Supports `Idempotency-Key` header (24-hour replay cache).
    - `GET /api/v1/support/requests`: List requests for merchant (filters: `status`, `context_type`, pagination: `limit`, `offset`).
    - `GET /api/v1/support/requests/:id`: Get request detail, reply history, attachments, and grant status.
    - `POST /api/v1/support/requests/:id/replies`: Post a reply.
    - `PATCH /api/v1/support/requests/:id/status`: Update status (body: `{ status, version }`).
    - `POST /api/v1/support/requests/:id/grants`: Create support access grant (restricted to `SHOP_OWNER`).
    - `DELETE /api/v1/support/requests/:id/grants/:grantId`: Revoke support access grant (restricted to `SHOP_OWNER`).
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
  id          String                   @id @default(uuid()) @db.Uuid
  request_id  String                   @db.Uuid
  reply_id    String?                  @db.Uuid
  merchant_id String                   @db.Uuid
  file_key    String                   @db.VarChar(512)
  file_name   String                   @db.VarChar(255)
  file_size   Int
  mime_type   String                   @db.VarChar(128)
  created_at  DateTime                 @default(now()) @db.Timestamptz

  request     SupportRequest           @relation(fields: [request_id], references: [id], onDelete: Cascade)
  reply       SupportReply?            @relation(fields: [reply_id], references: [id], onDelete: Cascade)
  merchant    Merchant                 @relation(fields: [merchant_id], references: [id], onDelete: Cascade)

  @@index([request_id])
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
  @@map("support_access_grants")
}
```

### Internal REST API Endpoints

| Method   | Path                                                | Required Permission         | Description                                                                                       | Status Codes            |
| -------- | --------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------- |
| `POST`   | `/api/v1/support/requests`                          | `support:request_create`    | Create a new contextual support request. Supports `Idempotency-Key`.                              | 201, 400, 401, 403, 409 |
| `GET`    | `/api/v1/support/requests`                          | `support:request_read`      | List support requests for tenant with pagination (`limit`, `offset`) and filter by `status`.     | 200, 401, 403           |
| `GET`    | `/api/v1/support/requests/:id`                      | `support:request_read`      | Get full request detail, message thread, attachments, and consent grant status.                   | 200, 401, 403, 404      |
| `POST`   | `/api/v1/support/requests/:id/replies`              | `support:request_reply`     | Append a reply to the ticket thread. Automatically advances `WAITING_FOR_SHOP` → `IN_PROGRESS`.   | 201, 400, 401, 403, 404 |
| `PATCH`  | `/api/v1/support/requests/:id/status`               | `support:request_transition`| Update ticket status. Requires matching optimistic `version`.                                     | 200, 400, 401, 403, 409 |
| `POST`   | `/api/v1/support/requests/:id/grants`               | `support:grant_manage`      | Grant temporary read-only support access to named operator. Restricted strictly to `SHOP_OWNER`.  | 201, 400, 401, 403, 404 |
| `DELETE` | `/api/v1/support/requests/:id/grants/:grantId`      | `support:grant_manage`      | Revoke active support access grant immediately. Restricted strictly to `SHOP_OWNER`.             | 200, 401, 403, 404      |
| `GET`    | `/api/v1/support/requests/:id/attachments/:fileId`  | `support:request_read`      | Generate temporary 15-minute presigned download URL for private attachment.                       | 200, 401, 403, 404      |

### Audit Logging Requirements

Every mutation generates an immutable `AuditLog` entry in PostgreSQL:
- Actions: `SUPPORT_REQUEST_CREATE`, `SUPPORT_REPLY_ADD`, `SUPPORT_STATUS_TRANSITION`, `SUPPORT_GRANT_CREATE`, `SUPPORT_GRANT_REVOKE`, `SUPPORT_OPERATOR_ACCESS`.
- Payload: `merchant_id`, `user_id`, `actor`, `action`, `entity_type` (`SupportRequest`, `SupportAccessGrant`), `entity_id`, `old_value` (sanitized), `new_value` (sanitized), `reason`.
- PII Protection: All recipient phone numbers, email addresses, and financial account numbers are masked before persisting to `AuditLog`. Attachment bytes and secrets are never logged.

## Acceptance matrix

All 14 acceptance criteria are unblocked and ready for verification:

| AC/Test ID              | Scenario                                                                                                                                           | Expected Result                                                                                                                                                       | Evidence Required                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-SUP-01 / TEST-SUP-01 | Authorized shop user (`SHOP_ADMIN` or `SHOP_OWNER`) submits a valid support request with subject, description, and valid order context ID.         | Request persists in database with status `OPEN`, `version: 1`, linked `merchant_id`, and appears immediately in tenant request list.                                  | API integration test in `support.controller.spec.ts`; DB assertion verifying tenant scoping and fields.                       |
| AC-SUP-02 / TEST-SUP-02 | Shop user submits request with missing subject (< 5 chars), description (< 10 chars), or context entity belonging to a different merchant.         | API rejects with 400 Bad Request and canonical error code (`VALIDATION_ERROR` or `INVALID_CONTEXT_ENTITY`). No records created; valid inputs preserved in UI.       | Controller validation test; DTO unit tests with `class-validator`.                                                            |
| AC-SUP-03 / TEST-SUP-03 | Concurrent create requests sent with identical `Idempotency-Key` header; or identical key replayed with modified payload.                         | Identical payload returns cached 201 response with identical request ID. Modified payload returns 409 Conflict (`IDEMPOTENCY_CONFLICT`). Single record in database.   | Concurrency and replay integration test in `support.service.spec.ts`.                                                         |
| AC-SUP-04 / TEST-SUP-04 | Operator transitions ticket `OPEN` → `IN_PROGRESS` → `RESOLVED`; shop user attempts invalid skip `OPEN` → `RESOLVED` or stale version update.    | Permitted transitions succeed and update `version`; invalid transition returns 400 Bad Request; stale version update returns 409 Conflict (`CONCURRENT_MODIFICATION`).| State machine transition unit test; optimistic concurrency test in `support.service.spec.ts`.                                 |
| AC-SUP-05 / TEST-SUP-05 | Tenant A authenticated user attempts to read, reply, transition, or download attachments belonging to Tenant B's support request.                 | API rejects with 404 Not Found (or 403 Forbidden). Zero Tenant B metadata or files disclosed. Security violation logged to `AuditLog`.                                | Multi-tenant isolation test using synthetic Tenant A and Tenant B fixtures in `support.controller.spec.ts`.                  |
| AC-SUP-06 / TEST-SUP-06 | User lacking `support:request_create` attempts creation, or user with expired/revoked session calls support endpoints.                             | API rejects with 401 Unauthorized or 403 Forbidden (`FORBIDDEN_PERMISSION_REQUIRED`). Database remains unchanged.                                                     | RBAC guard and session integration tests in `apps/api/src/support/support.rbac.spec.ts`.                                      |
| AC-SUP-07 / TEST-SUP-07 | Ship Dễ operator attempts to browse Tenant A orders without an active consent grant; then browses after grant is issued; then after it expires.    | Without grant: 403 Forbidden. With active grant: 200 OK (read-only context data). After expiration/revocation: immediate 403 Forbidden.                               | Time-travel / clock-mocked integration test verifying grant status check in `support.grant.spec.ts`.                           |
| AC-SUP-08 / TEST-SUP-08 | `SHOP_OWNER` grants support access for 4 hours; non-owner role (`SHOP_STAFF`) attempts to grant or revoke access.                                 | `SHOP_OWNER` call succeeds (201 Created); `SHOP_STAFF` call is rejected with 403 Forbidden (`FORBIDDEN_ROLE_RESTRICTED`). Grant revocation immediate on DELETE.      | RBAC capability test asserting `support:grant_manage` strictly restricted to `SHOP_OWNER`.                                    |
| AC-SUP-09 / TEST-SUP-09 | Shop user attaches 1 clean PDF and 1 infected file; requests download URL after ticket is resolved.                                                | Infected file rejected during scan (400 Bad Request); clean PDF linked. Presigned URL generated with 15-minute expiration; public S3 access denied.                   | Storage service integration test with mock scanner; presigned URL authorization test.                                         |
| AC-SUP-10 / TEST-SUP-10 | Audit log assertions across ticket creation, status change, consent grant, and operator data access.                                              | All events present in `audit_logs` table with timestamp, `merchant_id`, actor ID, correlation ID, and masked PII. Audit write failure aborts transaction.            | Transactional audit logging test in `support.service.spec.ts`.                                                                |
| AC-SUP-11 / TEST-SUP-11 | UI state coverage on `/support`, `/support/new`, `/support/[id]`: loading, empty, validation error, server error, forbidden, not found, success. | Every shared UI state renders correctly, keyboard focus is accessible, WCAG AA contrast met, and primary actions are fully interactive.                            | Component tests in `apps/web/src/components/support/*.spec.tsx` and Storybook/Playwright accessibility checks.               |
| AC-SUP-12 / TEST-SUP-12 | Network interruption or session expiration while editing a support request draft.                                                                  | Form preserves entered subject, description, and context selection in session storage. Re-authenticating restores draft with prompt to continue.                      | Playwright browser offline/relogin recovery test in `apps/web/e2e/support.spec.ts`.                                            |
| AC-SUP-13 / TEST-SUP-13 | Prisma migration execution and OpenAPI contract verification.                                                                                      | Schema migration applies cleanly to PostgreSQL without data loss. `scripts/verify-contracts.ts` confirms 0 drift between OpenAPI spec and generated client.          | `pnpm db:migrate` and `pnpm contract:check` execution in CI pipeline.                                                         |
| AC-SUP-14 / TEST-SUP-14 | End-to-end customer journey: create contextual ticket → attach file → operator reply → grant consent → operator inspection → resolve ticket.      | Full journey completes with real database persistence, correct UI state transitions, live consent countdown, and verified audit trail.                               | Playwright E2E customer journey test in `apps/web/e2e/support.spec.ts`.                                                        |

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

Handoff instruction for GEMINI: Read `AGENTS.md`, this Work Item, and `FEATURE-DELIVERY-REGISTER.csv` on branch `feat/feat-sup-01`. Status is `READY_FOR_AUTHOR`. Implement Slice A (API, Data, Contracts, RBAC) followed by Slice B (UI, Navigation, E2E). Strictly enforce tenant scoping on `merchant_id`, zero hardcodes, and masked PII.

## Codex review record

| Review round | Commit                   | Verdict            | Findings resolved                                                                   |
| ------------ | ------------------------ | ------------------ | ----------------------------------------------------------------------------------- |
| Planning     | Planning finalization    | READY_FOR_AUTHOR   | All planning gaps G01–G09 resolved with operator approval on 2026-10-31. Work Item complete and implementable. |

## Residual limitations

None. All product decisions and technical contracts have been resolved and approved.
