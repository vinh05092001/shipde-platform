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
- Implement `tenant-context.ts` using an `AsyncLocalStorage` keyed by the tenant ID string to store and retrieve the active request tenant ID.
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
| AC-AI-154-09 | `TenantMiddleware` processes verified token, unverified token, expired token, platform token, setup tokens, empty/whitespace scopes, and empty array scopes | Correctly establishes tenant ID for valid merchant tokens; leaves context undefined for others (fails closed on empty/whitespace/array scopes) | `apps/api/src/prisma/tenant.middleware.unit.spec.ts` (13/13 pass) |
| AC-AI-154-10 | Cross-tenant raw query (`extended.$queryRaw` / `$queryRawUnsafe`) | Establishes transaction-local `app.tenant_id`; cross-tenant rows excluded by PostgreSQL RLS | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 9) |
| AC-AI-154-11 | Cross-tenant relation query (accessing orders relation via merchant) | Establishes transaction-local `app.tenant_id`; excludes cross-tenant orders in relations | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 10) |
| AC-AI-154-12 | Array transaction `extended.$transaction([...])` with failing operation | Pre-pends `set_config` to batch; rejected batch rolls back all writes atomically | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 11, 12) |
| AC-AI-154-13 | Connection failure diagnostics reporting | Sanitizes database endpoint so database password / credentials are never exposed in logs or errors | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 13) |
| AC-AI-154-14 | Root-client service helper called inside interactive transaction callback | Enforces tenant setting on root connection; denies cross-tenant reads | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 7b) |
| AC-AI-154-15 | Extended model/raw query submitted through a foreign (unextended) client's transaction while a tenant context is active | Extension fails closed with `TenantRlsUnconfiguredTransactionError` — the query must NOT run under the pilot fail-open clause; the same composition without a tenant context keeps documented fail-open behavior; root-client queries inside a foreign interactive transaction are still wrapped and tenant-scoped | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 14, 14b, 15, 16) |
| AC-AI-154-16 | Nested composition where an extended interactive transaction callback encloses an inner foreign batch transaction under tenant context (`runWithTenant(A, () => extended.$transaction(async () => probe.$transaction([extended.order.findMany()])))`) | Setup proof is bound to the actual transaction identity; inner foreign batch rejected with `TenantRlsUnconfiguredTransactionError` (fails closed, cannot return other tenants' orders under restricted role) | `apps/api/src/prisma/orders-rls.integration.spec.ts` (PASS 17, 17b) |

## Verification commands

- `pnpm db:generate`
- `pnpm lint`
- `pnpm typecheck`
- `tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/prisma/tenant.middleware.unit.spec.ts`
- `tsx --tsconfig apps/api/tsconfig.json apps/api/src/prisma/orders-rls.integration.spec.ts`
- `pnpm --filter @shipde/api test`
- `node scripts/ai/check-no-hardcode.mjs`
- `git diff --check origin/main...HEAD`

### Current verification evidence (2026-11-02 repair)

Reviewed commit: `929aef5b51a459ac35d2fde523a79f6d5ae643d9`. The repair is an uncommitted working-tree change based on that commit. Local results do not establish GitHub CI success or an independent review verdict.

### GitHub CI observed at the reviewed commit

Retrieved through the GitHub connector on 2026-11-02, filtering workflow runs by the full reviewed SHA above. These are the failed runs before this repair; no new commit or CI run has been created by this repair task.

| Check | Result | Observed cause and evidence |
|---|---|---|
| `contract` | FAILURE | [Job 125086022217](https://github.com/vinh05092001/shipde-platform/actions/runs/41385732124/job/125086022217): `PR body still contains required template placeholders`. The published body contained an angle-bracket placeholder in the restored-paths command. Reproduced locally with the actual published body and the unchanged validator. |
| `current-application` | FAILURE | [Job 125086056236](https://github.com/vinh05092001/shipde-platform/actions/runs/41385732095/job/125086056236): `pnpm format:check` rejected `tenant-rls.extension.ts` and `tenant.middleware.unit.spec.ts`. Typecheck and tests were skipped in this job. |
| `application-gate` | FAILURE | [Job 125086643993](https://github.com/vinh05092001/shipde-platform/actions/runs/41385732095/job/125086643993): `Required application checks did not pass: failure`; dependent on `current-application`. |

The repair preserves the two pre-existing formatting fixes in the working tree, replaces the stale PR body in `.oc/pr-body.md`, and removes unsupported CI/completion claims from this Work Item. The coordinator must publish that prepared body and commit the working tree before GitHub can verify the repaired content. The verification finding remains open at the reviewed commit until fresh CI and independent review succeed.

### Local working-tree results

- `pnpm.cmd lint`: PASS, 12/12 tasks, exit 0.
- `pnpm.cmd typecheck`: PASS, 12/12 tasks, exit 0.
- `pnpm.cmd exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/prisma/tenant.middleware.unit.spec.ts apps/api/src/search/search.unit.spec.ts`: PASS, 45/45 tests, zero skipped (13 middleware and 32 search tests).
- `pnpm.cmd exec tsx --tsconfig apps/api/tsconfig.json apps/api/src/prisma/orders-rls.integration.spec.ts`: PASS, all 20 named restricted-role scenarios, including nested foreign model/raw transactions, zero offline skip. Covers acceptance rows 01-08 and 10-16.
- `python scripts/validate_docs.py` from `docs/product-spec`: PASS, 231 markdown files, 130 feature IDs, 268 delivery rows, 1762 unique identifiers.
- `node scripts/ai/check-no-hardcode.mjs`: PASS, 0 applicable files scanned; this guard covers the AI-brain scope and is not evidence of API security by itself.
- `git diff --check origin/main...HEAD`: PASS for the existing committed diff. The separate working-tree whitespace and scope checks are recorded in `.oc/pr-body.md`.
- Full `pnpm.cmd test` / API chain: FAIL_ENVIRONMENT, not PASS. After correcting a CRLF-only checkout issue (zero tracked contract change), the unchanged invitations HTTP test received 429 instead of 201. Read-only Redis inspection confirmed its shared loopback dispatch quota was exhausted (20/20); shared state was not reset. The affected Search HTTP acceptance suite and all RLS/middleware tests passed. Full clean-infrastructure rerun is required.
- Formatting/contract checks, negative proofs, sandbox limitations and the per-finding evidence map are recorded in `.oc/pr-body.md`; none imply remote CI success.

### Earlier fixes retained

The current restricted-role execution passed all original scenarios 1-17b: cross-tenant list, point-read, insert and update denial; own-tenant insert; pilot non-tenant compatibility; interactive and root-client transaction isolation; malformed UUID rejection; raw and relation isolation; failed-batch rollback and successful-batch results; credential-safe diagnostics; foreign model/raw transaction rejection; uncontexted foreign-batch compatibility; nested foreign model/raw transaction rejection. Cleanup still deletes only the two generated fixture merchants and their orders.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `cb31b792` | `CHANGES_REQUIRED` | Initial implementation |
| 2 | `c64b7130` | `CHANGES_REQUIRED` | Resolved P1 finding 1 (raw/relation queries bypass), P1 finding 2 (array transaction atomicity loss), and P1 finding 3 (diagnostic credential exposure) |
| 3 | `a8bd0b59` | `CHANGES_REQUIRED` | Resolved P1 finding 1 (transaction-context bypass for root client in callback via binding bypass decisions to transaction client) and P1 finding 4 (scoped test cleanup fixtures) |
| 4 | `6f2e3904` | `CHANGES_REQUIRED` | Resolved previous P1 finding 2 (scope restoration preserved TASK-AI-157 and TASK-AI-153 alongside TASK-AI-154). Previous P1 finding 1 remained open (ambient mark not bound to transaction identity allowed foreign batch nested in extended transaction). |
| 5 | `67485942` | `CHANGES_REQUIRED` | Resolved P1 finding 1 in code: bound setup proof to actual transaction identity (`activeTxIds`, a set of interactive and batch transaction identifiers, tracking `tx[Symbol.for('prisma.client.transaction.id')]` for interactive transactions and intercepted `txParams.id` for batch transactions); nested foreign batch inside outer extended transaction fails closed with `TenantRlsUnconfiguredTransactionError`; added restricted-role regressions 17 and 17b in `orders-rls.integration.spec.ts`. Review verified fix in code; required exact execution logs and CI results. |
| 6 | `e73b986` | `CHANGES_REQUIRED` | Earlier author packet claimed verification closure using local results. That closure claim is withdrawn: the subsequent review at `929aef5b51a459ac35d2fde523a79f6d5ae643d9` observed failed CI gates. |
| 7 | Working tree based on `929aef5b51a459ac35d2fde523a79f6d5ae643d9` | `CHANGES_REQUIRED` pending fresh CI/review | Identified both actual gate causes, reproduced their negative checks, retained the two formatting repairs and all earlier isolation fixes, corrected CI evidence, and prepared a contract-valid PR body. No commit, push or independent PASS issued. |
| 8 | Working tree based on `929aef5b51a459ac35d2fde523a79f6d5ae643d9` | `CHANGES_REQUIRED` pending fresh CI/review | Removed the two angle-bracket template placeholders from this file (they are published verbatim as the PR body and re-tripped the `contract` gate); added a unit regression that fails on any `<...>` placeholder in the Work Item. Merge of `origin/main` keeps one register row per Work Item. No new production behavior. |

## Known limitations

- A full clean-infrastructure rerun is required. Invitations acceptance depends on shared Redis; it fails closed rather than skipping when the quota is unavailable.
- Exact-head CI remains failed at the reviewed commit. Updated local evidence is not a CI pass; the coordinator must publish the prepared body, commit the changes, and obtain fresh CI plus independent review.
- Docker lifecycle follows the operator rule: database services are started only for the test run and stopped afterwards. Tests that do not need PostgreSQL/Redis/MinIO run without them.
- The original BR-RLS-05 uncontexted-session pilot exception remains; it does not authorize merchant HTTP requests or replace session/RBAC guards. No new product decision was needed for the review fixes.
