# FEAT-COM-05 — Exports

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-COM-05` |
| Feature ID      | `FEAT-COM-05` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 24 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-ORG-01` (merged), `FEAT-WH-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `database ownership`, `rbac`, `audit`, `pii protection`, `async export jobs` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-COM-05.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/*`, `packages/config/src/*`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/package.json`, `apps/api/src/app.module.ts`, `apps/api/src/exports/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-com-05-api` (Slice A), `feat/feat-com-05` (Slice B) |
| Pull Request    | #482 (Slice A), #470 (Slice B) |

## Slice A (API)

- **Delivery Slice**: Slice A — Server-side API, Persistence, Generators, and Contracts.
- **Branch**: `feat/feat-com-05-api` (Pull Request #482).
- **Scope**:
  - PostgreSQL schema and migration for `export_jobs` table (`prisma/schema.prisma`, `prisma/migrations/20261031023737_feat_com_05_export_jobs/migration.sql`).
  - Shared domain contracts and enumerations (`packages/contracts/src/exports.ts`, `packages/contracts/src/index.ts`).
  - Configuration schema, validations, and resolvers for export limits and TTL (`packages/config/src/index.ts`).
  - Compliant zero-dependency multi-format generators:
    - CSV (`apps/api/src/exports/generators/csv.generator.ts`): RFC 4180 escaping, UTF-8 BOM, metadata header, formula injection neutralization.
    - XLSX (`apps/api/src/exports/generators/xlsx.generator.ts`): SpreadsheetML workbook with dedicated `Data` and `Metadata` sheets.
    - PDF (`apps/api/src/exports/generators/pdf.generator.ts`): PDF 1.4 document with generation metadata box, tabular columnar layout, page wrapping, and trailer checksum.
  - Complete backend module, controller, DTOs, and service (`apps/api/src/exports/`):
    - Strict server-side tenant isolation (404 on cross-tenant requests).
    - Dynamic capability-based RBAC enforcement for all resources (`users`, `warehouses`, `audit_logs`, `ledgers`).
    - Per-row FEAT-RBAC-02 warehouse scoping on generation and download.
    - Fail-closed PII protection with `maskIdentifier` unless actor holds `pii:unmask`.
    - Truthful SHA-256 data payload checksum and binary file checksum.
    - Asynchronous & synchronous job execution lifecycle, TTL expiration (410 `EXPORT_EXPIRED`), and tenant-scoped stale job recovery.
    - Atomic transaction commit for job creation and mandatory initial `EXPORT_REQUESTED` audit log.
    - Immutable audit trails for `EXPORT_REQUESTED` and `EXPORT_DOWNLOADED`.
- **Acceptance IDs Covered in Slice A**:
  - `AC-COM-05-01`: Create export job with valid parameters.
  - `AC-COM-05-02`: Export users to CSV (RFC 4180).
  - `AC-COM-05-03`: Export warehouses to XLSX.
  - `AC-COM-05-04`: Export ledgers to PDF.
  - `AC-COM-05-05`: FEAT-RBAC-02 scoped actor exports warehouses.
  - `AC-COM-05-06`: Actor lacking resource permission requests export (403 FORBIDDEN).
  - `AC-COM-05-07`: Actor queries or downloads export from another tenant (404 EXPORT_NOT_FOUND).
  - `AC-COM-05-08`: Download completed export file.
  - `AC-COM-05-09`: Download pending/processing export (409 EXPORT_NOT_READY).
  - `AC-COM-05-10`: Invalid format or resource requested (400 VALIDATION_ERROR).
  - `AC-COM-05-11`: DTO rejects non-string types on string fields (400 VALIDATION_ERROR).
  - `AC-COM-05-12`: Audit log recorded for export creation and download.
  - `AC-COM-05-13`: Actor with `pii:unmask` receives unmasked identifiers.
- **What Remains for Slice B (Web UI - PR #470)**:
  - `AC-COM-05-14`: Web UI `ExportModal` (`apps/web/src/components/ExportModal.tsx`) with all 8 AGENTS.md states (idle, loading, empty, validation, forbidden, partial/clamped, success, error/recovery).
  - `AC-COM-05-15`: Web UI `ExportsSettingsPage` (`apps/web/src/app/settings/exports/page.tsx`) history console, filters, and triggers.
  - Automated Web UI test suite (`apps/web/src/tests/exports-page-states.test.ts`).

## Business outcome

Operators, accountants, warehouse supervisors, and shop owners can export operational and financial records into standardized, downloadable file formats (RFC 4180 CSV, Spreadsheet XML/XLSX, and structured PDF) with full generation metadata, server-enforced tenant isolation, per-row FEAT-RBAC-02 scope enforcement, role-based PII masking, and immutable audit trails.

Key business capabilities delivered:
1. **Multi-Format Generation with Embedded Metadata**: Every export produces compliant CSV (with UTF-8 BOM and RFC 4180 escaping), XLSX (SpreadsheetML with dedicated Data and Metadata worksheets), or PDF (structured document with metadata header and tabular records). Every file embeds immutable generation metadata: unique Export ID, generation timestamp, tenant identifier, requesting user ID & role, applied filters, rule version, total row counts, and cryptographic SHA-256 integrity checksum.
2. **Permission-Aware Resource Authorization**: Exporting operational entities requires the corresponding platform capability permission (e.g. `iam:manage_users` for users, `iam:shop_config` for warehouses, `audit:view` for audit logs, and `reconciliation:view_contract_rates` or `reconciliation:run_review_audit` for financial ledgers). Authorization is strictly evaluated via dynamic RBAC capabilities without hardcoded role name bypasses.
3. **FEAT-RBAC-02 Per-Row Scope Enforcement**: Scoped operators (e.g. users restricted to specific warehouse IDs or codes via `User.warehouse_scopes` without `*`) only receive data rows belonging to their authorized scopes. Out-of-scope rows are excluded from the exported file and truthfully reported in per-row execution results (`row_results`).
4. **Automated PII Protection**: Requesters who do not hold the sensitive `pii:unmask` capability have personal identity information (phone numbers, email addresses, tax numbers) automatically masked via `maskIdentifier` before serialization into export files and audit logs.
5. **Asynchronous Job Lifecycle & Per-Row Results**: Export jobs track clear lifecycles (`PENDING` -> `PROCESSING` -> `COMPLETED` / `FAILED`), record execution progress (`total_rows`, `processed_rows`, `succeeded_rows`, `failed_rows`), store detailed per-row outcomes, and provide secure, tenant-scoped download endpoints.
6. **Immutable Audit Trail**: Every export creation (`EXPORT_REQUESTED`) and download (`EXPORT_DOWNLOADED`) creates an immutable tenant-scoped record in `audit_logs` capturing actor identity, client IP, export resource, format, record counts, and filter parameters with masked PII.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-COM-05`: Exports ("Permission-aware CSV/XLSX/PDF with generation metadata").
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — `DEC-002`: Strict tenant isolation; `DEC-016`: Shared contracts and validation.
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — Non-negotiable product rules: strict tenant isolation, no cross-tenant existence oracle.
- `docs/product-spec/docs/02-business/NOTIFICATIONS-REPORTS.md` — Section `REP-SEC-01`: "Sensitive views, exports, deletes and support access. Every summary supports drill-down to underlying records, calculation and source lineage. Export includes generation time, filters and data/rule version."
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Export PII/finance": Owner full action (`A`), Finance scoped (`S`), others denied (`–`). Rule: "Permission evaluation includes tenant, branch, warehouse and carrier-account scope".
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — "Export with filter/version metadata".
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — API conventions, canonical error envelope, correlation ID, tenant scoping.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Sensitive data masking in UI/log/export; PII classification controls view/export permissions; immutable audit logging.
- `docs/product-spec/docs/06-architecture/ADR.md` — Async job processing for reports and exports.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract verification tools, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, establishing `merchants` baseline table, user credentials, and audit logging primitives.
- `FEAT-AUTH-06` is merged, providing `SessionGuard` and session resolution.
- `FEAT-RBAC-01` is merged, establishing dynamic roles, `PermissionsGuard`, `@RequirePermissions`, and capability catalog (`iam:shop_config`, `iam:manage_users`, `audit:view`, `pii:unmask`).
- `FEAT-RBAC-02` is merged, establishing `User.warehouse_scopes` and scope validation primitives.
- `FEAT-ORG-01` is merged, providing tenant organization profile and audit masking patterns.
- `FEAT-WH-01` is merged, establishing `warehouses` table, warehouse scopes, and warehouse management operations.

## Author boundary

`GEMINI` is assigned because `FEAT-COM-05` delivers a multi-tenant backend vertical slice including:
1. Persistence model (`export_jobs` table) with Prisma schema definition and migration.
2. Shared TypeScript contracts and OpenAPI specifications for exports.
3. Clean zero-dependency format generators for RFC 4180 CSV, SpreadsheetML XLSX, and conformant PDF 1.4.
4. Server-side tenant scoping, resource-specific permission checks, and per-row FEAT-RBAC-02 scope enforcement.
5. PII masking for actors lacking `pii:unmask`.
6. Async job tracking with per-row truthful outcomes and download streaming.
7. Immutable audit logging for export creation and download.
8. Comprehensive unit and Supertest automated test suites.

## In scope

1. **Database Persistence & Migration**:
   - `export_jobs` table in PostgreSQL and `ExportJob` model in `prisma/schema.prisma`.
   - Fields: `id` (UUID), `merchant_id` (UUID), `user_id` (UUID), `resource` (string), `format` (string: csv, xlsx, pdf), `status` (string: pending, processing, completed, failed), `filters` (JSON), `total_rows` (int), `processed_rows` (int), `succeeded_rows` (int), `failed_rows` (int), `row_results` (JSON), `file_name` (string), `file_size_bytes` (int), `checksum_sha256` (string), `file_data` (Bytes), `error_code` (string), `error_message` (string), `rule_version` (string), `created_at` (timestamptz), `completed_at` (timestamptz), `expires_at` (timestamptz).
   - Indexes: `@@index([merchant_id, status])`, `@@index([merchant_id, created_at])`.
2. **Format Generators (`apps/api/src/exports/generators/`)**:
   - `CsvGenerator`: RFC 4180 compliant CSV generator with UTF-8 BOM (`\uFEFF`), metadata comment banner, proper comma/quote/newline escaping, and CRLF line endings.
   - `XlsxGenerator`: SpreadsheetML XML workbook generator containing a `Data` worksheet and a dedicated `Metadata` worksheet with generation details.
   - `PdfGenerator`: Valid PDF 1.4 document generator with generation metadata box, tabular columnar layout, page header/footer, and trailer checksum.
3. **API Endpoints (`apps/api/src/exports/`)**:
   - `POST /api/v1/exports` (and `/exports`): Request a new export job. Accepts `resource` (`users`, `warehouses`, `audit_logs`, `ledgers`), `format` (`csv`, `xlsx`, `pdf`), `filters`, and optional `sync` execution flag.
   - `GET /api/v1/exports` (and `/exports`): List tenant's export jobs with pagination, status filter, and resource filter.
   - `GET /api/v1/exports/:id` (and `/exports/:id`): Get export job status, execution progress, metadata, and per-row results.
   - `GET /api/v1/exports/:id/download` (and `/exports/:id/download`): Download generated file with appropriate Content-Type, Content-Disposition, and checksum header.
4. **Resource Handlers & Scoping**:
   - Resource `users`: requires `iam:manage_users`.
   - Resource `warehouses`: requires `iam:shop_config`. Enforces `User.warehouse_scopes` per row; out-of-scope warehouses are excluded and reported in `row_results`.
   - Resource `audit_logs`: requires `audit:view`.
   - Resource `ledgers`: requires `reconciliation:view_contract_rates` or `reconciliation:run_review_audit`.
   - PII masking: If actor lacks `pii:unmask`, phone numbers, emails, and sensitive identifiers are masked via `maskIdentifier`.
5. **Audit Logging**:
   - Creates `EXPORT_REQUESTED` and `EXPORT_DOWNLOADED` entries in `audit_logs` table with actor context, client IP, resource, format, and masked metadata.
6. **Contracts & OpenAPI**:
   - Export contracts in `@shipde/contracts` (`packages/contracts/src/exports.ts`).
   - OpenAPI schemas in `docs/product-spec/contracts/openapi.yaml` and `packages/contracts/src/openapi.ts`.
7. **Automated Verification**:
   - Unit tests (`exports.unit.spec.ts`): DTO validation, CSV/XLSX/PDF generation, checksum computation, PII masking, RBAC permissions, FEAT-RBAC-02 per-row scoping, tenant isolation, and audit logging.
   - Supertest integration tests (`exports.supertest.spec.ts`): HTTP endpoint verification, download streaming, and error envelopes.

8. **Web UI Implementation & State Coverage (`apps/web/`)**:
   - `ExportModal` (`apps/web/src/components/ExportModal.tsx`): Accessible, fully featured modal dialog supporting resource selection (`users`, `warehouses`, `audit_logs`, `ledgers`), format selection (`csv`, `xlsx`, `pdf`), date ranges, carrier filter, and row clamping.
   - Proves all 8 required AGENTS.md states:
     - `Idle`: Accessible form configuration with `role="dialog"`, `aria-modal="true"`.
     - `Loading`: `aria-busy="true"` spinner and processing feedback.
     - `Empty`: 0 records matched notification with "Điều chỉnh bộ lọc" recovery button.
     - `Validation error`: `role="alert"` inline feedback and `aria-invalid="true"`.
     - `Forbidden`: Clear 403 capability/scope rejection message with "Chọn tài nguyên khác" recovery button.
     - `Partial / Clamped`: `role="alert"` warning banner displaying metadata truncation note while preserving direct download access.
     - `Success`: Metadata summary card (records, format, SHA-256 checksum, size) and primary download trigger.
     - `Error & Recovery`: Server/network failure notification with actionable "Thử lại" retry button.
   - `ExportsSettingsPage` (`apps/web/src/app/settings/exports/page.tsx`): Comprehensive export history and management console with status badges, resource filter toolbar, and modal trigger.
   - `exports-page-states.test.ts` (`apps/web/src/tests/exports-page-states.test.ts`): Automated test suite verifying all 9 UI states and accessibility invariants via `renderToStaticMarkup`.

## Out of scope

- Order and shipment export (deferred to order management features).
- External cloud storage upload (MinIO/S3 sync) for multi-gigabyte datasets (in-database storage with TTL covers platform baseline).

## Business rules and edge cases

- `BR-COM05-01`: Tenant isolation is mandatory. An actor can only create, list, inspect, and download exports within their authenticated `merchant_id`. Inquiries for export IDs belonging to other tenants return 404 `EXPORT_NOT_FOUND` (no existence oracle).
- `BR-COM05-02`: Resource export requires appropriate capability permissions. Unauthorized requests are rejected immediately with 403 `FORBIDDEN`.
- `BR-COM05-03`: FEAT-RBAC-02 scope enforcement is applied per row. For scoped entities (such as warehouses), rows outside the actor's permitted `warehouse_scopes` are omitted from the export data and recorded as `failed`/`skipped` with `SCOPE_FORBIDDEN` in `row_results`.
- `BR-COM05-04`: PII protection is fail-closed. Requesters without `pii:unmask` receive masked phone numbers and emails (`maskIdentifier`).
- `BR-COM05-05`: Supported formats are strictly `csv`, `xlsx`, and `pdf`. Unsupported format requests fail with 400 `UNSUPPORTED_FORMAT`.
- `BR-COM05-06`: Supported resources are strictly `users`, `warehouses`, `audit_logs`, and `ledgers`. Unsupported resources fail with 400 `UNSUPPORTED_RESOURCE`.
- `BR-COM05-07`: Generation metadata is mandatory in all export formats and must include: Export ID, generated at timestamp, tenant ID, requester user ID & role, filter parameters, rule version, total row count, and SHA-256 checksum.
- `BR-COM05-08`: Export downloads must verify job completion. Downloading a job that is still `PENDING` or `PROCESSING` returns 409 `EXPORT_NOT_READY`. Downloading a `FAILED` job returns 400 `EXPORT_FAILED`.
- `BR-COM05-09`: Export job requests enforce configured `EXPORT_MAX_ROWS`. Requests yielding more rows than allowed fail closed or clamp to the limit with explicit status note.
- `BR-COM05-10`: Every export request and download is recorded in immutable tenant audit logs with masked PII.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-COM-05-01` | Create export job with valid parameters | 201 Created; job created with `status: completed` (or pending); metadata populated; total_rows accurate | Unit & Supertest tests (Slice A) |
| `AC-COM-05-02` | Export users to CSV (RFC 4180) | 200 OK; valid CSV formatted with UTF-8 BOM; metadata banner; properly escaped fields; PII masked if no `pii:unmask` | Unit CSV generator test (Slice A) |
| `AC-COM-05-03` | Export warehouses to XLSX | 200 OK; valid SpreadsheetML XML workbook with Data sheet and Metadata sheet | Unit XLSX generator test (Slice A) |
| `AC-COM-05-04` | Export ledgers to PDF | 200 OK; valid PDF 1.4 syntax (`%PDF-1.4`); metadata header; table layout; `%%EOF` trailer | Unit PDF generator test (Slice A) |
| `AC-COM-05-05` | FEAT-RBAC-02 scoped actor exports warehouses | Only permitted warehouses appear in file; unpermitted warehouses recorded as `SCOPE_FORBIDDEN` in `row_results` | Unit scope test (Slice A) |
| `AC-COM-05-06` | Actor lacking resource permission requests export | 403 `FORBIDDEN` with canonical error; zero export rows generated | Unit RBAC test (Slice A) |
| `AC-COM-05-07` | Actor queries or downloads export from another tenant | 404 `EXPORT_NOT_FOUND`; zero data leaked | Multi-tenant isolation test (Slice A) |
| `AC-COM-05-08` | Download completed export file | 200 OK; streaming response with correct Content-Type, Content-Disposition, and X-Export-Checksum header | Supertest download test (Slice A) |
| `AC-COM-05-09` | Download pending/processing export | 409 `EXPORT_NOT_READY` with actionable retry advice | Supertest lifecycle test (Slice A) |
| `AC-COM-05-10` | Invalid format or resource requested | 400 `VALIDATION_ERROR` with canonical field errors; zero job created | DTO validation negative test (Slice A) |
| `AC-COM-05-11` | DTO rejects non-string types on string fields | 400 `VALIDATION_ERROR` with `INVALID_TYPE` (never 500) | DTO type safety test (Slice A) |
| `AC-COM-05-12` | Audit log recorded for export creation and download | `audit_logs` contains `EXPORT_REQUESTED` and `EXPORT_DOWNLOADED` with masked PII | Audit log test (Slice A) |
| `AC-COM-05-13` | Actor with `pii:unmask` receives unmasked identifiers | Phone and email in export appear in plaintext | PII privilege test (Slice A) |
| `AC-COM-05-14` | Web UI ExportModal state coverage | All 8 required AGENTS.md states (idle, loading, empty, validation, forbidden, partial, success, error) rendered and verified | `exports-page-states.test.ts` (Slice B — PR #470) |
| `AC-COM-05-15` | Web UI ExportsSettingsPage history and triggers | History table renders with status badges, resource filter toolbar, and launch button | `exports-page-states.test.ts` (Slice B — PR #470) |

## Verification commands

```bash
# Configuration & Hardcode checks
node scripts/ai/check-no-hardcode.mjs

# Formatting
pnpm exec prettier --check docs/product-spec/work-items/FEAT-COM-05.md apps/api/src/exports/* apps/web/src/components/ExportModal.tsx apps/web/src/app/settings/exports/page.tsx apps/web/src/tests/exports-page-states.test.ts packages/config/src/* packages/contracts/src/*

# TypeScript compilation
pnpm typecheck

# Linting
pnpm lint

# Unit tests
pnpm --filter @shipde/api exec tsx --test src/exports/exports.unit.spec.ts

# Supertest HTTP integration tests
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/exports/exports.supertest.spec.ts

# Web UI states tests
pnpm --filter @shipde/web exec tsx src/tests/exports-page-states.test.ts
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| Round 1 | 32ca8ec3463c1a4cd7c5286a14d14be5a1b193a8 | CHANGES_REQUIRED | Initial implementation of exports backend vertical slice; review flagged out-of-date diff, fabricated ledger metrics, resource RBAC omission on get/list/download, OWNER role bypass, checksum mismatch, lifecycle/sync issues, PDF data dropping, and lack of HTTP integration proofs. |
| Round 2 | bca303acacbc25a1dfadeb3e29cf05f1f059e7ce | CHANGES_REQUIRED | Merged origin/main cleanly; replaced hardcoded ledger metrics with real persisted tenant data (claims, exception cases, shipments, discrepancies); enforced resource capability RBAC across get, list, and download; eliminated hardcoded OWNER role bypasses across RBAC, PII masking, and warehouse scoping; implemented truthful SHA-256 data payload checksum and authentic file checksum; implemented real job lifecycle with dto.sync, EXPORT_LIMIT_EXCEEDED enforcement, query filtering, and FAILED status capture; rewritten PDF generator with multi-page support; expanded Supertest suite. |
| Round 3 | d68f55ea2ba952dd30870ad697ebcb6d8880d090 | CHANGES_REQUIRED | Addressed findings from review.txt: (1) Fail-closed PII protection for historical unmarked exports on download without pii:unmask; (2) Background stale job recovery with tenant scoping; (3) Multi-page PDF generation with measured text wrapping, dynamic column widths, and UTF-16BE hex diacritics; (4) Formula injection neutralization for CSV metadata banner; (5) Sanitization of persisted raw filters to prevent PII leaks; (6) Scheduled retention cleanup for expired exports; (7) Authentic serialized-payload checksum preservation in generation_metadata; (8) Atomic export job and audit log commit via transaction; (9) Complete Web UI implementation with 100% state coverage (ExportModal, ExportsSettingsPage) and automated test suite. |
| Round 4 | bc19fee293f5316ebb60f48d96235a4532d178e2 | CHANGES_REQUIRED | Extracted server-side slice into Slice A (API) on branch `feat/feat-com-05-api` (PR #482); CI reported contract drift and test failures due to unsynchronized openapi.ts types. |
| Round 5 | `0676f76f242eb2d98c36e8a9fce0a97257acc9ba` | CHANGES_REQUIRED | PR #482 review leaves prior P1 closures unverified and identifies the missing local diagnostics binding and oversized PDF row clipping. Successful current-application and application-gate results are not established; the previous CI-green claim is withdrawn. |

## PR #482 review repair evidence (2026-11-02)

The repair is local and uncommitted, based on the reviewed SHA above. No CI or independent review PASS is claimed. The negative tests below are present; application and HTTP execution remain blocked by the local sandbox permissions described after the table.

| Review finding | Repair and negative coverage |
| --- | --- |
| P1 #1: ledger download scope | Generation persists the effective warehouse, branch and carrier-account scopes with the completed file. Unit and HTTP tests reject restricted downloaders for unrestricted files and files outside their branch, warehouse or carrier-account scope; HTTP assertions also inspect the persisted scope snapshot. |
| P1 #2: empty scopes | Empty warehouse, branch and carrier-account scopes deny requests and downloads. Generation rechecks warehouse scope before reading rows. Unit tests also reject empty persisted ledger scopes; HTTP tests exercise empty actor scopes and an empty stored branch scope. |
| P1 #3: audit masking | Request and download audit filters are masked regardless of `pii:unmask`. Unit and HTTP tests put emails, dotted phone numbers, adjacent numbers and date-prefixed PII inside the permitted `city` filter and reject plaintext audit values. Internal markers are excluded from download audits. |
| P1 #4: Vietnamese PDF rendering | Embedded fonts and glyph mappings are checked in unit tests. The independent PDF reader verifies Vietnamese text and both embedded font programs; the generated pages were rendered and visually inspected. |
| P1 #5: PII marker race | The generation-time permission decision controls both file content and the marker in one conditional completion write. Unit and HTTP tests grant and revoke the real permission during data retrieval, assert the marker and bytes share that write, and deny download of an unmasked file after revocation. |
| P1 #6: partial recovery | Existing calculation and persisted HTTP fixture separate 500,000 VND accepted from 100,000 VND recovered and assert 400,000 VND outstanding. Unit negatives cover partial recovery, over-recovery without a negative remainder and rejected claims. Execution of these application tests is still required. |
| P1 #7: maintenance and worker race | Only PENDING jobs can be claimed. Completion and failure require the worker's lease identity; maintenance respects live lease expiry. Unit and HTTP tests pause an active worker during real maintenance, reject a competing worker, and verify a reclaimed job remains FAILED without published bytes. Unit coverage also replaces ownership during generation. |
| P1 #8: application evidence and invalid fixture | The persisted stale fixture uses schema-valid `created_at` and no `updated_at`. The unsupported CI-green statement is removed. Required application checks remain blocked, so this finding is not claimed closed. |
| P1 #9 and new diagnostics P1 | The HTTP suite locally imports its diagnostics helper. Shared redaction masks URL user-info and credential query parameters and hides malformed URLs. Negative tests verify cleanup before CI failure and exclude plaintext credentials from the diagnostic. |
| P1: XLSX compatibility | The OOXML workbook includes a Normal style. Independent JSZip tests enable CRC verification and reject legacy, truncated, corrupted and incomplete packages. The independently executed openpyxl tests read values and metadata and reject legacy XML and a missing workbook part. |
| New P1: oversized PDF rows | Font-measured wrapping and row continuation preserve every cell line above the footer. Unit and independent reader tests cover 80 unique lines and 12,000 unbroken wide glyphs. Running the reviewed generator against the same boundary criterion demonstrates its off-page regression. |

The application regressions are in `apps/api/src/exports/exports.unit.spec.ts` and `apps/api/src/exports/exports.supertest.spec.ts`. Independent format checks use `apps/api/src/exports/exports.files.spec.cjs` and `apps/api/src/exports/exports.files.spec.py` with openpyxl 3.1.5 and pypdf 6.18.0:

```powershell
node --experimental-vm-modules apps/api/src/exports/exports.files.spec.cjs .oc/exports-file-evidence .oc/legacy-pdf.generator.ts
python apps/api/src/exports/exports.files.spec.py .oc/exports-file-evidence
```

The legacy generator input is the reviewed SHA's `apps/api/src/exports/generators/pdf.generator.ts`. Local artifacts are under `.oc/exports-file-evidence/`, including `vietnamese.pdf`, `long-row.pdf`, `wide-row.pdf` and the rendered `contact-sheet.png`.

| Check | Observed result |
| --- | --- |
| Independent source fixtures and diagnostics negatives | PASS; actual generator sources produced the XLSX/PDF fixtures and unavailable-database cleanup/redaction assertions passed. |
| Independent openpyxl/pypdf checks | PASS; 7 tests, including all 80 lines and all 12,000 wide glyphs, plus the reviewed generator's failing page-boundary criterion. |
| `pnpm lint` | BLOCKED before project checks: `EPERM` opening the installed Turbo entry point. |
| `pnpm typecheck` | BLOCKED before compilation: `EPERM` opening the installed TypeScript entry point. |
| `pnpm --filter @shipde/api test` | BLOCKED: installed TSX entry point is inaccessible (`EPERM`, also reproduced by `tsx --version`) and Docker engine access is denied. No application or live HTTP passing result is established. |
| `git diff --check origin/main...HEAD` | PASS. |
| `git diff --check` | PASS for the local repair. |
| `node scripts/ai/check-no-hardcode.mjs` | BLOCKED: installed TypeScript ESLint parser cannot resolve. |

Docker Desktop was launched with its window hidden. `docker info` continues to fail with permission denied to the engine pipe, so this session could not start the three local database services. The cleanup command `docker stop shipde-postgres shipde-redis shipde-minio` was attempted and denied by the same pipe permissions. Registry access also fails with `EACCES`; reinstalling dependencies is unavailable in this sandbox. The required checks must pass before the repair commit; no push is authorized.

The pre-existing `legacy-javascript` lockfile version change is unrelated to this repair and remains unstaged; exclude it from the repair commit.

### Fresh continuation verification (2026-11-02)

The continuation preserved the existing uncommitted repair. `git fetch origin` failed because the sandbox cannot write the linked worktree's `FETCH_HEAD`, so the requested merge did not run. HEAD remains `0676f76f242eb2d98c36e8a9fce0a97257acc9ba`; local `origin/main` is `c6e71fcb9354cd2b14d1f5dcaed794abff306991`, with remote currency unverified.

The independent source-fixture command and all seven openpyxl/pypdf tests passed again. The legacy PDF input was verified against the reviewed Git blob (`ca0c290d72f18f118fbe68ff018c2bd7e7d4f56e`); its off-page regression is reproduced by the independent boundary test. These results do not establish application or HTTP acceptance, and no fresh raster rendering was available in this continuation.

Fresh `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd --filter @shipde/api test`, `pnpm.cmd test`, and focused export unit/HTTP commands all failed before their checks could execute, with `EPERM` on installed Turbo, TypeScript or TSX entry points. The no-hardcode command failed resolving its installed TypeScript ESLint parser. Both Git diff checks passed. Docker Desktop was launched hidden, but engine access remained denied; the final service-stop command was also denied. No commit or push was made.

The current finding-to-test-to-command matrix and all 15 acceptance-row statuses are recorded in `.oc/pr-body.md`. Historical PASS logs do not certify the current uncommitted changes. Required application gates and test-first red/green evidence remain outstanding.

### Known limitations requiring a decision

- `NEEDS_DECISION`: The linked `docs/product-spec/docs/06-architecture/ADR.md` ADR-004 includes exports in Redis/BullMQ scope, while current async export execution uses in-process `processExportJob` and `activeJobs`. No Slice A exception was found in this Work Item. Record an approved scoped exception or assign the queue implementation; the repair does not silently select a different architecture.

## Residual limitations

- In-app download push notification center is scheduled for a subsequent notifications Work Item; export modal and history console acceptance belongs to Slice B (PR #470) and is not certified by this API repair.
- Orders and shipments export will be linked when order/shipment domains are delivered.
