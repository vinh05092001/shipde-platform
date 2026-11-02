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
| Branch | `feat/feat-com-03-api` (Slice A) / `feat/feat-com-03` (Slice B) |
| Pull Request | #480 (Slice A) / #468 (Slice B) |

## Slice A (API)

Pursuant to operator decision (31/10 split) to decouple server-side foundation from user interface delivery, FEAT-COM-03 is partitioned into two sequential delivery slices:

### Scope of Slice A (PR #480)
- **Allowed paths**: `apps/api/src/bulk/`, `apps/api/package.json`, `packages/config/`, `packages/contracts/`, `packages/testkit/`, `prisma/schema.prisma`, `prisma/migrations/20261031120000_feat_com_03_bulk_operations/`, and `docs/product-spec/work-items/FEAT-COM-03.md`.
- **Framework & Endpoints**: POST `/api/v1/bulk-actions` supporting up to `BULK_ACTION_MAX_ITEMS` with fail-closed configuration validation.
- **Idempotency & Concurrency**: Atomic upfront idempotency reservation (`bulk_action_batches`) under tenant row lock (`FOR NO KEY UPDATE`), request hash verification, matching replay with re-verified resource scope, altered payload conflict detection (409 `IDEMPOTENCY_CONFLICT`), and safe resumption of interrupted `IN_PROGRESS` batches.
- **Savepoint Isolation**: Per-item PostgreSQL savepoints (`SAVEPOINT bulk_item_sp_${i}`) ensuring individual item failures do not abort sibling mutations or durable batch outcome persistence.
- **Business Operations**:
  - `users`: activate, deactivate (session revocation, last owner protection `CANNOT_REMOVE_LAST_OWNER`, self-deactivation guard `SELF_SUSPENSION_PROHIBITED`), assign_scopes (`store_scopes`, `warehouse_scopes` with privilege ceiling enforcement), export_csv (RFC 4180 format with masked PII).
  - `branches`: activate, deactivate (default branch protection `CANNOT_DEACTIVATE_DEFAULT_BRANCH`), export_csv.
  - `warehouses`: activate, deactivate (default warehouse protection `CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE`), export_csv.
- **Tenancy, RBAC & Audit**: Multi-tenant isolation server-side (404 `ITEM_NOT_FOUND` on foreign IDs), dynamic permission enforcement (`iam:manage_users`, `iam:shop_config`), FEAT-RBAC-02 scope checks per item, and exactly one tenant-scoped audit record per mutated item with phone/email masked.
- **Test coverage**: Unit test suite (`apps/api/src/bulk/bulk.unit.spec.ts`) and Supertest integration suite (`apps/api/src/bulk/bulk.supertest.spec.ts`) creating and tearing down isolated test tenants.

### Acceptance IDs Covered in Slice A
- `AC-COM-03-01`: Valid items bulk action execution and truthful outcome report.
- `AC-COM-03-02`: Partial failure handling with truthful `succeeded_ids` and `failed_ids` partitioning.
- `AC-COM-03-03`: Multi-tenant isolation (foreign or non-existent target IDs return 404 `ITEM_NOT_FOUND`).
- `AC-COM-03-04`: Server-side RBAC permission checks fail closed with 403 `FORBIDDEN`.
- `AC-COM-03-05`: FEAT-RBAC-02 store/warehouse scope checks per item (403 `SCOPE_FORBIDDEN`).
- `AC-COM-03-06`: Idempotency replay with matching payload returns cached batch result.
- `AC-COM-03-07`: Idempotency replay with altered payload fails with 409 `IDEMPOTENCY_CONFLICT`.
- `AC-COM-03-08`: DTO bounds validation (`MAX_ITEMS_EXCEEDED`, `EMPTY_ID_LIST`, `INVALID_UUID`).
- `AC-COM-03-09`: Destructive action confirmation guard (`CONFIRMATION_REQUIRED` when `confirm: true` is missing).
- `AC-COM-03-10`: User safety invariants (sole active owner protection, self-deactivation guard, session revocation).
- `AC-COM-03-11`: Privilege ceiling enforcement on scope assignment.
- `AC-COM-03-12`: RFC 4180 CSV export with masked PII and RFC 4180 multiline quote parsing.
- `AC-COM-03-13`: Immutable audit log trail with one record per mutated item and masked sensitive data.
- `AC-COM-03-14`: Unsupported entity rejection with 400 `UNSUPPORTED_BULK_ENTITY`.

### What Remains for Slice B (UI Slice)
- **Branch / PR**: `feat/feat-com-03` / PR #468.
- **Acceptance IDs**: `AC-COM-03-15` through `AC-COM-03-22`.
- **UI Components & Pages**: Multi-select table headers and row checkboxes, `BulkActionBar`, `BulkConfirmModal`, `BulkAssignScopesModal`, `BulkResultsModal`, and integration into `UserManagementTab` across users, branches, and warehouses lists.
- **UI States & Scenarios**: Selection counts, progress spinners, granular outcome badges, partial-failure retry workflow (retrying only failed IDs), dynamic API permission checking without hardcoded role strings, and axe-core accessibility compliance (`verify-a11y.ts`).

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

## PR #480 review repair evidence

The supplied review covers commit `69f4e4a8135d090b2f4d02a91b4e15f2c200cc02`. The repair remains an author change pending live API verification and fresh independent review.

| Finding / requirement | Change and negative evidence |
| --- | --- |
| P1 finding 1; finding 5 live savepoint evidence | The test trigger function declares no arguments, uses `TG_ARGV`, and is dropped with the matching no-argument signature. The PostgreSQL HTTP test injects a private row diagnostic, requires the healthy sibling and its sole audit to persist, and checks sanitized durable and replayed results. Live execution is pending Docker access. |
| P1 finding 2: Slice A boundary | Not reproduced in the actual PR delta. Merge base `2c4740afff4c456652b44867538162a02de980b7` already registers invitations, users, shops, branches, warehouses, onboarding and search. `git diff origin/main...HEAD -- apps/api/src/app.module.ts` adds only the necessary `BulkModule` import and registration. The delivery-register diff is empty. The isolated `BulkModule` HTTP test verifies bulk works while unrelated feature routes return 404. |
| P1 finding 3: database diagnostic disclosure | Only `CanonicalApiException` supplies public item errors. All other exceptions map to `INTERNAL_ERROR`; reservation, finalization and unrecoverable savepoint errors also receive a sanitized canonical envelope. HTTP negative tests cover canonical-looking database codes, spoofed error objects, null/undefined throws, durable batch data and matching replay without re-execution. |
| Finding 6: upfront reservation | New keyed batches reserve `IN_PROGRESS` under the tenant lock before item execution and are finalized with an update. Reservation failure and tenant-lock failure tests require zero item mutations/audits. The PostgreSQL trigger also rejects either target's update if no matching `IN_PROGRESS` reservation exists. |
| Empty scopes must deny | Execution and replay check the same store/warehouse scope policy. Empty actor or target scopes deny even owners and wildcard actors; a missing actor record also denies. Unit/HTTP negatives cover users, branches, warehouses and cached export disclosure. The PostgreSQL HTTP test covers empty grants and removal of complete forbidden multiline CSV records. |
| Audit metadata must always be masked | Every bulk audit before/after value passes recursive redaction. Structured identifier fields retain the shared mask; embedded phone/email/credentials are masked; free-form reasons are fully redacted to exclude opaque secrets. Negative tests cover all seven mutation handlers, nested scope arrays and unlabelled reason content. |
| Tenant predicates at write time | All seven item mutations, both batch-finalization paths and session deletion now include `merchant_id` in the write predicate. HTTP negative tests first failed when a target or batch changed tenant after authorization or when a foreign-tenant session shared the target user ID; they pass after the fix, with no foreign write/audit or session deletion. |

The scope, database-code and reason tests failed before their fixes. On 2026-11-02, five negative tests also failed against the exact reviewed service using `.oc/verify-reviewed-head.cjs`, without replacing dirty worktree source. The additional HTTP partial-replay test failed before preserving `ITEM_NOT_FOUND` for missing/foreign users, branches and warehouses, then passed after the fix. HTTP permission-denial and validation cases assert zero mutations, reservations and audits. The write-time tenant tests also ran red before their fixes. Bulk unit/controller HTTP coverage now passes 47/47 tests including nested scenarios, with zero skips; PostgreSQL evidence is separate and still blocked. Root lint, typecheck, changed-TypeScript formatting and both requested branch/working-tree diff checks pass.

The required `pnpm --filter @shipde/api test` fails closed at invitations integration because PostgreSQL is unreachable. The standalone bulk integration command also fails configuration validation for unavailable database/S3 settings. Docker Desktop startup was requested, but `docker info` still reports pipe permission denied. Root `pnpm test` fails in the unchanged web admin-shops test, which assumes an offline upstream but receives 401 instead of 502. No offline skip is accepted as live evidence. On the latest attempt, fetch succeeded and the requested merge started against `c6e71fcb9354cd2b14d1f5dcaed794abff306991`. The sole package-script conflict is resolved in the working file, preserving both parents' test commands, but `git add` cannot create the shared Git `index.lock`; Git still records that conflict as unmerged. Commit remains pending the required gates and Git write access; the operator has prohibited pushing. `.oc/pr-body.md` maps every supplied finding and acceptance row to the actual command and evidence level; `.oc/history.md` is absent and retrieving older GitHub reviews was blocked by network socket permissions.

The default hardcode command passes (zero files in its Controller-only scan); an explicit scan of six bulk files plus contracts also passes with zero findings. Adding the config/testkit files to that explicit scan reports two RBAC attempt constants already present on fetched main. No baseline, allowlist, gate or workflow was changed by this repair. The existing OpenAPI compatibility check passes for 71 paths after merging main; it does not prove the missing bulk contract is documented.

## Residual limitations

- Slice A live API verification is pending Docker/configuration access, and completing the local merge requires write access to shared Git metadata. Remote CI and fresh independent review for the repair have not run.
- NEEDS_DECISION: author boundary item 10 requires OpenAPI updates, but the explicit Slice A allowed paths omit the authoritative `docs/product-spec/contracts/openapi.yaml`, which has no bulk endpoint/schema. Resolve the scope conflict before claiming contract completion.
- NEEDS_DECISION: the Slice A migration boundary names `20261031120000_feat_com_03_bulk_operations`, but the existing PR migration is `20261029030000_feat_com_03_bulk_actions`. No migration rename or boundary expansion was made.
- User-facing acceptance `AC-COM-03-15` through `AC-COM-03-22` remains in Slice B (PR #468).
- Orders, shipments, and carrier actions are intentionally excluded pending asynchronous approval workflows.
