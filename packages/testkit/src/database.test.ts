import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createLocalTestDatabase, isLocalTestDb, type LocalTestDatabase } from './database.js';

test('local DB selection is explicit and does not change the default PostgreSQL mode', () => {
  assert.equal(isLocalTestDb({}), false);
  assert.equal(isLocalTestDb({ TEST_DB: 'postgres' }), false);
  assert.equal(isLocalTestDb({ TEST_DB: 'local' }), true);
});

test('the local helper rejects production and missing opt-in before opening a DB', async () => {
  await assert.rejects(createLocalTestDatabase(PrismaClient, {}), /TEST_DB=local/);
  await assert.rejects(
    createLocalTestDatabase(PrismaClient, { TEST_DB: 'local', NODE_ENV: 'production' }),
    /production/
  );
});

describe('Prisma 6 with the complete repository migration history', { concurrency: false }, () => {
  let db: LocalTestDatabase<PrismaClient>;
  before(async () => {
    db = await createLocalTestDatabase(PrismaClient, { TEST_DB: 'local', NODE_ENV: 'test' });
  });
  beforeEach(async () => db.reset());
  after(async () => {
    if (db) {
      await db.close();
      await db.close();
    }
  });

  test('SQL and Prisma preserve PostgreSQL types used by our schema', async () => {
    const rows = await db.prisma.$queryRaw<
      { amount: bigint; roles: string[]; role: string; payload: { fixture: boolean }; id: string }[]
    >`SELECT 9007199254740993::bigint AS amount, ARRAY['OWNER','OPS_CSKH']::text[] AS roles,
        'PLATFORM_ADMIN'::"RoleEnum" AS role, '{"fixture":true}'::jsonb AS payload,
        gen_random_uuid() AS id`;
    assert.equal(rows[0].amount, 9007199254740993n);
    assert.deepEqual(rows[0].roles, ['OWNER', 'OPS_CSKH']);
    assert.equal(rows[0].role, 'PLATFORM_ADMIN');
    assert.deepEqual(rows[0].payload, { fixture: true });
    assert.match(rows[0].id, /^[0-9a-f-]{36}$/);
    await db.prisma.carrier.findMany();
    await db.prisma.onboardingState.findMany();
  });

  test('migration triggers, tenant uniqueness and foreign keys are enforced', async () => {
    const merchant = await db.prisma.merchant.create({
      data: { name: 'Fixture local DB', code: 'FIX-LOCAL-DB' },
    });
    const role = await db.prisma.role.create({
      data: { merchant_id: merchant.id, name: 'Fixture Operator' },
    });
    assert.equal(role.name_lower, 'fixture operator');
    await assert.rejects(
      db.prisma.role.create({ data: { merchant_id: merchant.id, name: 'FIXTURE OPERATOR' } }),
      { code: 'P2002' }
    );
    await assert.rejects(
      db.prisma.role.create({
        data: { merchant_id: '00000000-0000-0000-0000-000000000001', name: 'Fixture orphan' },
      }),
      { code: 'P2003' }
    );
  });

  test('interactive transaction failures roll back all writes', async () => {
    await assert.rejects(
      db.prisma.$transaction(async (tx) => {
        await tx.merchant.create({ data: { name: 'Fixture rollback', code: 'FIX-ROLLBACK' } });
        throw new Error('fixture rollback');
      }),
      /fixture rollback/
    );
    assert.equal(await db.prisma.merchant.count({ where: { code: 'FIX-ROLLBACK' } }), 0);
  });

  test('reset removes fixtures and reapplies the migration schema and triggers', async () => {
    await db.prisma.merchant.create({ data: { name: 'Fixture reset', code: 'FIX-RESET' } });
    const migrationCount = db.migrations.length;
    assert.ok(migrationCount > 0);
    await db.reset();
    assert.equal(await db.prisma.merchant.count({ where: { code: 'FIX-RESET' } }), 0);
    assert.equal(db.migrations.length, migrationCount);
    const merchant = await db.prisma.merchant.create({
      data: { name: 'Fixture reset', code: 'FIX-RESET' },
    });
    const role = await db.prisma.role.create({
      data: { merchant_id: merchant.id, name: 'After Reset' },
    });
    assert.equal(role.name_lower, 'after reset');
  });
});
