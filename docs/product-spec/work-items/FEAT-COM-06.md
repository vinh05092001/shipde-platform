# FEAT-COM-06 — Attachments

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `FEAT-COM-06` |
| Feature ID | `FEAT-COM-06` |
| Status | `READY_FOR_CODEX` |
| Delivery order | 25 |
| Dependencies | `TASK-FOUND-04`, `FEAT-AUTH-01`, `FEAT-AUTH-06`, `FEAT-RBAC-01`, `FEAT-RBAC-02`, `FEAT-ORG-01` |
| Assigned author | `GEMINI` |
| Risk | HIGH |
| Risk domains | `tenant isolation`, `rbac`, `FEAT-RBAC-02 scopes`, `s3 private storage`, `tamper-proof sha256`, `access audit`, `retention lifecycle`, `malware/mime validation` |
| Allowed paths | `docs/product-spec/work-items/FEAT-COM-06.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `packages/config/src/*`, `packages/contracts/src/*`, `packages/testkit/src/*`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/attachments/*`, `apps/api/src/app.module.ts`, `apps/api/src/storage/storage.service.ts` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/feat-com-06-api` |
| Pull Request | #483 |

## Slice A (API)

- **Delivery Slice**: Slice A carries the API and Server-Side Foundation in isolation (PR #483) under an operator-approved split.
- **Scope for Slice A**:
  - `prisma/schema.prisma` (`Attachment` and `AttachmentOrphanCleanup` models) and migrations (`20261029010000_feat_com_06_attachments`, `20261030010000_feat_com_06_orphan_cleanup`).
  - `@shipde/config` (`MAX_ATTACHMENT_SIZE_BYTES`, `ATTACHMENT_DEFAULT_RETENTION_DAYS`, `ATTACHMENT_DOWNLOAD_TTL_SECONDS`, `ATTACHMENT_SCAN_MAX_ZIP_ENTRIES`, `ATTACHMENT_SCAN_MAX_DECOMPRESSED_BYTES`, `ATTACHMENT_DISALLOWED_EXTENSIONS`).
  - `@shipde/contracts` (`AttachmentAuditEvent`, `AttachmentScanStatus`, `AttachmentErrorCode`, `FormattedAttachment`, `AttachmentPerItemResult`, `AttachmentBulkActionResult`).
  - `@shipde/testkit` (test environment and configuration helpers).
  - `apps/api/src/storage/storage.service.ts` (S3 object storage operations: putObject, getObject, deleteObject, headObject).
  - `apps/api/src/attachments/*` (`attachments.module.ts`, `attachments.controller.ts`, `attachments.service.ts`, `attachments.dto.ts`, `attachments.capabilities.ts`, `attachments.unit.spec.ts`, `attachments.supertest.spec.ts`).
  - `apps/api/src/app.module.ts` and `apps/api/package.json`.
  - `docs/product-spec/work-items/FEAT-COM-06.md`.
- **Acceptance IDs Covered in Slice A**:
  - `AC-COM-06-01`: Upload valid attachment (PNG image, valid size, valid entity, S3 object stored, SHA-256 computed, status ACTIVE).
  - `AC-COM-06-02`: Upload file with matching client checksum verified.
  - `AC-COM-06-03`: Upload file with mismatched checksum rejected with 400 `CHECKSUM_MISMATCH`.
  - `AC-COM-06-04`: Upload file with disallowed MIME type or extension (.exe, .html, .svg) rejected with 400 `INVALID_FILE_TYPE`.
  - `AC-COM-06-05`: Upload file exceeding configured size limit rejected with 400 `FILE_TOO_LARGE`.
  - `AC-COM-06-06`: Upload empty file (0 bytes) rejected with 400 `EMPTY_FILE`.
  - `AC-COM-06-07`: List attachments with pagination, total count, and entity filter.
  - `AC-COM-06-08`: List attachments with FEAT-RBAC-02 warehouse scope filtering.
  - `AC-COM-06-09`: Actor with empty scopes receives empty list (fail-closed).
  - `AC-COM-06-10`: Get attachment metadata by ID within same tenant without exposing S3 secret credentials.
  - `AC-COM-06-11`: Cross-tenant access attempt rejected with 404 `ATTACHMENT_NOT_FOUND` (zero cross-tenant leakage).
  - `AC-COM-06-12`: Access outside warehouse scope rejected with 403 `SCOPE_FORBIDDEN`.
  - `AC-COM-06-13`: Download attachment content with binary stream, content headers, and immutable `ATTACHMENT_ACCESSED` audit log.
  - `AC-COM-06-14`: Download attachment outside warehouse scope rejected with 403 `SCOPE_FORBIDDEN`.
  - `AC-COM-06-15`: Delete attachment with `confirm: true` marks `DELETED`, removes S3 object, creates `ATTACHMENT_DELETED` audit log.
  - `AC-COM-06-16`: Delete attachment without `confirm: true` rejected with 400 `CONFIRMATION_REQUIRED`.
  - `AC-COM-06-17`: Delete attachment belonging to another tenant rejected with 404 `ATTACHMENT_NOT_FOUND`.
  - `AC-COM-06-18`: Delete attachment outside actor's warehouse scope rejected with 403 `SCOPE_FORBIDDEN`.
  - `AC-COM-06-19`: Run retention purge job for expired attachments with truthful per-row results (`succeeded_ids`, `failed_ids`).
  - `AC-COM-06-20`: Bulk delete attachments with partial valid and invalid IDs returning partitioned results.
  - `AC-COM-06-21`: Bulk delete without `confirm: true` rejected with 400 `CONFIRMATION_REQUIRED`.
  - `AC-COM-06-22`: Audit trail verification across upload, access, download, delete, and retention purge.
  - `AC-COM-06-23`: Negative test: Invalid UUID formats return canonical 400 `VALIDATION_ERROR`.
  - `AC-COM-06-24`: S3 storage error resilience: S3 failure returns 503 `STORAGE_UNAVAILABLE` without leaking internals.
  - `AC-COM-06-25`: Test tenant isolation and cleanup: Tests create and clean their own tenant rows in finally blocks.
- **What Remains for Slice B (UI)**:
  - `apps/web/src/components/AttachmentManagementView.tsx`: Interactive web management interface with data grid, filter bar, upload dialog, delete confirmation modal, bulk actions, quarantine modal, and retention purge modal.
  - `apps/web/src/app/settings/attachments/page.tsx`: Settings workspace page wiring `AttachmentManagementView` with server-derived capability flags.
  - `apps/web/src/tests/attachments-page-states.test.ts`: Web UI state tests covering loading, empty, validation error, server error with retry, forbidden, and success feedback.
  - WCAG 2.1 A/AA accessibility verification on icon buttons and navigation elements.
  - Web UI slice remains on `feat/feat-com-06` (PR #471) and merges after Slice A.

## Business outcome

Merchant operators, warehouse supervisors, and CS staff can securely upload, link, retrieve, download, and manage private evidence attachments (such as return damage photos, carrier claim documents, statement spreadsheets, and discrepancy proofs) with cryptographic SHA-256 integrity verification, S3-compatible private object storage, server-side tenant isolation, per-row FEAT-RBAC-02 warehouse and branch scoping, immutable access audit trails, configurable retention policies, and asynchronous retention cleanup / bulk processing with truthful per-row results.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-COM-06`: Attachments ("Private upload, hash, access audit and retention").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capabilities: `shipment:receive_return` (return evidence), `claim:verify_submit` (claim evidence), `reconciliation:import_settlement_bank` (statements), `order:view_create` / `iam:shop_config` (general/shop attachments), `audit:view` (access audit).
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section Case & claim: `Evidence.sha256` (cryptographic integrity after ingestion), `Evidence.server_captured_at`. Section Data classification: "Restricted: credentials, bank statements, raw files, recipient contact/address, evidence media. Access is narrower than normalized operational data."
- `docs/product-spec/docs/04-data/DATA-LIFECYCLE-IMPORTS.md` — Section Import lifecycle: "1. UPLOADED: private object stored; malware check and hash."
- `docs/product-spec/docs/06-architecture/ADR.md` — `ADR-005`: S3-compatible private object storage for raw files, labels, contract sources, and evidence. `ADR-007`: Immutable event/evidence and audit snapshots; raw evidence is never overwritten.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Section Threat highlights: "Malicious upload: Type/size/malware scan and private staging." "Privacy: Raw source/evidence access is narrower than normalized operational data. Retention is configurable and documented; deletion is audited."
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Canonical error envelope `{ error: { code, message, details, next_action }, meta: { correlation_id } }`, ISO-8601 UTC timestamps, session-derived tenant context.
- `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` — Canonical error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `SCOPE_FORBIDDEN`, `NOT_FOUND`, `CHECKSUM_MISMATCH`, `CONFIRMATION_REQUIRED`, `IDEMPOTENCY_CONFLICT`.

## Preconditions and dependencies

- Foundation architecture, multi-tenancy, and authentication (`TASK-FOUND-04`, `FEAT-AUTH-01`, `FEAT-AUTH-06`) are merged.
- Platform RBAC and FEAT-RBAC-02 scope enforcement (`FEAT-RBAC-01`, `FEAT-RBAC-02`) are merged and provide `RbacService`, `SessionGuard`, `store_scopes`, and `warehouse_scopes`.
- Shop configuration (`FEAT-ORG-01`) is merged.
- S3 storage client foundation (`StorageService` using `@aws-sdk/client-s3`) is available in `apps/api/src/storage/storage.service.ts`.

## Author boundary

`GEMINI` is assigned because `FEAT-COM-06` spans database persistence, Prisma migration, S3 private object storage integration, cryptographic SHA-256 calculation, FEAT-RBAC-02 per-row store/warehouse scoping, immutable access audit logging, configurable retention policies, asynchronous bulk processing with per-row results, and Supertest integration tests.

## In scope

1. **Prisma Model & Migration**:
   - `Attachment` model in `prisma/schema.prisma` with `id`, `merchant_id`, `file_name`, `file_size`, `mime_type`, `checksum_sha256`, `storage_key`, `storage_bucket`, `entity_type`, `entity_id`, `branch_id`, `warehouse_id`, `uploaded_by`, `status`, `retention_days`, `expires_at`, `metadata`, `deleted_at`, `created_at`, `updated_at`.
   - Migration `20261029010000_feat_com_06_attachments` creating the `attachments` table with foreign key to `merchants` and required indices.
2. **Configuration Validation**:
   - `MAX_ATTACHMENT_SIZE_BYTES` in `@shipde/config` (default 10 MB = 10,485,760 bytes, bounded 1..104,857,600).
   - `ATTACHMENT_DEFAULT_RETENTION_DAYS` in `@shipde/config` (default 90 days, bounded 1..3650).
   - `ATTACHMENT_ALLOWED_MIME_TYPES` validation list ensuring dangerous script/executable extensions (.exe, .sh, .bat, .js, .html, .svg) are blocked.
3. **API Endpoints**:
   - `POST /api/v1/attachments/upload`: upload attachment file with server-side SHA-256 calculation, MIME type validation, file size limit check, private S3 storage, and tenant/scope attribution. Supports expected checksum verification.
   - `GET /api/v1/attachments`: list attachments for tenant with pagination, sorting, entity/status filters, and server-side FEAT-RBAC-02 warehouse/store scope filtering per row.
   - `GET /api/v1/attachments/:id`: retrieve attachment metadata, scoped to tenant and user's warehouse/branch scope.
   - `GET /api/v1/attachments/:id/download`: stream attachment data from S3 with correct content headers; creates an immutable `ATTACHMENT_ACCESSED` audit log entry.
   - `DELETE /api/v1/attachments/:id`: soft delete attachment with required `confirm: true` parameter; checks permission and scope; creates `ATTACHMENT_DELETED` audit log entry.
   - `POST /api/v1/attachments/retention-purge`: execute retention cleanup (purging expired attachments based on tenant retention policy or explicit dry-run/execute) returning per-row execution results and audit trail.
   - `POST /api/v1/attachments/bulk-delete`: bulk delete multiple attachments with per-row results (`succeeded_ids`, `failed_ids`, granular errors) and `confirm: true` requirement.
4. **Security, Tenancy & Scope Enforcement**:
   - Multi-tenant isolation: strictly scoped to `merchant_id` on all database operations and S3 keys. Cross-tenant queries return 404 `ATTACHMENT_NOT_FOUND` to prevent existence leakage.
   - FEAT-RBAC-02 scope enforcement per row: If an attachment has `warehouse_id`, actor must possess wildcard `*` or include `warehouse_id` in `warehouse_scopes`. If scoped to `branch_id`, actor must possess wildcard `*` or include `branch_id` in `store_scopes`.
   - Zero plaintext PII or secrets leaked in errors, audit logs, or S3 metadata.
   - Immutable audit logging on upload, access/download, delete, and retention purge.
5. **Web Management Interface & UI State Coverage (Delivered in Slice B — PR #471)**:
   - `apps/web/src/components/AttachmentManagementView.tsx`: Complete vertical attachment management interface with search, status filtering (ACTIVE, QUARANTINED, PENDING_DELETION, DELETED), entity filtering, upload modal, deletion confirmation modal, bulk deletion, retention purge with dry-run toggle, quarantine action, and full accessibility compliance (WCAG/A11y verified).
   - `apps/web/src/app/settings/attachments/page.tsx`: Settings page integrating `AttachmentManagementView` with server-derived edit capabilities.
   - `apps/web/src/tests/attachments-page-states.test.ts`: Complete UI states test suite verifying loading, empty, validation error, server error with retry, forbidden, success feedback, and list grid rendering.

## Out of scope

- Direct browser-to-S3 presigned multipart upload for multi-gigabyte files (deferred to bulk import engine FEAT-COM-04).
- Antivirus daemon sidecar installation (ClamAV daemon process container orchestration is an infrastructure ops task; backend provides deep polyglot content inspection and quarantine status).

## Business rules and edge cases

- `BR-COM06-01`: Tenant isolation: all attachments strictly belong to the session merchant. Access across tenants returns 404 `ATTACHMENT_NOT_FOUND`.
- `BR-COM06-02`: Integrity hash: Every uploaded file has its cryptographic SHA-256 hash computed on the server. If the client supplies `checksum_sha256`, it must match server computation; mismatch returns 400 `CHECKSUM_MISMATCH`.
- `BR-COM06-03`: Dangerous file blocking: Executable, script, or active media MIME types (`application/x-msdownload`, `application/x-sh`, `text/html`, `application/javascript`, `image/svg+xml`) are strictly rejected with 400 `INVALID_FILE_TYPE`. Allowed types: standard images (`image/jpeg`, `image/png`, `image/webp`), PDF (`application/pdf`), and tabular spreadsheets/data (`text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
- `BR-COM06-04`: Size bounds: Uploads exceeding `MAX_ATTACHMENT_SIZE_BYTES` are rejected with 400 `FILE_TOO_LARGE`. Empty files (0 bytes) are rejected with 400 `EMPTY_FILE`.
- `BR-COM06-05`: FEAT-RBAC-02 Scope enforcement per row: Non-wildcard users cannot view, download, or delete attachments linked to warehouses or branches outside their assigned scopes. Unauthorized access returns 403 `SCOPE_FORBIDDEN`.
- `BR-COM06-06`: Access audit: Every retrieval of file content (`/download`) records an immutable `AuditLog` entry with action `ATTACHMENT_ACCESSED`, recording actor ID, tenant ID, attachment ID, and masked IP address.
- `BR-COM06-07`: Destructive action confirmation: Deletion requires explicit `confirm: true`. Omitting confirmation returns 400 `CONFIRMATION_REQUIRED`.
- `BR-COM06-08`: Retention computation: Attachments inherit tenant default retention (`ATTACHMENT_DEFAULT_RETENTION_DAYS`) unless overridden by explicit `retention_days`. `expires_at` is set to `created_at + retention_days`.
- `BR-COM06-09`: Retention purge: Retention purge processes only expired items (`expires_at <= NOW()`), removes S3 objects, marks records `DELETED`, and returns truthful per-row results (`succeeded_ids`, `failed_ids`, `results`).
- `BR-COM06-10`: Bulk delete: Bulk deletion checks permissions and scopes per item, returning partial failure results without aborting valid items.

## Acceptance matrix

| AC / Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-COM-06-01` | Upload valid attachment (PNG image, valid size, valid entity) | 201 Created; S3 object stored; SHA-256 computed; metadata returned with status ACTIVE | Supertest & Unit test |
| `AC-COM-06-02` | Upload file with matching client checksum | 201 Created; server verifies hash matches; attachment created | Supertest & Unit test |
| `AC-COM-06-03` | Upload file with mismatched checksum | 400 `CHECKSUM_MISMATCH`; no S3 object stored; zero DB rows | Supertest & Unit test |
| `AC-COM-06-04` | Upload file with disallowed MIME type (.exe, .html, .svg) | 400 `INVALID_FILE_TYPE`; fail closed | Supertest & Unit test |
| `AC-COM-06-05` | Upload file exceeding size limit | 400 `FILE_TOO_LARGE`; fail closed | Supertest & Unit test |
| `AC-COM-06-06` | Upload empty file (0 bytes) | 400 `EMPTY_FILE`; fail closed | Supertest & Unit test |
| `AC-COM-06-07` | List attachments with pagination and entity filter | 200 OK; returns paginated array conforming to list contract; metadata includes total and correlation_id | Supertest & Unit test |
| `AC-COM-06-08` | List attachments with FEAT-RBAC-02 warehouse scope | User with restricted warehouse scope only receives attachments for assigned warehouse; other warehouses omitted | Supertest & Unit test |
| `AC-COM-06-09` | Actor with empty scopes lists attachments | Returns empty list (fail-closed); no unauthorized access | Supertest & Unit test |
| `AC-COM-06-10` | Get attachment metadata by ID within same tenant | 200 OK; returns complete metadata without exposing S3 secret credentials | Supertest & Unit test |
| `AC-COM-06-11` | Cross-tenant access attempt to get attachment | 404 `ATTACHMENT_NOT_FOUND`; zero cross-tenant leakage | Supertest & Unit test |
| `AC-COM-06-12` | Actor with restricted warehouse scope accesses attachment of another warehouse | 403 `SCOPE_FORBIDDEN`; request denied | Supertest & Unit test |
| `AC-COM-06-13` | Download attachment content | 200 OK; binary stream returned with correct MIME type and Content-Disposition; creates `ATTACHMENT_ACCESSED` audit log | Supertest & Unit test |
| `AC-COM-06-14` | Download attachment of another warehouse without scope | 403 `SCOPE_FORBIDDEN`; no audit or data leak | Supertest & Unit test |
| `AC-COM-06-15` | Delete attachment with `confirm: true` | 200 OK; attachment marked DELETED; S3 object removed; creates `ATTACHMENT_DELETED` audit log | Supertest & Unit test |
| `AC-COM-06-16` | Delete attachment without `confirm: true` | 400 `CONFIRMATION_REQUIRED`; record unchanged | Supertest & Unit test |
| `AC-COM-06-17` | Delete attachment belonging to another tenant | 404 `ATTACHMENT_NOT_FOUND`; record unchanged | Supertest & Unit test |
| `AC-COM-06-18` | Delete attachment outside actor's warehouse scope | 403 `SCOPE_FORBIDDEN`; record unchanged | Supertest & Unit test |
| `AC-COM-06-19` | Run retention purge job for expired attachments | 200 OK; expired items purged; unexpired items preserved; truthful per-row results returned | Supertest & Unit test |
| `AC-COM-06-20` | Bulk delete attachments with partial valid and invalid IDs | 200 OK; per-row results returned; `succeeded_ids` and `failed_ids` clearly partitioned | Supertest & Unit test |
| `AC-COM-06-21` | Bulk delete without `confirm: true` | 400 `CONFIRMATION_REQUIRED`; zero items deleted | Supertest & Unit test |
| `AC-COM-06-22` | Audit trail verification: All access and deletions generate audit entries | `audit_logs` contains entries with actor, merchant_id, action, masked IP, and correlation ID | Supertest & Unit test |
| `AC-COM-06-23` | Negative test: Invalid UUID formats return canonical 400 | 400 `VALIDATION_ERROR` with canonical error envelope | Supertest & Unit test |
| `AC-COM-06-24` | S3 storage error resilience: S3 failure returns 503 `STORAGE_UNAVAILABLE` | Graceful failure without leaking stack trace or credentials | Supertest & Unit test |
| `AC-COM-06-25` | Test tenant isolation & cleanup | Tests create and delete only their own tenant rows in finally blocks | Clean DB state |

## Verification commands

```bash
# Configuration & Hardcode checks
node scripts/ai/check-no-hardcode.mjs

# Formatting
pnpm exec prettier --check docs/product-spec/work-items/FEAT-COM-06.md apps/api/src/attachments/* packages/config/src/* packages/contracts/src/* packages/testkit/src/*

# TypeScript compilation (Slice A packages & apps)
pnpm --filter @shipde/config build
pnpm --filter @shipde/contracts build
pnpm --filter @shipde/testkit build
pnpm --filter @shipde/api typecheck
pnpm --filter @shipde/web typecheck

# Linting
pnpm --filter @shipde/api lint
pnpm test:a11y

# Slice A Unit tests
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json --test src/attachments/attachments.unit.spec.ts

# Slice A Supertest HTTP integration tests
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/attachments/attachments.supertest.spec.ts

# OpenAPI contract check
pnpm contract:check

# Slice B Web UI States tests (preserved on feat/feat-com-06)
pnpm --filter @shipde/web exec tsx src/tests/attachments-page-states.test.ts
```

## Residual limitations

- Direct browser-to-S3 presigned multipart upload for multi-gigabyte files remains deferred to FEAT-COM-04.
- Antivirus sidecar daemon container orchestration (ClamAV) is managed via infrastructure deployment; application provides deep polyglot content inspection and quarantine status.
