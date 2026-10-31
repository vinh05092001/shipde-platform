import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runWithTenant } from './tenant-context';
import { tenantRlsExtension } from './tenant-rls.extension';

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

const PROBE_ROLE = 'shipde_rls_probe';
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
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(
        `PostgreSQL must be reachable for orders RLS integration tests in CI (${databaseUrl})`
      );
    }
    console.warn(
      `PostgreSQL is not reachable at ${databaseUrl}. Skipping orders RLS integration tests (run 'pnpm infra:up' to enable).`
    );
    await admin.$disconnect().catch(() => {});
    console.log('Orders RLS integration suite skipped offline safely!');
    return;
  }

  // Verify the TASK-AI-154 migration DDL is present before testing behavior.
  const rlsFlags = await admin.$queryRawUnsafe<
    Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
  >(
    "SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'orders' AND c.relkind = 'r'"
  );
  const policyRows = await admin.$queryRawUnsafe<Array<{ policyname: string; permissive: string }>>(
    "SELECT policyname, permissive FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders'"
  );
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
  const dbRows = await admin.$queryRawUnsafe<Array<{ current_database: string }>>(
    'SELECT current_database()'
  );
  const currentDb = dbRows[0]?.current_database || 'shipde_dev';

  await admin
    .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`)
    .catch(() => {});
  await admin
    .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`)
    .catch(() => {});
  await admin
    .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`)
    .catch(() => {});
  await admin
    .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`)
    .catch(() => {});
  await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PROBE_ROLE}`).catch(() => {});

  await admin.$executeRawUnsafe(
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`
  );
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${currentDb}" TO ${PROBE_ROLE}`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orders, merchants TO ${PROBE_ROLE}`
  );
  await admin.$executeRawUnsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`);

  const probeUrl = new URL(databaseUrl);
  probeUrl.username = PROBE_ROLE;
  probeUrl.password = probePassword;
  const probe = new PrismaClient({ datasources: { db: { url: probeUrl.toString() } } });
  const extended = probe.$extends(tenantRlsExtension(probe));

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
    console.log('PASS: cross-tenant read denied without merchant_id filter');

    // 2. Cross-tenant point read returns no row.
    await runWithTenant(merchantA, async () => {
      const row = await extended.order.findUnique({ where: { id: orderB.id } });
      assert.equal(row, null, 'lookup of another tenant order must return no row');
    });
    console.log('PASS: cross-tenant point read returns no row');

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
    console.log('PASS: cross-tenant insert denied by RLS');

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
  } finally {
    await admin.order
      .deleteMany({ where: { merchant_id: { in: [merchantA, merchantB] } } })
      .catch(() => {});
    await admin.merchant
      .deleteMany({ where: { id: { in: [merchantA, merchantB] } } })
      .catch(() => {});
    await admin
      .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`)
      .catch(() => {});
    await admin
      .$executeRawUnsafe(
        `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`
      )
      .catch(() => {});
    await admin
      .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`)
      .catch(() => {});
    await admin
      .$executeRawUnsafe(`REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`)
      .catch(() => {});
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PROBE_ROLE}`).catch(() => {});
    await admin.$disconnect().catch(() => {});
    await probe.$disconnect().catch(() => {});
  }

  console.log('orders RLS integration tests passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
