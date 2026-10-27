import 'reflect-metadata';
import * as assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { RoleEnum, SessionStatusEnum, InvitationStatusEnum } from '@prisma/client';

function createSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

/**
 * FEAT-USR-01 — Supertest integration harness for user invitations.
 * Exercises AC-USR-01-01 through AC-USR-01-18 over HTTP with live DB.
 */
async function runInvitationsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - USER INVITATIONS SUPERTEST SUITE (FEAT-USR-01)');
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
    TRUST_PROXY_HOPS: 1,
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars-long-for-hmac',
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
    await app.close();
    throw new Error(
      `[FAIL_CLOSED] PostgreSQL database is not reachable at ${databaseUrl}. Live DB supertest requires a running database.`
    );
  }

  // Setup fixtures
  const testSuffix = Date.now().toString().slice(-6);
  const merchant = await prisma.merchant.create({
    data: {
      name: `Invite Merchant ${testSuffix}`,
      code: `INVMER${testSuffix}`,
      status: 'ACTIVE',
    },
  });

  const otherMerchant = await prisma.merchant.create({
    data: {
      name: `Other Merchant ${testSuffix}`,
      code: `OTHMER${testSuffix}`,
      status: 'ACTIVE',
    },
  });

  // Owner user
  const owner = await prisma.user.create({
    data: {
      merchant_id: merchant.id,
      email: `owner.${testSuffix}@shipde.vn`,
      full_name: 'Owner Tester',
      password_hash: 'hashedpassword',
      role: RoleEnum.OWNER,
      status: 'active',
    },
  });

  // Ops manager user
  const opsUser = await prisma.user.create({
    data: {
      merchant_id: merchant.id,
      email: `ops.${testSuffix}@shipde.vn`,
      full_name: 'Ops Manager Tester',
      password_hash: 'hashedpassword',
      role: RoleEnum.OPS_CSKH,
      status: 'active',
    },
  });

  // Warehouse user (no permission to invite)
  const whUser = await prisma.user.create({
    data: {
      merchant_id: merchant.id,
      email: `warehouse.${testSuffix}@shipde.vn`,
      full_name: 'Warehouse Worker',
      password_hash: 'hashedpassword',
      role: RoleEnum.WAREHOUSE,
      status: 'active',
    },
  });

  // Other tenant user
  const otherOwner = await prisma.user.create({
    data: {
      merchant_id: otherMerchant.id,
      email: `other.${testSuffix}@shipde.vn`,
      full_name: 'Other Tenant Owner',
      password_hash: 'hashedpassword',
      role: RoleEnum.OWNER,
      status: 'active',
    },
  });

  // Helper to create session
  const makeSessionToken = async (userId: string, merchantId: string) => {
    const tok = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: tok.hash,
        device_id: 'supertest_client',
        device_model: 'Supertest',
        user_agent: 'Supertest Test Harness',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    return tok.raw;
  };

  const ownerToken = await makeSessionToken(owner.id, merchant.id);
  const opsToken = await makeSessionToken(opsUser.id, merchant.id);
  const whToken = await makeSessionToken(whUser.id, merchant.id);
  const otherToken = await makeSessionToken(otherOwner.id, otherMerchant.id);

  // [TEST 1 / AC-USR-01-01] Owner creates invitation with email & warehouse scope
  console.log(
    '[TEST 1 / AC-USR-01-01] Owner invites new operator with valid email and warehouse scope'
  );
  const sendRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      email: `operator.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
      warehouse_scopes: ['wh-north'],
    });

  assert.strictEqual(sendRes.status, 201);
  assert.strictEqual(sendRes.body.data.role, 'OPS_CSKH');
  assert.strictEqual(sendRes.body.data.status, 'PENDING');
  // SECURITY-NFR / BR-INV-02: Zero raw token or invitation_url in admin response
  assert.strictEqual(sendRes.body.data.token, undefined);
  assert.strictEqual(sendRes.body.data.invitation_url, undefined);
  const rawToken = mockDeliveryAdapter.getLastMessage()?.token!;
  const invitationId = sendRes.body.data.id;
  assert.ok(rawToken);

  // Assert token_hash, 7-day expires_at, and audit rows in DB
  const invRow = await prisma.invitation.findUnique({ where: { id: invitationId } });
  assert.ok(invRow);
  assert.strictEqual(invRow.token_hash, createHash('sha256').update(rawToken).digest('hex'));
  assert.notStrictEqual(invRow.token_hash, rawToken);
  const expiryDiffDays = Math.round(
    (new Date(invRow.expires_at).getTime() - Date.now()) / (24 * 3600 * 1000)
  );
  assert.strictEqual(expiryDiffDays, 7);
  const auditSent = await prisma.auditLog.findFirst({
    where: { entity_id: invitationId, action: 'INVITATION_SENT' },
  });
  assert.ok(auditSent);
  assert.strictEqual(JSON.stringify(auditSent).includes(rawToken), false);

  // [TEST 2 / AC-USR-01-02] Owner invites new operator with phone identifier
  console.log('[TEST 2 / AC-USR-01-02] Owner invites new operator with phone identifier');
  const phoneRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      phone: '0901234567',
      role: RoleEnum.ACCOUNTANT,
    });
  assert.strictEqual(phoneRes.status, 201);
  assert.strictEqual(phoneRes.body.data.phone, '0901234567');
  assert.strictEqual(phoneRes.body.data.token, undefined);
  assert.strictEqual(phoneRes.body.data.invitation_url, undefined);
  const rawPhoneToken = mockDeliveryAdapter.getLastMessage()?.token!;

  // [TEST 3 / AC-USR-01-03] Non-owner manager attempts to invite OWNER (Privilege Ceiling)
  console.log(
    '[TEST 3 / AC-USR-01-03] Non-owner manager attempts to invite a user with OWNER role'
  );
  const ceilRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${opsToken}`)
    .send({
      email: `coowner.${testSuffix}@shipde.vn`,
      role: RoleEnum.OWNER,
    });
  assert.strictEqual(ceilRes.status, 403);
  assert.strictEqual(ceilRes.body.error.code, 'FORBIDDEN');

  // [TEST 4 / AC-USR-01-04] User without Manage users/roles permission attempts to send invite
  console.log(
    '[TEST 4 / AC-USR-01-04] User without Manage users/roles permission attempts to send invite'
  );
  const unauthRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${whToken}`)
    .send({
      email: `guest.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
    });
  assert.strictEqual(unauthRes.status, 403);
  assert.strictEqual(unauthRes.body.error.code, 'FORBIDDEN');

  // [TEST 5 / AC-USR-01-05] Invite sent to email already active in tenant
  console.log('[TEST 5 / AC-USR-01-05] Invite sent to email already active in the tenant');
  const dupUserRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      email: `owner.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
    });
  assert.strictEqual(dupUserRes.status, 400);
  assert.strictEqual(dupUserRes.body.error.code, 'USER_ALREADY_EXISTS');

  // [TEST 6 / AC-USR-01-06] Invite sent to email that already has pending invite
  console.log(
    '[TEST 6 / AC-USR-01-06] Invite sent to email that already has a pending unexpired invite'
  );
  const dupInviteRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      email: `operator.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
    });
  assert.strictEqual(dupInviteRes.status, 400);
  assert.strictEqual(dupInviteRes.body.error.code, 'INVITATION_ALREADY_PENDING');

  // [TEST 7 / AC-USR-01-07] Missing required fields
  console.log('[TEST 7 / AC-USR-01-07] Missing required recipient identifier or role');
  const valRes = await request(app.getHttpServer())
    .post('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({});
  assert.strictEqual(valRes.status, 400);
  assert.strictEqual(valRes.body.error.code, 'VALIDATION_ERROR');

  // [TEST 8 / AC-USR-01-08] Owner lists invitations
  console.log('[TEST 8 / AC-USR-01-08] Owner lists invitations');
  const listRes = await request(app.getHttpServer())
    .get('/api/v1/invitations')
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.strictEqual(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.data));
  assert.ok(listRes.body.data.length >= 2);
  // Ensure raw tokens are omitted from list
  for (const item of listRes.body.data) {
    assert.strictEqual(item.token, undefined);
    assert.strictEqual(item.token_hash, undefined);
  }

  // [TEST 9 / AC-USR-01-09] Owner resends an expired invitation (EXPIRED -> PENDING)
  console.log('[TEST 9 / AC-USR-01-09] Owner resends an expired invitation');
  const invBeforeResend = await prisma.invitation.findUnique({ where: { id: invitationId } });
  const oldTokenHash = invBeforeResend!.token_hash;

  await prisma.invitation.update({
    where: { id: invitationId },
    data: {
      status: InvitationStatusEnum.EXPIRED,
      expires_at: new Date(Date.now() - 3600000),
    },
  });

  const resendRes = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitationId}/resend`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.strictEqual(resendRes.status, 200);
  assert.strictEqual(resendRes.body.data.status, 'PENDING');
  assert.strictEqual(resendRes.body.data.token, undefined);
  assert.strictEqual(resendRes.body.data.invitation_url, undefined);
  const resentRawToken = mockDeliveryAdapter.getLastMessage()?.token!;
  assert.ok(resentRawToken);
  assert.notStrictEqual(resentRawToken, rawToken, 'Resent raw token must be freshly generated');

  // Assert DB state after resend hash rotation
  const invAfterResend = await prisma.invitation.findUnique({ where: { id: invitationId } });
  assert.ok(invAfterResend);
  assert.notStrictEqual(
    invAfterResend.token_hash,
    oldTokenHash,
    'Token hash must rotate on resend'
  );
  assert.strictEqual(
    invAfterResend.token_hash,
    createHash('sha256').update(resentRawToken).digest('hex')
  );
  assert.strictEqual(invAfterResend.status, InvitationStatusEnum.PENDING);
  const auditResent = await prisma.auditLog.findFirst({
    where: { entity_id: invitationId, action: 'INVITATION_RESENT' },
  });
  assert.ok(auditResent);

  // Assert old token no longer verifies (invalidated by hash rotation)
  const oldTokenVerifyRes = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: rawToken });
  assert.strictEqual(oldTokenVerifyRes.status, 404);
  assert.strictEqual(oldTokenVerifyRes.body.error.code, 'INVITATION_NOT_FOUND');

  // [TEST 10 / AC-USR-01-11] Cross-tenant actor attempts to cancel or resend invitation
  console.log(
    '[TEST 10 / AC-USR-01-11] Cross-tenant actor attempts to cancel or resend invitation'
  );
  const crossResend = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitationId}/resend`)
    .set('Authorization', `Bearer ${otherToken}`);
  assert.strictEqual(crossResend.status, 403);
  assert.strictEqual(crossResend.body.error.code, 'FORBIDDEN');

  const crossCancel = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${invitationId}/cancel`)
    .set('Authorization', `Bearer ${otherToken}`);
  assert.strictEqual(crossCancel.status, 403);
  assert.strictEqual(crossCancel.body.error.code, 'FORBIDDEN');

  // Assert DB state after cross-tenant cancel/resend: invitation remains unaffected
  const crossDbCheck = await prisma.invitation.findUnique({ where: { id: invitationId } });
  assert.ok(crossDbCheck);
  assert.strictEqual(crossDbCheck.merchant_id, merchant.id);
  assert.strictEqual(crossDbCheck.status, InvitationStatusEnum.PENDING);
  const crossAudit = await prisma.auditLog.findFirst({
    where: { entity_id: invitationId, merchant_id: otherMerchant.id },
  });
  assert.strictEqual(crossAudit, null);

  // [TEST 11 / AC-USR-01-12] Public verification of valid unexpired token
  console.log('[TEST 11 / AC-USR-01-12] Public verification of valid invitation token');
  const verifyRes = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: resentRawToken });
  assert.strictEqual(verifyRes.status, 200);
  assert.strictEqual(verifyRes.body.data.valid, true);
  assert.strictEqual(verifyRes.body.data.tenant_name, merchant.name);
  // Minimal verify payload (Finding 10: BR-INV-06)
  assert.strictEqual(verifyRes.body.data.store_scopes, undefined);
  assert.strictEqual(verifyRes.body.data.warehouse_scopes, undefined);

  // [TEST 12 / AC-USR-01-13] Anti-enumeration on public verification
  console.log(
    '[TEST 12 / AC-USR-01-13] Public verification of invalid, expired, or cancelled token'
  );
  // 12a. Nonexistent token returns 404
  const notFoundRes = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: 'nonexistenttoken123456' });
  assert.strictEqual(notFoundRes.status, 404);
  assert.strictEqual(notFoundRes.body.error.code, 'INVITATION_NOT_FOUND');
  assert.strictEqual(notFoundRes.headers['cache-control'], 'no-store');
  assert.strictEqual(notFoundRes.headers['referrer-policy'], 'no-referrer');

  // Round 6 Finding 6: token is never accepted in the URL query string
  const legacyQueryRes = await request(app.getHttpServer()).get(
    `/api/v1/invitations/verify?token=${resentRawToken}`
  );
  assert.notStrictEqual(legacyQueryRes.status, 200, 'GET ?token= must not verify');
  assert.strictEqual(JSON.stringify(legacyQueryRes.body).includes('masked'), false);

  // 12b. Expired token returns identical canonical 404 (Finding 10)
  const expiredRawToken = `expired_${testSuffix}_${randomBytes(16).toString('hex')}`;
  const expiredTokenHash = createHash('sha256').update(expiredRawToken).digest('hex');
  await prisma.invitation.create({
    data: {
      merchant_id: merchant.id,
      email: `expired.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
      token_hash: expiredTokenHash,
      status: InvitationStatusEnum.EXPIRED,
      invited_by_user_id: owner.id,
      expires_at: new Date(Date.now() - 3600000), // 1 hour ago
    },
  });
  const expiredVerifyRes = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: expiredRawToken });
  assert.strictEqual(expiredVerifyRes.status, 404);
  assert.strictEqual(expiredVerifyRes.body.error.code, 'INVITATION_NOT_FOUND');

  // 12c. Cancelled token returns identical canonical 404 (Finding 10)
  const cancelledRawToken = `cancelled_${testSuffix}_${randomBytes(16).toString('hex')}`;
  const cancelledTokenHash = createHash('sha256').update(cancelledRawToken).digest('hex');
  await prisma.invitation.create({
    data: {
      merchant_id: merchant.id,
      email: `cancelled.${testSuffix}@shipde.vn`,
      role: RoleEnum.OPS_CSKH,
      token_hash: cancelledTokenHash,
      status: InvitationStatusEnum.CANCELLED,
      invited_by_user_id: owner.id,
      expires_at: new Date(Date.now() + 86400000),
    },
  });
  const cancelledVerifyRes = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: cancelledRawToken });
  assert.strictEqual(cancelledVerifyRes.status, 404);
  assert.strictEqual(cancelledVerifyRes.body.error.code, 'INVITATION_NOT_FOUND');

  // [TEST 13 / AC-USR-01-16] Recipient provides weak password during acceptance
  console.log('[TEST 13 / AC-USR-01-16] Recipient provides weak password during acceptance');
  const weakPassRes = await request(app.getHttpServer()).post('/api/v1/invitations/accept').send({
    token: resentRawToken,
    full_name: 'Operator Weak',
    password: 'weak',
  });
  assert.strictEqual(weakPassRes.status, 400);
  assert.strictEqual(weakPassRes.body.error.code, 'VALIDATION_ERROR');

  // Assert DB state after weak password rejection
  const invAfterWeak = await prisma.invitation.findUnique({ where: { id: invitationId } });
  assert.ok(invAfterWeak);
  assert.strictEqual(invAfterWeak.status, InvitationStatusEnum.PENDING);
  assert.strictEqual(invAfterWeak.consumed_at, null);
  const userAfterWeak = await prisma.user.findFirst({
    where: { email: `operator.${testSuffix}@shipde.vn` },
  });
  assert.strictEqual(userAfterWeak, null, 'No user should be created on weak password rejection');
  const auditWeak = await prisma.auditLog.findFirst({
    where: { entity_id: invitationId, action: 'INVITATION_ACCEPTED' },
  });
  assert.strictEqual(auditWeak, null, 'No acceptance audit log on weak password rejection');

  // [TEST 14 / AC-USR-01-14] Recipient accepts valid invitation
  console.log('[TEST 14 / AC-USR-01-14] Recipient accepts valid invitation');
  const acceptRes = await request(app.getHttpServer()).post('/api/v1/invitations/accept').send({
    token: resentRawToken,
    full_name: 'Nguyen Van Operator',
    password: 'StrongPassword123!',
    password_confirm: 'StrongPassword123!',
  });
  assert.strictEqual(acceptRes.status, 200);
  assert.strictEqual(acceptRes.body.data.status, 'ACTIVE');
  const newUserId = acceptRes.body.data.user_id;
  assert.ok(newUserId);

  // Assert user password hash and audit log in DB
  const userRow = await prisma.user.findFirst({
    where: { email: `operator.${testSuffix}@shipde.vn` },
  });
  assert.ok(userRow);
  assert.notStrictEqual(userRow.password_hash, 'StrongPassword123!');
  assert.ok(
    userRow.password_hash.startsWith('scrypt$'),
    'Password must have real scrypt$ hash prefix'
  );
  assert.deepStrictEqual(userRow.warehouse_scopes, ['wh-north']);
  assert.strictEqual(
    userRow.terms_accepted_at,
    null,
    'Terms not captured on form must not be recorded'
  );
  assert.strictEqual(userRow.terms_version, null);

  const acceptedInvite = await prisma.invitation.findUnique({
    where: { id: invitationId },
  });
  assert.ok(acceptedInvite);
  assert.strictEqual(acceptedInvite.status, 'ACCEPTED');
  assert.ok(acceptedInvite.consumed_at);

  const auditAccepted = await prisma.auditLog.findFirst({
    where: { entity_id: invitationId, action: 'INVITATION_ACCEPTED' },
  });
  assert.ok(auditAccepted);

  // [TEST 15 / AC-USR-01-15] Replay protection
  console.log('[TEST 15 / AC-USR-01-15] Recipient attempts to accept already-used token');
  const replayRes = await request(app.getHttpServer()).post('/api/v1/invitations/accept').send({
    token: resentRawToken,
    full_name: 'Nguyen Van Replay',
    password: 'StrongPassword123!',
    password_confirm: 'StrongPassword123!',
  });
  assert.strictEqual(replayRes.status, 400);
  assert.strictEqual(replayRes.body.error.code, 'INVITATION_ALREADY_USED');

  // [TEST 16 / AC-USR-01-10] Owner cancels a pending invitation
  console.log('[TEST 16 / AC-USR-01-10] Owner cancels a pending invitation');
  const phoneInviteId = phoneRes.body.data.id;
  // rawPhoneToken was captured from mockDeliveryAdapter during invite creation
  const cancelRes = await request(app.getHttpServer())
    .post(`/api/v1/invitations/${phoneInviteId}/cancel`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.strictEqual(cancelRes.status, 200);
  assert.strictEqual(cancelRes.body.data.status, 'CANCELLED');

  // Assert token invalidated: public verify with original token must return 404
  const verifyCancelled = await request(app.getHttpServer())
    .post('/api/v1/invitations/verify')
    .send({ token: rawPhoneToken });
  assert.strictEqual(verifyCancelled.status, 404);
  assert.strictEqual(verifyCancelled.body.error.code, 'INVITATION_NOT_FOUND');

  // Assert audit row
  const auditCancelled = await prisma.auditLog.findFirst({
    where: { entity_id: phoneInviteId, action: 'INVITATION_CANCELLED' },
  });
  assert.ok(auditCancelled);

  // [TEST 17 / AC-USR-01-17] Scope authorization enforcement on accepted user
  console.log('[TEST 17 / AC-USR-01-17] Scope authorization enforcement on accepted user');
  // Finding 5: Log in with the password set at accept (StrongPassword123!) rather than forging session
  const loginRes = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      identifier: `operator.${testSuffix}@shipde.vn`,
      password: 'StrongPassword123!',
    });
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginRes.body.data.status, 'AUTHENTICATED');
  const newUserToken = loginRes.body.data.access_token;
  assert.ok(newUserToken);

  // Access within assigned warehouse scope
  const authScopeRes = await request(app.getHttpServer())
    .post('/api/v1/users/check-scope')
    .set('Authorization', `Bearer ${newUserToken}`)
    .send({ warehouse_id: 'wh-north' });
  assert.strictEqual(authScopeRes.status, 200);
  assert.strictEqual(authScopeRes.body.data.authorized, true);

  // Access outside assigned warehouse scope -> 403 FORBIDDEN
  const unauthScopeRes = await request(app.getHttpServer())
    .post('/api/v1/users/check-scope')
    .set('Authorization', `Bearer ${newUserToken}`)
    .send({ warehouse_id: 'wh-south' });
  assert.strictEqual(unauthScopeRes.status, 403);
  assert.strictEqual(unauthScopeRes.body.error.code, 'FORBIDDEN');

  // [TEST 18 / Finding 1] Burst rate limiting returns 429 RATE_LIMITED (SECURITY-NFR)
  console.log('[TEST 18 / Finding 1] Rate limit burst returns 429 RATE_LIMITED');
  let burstRateLimited = false;
  for (let i = 0; i < 35; i++) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/invitations/verify')
      .send({ token: 'burst-rate-limit-check-token' })
      .set('X-Forwarded-For', '198.51.100.99');
    if (res.status === 429) {
      burstRateLimited = true;
      assert.strictEqual(res.body.error.code, 'RATE_LIMITED');
      break;
    }
  }
  assert.strictEqual(burstRateLimited, true, 'Rate limit burst must return 429 RATE_LIMITED');

  // [TEST 19 / Round 6 Finding 8] Authoritative partial unique pending index preserves BR-INV-08 in DB
  console.log(
    '[TEST 19 / Round 6 Finding 8] Partial unique pending indexes enforce BR-INV-08 idempotency'
  );
  const dbIndexes: Array<{ indexname: string; indexdef: string }> = await prisma.$queryRawUnsafe(
    "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'invitations' AND indexname LIKE 'invitations_merchant_pending_%'"
  );
  const emailIndex = dbIndexes.find(
    (x) => x.indexname === 'invitations_merchant_pending_email_unique'
  );
  const phoneIndex = dbIndexes.find(
    (x) => x.indexname === 'invitations_merchant_pending_phone_unique'
  );
  assert.ok(emailIndex, 'invitations_merchant_pending_email_unique must exist in PostgreSQL');
  assert.ok(
    emailIndex.indexdef.includes('PENDING'),
    'email index must be partial on PENDING status'
  );
  assert.ok(phoneIndex, 'invitations_merchant_pending_phone_unique must exist in PostgreSQL');
  assert.ok(
    phoneIndex.indexdef.includes('PENDING'),
    'phone index must be partial on PENDING status'
  );

  // Verify DB rejects duplicate pending insert with P2002
  const dupEmail = `dup_pending_${testSuffix}@example.com`;
  const invite1 = await prisma.invitation.create({
    data: {
      merchant_id: merchant.id,
      email: dupEmail,
      role: 'OPS_CSKH',
      token_hash: createHash('sha256').update(`tok1_${testSuffix}`).digest('hex'),
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000),
    },
  });
  await assert.rejects(
    () =>
      prisma.invitation.create({
        data: {
          merchant_id: merchant.id,
          email: dupEmail,
          role: 'OPS_CSKH',
          token_hash: createHash('sha256').update(`tok2_${testSuffix}`).digest('hex'),
          status: 'PENDING',
          expires_at: new Date(Date.now() + 86400000),
        },
      }),
    (err: any) => {
      assert.strictEqual(err.code, 'P2002');
      return true;
    }
  );

  // Transition first to EXPIRED -> now second insert succeeds
  await prisma.invitation.update({
    where: { id: invite1.id },
    data: { status: 'EXPIRED' },
  });
  const invite2 = await prisma.invitation.create({
    data: {
      merchant_id: merchant.id,
      email: dupEmail,
      role: 'OPS_CSKH',
      token_hash: createHash('sha256').update(`tok2_${testSuffix}`).digest('hex'),
      status: 'PENDING',
      expires_at: new Date(Date.now() + 86400000),
    },
  });
  assert.ok(invite2.id);

  // Clean up test rows
  await prisma.invitation.deleteMany({
    where: { id: { in: [invite1.id, invite2.id] } },
  });

  await app.close();
  console.log('================================================================');
  console.log('✅ ALL INVITATIONS SUPERTEST TESTS PASSED 100% (FEAT-USR-01)');
  console.log('================================================================');
}

test('FEAT-USR-01 — User Invitations HTTP Acceptance Supertest Suite (AC-USR-01-01 to AC-USR-01-18)', async () => {
  await runInvitationsSupertestSuite();
});
