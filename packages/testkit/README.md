# @shipde/testkit

Shared test harness helpers, assertion utilities, deterministic fixtures, and workspace boundary validators for Ship Dễ.

## Purpose

- Provide reusable test fixtures and assertions across applications and packages.
- Verify monorepo package boundary integrity without relying on ad-hoc test scripts.

## Boundary

- Contains test-only utilities and fixtures.
- Must not be included in production build dependencies.

## Offline database tests

After installing dependencies, run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:local-db
```

`test:local-db` generates the Prisma client, builds testkit and its workspace dependencies, and runs every API `*.supertest.spec.ts` sequentially with `TEST_DB=local`. Each DB-backed suite receives its own in-memory PGlite instance. It uses real Prisma 6 queries and all repository migration SQL, including triggers and constraints. Runtime needs no Docker, database server or package download; the initial dependency install and Prisma engine provisioning require network access.

The runner reports passing/failing **suite processes** separately from named skipped **scenarios**. It exits nonzero for a failed child, timeout or an old suite's offline-skip fallback. These counts do not claim that every assertion is an independently registered test.

To run one existing suite in PowerShell after building testkit:

```powershell
$env:TEST_DB = 'local'
$env:NODE_ENV = 'test'
pnpm --filter @shipde/api exec tsx --tsconfig tsconfig.json src/shops/shops.supertest.spec.ts
```

Without `TEST_DB=local`, existing tests keep their current PostgreSQL URL and providers. Local mode does not read `.env` files and cannot be selected in production. `apps/api/test-support/test-module.ts` owns the Nest overrides; production `PrismaService` is unchanged.

For a new DB test, use `createLocalTestDatabase(PrismaClient)` from `@shipde/testkit`, call `reset()` in `beforeEach` and `close()` in `after`. Set `TEST_DB=local` before creating the helper. Reset drops only its private memory schema and reapplies the complete migration history, including data migrations. Existing acceptance scripts intentionally share fixtures between scenarios; their database is recreated between suite processes.

## Coverage limits

- PGlite has one connection. Nine existing concurrency scenarios are marked with `skipLocalDbTest`: registration, password reset, session revoke, four overlapping branch mutations, onboarding state updates and warehouse completion. Four branch authorization scenarios (scoped deactivate, delete, create-default and update-default) also need an independent root-client connection during an interactive transaction and are explicitly skipped. Owner CRUD, scoped reads, guard denials and cross-tenant tests still run. Onboarding uses sequential requests in local mode to preserve the fixtures needed by later assertions. Those runs prove sequential persistence/idempotency, not race safety.
- Redis/Lua distributed rate limiting, MinIO, workers, outbox delivery and dependency recovery still require CI. The API harness uses the actual `RateLimitService` without a Redis dependency for its existing memory backend. It reports Redis/storage unavailable, and fails unexpected direct access. `TEST_DB=local pnpm test:integration` explicitly skips the foundation infrastructure runner.
- PostgreSQL WASM is not proof of production server-version, extension, performance or lock behavior. An unsupported migration fails with the migration name; no SQL is silently rewritten or omitted.
- Prisma's `migrate deploy` CLI is not supported by this adapter. The helper replays the versioned SQL files directly, committing each separately. CI continues using the original migration command.

Package selection and verification limitations are recorded in [AI Toolchain Decisions](../../docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md#offline-db-backed-api-tests-task-ai-163).
