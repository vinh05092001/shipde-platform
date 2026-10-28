import 'reflect-metadata';
import * as assert from 'node:assert';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleEnum } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { UsersService } from './users.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';
import { runUsersSupertestSuite } from './users.supertest.spec';

/**
 * FEAT-AUTH-05 — database-backed proof for AC-AUTH-05-21 (durable admin-reset idempotency,
 * BR-AUTH-19) and the "one ACTIVE factor per user" database guarantee (P1-03).
 */
const ADMIN_ID = 'b0000000-0000-0000-0000-0000000005a1';
const TARGET_ID = 'b0000000-0000-0000-0000-0000000005a2';
const OTHER_ID = 'b0000000-0000-0000-0000-0000000005a3';
const OTHER_MERCHANT_ID = 'a0000000-0000-0000-0000-0000000005f1';

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  process.env.DATABASE_URL = databaseUrl;
  const testConfig = {
    NODE_ENV: 'test',
    PORT: 3097,
    WORKER_HEALTH_PORT: 3096,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: Number(process.env.REDIS_PORT || 6379),
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: true,
    CARRIER_MODE: 'disabled',
    LOG_LEVEL: 'info',
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars',
    TRUST_PROXY_HOPS: 1,
  } as AppConfig;

  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(new MockVerificationDeliveryAdapter())
    .compile();
  const app = moduleFixture.createNestApplication();
  await app.init();
  const prisma = app.get(PrismaService);

  if ((await prisma.checkReadiness()) !== 'up') {
    if (process.env.CI) throw new Error(`Database must be reachable in CI at ${databaseUrl}`);
    console.warn('PostgreSQL not reachable; skipping MFA reset idempotency suite.');
    await app.close();
    return;
  }

  await seedDatabase(prisma);
  await prisma.merchant.upsert({
    where: { id: OTHER_MERCHANT_ID },
    update: {},
    create: {
      id: OTHER_MERCHANT_ID,
      name: 'Other Tenant',
      code: 'OTHER_TENANT_05',
      status: 'active',
    },
  });
  const base = {
    merchant_id: SEED_MERCHANT_ID,
    full_name: 'MFA Reset Fixture',
    password_hash: 'x',
    status: 'active',
  };
  for (const [id, email, role] of [
    [ADMIN_ID, 'mfa-admin-05@shipde.vn', RoleEnum.OWNER],
    [TARGET_ID, 'mfa-target-05@shipde.vn', RoleEnum.OPS_CSKH],
    [OTHER_ID, 'mfa-other-05@shipde.vn', RoleEnum.OPS_CSKH],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: { ...base, email, role },
      create: { id, ...base, email, role },
    });
  }
  await prisma.mfaAdminResetIdempotency.deleteMany({ where: { actor_user_id: ADMIN_ID } });
  await prisma.mfaFactor.deleteMany({ where: { user_id: { in: [TARGET_ID, OTHER_ID] } } });

  const actor = {
    userId: ADMIN_ID,
    merchantId: SEED_MERCHANT_ID,
    role: 'OWNER',
    authAssurance: 'MFA',
  };
  const factor = (user_id: string, status: string) =>
    prisma.mfaFactor.create({
      data: { user_id, merchant_id: SEED_MERCHANT_ID, status, secret_ciphertext: 'v1:test' },
    });

  // --- P1-03: partial unique index allows many non-ACTIVE rows but only one ACTIVE per user.
  await factor(OTHER_ID, 'ACTIVE');
  await factor(OTHER_ID, 'RESET');
  await factor(OTHER_ID, 'PENDING');
  await assert.rejects(factor(OTHER_ID, 'ACTIVE'), (e: any) => e?.code === 'P2002');
  console.log('PASS: database rejects a second ACTIVE factor for the same user');

  // --- P1-02: durable idempotency
  await factor(TARGET_ID, 'ACTIVE');
  const countResets = () =>
    prisma.auditLog.count({ where: { action: 'AUTH_MFA_ADMIN_RESET', entity_id: TARGET_ID } });
  const auditBefore = await countResets();
  const svc1 = app.get(UsersService);
  const dto = { reason: 'Lost phone, verified by video call' };
  const first = await svc1.adminResetMfa(TARGET_ID, dto, actor, 'idem-key-05-a', '10.0.0.1', 'c1');
  assert.strictEqual(first.data.reset, true);

  // A brand-new service instance (simulated restart / second API node) shares no memory.
  const svc2 = new UsersService(prisma, app.get(SessionService));
  const replay = await svc2.adminResetMfa(TARGET_ID, dto, actor, 'idem-key-05-a', '10.0.0.1', 'c2');
  assert.deepStrictEqual(replay, first);
  assert.strictEqual(
    await countResets(),
    auditBefore + 1,
    'replay must not repeat the effect (exactly one audit row for two calls)'
  );
  console.log('PASS: same key replays the stored result from the database across instances');

  await assert.rejects(
    svc2.adminResetMfa(
      TARGET_ID,
      { reason: 'different reason' },
      actor,
      'idem-key-05-a',
      '10.0.0.1',
      'c3'
    ),
    (e: any) =>
      e?.response?.error?.code === 'IDEMPOTENCY_CONFLICT' ||
      /IDEMPOTENCY_CONFLICT/.test(JSON.stringify(e?.response ?? e))
  );
  console.log('PASS: same key with a different request is IDEMPOTENCY_CONFLICT');

  // Tenant scope: the same key string in another tenant is a different record.
  const row = await prisma.mfaAdminResetIdempotency.findUnique({
    where: {
      merchant_id_idempotency_key: {
        merchant_id: SEED_MERCHANT_ID,
        idempotency_key: 'idem-key-05-a',
      },
    },
  });
  assert.ok(row);
  const none = await prisma.mfaAdminResetIdempotency.findUnique({
    where: {
      merchant_id_idempotency_key: {
        merchant_id: OTHER_MERCHANT_ID,
        idempotency_key: 'idem-key-05-a',
      },
    },
  });
  assert.strictEqual(none, null);
  console.log('PASS: idempotency record is tenant-scoped');

  await app.close();
  console.log('MFA reset idempotency suite complete');

  // FEAT-USR-02: Run User Lifecycle Supertest suite (AC-USR-02-01 .. AC-USR-02-18)
  await runUsersSupertestSuite();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
