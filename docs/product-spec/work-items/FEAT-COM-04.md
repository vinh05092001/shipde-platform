# FEAT-COM-04 — Imports

## Control

| Field | Value |
| --- | --- |
| Work Item / Feature | `FEAT-COM-04` |
| Status | `READY_FOR_CODEX` |
| Delivery order | 23 |
| Assigned author | `GEMINI` |
| Risk | HIGH — tenant data, permissions and potentially financial records |
| Branch | `feat/feat-com-04` |
| Reviewer | Codex — fresh independent task |
| Pull Request | `#469` |

## Business outcome and sources

Authorized users can upload and inspect imports, understand validation issues, and trace an immutable revision. The feature catalog defines templates, preview, row errors, checksum and revisions (`MASTER-FEATURE-CATALOG.md`, FEAT-COM-04). `DATA-LIFECYCLE-IMPORTS.md`, Import lifecycle and Lineage, requires private storage, malware check, hash, validation, staging, explicit promotion and source lineage; missing/invalid keys and control-total mismatches block promotion. `STATE-MACHINES.md`, Import and audit run, defines the lifecycle. `SCREEN-SPECIFICATIONS.md`, SCR-IMPORT-01, requires mapping preview, counts, control totals, issues and revision history. `INTERNAL-API.md`, Resource groups, identifies `/imports`; `ERROR-IDEMPOTENCY-RETRY.md` defines `IMPORT_BLOCKED`. `RBAC-APPROVAL-MATRIX.md` requires server-side permission and tenant, branch, warehouse and carrier-account scope. Canonical row schemas are in `contracts/imports/`.

## Preconditions and human decisions

The register records `TASK-FOUND-04`, `FEAT-RBAC-01` and `FEAT-RBAC-02` as MERGED.

HUMAN DECISION (operator delegated product decisions to the coordinator on 2026-10-29; record verbatim in the Work Item, replacing the blocking questions):
1. Scope of FEAT-COM-04: a shared import framework (template download, CSV/XLSX upload, malware/size/type checks from config, parse, validate, preview with per-row issues and control totals, immutable revisions, explicit promotion) plus the first two templates: branches and warehouses (non-financial entities that already exist). Order, shipment, carrier statement, COD and any money-related imports are OUT of scope and belong to the later FEAT-IMP-* Work Items.
2. Identity and idempotency: an import is identified by (tenant, template type, file checksum). Same checksum again returns the existing import and its result (no duplicate work). Changed content creates a new immutable revision of that import. A retry with the same idempotency key returns the same result; the same key with different content returns 409 CONFLICT. Only the latest fully validated revision can be promoted; promotion is explicit, all-or-nothing per revision, and audited.
3. Permissions and scope: upload, preview, job status, row results and report require the target entity's own manage permission (iam:shop_config for branches/warehouses); promotion requires the same permission plus FEAT-RBAC-02 scope for every affected row. A row with a missing, unknown or ambiguous scope identifier is a row error and is never guessed; rows outside the actor's scope are rejected per row.

## Intended boundary

After the decisions above, a GEMINI author should implement the approved backend slice: private upload and validation, preview, durable asynchronous processing with per-row outcomes and downloadable issue report, idempotency, revision lineage, server-side tenant and per-row permission/scope checks, audit and canonical errors. No invalid blocking row may enter a promoted snapshot, and no excluded row may disappear without an issue. Raw data stays immutable and PII must not appear in audit or logs. UI and domain-specific ingestion boundaries require the decision above; this backend slice alone does not establish completion of the vertical feature.

Allowed paths and exact API, event, migration, configuration and consumer contracts must be set after those decisions; validators and gate configurations are excluded. `9ROUTER` is inappropriate for tenant isolation, authorization and financial data. No production behavior is authorized by this blocked draft.

## Acceptance matrix

| AC | Scenario | Expected result | Evidence required | Status |
| --- | --- | --- | --- | --- |
| COM-04-01 | Authorized user obtains a template and uploads a supported file (branches/warehouses) | Approved version and format are used; private storage, hash and malware check recorded; staging created | API and unit/integration tests | PASS — Verified in `imports.unit.spec.ts` & `imports.supertest.spec.ts` |
| COM-04-02 | Invalid file format, size exceeds config limit, or malware scanner detects threat | Canonical failure (400/422); no unsafe staging or promotion | Negative validation tests | PASS — Verified in `imports.unit.spec.ts` (malware, size, MIME type check) |
| COM-04-03 | File has valid rows and invalid keys, missing scopes, or invalid formats | Preview and issue report identify each excluded row with severity; status set to BLOCKED; promotion blocked | Row-level and control-total tests | PASS — Verified in `imports.unit.spec.ts` (missing scopes, duplicate keys, BLOCKED status) |
| COM-04-04 | Optional data is missing | Nonblocking issue marked WARNING; dependent data marked incomplete; staging succeeds | Validation and preview tests | PASS — Verified in `imports.unit.spec.ts` (WARNING severity, DATA_INCOMPLETE) |
| COM-04-05 | Summary stats and durable row results | Control totals (total, valid, error, warning) match row breakdown; durable rows queryable with pagination | Row results and report tests | PASS — Verified in `imports.unit.spec.ts` (control totals, paginated rows) |
| COM-04-06 | Idempotency and checksum deduplication | Same checksum returns existing import without re-processing; same idempotency key with different content returns 409 CONFLICT | Idempotency and dedupe tests | PASS — Verified in `imports.unit.spec.ts` & `imports.supertest.spec.ts` (checksum dedupe, 409 IDEMPOTENCY_CONFLICT) |
| COM-04-07 | User lacks permission or row scope, or accesses another tenant | Server denies access (403/404); promotion strictly verifies FEAT-RBAC-02 scope for every affected row; missing or unscoped row blocks promotion | Permission and per-row scope tests | PASS — Verified in `imports.unit.spec.ts` (FEAT-RBAC-02 per-row scope checks, 403 SCOPE_UNAUTHORIZED) |
| COM-04-08 | Revision is promoted or superseded | Explicit promotion applies all-or-nothing mutations to domain entities (branches/warehouses); marks revision PROMOTED and prior revisions SUPERSEDED | Promotion and state transition tests | PASS — Verified in `imports.unit.spec.ts` & `imports.supertest.spec.ts` (all-or-nothing mutations, PROMOTED and SUPERSEDED states) |
| COM-04-09 | Import action audited | Audit log records IMPORT_PROMOTED with masked PII and actor context; canonical errors include correlation ID | Audit and error tests | PASS — Verified in `imports.unit.spec.ts` (PII-masked audit logging, correlation ID) |
| COM-04-10 | SCR-IMPORT-01 UI presentation | Web UI states show truthful results and usable recovery | UI acceptance tests | PASS — Verified in `imports-page-states.test.ts` (SCR-IMPORT-01 UI states: loading, empty, error, forbidden, detail, control totals, row issues) |

## Verification and review

Run the API unit and supertest test suites, `node scripts/ai/check-no-hardcode.mjs`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, and verify contracts with `pnpm contract:check`.

## Residual limitations

None. Shared backend import framework and Web UI (SCR-IMPORT-01) for branches and warehouses are complete. Financial imports (order, shipment, carrier statement, COD) remain in separate backlog items (FEAT-IMP-*).
