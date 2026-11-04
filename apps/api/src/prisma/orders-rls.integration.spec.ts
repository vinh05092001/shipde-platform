import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { runWithTenant } from './tenant-context';
import { tenantRlsExtension } from './tenant-rls.extension';

const POLICY_NAME = 'orders_tenant_isolation';
const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';

function loadEnvFile(): void {
  if (process.env.DATABASE_URL) return;
  for (const p of [path.resolve('.env'), path.resolve('../../.env')]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.trim().match(/^([^#=]+)=(.*)$/);
      if (m && !process.env[m[1].trim()]) {
        process.env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
    break;
  }
}

function sanitizeDatabaseEndpoint(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.username ? u.username + '@' : ''}${u.host || 'localhost'}/${u.pathname.replace(/^\//, '') || 'shipde_dev'}`;
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
  loadEnvFile();
  const databaseUrl = resolveDatabaseUrl();
  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    await admin.$connect();
    await admin.$queryRaw`SELECT 1`;
  } catch {
    const endpoint = sanitizeDatabaseEndpoint(databaseUrl);
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(`PostgreSQL must be reachable for orders RLS in CI (${endpoint})`);
    }
    console.warn(
      `PostgreSQL is not reachable at ${endpoint}. Skipping orders RLS integration tests.`
    );
    await admin.$disconnect().catch(() => {});
    return;
  }

  const [rlsFlags, policyRows] = await Promise.all([
    admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'orders' AND c.relkind = 'r'
    `,
    admin.$queryRaw<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = ${POLICY_NAME}
    `,
  ]);
  const rlsOk = rlsFlags[0]?.relrowsecurity && rlsFlags[0]?.relforcerowsecurity;
  if (!rlsOk || policyRows.length === 0) {
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(
        `orders RLS DDL missing in CI (rls=${rlsOk}, policy=${policyRows.length > 0}); run pnpm db:migrate`
      );
    }
    console.warn(`orders RLS DDL not applied locally. Skipping.`);
    await admin.$disconnect().catch(() => {});
    return;
  }

  const probeSuffix = randomUUID().replace(/-/g, '').slice(0, 10).toLowerCase();
  const PROBE_ROLE = `shipde_rls_probe_${probeSuffix}`;
  const probePassword = randomUUID().replace(/-/g, '');
  const dbRows = await admin.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;
  const currentDb = dbRows[0]?.current_database || 'shipde_dev';

  const cleanupRole = async () => {
    for (const sql of [
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`,
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`,
      `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`,
      `REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`,
      `DROP ROLE IF EXISTS ${PROBE_ROLE}`,
    ]) {
      await admin.$executeRaw(Prisma.raw(sql)).catch(() => {});
    }
  };

  await cleanupRole();
  for (const sql of [
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
    `GRANT CONNECT ON DATABASE "${currentDb}" TO ${PROBE_ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`,
  ]) {
    await admin.$executeRaw(Prisma.raw(sql));
  }

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
      data: { id: merchantA, name: `RLS A ${suffix}`, code: `rls-a-${suffix}` },
    });
    await admin.merchant.create({
      data: { id: merchantB, name: `RLS B ${suffix}`, code: `rls-b-${suffix}` },
    });
    const orderA = await admin.order.create({ data: orderInput(merchantA, `RLS-A-${suffix}`) });
    const orderB = await admin.order.create({ data: orderInput(merchantB, `RLS-B-${suffix}`) });

    await runWithTenant(merchantA, async () => {
      const visible = await extended.order.findMany({
        where: { id: { in: [orderA.id, orderB.id] } },
      });
      assert.deepEqual(
        visible.map((r) => r.id),
        [orderA.id]
      );
    });
    console.log('PASS: AC-AI-154-01');

    await runWithTenant(merchantA, async () => {
      const row = await extended.order.findUnique({ where: { id: orderB.id } });
      assert.equal(row, null);
    });
    console.log('PASS: AC-AI-154-02');

    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.order.create({ data: orderInput(merchantB, `RLS-CROSS-${suffix}`) });
      }),
      (err: unknown) =>
        /row-level security|new row violates/i.test(
          err instanceof Error ? err.message : String(err)
        )
    );
    console.log('PASS: AC-AI-154-03');

    await assert.rejects(
      runWithTenant(merchantA, async () => {
        await extended.order.update({
          where: { id: orderB.id },
          data: { recipient_province: 'SG' },
        });
      })
    );
    const untouched = await admin.order.findUnique({ where: { id: orderB.id } });
    assert.equal(untouched?.recipient_province, 'HN');
    console.log('PASS: AC-AI-154-04');

    const ownOrder = await runWithTenant(merchantA, async () =>
      extended.order.create({ data: orderInput(merchantA, `RLS-OWN-${suffix}`) })
    );
    assert.equal(ownOrder.merchant_id, merchantA);
    console.log('PASS: AC-AI-154-05');

    const unscoped = await extended.order.findMany({
      where: { id: { in: [orderA.id, orderB.id] } },
    });
    assert.deepEqual(unscoped.map((r) => r.id).sort(), [orderA.id, orderB.id].sort());
    console.log('PASS: AC-AI-154-06');

    const inTx = (await runWithTenant(merchantA, async () =>
      extended.$transaction(async (tx) =>
        tx.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } })
      )
    )) as Array<{ id: string }>;
    assert.deepEqual(
      inTx.map((r) => r.id),
      [orderA.id]
    );
    console.log('PASS: AC-AI-154-07');

    await assert.rejects(
      runWithTenant('not-a-uuid', async () => {
        await extended.order.findMany({ where: { merchant_id: merchantA } });
      }),
      (err: unknown) =>
        /invalid input syntax for type uuid/i.test(err instanceof Error ? err.message : String(err))
    );
    console.log('PASS: AC-AI-154-08');
  } finally {
    await admin.order
      .deleteMany({ where: { merchant_id: { in: [merchantA, merchantB] } } })
      .catch(() => {});
    await admin.merchant
      .deleteMany({ where: { id: { in: [merchantA, merchantB] } } })
      .catch(() => {});
    await cleanupRole();
    await admin.$disconnect().catch(() => {});
    await probe.$disconnect().catch(() => {});
  }

  console.log('All orders RLS AC integration tests passed (AC-AI-154-01..08)');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
