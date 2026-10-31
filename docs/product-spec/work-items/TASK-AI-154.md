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

Enforce PostgreSQL Row-Level Security (RLS) as a defense-in-depth isolation boundary on the primary tenant-owned `orders` table. Even if an application service or API route accidentally omits a `where: { merchant_id }` filter, the database engine itself prevents cross-tenant data leaks and unauthorized mutations. The tenant context is captured via Node.js `AsyncLocalStorage` from verified authentication tokens and propagated transparently to PostgreSQL via a Prisma Client extension executing `set_config('app.tenant_id', ..., true)` inside transactions. This architecture establishes a proven, reproducible pilot pattern for multi-tenant data protection across the entire platform.

## Source references

- `AGENTS.md` (Security and tenancy: "Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.")
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` (Tenancy architecture & baseline rules)
- Prisma Client Extensions RLS Reference: `prisma/prisma-client-extensions` (`row-level-security`, Apache-2.0)
- Business rules: `BR-RLS-01`, `BR-RLS-02`, `BR-RLS-03`, `BR-RLS-04`, `BR-RLS-05`
- Acceptance criteria: `AC-AI-154-01`, `AC-AI-154-02`, `AC-AI-154-03`, `AC-AI-154-04`, `AC-AI-154-05`, `AC-AI-154-06`, `AC-AI-154-07`, `AC-AI-154-08`

## Preconditions and dependencies

- Operator approval granted on 2026-10-31 for piloting PostgreSQL row-level security on `orders`.
- `orders` table and `merchants` table migrated and active in the database baseline.
- `apps/api` token verification infrastructure (`verifyAccessToken`, `resolveAccessTokenSecret`) available.

## Author boundary

GEMINI is assigned as author for the full vertical slice: database migration DDL, Prisma client extension design, NestJS request middleware, service wiring, integration tests with non-superuser roles, and documentation of the rollout plan. The author is prohibited from modifying gate configs, allowlists, baselines, semgrep rules, or `.github/`.

## In scope

- Create Prisma migration `20261031120000_task_ai_154_orders_rls` enabling RLS and `FORCE ROW LEVEL SECURITY` on `orders` with the `orders_tenant_isolation` policy for `USING` and `WITH CHECK`.
- Implement `tenant-context.ts` using `AsyncLocalStorage<string>` to store and retrieve the active request tenant ID.
- Implement `tenant-rls.extension.ts` adapting the Apache-2.0 pattern from `prisma/prisma-client-extensions`, executing `SELECT set_config('app.tenant_id', ${tenantId}, true)` inside Prisma transactions.
- Implement `TenantMiddleware` in `apps/api/src/prisma/tenant.middleware.ts` to extract verified `mid` claims from Bearer access tokens and run subsequent request handling inside the tenant context.
- Wire `tenantRlsExtension` into `PrismaService` via `prismaService.extended`.
- Ensure existing service-level tenant filters (`SearchService` and other callers) remain active and untouched as the primary enforcement layer.
- Add integration test suite `apps/api/src/prisma/orders-rls.integration.spec.ts` using a dedicated non-superuser role (`NOBYPASSRLS`) to prove cross-tenant read denial without filters, cross-tenant point read denial, cross-tenant insert denial, cross-tenant update denial, own-tenant write success, non-tenant session compatibility, transaction boundary isolation, and fail-closed syntax checking on invalid UUIDs.
- Add unit test suite `apps/api/src/prisma/tenant.middleware.unit.spec.ts` covering token verification, token expiration, secret tampering, and context propagation.
- Document rollout plan for extending RLS to all other tenant-owned tables.

## Out of scope

- Enabling RLS on tables other than `orders` in this pilot.
- Removing or weakening application-level `merchant_id` filters (both layers must coexist).
- Breaking public, unauthenticated, or platform-wide worker operations that currently run without a tenant context.

## Business rules and edge cases

- `BR-RLS-01`: **Defense-in-depth** — Service-level `where: { merchant_id }` filters remain the primary layer; database RLS policies act as an independent second layer.
- `BR-RLS-02`: **Transaction-local session configuration** — Setting `app.tenant_id` MUST use `set_config(..., true)` (`is_local = true`) inside a transaction block to prevent session parameter leakage across pooled database connections.
- `BR-RLS-03`: **Force table owner enforcement** — The table MUST have `FORCE ROW LEVEL SECURITY` applied so that the application database user (which owns the tables in production) cannot bypass the security policy.
- `BR-RLS-04`: **Fail-closed on malformed tenant input** — Casting `NULLIF(current_setting('app.tenant_id', true), '')::uuid` ensures that an invalid or non-UUID value throws a PostgreSQL syntax error, failing closed (zero rows returned or modified).
- `BR-RLS-05`: **Pilot fail-open for uncontexted sessions** — When `app.tenant_id` is null or empty, the pilot policy allows the operation to proceed, ensuring background worker jobs, seed scripts, and platform administrative routines remain unblocked until their phase of the rollout.

## Rollout plan for other tables

This pilot validates the pattern on the highest-volume core tenant table (`orders`). Full fleet migration follows a 3-phase roadmap:

### Phase 1: Core Domain Tenant Tables
1. **Target tables**: `shipments`, `branches`, `warehouses`, `carrier_accounts`.
2. **DDL changes**:
   - `ALTER TABLE "..." ENABLE ROW LEVEL SECURITY;`
   - `ALTER TABLE "..." FORCE ROW LEVEL SECURITY;`
   - Add policy `"..._tenant_isolation"` checking `"merchant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
3. **Application wiring**:
   - Register model hooks in `tenant-rls.extension.ts` under `query: { shipments: ..., branches: ..., warehouses: ..., carrier_accounts: ... }` or use `$allModels`.
   - Update services to consume `prismaService.extended`.

### Phase 2: Auxiliary and Audit Tables
1. **Target tables**: `claims`, `discrepancies`, `exception_cases`, `audit_logs`, `onboarding_states`.
2. **DDL changes**:
   - Apply standard RLS and FORCE RLS policies.
   - For `audit_logs`, ensure write policies permit creation by authenticated tenants while reads remain strictly scoped.

### Phase 3: Background Worker Context & Strict Fail-Closed Mode
1. **Worker Job Context**:
   - Wrap BullMQ job processors in `runWithTenant(job.data.merchantId, () => ...)` for tenant-owned jobs.
2. **Platform & Maintenance Operations**:
   - Introduce an explicit `app.bypass_rls = 'on'` session variable available only to platform administration sessions and migrations, guarded by audit logging.
3. **Strict Policy Hardening**:
   - Change policies from fail-open (`IS NULL OR ''`) to fail-closed (`"merchant_id" = current_setting('app.tenant_id', false)::uuid`), completely eliminating unscoped database queries across the platform.

## UI states

N/A — Backend database security architecture and middleware; no user interface is directly modified.

## API, event and data impact

- Database Migration: `prisma/migrations/20261031120000_task_ai_154_orders_rls/migration.sql` adds RLS + FORCE RLS + policy to `orders`.
- Prisma Service: Exposes `readonly extended: ExtendedPrismaClient` with transaction and query interception.
- Request Pipeline: `TenantMiddleware` runs globally for all HTTP routes, reading access token claims without altering route response payloads.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-154-01 | Tenant A queries `orders.findMany` without `merchant_id` filter | Only Tenant A's orders are returned; Tenant B orders are excluded by PostgreSQL RLS | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 1) |
| AC-AI-154-02 | Tenant A performs `orders.findUnique` on Tenant B order ID | Query returns `null` (not found) | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 2) |
| AC-AI-154-03 | Tenant A attempts `orders.create` with Tenant B `merchant_id` | Operation rejected with PostgreSQL code `42501` (row violates RLS policy) | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 3) |
| AC-AI-154-04 | Tenant A attempts `orders.update` on Tenant B order | Update fails / throws; underlying row data in database remains untouched | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 4) |
| AC-AI-154-05 | Tenant A performs `orders.create` for own `merchant_id` | Operation succeeds and returns newly created order record | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 5) |
| AC-AI-154-06 | Unauthenticated / system session without tenant context queries orders | Operation succeeds under pilot fail-open rules | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 6) |
| AC-AI-154-07 | Interactive transaction `extended.$transaction(async (tx) => ...)` | Sets `app.tenant_id` for duration of transaction; tenant policy applies to tx operations | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 7) |
| AC-AI-154-08 | Tenant context set to malformed string (e.g. `'not-a-uuid'`) | Query fails closed with syntax error `invalid input syntax for type uuid` | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 8) |
| AC-AI-154-09 | `TenantMiddleware` processes verified token, unverified token, expired token, platform token | Correctly establishes tenant ID for valid merchant tokens; leaves context undefined for others | `apps/api/src/prisma/tenant.middleware.unit.spec.ts` (12/12 pass) |
| AC-AI-154-10 | Cross-tenant raw query (`extended.$queryRaw` / `$queryRawUnsafe`) | Establishes transaction-local `app.tenant_id`; cross-tenant rows excluded by PostgreSQL RLS | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 9) |
| AC-AI-154-11 | Cross-tenant relation query (accessing orders relation via merchant) | Establishes transaction-local `app.tenant_id`; excludes cross-tenant orders in relations | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 10) |
| AC-AI-154-12 | Array transaction `extended.$transaction([...])` with failing operation | Pre-pends `set_config` to batch; rejected batch rolls back all writes atomically | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 11, 12) |
| AC-AI-154-13 | Connection failure diagnostics reporting | Sanitizes database endpoint so database password / credentials are never exposed in logs or errors | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 13) |
| AC-AI-154-14 | Root-client service helper called inside interactive transaction callback | Enforces tenant setting on root connection; denies cross-tenant reads | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 7b) |

## Verification commands

- `pnpm db:generate`
- `pnpm lint`
- `pnpm typecheck`
- `tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/prisma/tenant.middleware.unit.spec.ts`
- `tsx --tsconfig apps/api/tsconfig.json apps/api/src/prisma/orders-rls.integration.spec.ts`
- `node scripts/ai/check-no-hardcode.mjs`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `cb31b792` | `CHANGES_REQUIRED` | Initial implementation |
| 2 | `c64b7130` | `CHANGES_REQUIRED` | Resolved P1 finding 1 (raw/relation queries bypass), P1 finding 2 (array transaction atomicity loss), and P1 finding 3 (diagnostic credential exposure) |
| 3 | `HEAD` | `READY_FOR_CODEX` | Resolved P1 finding 1 (transaction-context bypass for root client in callback via binding bypass decisions to transaction client) and P1 finding 4 (scoped test cleanup fixtures) |

## Residual limitations

None
