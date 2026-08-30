# Ship Dễ — Prototype Gaps and Risks Assessment

**Work Item:** `TASK-FOUND-01`
**Target Consumer:** `TASK-FOUND-02` (Monorepo migration), `TASK-FOUND-03` (Backend & DB scaffolding), and Codex Reviewer
**Execution Date:** 2026-08-27

---

## 1. Overview and Purpose

This document catalogs all known security, architectural, data consistency, and operational gaps in the current Next.js prototype. It establishes the technical risk baseline before `TASK-FOUND-02` migrates the codebase to a monorepo structure.

None of the gaps documented below are to be resolved inside `TASK-FOUND-01`. Instead, they are explicitly recorded to ensure future Foundation (`TASK-FOUND-02`, `TASK-FOUND-03`, `TASK-FOUND-04`) and vertical feature Work Items address them systematically without regression.

---

## 2. Risk & Gap Inventory by Dimension

### 2.1 Security & Authentication Gaps

| Area                              | Current Prototype State                                                                                                                                       | Risk Severity | Target Resolution Work Item                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------- |
| **Session & Token Management**    | `AuthContext.tsx` uses a static hardcoded token (`jwt_shipde_session_token_prod_9981`) and default in-memory user (`defaultUser`) when localStorage is empty. | `HIGH`        | `TASK-FOUND-03`, `FEAT-AUTH-03`, `FEAT-AUTH-06` |
| **Password Storage & Validation** | `src/server/db.ts` stores plain/simulated password strings. Login does not hash or verify with bcrypt/Argon2.                                                 | `HIGH`        | `TASK-FOUND-03`, `FEAT-AUTH-03`                 |
| **Brute Force & Rate Limiting**   | No login attempt rate limiting, IP throttling, or CAPTCHA/anti-abuse integration.                                                                             | `MEDIUM`      | `FEAT-AUTH-01`, `FEAT-AUTH-03`                  |
| **Secrets in Code**               | No production secrets found. Pinned mock credentials (e.g. `ghn_token_••••••••••••9842`) are safe placeholders verified by `npm run security:secrets`.        | `LOW`         | Verified by `TASK-FOUND-01` baseline            |

### 2.2 Multi-Tenant Isolation & Authorization Scope Gaps

| Area                                | Current Prototype State                                                                                                                                                      | Risk Severity | Target Resolution Work Item                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------- |
| **Server-Side Tenant Scoping**      | API Route Handlers (`src/app/api/**`) do not extract or cryptographically verify `merchant_id` from request headers/JWT. They query the singleton `ShipDeDatabase` directly. | `CRITICAL`    | `TASK-FOUND-03`, `FEAT-RBAC-01`, `FEAT-RBAC-02` |
| **Branch & Warehouse RBAC Scoping** | Role scopes (`store_scopes`, `warehouse_scopes`) exist in UI state and Prisma models but are not enforced by server-side query filters.                                      | `HIGH`        | `FEAT-RBAC-02`, `FEAT-ORG-02`, `FEAT-WH-01`     |
| **Maker-Checker Enforcement**       | Financial maker-checker rule (BR-12: creator cannot self-approve discrepancy) is correctly enforced in `MakerCheckerEngine`, but currently operates in memory only.          | `MEDIUM`      | `TASK-FOUND-03`, `FEAT-RATE-03`, `FEAT-CAS-01`  |

### 2.3 PII, Masking & Audit Logging Gaps

| Area                         | Current Prototype State                                                                                                                                       | Risk Severity | Target Resolution Work Item    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| **PII Data Leakage via API** | Recipient phone numbers are masked in the UI (`ShipmentListTab.tsx`), but the underlying API (`/api/shipments`) returns unmasked raw phone numbers in JSON.   | `HIGH`        | `FEAT-SEC-01`                  |
| **Audit Log Persistence**    | PII unmasking and discrepancy approvals emit audit events to an in-memory array (`ShipDeDatabase.audit_logs`). All audit history is lost upon server restart. | `HIGH`        | `TASK-FOUND-03`, `FEAT-ADM-03` |
| **Audit Tamper-Resistance**  | No cryptographic hash chaining or append-only write constraints on audit logs in the prototype runtime.                                                       | `MEDIUM`      | `FEAT-ADM-03`                  |

### 2.4 Hard-Coded Business Logic & Static Constants

| Area                            | Current Prototype State                                                                                                                    | Risk Severity | Target Resolution Work Item    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ------------------------------ |
| **Store Branches List**         | `STORES_LIST` in `src/app/page.tsx` hardcodes 4 store locations (HCM-Q3, HCM-TB, HN-CG, DN-HC).                                            | `LOW`         | `FEAT-ORG-02`                  |
| **Platform Metric Assumptions** | `LedgerCalculator` uses hardcoded formulas (e.g. `500 orders = 1h accounting saved`, `uptime = 99.8%`) for demo display.                   | `LOW`         | `FEAT-DASH-01`, `FEAT-REP-01`  |
| **Carrier Rate Tiers**          | Default rate cards in `src/server/db.ts` use static JSON tiers rather than dynamically queried contract rates with effective date filters. | `MEDIUM`      | `FEAT-RATE-02`, `FEAT-RATE-04` |

### 2.5 In-Memory Mutation & State Persistence Gaps

| Area                           | Current Prototype State                                                                                                                                               | Risk Severity | Target Resolution Work Item |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- |
| **Ephemeral Database Storage** | `ShipDeDatabase` (`src/server/db.ts`) is an in-memory class singleton. Creating an order, scanning a return, or resolving a discrepancy does not write to PostgreSQL. | `HIGH`        | `TASK-FOUND-03`             |
| **Prisma Schema Drift**        | `prisma/schema.prisma` is well-formed with 17 domain models, but has no applied migrations or active connection to a running database container.                      | `HIGH`        | `TASK-FOUND-03`             |
| **Optimistic Locking**         | Version checks exist in domain logic (`MakerCheckerEngine`), but cannot be verified under concurrent PostgreSQL transactions until `TASK-FOUND-03`.                   | `MEDIUM`      | `TASK-FOUND-03`             |

### 2.6 Simulated Carrier Integrations & External Effects

| Area                        | Current Prototype State                                                                                                                                      | Risk Severity | Target Resolution Work Item                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------- |
| **Mock Carrier Execution**  | GHN and GHTK adapters (`src/adapters/*.ts`) simulate network delays with `setTimeout` and generate synthetic order codes. No real carrier sandbox is called. | `MEDIUM`      | `TASK-FOUND-04`, `FEAT-CAR-02`, `FEAT-SHP-02` |
| **Webhook HMAC Validation** | Webhook endpoint (`/api/shipments`) parses payloads without validating HMAC-SHA256 signatures or secret headers.                                             | `HIGH`        | `FEAT-TRK-01`                                 |
| **Idempotency Key Caching** | Idempotency caching is stored in a JavaScript `Map` in memory; a server restart clears the cache and risks duplicate execution.                              | `HIGH`        | `TASK-FOUND-03`, `FEAT-SHP-02`                |

### 2.7 Data Lineage, Imports & Bank Matching Gaps

| Area                                 | Current Prototype State                                                                                                                                 | Risk Severity | Target Resolution Work Item                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- |
| **Raw File Preservation**            | Carrier statements are parsed directly from memory; raw files are not archived to S3/MinIO object storage.                                              | `HIGH`        | `TASK-FOUND-03`, `FEAT-IMP-01`, `FEAT-IMP-04` |
| **Bank Statements & COD Allocation** | Bank statement parsing (`FEAT-IMP-05`), exact reference matching (`FEAT-BNK-01`), and multi-waybill COD allocation (`FEAT-BNK-03`) are not implemented. | `MEDIUM`      | `FEAT-IMP-05`, `FEAT-BNK-01`, `FEAT-BNK-03`   |
| **Dormant Statement Upload Modal**   | `UploadStatementModal` is mounted in `src/app/page.tsx` with dormant state; no trigger button exists in `ReconciliationTab.tsx` in baseline prototype.  | `LOW`         | `TASK-FOUND-03`, `FEAT-IMP-01`                |

### 2.8 Test Realism & Verification Findings

| Area                            | Current Prototype State                                                                                                                                                                                        | Finding & Mitigation                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **E2E Scenario Test Structure** | `src/tests/e2e-scenarios.test.ts` executes in-memory domain engines sequentially. It provides strong unit/integration coverage of business rules (BR-01 to BR-51), but does not drive a real headless browser. | Browser E2E with Playwright is scheduled for `TASK-FOUND-04`.                                          |
| **Date Drift in Test Fixtures** | Fixed delivery dates (e.g. `2026-08-15`) in `src/tests/comprehensive-rules.test.ts` drifted past the 3-day SLA relative to real system time.                                                                   | Repaired in `TASK-FOUND-01` by adding explicit `cod_paid_at` timestamps to non-overdue test shipments. |
| **Preservation Smoke Harness**  | Introduced in `TASK-FOUND-01` (`src/tests/preservation-smoke.test.ts`) covering 10 critical surfaces to detect regression during `TASK-FOUND-02`.                                                              | Verified passing (10/10) with negative proof test support.                                             |

---

## 3. Reusable Prototype Assets (Preservation Guide for `TASK-FOUND-02`)

The following UI components, layouts, domain engines, and type definitions represent substantial, high-quality domain modeling that **must not be discarded or rewritten** during the monorepo migration in `TASK-FOUND-02`:

1. **Core Domain Engines (`src/core/`):**
   - `ExceptionEngine`: SLA deadline calculation, priority scoring, redelivery lock.
   - `MatchingEngine`: 3-key reconciliation matching with threshold alerts (<95%).
   - `ReconciliationEngine`: 6 discrepancy audit rules (D1 weight, D2 freight, D4 duplicate, D5 COD mismatch, D6 overdue COD, D7 missing row).
   - `ThreeLedgersCalculator`: 3 Value Ledgers calculation with strict non-mixing validation (BR-45).
   - `MakerCheckerEngine`: Maker-Checker financial segregation and period immutability.
   - `OfflineScanQueueManager`: Idempotent offline return scan sync with duplicate elimination.
2. **Domain & Error Contracts (`src/types/`):**
   - `domain.ts`: Comprehensive TypeScript domain models.
   - `error-codes.ts`: `ERROR_CATALOG` with HTTP status codes and bilingual messages.
   - `ledger.ts`: Types for the Three Value Ledgers and validation helpers.
3. **Operational UI Components (`src/components/`):**
   - `ControlTowerTab.tsx`: Primary dashboard layout and KPI presentation.
   - `ShipmentListTab.tsx`: Multi-filter shipment management table with PII unmask toggle.
   - `ExceptionWorkboxTab.tsx`: Prioritized rescue workbox with urgency badges.
   - `ReconciliationTab.tsx`: Discrepancy management workbench with period controls.
   - `ThreeLedgersTab.tsx`: 3-ledger financial report view with drill-down tables.
   - `ReturnScanTab.tsx`: Return parcel receiving workbench with condition checklist.
   - `ClaimCasesTab.tsx`: Carrier dispute case tracker with countdown timers.
   - `UnifiedTrackingModal.tsx`: Visual waybill timeline and carrier event mapping.
4. **Database Schema (`prisma/schema.prisma`):**
   - 17 PostgreSQL models with multi-tenant foreign keys, indexes, unique constraints, and optimistic locking fields (`version`).
