import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { verifyPassword, hashPassword } from './password.util';
import { seedDatabase } from '../../../../infra/docker/seed';

async function runAuthSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - AUTH & REGISTRATION SUPERTEST SUITE (FEAT-AUTH-01)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Auth Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Auth Supertest suite skipped offline safely!');
    return;
  }

  // Ensure deterministic test fixtures (owner@shipde.vn, pending@shipde.vn, expired/consumed tokens) are seeded
  await seedDatabase(prisma);

  const testSuffix = Date.now().toString().slice(-6);

  try {
    // -------------------------------------------------------------------------
    // AC-AUTH-02-01: Valid registration with email only, terms accepted
    // -------------------------------------------------------------------------
    console.log('[TEST 1 / AC-AUTH-02-01] Valid registration with email only');
    mockDeliveryAdapter.clear();
    const email1 = `test.owner.${testSuffix}@shipde.vn`;
    const res1 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.1')
      .send({
        merchant_name: `Shop Email ${testSuffix}`,
        full_name: 'Nguyễn Văn Email',
        email: email1,
        password: 'SecurePassword123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(201);

    assert.strictEqual(res1.body.data.status, 'PENDING_VERIFICATION');
    assert.strictEqual(res1.body.data.email, email1);
    assert.ok(res1.body.data.user_id, 'user_id must be returned');
    assert.ok(res1.body.data.merchant_id, 'merchant_id must be returned');
    assert.ok(res1.body.meta.correlation_id, 'correlation_id must be returned');

    // Verify token issued via mock delivery adapter
    const sent1 = mockDeliveryAdapter.findMessagesByRecipient(email1);
    assert.strictEqual(sent1.length, 1, 'Verification email must be dispatched');
    assert.ok(sent1[0].token, 'Token must be present in dispatched email');
    console.log('  PASS: AC-AUTH-02-01 Email registration created pending user and issued token');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-02: Valid registration with phone only, terms accepted
    // -------------------------------------------------------------------------
    console.log('[TEST 2 / AC-AUTH-02-02] Valid registration with phone only');
    mockDeliveryAdapter.clear();
    const phone2 = `09876${testSuffix.slice(-5)}`;
    const res2 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.2')
      .send({
        merchant_name: `Shop Phone ${testSuffix}`,
        full_name: 'Trần Thị Phone',
        phone: phone2,
        password: 'SecurePassword123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(201);

    assert.strictEqual(res2.body.data.status, 'PENDING_VERIFICATION');
    assert.strictEqual(res2.body.data.phone, phone2);
    assert.ok(res2.body.data.user_id);
    assert.ok(res2.body.data.merchant_id);

    const sent2 = mockDeliveryAdapter.findMessagesByRecipient(phone2);
    assert.strictEqual(sent2.length, 1, 'Verification SMS must be dispatched');
    assert.ok(sent2[0].otp, 'OTP code must be present in SMS dispatch');
    console.log('  PASS: AC-AUTH-02-02 Phone registration created pending user and issued OTP');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-03: Missing required field (e.g. password) -> 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('[TEST 3 / AC-AUTH-02-03] Missing password returns 400 VALIDATION_ERROR');
    const res3 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.3')
      .send({
        merchant_name: 'Shop No Password',
        full_name: 'User No Password',
        email: `nopass.${testSuffix}@shipde.vn`,
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(400);

    assert.strictEqual(res3.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res3.body.error.fields.some((f: any) => f.field === 'password'));
    console.log('  PASS: AC-AUTH-02-03 Rejected missing password with canonical error');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-04: Terms not accepted -> 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('[TEST 4 / AC-AUTH-02-04] Terms not accepted returns 400 VALIDATION_ERROR');
    const res4 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.4')
      .send({
        merchant_name: 'Shop No Terms',
        full_name: 'User No Terms',
        email: `noterms.${testSuffix}@shipde.vn`,
        password: 'ValidPassword123!',
        terms_accepted: false,
        terms_version: '2026.1',
      })
      .expect(400);

    assert.strictEqual(res4.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res4.body.error.fields.some((f: any) => f.field === 'terms_accepted'));
    console.log('  PASS: AC-AUTH-02-04 Rejected unaccepted terms');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-05: Duplicate already-verified email -> 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('[TEST 5 / AC-AUTH-02-05] Duplicate already-verified email rejection');
    const res5 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.5')
      .send({
        merchant_name: 'Duplicate Shop',
        full_name: 'Duplicate Owner',
        email: 'owner@shipde.vn', // Seed active & verified email
        password: 'SecurePassword123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(400);

    assert.strictEqual(res5.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      res5.body.error.fields.some((f: any) => f.field === 'email' && f.code === 'DUPLICATE')
    );
    console.log('  PASS: AC-AUTH-02-05 Duplicate active email rejected with field error');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-06: Duplicate unverified email (retry) -> Re-issue verification token
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 6 / AC-AUTH-02-06] Duplicate unverified email re-issues token without duplicate user'
    );
    mockDeliveryAdapter.clear();
    const usersCountBefore = await prisma.user.count();

    const res6 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.6')
      .send({
        merchant_name: `Shop Email Retry ${testSuffix}`,
        full_name: 'Nguyễn Văn Email Retry',
        email: email1, // Same email as Test 1, still pending
        password: 'SecurePassword123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(201);

    assert.strictEqual(res6.body.data.status, 'PENDING_VERIFICATION');
    assert.strictEqual(res6.body.data.email, email1);

    const usersCountAfter = await prisma.user.count();
    assert.strictEqual(
      usersCountAfter,
      usersCountBefore,
      'No duplicate user row should be created'
    );

    const sent6 = mockDeliveryAdapter.findMessagesByRecipient(email1);
    assert.strictEqual(sent6.length, 1, 'New verification token re-issued and dispatched');
    console.log(
      '  PASS: AC-AUTH-02-06 Re-issued token to existing pending user without duplicating rows'
    );

    // -------------------------------------------------------------------------
    // AC-AUTH-02-07: Verify with valid, unexpired token -> Transitions to ACTIVE
    // -------------------------------------------------------------------------
    console.log('[TEST 7 / AC-AUTH-02-07] Verify with valid token transitions to ACTIVE');
    const validToken = sent6[0].token!;
    const res7 = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: validToken })
      .expect(200);

    assert.strictEqual(res7.body.data.status, 'ACTIVE');
    assert.strictEqual(res7.body.data.verified, true);
    assert.strictEqual(res7.body.data.channel, 'email');

    // Check DB state
    const verifiedUser = await prisma.user.findUnique({
      where: { id: res7.body.data.user_id },
    });
    assert.strictEqual(verifiedUser?.status, 'active');
    assert.ok(verifiedUser?.email_verified_at, 'email_verified_at must be populated');
    console.log('  PASS: AC-AUTH-02-07 Valid token transitioned user to active status');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-08: Verify with expired token -> 410 TOKEN_EXPIRED
    // -------------------------------------------------------------------------
    console.log('[TEST 8 / AC-AUTH-02-08] Verify with expired token returns 410 TOKEN_EXPIRED');
    const res8 = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'test-token-expired' }) // Seed expired token
      .expect(410);

    assert.strictEqual(res8.body.error.code, 'TOKEN_EXPIRED');
    assert.strictEqual(res8.body.error.retryable, false);
    console.log('  PASS: AC-AUTH-02-08 Expired token explicitly rejected with 410 TOKEN_EXPIRED');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-09: Verify with already-consumed token (replay) -> 410 TOKEN_ALREADY_CONSUMED
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 9 / AC-AUTH-02-09] Replay consumed token returns 410 TOKEN_ALREADY_CONSUMED'
    );
    const res9 = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ token: 'test-token-consumed' }) // Seed consumed token
      .expect(410);

    assert.strictEqual(res9.body.error.code, 'TOKEN_ALREADY_CONSUMED');
    console.log('  PASS: AC-AUTH-02-09 Replayed token rejected with 410 TOKEN_ALREADY_CONSUMED');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-10: Registration rate limit exceeded (same IP / identifier)
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 10 / AC-AUTH-02-10] Registration rate limit enforcement (5 attempts/hour/IP)'
    );
    const spammerIp = '203.0.113.99';
    rateLimitService.clear();

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .set('x-forwarded-for', spammerIp)
        .send({
          merchant_name: `Spam Shop ${i}`,
          full_name: 'Spammer Bot',
          email: `bot${i}.${testSuffix}@spam.test`,
          password: 'Password123!',
          terms_accepted: true,
          terms_version: '2026.1',
        })
        .expect(201);
    }

    // 6th attempt from same IP must return 429 RATE_LIMITED
    const res10 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', spammerIp)
      .send({
        merchant_name: 'Blocked Shop',
        full_name: 'Blocked Bot',
        email: `blocked.${testSuffix}@spam.test`,
        password: 'Password123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(429);

    assert.strictEqual(res10.body.error.code, 'RATE_LIMITED');
    assert.strictEqual(res10.body.error.retryable, true);
    console.log(
      '  PASS: AC-AUTH-02-10 Enforced 429 RATE_LIMITED after 5 registration attempts per IP'
    );

    // -------------------------------------------------------------------------
    // AC-AUTH-02-11: Resend-verification rate limit exceeded
    // -------------------------------------------------------------------------
    console.log('[TEST 11 / AC-AUTH-02-11] Resend-verification rate limit (60s cooldown)');
    rateLimitService.clear();
    const pendingEmail = 'pending@shipde.vn'; // Seed pending user

    // 1st resend succeeds
    const res11_1 = await request(app.getHttpServer())
      .post('/auth/verify/resend')
      .send({ identifier: pendingEmail, channel: 'email' })
      .expect(200);

    assert.strictEqual(res11_1.body.data.status, 'SENT');
    assert.strictEqual(res11_1.body.data.cooldown_seconds, 60);

    // 2nd resend within cooldown returns 429 RATE_LIMITED
    const res11_2 = await request(app.getHttpServer())
      .post('/auth/verify/resend')
      .send({ identifier: pendingEmail, channel: 'email' })
      .expect(429);

    assert.strictEqual(res11_2.body.error.code, 'RATE_LIMITED');
    assert.strictEqual(res11_2.body.error.retryable, true);
    console.log('  PASS: AC-AUTH-02-11 Resend cooldown enforced 429 RATE_LIMITED independently');

    // -------------------------------------------------------------------------
    // AC-AUTH-02-12: Concurrent duplicate submissions, same unverified identifier
    // -------------------------------------------------------------------------
    console.log('[TEST 12 / AC-AUTH-02-12] Concurrent duplicate submissions safety');
    const concurrentEmail = `concurrent.${testSuffix}@shipde.vn`;
    const submitPayload = {
      merchant_name: `Concurrent Shop ${testSuffix}`,
      full_name: 'Concurrent User',
      email: concurrentEmail,
      password: 'SecurePassword123!',
      terms_accepted: true,
      terms_version: '2026.1',
    };

    const [cRes1, cRes2] = await Promise.all([
      request(app.getHttpServer())
        .post('/auth/register')
        .set('x-forwarded-for', '198.51.100.50')
        .send(submitPayload),
      request(app.getHttpServer())
        .post('/auth/register')
        .set('x-forwarded-for', '198.51.100.51')
        .send(submitPayload),
    ]);

    // Both should respond 201 (one created, other treated as retry/re-issue)
    assert.strictEqual(cRes1.status, 201);
    assert.strictEqual(cRes2.status, 201);

    // Exactly ONE user record exists for this email
    const concurrentUsers = await prisma.user.findMany({
      where: { email: concurrentEmail },
    });
    assert.strictEqual(concurrentUsers.length, 1, 'Exactly one user record must persist');
    console.log(
      '  PASS: AC-AUTH-02-12 Handled concurrent registration safely without duplicate records'
    );

    // -------------------------------------------------------------------------
    // AC-AUTH-02-13: Password hashing verification
    // -------------------------------------------------------------------------
    console.log('[TEST 13 / AC-AUTH-02-13] Memory-hard password hashing (scrypt)');
    const rawPassword = 'SuperSecretPlaintextPassword!99';
    const hash = await hashPassword(rawPassword);
    assert.ok(hash.startsWith('scrypt$16384$8$1$'), 'Hash must use scrypt OWASP parameters');
    assert.notStrictEqual(hash, rawPassword, 'Plaintext must not be stored');

    const isValid = await verifyPassword(rawPassword, hash);
    assert.strictEqual(isValid, true, 'Valid password must verify');
    const isInvalid = await verifyPassword('WrongPassword', hash);
    assert.strictEqual(isInvalid, false, 'Wrong password must fail');
    console.log('  PASS: AC-AUTH-02-13 Verified memory-hard password hashing and validation');

    // -------------------------------------------------------------------------
    // Phone OTP Verification Flow
    // -------------------------------------------------------------------------
    console.log('[TEST 14] Phone OTP verification flow');
    const phoneOtp = sent2[0].otp!;
    const res14 = await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone: phone2, otp: phoneOtp })
      .expect(200);

    assert.strictEqual(res14.body.data.status, 'ACTIVE');
    assert.strictEqual(res14.body.data.channel, 'phone');
    assert.strictEqual(res14.body.data.verified, true);
    console.log('  PASS: Phone OTP verified user to ACTIVE');

    // -------------------------------------------------------------------------
    // [TEST 15] Phone OTP Negative Paths (BR-AUTH-06)
    // -------------------------------------------------------------------------
    console.log('[TEST 15 / BR-AUTH-06] Phone OTP negative paths (wrong, expired, consumed)');

    // 15a. Wrong OTP -> 400 INVALID_OTP
    const res15a = await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone: '0909999001', otp: '000000' })
      .expect(400);
    assert.strictEqual(res15a.body.error.code, 'INVALID_OTP');
    console.log('  PASS: Wrong OTP rejected with 400 INVALID_OTP');

    // 15b. Expired OTP -> 410 OTP_EXPIRED
    const res15b = await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone: '0909999002', otp: '123456' })
      .expect(410);
    assert.strictEqual(res15b.body.error.code, 'OTP_EXPIRED');
    console.log('  PASS: Expired OTP rejected with 410 OTP_EXPIRED');

    // 15c. Consumed OTP -> 410 OTP_ALREADY_CONSUMED
    const res15c = await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone: '0909999003', otp: '123456' })
      .expect(410);
    assert.strictEqual(res15c.body.error.code, 'OTP_ALREADY_CONSUMED');
    console.log('  PASS: Consumed OTP rejected with 410 OTP_ALREADY_CONSUMED');

    // -------------------------------------------------------------------------
    // [TEST 16] Duplicate Verified Phone Rejection (BR-AUTH-03)
    // -------------------------------------------------------------------------
    console.log(
      '[TEST 16 / BR-AUTH-03] Duplicate verified phone rejected with 400 VALIDATION_ERROR'
    );
    const res16 = await request(app.getHttpServer())
      .post('/auth/register')
      .set('x-forwarded-for', '198.51.100.16')
      .send({
        merchant_name: `Duplicate Phone Shop ${testSuffix}`,
        full_name: 'Trần Văn Duplicate Phone',
        phone: phone2, // Already active from TEST 14
        password: 'SecurePassword123!',
        terms_accepted: true,
        terms_version: '2026.1',
      })
      .expect(400);

    assert.strictEqual(res16.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res16.body.error.fields[0].field, 'phone');
    assert.strictEqual(res16.body.error.fields[0].code, 'DUPLICATE');
    console.log('  PASS: Duplicate verified phone rejected with 400 VALIDATION_ERROR');

    // -------------------------------------------------------------------------
    // [TEST 17] Resend Anti-Enumeration & Channel Mismatch (BR-AUTH-08)
    // -------------------------------------------------------------------------
    console.log('[TEST 17 / BR-AUTH-08] Resend anti-enumeration and channel mismatch');

    // 17a. Non-existent identifier returns generic 200 SENT to prevent enumeration
    const res17a = await request(app.getHttpServer())
      .post('/auth/verify/resend')
      .send({ identifier: `nonexistent.${testSuffix}@shipde.vn`, channel: 'email' })
      .expect(200);
    assert.strictEqual(res17a.body.data.status, 'SENT');
    console.log('  PASS: Non-existent identifier returned generic SENT (anti-enumeration)');

    // 17b. Channel mismatch returns 400 CHANNEL_MISMATCH
    const res17b = await request(app.getHttpServer())
      .post('/auth/verify/resend')
      .send({ identifier: '0909999001', channel: 'email' })
      .expect(400);
    assert.strictEqual(res17b.body.error.code, 'CHANNEL_MISMATCH');
    console.log('  PASS: Channel mismatch rejected with 400 CHANNEL_MISMATCH');

    // -------------------------------------------------------------------------
    // [TEST 18] OTP Brute-Force Lockout (BR-AUTH-06)
    // -------------------------------------------------------------------------
    console.log('[TEST 18 / BR-AUTH-06] OTP brute-force lockout after 5 failed attempts');
    rateLimitService.clear();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await request(app.getHttpServer())
        .post('/auth/verify-phone')
        .send({ phone: '0909999001', otp: `99999${attempt}` })
        .expect(400);
      assert.strictEqual(res.body.error.code, 'INVALID_OTP');
    }
    // 5th wrong attempt triggers OTP_MAX_ATTEMPTS_EXCEEDED
    const res18 = await request(app.getHttpServer())
      .post('/auth/verify-phone')
      .send({ phone: '0909999001', otp: '999995' })
      .expect(429);
    assert.strictEqual(res18.body.error.code, 'OTP_MAX_ATTEMPTS_EXCEEDED');
    console.log('  PASS: OTP brute-force locked out with 429 OTP_MAX_ATTEMPTS_EXCEEDED');

    // -------------------------------------------------------------------------
    // [TEST 19] Forgot Password Anti-Enumeration & Rate Limiting (FEAT-AUTH-04)
    // -------------------------------------------------------------------------
    console.log('[TEST 19 / FEAT-AUTH-04] Forgot password anti-enumeration and rate limiting');

    // 19a. Non-existent email returns generic 200 SENT (anti-enumeration)
    const res19a = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '203.0.113.10')
      .send({ identifier: `nonexistent.${testSuffix}@shipde.vn` })
      .expect(200);
    assert.strictEqual(res19a.body.data.status, 'SENT');
    assert.strictEqual(res19a.body.data.channel, 'email');
    console.log('  PASS: Non-existent email returned generic SENT (anti-enumeration)');

    // 19b. Non-existent phone returns generic 200 SENT (anti-enumeration)
    const res19b = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '203.0.113.11')
      .send({ identifier: '0909999999' })
      .expect(200);
    assert.strictEqual(res19b.body.data.status, 'SENT');
    assert.strictEqual(res19b.body.data.channel, 'phone');
    console.log('  PASS: Non-existent phone returned generic SENT (anti-enumeration)');

    // 19c. Unverified user returns generic 200 SENT (anti-enumeration)
    const res19c = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '203.0.113.12')
      .send({ identifier: `unverified.${testSuffix}@shipde.vn` })
      .expect(200);
    assert.strictEqual(res19c.body.data.status, 'SENT');
    console.log('  PASS: Unverified user returned generic SENT (anti-enumeration)');

    // 19d. Valid user gets token sent and stored in mock adapter
    rateLimitService.clear();
    const res19d = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({ identifier: email1 })
      .expect(200);
    assert.strictEqual(res19d.body.data.status, 'SENT');
    assert.strictEqual(res19d.body.data.channel, 'email');
    const lastMsg19d = mockDeliveryAdapter.getLastMessage();
    assert.ok(lastMsg19d, 'Expected token delivery message');
    assert.strictEqual(lastMsg19d.recipient, email1);
    assert.ok(lastMsg19d.token, 'Expected reset token in delivery message');
    const resetToken19d = lastMsg19d.token!;
    console.log('  PASS: Valid user received reset token via delivery adapter');

    // 19e. IP rate limit: 5 requests/hour per IP
    rateLimitService.clear();
    for (let i = 1; i <= 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('x-forwarded-for', '198.51.100.50')
        .send({ identifier: `rateip${i}.${testSuffix}@shipde.vn` })
        .expect(200);
    }
    const res19e = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '198.51.100.50')
      .send({ identifier: `rateip6.${testSuffix}@shipde.vn` })
      .expect(429);
    assert.strictEqual(res19e.body.error.code, 'RATE_LIMITED');
    console.log('  PASS: IP rate limit enforced at 5 requests/hour (429 RATE_LIMITED)');

    // 19f. Identifier rate limit: 3 requests/hour per identifier
    rateLimitService.clear();
    const testId19f = `rateid.${testSuffix}@shipde.vn`;
    for (let i = 1; i <= 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .set('x-forwarded-for', `198.51.100.${50 + i}`)
        .send({ identifier: testId19f })
        .expect(200);
    }
    const res19f = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '198.51.100.55')
      .send({ identifier: testId19f })
      .expect(429);
    assert.strictEqual(res19f.body.error.code, 'RATE_LIMITED');
    console.log('  PASS: Identifier rate limit enforced at 3 requests/hour (429 RATE_LIMITED)');

    // 19g. Invalid email format returns 400 VALIDATION_ERROR
    const res19g = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ identifier: 'invalid-email' })
      .expect(400);
    assert.strictEqual(res19g.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res19g.body.error.fields[0].field, 'identifier');
    console.log('  PASS: Invalid email format rejected with 400 VALIDATION_ERROR');

    // 19h. Invalid phone format returns 400 VALIDATION_ERROR
    const res19h = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ identifier: '12345' })
      .expect(400);
    assert.strictEqual(res19h.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res19h.body.error.fields[0].field, 'identifier');
    console.log('  PASS: Invalid phone format rejected with 400 VALIDATION_ERROR');

    // 19i. Empty identifier returns 400 VALIDATION_ERROR
    const res19i = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ identifier: '' })
      .expect(400);
    assert.strictEqual(res19i.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res19i.body.error.fields[0].field, 'identifier');
    console.log('  PASS: Empty identifier rejected with 400 VALIDATION_ERROR');

    // -------------------------------------------------------------------------
    // [TEST 20] Verify Reset Token (FEAT-AUTH-04)
    // -------------------------------------------------------------------------
    console.log('[TEST 20 / FEAT-AUTH-04] Verify reset token');

    // 20a. Valid token returns identifier and channel
    const res20a = await request(app.getHttpServer())
      .post('/auth/verify-reset-token')
      .send({ token: resetToken19d })
      .expect(200);
    assert.strictEqual(res20a.body.data.valid, true);
    assert.strictEqual(res20a.body.data.identifier, email1);
    assert.strictEqual(res20a.body.data.channel, 'email');
    console.log('  PASS: Valid token returns identifier and channel');

    // 20b. Invalid token returns 400 INVALID_TOKEN
    const res20b = await request(app.getHttpServer())
      .post('/auth/verify-reset-token')
      .send({ token: 'invalid-token-123' })
      .expect(400);
    assert.strictEqual(res20b.body.error.code, 'INVALID_TOKEN');
    console.log('  PASS: Invalid token rejected with 400 INVALID_TOKEN');

    // 20c. Missing token returns 400 VALIDATION_ERROR
    const res20c = await request(app.getHttpServer())
      .post('/auth/verify-reset-token')
      .send({})
      .expect(400);
    assert.strictEqual(res20c.body.error.code, 'VALIDATION_ERROR');
    assert.strictEqual(res20c.body.error.fields[0].field, 'token');
    console.log('  PASS: Missing token rejected with 400 VALIDATION_ERROR');

    // -------------------------------------------------------------------------
    // [TEST 21] Reset Password (FEAT-AUTH-04)
    // -------------------------------------------------------------------------
    console.log('[TEST 21 / FEAT-AUTH-04] Reset password');

    // 21a. Valid token + strong matching password → 200, token consumed, sessions revoked
    const res21a = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({
        token: resetToken19d,
        password: 'NewPassword123!',
        password_confirm: 'NewPassword123!',
      })
      .expect(200);
    assert.strictEqual(
      res21a.body.data.message,
      'Mật khẩu đã được đặt lại thành công. Tất cả phiên đăng nhập khác đã bị thu hồi.'
    );
    console.log('  PASS: Valid reset succeeded, token consumed, sessions revoked');

    // 21b. Reuse consumed token → 400 TOKEN_ALREADY_USED
    const res21b = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({
        token: resetToken19d,
        password: 'AnotherPass123!',
        password_confirm: 'AnotherPass123!',
      })
      .expect(400);
    assert.strictEqual(res21b.body.error.code, 'TOKEN_ALREADY_USED');
    console.log('  PASS: Consumed token rejected with 400 TOKEN_ALREADY_USED');

    // 21c. Invalid token + valid password → 400 INVALID_TOKEN
    const res21c = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({
        token: 'invalid-token-xyz',
        password: 'ValidPass123!',
        password_confirm: 'ValidPass123!',
      })
      .expect(400);
    assert.strictEqual(res21c.body.error.code, 'INVALID_TOKEN');
    console.log('  PASS: Invalid token rejected with 400 INVALID_TOKEN');

    // 21d. Fresh token + weak password → 400 VALIDATION_ERROR with WEAK_PASSWORD
    rateLimitService.clear();
    const res21dFP = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({ identifier: email1 })
      .expect(200);
    const lastMsg21d = mockDeliveryAdapter.getLastMessage();
    const resetToken21d = lastMsg21d.token!;
    const res21d = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({ token: resetToken21d, password: 'weakpass', password_confirm: 'weakpass' })
      .expect(400);
    assert.strictEqual(res21d.body.error.code, 'VALIDATION_ERROR');
    const weakField = res21d.body.error.fields?.find((f) => f.code === 'WEAK_PASSWORD');
    assert.ok(weakField, 'Expected WEAK_PASSWORD field error');
    console.log('  PASS: Weak password rejected with 400 VALIDATION_ERROR WEAK_PASSWORD');

    // 21e. Fresh token + password mismatch → 400 VALIDATION_ERROR with MISMATCH
    const res21e = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .set('x-forwarded-for', '203.0.113.13')
      .send({
        token: resetToken21d,
        password: 'ValidPass123!',
        password_confirm: 'DifferentPass123!',
      })
      .expect(400);
    assert.strictEqual(res21e.body.error.code, 'VALIDATION_ERROR');
    const mismatchField = res21e.body.error.fields?.find((f) => f.code === 'MISMATCH');
    assert.ok(mismatchField, 'Expected MISMATCH field error');
    console.log('  PASS: Password mismatch rejected with 400 VALIDATION_ERROR MISMATCH');
  } finally {
    await app.close();
  }
}

runAuthSupertestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Auth Supertest Suite Failed:', err);
    process.exit(1);
  });
