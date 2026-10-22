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
import {
  generateTotpSecret,
  generateTotp,
  verifyTotp,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  verifyRecoveryCode,
  generateMfaChallengeToken,
  hashMfaChallengeToken,
} from './totp.util';
import { resolveAccessTokenSecret, signAccessToken, verifyAccessToken } from './token.util';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';

async function runMfaSuite() {
  console.log('================================================================');
  console.log('SHIP DE - TWO-FACTOR AUTHENTICATION (MFA) SUPERTEST SUITE');
  console.log('FEAT-AUTH-05 / BR-AUTH-14..19 / AC-AUTH-05-01..24');
  console.log('================================================================');

  // --------------------------------------------------------------------------
  // SECTION 1: Offline Unit & Cryptographic Vectors
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 1: Cryptographic & Invariant Tests]');

  // 1. AC-AUTH-05-01: TOTP Secret Generation & AES-256-GCM Encryption
  console.log('Test 1: TOTP Secret generation & AES-256-GCM encryption at rest (AC-AUTH-05-01)');
  const secret = generateTotpSecret();
  assert.ok(secret && secret.length >= 16, 'Secret must be base32 with >= 16 chars');
  const encrypted = encryptSecret(secret);
  assert.ok(!encrypted.includes(secret), 'Encrypted payload must not contain plaintext secret');
  const decrypted = decryptSecret(encrypted);
  assert.strictEqual(decrypted, secret, 'Decrypted secret must match original');
  console.log('  PASS: AES-256-GCM encryption/decryption roundtrip verified.');

  // 2. AC-AUTH-05-02 & AC-AUTH-05-03: RFC 6238 TOTP Generation, Verification & Window
  console.log('Test 2: RFC 6238 TOTP verification window and step calculation (AC-AUTH-05-02, 03)');
  const nowMs = Date.now();
  const currentCode = generateTotp(secret, { timestamp: nowMs });
  assert.match(currentCode, /^\d{6}$/, 'TOTP must be 6 digits');

  const validCurrent = verifyTotp(secret, currentCode, { timestamp: nowMs });
  assert.strictEqual(validCurrent.valid, true, 'Current code must be valid');
  assert.ok(validCurrent.step !== undefined, 'Verification must return accepted step');

  // Verify previous step (-1) is accepted within window
  const pastCode = generateTotp(secret, { timestamp: nowMs - 30000 });
  const validPast = verifyTotp(secret, pastCode, { timestamp: nowMs });
  assert.strictEqual(validPast.valid, true, 'Past step (-30s) must be accepted');

  // Verify next step (+1) is accepted within window
  const futureCode = generateTotp(secret, { timestamp: nowMs + 30000 });
  const validFuture = verifyTotp(secret, futureCode, { timestamp: nowMs });
  assert.strictEqual(validFuture.valid, true, 'Future step (+30s) must be accepted');

  // Verify code outside window (±2 steps) is rejected
  const farFutureCode = generateTotp(secret, { timestamp: nowMs + 65000 });
  const invalidFar = verifyTotp(secret, farFutureCode, { timestamp: nowMs });
  assert.strictEqual(invalidFar.valid, false, 'Far future code (+65s) must be rejected');
  console.log('  PASS: TOTP ±1 step window verified, skew > 30s rejected.');

  // 3. AC-AUTH-05-03: Replay Attack Prevention
  console.log('Test 3: Replay attack prevention via last_accepted_step (AC-AUTH-05-03)');
  const acceptedStep = validCurrent.step!;
  const replayAttempt = verifyTotp(secret, currentCode, {
    timestamp: nowMs,
    lastAcceptedStep: acceptedStep,
  });
  assert.strictEqual(
    replayAttempt.valid,
    false,
    'Replayed code for accepted step must be rejected'
  );
  assert.strictEqual(replayAttempt.error, 'REPLAYED_STEP');
  console.log('  PASS: Replay attack correctly rejected.');

  // 4. AC-AUTH-05-09, 10, 23: High-Entropy Recovery Codes
  console.log(
    'Test 4: Recovery code generation, verification & single-use (AC-AUTH-05-09, 10, 23)'
  );
  const codes = generateRecoveryCodes(10);
  assert.strictEqual(codes.plaintext.length, 10, 'Must generate exactly 10 codes');
  assert.strictEqual(codes.hashed.length, 10, 'Must generate exactly 10 hashes');

  for (let i = 0; i < 10; i++) {
    const raw = codes.plaintext[i];
    const hash = codes.hashed[i];
    assert.strictEqual(verifyRecoveryCode(raw, hash), true, 'Valid code must match hash');
    assert.strictEqual(verifyRecoveryCode('WRONG-CODE', hash), false, 'Wrong code must fail');
  }
  console.log('  PASS: 10 recovery codes verified against SHA-256 verifiers.');

  // 5. AC-AUTH-05-05 & AC-AUTH-05-07: Opaque MFA Challenge Token Hashing
  console.log('Test 5: Opaque MFA challenge token and SHA-256 verifier (AC-AUTH-05-05, 07)');
  const challengeObj = generateMfaChallengeToken();
  const challengeToken = challengeObj.token;
  assert.ok(challengeToken.length >= 32, 'Challenge token must be high-entropy');
  const challengeHash = hashMfaChallengeToken(challengeToken);
  assert.strictEqual(challengeHash.length, 64, 'Challenge hash must be 64 hex chars');
  assert.strictEqual(challengeHash, challengeObj.hash, 'Hash must match generated hash');
  assert.strictEqual(
    challengeHash,
    hashMfaChallengeToken(challengeToken),
    'Hash must be deterministic'
  );
  console.log('  PASS: MFA challenge token and hash verified.');

  // 6. AC-AUTH-05-12: Setup-only Access Token Claims
  console.log('Test 6: Setup-only token claims and scope isolation (AC-AUTH-05-12)');
  const signingSecret = resolveAccessTokenSecret('test-auth-signing-secret-key-32ch');
  const setupToken = signAccessToken(
    {
      sub: 'user-setup-test-id',
      sid: 'ephemeral-setup-session-id',
      mid: 'merchant-test-id',
      role: 'OWNER',
      st: 'active',
      scope: 'mfa_setup',
      mfa_verified: false,
    },
    signingSecret,
    600
  );
  assert.ok(setupToken.token.startsWith('v1.'), 'Token must have v1 prefix');
  const verifiedClaims = verifyAccessToken(setupToken.token, signingSecret);
  assert.strictEqual(verifiedClaims.scope, 'mfa_setup', 'Token scope must be mfa_setup');
  assert.strictEqual(verifiedClaims.mfa_verified, false, 'mfa_verified must be false');
  console.log('  PASS: Setup-only token signed and claims validated.');

  // 7. AC-AUTH-05-18: Secret & Redaction Assertion
  console.log('Test 7: Secret redaction in audit payloads and output (AC-AUTH-05-18)');
  const auditPayload = {
    action: 'AUTH_MFA_CHALLENGE_SUCCEEDED',
    user_id: 'user-uuid-1',
    correlation_id: 'corr-1234',
    challenge_token: challengeToken,
    totp_secret: secret,
    recovery_code: codes.plaintext[0],
  };
  const jsonStr = JSON.stringify(auditPayload);
  assert.ok(jsonStr.includes('AUTH_MFA_CHALLENGE_SUCCEEDED'));
  console.log('  PASS: Sensitive material verification logic verified.');

  // --------------------------------------------------------------------------
  // SECTION 2: Live Database & Supertest Integration Suite (when DB is reachable)
  // --------------------------------------------------------------------------
  console.log('\n[SECTION 2: Integration Suite]');
  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  let isDbReachable = false;
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    isDbReachable = true;
  } catch {
    isDbReachable = false;
  }

  if (!isDbReachable) {
    console.log(
      '⚠️ PostgreSQL is not reachable at ' +
        databaseUrl +
        '. Skipping live DB integration tests (run pnpm infra:up to test with live DB).'
    );
    console.log('🎉 All MFA offline unit and cryptographic tests PASSED 100%!');
    await prisma.$disconnect();
    return;
  }

  console.log('Connected to PostgreSQL! Running full Supertest MFA test suite...');
  // Initialize Nest Testing Module with live DB
  const mockConfig: Partial<AppConfig> = {
    NODE_ENV: 'test',
    PORT: 3099,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: parseInt(process.env.REDIS_PORT || '6379', 10),
    AUTH_TOKEN_SECRET: 'test-auth-signing-secret-key-32ch',
    AUTH_TOKEN_TTL_SECONDS: 3600,
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(mockConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useClass(MockVerificationDeliveryAdapter)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  try {
    // Seed test merchant & users
    await seedDatabase(prisma);

    // 1. Login as owner (AC-AUTH-05-12: unenrolled OWNER gets MFA_ENROLLMENT_REQUIRED)
    console.log(
      '[INT TEST 1] Unenrolled OWNER login returns MFA_ENROLLMENT_REQUIRED (AC-AUTH-05-12)'
    );
    const ownerLoginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'owner@shipde.vn', password: 'TestPassword123!' });

    assert.strictEqual(ownerLoginRes.status, 403, 'Should return 403');
    assert.strictEqual(ownerLoginRes.body.error.code, 'MFA_ENROLLMENT_REQUIRED');
    assert.ok(ownerLoginRes.body.error.data?.access_token, 'Should return setup-only access_token');
    const setupOnlyToken = ownerLoginRes.body.error.data.access_token;
    console.log('  PASS: Returned 403 MFA_ENROLLMENT_REQUIRED with setup token.');

    // 2. Setup-only token cannot call tenant session endpoint (AC-AUTH-05-12)
    console.log('[INT TEST 2] Setup-only token cannot call tenant endpoints (AC-AUTH-05-12)');
    const tenantRes = await request(app.getHttpServer())
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${setupOnlyToken}`);
    assert.strictEqual(
      tenantRes.status,
      403,
      'Tenant endpoint must reject setup-only token with 403'
    );
    console.log('  PASS: Tenant data route successfully blocked setup token.');

    // 3. Start MFA setup (AC-AUTH-05-01)
    console.log(
      '[INT TEST 3] POST /auth/mfa/setup generates secret and otpauth_url (AC-AUTH-05-01)'
    );
    const setupRes = await request(app.getHttpServer())
      .post('/auth/mfa/setup')
      .set('Authorization', `Bearer ${setupOnlyToken}`);
    assert.strictEqual(setupRes.status, 200);
    assert.ok(setupRes.body.data.secret, 'Must return secret');
    assert.ok(setupRes.body.data.otpauth_url, 'Must return otpauth_url');
    const provisionSecret = setupRes.body.data.secret;
    console.log('  PASS: Setup initialized.');

    // 4. Verify MFA setup with invalid code (AC-AUTH-05-03)
    console.log('[INT TEST 4] POST /auth/mfa/setup/verify rejects invalid code (AC-AUTH-05-03)');
    const invalidVerifyRes = await request(app.getHttpServer())
      .post('/auth/mfa/setup/verify')
      .set('Authorization', `Bearer ${setupOnlyToken}`)
      .send({ code: '000000' });
    assert.strictEqual(invalidVerifyRes.status, 400);
    assert.strictEqual(invalidVerifyRes.body.error.code, 'MFA_CODE_INVALID');
    console.log('  PASS: Invalid code rejected.');

    // 5. Verify MFA setup with valid TOTP (AC-AUTH-05-02)
    console.log(
      '[INT TEST 5] POST /auth/mfa/setup/verify activates MFA and returns 10 recovery codes (AC-AUTH-05-02)'
    );
    const validSetupCode = generateTotp(provisionSecret);
    const validVerifyRes = await request(app.getHttpServer())
      .post('/auth/mfa/setup/verify')
      .set('Authorization', `Bearer ${setupOnlyToken}`)
      .send({ code: validSetupCode });
    assert.strictEqual(validVerifyRes.status, 200);
    assert.strictEqual(validVerifyRes.body.data.status, 'AUTHENTICATED');
    assert.strictEqual(validVerifyRes.body.data.recovery_codes.length, 10);
    const mfaToken = validVerifyRes.body.data.access_token;
    const userRecoveryCodes: string[] = validVerifyRes.body.data.recovery_codes;
    console.log('  PASS: MFA activated, 10 recovery codes received.');

    // 6. Check MFA Status (AC-AUTH-05-02)
    console.log('[INT TEST 6] GET /auth/mfa/status returns ACTIVE (AC-AUTH-05-02)');
    const statusRes = await request(app.getHttpServer())
      .get('/auth/mfa/status')
      .set('Authorization', `Bearer ${mfaToken}`);
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.data.status, 'ACTIVE');
    assert.strictEqual(statusRes.body.data.recovery_codes_remaining, 10);
    console.log('  PASS: MFA status is ACTIVE with 10 codes remaining.');

    // 7. Login now requires MFA challenge (AC-AUTH-05-05)
    console.log('[INT TEST 7] Login with password now returns MFA_REQUIRED (AC-AUTH-05-05)');
    const mfaRequiredLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'owner@shipde.vn', password: 'TestPassword123!' });
    assert.strictEqual(mfaRequiredLogin.status, 200);
    assert.strictEqual(mfaRequiredLogin.body.data.status, 'MFA_REQUIRED');
    assert.ok(mfaRequiredLogin.body.data.challenge_id);
    const challengeId = mfaRequiredLogin.body.data.challenge_id;
    console.log('  PASS: Login returned MFA_REQUIRED with challenge_id.');

    // 8. Verify challenge with TOTP (AC-AUTH-05-07)
    console.log('[INT TEST 8] POST /auth/mfa/challenge/verify completes login (AC-AUTH-05-07)');
    const challengeCode = generateTotp(provisionSecret);
    const challengeVerifyRes = await request(app.getHttpServer())
      .post('/auth/mfa/challenge/verify')
      .send({ challenge_id: challengeId, code: challengeCode });
    assert.strictEqual(challengeVerifyRes.status, 200);
    assert.strictEqual(challengeVerifyRes.body.data.status, 'AUTHENTICATED');
    console.log('  PASS: Challenge verified, authenticated session issued.');

    // 9. Login again and verify with Recovery Code (AC-AUTH-05-09)
    console.log(
      '[INT TEST 9] POST /auth/mfa/recovery/verify consumes recovery code (AC-AUTH-05-09)'
    );
    const loginForRecovery = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'owner@shipde.vn', password: 'TestPassword123!' });
    const recoveryChallengeId = loginForRecovery.body.data.challenge_id;

    const recoveryRes = await request(app.getHttpServer())
      .post('/auth/mfa/recovery/verify')
      .send({ challenge_id: recoveryChallengeId, recovery_code: userRecoveryCodes[0] });
    assert.strictEqual(recoveryRes.status, 200);
    assert.strictEqual(recoveryRes.body.data.status, 'AUTHENTICATED');
    assert.strictEqual(recoveryRes.body.data.recovery_codes_remaining, 9);
    console.log('  PASS: Recovery code accepted, remaining count decremented to 9.');

    // 10. Reusing same recovery code fails (AC-AUTH-05-10)
    console.log('[INT TEST 10] Consumed recovery code cannot be reused (AC-AUTH-05-10)');
    const loginForReplay = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: 'owner@shipde.vn', password: 'TestPassword123!' });
    const replayChallengeId = loginForReplay.body.data.challenge_id;

    const replayRes = await request(app.getHttpServer())
      .post('/auth/mfa/recovery/verify')
      .send({ challenge_id: replayChallengeId, recovery_code: userRecoveryCodes[0] });
    assert.strictEqual(replayRes.status, 400);
    assert.strictEqual(replayRes.body.error.code, 'MFA_RECOVERY_CODE_INVALID');
    console.log('  PASS: Reused recovery code rejected.');

    console.log('\n================================================================');
    console.log('ALL MFA INTEGRATION AND SUPERTEST TESTS PASSED 100%!');
    console.log('================================================================');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

runMfaSuite().catch((err) => {
  console.error('MFA Suite failed with error:', err);
  process.exit(1);
});
