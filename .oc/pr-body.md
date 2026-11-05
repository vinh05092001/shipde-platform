## Work Item

- Work Item ID: TASK-AI-154
- Feature ID: N/A — database defense-in-depth security architecture
- Work Item file: docs/product-spec/work-items/TASK-AI-154.md
- Assigned implementation author: GEMINI
- Business outcome: Pilot PostgreSQL row-level security (RLS) on the tenant-owned `orders` table as a defense-in-depth isolation boundary. A verified Bearer `mid` claim is captured in `AsyncLocalStorage`; the tenant RLS Prisma extension sets `app.tenant_id` transaction-locally so the database denies cross-tenant reads and writes even when a service omits its `merchant_id` filter.

## Slice A and Slice B

Slice A = this PR; Slice B = apps/api/src/search/search.service.ts, apps/api/src/search/search.unit.spec.ts

- Slice A (this PR, 613 insertions versus `origin/main`, excluding `pnpm-lock.yaml`): production RLS wiring, migration, Work Item documentation, `tenant.middleware.unit.spec.ts` unit acceptance suite, and compact `orders-rls.integration.spec.ts` (<=300 lines) database RLS acceptance suite.
- Slice B: `apps/api/src/search/search.service.ts`, `apps/api/src/search/search.unit.spec.ts` — search pipeline RLS integration and subsequent multi-table RLS policies under TASK-AI-154.

## Source requirements

- Feature/use case/rule IDs: `BR-RLS-01`, `BR-RLS-02`, `BR-RLS-03`, `BR-RLS-04`, `BR-RLS-05`, `AC-AI-154-01`, `AC-AI-154-02`, `AC-AI-154-03`, `AC-AI-154-04`, `AC-AI-154-05`, `AC-AI-154-06`, `AC-AI-154-07`, `AC-AI-154-08`, `AC-AI-154-09`
- Scope: entity `orders`, NestJS `AppModule`, `PrismaService`, `TenantMiddleware`, `tenant-context`, `tenant-rls.extension`, `orders-rls.integration.spec.ts`
- Source documents: `AGENTS.md` (tenant-owned reads and writes are scoped server-side), `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`, `prisma/prisma-client-extensions` (`row-level-security`, Apache-2.0)

## Scope integrity

- [x] This PR contains exactly one Work Item (`TASK-AI-154`).
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] Changes stay inside the Work Item allowed paths.
- [x] `SearchService` and its tests are byte-identical to `origin/main`; the existing service-level `merchant_id` filters remain the primary layer.
- [x] `FEATURE-DELIVERY-REGISTER.csv` keeps all `origin/main` rows plus one row for `TASK-AI-154`.
- [x] All modified files are kept small (<= 300 lines each) for easy review.

## Implementation

- UI and user states: N/A — backend database security architecture; no UI is modified.
- API/application behavior:
  - `TenantMiddleware` extracts a signature-verified `mid` claim from valid Bearer tokens and runs the downstream pipeline inside `runWithTenant(tenantId, next)`; invalid, expired, forged, platform, and non-v1 tokens establish no tenant context.
  - `tenant-rls.extension.ts` executes `SELECT set_config('app.tenant_id', ..., true)` inside interactive transactions and wraps `order` operations, so the value is transaction-local and cannot leak across pooled connections.
  - `PrismaService` exposes `extended`, the RLS-extended client.
- Data/migrations: migration `20261031120000_task_ai_154_orders_rls/migration.sql` applies `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and policy `orders_tenant_isolation` for `USING` and `WITH CHECK`.
- Permissions/tenancy/audit: PostgreSQL RLS enforces tenant isolation independently of application query correctness; malformed tenant values fail closed via the `uuid` cast; null or empty tenant values keep pilot fail-open behavior for worker and seed sessions.

## Acceptance evidence

| AC               | Evidence                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-AI-154-01..08 | `apps/api/src/prisma/orders-rls.integration.spec.ts`, 8 tests: AC-AI-154-01 through AC-AI-154-08 (PASS)                                                                                                |
| AC-AI-154-09     | `apps/api/src/prisma/tenant.middleware.unit.spec.ts`, 8 tests: verified mid, async continuation, platform token, missing header, forged secret, expired token, non-v1 token, outer context replacement |

## Verification

| Command                                                                                                     | Result | Notes                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @shipde/api typecheck`                                                                       | PASS   | `tsc --noEmit`, exit 0                                                                                                                                                |
| `pnpm --filter @shipde/api lint`                                                                            | PASS   | `eslint .`, exit 0                                                                                                                                                    |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/prisma/tenant.middleware.unit.spec.ts` | PASS   | 8/8 tests passed (verified 2026-11-05)                                                                                                                                |
| `pnpm exec tsx --tsconfig apps/api/tsconfig.json apps/api/src/prisma/orders-rls.integration.spec.ts`        | PASS   | All 8 AC tests (AC-AI-154-01..08) passed (verified 2026-11-05). Spec file is 216 lines (<=300). One test per acceptance criterion; no per-finding or duplicate cases. |
| `pnpm format:check`                                                                                         | PASS   | All changed files conform to Prettier (verified 2026-11-05)                                                                                                           |
| `git diff --check origin/main`                                                                              | PASS   | 0 whitespace or conflict marker errors                                                                                                                                |
| `node scripts/ai/check-no-hardcode.mjs`                                                                     | PASS   | 0 raw instances, baseline preserved (verified 2026-11-05)                                                                                                             |
| `git diff --shortstat origin/main -- . ':!pnpm-lock.yaml' ':!.oc/'`                                         | PASS   | 613 insertions; all individual files <=300 lines (verified 2026-11-05)                                                                                                |

- [x] Lint and typecheck completed.
- [x] All acceptance tests for AC-AI-154-01 through AC-AI-154-09 verified.
- [x] Regression scope checked (`SearchService` untouched).
- [x] `orders-rls.integration.spec.ts` rewritten to <=300 lines with 1 test per AC and zero per-finding duplicate bloat.

## Safety and recovery

- Tenant isolation: database-enforced RLS on `orders` backs the existing application `merchant_id` filters.
- Authorization: `SessionGuard` and `RbacService` remain the access authority; `TenantMiddleware` authorizes nothing.
- Idempotency/reconciliation: transaction-local `set_config` prevents pooled-connection contamination.
- Sensitive data/secrets: no secrets or PII added; no credentials logged.
- Error, timeout and recovery paths: malformed tenant values fail closed; uncontexted sessions retain the documented pilot fail-open behavior.

## Documentation and traceability

- [x] Contracts/schemas are N/A for this internal database policy.
- [x] Work Item evidence is updated in `docs/product-spec/work-items/TASK-AI-154.md`.
- [x] Traceability is updated in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`.
- [x] Rollout plan for subsequent tables documented in `TASK-AI-154.md`.

## Risks and limitations

- Pilot fail-open clause (`BR-RLS-05`) permits uncontexted platform operations; Phase 3 hardens to strict fail-closed once worker contexts exist.
- Fresh CI and independent review are required before merge.

## Codex review

- Review status: READY_FOR_CODEX
- Scope: File target rewrite only; `orders-rls.integration.spec.ts` <= 300 lines.
