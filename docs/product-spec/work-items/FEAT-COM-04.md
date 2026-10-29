# FEAT-COM-04 — Imports

## Control

| Field | Value |
| --- | --- |
| Work Item / Feature | `FEAT-COM-04` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | 23 |
| Assigned author | `GEMINI` |
| Risk | HIGH — tenant data, permissions and potentially financial records |
| Branch | `feat/feat-com-04` |
| Reviewer | Codex — fresh independent task |
| Pull Request | None |

## Business outcome and sources

Authorized users can upload and inspect imports, understand validation issues, and trace an immutable revision. The feature catalog defines templates, preview, row errors, checksum and revisions (`MASTER-FEATURE-CATALOG.md`, FEAT-COM-04). `DATA-LIFECYCLE-IMPORTS.md`, Import lifecycle and Lineage, requires private storage, malware check, hash, validation, staging, explicit promotion and source lineage; missing/invalid keys and control-total mismatches block promotion. `STATE-MACHINES.md`, Import and audit run, defines the lifecycle. `SCREEN-SPECIFICATIONS.md`, SCR-IMPORT-01, requires mapping preview, counts, control totals, issues and revision history. `INTERNAL-API.md`, Resource groups, identifies `/imports`; `ERROR-IDEMPOTENCY-RETRY.md` defines `IMPORT_BLOCKED`. `RBAC-APPROVAL-MATRIX.md` requires server-side permission and tenant, branch, warehouse and carrier-account scope. Canonical row schemas are in `contracts/imports/`.

## Preconditions and blocking questions

The register records `TASK-FOUND-04`, `FEAT-RBAC-01` and `FEAT-RBAC-02` as MERGED. `BACKLOG-DEPENDENCIES.md` identifies foundation as the dependency of import and order epics. The register separately lists `FEAT-IMP-01` through `FEAT-IMP-05` and `FEAT-SRC-02` as BACKLOG; it does not establish their interface or ordering relative to this shared feature.

Product owner must resolve the following before implementation and update the authoritative specification and this matrix:

1. Which import types and concrete templates are delivered by FEAT-COM-04, and which staging, normalization, promotion and domain writes belong to the later import Work Items? The three row schemas alone do not define CSV/XLSX columns, mapping or control totals.
2. What identifies a logical import and revision, and what are the intended outcomes for the same checksum, changed content, retry with the same idempotency key, and a conflicting key? When may a revision supersede another?
3. Which resource/action permissions and scope dimensions apply to upload, preview, job status, row results, report, promotion and each supported row type? How are absent or ambiguous row scope identifiers resolved without exposing unauthorized data?
4. What are the template versions, file constraints, mapping and control-total rules, issue severity and error-report contents for each supported type? How are invalid or unscoped rows represented without leaking sensitive data?
5. What are the supported malware-check and private-storage dependencies, failure/recovery behavior, and retention policy? What job retry and actor authorization semantics apply if permissions change while a job is pending?

These are unresolved product and interface decisions, not evidence that the listed foundation dependencies are unmerged. Until resolved, no import endpoint, job, persistence or promotion should be implemented on invented semantics.

## Intended boundary

After the decisions above, a GEMINI author should implement the approved backend slice: private upload and validation, preview, durable asynchronous processing with per-row outcomes and downloadable issue report, idempotency, revision lineage, server-side tenant and per-row permission/scope checks, audit and canonical errors. No invalid blocking row may enter a promoted snapshot, and no excluded row may disappear without an issue. Raw data stays immutable and PII must not appear in audit or logs. UI and domain-specific ingestion boundaries require the decision above; this backend slice alone does not establish completion of the vertical feature.

Allowed paths and exact API, event, migration, configuration and consumer contracts must be set after those decisions; validators and gate configurations are excluded. `9ROUTER` is inappropriate for tenant isolation, authorization and financial data. No production behavior is authorized by this blocked draft.

## Acceptance matrix

All rows are **NOT RUN** and conditional on approved contracts; they are requirements for the eventual full feature, not claims of implementation.

| AC | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| COM-04-01 | Authorized user obtains a template and uploads a supported file | Approved version and format are used; private object, hash and malware outcome are recorded | API and storage integration tests |
| COM-04-02 | Invalid file, unavailable scanner or missing configuration | Canonical failure; no unsafe staging or promotion | Negative integration tests |
| COM-04-03 | File has valid rows and invalid keys or control totals | Preview and issue report identify each excluded row; promotion is blocked | Row-level and control-total tests |
| COM-04-04 | Optional data is missing | Approved nonblocking issue is visible and dependent data is marked incomplete | Validation and preview tests |
| COM-04-05 | Async job processes mixed rows or fails and retries | Durable per-row results and truthful progress survive restart; no duplicate effects | Job integration and recovery tests |
| COM-04-06 | Upload or job request is retried or conflicts | Approved idempotency and checksum/revision rules hold under concurrency | Concurrent integration tests |
| COM-04-07 | User lacks permission or row scope, or accesses another tenant | Server denies access and effects; report and preview do not disclose unauthorized rows | Permission, scope and cross-tenant tests for every action |
| COM-04-08 | Revision is promoted or superseded | Approved transition preserves raw input, lineage and history; blocking errors prevent promotion | State transition and persistence tests |
| COM-04-09 | Import action succeeds or fails | Tenant-scoped audit records approved metadata without plaintext PII; canonical errors carry correlation ID | Audit and error tests |
| COM-04-10 | User encounters loading, empty, validation, forbidden, partial, error and recovery states | SCR-IMPORT-01 states show truthful results and usable recovery | UI acceptance tests and screenshots |

## Verification and review

Once implementation is authorized, run the relevant API and UI test suites, `node scripts/ai/check-no-hardcode.mjs`, formatting checks, `pnpm typecheck`, `pnpm lint`, and the approved acceptance path. Verify migrations, contracts and security boundaries. Record exact results and a fresh independent review of the final commit. No review or implementation evidence exists yet.

## Residual limitations

Blocked pending product-owner decisions above. Owner: product owner; risk: incorrect ingestion, unauthorized disclosure or financial lineage; next action: approve source-specific contracts and ownership boundaries. No human acceptance has been recorded.
