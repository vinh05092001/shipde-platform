import 'reflect-metadata';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { verifyPassword } from './password.util';
import { seedDatabase } from '../../../../infra/docker/seed';

async function runAdminShopsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - ADMIN-CREATED SHOP ACCOUNT SUPERTEST SUITE (FEAT-AUTH-02)');
  console.log('================================================================');

  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const [key, ...rest] = trimmed.split('=');
          const cleanKey = key.trim();
          let val = rest.join('=').trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[cleanKey]) {
            process.env[cleanKey] = val;
          }
        }
      }
      break;
    }
  }

  const ADMIN_TEST_KEY = 'test-admin-api-key-secret-40-chars';
  process.env.ADMIN_API_KEY = ADMIN_TEST_KEY;

  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  if (
    (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
    (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
  ) {
    databaseUrl = databaseUrl.slice(1, -1);
  }
  process.env.DATABASE_URL = databaseUrl;

  const testConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3099,
    WORKER_HEALTH_PORT: 3098,
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
    TRUST_PROXY_HOPS: 1,
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars',
  };

  const mockDeliveryAdapter = new MockVerificationDeliveryAdapter();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(mockDeliveryAdapter)
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();

  const prisma = app.get(PrismaService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error(`Database must be reachable in CI environment at ${databaseUrl}`);
    }
    console.warn(
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Admin Shops Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Admin Shops Supertest suite skipped offline safely!');
    return;
  }

  await seedDatabase(prisma);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // -------------------------------------------------------------------------
    // AC-ADMIN-01: Missing admin key returns 403 Forbidden
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-01: Missing admin key returns 403 Forbidden...');
    const resNoKey = await request(app.getHttpServer())
      .post('/admin/shops')
      .send({
        merchant_name: `Shop No Key ${testSuffix}`,
        email: `nokey_${testSuffix}@example.com`,
      });
    assert.strictEqual(resNoKey.status, 403);
    assert.strictEqual(resNoKey.body?.error?.code, 'FORBIDDEN');
    console.log('✅ AC-ADMIN-01 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-02: Invalid admin key returns 403 Forbidden
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-02: Invalid admin key returns 403 Forbidden...');
    const runtimeInvalidKey = `invalid-admin-key-${randomUUID()}`;
    const resBadKey = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', runtimeInvalidKey)
      .send({
        merchant_name: `Shop Bad Key ${testSuffix}`,
        email: `badkey_${testSuffix}@example.com`,
      });
    assert.strictEqual(resBadKey.status, 403);
    assert.strictEqual(resBadKey.body?.error?.code, 'FORBIDDEN');
    console.log('✅ AC-ADMIN-02 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-09: Missing both email and phone returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-09: Missing both email and phone...');
    const resNoContact = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop No Contact ${testSuffix}`,
      });
    assert.strictEqual(resNoContact.status, 400);
    assert.strictEqual(resNoContact.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-09 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-10: Invalid email format returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-10: Invalid email format...');
    const resBadEmail = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop Bad Email ${testSuffix}`,
        email: 'invalid-email-address',
      });
    assert.strictEqual(resBadEmail.status, 400);
    assert.strictEqual(resBadEmail.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-10 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-11: Invalid phone format returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-11: Invalid phone format...');
    const resBadPhone = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop Bad Phone ${testSuffix}`,
        phone: '12345678',
      });
    assert.strictEqual(resBadPhone.status, 400);
    assert.strictEqual(resBadPhone.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-11 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-12: Password shorter than 8 characters returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-12: Password shorter than 8 characters...');
    const resShortPass = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop Short Pass ${testSuffix}`,
        email: `shortpass_${testSuffix}@example.com`,
        password: '123',
      });
    assert.strictEqual(resShortPass.status, 400);
    assert.strictEqual(resShortPass.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-12 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-13: merchant_name longer than 255 characters returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-13: merchant_name longer than 255 characters...');
    const resLongName = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: 'B'.repeat(256),
        email: `longname_${testSuffix}@example.com`,
      });
    assert.strictEqual(resLongName.status, 400);
    assert.strictEqual(resLongName.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-13 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-03: Valid admin key with email-only creates verified active user and shop
    // AC-ADMIN-04: Database records verification
    // AC-ADMIN-05: Generated merchant code
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-03, 04, 05: Valid admin key with email-only...');
    const emailOnly = `emailonly_${testSuffix}@example.com`;
    const resEmailOnly = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Cửa Hàng Bánh Mì ${testSuffix}`,
        email: emailOnly,
      });

    assert.strictEqual(resEmailOnly.status, 201);
    assert.strictEqual(resEmailOnly.body?.success, true);
    assert.strictEqual(resEmailOnly.body?.data?.merchant?.status, 'active');
    assert.ok(resEmailOnly.body?.data?.merchant?.code?.startsWith('CUA_HANG_BANH_MI_'));
    assert.strictEqual(resEmailOnly.body?.data?.user?.email, emailOnly);
    assert.strictEqual(resEmailOnly.body?.data?.user?.status, 'active');
    assert.ok(resEmailOnly.body?.data?.user?.email_verified_at);
    assert.strictEqual(resEmailOnly.body?.data?.user?.phone_verified_at, null);
    assert.strictEqual(resEmailOnly.body?.data?.password_is_temporary, true);
    assert.ok(resEmailOnly.body?.data?.temporary_password);

    // Verify DB records directly (AC-ADMIN-04)
    const dbUser = await prisma.user.findUnique({
      where: { email: emailOnly },
      include: { merchant: true },
    });
    assert.ok(dbUser);
    assert.strictEqual(dbUser.status, 'active');
    assert.ok(dbUser.email_verified_at);
    assert.strictEqual(dbUser.merchant.status, 'active');
    assert.ok(dbUser.merchant.code);
    console.log('✅ AC-ADMIN-03, 04, 05 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-06: Phone-only registration supported with verified status
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-06: Phone-only registration...');
    const phoneOnly = `0987${testSuffix}`;
    const resPhoneOnly = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Cửa Hàng Giày Dép ${testSuffix}`,
        phone: phoneOnly,
      });

    assert.strictEqual(resPhoneOnly.status, 201);
    assert.strictEqual(resPhoneOnly.body?.data?.user?.phone, phoneOnly);
    assert.strictEqual(resPhoneOnly.body?.data?.user?.email, null);
    assert.strictEqual(resPhoneOnly.body?.data?.user?.status, 'active');
    assert.ok(resPhoneOnly.body?.data?.user?.phone_verified_at);
    assert.strictEqual(resPhoneOnly.body?.data?.user?.email_verified_at, null);
    console.log('✅ AC-ADMIN-06 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-07: Custom password provided bypasses temporary password generation
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-07: Custom password provided...');
    const customEmail = `custompass_${testSuffix}@example.com`;
    const customPass = 'StrongCustomPass123!';
    const resCustomPass = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop Custom Password ${testSuffix}`,
        email: customEmail,
        password: customPass,
      });

    assert.strictEqual(resCustomPass.status, 201);
    assert.strictEqual(resCustomPass.body?.data?.password_is_temporary, false);
    assert.strictEqual(resCustomPass.body?.data?.temporary_password, undefined);

    const dbCustomUser = await prisma.user.findUnique({
      where: { email: customEmail },
    });
    assert.ok(dbCustomUser);
    const passMatches = await verifyPassword(customPass, dbCustomUser.password_hash);
    assert.strictEqual(passMatches, true);
    console.log('✅ AC-ADMIN-07 passed');

    // -------------------------------------------------------------------------
    // AC-ADMIN-08: Duplicate email provided returns 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('🧪 Testing AC-ADMIN-08: Duplicate email provided...');
    const resDup = await request(app.getHttpServer())
      .post('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY)
      .send({
        merchant_name: `Shop Dup ${testSuffix}`,
        email: emailOnly,
      });
    assert.strictEqual(resDup.status, 400);
    assert.strictEqual(resDup.body?.error?.code, 'VALIDATION_ERROR');
    console.log('✅ AC-ADMIN-08 passed');

    // -------------------------------------------------------------------------
    // GET /admin/shops: List shops
    // -------------------------------------------------------------------------
    console.log('🧪 Testing GET /admin/shops list endpoint...');
    const resList = await request(app.getHttpServer())
      .get('/admin/shops')
      .set('x-admin-key', ADMIN_TEST_KEY);
    assert.strictEqual(resList.status, 200);
    assert.strictEqual(resList.body?.success, true);
    assert.ok(Array.isArray(resList.body?.data?.shops));
    assert.ok(resList.body?.data?.total >= 3);
    console.log('✅ GET /admin/shops passed');

    console.log('\n🎉 ALL FEAT-AUTH-02 SUPERTEST INTEGRATION TESTS PASSED!');
  } finally {
    await app.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('admin-shops.supertest.spec.ts')) {
  runAdminShopsSupertestSuite().catch((err) => {
    console.error('❌ Admin shops supertest suite failed with error:', err);
    process.exit(1);
  });
}
