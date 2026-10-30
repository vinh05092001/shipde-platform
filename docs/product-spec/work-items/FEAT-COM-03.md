# FEAT-COM-03 — Permission-aware bulk actions

## Control

| Field | Value |
| --- | --- |
| Work Item ID / Feature ID | `FEAT-COM-03` |
| Status | `READY_FOR_CODEX` |
| Delivery order | 22 |
| Dependencies | `TASK-FOUND-04`, `FEAT-AUTH-01`..`06`, `FEAT-USR-01`, `FEAT-USR-02`, `FEAT-RBAC-01`, `FEAT-RBAC-02`, `FEAT-ORG-01` |
| Assigned author | `GEMINI` |
| Risk | HIGH — authorization, tenant isolation, privilege ceiling and destructive action safety |
| Allowed paths | `apps/api/src/` relevant bulk and action modules and tests; `apps/web/src/` relevant components, pages and tests; `apps/web/package.json`; `packages/contracts/src/`; `packages/config/src/`; `prisma/schema.prisma` and migrations; `docs/product-spec/contracts/openapi.yaml`; this Work Item and its register row |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/feat-com-03` |
| Pull Request | #468 |

## Business outcome and sources

Operators can execute authorized bulk actions on multiple records across organizational entities, observe per-item progress and granular truthful outcomes, and recover or retry individual failures without re-running successful items.

### Operator decision

> [!IMPORTANT]
> **HUMAN DECISION (operator, 2026-10-29, delegated to coordinator: optimise for user experience):**
> FEAT-COM-03 scope:
> 1. **Shared bulk-action framework**:
>    - Multi-select in lists (server endpoints and data contracts in this backend run; UI next run).
>    - Server endpoint accepting up to a configured max limit of IDs (`BULK_ACTION_MAX_ITEMS` in configuration, failing closed if exceeded).
>    - Per-item result (succeeded / failed with canonical error code and message).
>    - Idempotency key handling (`Idempotency-Key` header or body parameter, request hashing, replay protection, conflict detection).
>    - One immutable, tenant-scoped audit record per mutated item with PII/phone/email masked and secrets excluded.
>    - Partial-failure UX contract returning `failed_ids` and `succeeded_ids` enabling retry of failed items only.
>    - Explicit confirmation step for destructive actions (`confirm: true` required for `deactivate`).
>    - Permission and FEAT-RBAC-02 resource scope (`store_scopes`, `warehouse_scopes`) evaluated server-side per item.
> 2. **First actions on existing entities**:
>    - `users`: activate, deactivate (suspend with session revocation & last-owner protection), assign branch/warehouse scopes (with privilege ceiling enforcement), export selected rows (RFC 4180 CSV).
>    - `branches`: activate, deactivate (default branch protection), export selected rows (CSV).
>    - `warehouses`: activate, deactivate (default warehouse protection), export selected rows (CSV).
> 3. **Exclusions**: Orders, shipments, and carrier actions are strictly OUT of scope for this item (deferred to later features requiring asynchronous approval and financial reconciliation).

### Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — DEC-002: Tenant and scope isolation.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — FEAT-COM-03: Bulk actions ("Permission-aware, progress and partial failure report").
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — Non-negotiable product rules: strict tenant isolation, no cross-tenant existence oracle.
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Server-side permission and scope enforcement; privilege ceiling rules.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Canonical error envelope, correlation ID, idempotency key convention.
- `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` — Idempotency conflict (409), canonical error codes.

## Preconditions and dependencies

- Foundation identity, tenancy, roles, and scope foundation items (`TASK-FOUND-04`, `FEAT-AUTH-01`..`06`, `FEAT-USR-01`, `FEAT-USR-02`, `FEAT-RBAC-01`, `FEAT-RBAC-02`, `FEAT-ORG-01`) are merged in the delivery register.
- Permission catalog includes `iam:manage_users` and `iam:shop_config`.
- User model supports `store_scopes` and `warehouse_scopes`.
- The earlier blocker note is cleared pursuant to the operator decision of 2026-10-29.

## Author boundary and scope

Gemini implements:
1. Shared bulk action framework module (`apps/api/src/bulk/`) with NestJS controller, service, DTOs, and lifecycle wiring.
2. Configuration validation for `BULK_ACTION_MAX_ITEMS` (default 100, bounded 1..1000, fail closed if invalid).
3. Entity action handlers for:
   - `users`: activate, deactivate (suspend), assign_scopes (`store_scopes`, `warehouse_scopes`), export_csv.
   - `branches`: activate, deactivate, export_csv.
   - `warehouses`: activate, deactivate, export_csv.
4. Database model and migration for `bulk_action_batches` to persist idempotency keys, request hashes, per-item execution summaries, and statuses.
5. Entity models and migrations for `Branch` and `Warehouse` (compatible with `FEAT-ORG-02` and `FEAT-WH-01` schemas) to enable concrete execution and verification.
6. Server-side RBAC and FEAT-RBAC-02 scope checks per item:
   - Unauthorized items fail with canonical `FORBIDDEN` / `SCOPE_FORBIDDEN` without aborting remaining valid items.
   - Privilege ceiling enforced: actor cannot assign branch/warehouse scopes they do not hold.
7. Truthful per-item result response envelope with `succeeded_ids`, `failed_ids`, and granular item errors.
8. One tenant-scoped audit record per mutated item with phone/email masked.
9. Comprehensive unit tests and Supertest test suite.
10. Contracts and OpenAPI schema updates.

Out of scope:
- UI components (scheduled for next run).
- Bulk actions on orders, shipments, or carrier accounts (explicitly deferred).

## Business rules and edge cases

- `BR-COM03-01`: Every bulk action requires valid session authentication and tenant membership (`merchant_id`).
- `BR-COM03-02`: Maximum item cap is loaded from configuration (`BULK_ACTION_MAX_ITEMS`). Submissions exceeding the cap fail closed with 400 `VALIDATION_ERROR` (`MAX_ITEMS_EXCEEDED`). Submissions with empty ID list fail closed with 400 `VALIDATION_ERROR` (`EMPTY_ID_LIST`).
- `BR-COM03-03`: Each item is executed independently. Failure of one item (e.g., non-existent, forbidden scope, business rule violation) does not roll back or abort other valid items. Response HTTP status is 200 OK with `is_partial_failure: true` when mixed outcomes occur.
- `BR-COM03-04`: Cross-tenant target IDs return 404 `ITEM_NOT_FOUND` to prevent existence discovery across tenant boundaries.
- `BR-COM03-05`: Idempotency keys prevent double execution. Identical replay (same tenant, operation, key, request hash) returns the cached outcome immediately. Replay with modified payload fails with 409 `IDEMPOTENCY_CONFLICT`.
- `BR-COM03-06`: Destructive actions (e.g. `deactivate`) require explicit confirmation (`confirm: true`). Submissions without confirmation fail closed with 400 `CONFIRMATION_REQUIRED`.
- `BR-COM03-07`: Privilege ceiling: non-owner actor cannot assign store or warehouse scopes broader than their own granted scopes (unless holding wildcard `*`).
- `BR-COM03-08`: User deactivation enforces safety invariants: self-deactivation is prohibited (`SELF_SUSPENSION_PROHIBITED`), sole active owner cannot be deactivated (`CANNOT_REMOVE_LAST_OWNER`), and active device sessions are revoked.
- `BR-COM03-09`: Branch and warehouse deactivation prevent deactivating the tenant's current default entity (`CANNOT_DEACTIVATE_DEFAULT_BRANCH` / `CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE`).
- `BR-COM03-10`: Every mutated item generates exactly one audit log entry scoped to the tenant, with sensitive PII masked.
- `BR-COM03-11`: Unsupported entity types (e.g. `orders`, `shipments`) fail closed with 400 `UNSUPPORTED_BULK_ENTITY`.

## Acceptance matrix

| AC / Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-COM-03-01` | Bulk action execution with valid items | 200 OK; all items processed; `results` list each item `SUCCEEDED`; `success_count` equals total; `failed_ids` empty | Unit & Supertest integration tests |
| `AC-COM-03-02` | Selection contains valid and failing items (partial failure) | 200 OK; truthful per-item outcomes; `is_partial_failure: true`; `succeeded_ids` and `failed_ids` clearly partitioned | Unit & Supertest integration tests |
| `AC-COM-03-03` | Item belongs to another tenant or does not exist | Item outcome is `FAILED` with 404 `ITEM_NOT_FOUND`; no cross-tenant data leaked or modified | Multi-tenant isolation test |
| `AC-COM-03-04` | Actor lacks permission for entity type | 403 `FORBIDDEN` for entire request before any mutation | RBAC permission test |
| `AC-COM-03-05` | Actor has restricted store/warehouse scope and targets items outside scope | Scoped items fail with 403 `SCOPE_FORBIDDEN`; authorized items succeed | Scope enforcement test |
| `AC-COM-03-06` | Replay request with same idempotency key and matching payload | 200 OK; cached batch result returned without re-executing mutations | Idempotency replay test |
| `AC-COM-03-07` | Replay request with same idempotency key and altered payload | 409 `IDEMPOTENCY_CONFLICT`; no mutation executed | Idempotency conflict test |
| `AC-COM-03-08` | Request exceeds configured `BULK_ACTION_MAX_ITEMS` or provides empty list | 400 `VALIDATION_ERROR` with canonical field errors; zero mutations | Validation negative test |
| `AC-COM-03-09` | Destructive action submitted without `confirm: true` | 400 `CONFIRMATION_REQUIRED`; zero mutations | Destructive confirmation test |
| `AC-COM-03-10` | Bulk user deactivation protects last owner and prevents self-deactivation | Target user violating rule reports failure (`CANNOT_REMOVE_LAST_OWNER` / `SELF_SUSPENSION_PROHIBITED`); other users deactivate | Business invariant test |
| `AC-COM-03-11` | Bulk assign scopes enforces actor privilege ceiling | Attempting to assign unheld scopes reports failure; valid assignments update `store_scopes` and `warehouse_scopes` | Privilege ceiling test |
| `AC-COM-03-12` | Bulk export selected rows to CSV | 200 OK; returns valid CSV formatted string with correct headers, escaped fields, and masked PII | CSV export test |
| `AC-COM-03-13` | One audit log recorded per mutated item | `audit_logs` table contains exactly one record per succeeded item with masked PII and actor ID | Audit trail test |
| `AC-COM-03-14` | Unsupported entity requested (orders / shipments) | 400 `UNSUPPORTED_BULK_ENTITY` with actionable explanation | Negative entity test |
| `AC-COM-03-15` | Bulk action UI in users, branches, and warehouses lists with multi-select | Checkboxes rendered on header & rows; selection count badge updates accurately | Web UI state test (`bulk-actions-states.test.ts` S2, S9, S10) |
| `AC-COM-03-16` | Action bar appearance and buttons | Rendered on selection; displays actions for entity type; clear selection resets | Web UI state test (`bulk-actions-states.test.ts` S2, S9, S10) |
| `AC-COM-03-17` | Destructive action confirmation dialog | Explicit warning of session revocation & guards; requires confirmation click before API call | Web UI state test (`bulk-actions-states.test.ts` S4) |
| `AC-COM-03-18` | In-flight progress state indicator | Progress indicator/spinner displayed during processing | Web UI state test (`bulk-actions-states.test.ts` S5) |
| `AC-COM-03-19` | Per-item truthful results report modal | Granular success/failure badges, canonical error codes and Vietnamese explanations | Web UI state test (`bulk-actions-states.test.ts` S6, S7) |
| `AC-COM-03-20` | Partial failure state & retry failed items only | Partial failure banner; retry button filters selection to `failed_ids` only | Web UI state test (`bulk-actions-states.test.ts` S6) |
| `AC-COM-03-21` | UI permission enforcement from API (no hardcoded roles) | User permissions checked dynamically; unauthorized/unknown users fail closed | Web UI state test (`bulk-actions-states.test.ts` S1, S3) |
| `AC-COM-03-22` | Accessibility (a11y) standards gate | Zero a11y violations across all components | `tsx scripts/verify-a11y.ts` |

## Verification commands

```bash
# Configuration & Hardcode checks
node scripts/ai/check-no-hardcode.mjs

# Accessibility Gate
pnpm exec tsx scripts/verify-a11y.ts

# Formatting
pnpm exec prettier --check docs/product-spec/work-items/FEAT-COM-03.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv apps/api/src/bulk/* apps/web/src/components/bulk/* apps/web/src/tests/bulk-actions-states.test.ts packages/config/src/* packages/contracts/src/*

# TypeScript compilation
pnpm typecheck

# Linting
pnpm lint

# Backend Unit tests
pnpm --filter @shipde/api exec tsx --test src/bulk/bulk.unit.spec.ts

# Supertest HTTP integration tests
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/bulk/bulk.supertest.spec.ts

# Frontend Web tests
pnpm --filter @shipde/web test
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| Round 1 | 9d15ae6 | PASS (Backend) | Initial implementation of bulk framework, DB model, migration, RBAC scope enforcement and first actions |
| Round 2 | da6a04b | READY_FOR_CODEX | Complete Step 2 Web UI for users, branches, warehouses lists: multi-select, action bar, confirm step for destructive actions, per-item results with retry of failed items only, progress and partial-failure states, API permission derivation without role hardcodes, and web tests per state |
| Round 3 | da6a04b | CHANGES_REQUIRED | Address review P0/P1 findings |
| Round 4 | Current | READY_FOR_CODEX | Fix review findings P0/P1: restore origin/main ORG-02 atomic default branch and ci-gate; add atomic bulk idempotency reservation upfront; move last-owner count and default branch/warehouse check inside transaction with row lock; fix supertest cleanup, IDEMPOTENCY_CONFLICT, SELF_SUSPENSION_PROHIBITED, export_csv RFC 4180 format, branch/warehouse fixture schemas; remove hardcoded roles from UserManagementTab and bulk.service; fetch live tenant branches and warehouses with fallback; fix default store flag to boolean; link real settings pages for warehouse creation and branch/warehouse edit; fix scope overlap rejection on empty scopes and enforce carrier_account_scopes ceiling; fix assign scopes modal and optimistic status; remove duplicate matrix bulk bar. |

## Residual limitations

- None (Backend framework, entity action handlers, and web UI with multi-select, action bar, destructive confirmation, progress state, per-item results, partial-failure retry, and permission enforcement from API are fully implemented and verified).
- Orders, shipments, and carrier actions are intentionally excluded pending asynchronous approval workflows.
