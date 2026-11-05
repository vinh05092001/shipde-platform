import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import {
  createLocalTestDatabase,
  describeDatabaseTarget,
  isGitleaksBinaryAvailable,
  isLocalTestDb,
  type LocalTestDatabase,
  skipSecretsScanWhenGitleaksMissing,
} from './database.js';

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

test('describeDatabaseTarget names only host:port/db, never credentials or query', () => {
  // BR-LOCAL-06 / BR-LOCAL-04: readiness failures stay failures but name only the masked target.
  const message = describeDatabaseTarget('postgres://u:secretpw@h:5432/d?sslmode=x');
  assert.equal(message, 'h:5432/d');
  assert.equal(message.includes('u:'), false, 'Must not contain the username');
  assert.equal(message.includes('secretpw'), false, 'Must not contain the password');
  assert.equal(message.includes('sslmode'), false, 'Must not contain query parameters');
  // Unparseable or opaque (authority-less) input fails closed instead of echoing the raw string.
  for (const raw of ['u:secretpw@not a url', 'postgresql:u:secretpw@h/d', 'not-a-url', undefined]) {
    const masked = describeDatabaseTarget(raw);
    assert.equal(masked.includes('secretpw'), false, `${String(raw)} must not be echoed`);
    assert.equal(masked.includes('u:'), false, `${String(raw)} must not echo the username`);
  }
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
  assert.equal(diagnostics.includes('fixture_user'), false, 'Must not echo the caller username');
  assert.ok(
    diagnostics.includes('synthetic-host.invalid:5432/db'),
    'Failure must name only the masked host:port/db target from describeDatabaseTarget'
  );
  assert.match(diagnostics, /reachable/i, 'Failure must still explain the readiness failure');
});

test('all local readiness failures redact caller credentials', () => {
  const apiDir = fileURLToPath(new URL('../../../apps/api', import.meta.url));
  const require = createRequire(import.meta.url);
  const tsxHref = pathToFileURL(require.resolve('tsx')).href;
  const fixtureUser = 'fixture_user';
  const fixturePassword = 'fixture-not-a-real-password';
  const fixtureHost = 'synthetic-host.invalid';
  const sensitiveUrl = `postgresql://${fixtureUser}:${fixturePassword}@${fixtureHost}:5432/db`;

  const affectedSuites = [
    'src/branches/branches.supertest.spec.ts',
    'src/auth/admin-shops.supertest.spec.ts',
    'src/auth/auth.supertest.spec.ts',
    'src/onboarding/onboarding.supertest.spec.ts',
    'src/search/search.supertest.spec.ts',
    'src/session/session.supertest.spec.ts',
    'src/shops/shops.supertest.spec.ts',
    'src/warehouses/warehouses.supertest.spec.ts',
  ];

  for (const suite of affectedSuites) {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TEST_DB: 'local',
      DATABASE_URL: sensitiveUrl,
      TEST_FORCE_READINESS: 'down',
    };
    delete childEnv.CI;

    const res = spawnSync(process.execPath, ['--import', tsxHref, suite], {
      cwd: apiDir,
      env: childEnv,
      encoding: 'utf8',
      timeout: 180_000,
      windowsHide: true,
    });

    assert.notEqual(
      res.status,
      0,
      `Readiness failure in ${suite} must remain a failure (BR-LOCAL-04)`
    );
    const diagnostics = `${res.stdout || ''}\n${res.stderr || ''}`;
    assert.equal(
      diagnostics.includes(sensitiveUrl),
      false,
      `${suite} must not echo the caller URL`
    );
    assert.equal(
      diagnostics.includes(fixtureUser),
      false,
      `${suite} must not echo the caller username`
    );
    assert.equal(
      diagnostics.includes(fixturePassword),
      false,
      `${suite} must not echo the caller password`
    );
    assert.ok(
      diagnostics.includes(`${fixtureHost}:5432/db`),
      `${suite} must name only the masked host:port/db target from describeDatabaseTarget`
    );
    assert.match(diagnostics, /reachable/i, `${suite} failure must explain readiness failure`);
  }
});

test('rbac secrets scan is named-skipped while the Gitleaks binary is unavailable', () => {
  // Round 84 P1: the CI test step runs before the "Install Pinned Gitleaks" step, so the
  // in-suite scan died with exit code 2 and failed @shipde/api#test (current-application).
  const lines: string[] = [];
  const skipped = skipSecretsScanWhenGitleaksMissing('rbac security secrets git scan', {
    probe: () => false,
    log: (line) => lines.push(line),
  });
  assert.equal(skipped, true, 'The in-suite scan must skip when the Gitleaks CLI is missing');
  assert.equal(lines.length, 1, 'Exactly one machine-readable skip line must be recorded');
  assert.ok(lines[0].startsWith('SHIPDE_TEST_SKIP '), 'The skip must use the named skip marker');
  const payload = JSON.parse(lines[0].slice('SHIPDE_TEST_SKIP '.length));
  assert.equal(payload.name, 'rbac security secrets git scan');
  assert.match(
    payload.reason,
    /security:secrets/,
    'The reason must name the enforcing workflow step instead of hiding the omission'
  );
});

test('rbac secrets scan still runs whenever the Gitleaks binary is available', () => {
  const lines: string[] = [];
  const skipped = skipSecretsScanWhenGitleaksMissing('rbac security secrets git scan', {
    probe: () => true,
    log: (line) => lines.push(line),
  });
  assert.equal(skipped, false, 'A provisioned Gitleaks CLI must keep running the scan');
  assert.deepEqual(lines, [], 'No skip may be recorded while the scan can run');
});

test('the Gitleaks probe fails closed when the binary is not on PATH', () => {
  assert.equal(
    isGitleaksBinaryAvailable({ PATH: '' }),
    false,
    'An environment without PATH must report the binary as missing'
  );
});

test('rbac suite guards its secrets scan with the Gitleaks availability check', () => {
  const specPath = fileURLToPath(
    new URL('../../../apps/api/src/rbac/rbac.supertest.spec.ts', import.meta.url)
  );
  const source = readFileSync(specPath, 'utf8');
  assert.ok(
    source.includes('skipSecretsScanWhenGitleaksMissing('),
    'The CI test step runs before "Install Pinned Gitleaks"; the suite must record the named skip there instead of hard-failing'
  );
  assert.match(
    source,
    /isOnlyDashboardFinding[\s\S]*throw err;/,
    'A real scan failure must still throw; only the missing-binary precondition may skip'
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
