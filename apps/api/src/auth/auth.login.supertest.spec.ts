import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { RoleEnum } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { hashPassword } from './password.util';
import {
  resolveAccessTokenSecret,
  signAccessToken,
  verifyAccessToken,
  TokenVerificationError,
} from './token.util';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';

/**
 * FEAT-AUTH-03 — Login (password or OTP) supertest suite (UC-AUTH-01).
 * Covers AC-AUTH-01-01..15; AC-AUTH-01-16 is covered by `pnpm contract:check` in CI.
 */
const TEST_PASSWORD = 'TestPassword123!'; // Documented test-only seed credential (see work item)
const OWNER_ID = 'b0000000-0000-0000-0000-000000000001';
const OWNER_EMAIL = 'owner@shipde.vn';
const OWNER_PHONE = '0901234567';
const PENDING_EMAIL = 'pending@shipde.vn';
const OPS_EMAIL = 'ops@shipde.vn';
const ACCOUNTANT_EMAIL = 'accountant@shipde.vn';

async function runAuthLoginSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - LOGIN SUPERTEST SUITE (FEAT-AUTH-03 / UC-AUTH-01)');
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

  // Shared config object: AUTH_LOGIN_OTP_ENABLED is flipped to true after TEST 8
  // (the service reads this reference per request, mirroring CD-4's operator gate).
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
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
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

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  const prisma = app.get(PrismaService);
  const rateLimitService = app.get(RateLimitService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error(`Database must be reachable in CI environment at ${databaseUrl}`);
    }
    console.warn(
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Login Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Login supertest suite skipped offline safely!');
    return;
  }

  // Deterministic fixtures: owner@shipde.vn (active, verified email+phone), pending@shipde.vn, etc.
  await seedDatabase(prisma);

  const testSuffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
  const ipFor = (n: number) => `203.0.113.${n}`;
  const collectedBodies: unknown[] = [];

  async function createStatusUser(status: string, email: string, phone: string) {
    return prisma.user.create({
      data: {
        merchant_id: SEED_MERCHANT_ID,
        email,
        phone,
        full_name: `Login Gate ${status}`,
        password_hash: await hashPassword(TEST_PASSWORD),
        role: RoleEnum.OWNER,
        status,
        email_verified_at: null,
        phone_verified_at: null,
        terms_accepted_at: new Date(),
        terms_version: '2026.1',
      },
    });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1 / AC-AUTH-01-01: Password login with email returns full session
    // -------------------------------------------------------------------------
    console.log('[TEST 1 / AC-AUTH-01-01] Password login with email returns AUTHENTICATED session');
    const res1 = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(1))
      .send({ identifier: OWNER_EMAIL, password: TEST_PASSWORD })
      .expect(200);
    collectedBodies.push(res1.body);

    assert.strictEqual(res1.body.data.status, 'AUTHENTICATED');
    assert.ok(res1.body.data.access_token, 'access_token must be present');
    assert.strictEqual(res1.body.data.expires_in, 43200);
    assert.strictEqual(res1.body.data.user.id, OWNER_ID);
    assert.strictEqual(res1.body.data.user.role, 'OWNER');
    assert.strictEqual(res1.body.data.user.status, 'ACTIVE');
    assert.strictEqual(res1.body.data.user.email, OWNER_EMAIL);
    assert.strictEqual(res1.body.data.merchant.business_code, 'SHOP_DEMO_01');
    assert.ok(res1.body.meta.correlation_id, 'correlation_id must be present');

    // Token round-trips and references a real device_sessions row (CD-1/CD-2)
    const claims1 = verifyAccessToken(
      res1.body.data.access_token,
      resolveAccessTokenSecret(testConfig.AUTH_TOKEN_SECRET)
    );
    assert.strictEqual(claims1.sub, OWNER_ID);
    assert.strictEqual(claims1.mid, SEED_MERCHANT_ID);
    assert.strictEqual(claims1.role, 'OWNER');
    assert.strictEqual(claims1.st, 'active');
    assert.ok(claims1.exp > claims1.iat, 'token expiry must be in the future');
    const session1 = await prisma.deviceSession.findUnique({ where: { id: claims1.sid } });
    assert.ok(session1, 'device_sessions row must exist for the login');
    assert.strictEqual(session1.user_id, OWNER_ID);

    const audit1 = await prisma.auditLog.findFirst({
      where: { action: 'AUTH_LOGIN_SUCCESS', entity_type: 'user', entity_id: OWNER_ID },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(audit1, 'AUTH_LOGIN_SUCCESS audit row must be recorded');
    console.log('  PASS: AC-AUTH-01-01 password login issues verifiable token + session + audit');

    // -------------------------------------------------------------------------
    // TEST 2 / AC-AUTH-01-02: Password login with VN phone identifier
    // -------------------------------------------------------------------------
    console.log('[TEST 2 / AC-AUTH-01-02] Password login with VN phone identifier');
    const res2 = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(2))
      .send({ identifier: OWNER_PHONE, password: TEST_PASSWORD })
      .expect(200);
    collectedBodies.push(res2.body);
    assert.strictEqual(res2.body.data.status, 'AUTHENTICATED');
    assert.strictEqual(res2.body.data.user.id, OWNER_ID);
    const claims2 = verifyAccessToken(
      res2.body.data.access_token,
      resolveAccessTokenSecret(testConfig.AUTH_TOKEN_SECRET)
    );
    assert.notStrictEqual(
      claims2.sid,
      claims1.sid,
      'each login must create an independent device session'
    );
    const sessionCount = await prisma.deviceSession.count({ where: { user_id: OWNER_ID } });
    assert.ok(sessionCount >= 2, 'two independent device_sessions rows must exist');
    console.log('  PASS: AC-AUTH-01-02 phone identifier login with independent session');

    // -------------------------------------------------------------------------
    // TEST 3 / AC-AUTH-01-03: Wrong password vs unknown identifier are indistinguishable
    // -------------------------------------------------------------------------
    console.log('[TEST 3 / AC-AUTH-01-03] Anti-enumeration: identical INVALID_CREDENTIALS shape');
    const res3a = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(3))
      .send({ identifier: OWNER_EMAIL, password: 'WrongPassword123!' })
      .expect(401);
    const res3b = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(3))
      .send({ identifier: `ghost.${testSuffix}@shipde.vn`, password: 'Whatever123!' })
      .expect(401);
    collectedBodies.push(res3a.body, res3b.body);
    assert.strictEqual(res3a.body.error.code, 'INVALID_CREDENTIALS');
    assert.strictEqual(res3b.body.error.code, 'INVALID_CREDENTIALS');
    assert.strictEqual(res3a.body.error.message, res3b.body.error.message);
    assert.strictEqual(res3a.body.error.next_action, res3b.body.error.next_action);
    assert.ok(!res3a.body.data?.access_token && !res3b.body.data?.access_token);
    console.log('  PASS: AC-AUTH-01-03 anti-enumeration identical error shape');

    // -------------------------------------------------------------------------
    // TEST 4 / AC-AUTH-01-04: pending_verification account is blocked with next action
    // -------------------------------------------------------------------------
    console.log('[TEST 4 / AC-AUTH-01-04] pending_verification user is blocked with next action');
    const res4 = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(4))
      .send({ identifier: PENDING_EMAIL, password: TEST_PASSWORD })
      .expect(403);
    collectedBodies.push(res4.body);
    assert.strictEqual(res4.body.error.code, 'AUTH_PENDING_VERIFICATION');
    assert.ok(res4.body.error.next_action, 'verification next_action required');
    assert.ok(!res4.body.data?.access_token, 'no token for blocked status');
    const pendingSessions = await prisma.deviceSession.count({
      where: { user: { email: PENDING_EMAIL } },
    });
    assert.strictEqual(pendingSessions, 0, 'no device session for pending_verification login');
    console.log(
      '  PASS: AC-AUTH-01-04 pending_verification blocked with AUTH_PENDING_VERIFICATION'
    );

    // -------------------------------------------------------------------------
    // TEST 5 / AC-AUTH-01-05: suspended / disabled / invited produce distinct 403 gates
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 5 / AC-AUTH-01-05] suspended / disabled / invited produce distinct 403 gates'
    );
    const gateCases = [
      { status: 'suspended', code: 'AUTH_ACCOUNT_SUSPENDED' },
      { status: 'disabled', code: 'AUTH_ACCOUNT_DISABLED' },
      { status: 'invited', code: 'AUTH_INVITATION_PENDING' },
    ];
    for (let i = 0; i < gateCases.length; i++) {
      const gate = gateCases[i];
      const email = `gate.${gate.status}.${testSuffix}@shipde.vn`;
      const phone = `0909${Date.now().toString().slice(-5)}${i}`;
      const user = await createStatusUser(gate.status, email, phone);
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-forwarded-for', ipFor(5 + i))
        .send({ identifier: email, password: TEST_PASSWORD })
        .expect(403);
      collectedBodies.push(res.body);
      assert.strictEqual(
        res.body.error.code,
        gate.code,
        `expected ${gate.code} for ${gate.status}`
      );
      assert.ok(res.body.error.next_action, 'recovery next_action required');
      assert.ok(!res.body.data?.access_token, 'no token for blocked status');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'AUTH_LOGIN_BLOCKED_STATUS', entity_type: 'user', entity_id: user.id },
        orderBy: { created_at: 'desc' },
      });
      assert.ok(audit, `${gate.status} blocked login must be audited`);
      assert.ok(
        !JSON.stringify(audit.new_value).includes(TEST_PASSWORD),
        'audit payload must never contain the password'
      );
    }
    console.log('  PASS: AC-AUTH-01-05 suspended/disabled/invited distinct gates, each audited');

    // -------------------------------------------------------------------------
    // TEST 6 / AC-AUTH-01-06: 5 wrong-password attempts trigger identifier RATE_LIMITED
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 6 / AC-AUTH-01-06] 5 wrong-password attempts trigger identifier RATE_LIMITED'
    );
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .set('x-forwarded-for', ipFor(8))
        .send({ identifier: OPS_EMAIL, password: `Wrong${attempt}Password!` })
        .expect(401);
      collectedBodies.push(res.body);
      assert.strictEqual(res.body.error.code, 'INVALID_CREDENTIALS');
    }
    const res6locked = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(8))
      .send({ identifier: OPS_EMAIL, password: 'WrongFinal!' })
      .expect(429);
    collectedBodies.push(res6locked.body);
    assert.strictEqual(res6locked.body.error.code, 'RATE_LIMITED');
    assert.ok(
      /giây|seconds|thử lại/i.test(res6locked.body.error.next_action || ''),
      'retry hint with wait window required'
    );
    console.log('  PASS: AC-AUTH-01-06 identifier failure lockout returns 429 RATE_LIMITED');

    // -------------------------------------------------------------------------
    // TEST 7 / AC-AUTH-01-07: Missing identifier/password return 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('[TEST 7 / AC-AUTH-01-07] Missing identifier/password return 400 VALIDATION_ERROR');
    const res7a = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(9))
      .send({ password: TEST_PASSWORD })
      .expect(400);
    collectedBodies.push(res7a.body);
    assert.strictEqual(res7a.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      res7a.body.error.fields.some((f: { field: string }) => f.field === 'identifier'),
      'field-level error for identifier required'
    );
    const res7b = await request(app.getHttpServer())
      .post('/auth/login')
      .set('x-forwarded-for', ipFor(9))
      .send({ identifier: OWNER_EMAIL })
      .expect(400);
    collectedBodies.push(res7b.body);
    assert.strictEqual(res7b.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      res7b.body.error.fields.some((f: { field: string }) => f.field === 'password'),
      'field-level error for password required'
    );
    console.log('  PASS: AC-AUTH-01-07 field-level validation errors');

    // -------------------------------------------------------------------------
    // TEST 8 / AC-AUTH-01-08: OTP login disabled by default config (CD-4)
    // -------------------------------------------------------------------------
    console.log('[TEST 8 / AC-AUTH-01-08] OTP login disabled by default config');
    const res8 = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(10))
      .send({ identifier: OWNER_EMAIL })
      .expect(403);
    collectedBodies.push(res8.body);
    assert.strictEqual(res8.body.error.code, 'AUTH_OTP_LOGIN_DISABLED');
    console.log('  PASS: AC-AUTH-01-08 AUTH_OTP_LOGIN_DISABLED when the gate is closed');

    // Flip the shared config object: subsequent OTP tests run with OTP login enabled.
    testConfig.AUTH_LOGIN_OTP_ENABLED = true;

    // -------------------------------------------------------------------------
    // TEST 9 / AC-AUTH-01-09: OTP request for verified phone delivers 6-digit LOGIN OTP
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 9 / AC-AUTH-01-09] OTP request for verified phone delivers 6-digit LOGIN OTP'
    );
    mockDeliveryAdapter.clear();
    const res9 = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(11))
      .send({ identifier: OWNER_PHONE })
      .expect(200);
    collectedBodies.push(res9.body);
    assert.strictEqual(res9.body.data.status, 'OTP_SENT');
    assert.strictEqual(res9.body.data.channel, 'phone');
    assert.ok(
      res9.body.data.recipient_masked.startsWith('0901'),
      'masked recipient must hint at the real phone tail'
    );
    assert.strictEqual(res9.body.data.cooldown_seconds, 60);
    assert.strictEqual(res9.body.data.expires_in_seconds, 300);
    assert.ok(res9.body.meta.correlation_id);

    const phoneMessages = mockDeliveryAdapter.findMessagesByRecipient(OWNER_PHONE);
    assert.strictEqual(phoneMessages.length, 1, 'exactly one phone message delivered');
    const rawOtp9 = phoneMessages[0].otp;
    assert.ok(rawOtp9 && /^\d{6}$/.test(rawOtp9), 'delivered OTP must be 6 digits');

    const loginToken9 = await prisma.verificationToken.findFirst({
      where: { identifier: OWNER_PHONE, purpose: 'LOGIN' },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(loginToken9, 'purpose=LOGIN token row must exist');
    assert.notStrictEqual(loginToken9.otp, rawOtp9, 'OTP must be stored hashed, never plaintext');
    assert.strictEqual(loginToken9.consumed_at, null);
    const ttlMs = loginToken9.expires_at.getTime() - Date.now();
    assert.ok(ttlMs > 4 * 60 * 1000 && ttlMs <= 5 * 60 * 1000, 'LOGIN OTP TTL must be ~5 minutes');
    console.log('  PASS: AC-AUTH-01-09 OTP_SENT with hashed 5-minute purpose=LOGIN token');

    // -------------------------------------------------------------------------
    // TEST 10 / AC-AUTH-01-10: Correct OTP issues a session; replay is rejected
    // -------------------------------------------------------------------------
    console.log('[TEST 10 / AC-AUTH-01-10] Correct OTP verify issues session; replay is consumed');
    const res10 = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(11))
      .send({ identifier: OWNER_PHONE, otp: rawOtp9 })
      .expect(200);
    collectedBodies.push(res10.body);
    assert.strictEqual(res10.body.data.status, 'AUTHENTICATED');
    assert.strictEqual(res10.body.data.user.id, OWNER_ID);
    assert.strictEqual(res10.body.data.user.role, 'OWNER');
    assert.ok(res10.body.data.access_token);
    const claims10 = verifyAccessToken(
      res10.body.data.access_token,
      resolveAccessTokenSecret(testConfig.AUTH_TOKEN_SECRET)
    );
    const otpSession10 = await prisma.deviceSession.findUnique({ where: { id: claims10.sid } });
    assert.ok(otpSession10, 'OTP login must also create a device_sessions row');

    const consumed10 = await prisma.verificationToken.findFirst({
      where: { identifier: OWNER_PHONE, purpose: 'LOGIN' },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(consumed10?.consumed_at, 'correct OTP must be consumed (consumed_at set)');

    const res10replay = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(11))
      .send({ identifier: OWNER_PHONE, otp: rawOtp9 })
      .expect(410);
    collectedBodies.push(res10replay.body);
    assert.strictEqual(res10replay.body.error.code, 'OTP_ALREADY_CONSUMED');
    console.log('  PASS: AC-AUTH-01-10 OTP verify session + single-use enforcement');

    // -------------------------------------------------------------------------
    // TEST 11 / AC-AUTH-01-11: 5 wrong OTPs lock out; consumed token rejects correct OTP
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 11 / AC-AUTH-01-11] 5 wrong OTPs lock out; consumed token rejects correct OTP'
    );
    mockDeliveryAdapter.clear();
    const res11 = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(12))
      .send({ identifier: OPS_EMAIL })
      .expect(200);
    collectedBodies.push(res11.body);
    assert.strictEqual(res11.body.data.status, 'OTP_SENT');
    const rawOtp11 = mockDeliveryAdapter.findMessagesByRecipient(OPS_EMAIL)[0].otp;
    assert.ok(rawOtp11 && /^\d{6}$/.test(rawOtp11));

    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login/otp/verify')
        .set('x-forwarded-for', ipFor(12))
        .send({ identifier: OPS_EMAIL, otp: `00000${attempt}` })
        .expect(400);
      collectedBodies.push(res.body);
      assert.strictEqual(res.body.error.code, 'INVALID_OTP');
    }
    const res11lock = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(12))
      .send({ identifier: OPS_EMAIL, otp: '000005' })
      .expect(429);
    collectedBodies.push(res11lock.body);
    assert.strictEqual(res11lock.body.error.code, 'OTP_MAX_ATTEMPTS_EXCEEDED');
    const lockedToken11 = await prisma.verificationToken.findFirst({
      where: { identifier: OPS_EMAIL, purpose: 'LOGIN' },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(lockedToken11?.consumed_at, 'max-attempt lockout must consume the token');

    // Isolate the consumed-token semantic from the attempt-counter semantic (CD-5/BR-12):
    // after the attempt counter is reset, the correct OTP must still be rejected because
    // the token row itself was consumed by the lockout.
    await rateLimitService.resetOtpAttempts(OPS_EMAIL);
    const res11correct = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(12))
      .send({ identifier: OPS_EMAIL, otp: rawOtp11 })
      .expect(410);
    collectedBodies.push(res11correct.body);
    assert.strictEqual(res11correct.body.error.code, 'OTP_ALREADY_CONSUMED');
    console.log('  PASS: AC-AUTH-01-11 OTP brute-force lockout + consumed-token rejection');

    // -------------------------------------------------------------------------
    // TEST 12 / AC-AUTH-01-12: Expired OTP -> OTP_EXPIRED; unknown OTP -> INVALID_OTP
    // -------------------------------------------------------------------------
    console.log('[TEST 12 / AC-AUTH-01-12] Expired OTP -> OTP_EXPIRED; unknown OTP -> INVALID_OTP');
    mockDeliveryAdapter.clear();
    const res12req = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(13))
      .send({ identifier: ACCOUNTANT_EMAIL })
      .expect(200);
    collectedBodies.push(res12req.body);
    assert.strictEqual(res12req.body.data.status, 'OTP_SENT');
    const rawOtp12 = mockDeliveryAdapter.findMessagesByRecipient(ACCOUNTANT_EMAIL)[0].otp;
    assert.ok(rawOtp12);
    await prisma.verificationToken.updateMany({
      where: { identifier: ACCOUNTANT_EMAIL, purpose: 'LOGIN' },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    const res12expired = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(13))
      .send({ identifier: ACCOUNTANT_EMAIL, otp: rawOtp12 })
      .expect(410);
    collectedBodies.push(res12expired.body);
    assert.strictEqual(res12expired.body.error.code, 'OTP_EXPIRED');

    const invalidEmail = `otp.invalid.${testSuffix}@shipde.vn`;
    await prisma.user.create({
      data: {
        merchant_id: SEED_MERCHANT_ID,
        email: invalidEmail,
        full_name: 'Invalid OTP Probe',
        password_hash: await hashPassword(TEST_PASSWORD),
        role: RoleEnum.OWNER,
        status: 'active',
        email_verified_at: new Date(),
        terms_accepted_at: new Date(),
        terms_version: '2026.1',
      },
    });
    mockDeliveryAdapter.clear();
    const res12req2 = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(13))
      .send({ identifier: invalidEmail })
      .expect(200);
    collectedBodies.push(res12req2.body);
    assert.strictEqual(res12req2.body.data.status, 'OTP_SENT');
    const res12invalid = await request(app.getHttpServer())
      .post('/auth/login/otp/verify')
      .set('x-forwarded-for', ipFor(13))
      .send({ identifier: invalidEmail, otp: '000000' })
      .expect(400);
    collectedBodies.push(res12invalid.body);
    assert.strictEqual(res12invalid.body.error.code, 'INVALID_OTP');
    console.log('  PASS: AC-AUTH-01-12 OTP_EXPIRED and INVALID_OTP semantics');

    // -------------------------------------------------------------------------
    // TEST 13 / AC-AUTH-01-13: OTP anti-enumeration — no delivery for unverified/unknown
    // -------------------------------------------------------------------------
    console.log('[TEST 13 / AC-AUTH-01-13] OTP anti-enumeration: generic OTP_SENT, zero delivery');
    mockDeliveryAdapter.clear();
    const res13a = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(14))
      .send({ identifier: PENDING_EMAIL })
      .expect(200);
    const res13b = await request(app.getHttpServer())
      .post('/auth/login/otp/request')
      .set('x-forwarded-for', ipFor(14))
      .send({ identifier: `nobody.${testSuffix}@shipde.vn` })
      .expect(200);
    for (const res of [res13a, res13b]) {
      collectedBodies.push(res.body);
      assert.strictEqual(res.body.data.status, 'OTP_SENT');
      assert.strictEqual(
        res.body.data.message,
        'Nếu tài khoản tồn tại, mã OTP đăng nhập đã được gửi đến bạn.'
      );
    }
    assert.strictEqual(
      mockDeliveryAdapter.getSentMessages().length,
      0,
      'no adapter delivery may occur for unverified/unknown identifiers'
    );
    const pendingLoginTokens = await prisma.verificationToken.count({
      where: { identifier: PENDING_EMAIL, purpose: 'LOGIN' },
    });
    assert.strictEqual(pendingLoginTokens, 0, 'no LOGIN token for unverified channel');
    const unknownLoginTokens = await prisma.verificationToken.count({
      where: { identifier: `nobody.${testSuffix}@shipde.vn`, purpose: 'LOGIN' },
    });
    assert.strictEqual(unknownLoginTokens, 0, 'no LOGIN token for unknown identifier');
    console.log('  PASS: AC-AUTH-01-13 generic OTP_SENT with zero delivery (CD-7)');

    // -------------------------------------------------------------------------
    // TEST 14 / AC-AUTH-01-14: Token primitive round-trip, tamper and expiry
    // -------------------------------------------------------------------------
    console.log('[TEST 14 / AC-AUTH-01-14] Access token primitive: round-trip, tamper, expiry');
    const secret = resolveAccessTokenSecret(testConfig.AUTH_TOKEN_SECRET);
    const issued = signAccessToken(
      { sub: 'user-1', sid: 'session-1', mid: 'merchant-1', role: 'OWNER', st: 'active' },
      secret,
      60
    );
    const roundTrip = verifyAccessToken(issued.token, secret);
    assert.strictEqual(roundTrip.sub, 'user-1');
    assert.strictEqual(roundTrip.sid, 'session-1');
    assert.strictEqual(roundTrip.mid, 'merchant-1');
    assert.strictEqual(roundTrip.role, 'OWNER');
    assert.strictEqual(roundTrip.st, 'active');
    assert.strictEqual(roundTrip.exp, issued.claims.exp);
    assert.strictEqual(roundTrip.jti, issued.claims.jti);

    const [vPart, , signaturePart] = issued.token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...issued.claims, sub: 'attacker' })
    ).toString('base64url');
    assert.throws(
      () => verifyAccessToken(`${vPart}.${tamperedPayload}.${signaturePart}`, secret),
      (err: unknown) => err instanceof TokenVerificationError && err.reason === 'BAD_SIGNATURE'
    );
    const expired = signAccessToken(
      { sub: 'user-1', sid: 'session-1', mid: 'merchant-1', role: 'OWNER', st: 'active' },
      secret,
      -10
    );
    assert.throws(
      () => verifyAccessToken(expired.token, secret),
      (err: unknown) => err instanceof TokenVerificationError && err.reason === 'EXPIRED'
    );
    assert.throws(
      () => verifyAccessToken('not-a-token', secret),
      (err: unknown) => err instanceof TokenVerificationError && err.reason === 'MALFORMED'
    );
    console.log('  PASS: AC-AUTH-01-14 token round-trip, tamper rejection, expiry rejection');

    // -------------------------------------------------------------------------
    // TEST 15 / AC-AUTH-01-15: No password/OTP values in responses, audits, messages
    // -------------------------------------------------------------------------
    console.log('[TEST 15 / AC-AUTH-01-15] No password/OTP values in responses, audits, messages');
    const serialized = JSON.stringify(collectedBodies);
    assert.ok(
      !serialized.includes(TEST_PASSWORD),
      'password must never appear in any response body'
    );
    for (const message of mockDeliveryAdapter.getSentMessages()) {
      assert.ok(
        !JSON.stringify(message).includes(TEST_PASSWORD),
        'adapter messages must not contain the password'
      );
    }
    const recentAudits = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'AUTH_LOGIN_SUCCESS',
            'AUTH_LOGIN_FAILED',
            'AUTH_LOGIN_BLOCKED_STATUS',
            'AUTH_LOGIN_OTP_SUCCESS',
            'AUTH_LOGIN_OTP_FAILED',
          ],
        },
      },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    for (const row of recentAudits) {
      assert.ok(
        !JSON.stringify(row).includes(TEST_PASSWORD),
        'audit rows must never contain the password'
      );
    }
    console.log('  PASS: AC-AUTH-01-15 credential/OTP secrecy across responses, audits, messages');

    console.log('================================================================');
    console.log('✅ ALL LOGIN SUPERTEST TESTS PASSED (FEAT-AUTH-03 / AC-AUTH-01)');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runAuthLoginSupertestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Login Supertest Suite Failed:', err);
    process.exit(1);
  });
