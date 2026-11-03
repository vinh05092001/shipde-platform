import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('local runner rejects production before spawning suites', () => {
  const runnerPath = fileURLToPath(new URL('../../../scripts/test-local-db.mjs', import.meta.url));
  const res = spawnSync(process.execPath, [runnerPath], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      TEST_DB: 'local',
    },
    encoding: 'utf8',
  });
  assert.notEqual(res.status, 0, 'Runner must exit with nonzero status in production');
  const output = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.match(output, /production/i, 'Output must explain production rejection');
  assert.doesNotMatch(output, /^RUN /m, 'Must launch zero child suites');
});

test('local runner keeps production mode for child suites instead of relabelling it', () => {
  // Review finding: the runner used to force NODE_ENV=test on children, which hides the
  // caller's production mode from the helper's own production rejection (BR-LOCAL-01).
  const runnerPath = fileURLToPath(new URL('../../../scripts/test-local-db.mjs', import.meta.url));
  const source = readFileSync(runnerPath, 'utf8');
  // A hard-coded child NODE_ENV (with or without spaces) must never appear in the runner.
  assert.equal(
    /NODE_ENV: 'test',/.test(source),
    false,
    'The runner must not relabel the caller NODE_ENV when starting child suites'
  );
  assert.equal(
    /NODE_ENV:'test',/.test(source),
    false,
    'The runner must not relabel the caller NODE_ENV when starting child suites'
  );
  // Child suites must inherit the caller's mode so the helper can still reject production.
  assert.ok(
    source.includes('NODE_ENV: process.env.NODE_ENV'),
    'Child suite environment must inherit the caller NODE_ENV'
  );
});

test('TASK-AI-163 delivery stays within allowed paths', () => {
  const rootDir = fileURLToPath(new URL('../../../', import.meta.url));
  // Compare diff against origin/main (including uncommitted working tree changes)
  const diffOutput = execFileSync(
    'git',
    ['-c', 'safe.directory=*', 'diff', '--name-only', 'origin/main'],
    { cwd: rootDir, encoding: 'utf8' }
  ).trim();

  const allowedPatterns = [
    /^packages\/testkit\//,
    /^apps\/api\/test-support\//,
    /^apps\/api\/src\/.*\.supertest\.spec\.ts$/,
    /^scripts\/test-local-db\.mjs$/,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^docs\/product-spec\/work-items\/TASK-AI-163\.md$/,
    /^docs\/product-spec\/docs\/10-ai-collaboration\/AI-TOOLCHAIN-DECISIONS\.md$/,
    /^docs\/product-spec\/docs\/10-ai-collaboration\/FEATURE-DELIVERY-REGISTER\.csv$/,
    /^\.oc\/pr-body\.md$/,
    /^\.oc\/tmp\//,
  ];

  const changedFiles = diffOutput.split(/\r?\n/).filter(Boolean);
  for (const file of changedFiles) {
    const normalized = file.replaceAll('\\', '/');
    const isAllowed = allowedPatterns.some((pattern) => pattern.test(normalized));
    assert.ok(isAllowed, `File ${normalized} is outside TASK-AI-163 allowed paths`);
  }

  const registerRelPath =
    'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  const registerFullPath = resolve(rootDir, registerRelPath);
  const currentRegister = readFileSync(registerFullPath, 'utf8')
    .replaceAll('\r\n', '\n')
    .trimEnd()
    .split('\n');

  const originRegisterRaw = execFileSync(
    'git',
    ['-c', 'safe.directory=*', 'show', `origin/main:${registerRelPath}`],
    { cwd: rootDir, encoding: 'utf8' }
  )
    .replaceAll('\r\n', '\n')
    .trimEnd()
    .split('\n');

  const isTask163 = (line: string) => line.includes('"TASK-AI-163"');
  const currentOtherRows = currentRegister.filter((line) => !isTask163(line));
  const originOtherRows = originRegisterRaw.filter((line) => !isTask163(line));
  assert.deepEqual(
    currentOtherRows,
    originOtherRows,
    'Every unrelated register row must match origin/main exactly'
  );

  const task163Rows = currentRegister.filter(isTask163);
  assert.equal(task163Rows.length, 1, 'Delivery register must have exactly one TASK-AI-163 row');
});

test('local readiness failure omits caller credentials', () => {
  const apiDir = fileURLToPath(new URL('../../../apps/api', import.meta.url));
  const require = createRequire(import.meta.url);
  const tsxHref = pathToFileURL(require.resolve('tsx')).href;
  // Obviously fake credentials; never a key-shaped or real connection string.
  const fixturePassword = 'fixture-not-a-real-password';
  const sensitiveUrl = `postgresql://fixture_user:${fixturePassword}@synthetic-host.invalid:5432/db`;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    TEST_DB: 'local',
    DATABASE_URL: sensitiveUrl,
    TEST_FORCE_READINESS: 'down',
  };
  // The assertion must not depend on whether the caller happens to run in CI.
  delete childEnv.CI;

  const res = spawnSync(
    process.execPath,
    ['--import', tsxHref, 'src/auth/auth.login.supertest.spec.ts'],
    { cwd: apiDir, env: childEnv, encoding: 'utf8', timeout: 180_000, windowsHide: true }
  );

  assert.notEqual(res.status, 0, 'Readiness failure must remain a failure (BR-LOCAL-04)');
  const diagnostics = `${res.stdout || ''}\n${res.stderr || ''}`;
  assert.equal(diagnostics.includes(sensitiveUrl), false, 'Must not echo the caller URL');
  assert.equal(diagnostics.includes(fixturePassword), false, 'Must not echo the caller password');
  assert.equal(diagnostics.includes('synthetic-host.invalid'), false, 'Must not echo the host');
  assert.match(diagnostics, /reachable/i, 'Failure must still explain the readiness failure');
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
