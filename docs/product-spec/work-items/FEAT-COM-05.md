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
| Allowed paths   | `docs/product-spec/work-items/FEAT-COM-05.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/*`, `packages/config/src/*`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/app.module.ts`, `apps/api/src/exports/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-com-05` |
| Pull Request    | #470 |

## Business outcome

Operators, accountants, warehouse supervisors, and shop owners can export operational and financial records into standardized, downloadable file formats (RFC 4180 CSV, Spreadsheet XML/XLSX, and structured PDF) with full generation metadata, server-enforced tenant isolation, per-row FEAT-RBAC-02 scope enforcement, role-based PII masking, and immutable audit trails.

Key business capabilities delivered:
1. **Multi-Format Generation with Embedded Metadata**: Every export produces compliant CSV (with UTF-8 BOM and RFC 4180 escaping), XLSX (SpreadsheetML with dedicated Data and Metadata worksheets), or PDF (structured document with metadata header and tabular records). Every file embeds immutable generation metadata: unique Export ID, generation timestamp, tenant identifier, requesting user ID & role, applied filters, rule version, total row counts, and cryptographic SHA-256 integrity checksum.
2. **Permission-Aware Resource Authorization**: Exporting operational entities requires the corresponding platform capability permission (e.g. `iam:manage_users` for users, `iam:shop_config` for warehouses, `audit:view` for audit logs, and `reconciliation:view_contract_rates` or `reconciliation:run_review_audit` for financial ledgers). Shop owners (`OWNER`) possess universal export rights across their tenant.
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
   - Resource `users`: requires `iam:manage_users` (or OWNER).
   - Resource `warehouses`: requires `iam:shop_config` (or OWNER). Enforces `User.warehouse_scopes` per row; out-of-scope warehouses are excluded and reported in `row_results`.
   - Resource `audit_logs`: requires `audit:view` (or OWNER).
   - Resource `ledgers`: requires `reconciliation:view_contract_rates` or `reconciliation:run_review_audit` (or OWNER).
   - PII masking: If actor lacks `pii:unmask` (and is not OWNER), phone numbers, emails, and sensitive identifiers are masked via `maskIdentifier`.
5. **Audit Logging**:
   - Creates `EXPORT_REQUESTED` and `EXPORT_DOWNLOADED` entries in `audit_logs` table with actor context, client IP, resource, format, and masked metadata.
6. **Contracts & OpenAPI**:
   - Export contracts in `@shipde/contracts` (`packages/contracts/src/exports.ts`).
   - OpenAPI schemas in `docs/product-spec/contracts/openapi.yaml` and `packages/contracts/src/openapi.ts`.
7. **Automated Verification**:
   - Unit tests (`exports.unit.spec.ts`): DTO validation, CSV/XLSX/PDF generation, checksum computation, PII masking, RBAC permissions, FEAT-RBAC-02 per-row scoping, tenant isolation, and audit logging.
   - Supertest integration tests (`exports.supertest.spec.ts`): HTTP endpoint verification, download streaming, and error envelopes.

## Out of scope

- UI export dialogs and download progress notifications (scheduled for web UI slice).
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
| `AC-COM-05-01` | Create export job with valid parameters | 201 Created; job created with `status: completed` (or pending); metadata populated; total_rows accurate | Unit & Supertest tests |
| `AC-COM-05-02` | Export users to CSV (RFC 4180) | 200 OK; valid CSV formatted with UTF-8 BOM; metadata banner; properly escaped fields; PII masked if no `pii:unmask` | Unit CSV generator test |
| `AC-COM-05-03` | Export warehouses to XLSX | 200 OK; valid SpreadsheetML XML workbook with Data sheet and Metadata sheet | Unit XLSX generator test |
| `AC-COM-05-04` | Export ledgers to PDF | 200 OK; valid PDF 1.4 syntax (`%PDF-1.4`); metadata header; table layout; `%%EOF` trailer | Unit PDF generator test |
| `AC-COM-05-05` | FEAT-RBAC-02 scoped actor exports warehouses | Only permitted warehouses appear in file; unpermitted warehouses recorded as `SCOPE_FORBIDDEN` in `row_results` | Unit scope test |
| `AC-COM-05-06` | Actor lacking resource permission requests export | 403 `FORBIDDEN` with canonical error; zero export rows generated | Unit RBAC test |
| `AC-COM-05-07` | Actor queries or downloads export from another tenant | 404 `EXPORT_NOT_FOUND`; zero data leaked | Multi-tenant isolation test |
| `AC-COM-05-08` | Download completed export file | 200 OK; streaming response with correct Content-Type, Content-Disposition, and X-Export-Checksum header | Supertest download test |
| `AC-COM-05-09` | Download pending/processing export | 409 `EXPORT_NOT_READY` with actionable retry advice | Supertest lifecycle test |
| `AC-COM-05-10` | Invalid format or resource requested | 400 `VALIDATION_ERROR` with canonical field errors; zero job created | DTO validation negative test |
| `AC-COM-05-11` | DTO rejects non-string types on string fields | 400 `VALIDATION_ERROR` with `INVALID_TYPE` (never 500) | DTO type safety test |
| `AC-COM-05-12` | Audit log recorded for export creation and download | `audit_logs` contains `EXPORT_REQUESTED` and `EXPORT_DOWNLOADED` with masked PII | Audit log test |
| `AC-COM-05-13` | Actor with `pii:unmask` receives unmasked identifiers | Phone and email in export appear in plaintext | PII privilege test |

## Verification commands

```bash
# Configuration & Hardcode checks
node scripts/ai/check-no-hardcode.mjs

# Formatting
pnpm exec prettier --check docs/product-spec/work-items/FEAT-COM-05.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv apps/api/src/exports/* packages/config/src/* packages/contracts/src/*

# TypeScript compilation
pnpm typecheck

# Linting
pnpm lint

# Unit tests
pnpm --filter @shipde/api exec tsx --test src/exports/exports.unit.spec.ts

# Supertest HTTP integration tests
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/exports/exports.supertest.spec.ts
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| Round 1 | Pending | In progress | Initial implementation of exports backend vertical slice |

## Residual limitations

- Web UI export modal and in-app download notification center are scheduled for subsequent UI work item.
- Orders and shipments export will be linked when order/shipment domains are delivered.
