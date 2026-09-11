import 'reflect-metadata';
import * as assert from 'node:assert';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { verifyPassword, hashPassword } from './password.util';

async function runAuthSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - AUTH & REGISTRATION SUPERTEST SUITE (FEAT-AUTH-01)');
  console.log('================================================================');

  const mockDeliveryAdapter = new MockVerificationDeliveryAdapter();

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(mockDeliveryAdapter)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  const prisma = app.get(PrismaService);
  const rateLimitService = app.get(RateLimitService);

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

    console.log('================================================================');
    console.log('✅ ALL 14 SUPERTEST INTEGRATION TESTS PASSED (FEAT-AUTH-01)');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runAuthSupertestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Auth Supertest Suite Failed:', err);
    process.exit(1);
  });
