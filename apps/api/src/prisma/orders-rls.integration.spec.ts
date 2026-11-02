import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient, RoleEnum, SessionStatusEnum } from '@prisma/client';
import { runWithTenant, getTenantId } from './tenant-context';
import { TenantRlsUnconfiguredTransactionError, tenantRlsExtension } from './tenant-rls.extension';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Controller, RequestMethod, Inject } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { AppModule } from '../app.module';
import { SessionModule } from '../session/session.module';
import { PrismaService } from './prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { SessionGuard } from '../session/session.guard';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';

@Controller('api/v1/test-rls')
class TestRlsContextController {
  constructor(private readonly prisma: PrismaService) {}

  async getOrders() {
    const observedTenantId = getTenantId();
    // Downstream unfiltered orders query through the application's extended Prisma client.
    // Proves that RLS enforces isolation even when service-level merchant_id filters are omitted.
    const orders = await this.prisma.extended.order.findMany({
      select: { id: true, merchant_id: true, order_code: true },
    });
    return {
      observedTenantId,
      orders,
    };
  }
}

Reflect.defineMetadata('design:paramtypes', [PrismaService], TestRlsContextController);

Reflect.defineMetadata(PATH_METADATA, 'orders', TestRlsContextController.prototype.getOrders);
Reflect.defineMetadata(
  METHOD_METADATA,
  RequestMethod.GET,
  TestRlsContextController.prototype.getOrders
);
Reflect.defineMetadata(
  GUARDS_METADATA,
  [SessionGuard],
  TestRlsContextController.prototype.getOrders
);

/**
 * TASK-AI-154: orders row-level security integration test.
 *
 * Proves that the Postgres RLS policy on `orders` denies cross-tenant reads
 * and writes even when the service-level merchant_id filter is absent, by
 * running every RLS-sensitive scenario as a dedicated non-superuser role
 * (`shipde_rls_probe`, NOBYPASSRLS) that is subject to the policy. The
 * superuser client only seeds and cleans up fixtures; superusers bypass RLS
 * and could not demonstrate the denial.
 */

// Finding 23: Per-run random suffix prevents cluster-global role collisions in parallel runs
const probeRoleSuffix = randomUUID().replace(/-/g, '').slice(0, 10).toLowerCase();
const PROBE_ROLE = `shipde_rls_probe_${probeRoleSuffix}`;
const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
const POLICY_NAME = 'orders_tenant_isolation';

function loadEnvFile(): void {
  if (process.env.DATABASE_URL) return;
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      let value = rest.join('=').trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key.trim()]) {
        process.env[key.trim()] = value;
      }
    }
    break;
  }
}

export function sanitizeDatabaseEndpoint(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.host || 'localhost';
    const db = parsed.pathname.replace(/^\//, '') || 'shipde_dev';
    return `${parsed.protocol}//${parsed.username ? parsed.username + '@' : ''}${host}/${db}`;
  } catch {
    return '[sanitized-database-endpoint]';
  }
}

function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

function orderInput(merchantId: string, orderCode: string) {
  return {
    merchant_id: merchantId,
    order_code: orderCode,
    created_at: new Date('2026-10-31T00:00:00.000Z'),
    recipient_name: 'Tenant Probe',
    recipient_phone: '0900000000',
    recipient_province: 'HN',
    recipient_address: '1 Probe Street',
  };
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('SHIP DE - ORDERS RLS INTEGRATION SUITE (TASK-AI-154)');
  console.log('================================================================');
  loadEnvFile();
  const databaseUrl = resolveDatabaseUrl();

  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await admin.$connect();
    await admin.$queryRaw`SELECT 1`;
  } catch {
    const sanitizedEndpoint = sanitizeDatabaseEndpoint(databaseUrl);
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(
        `PostgreSQL must be reachable for orders RLS integration tests in CI (${sanitizedEndpoint})`
      );
    }
    console.warn(
      `PostgreSQL is not reachable at ${sanitizedEndpoint}. Skipping orders RLS integration tests (run 'pnpm infra:up' to enable).`
    );
    await admin.$disconnect().catch(() => {});
    console.log('Orders RLS integration suite skipped offline safely!');
    return;
  }

  // Verify the TASK-AI-154 migration DDL is present before testing behavior.
  const rlsFlags = await admin.$queryRaw<
    Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
  >`
    SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'orders' AND c.relkind = 'r'
  `;
  const policyRows = await admin.$queryRaw<Array<{ policyname: string; permissive: string }>>`
    SELECT policyname, permissive FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders'
  `;
  const rlsEnabled =
    rlsFlags.length === 1 &&
    rlsFlags[0].relrowsecurity === true &&
    rlsFlags[0].relforcerowsecurity === true;
  const policyPresent = policyRows.some((row) => row.policyname === POLICY_NAME);
  if (!rlsEnabled || !policyPresent) {
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(
        `orders RLS DDL missing in CI (enabled=${rlsEnabled}, policy=${policyPresent}); run 'pnpm db:migrate' first`
      );
    }
    console.warn(
      `orders RLS DDL not applied locally (enabled=${rlsEnabled}, policy=${policyPresent}). Skipping (run 'pnpm db:migrate' to apply).`
    );
    await admin.$disconnect().catch(() => {});
    console.log('Orders RLS integration suite skipped (migration not applied)!');
    return;
  }

  // Create a non-superuser role subject to RLS (no BYPASSRLS, not the table
  // owner). Privileges are limited to the two tables the test needs.
  const probePassword = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  const dbRows = await admin.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const currentDb = dbRows[0]?.current_database || 'shipde_dev';

  await admin
    .$executeRaw(
      Prisma.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`)
    )
    .catch(() => {});
  await admin
    .$executeRaw(
      Prisma.raw(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`)
    )
    .catch(() => {});
  await admin
    .$executeRaw(Prisma.raw(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`))
    .catch(() => {});
  await admin
    .$executeRaw(Prisma.raw(`REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`))
    .catch(() => {});
  await admin.$executeRaw(Prisma.raw(`DROP ROLE IF EXISTS ${PROBE_ROLE}`)).catch(() => {});

  await admin.$executeRaw(
    Prisma.raw(
      `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`
    )
  );
  await admin.$executeRaw(Prisma.raw(`GRANT CONNECT ON DATABASE "${currentDb}" TO ${PROBE_ROLE}`));
  await admin.$executeRaw(Prisma.raw(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`));
  await admin.$executeRaw(
    Prisma.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`
    )
  );
  await admin.$executeRaw(
    Prisma.raw(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`)
  );

  const probeUrl = new URL(databaseUrl);
  probeUrl.username = PROBE_ROLE;
  probeUrl.password = probePassword;
  const probe = new PrismaClient({ datasources: { db: { url: probeUrl.toString() } } });
  // Finding 4: innermost dispatch counter attached BELOW the tenant RLS
  // extension. It records only operations actually dispatched toward the
  // database engine; an operation the extension rejects (fail-closed) never
  // reaches this counter. Used to prove a rejected foreign batch issues no SQL.
  const dispatchedOperations: string[] = [];
  const dispatchCounter = Prisma.defineExtension({
    name: 'rls-dispatch-counter',
    query: {
      async $allOperations(payload: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }): Promise<unknown> {
        dispatchedOperations.push(
          payload.model ? `${payload.model}.${payload.operation}` : payload.operation
        );
        return payload.query(payload.args);
      },
    },
  });
  const extendedBase = probe.$extends(tenantRlsExtension(probe));
  const extended = extendedBase.$extends(dispatchCounter) as unknown as typeof extendedBase;

  const suffix = Date.now().toString(36);
  const merchantA = randomUUID();
  const merchantB = randomUUID();

  try {
    await admin.merchant.create({
      data: { id: merchantA, name: `RLS Probe A ${suffix}`, code: `rls-a-${suffix}` },
    });
    await admin.merchant.create({
      data: { id: merchantB, name: `RLS Probe B ${suffix}`, code: `rls-b-${suffix}` },
    });
    const orderA = await admin.order.create({ data: orderInput(merchantA, `RLS-A-${suffix}`) });
    const orderB = await admin.order.create({ data: orderInput(merchantB, `RLS-B-${suffix}`) });

    // 1. Cross-tenant read denied without any merchant_id filter.
    await runWithTenant(merchantA, async () => {
      const visible = await extended.order.findMany({
        where: { id: { in: [orderA.id, orderB.id] } },
      });
      assert.deepEqual(
        visible.map((row) => row.id),
        [orderA.id],
        'tenant A must not read tenant B orders even without a merchant_id filter'
      );
    });

    // Finding 5: Symmetric test for Tenant B reading orders without merchant_id filter.
    await runWithTenant(merchantB, async () => {
      const visibleB = await extended.order.findMany({
        where: { id: { in: [orderA.id, orderB.id] } },
      });
      assert.deepEqual(
        visibleB.map((row) => row.id),
        [orderB.id],
        'tenant B must not read tenant A orders even without a merchant_id filter'
      );
    });
    console.log(
      'PASS: cross-tenant read denied without merchant_id filter (symmetric for A and B)'
    );

    // 2. Cross-tenant point read returns no row.
    await runWithTenant(merchantA, async () => {
      const row = await extended.order.findUnique({ where: { id: orderB.id } });
      assert.equal(row, null, 'lookup of another tenant order must return no row');
    });

    // Finding 5: Symmetric point read for Tenant B looking up Tenant A order.
    await runWithTenant(merchantB, async () => {
      const rowB = await extended.order.findUnique({ where: { id: orderA.id } });
      assert.equal(rowB, null, 'tenant B looking up tenant A order must return no row');
    });
    console.log('PASS: cross-tenant point read returns no row (symmetric for A and B)');

    // 3. Cross-tenant insert is rejected by the WITH CHECK policy clause.
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.order.create({ data: orderInput(merchantB, `RLS-CROSS-${suffix}`) });
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /row-level security|new row violates/i);
        return true;
      },
      'inserting another tenant order must be denied by RLS'
    );

    // Finding 5: Symmetric insert rejection for Tenant B attempting to create order for Tenant A.
    await assert.rejects(
      runWithTenant(merchantB, async () => {
        await extended.order.create({ data: orderInput(merchantA, `RLS-CROSS-B-${suffix}`) });
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /row-level security|new row violates/i);
        return true;
      },
      'tenant B inserting tenant A order must be denied by RLS'
    );
    console.log('PASS: cross-tenant insert denied by RLS (symmetric for A and B)');

    // 4. Cross-tenant update is rejected and the row stays untouched.
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.order.update({
          where: { id: orderB.id },
          data: { recipient_province: 'SG' },
        });
      }),
      (error: unknown) => error instanceof Error,
      'updating another tenant order must not succeed'
    );
    const untouched = await admin.order.findUnique({ where: { id: orderB.id } });
    assert.equal(
      untouched?.recipient_province,
      'HN',
      'cross-tenant update must not mutate the row'
    );
    console.log('PASS: cross-tenant update denied and row untouched');

    // 5. Own-tenant write still succeeds.
    const ownWrite = await runWithTenant(merchantA, async () =>
      extended.order.create({ data: orderInput(merchantA, `RLS-OWN-${suffix}`) })
    );
    assert.equal(ownWrite.merchant_id, merchantA, 'own-tenant insert must succeed');
    console.log('PASS: own-tenant insert succeeds');

    // 6. Pilot scope: a session without a tenant keeps today's unscoped
    //    visibility (fail-open), documented in the Work Item rollout plan.
    const unscoped = await extended.order.findMany({
      where: { id: { in: [orderA.id, orderB.id] } },
    });
    assert.deepEqual(
      unscoped.map((row) => row.id).sort(),
      [orderA.id, orderB.id].sort(),
      'non-tenant sessions keep unscoped visibility during the pilot'
    );
    console.log('PASS: non-tenant session fail-open behavior documented and held');

    // 7. Interactive transactions set the tenant for their whole duration.
    const inTx = await runWithTenant(merchantA, async () =>
      extended.$transaction(async (tx) =>
        tx.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } })
      )
    );
    assert.deepEqual(
      inTx.map((row) => row.id),
      [orderA.id],
      'interactive transactions must apply the tenant policy'
    );
    console.log('PASS: interactive transaction applies the tenant policy');

    // 7b. Finding 1 regression: root-client service helper called inside interactive transaction callback.
    // Inside extended.$transaction(async () => extended.order.findMany()), the root-client query
    // runs on a separate pooled connection and must NOT inherit an ambient bypass flag. RLS must
    // still enforce tenant isolation on that root-client query.
    async function rootClientListOrders(
      client: typeof extended,
      candidateIds: string[]
    ): Promise<Array<{ id: string }>> {
      // Intentionally omits service-level merchant_id filter to verify RLS defense-in-depth
      return client.order.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true },
      });
    }

    await runWithTenant(merchantA, async () => {
      await extended.$transaction(async (_tx) => {
        const rootOrders = await rootClientListOrders(extended, [orderA.id, orderB.id]);
        assert.deepEqual(
          rootOrders.map((r) => r.id),
          [orderA.id],
          'root-client helper invoked inside transaction callback must establish tenant setting and exclude cross-tenant rows'
        );
      });
    });
    console.log(
      'PASS: root-client service helper inside transaction callback denied cross-tenant reads by RLS'
    );

    // 8. A malformed tenant value fails closed (the policy cast errors).
    await assert.rejects(
      runWithTenant('not-a-uuid', async () => {
        await extended.order.findMany({ where: { merchant_id: merchantA } });
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /invalid input syntax for type uuid/i);
        return true;
      },
      'malformed tenant values must fail closed'
    );
    console.log('PASS: malformed tenant value fails closed');

    // 9. Finding 1: Cross-tenant raw query denial via extended.$queryRaw and $queryRawUnsafe.
    // Finding 12 assumption guard: verify that the connection role is indeed non-superuser
    const [probeRoleMeta] = await probe.$queryRaw<Array<{ rolsuper: boolean }>>`
      SELECT rolsuper FROM pg_roles WHERE rolname = CURRENT_USER
    `;
    assert.equal(
      probeRoleMeta?.rolsuper,
      false,
      'probe role must be non-superuser (NOBYPASSRLS) for RLS isolation verification'
    );

    await runWithTenant(merchantA, async () => {
      const rawRows = await extended.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM orders WHERE id IN (${orderA.id}::uuid, ${orderB.id}::uuid)
      `;
      assert.deepEqual(
        rawRows.map((r) => r.id),
        [orderA.id],
        'raw query must establish app.tenant_id and deny reading tenant B rows'
      );

      // nosemgrep: shipde-no-unsafe-raw-sql
      const rawUnsafeRows = await extended.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT id FROM orders WHERE id = $1::uuid',
        orderB.id
      );
      assert.deepEqual(
        rawUnsafeRows,
        [],
        'raw unsafe query must deny reading tenant B row under restricted role'
      );
    });
    console.log('PASS: cross-tenant raw queries denied by RLS under extended client');

    // 10. Finding 1: Cross-tenant relation query denial (accessing orders through merchant).
    await runWithTenant(merchantA, async () => {
      const merchantBWithOrders = await extended.merchant.findUnique({
        where: { id: merchantB },
        include: { orders: true },
      });
      assert.deepEqual(
        merchantBWithOrders?.orders || [],
        [],
        'relation query accessing orders through merchant must NOT return tenant B orders'
      );

      const merchantAWithOrders = await extended.merchant.findUnique({
        where: { id: merchantA },
        include: { orders: true },
      });
      assert.ok(
        merchantAWithOrders?.orders.some((o) => o.id === orderA.id),
        'relation query for own merchant returns own orders'
      );
      assert.ok(
        !merchantAWithOrders?.orders.some((o) => o.id === orderB.id),
        'relation query for own merchant must not include tenant B orders'
      );
    });
    console.log('PASS: cross-tenant relation query denies other tenant orders');

    // 11. Finding 2: Array transaction atomicity: batch containing an invalid write rolls back all writes.
    const batchOwnCode = `RLS-BATCH-OWN-${suffix}`;
    const batchCrossCode = `RLS-BATCH-CROSS-${suffix}`;
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.$transaction([
          extended.order.create({ data: orderInput(merchantA, batchOwnCode) }),
          extended.order.create({ data: orderInput(merchantB, batchCrossCode) }),
        ]);
      }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /row-level security|new row violates/i);
        return true;
      },
      'batch transaction containing RLS-violating insert must reject'
    );
    const uncommittedOwn = await admin.order.findFirst({ where: { order_code: batchOwnCode } });
    assert.equal(
      uncommittedOwn,
      null,
      'own-tenant insert in rejected batch transaction must be rolled back'
    );
    const uncommittedCross = await admin.order.findFirst({ where: { order_code: batchCrossCode } });
    assert.equal(
      uncommittedCross,
      null,
      'cross-tenant insert in rejected batch transaction must not be committed'
    );
    console.log('PASS: rejected array transaction leaves zero committed writes (atomic rollback)');

    // 12. Finding 2: Array transaction success: valid batch commits all operations atomically.
    const batchSuccess = (await runWithTenant(merchantA, async () =>
      extended.$transaction([
        extended.order.create({ data: orderInput(merchantA, `RLS-BATCH-OK1-${suffix}`) }),
        extended.order.create({ data: orderInput(merchantA, `RLS-BATCH-OK2-${suffix}`) }),
      ])
    )) as Array<{ id: string }>;
    assert.equal(
      batchSuccess.length,
      2,
      'successful array transaction returns all operation results'
    );
    console.log('PASS: successful array transaction returns correct batch results');

    // 13. Finding 3 negative test: connection diagnostics must not leak database credentials.
    const secretPassword = 'ultra_secret_pg_password_999!';
    const sensitiveUrl = `postgresql://shipde_app:${secretPassword}@db.internal:5432/shipde_prod?schema=public`;
    const sanitized = sanitizeDatabaseEndpoint(sensitiveUrl);
    assert.equal(
      sanitized.includes(secretPassword),
      false,
      'sanitized database endpoint must NEVER contain the database password'
    );
    // Finding 11: assert intent (username kept, password stripped, host/db preserved) without brittle exact string
    assert.ok(
      sanitized.includes('shipde_app') &&
        !sanitized.includes(secretPassword) &&
        sanitized.includes('db.internal') &&
        sanitized.includes('shipde_prod'),
      'sanitized database endpoint must retain username and host while omitting password'
    );
    console.log('PASS: connection diagnostics sanitize database credentials');

    // 14. Review round 4 P1 (negative): an extended model query submitted
    //     through a FOREIGN, unextended client's batch transaction carries
    //     Prisma transaction metadata, but that transaction never executed
    //     set_config('app.tenant_id'). The extension must fail closed
    //     instead of letting the query run under the pilot fail-open clause
    //     (which would return Tenant B's rows to Tenant A).
    const dispatchCountBeforeRejections = dispatchedOperations.length;
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await probe.$transaction([
          extended.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } }),
        ]);
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof TenantRlsUnconfiguredTransactionError,
          `foreign batch transaction must be rejected by the extension, got: ${
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          }`
        );
        assert.match(error.message, /Order\.findMany/, 'rejection must name the denied operation');
        return true;
      },
      'extended query through an unextended batch transaction must fail closed under tenant context'
    );
    console.log(
      'PASS: foreign batch transaction with extended query fails closed (no fail-open cross-tenant read)'
    );
    // Finding 4: Prove that no SQL was dispatched for the rejected foreign batch transaction
    assert.equal(
      dispatchedOperations.length,
      dispatchCountBeforeRejections,
      'rejected foreign batch transaction must NOT dispatch any operation/SQL to the engine'
    );

    // 14b. The same composition with an extended RAW query must fail closed too.
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await probe.$transaction([
          extended.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM orders WHERE id IN (${orderA.id}::uuid, ${orderB.id}::uuid)
          `,
        ]);
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof TenantRlsUnconfiguredTransactionError,
          'foreign batch transaction with raw query must be rejected by the extension'
        );
        return true;
      },
      'extended raw query through an unextended batch transaction must fail closed under tenant context'
    );
    assert.equal(
      dispatchedOperations.length,
      dispatchCountBeforeRejections,
      'rejected foreign batch transaction with raw query must NOT dispatch any operation/SQL to the engine'
    );
    console.log('PASS: foreign batch transaction with extended raw query fails closed');

    // 15. A root-client extended query issued inside a FOREIGN interactive
    //     transaction has no transaction metadata, so the extension still
    //     wraps it in its own set_config transaction. Under the restricted
    //     role, RLS must deny the cross-tenant row (not fail open).
    //     Finding 1: We demonstrate that the inner query sets and enforces
    //     app.tenant_id with connection isolation.
    await runWithTenant(merchantA, async () => {
      const { rows, innerTenant, outerPid, innerPid } = await probe.$transaction(async (tx) => {
        const [outerPidRow] = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid
        `;
        const innerInfo = await extended.$queryRaw<Array<{ pid: number; tenant: string | null }>>`
          SELECT pg_backend_pid() AS pid, NULLIF(current_setting('app.tenant_id', true), '') AS tenant
        `;
        const candidateRows = await extended.order.findMany({
          where: { id: { in: [orderA.id, orderB.id] } },
        });
        return {
          rows: candidateRows,
          outerPid: outerPidRow?.pid,
          innerPid: innerInfo[0]?.pid,
          innerTenant: innerInfo[0]?.tenant,
        };
      });
      // Finding 1: Assert distinct connection PIDs proving connection isolation
      assert.ok(outerPid, 'outer transaction connection PID must be present');
      assert.ok(innerPid, 'inner query connection PID must be present');
      assert.notEqual(
        outerPid,
        innerPid,
        'inner root-client query must use a distinct pooled connection from the outer interactive transaction'
      );
      assert.deepEqual(
        rows.map((row) => row.id),
        [orderA.id],
        'root-client extended query inside a foreign interactive transaction must stay tenant-scoped by RLS'
      );
      assert.equal(
        innerTenant,
        merchantA,
        'inner query connection must have app.tenant_id = merchantA'
      );
    });
    console.log(
      'PASS: root-client extended query inside foreign interactive transaction stays tenant-scoped'
    );

    // 16. Behavior guard (BR-RLS-05): the foreign batch composition WITHOUT
    //     a tenant context keeps the documented pilot fail-open behavior.
    //     The rejection in test 14 is specific to tenant contexts, not a
    //     blanket ban on foreign transactions.
    const foreignUnscoped = (await probe.$transaction([
      extended.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } }),
    ])) as Array<Array<{ id: string }>>;
    assert.deepEqual(
      foreignUnscoped[0].map((row) => row.id).sort(),
      [orderA.id, orderB.id].sort(),
      'non-tenant sessions keep documented fail-open visibility through foreign batch transactions during the pilot'
    );
    console.log(
      'PASS: foreign batch transaction without tenant context keeps documented fail-open behavior'
    );

    // 17. Finding 1 regression: nested composition where an extended interactive transaction
    //     callback encloses an inner foreign batch transaction under tenant context:
    //     runWithTenant(A, () => extended.$transaction(async () => probe.$transaction([extended.order.findMany()])))
    //     Even though the outer transaction executed tenant setup, the inner foreign batch runs on
    //     a distinct unconfigured connection. Because setup proof is bound to the actual transaction
    //     identity, the inner batch must be rejected with TenantRlsUnconfiguredTransactionError
    //     instead of admitting the foreign batch to return other tenants' orders under the restricted role.
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.$transaction(async () => {
          await probe.$transaction([
            extended.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } }),
          ]);
        });
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof TenantRlsUnconfiguredTransactionError,
          `nested foreign batch transaction inside extended transaction must fail closed, got: ${
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          }`
        );
        assert.match(
          error.message,
          /Order\.findMany/,
          'nested foreign batch rejection must name the denied operation'
        );
        return true;
      },
      'nested foreign batch transaction inside outer extended transaction must fail closed under tenant context'
    );
    console.log(
      'PASS: nested foreign batch transaction inside extended transaction fails closed (setup proof bound to tx identity)'
    );

    // 17b. The same nested composition with an extended RAW query must fail closed too.
    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.$transaction(async () => {
          await probe.$transaction([
            extended.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM orders WHERE id IN (${orderA.id}::uuid, ${orderB.id}::uuid)
            `,
          ]);
        });
      }),
      (error: unknown) => {
        assert.ok(
          error instanceof TenantRlsUnconfiguredTransactionError,
          'nested foreign batch transaction with raw query must fail closed'
        );
        return true;
      },
      'nested foreign batch transaction with raw query inside extended transaction must fail closed'
    );
    console.log(
      'PASS: nested foreign batch transaction with raw query inside extended transaction fails closed'
    );

    // 18. Finding 21: Parallel concurrent transactions under different tenant contexts
    // Must guarantee per-$transaction isolation with zero cross-tenant contamination.
    const concurrentCodeA = `RLS-CONC-A-${suffix}`;
    const concurrentCodeB = `RLS-CONC-B-${suffix}`;
    const [resA, resB] = await Promise.all([
      runWithTenant(merchantA, async () =>
        extended.$transaction(async (tx) => {
          return tx.order.create({ data: orderInput(merchantA, concurrentCodeA) });
        })
      ),
      runWithTenant(merchantB, async () =>
        extended.$transaction(async (tx) => {
          return tx.order.create({ data: orderInput(merchantB, concurrentCodeB) });
        })
      ),
    ]);
    assert.equal(resA.merchant_id, merchantA, 'concurrent txA must write merchantA');
    assert.equal(resB.merchant_id, merchantB, 'concurrent txB must write merchantB');
    assert.equal(resA.order_code, concurrentCodeA);
    assert.equal(resB.order_code, concurrentCodeB);
    console.log(
      'PASS: concurrent transactions under distinct tenant contexts maintain strict isolation'
    );

    // 19. Finding 3 / Finding 19: End-to-end HTTP pipeline verification via NestJS + Supertest
    // Configures the application connection with the restricted probe role (NOBYPASSRLS)
    // and asserts downstream getTenantId() observation plus unfiltered orders query isolation.
    const restrictedPrisma = new PrismaService({
      datasources: { db: { url: probeUrl.toString() } },
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, SessionModule],
      controllers: [TestRlsContextController],
    })
      .overrideProvider(PrismaService)
      .useValue(restrictedPrisma)
      .compile();
    const app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    await app.init();

    await restrictedPrisma.checkReadiness();
    const rbacService = app.get(RbacService);
    await rbacService.ensurePlatformSeed();

    const uIdA = randomUUID();
    const sIdA = randomUUID();
    const uIdB = randomUUID();
    const sIdB = randomUUID();
    const tokenSecret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);

    const { token: tokenA } = signAccessToken(
      { sub: uIdA, sid: sIdA, mid: merchantA, role: RoleEnum.OWNER, st: 'ACTIVE' },
      tokenSecret,
      3600
    );
    const { token: tokenB } = signAccessToken(
      { sub: uIdB, sid: sIdB, mid: merchantB, role: RoleEnum.OWNER, st: 'ACTIVE' },
      tokenSecret,
      3600
    );

    try {
      await admin.user.create({
        data: {
          id: uIdA,
          merchant_id: merchantA,
          email: `rls_probe_a_${suffix}@shipde.vn`,
          full_name: 'Probe User A',
          password_hash: 'hashed',
          role: RoleEnum.OWNER,
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
        },
      });
      await admin.deviceSession.create({
        data: {
          id: sIdA,
          user_id: uIdA,
          merchant_id: merchantA,
          session_token_hash: createHash('sha256').update(tokenA).digest('hex'),
          device_id: `test-device-a-${suffix}`,
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 3600 * 1000),
        },
      });

      await admin.user.create({
        data: {
          id: uIdB,
          merchant_id: merchantB,
          email: `rls_probe_b_${suffix}@shipde.vn`,
          full_name: 'Probe User B',
          password_hash: 'hashed',
          role: RoleEnum.OWNER,
          status: 'active',
          store_scopes: ['*'],
          warehouse_scopes: ['*'],
        },
      });
      await admin.deviceSession.create({
        data: {
          id: sIdB,
          user_id: uIdB,
          merchant_id: merchantB,
          session_token_hash: createHash('sha256').update(tokenB).digest('hex'),
          device_id: `test-device-b-${suffix}`,
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 3600 * 1000),
        },
      });

      // Finding 3 / Finding 19: HTTP acceptance with observed getTenantId() downstream
      // and unfiltered orders query through the restricted application connection.
      // Merchant A test-rls request:
      // 1. downstream handler observes getTenantId() === merchantA
      // 2. unfiltered query through restricted application connection returns ONLY Tenant A's orders
      const httpRlsResA = await request(app.getHttpServer())
        .get('/api/v1/test-rls/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      assert.equal(
        httpRlsResA.body.observedTenantId,
        merchantA,
        'downstream HTTP handler must observe getTenantId() === merchantA from TenantMiddleware'
      );
      const rlsCodesA = httpRlsResA.body.orders?.map((o: any) => o.order_code) || [];
      assert.ok(
        rlsCodesA.includes(`RLS-A-${suffix}`),
        'unfiltered orders query through restricted connection must include own-tenant order A'
      );
      assert.ok(
        !rlsCodesA.includes(`RLS-B-${suffix}`),
        'unfiltered orders query through restricted connection must NOT return foreign-tenant order B'
      );

      // Merchant B test-rls request:
      // 1. downstream handler observes getTenantId() === merchantB
      // 2. unfiltered query returns ONLY Tenant B's orders
      const httpRlsResB = await request(app.getHttpServer())
        .get('/api/v1/test-rls/orders')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      assert.equal(
        httpRlsResB.body.observedTenantId,
        merchantB,
        'downstream HTTP handler must observe getTenantId() === merchantB from TenantMiddleware'
      );
      const rlsCodesB = httpRlsResB.body.orders?.map((o: any) => o.order_code) || [];
      assert.ok(
        rlsCodesB.includes(`RLS-B-${suffix}`),
        'unfiltered orders query through restricted connection must include own-tenant order B'
      );
      assert.ok(
        !rlsCodesB.includes(`RLS-A-${suffix}`),
        'unfiltered orders query through restricted connection must NOT return foreign-tenant order A'
      );

      // Unauthenticated request to test-rls endpoint must be denied with 401
      await request(app.getHttpServer()).get('/api/v1/test-rls/orders').expect(401);

      // Negative HTTP test: token with empty scope must deny tenant context establishment
      const { token: tokenEmptyScope } = signAccessToken(
        {
          sub: uIdA,
          sid: sIdA,
          mid: merchantA,
          role: RoleEnum.OWNER,
          st: 'ACTIVE',
          scope: '',
        } as any,
        tokenSecret,
        3600
      );
      const httpResEmptyScope = await request(app.getHttpServer())
        .get('/api/v1/test-rls/orders')
        .set('Authorization', `Bearer ${tokenEmptyScope}`)
        .expect(200);
      assert.strictEqual(
        httpResEmptyScope.body.observedTenantId,
        undefined,
        'token with empty scope must deny tenant context establishment'
      );

      // Merchant A search request: must only see Tenant A's orders, never Tenant B's orders
      const httpResA = await request(app.getHttpServer())
        .get(`/api/v1/search?q=RLS-&type=ORDER`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const codesA = httpResA.body.data?.items?.map((i: any) => i.code) || [];
      assert.ok(codesA.includes(`RLS-A-${suffix}`), 'Merchant A must find its own order');
      assert.ok(
        !codesA.includes(`RLS-B-${suffix}`),
        'Merchant A search must NOT return Tenant B order'
      );

      // Merchant B search request: must only see Tenant B's orders
      const httpResB = await request(app.getHttpServer())
        .get(`/api/v1/search?q=RLS-&type=ORDER`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      const codesB = httpResB.body.data?.items?.map((i: any) => i.code) || [];
      assert.ok(codesB.includes(`RLS-B-${suffix}`), 'Merchant B must find its own order');
      assert.ok(
        !codesB.includes(`RLS-A-${suffix}`),
        'Merchant B search must NOT return Tenant A order'
      );

      // Unauthenticated request must be denied with 401 UNAUTHENTICATED
      await request(app.getHttpServer()).get(`/api/v1/search?q=RLS-&type=ORDER`).expect(401);

      console.log(
        'PASS: end-to-end HTTP pipeline (middleware -> guard -> controller -> service -> extended Prisma -> RLS) verified'
      );
    } finally {
      await app.close();
      await restrictedPrisma.$disconnect().catch(() => {});
      await admin.deviceSession
        .deleteMany({ where: { user_id: { in: [uIdA, uIdB] } } })
        .catch(() => {});
      await admin.user.deleteMany({ where: { id: { in: [uIdA, uIdB] } } }).catch(() => {});
    }
  } finally {
    await admin.order
      .deleteMany({
        where: {
          merchant_id: { in: [merchantA, merchantB] },
        },
      })
      .catch(() => {});
    await admin.merchant
      .deleteMany({ where: { id: { in: [merchantA, merchantB] } } })
      .catch(() => {});
    await admin
      .$executeRaw(
        Prisma.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`)
      )
      .catch(() => {});
    await admin
      .$executeRaw(
        Prisma.raw(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`)
      )
      .catch(() => {});
    await admin
      .$executeRaw(Prisma.raw(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`))
      .catch(() => {});
    await admin
      .$executeRaw(
        Prisma.raw(`REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`)
      )
      .catch(() => {});
    await admin.$executeRaw(Prisma.raw(`DROP ROLE IF EXISTS ${PROBE_ROLE}`)).catch(() => {});
    await admin.$disconnect().catch(() => {});
    await probe.$disconnect().catch(() => {});
  }

  console.log('orders RLS integration tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
