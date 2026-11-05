import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { runWithTenant } from './tenant-context';
import { tenantRlsExtension } from './tenant-rls.extension';

// TASK-AI-154: Orders RLS acceptance tests (AC-AI-154-01..08, one test per AC)
const POLICY_NAME = 'orders_tenant_isolation';
const DEFAULT_URL = 'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';

function getDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const p of ['.env', '../../.env']) {
    const f = path.resolve(p);
    if (fs.existsSync(f)) {
      const match = fs.readFileSync(f, 'utf8').match(/^DATABASE_URL=(.*)$/m);
      if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return DEFAULT_URL;
}

function endpoint(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host || 'localhost'}/${u.pathname.replace(/^\//, '') || 'shipde_dev'}`;
  } catch {
    return '[sanitized-db-endpoint]';
  }
}

function orderData(mid: string, code: string) {
  return {
    merchant_id: mid,
    order_code: code,
    created_at: new Date('2026-10-31T00:00:00.000Z'),
    recipient_name: 'Tenant Probe',
    recipient_phone: '0900000000',
    recipient_province: 'HN',
    recipient_address: '1 Probe Street',
  };
}

async function main(): Promise<void> {
  const dbUrl = getDbUrl();
  const admin = new PrismaClient({ datasources: { db: { url: dbUrl } } });

  try {
    await admin.$connect();
    await admin.$queryRaw`SELECT 1`;
  } catch {
    const ep = endpoint(dbUrl);
    if (process.env.CI) {
      await admin.$disconnect().catch(() => {});
      throw new Error(`PostgreSQL must be reachable for orders RLS in CI (${ep})`);
    }
    console.warn(`PostgreSQL not reachable at ${ep}. Skipping orders RLS integration tests.`);
    await admin.$disconnect().catch(() => {});
    return;
  }

  const [rlsFlags, policyRows] = await Promise.all([
    admin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public' AND c.relname='orders' AND c.relkind='r'
    `,
    admin.$queryRaw<
      Array<{ policyname: string }>
    >`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='orders' AND policyname=${POLICY_NAME}`,
  ]);
  if (
    !rlsFlags[0]?.relrowsecurity ||
    !rlsFlags[0]?.relforcerowsecurity ||
    policyRows.length === 0
  ) {
    if (process.env.CI) throw new Error('orders RLS DDL missing in CI; run pnpm db:migrate');
    console.warn('orders RLS DDL not applied locally. Skipping.');
    await admin.$disconnect().catch(() => {});
    return;
  }

  const roleSuffix = randomUUID().replace(/-/g, '').slice(0, 10).toLowerCase();
  const PROBE_ROLE = `shipde_rls_probe_${roleSuffix}`;
  const probePassword = randomUUID().replace(/-/g, '');
  const [{ current_database: currentDb }] = await admin.$queryRaw<
    Array<{ current_database: string }>
  >`SELECT current_database()`;

  const runSql = async (sqls: string[], ignoreErrors = false) => {
    for (const sql of sqls) {
      if (ignoreErrors) await admin.$executeRaw(Prisma.raw(sql)).catch(() => {});
      else await admin.$executeRaw(Prisma.raw(sql));
    }
  };

  const cleanupRole = () =>
    runSql(
      [
        `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${PROBE_ROLE}`,
        `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${PROBE_ROLE}`,
        `REVOKE ALL PRIVILEGES ON SCHEMA public FROM ${PROBE_ROLE}`,
        `REVOKE ALL PRIVILEGES ON DATABASE "${currentDb}" FROM ${PROBE_ROLE}`,
        `DROP ROLE IF EXISTS ${PROBE_ROLE}`,
      ],
      true
    );

  await cleanupRole();
  await runSql([
    `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${probePassword}' NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
    `GRANT CONNECT ON DATABASE "${currentDb}" TO ${PROBE_ROLE}`,
    `GRANT USAGE ON SCHEMA public TO ${PROBE_ROLE}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`,
    `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${PROBE_ROLE}`,
  ]);

  const probeUrl = new URL(dbUrl);
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
    const orderA = await admin.order.create({ data: orderData(merchantA, `RLS-A-${suffix}`) });
    const orderB = await admin.order.create({ data: orderData(merchantB, `RLS-B-${suffix}`) });

    // AC-AI-154-01: Tenant A queries findMany without merchant_id filter -> only Tenant A orders
    await runWithTenant(merchantA, async () => {
      const rows = await extended.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } });
      assert.deepEqual(
        rows.map((r: any) => r.id),
        [orderA.id]
      );
    });
    console.log('PASS: AC-AI-154-01');

    // AC-AI-154-02: Tenant A queries findUnique for Tenant B order -> returns null
    await runWithTenant(merchantA, async () => {
      assert.equal(await extended.order.findUnique({ where: { id: orderB.id } }), null);
    });
    console.log('PASS: AC-AI-154-02');

    // AC-AI-154-03: Tenant A creates order with Tenant B merchant_id -> rejected by RLS WITH CHECK
    await assert.rejects(
      runWithTenant(merchantA, async () =>
        extended.order.create({ data: orderData(merchantB, `RLS-CROSS-${suffix}`) })
      ),
      (err: unknown) =>
        /row-level security|new row violates/i.test(
          err instanceof Error ? err.message : String(err)
        )
    );
    console.log('PASS: AC-AI-154-03');

    // AC-AI-154-04: Tenant A updates Tenant B order -> rejected and unchanged
    await assert.rejects(
      runWithTenant(merchantA, async () =>
        extended.order.update({ where: { id: orderB.id }, data: { recipient_province: 'SG' } })
      )
    );
    assert.equal(
      (await admin.order.findUnique({ where: { id: orderB.id } }))?.recipient_province,
      'HN'
    );
    console.log('PASS: AC-AI-154-04');

    // AC-AI-154-05: Tenant A creates order for own merchant_id -> succeeds
    const own = await runWithTenant(merchantA, async () =>
      extended.order.create({ data: orderData(merchantA, `RLS-OWN-${suffix}`) })
    );
    assert.equal(own.merchant_id, merchantA);
    console.log('PASS: AC-AI-154-05');

    // AC-AI-154-06: Unscoped query succeeds under pilot fail-open
    const unscoped = await extended.order.findMany({
      where: { id: { in: [orderA.id, orderB.id] } },
    });
    assert.deepEqual(unscoped.map((r: any) => r.id).sort(), [orderA.id, orderB.id].sort());
    console.log('PASS: AC-AI-154-06');

    // AC-AI-154-07: Interactive transaction applies tenant setting
    const inTx = (await runWithTenant(merchantA, async () =>
      extended.$transaction(async (tx: any) =>
        tx.order.findMany({ where: { id: { in: [orderA.id, orderB.id] } } })
      )
    )) as Array<{ id: string }>;
    assert.deepEqual(
      inTx.map((r) => r.id),
      [orderA.id]
    );
    console.log('PASS: AC-AI-154-07');

    // AC-AI-154-08: Malformed tenant context fails closed on uuid cast
    await assert.rejects(
      runWithTenant('not-a-uuid', async () =>
        extended.order.findMany({ where: { merchant_id: merchantA } })
      ),
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
