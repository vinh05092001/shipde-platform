import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { RoleEnum } from '@prisma/client';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';

const TEST_USER_ID = 'b0000000-0000-0000-0000-0000000000a2'; // OPS_CSKH in seed
const OTHER_USER_ID = 'b0000000-0000-0000-0000-0000000000a1'; // OWNER in seed

async function runMeSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - PERSONAL PROFILE SUPERTEST SUITE (FEAT-PRO-01)');
  console.log('================================================================');

  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  process.env.DATABASE_URL = databaseUrl;

  const testConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3095,
    WORKER_HEALTH_PORT: 3094,
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
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars-profile-suite',
    TRUST_PROXY_HOPS: 1,
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(new MockVerificationDeliveryAdapter())
    .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);

  // Ensure DB has seed
  await seedDatabase();

  // Create helper to mint valid bearer token with active session
  const createSessionToken = async (
    userId: string,
    merchantId: string,
    role = RoleEnum.OPS_CSKH
  ) => {
    const sid = randomUUID();
    const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
    const { token } = signAccessToken(
      {
        sub: userId,
        sid,
        mid: merchantId,
        role,
        st: 'ACTIVE',
        auth_assurance: 'PASSWORD',
      },
      secret,
      43200
    );
    const hash = createHash('sha256').update(token).digest('hex');
    await prisma.deviceSession.upsert({
      where: { session_token_hash: hash },
      update: {
        status: 'ACTIVE',
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      },
      create: {
        id: sid,
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: hash,
        device_id: 'test_profile_supertest',
        device_model: 'Supertest',
        user_agent: 'Supertest',
        ip_address: '127.0.0.1',
        status: 'ACTIVE',
        auth_assurance: 'PASSWORD',
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    return token;
  };

  // Ensure test user has known warehouse scopes
  await prisma.user.update({
    where: { id: TEST_USER_ID },
    data: {
      warehouse_scopes: ['wh_test_scope_1', 'wh_test_scope_2'],
      store_scopes: ['store_test_1'],
      language: 'vi',
      timezone: 'Asia/Ho_Chi_Minh',
      default_warehouse_id: null,
    },
  });

  const testToken = await createSessionToken(TEST_USER_ID, SEED_MERCHANT_ID, RoleEnum.OPS_CSKH);

  try {
    // 1. AC-PRO-01-09: Unauthenticated request rejected
    console.log('Testing AC-PRO-01-09: Unauthenticated request without token...');
    const unauthRes = await request(server).get('/api/v1/me');
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthRes.body.error?.code, 'UNAUTHENTICATED');
    console.log('PASS: Unauthenticated request rejected with 401 UNAUTHENTICATED');

    // 2. AC-PRO-01-01: Authenticated user requests GET /api/v1/me
    console.log('Testing AC-PRO-01-01: Authenticated user retrieves profile...');
    const getRes = await request(server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`);
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.data.id, TEST_USER_ID);
    assert.strictEqual(getRes.body.data.role, 'OPS_CSKH');
    assert.strictEqual(getRes.body.data.language, 'vi');
    assert.strictEqual(getRes.body.data.timezone, 'Asia/Ho_Chi_Minh');
    assert.ok(getRes.body.data.merchant);
    assert.ok(getRes.body.data.notification_preferences);
    console.log('PASS: GET /api/v1/me returns complete user profile and preferences');

    // 3. AC-PRO-01-02: User updates full name, valid phone, and avatar URL
    console.log('Testing AC-PRO-01-02: User updates full name and avatar URL with audit log...');
    const updateRes = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        full_name: 'Nguyễn Văn Đã Cập Nhật',
        phone: '0912334455',
        avatar_url: 'https://cdn.shipde.net/avatars/user-a2.png',
      });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.data.full_name, 'Nguyễn Văn Đã Cập Nhật');
    assert.strictEqual(updateRes.body.data.phone, '0912334455');
    assert.strictEqual(
      updateRes.body.data.avatar_url,
      'https://cdn.shipde.net/avatars/user-a2.png'
    );

    // Verify audit log in DB
    const profileAudit = await prisma.auditLog.findFirst({
      where: {
        entity_id: TEST_USER_ID,
        action: 'PROFILE_UPDATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(profileAudit, 'PROFILE_UPDATED audit log must exist');
    assert.strictEqual((profileAudit.new_value as any)?.full_name, 'Nguyễn Văn Đã Cập Nhật');
    console.log('PASS: Profile updated and PROFILE_UPDATED audit log verified in database');

    // 4. AC-PRO-01-03: Duplicate phone rejected
    console.log('Testing AC-PRO-01-03: Duplicate phone rejected with 409 PHONE_ALREADY_EXISTS...');
    const dupRes = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: '0901234567' }); // Owned by OTHER_USER_ID
    assert.strictEqual(dupRes.status, 409);
    assert.strictEqual(dupRes.body.error?.code, 'PHONE_ALREADY_EXISTS');
    console.log('PASS: Duplicate phone rejected with 409 PHONE_ALREADY_EXISTS');

    // 5. AC-PRO-01-04: Invalid phone format rejected
    console.log('Testing AC-PRO-01-04: Invalid phone format rejected with 400 INVALID_INPUT...');
    const invalidPhoneRes = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ phone: '123' });
    assert.strictEqual(invalidPhoneRes.status, 400);
    assert.strictEqual(invalidPhoneRes.body.error?.code, 'INVALID_INPUT');
    console.log('PASS: Invalid phone format rejected with 400 INVALID_INPUT');

    // 6. AC-PRO-01-05: Privilege escalation rejected
    console.log(
      'Testing AC-PRO-01-05: Privilege escalation rejected with 403 PRIVILEGE_ESCALATION_DENIED...'
    );
    const escalateRes = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({ role: 'OWNER' });
    assert.strictEqual(escalateRes.status, 403);
    assert.strictEqual(escalateRes.body.error?.code, 'PRIVILEGE_ESCALATION_DENIED');

    // Confirm DB user role was not mutated
    const dbUser = await prisma.user.findUnique({ where: { id: TEST_USER_ID } });
    assert.strictEqual(dbUser?.role, RoleEnum.OPS_CSKH);
    console.log('PASS: Privilege escalation rejected and role immutable');

    // 7. AC-PRO-01-06: User updates preferences (language, timezone, non-critical notifications)
    console.log('Testing AC-PRO-01-06: User updates preferences via /me/preferences...');
    const prefRes = await request(server)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        language: 'en',
        timezone: 'Asia/Bangkok',
        notification_preferences: {
          channels: { email: true, in_app: false, push: true },
          digest_window_minutes: 30,
          subscriptions: {
            delivery_fail: false,
            rate_discrepancy: false,
          },
        },
      });
    assert.strictEqual(prefRes.status, 200);
    assert.strictEqual(prefRes.body.data.language, 'en');
    assert.strictEqual(prefRes.body.data.timezone, 'Asia/Bangkok');
    assert.strictEqual(prefRes.body.data.notification_preferences.channels.push, true);
    assert.strictEqual(
      prefRes.body.data.notification_preferences.subscriptions.delivery_fail,
      false
    );
    // Critical alert preserved
    assert.strictEqual(
      prefRes.body.data.notification_preferences.subscriptions.security_alerts,
      true
    );

    const prefAudit = await prisma.auditLog.findFirst({
      where: {
        entity_id: TEST_USER_ID,
        action: 'PREFERENCES_UPDATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(prefAudit, 'PREFERENCES_UPDATED audit log must exist');
    console.log('PASS: Preferences updated and PREFERENCES_UPDATED audit log verified in database');

    // 8. AC-PRO-01-07: Attempt to disable critical alerts rejected
    console.log(
      'Testing AC-PRO-01-07: Disabling critical alerts rejected with 400 CANNOT_DISABLE_CRITICAL_NOTIFICATIONS...'
    );
    const disableCritRes = await request(server)
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        notification_preferences: {
          subscriptions: {
            security_alerts: false,
          },
        },
      });
    assert.strictEqual(disableCritRes.status, 400);
    assert.strictEqual(disableCritRes.body.error?.code, 'CANNOT_DISABLE_CRITICAL_NOTIFICATIONS');
    console.log(
      'PASS: Disabling critical alert rejected with 400 CANNOT_DISABLE_CRITICAL_NOTIFICATIONS'
    );

    // 9. AC-PRO-01-08: Default warehouse outside scopes rejected
    console.log(
      'Testing AC-PRO-01-08: Default warehouse outside warehouse_scopes rejected with 403 WAREHOUSE_SCOPE_UNAUTHORIZED...'
    );
    const whRes = await request(server)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${testToken}`)
      .send({
        default_warehouse_id: 'c0000000-0000-0000-0000-000000000099',
      });
    assert.strictEqual(whRes.status, 403);
    assert.strictEqual(whRes.body.error?.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
    console.log(
      'PASS: Default warehouse outside scopes rejected with 403 WAREHOUSE_SCOPE_UNAUTHORIZED'
    );

    console.log('================================================================');
    console.log('ALL FEAT-PRO-01 SUPERTEST ACCEPTANCE SCENARIOS PASSED!');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runMeSupertestSuite().catch((err) => {
  console.error('FEAT-PRO-01 Supertest suite failed:', err);
  process.exit(1);
});
