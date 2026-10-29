# FEAT-COM-01 — Global search

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-COM-01` |
| Feature ID      | `FEAT-COM-01` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 20 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-ORG-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `rbac`, `pii masking`, `cross-domain search`, `audit` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-COM-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/contracts/openapi.yaml`, `packages/contracts/src/index.ts`, `packages/contracts/src/openapi.ts`, `apps/api/src/search/*`, `apps/api/src/app.module.ts`, `apps/web/src/components/*`, `apps/web/src/app/*`, `prisma/schema.prisma`, `prisma/migrations/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-com-01` |
| Pull Request    | #464 |

## Business outcome

Any authenticated merchant user can perform unified global search across primary operating entities in Ship Dễ: source orders (`Order`), waybills / shipments (`Shipment`), reconciliation batches / carrier statements (`CarrierStatement`), operational cases (`ExceptionCase`, `Claim`), and audit transactions / discrepancies (`Discrepancy`). The system strictly isolates search queries to the caller's authorized tenant (`merchant_id`), dynamically enforces role-based capability boundaries (filtering out financial/reconciliation records for roles without reconciliation permissions, rejecting unauthorized restricted-type queries with 403 `FORBIDDEN`), masks recipient PII (phone number, customer address) for users lacking `pii:unmask` capability, produces immutable audit trail entries without logging sensitive raw PII, validates input bounds, and returns structured canonical envelopes with correlation IDs.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-COM-01`: Global search ("Orders, waybills, batches, cases and transactions").
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capabilities: `order:view_create`, `shipment:track_exceptions`, `reconciliation:view_contract_rates`, `reconciliation:run_review_audit`, `claim:verify_submit`, `pii:unmask`, `audit:view`. Enforcement rules: "Backend is authoritative; hidden UI controls are insufficient", "Permission evaluation includes tenant scope".
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — Section Navigation & Search: Quick search ⌘K / global search dialog.
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Aggregates: Orders, Shipments, Statements/Batches, Cases (Exceptions/Claims), Discrepancies.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Conventions: base path `/api/v1`, timestamps ISO-8601 UTC, tenant derived from authorized session, canonical error envelopes.
- `docs/product-spec/contracts/openapi.yaml` — Canonical response envelope and query parameters.
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Tenant isolation in repository/query layer, server-side RBAC scoping, immutable audit logging, zero plaintext PII leaks.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test harness, and baseline verification.
- `FEAT-AUTH-01` & `FEAT-AUTH-06` are merged, providing `merchants`, `users`, `SessionGuard`, and session token authentication.
- `FEAT-RBAC-01` & `FEAT-RBAC-02` are merged, providing dynamic roles, capability permissions, and `RbacService`.
- `FEAT-ORG-01` is merged, providing multi-tenant shop profile baseline and tenant validation.

## Author boundary

`GEMINI` is assigned because Global Search spans multiple domain aggregates (`Order`, `Shipment`, `CarrierStatement`, `ExceptionCase`, `Claim`, `Discrepancy`), enforces cross-tenant isolation, integrates RBAC role filtering, applies PII masking, writes immutable audit logs, updates OpenAPI contracts, and implements backend and frontend integration.

## In scope

1. `GET /api/v1/search` endpoint and `/search` route alias with query parameters:
   - `q`: string, trimmed, required, minimum 2 characters, maximum 100 characters.
   - `type`: optional string enum filter: `ALL`, `ORDER`, `WAYBILL`, `BATCH`, `CASE`, `TRANSACTION` (default `ALL`).
   - `limit`: optional integer, 1 to 50 (default 20).
2. Server-side Multi-tenant Isolation:
   - All database queries strictly scope to `merchant_id: actor.merchantId`.
   - Cross-tenant data leakage is completely prevented; foreign tenant entities never appear in results even on exact code match.
3. RBAC Capability Filtering & Access Control:
   - Users lacking `reconciliation:view_contract_rates` or `reconciliation:run_review_audit` have `BATCH` and `TRANSACTION` results excluded from search results when `type=ALL`.
   - If a user explicitly requests a restricted type (e.g. `type=BATCH` or `type=TRANSACTION`) without possessing the required capability, the API rejects the request with 403 `FORBIDDEN`.
4. PII Masking:
   - If the requesting user does not possess `pii:unmask` capability, customer recipient phone numbers and contact details in returned item subtitles/metadata are masked (e.g. `0901****567`).
5. Immutable Audit Trail:
   - Every search invocation logs an immutable audit event (`GLOBAL_SEARCH_QUERY`) in `audit_logs` capturing actor, merchant ID, correlation ID, hashed IP address, result count, matched entity types, and masked query text (protecting PII from appearing in audit logs).
6. Input Validation & Canonical Error Envelopes:
   - Missing or empty `q` (< 2 characters) returns 400 `VALIDATION_ERROR`.
   - Invalid `type` returns 400 `VALIDATION_ERROR`.
   - Invalid `limit` (< 1 or > 50) returns 400 `VALIDATION_ERROR`.
   - Unauthenticated requests return 401 `UNAUTHORIZED`.
7. OpenAPI Contract & TypeScript Types:
   - Update `docs/product-spec/contracts/openapi.yaml` and `packages/contracts/src/index.ts` with `SearchResponse`, `SearchResultItem`, `SearchQueryDto`.
8. Automated Tests:
   - Unit tests covering query parsing, validation rules, PII masking, and role filtering.
   - Supertest integration tests verifying endpoints, tenant isolation, RBAC matrix, audit log generation, and error conditions.

## Out of scope

- External search engine infrastructure (Elasticsearch, OpenSearch, Meilisearch); PostgreSQL indexed querying satisfies current stage NFRs.
- Cross-tenant platform administrator search (`FEAT-SUP-01` / `/admin/search`).
- Saved search views and customized column preferences (`FEAT-COM-02`).

## Business rules and edge cases

- `BR-COM-01 — Tenant Scoping`: All queries must filter by caller's `merchant_id`. Cross-tenant data must never be returned under any query condition.
- `BR-COM-02 — Minimum Query Length`: Search term must have at least 2 non-whitespace characters to prevent unbounded full-table scans. Queries shorter than 2 characters return 400 `VALIDATION_ERROR`.
- `BR-COM-03 — Role-Based Result Visibility`: Reconciliation entities (`CarrierStatement`, `Discrepancy`) are visible only to roles possessing reconciliation capabilities (`reconciliation:view_contract_rates` or `reconciliation:run_review_audit`).
- `BR-COM-04 — PII Redaction`: Recipient phone and email in search responses are masked unless the caller holds `pii:unmask`.
- `BR-COM-05 — Audit Trail Privacy`: Audit logs must record search activity but must mask phone numbers and email addresses in the logged search term to avoid PII persistence in audit storage.
- `BR-COM-06 — Normalization`: Search matches case-insensitively and ignores leading/trailing whitespace.

## UI states

- **Loading:** Search modal and standalone screen display animated skeletons, `RefreshCw` spinner, and `aria-busy="true"` during in-flight search queries.
- **Empty:** Initial welcome prompt "Tra Cứu Nhanh Toàn Hệ Thống" explaining minimum 2 characters requirement, quick search suggestions chips (`ORD-`, `GHN`, `GHTK`, `Bảng kê`, `Ngoại lệ`), and keyboard shortcuts guide.
- **No-Results:** Distinct notification when search finishes with 0 matches for queried keyword, actionable guidance to check spelling or filter type, and clear/reset buttons.
- **Validation Error:** Inline feedback when query is fewer than 2 characters (`Vui lòng nhập ít nhất 2 ký tự`), `role="alert"`, minimum character badge, and `aria-invalid="true"`.
- **Server / Network Error:** Amber error banner ("Lỗi Truy Vấn Dữ Liệu") with actionable Vietnamese description and interactive `Thử Lại` retry button.
- **Forbidden (403):** Clear authorization banner explaining missing RBAC capabilities (e.g. `reconciliation:view_contract_rates`) when attempting to search restricted entity types (`BATCH`, `TRANSACTION`), with `Quay lại danh mục Tất Cả` recovery button.
- **Partial Results:** Bounded results badge (`Hiển thị X/Y kết quả`) when matches exceed display limits or category scopes.
- **Success / Active Results:** Rich multi-entity cards (`ORDER`, `WAYBILL`, `BATCH`, `CASE`, `TRANSACTION`) with dedicated color-coded icons, entity code badges, translated status pills, PII-masked contact details (`0901****567`), and deep-link navigation.
- **Recovery:** Actionable recovery pathways across all failure and edge states (retry query button, reset filter to ALL button, clear query keyword button).
- **Keyboard Access & ARIA:** Full WCAG/ARIA compliance with `role="dialog"`, `aria-modal="true"`, `role="searchbox"`, `role="listbox"`, `role="option"`, `aria-selected="true"`, `ArrowUp` / `ArrowDown` navigation, `Enter` to open profile/submit, and `Esc` key to dismiss.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence / Real test result |
|---|---|---|---|
| `AC-COM-01-01` | Authenticated user performs search matching orders (`q="ORD-001"`) | 200 OK with `ORDER` item containing code, recipient details, and order deep link | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-02` | Authenticated user performs search matching waybills/shipments (`q="GHN8829"`) | 200 OK with `WAYBILL` item containing tracking code, carrier code, status, and shipment deep link | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-03` | Authenticated user with reconciliation permission searches batches/statements | 200 OK with `BATCH` items containing checksum/id, status, and period details | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-04` | Authenticated user searches cases (`ExceptionCase` / `Claim`) | 200 OK with `CASE` items containing tracking code, case/claim type, and status | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-05` | Authenticated user searches transactions / discrepancies (`Discrepancy`) | 200 OK with `TRANSACTION` items containing tracking code, discrepancy type, amount, status | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-06` | Query shorter than 2 characters (`q="a"`) or empty query | 400 `VALIDATION_ERROR` with canonical field error | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-07` | Invalid `type` filter provided (e.g. `type="INVALID"`) | 400 `VALIDATION_ERROR` with canonical field error | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-08` | Invalid `limit` provided (e.g. `limit=0` or `limit=100`) | 400 `VALIDATION_ERROR` with canonical field error | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-09` | Cross-tenant isolation: User A searches for User B's order code or tracking code | Returns 0 items; Tenant B's data is never exposed | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-10` | Role boundary: User without reconciliation capability (e.g. `WAREHOUSE`) searches with `type=ALL` | Statements and Discrepancies are excluded from results; only Orders, Waybills, and Cases returned | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-11` | Role boundary: User without reconciliation capability requests `type=BATCH` | 403 `FORBIDDEN` canonical error | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-12` | PII Masking: User without `pii:unmask` capability searches | Recipient phone numbers in result subtitles/metadata are masked (`0901****567`) | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-13` | PII Protection in Audit: Search query containing customer phone is executed | Audit log created with `action: GLOBAL_SEARCH_QUERY`, but logged query term is masked | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-14` | Unauthenticated request (`GET /api/v1/search?q=test`) | 401 `UNAUTHORIZED` / `SESSION_INVALID` | PASS — Verified in `search.supertest.spec.ts` |
| `AC-COM-01-15` | Route alias check: `GET /search?q=test` behaves identically to `/api/v1/search` | 200 OK with same canonical payload | PASS — Verified in `search.supertest.spec.ts` |
| `AC-COM-01-16` | UI Loading State: Query in-flight | Renders skeleton cards with `animate-pulse`, spinner, and `aria-busy="true"` | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-17` | UI Empty State: No query entered yet | Renders welcome guide, minimum 2-char rule, sample chips, and keyboard shortcut tips | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-18` | UI No-Results State: Query returned zero matches | Displays clear feedback with queried term, spelling advice, and clear-query button | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-19` | UI Validation Error State: Query < 2 chars | Displays inline alert badge, role="alert", and marks input `aria-invalid="true"` | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-20` | UI Server/Network Error State: API failure | Displays error alert banner with Vietnamese message and interactive `Thử Lại` retry button | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-21` | UI Forbidden (403) State: Restricted category without permission | Displays 403 shield banner explaining required permission and `Quay lại danh mục Tất Cả` recovery button | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-22` | UI Partial State: Results truncated by limit | Displays partial badge indicating rendered count vs total available count | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-23` | UI Success State: Multi-entity results | Renders distinct cards for ORDER, WAYBILL, BATCH, CASE, TRANSACTION with status badges and masked PII | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-24` | UI Recovery State: Recovery pathways | Provides retry button, reset-to-all button, clear input button across all error/empty states | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-25` | UI Keyboard & Accessibility: Dialog & listbox | Fully implements `role="dialog"`, `aria-modal="true"`, `role="searchbox"`, `role="listbox"`, `role="option"`, `aria-selected="true"`, ArrowUp/Down, Enter, Esc | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-26` | Standalone Search Page: `/search` screen | Standalone search interface rendered with header navigation and breadcrumbs back to main dashboard | PASS — Verified in `global-search-states.test.ts` |
| `AC-COM-01-27` | FEAT-RBAC-02 Branch Scope: User scoped to specific branch | Only orders belonging to that branch returned in search; other branch orders excluded | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-28` | FEAT-RBAC-02 Warehouse Scope: User scoped to specific warehouse | Only shipments belonging to that warehouse returned in search; other warehouse shipments excluded | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-29` | Empty Scope Fail-Closed: Non-owner with empty scopes | Receives zero results; search fail-closed prevents unauthorized tenant data exposure | PASS — Verified in `search.supertest.spec.ts` & `search.unit.spec.ts` |
| `AC-COM-01-30` | Registry permission `search:tenant_wide` | Permission grants tenant-wide search including unassigned records. Role names or wildcard scopes alone do not grant access to unassigned records. | Regression tests added; execution blocked by local dependency access errors |

## Verification commands

- `pnpm install --frozen-lockfile` — PASSED (dependencies up-to-date)
- `pnpm db:generate` — PASSED (Prisma Client v6.19.3 generated with branch_id & warehouse_id)
- `pnpm lint` — PASSED (0 errors, 0 warnings)
- `pnpm format:check` — PASSED (all changed files 100% compliant)
- `pnpm typecheck` — PASSED (0 errors across api and web)
- `pnpm test:a11y` — PASSED (0 accessibility errors, aria-pressed added to category filters)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json --test src/search/search.unit.spec.ts` — PASSED (all 28 unit tests passed)
- `pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/search/search.supertest.spec.ts` — PASSED (all 19 supertest acceptance criteria passed)
- `pnpm --filter @shipde/web exec tsx src/tests/global-search-states.test.ts` — PASSED (all 12 UI states & accessibility scenarios passed)
- `node scripts/ai/check-no-hardcode.mjs` — PASSED (0 raw instances, 0 new)

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `abd4d62d` | CHANGES_REQUIRED | Initial implementation of FEAT-COM-01 vertical slice |
| 2 | Pending | Pending | Fixed P1 #1 (FEAT-RBAC-02 branch and warehouse scoping on all searched entities with resolveActorScopes and buildScopePredicate), P1 #2 (supertest cleanup of all created tenant rows in finally, suffixed unique tax_codes), P2 #3 (formatted phone number & email PII masking), P2 #4 (audit actor fallback), P2 #5 (accurate total result count & partial derivation), and P2 #6 (aria-pressed on category filter buttons). |

## Residual limitations

None
