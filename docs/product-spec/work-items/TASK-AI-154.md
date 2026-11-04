# TASK-AI-154 — Pilot Postgres row-level security for tenant isolation

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-154` |
| Feature ID | `N/A — database defense-in-depth security architecture` |
| Status | `IN_PROGRESS` |
| Delivery order | `270` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `apps/api/package.json`; `apps/api/src/app.module.ts`; `apps/api/src/prisma/prisma.service.ts`; `apps/api/src/prisma/tenant-context.ts`; `apps/api/src/prisma/tenant-rls.extension.ts`; `apps/api/src/prisma/tenant.middleware.ts`; `apps/api/src/prisma/tenant.middleware.unit.spec.ts`; `apps/api/src/prisma/orders-rls.integration.spec.ts`; `apps/api/src/search/search.service.ts`; `apps/api/src/search/search.unit.spec.ts`; `prisma/migrations/20261031120000_task_ai_154_orders_rls/migration.sql`; `docs/product-spec/work-items/TASK-AI-154.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-154-tenant-rls` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Enforce PostgreSQL Row-Level Security (RLS) as a defense-in-depth isolation boundary on the tenant-owned `orders` table. Even if an application service or route omits its `merchant_id` filter, the database engine prevents cross-tenant reads and unauthorized mutations. The tenant context is captured via `AsyncLocalStorage` from verified tokens and propagated to PostgreSQL through a Prisma Client extension executing `set_config('app.tenant_id', ..., true)` inside transactions.

## Source references

- `AGENTS.md` (tenant-owned reads and writes are scoped server-side).
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` (tenancy architecture).
- Prisma Client Extensions RLS reference: `prisma/prisma-client-extensions` (`row-level-security`, Apache-2.0).
- Business rules: `BR-RLS-01`, `BR-RLS-02`, `BR-RLS-03`, `BR-RLS-04`, `BR-RLS-05`.
- Acceptance criteria: `AC-AI-154-01` through `AC-AI-154-09`.

## In scope

- Migration `20261031120000_task_ai_154_orders_rls` enabling RLS and `FORCE ROW LEVEL SECURITY` on `orders` with the `orders_tenant_isolation` policy for `USING` and `WITH CHECK`.
- `tenant-context.ts`: `AsyncLocalStorage` tenant context keyed by tenant ID.
- `tenant-rls.extension.ts`: executes `SELECT set_config('app.tenant_id', ..., true)` inside Prisma transactions.
- `TenantMiddleware`: extracts verified `mid` claims from Bearer tokens and runs request handling inside the tenant context.
- Wire `tenantRlsExtension` into `PrismaService` via `prismaService.extended`.
- Keep existing service-level `merchant_id` filters as the primary layer (no changes to `SearchService`).
- Integration suite `orders-rls.integration.spec.ts` proving cross-tenant denial with a `NOBYPASSRLS` role (tracked as Slice B).
- Unit suite `tenant.middleware.unit.spec.ts` covering token verification, expiration, tampering, and context propagation.

## Out of scope

- Enabling RLS on tables other than `orders` in this pilot.
- Removing or weakening application-level `merchant_id` filters.
- Breaking public, unauthenticated, or platform worker operations without a tenant context.

## Business rules and edge cases

- `BR-RLS-01` Defense-in-depth: service filters stay primary; RLS is an independent second layer.
- `BR-RLS-02` Transaction-local setting: `set_config(..., true)` prevents session leakage across pooled connections.
- `BR-RLS-03` Force table owner enforcement with `FORCE ROW LEVEL SECURITY`.
- `BR-RLS-04` Fail-closed on malformed tenant input via the `uuid` cast.
- `BR-RLS-05` Pilot fail-open when `app.tenant_id` is null or empty so workers and scripts stay unblocked.

## Rollout plan

Phase 1 enables the same policy on `shipments`, `branches`, `warehouses`, `carrier_accounts`. Phase 2 covers `claims`, `discrepancies`, `exception_cases`, `audit_logs`, `onboarding_states`. Phase 3 adds worker job context (`runWithTenant(job.data.merchantId, ...)`), an audited `app.bypass_rls` session variable for platform operations, and strict fail-closed policies.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-154-01 | Tenant A queries `orders.findMany` without `merchant_id` filter | Only Tenant A orders are returned | `orders-rls.integration.spec.ts` (PASS 1) |
| AC-AI-154-02 | Tenant A performs `orders.findUnique` on Tenant B order ID | Returns `null` | `orders-rls.integration.spec.ts` (PASS 2) |
| AC-AI-154-03 | Tenant A creates an order with Tenant B `merchant_id` | Rejected by RLS `WITH CHECK` | `orders-rls.integration.spec.ts` (PASS 3) |
| AC-AI-154-04 | Tenant A updates a Tenant B order | Rejected; row unchanged | `orders-rls.integration.spec.ts` (PASS 4) |
| AC-AI-154-05 | Tenant A creates an order for own `merchant_id` | Succeeds | `orders-rls.integration.spec.ts` (PASS 5) |
| AC-AI-154-06 | Session without tenant context queries orders | Succeeds under pilot fail-open | `orders-rls.integration.spec.ts` (PASS 6) |
| AC-AI-154-07 | Interactive `extended.$transaction` | Tenant setting applied for the transaction | `orders-rls.integration.spec.ts` (PASS 7) |
| AC-AI-154-08 | Tenant context set to a malformed string | Fails closed with `invalid input syntax for type uuid` | `orders-rls.integration.spec.ts` (PASS 8) |
| AC-AI-154-09 | `TenantMiddleware` processes valid, forged, expired, platform, and missing tokens | Establishes context only for verified merchant tokens | `tenant.middleware.unit.spec.ts` |

## Verification commands

- `pnpm db:generate`
- `pnpm lint`
- `pnpm typecheck`
- `tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/prisma/tenant.middleware.unit.spec.ts`
- `tsx --tsconfig apps/api/tsconfig.json apps/api/src/prisma/orders-rls.integration.spec.ts`
- `node scripts/ai/check-no-hardcode.mjs`
