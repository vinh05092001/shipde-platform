import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { SessionStatusEnum, RoleEnum } from '@prisma/client';
import { hashPassword } from '../auth/password.util';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';

function createSessionToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

async function runSessionSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - SESSION MANAGEMENT SUPERTEST SUITE (FEAT-AUTH-06)');
  console.log('================================================================');

  // Load .env
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
  if (!process.env.AUDIT_IDENTIFIER_HMAC_KEY) {
    process.env.AUDIT_IDENTIFIER_HMAC_KEY = 'test-audit-hmac-key-placeholder-32-chars';
  }

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
    AUTH_TOKEN_SECRET:
      process.env.AUTH_TOKEN_SECRET || 'test-secret-at-least-32-chars-long-enough-for-security',
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars-long-audit-hmac',
    TRUST_PROXY_HOPS: 1,
  };
  process.env.AUTH_TOKEN_SECRET = testConfig.AUTH_TOKEN_SECRET;

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
  const sessionService = app.get(SessionService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error(`Database must be reachable in CI at ${databaseUrl}`);
    }
    console.warn(`⚠️ PostgreSQL not reachable at ${databaseUrl}. Skipping session tests.`);
    await app.close();
    console.log('🎉 Session Supertest suite skipped offline safely!');
    return;
  }

  const testSuffix = Date.now().toString().slice(-6);
  const merchant = await prisma.merchant.create({
    data: {
      name: `Session Test Shop ${testSuffix}`,
      code: `SESSTEST${testSuffix}`,
      status: 'ACTIVE',
    },
  });
  const ownerPassword = 'SessionOwnerSecurePassword123!';
  const user = await prisma.user.create({
    data: {
      merchant_id: merchant.id,
      email: `session.owner.${testSuffix}@shipde.vn`,
      full_name: 'Session Test Owner',
      password_hash: await hashPassword(ownerPassword),
      role: RoleEnum.OPS_CSKH,
      status: 'ACTIVE',
    },
  });

  const merchant2 = await prisma.merchant.create({
    data: {
      name: `Session Test Shop 2 ${testSuffix}`,
      code: `SESS2TEST${testSuffix}`,
      status: 'ACTIVE',
    },
  });
  const user2 = await prisma.user.create({
    data: {
      merchant_id: merchant.id, // same merchant
      email: `session.user2.${testSuffix}@shipde.vn`,
      full_name: 'Session Test User 2',
      password_hash: 'test-hash-not-real',
      role: RoleEnum.OPS_CSKH,
      status: 'ACTIVE',
    },
  });
  const user3 = await prisma.user.create({
    data: {
      merchant_id: merchant2.id, // different merchant
      email: `session.user3.${testSuffix}@shipde.vn`,
      full_name: 'Session Test User 3',
      password_hash: 'test-hash-not-real',
      role: RoleEnum.OWNER,
      status: 'ACTIVE',
    },
  });

  const server = app.getHttpServer();

  try {
    // -------------------------------------------------------------------------
    // AC-SESS-01: Session Creation via Real Login Path and Service Entry Point
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-01] Active user logs in - session creation on real login path');
    const tok1 = { raw: '', hash: '' };

    const loginRes = await request(server)
      .post('/auth/login')
      .send({
        identifier: user.email,
        password: ownerPassword,
      })
      .expect(200);

    const loginToken = loginRes.body.data?.access_token || loginRes.body.data?.token;
    assert.ok(loginToken, 'Login must issue access token');
    const expectedHash = createHash('sha256').update(loginToken).digest('hex');

    const sess1 = await prisma.deviceSession.findFirst({
      where: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: expectedHash,
      },
    });

    assert.ok(sess1, 'DeviceSession row must exist in DB created by login path');
    assert.strictEqual(sess1.status, SessionStatusEnum.ACTIVE);
    assert.strictEqual(sess1.session_token_hash, expectedHash);
    assert.ok(sess1.last_active_at);
    const now1 = Date.now();
    const expiryDiffDays = (sess1.expires_at.getTime() - now1) / (1000 * 60 * 60 * 24);
    assert.ok(
      expiryDiffDays >= 89 && expiryDiffDays <= 91,
      'expires_at must be approximately 90 days in future'
    );
    const activeDiffMs = Math.abs(now1 - sess1.last_active_at.getTime());
    assert.ok(activeDiffMs < 60000, 'last_active_at must be recent');

    tok1.raw = loginToken;
    tok1.hash = expectedHash;

    // Verify SessionService.create entry point as well
    const svcRawToken = randomBytes(48).toString('hex');
    const svcExpectedHash = createHash('sha256').update(svcRawToken).digest('hex');
    const svcSess = await sessionService.create({
      userId: user.id,
      merchantId: merchant.id,
      token: svcRawToken,
      deviceId: 'service_created_device',
      deviceModel: 'Test Device',
    });
    assert.ok(svcSess.id);
    assert.strictEqual(svcSess.status, SessionStatusEnum.ACTIVE);
    assert.strictEqual(svcSess.session_token_hash, svcExpectedHash);
    assert.ok(svcSess.last_active_at);
    const svcExpiryDiff = (svcSess.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    assert.ok(svcExpiryDiff >= 89 && svcExpiryDiff <= 91);

    console.log(
      '  PASS: AC-SESS-01 Real login path & service entry point generate DeviceSession with ACTIVE status, SHA-256 hash, 90-day expiry, and last_active_at'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-02: List Sessions Scoped to User
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-02] Authenticated user requests session list');
    const res2 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(200);

    assert.ok(Array.isArray(res2.body.data), 'data must be an array');
    const listed2 = res2.body.data.find((s: any) => s.session_id === sess1.id);
    assert.ok(listed2, 'created session must appear in list');
    assert.strictEqual(listed2.session_token, undefined, 'raw token must NOT appear in list');
    assert.strictEqual(listed2.session_token_hash, undefined, 'token hash must NOT appear in list');
    assert.strictEqual(
      listed2.is_current,
      true,
      'caller session must be marked as is_current=true'
    );
    assert.ok(listed2.expires_at);
    console.log(
      '  PASS: AC-SESS-02 List returns sessions scoped to user with is_current=true and tokens omitted'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-03: User with only current session (Empty remote state)
    // -------------------------------------------------------------------------
    console.log(
      '[TEST AC-SESS-03] User with only current session requests list (Empty remote state)'
    );
    const tok3 = createSessionToken();
    const sessUser3 = await prisma.deviceSession.create({
      data: {
        user_id: user3.id,
        merchant_id: merchant2.id,
        session_token_hash: tok3.hash,
        device_id: 'device_user3_only',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res3 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tok3.raw}`)
      .expect(200);

    assert.strictEqual(res3.body.data.length, 1);
    assert.strictEqual(res3.body.data[0].session_id, sessUser3.id);
    assert.strictEqual(res3.body.data[0].is_current, true);
    const remoteSessions = res3.body.data.filter((s: any) => !s.is_current);
    assert.strictEqual(
      remoteSessions.length,
      0,
      'remote sessions count must be 0 for empty remote state'
    );
    console.log('  PASS: AC-SESS-03 User with only current session has 0 remote sessions');

    // -------------------------------------------------------------------------
    // AC-SESS-05: 30-day inactivity threshold
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-05] Session exceeds 30-day inactivity threshold');
    const tokInactive = createSessionToken();
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const sessInactive = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokInactive.hash,
        device_id: 'device_inactive_31d',
        status: SessionStatusEnum.ACTIVE,
        last_active_at: thirtyOneDaysAgo,
        expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });

    const res5List = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(200);
    const listedInactive = res5List.body.data.find((s: any) => s.session_id === sessInactive.id);
    assert.ok(listedInactive);
    assert.strictEqual(listedInactive.status, 'EXPIRED');

    const res5Auth = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tokInactive.raw}`)
      .expect(401);
    assert.strictEqual(res5Auth.body.error.code, 'SESSION_INVALID');
    assert.strictEqual(
      res5Auth.body.error.next_action,
      'LOGIN',
      'next_action must be LOGIN per AC-SESS-06'
    );
    console.log(
      '  PASS: AC-SESS-05 Inactive >30d evaluated as EXPIRED in list and rejected with 401 SESSION_INVALID'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-06: 90-day absolute lifetime expiry
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-06] Session exceeds 90-day absolute lifetime');
    const tokExpired = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokExpired.hash,
        device_id: 'device_expired_abs',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() - 1000),
      },
    });
    const res6 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tokExpired.raw}`)
      .expect(401);
    assert.strictEqual(res6.body.error.code, 'SESSION_INVALID');
    assert.strictEqual(
      res6.body.error.next_action,
      'LOGIN',
      'next_action must be LOGIN per AC-SESS-06'
    );
    console.log(
      '  PASS: AC-SESS-06 90-day absolute expired session rejected with 401 SESSION_INVALID and next_action'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-07: Owner revokes own active session
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-07] Owner revokes own active session');
    const tok7 = createSessionToken();
    const sess7 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok7.hash,
        device_id: 'device_to_revoke',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res7 = await request(server)
      .delete(`/api/v1/sessions/${sess7.id}`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(200);

    assert.strictEqual(res7.body.session_id, sess7.id);
    assert.strictEqual(res7.body.status, 'REVOKED');

    const dbSess7 = await prisma.deviceSession.findUnique({ where: { id: sess7.id } });
    assert.strictEqual(dbSess7?.status, SessionStatusEnum.REVOKED);
    assert.strictEqual(dbSess7?.is_revoked, true);
    assert.ok(dbSess7?.revoked_at);

    const audit7 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchant.id,
        action: 'SESSION_REVOKED',
        entity_id: sess7.id,
      },
    });
    assert.ok(audit7, 'SESSION_REVOKED audit log record must exist');
    console.log('  PASS: AC-SESS-07 Revoke updates session to REVOKED and creates audit record');

    // -------------------------------------------------------------------------
    // AC-SESS-08: Idempotent revocation
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-08] Owner revokes already revoked session (Idempotent / Recovery)');
    const auditCountBefore = await prisma.auditLog.count({
      where: { entity_id: sess7.id, action: 'SESSION_REVOKED' },
    });
    const revokedAtBefore = dbSess7!.revoked_at;

    const res8 = await request(server)
      .delete(`/api/v1/sessions/${sess7.id}`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(200);

    assert.strictEqual(res8.body.session_id, sess7.id);
    assert.strictEqual(res8.body.status, 'REVOKED');

    const dbSess8 = await prisma.deviceSession.findUnique({ where: { id: sess7.id } });
    assert.strictEqual(
      dbSess8?.revoked_at?.getTime(),
      revokedAtBefore?.getTime(),
      'revoked_at must not be mutated'
    );

    const auditCountAfter = await prisma.auditLog.count({
      where: { entity_id: sess7.id, action: 'SESSION_REVOKED' },
    });
    assert.strictEqual(auditCountAfter, auditCountBefore, 'no duplicated audit log record');
    console.log(
      '  PASS: AC-SESS-08 Idempotent revocation returns 200 with no duplicated audit or timestamp mutation'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-09: Cross-user revocation forbidden
    // -------------------------------------------------------------------------
    console.log(
      '[TEST AC-SESS-09] User attempts to revoke session of another user (Forbidden cross-user)'
    );
    const tokUser2 = createSessionToken();
    const sessUser2 = await prisma.deviceSession.create({
      data: {
        user_id: user2.id,
        merchant_id: merchant.id, // same merchant, different user
        session_token_hash: tokUser2.hash,
        device_id: 'device_user2',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const res9 = await request(server)
      .delete(`/api/v1/sessions/${sessUser2.id}`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);

    assert.strictEqual(res9.body.error.code, 'FORBIDDEN');
    const check9 = await prisma.deviceSession.findUnique({ where: { id: sessUser2.id } });
    assert.strictEqual(
      check9?.status,
      SessionStatusEnum.ACTIVE,
      'target session status remains unmodified'
    );
    console.log(
      '  PASS: AC-SESS-09 Cross-user revocation rejected with 403 FORBIDDEN and unmodified session'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-10: Cross-tenant revocation forbidden
    // -------------------------------------------------------------------------
    console.log(
      '[TEST AC-SESS-10] User attempts to revoke session of another merchant (Forbidden cross-tenant)'
    );
    const res10 = await request(server)
      .delete(`/api/v1/sessions/${sessUser3.id}`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);

    assert.strictEqual(res10.body.error.code, 'FORBIDDEN');
    const check10 = await prisma.deviceSession.findUnique({ where: { id: sessUser3.id } });
    assert.strictEqual(
      check10?.status,
      SessionStatusEnum.ACTIVE,
      'target session status remains unmodified'
    );
    console.log(
      '  PASS: AC-SESS-10 Cross-tenant revocation rejected with 403 FORBIDDEN and unmodified session'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-11: Nonexistent UUID
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-11] User requests revocation with nonexistent UUID');
    const res11 = await request(server)
      .delete('/api/v1/sessions/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(404);
    assert.strictEqual(res11.body.error.code, 'SESSION_NOT_FOUND');
    console.log('  PASS: AC-SESS-11 Nonexistent UUID returns canonical 404 SESSION_NOT_FOUND');

    // -------------------------------------------------------------------------
    // AC-SESS-12: Malformed UUID Full-Envelope Equality (BR-SESS-10)
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-12] User requests revocation with malformed ID');
    const res12 = await request(server)
      .delete('/api/v1/sessions/invalid-uuid-format')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(404);
    assert.strictEqual(res12.body.error.code, 'SESSION_NOT_FOUND');
    assert.deepStrictEqual(
      res12.body.error,
      res11.body.error,
      'Malformed ID and nonexistent UUID error envelopes must match identically'
    );
    assert.strictEqual(
      res12.body.error.details,
      undefined,
      'Error envelope must omit details to prevent identifier enumeration'
    );
    assert.strictEqual(
      JSON.stringify(res12.body).includes('invalid-uuid-format'),
      false,
      'Malformed ID must never be echoed anywhere in response body'
    );
    const stripMeta = (b: any) => {
      const { meta: _m, ...rest } = b;
      return rest;
    };
    assert.deepStrictEqual(
      stripMeta(res12.body),
      stripMeta(res11.body),
      'Full envelope without correlation meta must be identical between malformed and missing IDs'
    );
    console.log(
      '  PASS: AC-SESS-12 Malformed ID returns 404 SESSION_NOT_FOUND full-envelope identical to nonexistent UUID'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-13: Heartbeat on current session
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-13] Current active session sends heartbeat');
    const res13 = await request(server)
      .patch(`/api/v1/sessions/${sess1.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(200);
    assert.strictEqual(res13.body.session_id, sess1.id);
    assert.ok(res13.body.last_active_at);
    console.log('  PASS: AC-SESS-13 Heartbeat updates last_active_at');

    // -------------------------------------------------------------------------
    // AC-SESS-14: Heartbeat on non-current session forbidden and timestamp not updated
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-14] User sends heartbeat for non-current session (Forbidden)');
    const tokOther = createSessionToken();
    const sessOther = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokOther.hash,
        device_id: 'other_active_device_for_user',
        status: SessionStatusEnum.ACTIVE,
        last_active_at: new Date(Date.now() - 3600 * 1000), // 1 hour ago
        expires_at: new Date(Date.now() + 80 * 24 * 60 * 60 * 1000),
      },
    });
    const initialLastActiveAt = sessOther.last_active_at.getTime();

    const res14 = await request(server)
      .patch(`/api/v1/sessions/${sessOther.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);
    assert.strictEqual(res14.body.error.code, 'FORBIDDEN');
    assert.strictEqual(
      res14.body.error.message,
      'Chỉ có thể cập nhật trạng thái hoạt động cho phiên hiện tại'
    );

    // Verify last_active_at timestamp was NOT modified in DB
    const checkSessOther = await prisma.deviceSession.findUnique({
      where: { id: sessOther.id },
    });
    assert.ok(checkSessOther);
    assert.strictEqual(
      checkSessOther.last_active_at.getTime(),
      initialLastActiveAt,
      'last_active_at timestamp must not be updated for non-current session'
    );
    console.log(
      '  PASS: AC-SESS-14 Heartbeat for non-current session returns 403 FORBIDDEN and timestamp remains unchanged'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-15: Heartbeat on inactive / time-expired session over HTTP
    // -------------------------------------------------------------------------
    console.log(
      '[TEST AC-SESS-15] User sends heartbeat for inactive and time-expired sessions over HTTP'
    );
    // Case 1: Inactive (REVOKED) session over HTTP
    const tokInactiveH = createSessionToken();
    const sessInactiveH = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokInactiveH.hash,
        device_id: 'inactive_heartbeat_device',
        status: SessionStatusEnum.REVOKED,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const res15Inactive = await request(server)
      .patch(`/api/v1/sessions/${sessInactiveH.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);
    assert.strictEqual(
      res15Inactive.body.error.code,
      'SESSION_NOT_ACTIVE',
      'Revoked session heartbeat must return 403 SESSION_NOT_ACTIVE'
    );

    // Case 2: Time-expired session (> 30 days inactivity) over HTTP
    const tokTimeExpired = createSessionToken();
    const sessTimeExpired = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokTimeExpired.hash,
        device_id: 'time_expired_heartbeat_device',
        status: SessionStatusEnum.ACTIVE,
        last_active_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days inactive
        expires_at: new Date(Date.now() + 55 * 24 * 60 * 60 * 1000),
      },
    });

    const res15Expired = await request(server)
      .patch(`/api/v1/sessions/${sessTimeExpired.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);
    assert.strictEqual(
      res15Expired.body.error.code,
      'SESSION_NOT_ACTIVE',
      'Time-expired session heartbeat must return 403 SESSION_NOT_ACTIVE'
    );

    // Verify time-expired row was updated to EXPIRED status in DB (BR-SESS-03)
    const dbSessTimeExpired = await prisma.deviceSession.findUnique({
      where: { id: sessTimeExpired.id },
    });
    assert.strictEqual(
      dbSessTimeExpired?.status,
      SessionStatusEnum.EXPIRED,
      'Time-expired session must be persisted as EXPIRED in DB'
    );

    console.log(
      '  PASS: AC-SESS-15 Inactive and time-expired sessions return 403 SESSION_NOT_ACTIVE over HTTP and transition to EXPIRED in DB'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-16: Revoke-all excluding current
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-16] User revokes all sessions excluding current');
    const tokR1 = createSessionToken();
    const tokR2 = createSessionToken();
    const sessR1 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokR1.hash,
        device_id: 'dev_remote_1',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const sessR2 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokR2.hash,
        device_id: 'dev_remote_2',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const callerOtherActiveCountBefore = await prisma.deviceSession.count({
      where: {
        user_id: user.id,
        merchant_id: merchant.id,
        status: SessionStatusEnum.ACTIVE,
        id: { not: sess1.id },
      },
    });
    const user2ActiveCountBefore = await prisma.deviceSession.count({
      where: { user_id: user2.id, status: SessionStatusEnum.ACTIVE },
    });
    const revokeAllStartTime = new Date();

    const res16 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .send({ include_current: false })
      .expect(200);

    assert.strictEqual(
      res16.body.revoked_count,
      callerOtherActiveCountBefore,
      'revoked_count must exactly match caller other active sessions count'
    );

    // Verify remote rows were transitioned to REVOKED in database
    const dbR1 = await prisma.deviceSession.findUnique({ where: { id: sessR1.id } });
    const dbR2 = await prisma.deviceSession.findUnique({ where: { id: sessR2.id } });
    assert.strictEqual(dbR1?.status, SessionStatusEnum.REVOKED, 'sessR1 must be REVOKED');
    assert.strictEqual(dbR1?.is_revoked, true, 'sessR1 is_revoked must be true');
    assert.ok(dbR1?.revoked_at, 'sessR1 revoked_at must be populated');
    assert.strictEqual(dbR1?.revoked_by, user.id, 'sessR1 revoked_by must be caller user ID');

    assert.strictEqual(dbR2?.status, SessionStatusEnum.REVOKED, 'sessR2 must be REVOKED');
    assert.strictEqual(dbR2?.is_revoked, true, 'sessR2 is_revoked must be true');
    assert.ok(dbR2?.revoked_at, 'sessR2 revoked_at must be populated');
    assert.strictEqual(dbR2?.revoked_by, user.id, 'sessR2 revoked_by must be caller user ID');

    // Verify current session sess1 remains ACTIVE
    const checkCurrent16 = await prisma.deviceSession.findUnique({ where: { id: sess1.id } });
    assert.strictEqual(
      checkCurrent16?.status,
      SessionStatusEnum.ACTIVE,
      'current session must remain ACTIVE'
    );
    assert.strictEqual(checkCurrent16?.is_revoked, false);

    // Verify other user's active sessions were not revoked
    const user2ActiveCountAfter = await prisma.deviceSession.count({
      where: { user_id: user2.id, status: SessionStatusEnum.ACTIVE },
    });
    assert.strictEqual(
      user2ActiveCountAfter,
      user2ActiveCountBefore,
      'other user sessions must not be affected by caller revoke-all'
    );

    // Verify exact audit log for this operation
    const audit16 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchant.id,
        user_id: user.id,
        action: 'SESSIONS_REVOKED_ALL',
        created_at: { gte: revokeAllStartTime },
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(audit16, 'SESSIONS_REVOKED_ALL audit log created by this call must exist');
    const details16 = audit16.new_value as any;
    assert.strictEqual(
      details16?.revoked_count,
      callerOtherActiveCountBefore,
      'Audit log revoked_count must match caller other active sessions count'
    );
    assert.strictEqual(
      details16?.include_current,
      false,
      'Audit log include_current must be false'
    );

    console.log(
      '  PASS: AC-SESS-16 Revoke all excluding current matches exact active count, revokes remote rows, preserves current and tenant sessions, and logs audit'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-17: Revoke-all including current
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-17] User revokes all sessions including current');
    const tokToRevokeAll = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokToRevokeAll.hash,
        device_id: 'dev_include_current',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const res17 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tokToRevokeAll.raw}`)
      .send({ include_current: true })
      .expect(200);

    assert.ok(res17.body.revoked_count >= 1);

    const res17Post = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tokToRevokeAll.raw}`)
      .expect(401);
    assert.strictEqual(res17Post.body.error.code, 'SESSION_INVALID');
    assert.strictEqual(
      res17Post.body.error.next_action,
      'LOGIN',
      'next_action must be LOGIN after revoking current session'
    );
    console.log(
      '  PASS: AC-SESS-17 Revoke all including current terminates caller session (subsequent request 401)'
    );

    // -------------------------------------------------------------------------
    // AC-SESS-18: Revoke all when none active
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-18] User revokes all sessions when none active');
    const tok18 = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok18.hash,
        device_id: 'dev_caller_18',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tok18.raw}`)
      .send({ include_current: false });

    const res18 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tok18.raw}`)
      .send({ include_current: false })
      .expect(200);

    assert.strictEqual(res18.body.revoked_count, 0);
    assert.strictEqual(res18.body.message, 'Không có phiên nào cần thu hồi');
    console.log('  PASS: AC-SESS-18 Revoke all when none active returns revoked_count: 0');

    // -------------------------------------------------------------------------
    // AC-SESS-19: Unauthenticated request rejected
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-19] Request sent without Authorization header');
    const res19 = await request(server).get('/api/v1/sessions').expect(401);
    assert.strictEqual(res19.body.error.code, 'UNAUTHENTICATED');
    console.log('  PASS: AC-SESS-19 Unauthenticated request returns 401 UNAUTHENTICATED');

    // -------------------------------------------------------------------------
    // AC-SESS-20: Audit rollback on failure
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-20] Audit logging fails during revocation (Error rollback)');
    const tok20 = createSessionToken();
    const sess20 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok20.hash,
        device_id: 'audit_rollback_device',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const originalLogAudit = (sessionService as any).logAudit;
    const stdoutLogs: string[] = [];
    const stderrLogs: string[] = [];
    const origConsoleLog = console.log;
    const origConsoleError = console.error;

    console.log = (...args: any[]) => {
      stdoutLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      origConsoleLog(...args);
    };
    console.error = (...args: any[]) => {
      stderrLogs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      origConsoleError(...args);
    };

    (sessionService as any).logAudit = async () => {
      throw new Error('Simulated audit persistence failure');
    };

    try {
      await request(server)
        .delete(`/api/v1/sessions/${sess20.id}`)
        .set('Authorization', `Bearer ${tok18.raw}`)
        .expect(500);

      const check20 = await prisma.deviceSession.findUnique({ where: { id: sess20.id } });
      assert.strictEqual(
        check20?.status,
        SessionStatusEnum.ACTIVE,
        'Session must remain ACTIVE after audit rollback'
      );

      // Verify stdout did NOT record a successful audit
      const leakedSuccessAudit = stdoutLogs.some(
        (l) => l.includes('AUDIT: SESSION_REVOKED') && l.includes(sess20.id)
      );
      assert.strictEqual(
        leakedSuccessAudit,
        false,
        'stdout must not record a successful audit when transaction rolls back'
      );

      // Verify rollback was explicitly recorded in stderr
      const loggedRollback = stderrLogs.some(
        (l) => l.includes('AUDIT_ROLLBACK') && l.includes(sess20.id)
      );
      assert.ok(
        loggedRollback,
        'stderr must explicitly record AUDIT_ROLLBACK when transaction fails'
      );

      console.log(
        '  PASS: AC-SESS-20 Transaction rolls back on audit failure; session remains ACTIVE and rollback is logged explicitly'
      );
    } finally {
      (sessionService as any).logAudit = originalLogAudit;
      console.log = origConsoleLog;
      console.error = origConsoleError;
    }

    // -------------------------------------------------------------------------
    // AC-SESS-21: Security inspection of API responses and logs
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-21] Security inspection of API responses and logs');
    const audit21 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchant.id,
        action: 'SESSIONS_REVOKED_ALL',
        ip_address: { not: null },
      },
    });
    assert.ok(audit21, 'Audit record for SESSIONS_REVOKED_ALL with non-null ip_address must exist');
    assert.ok(audit21.ip_address, 'Audit IP must be non-null');
    assert.match(
      audit21.ip_address,
      /^[0-9a-f]{64}$/i,
      'Audit IP must be a 64-char HMAC-SHA256 hex string'
    );
    assert.doesNotMatch(
      audit21.ip_address,
      /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
      'Audit IP must not be raw IPv4'
    );

    // Verify keyed pseudonymization against known input (Finding 6)
    const testRawIp = '198.51.100.42';
    const knownSession = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: createSessionToken().hash,
        device_id: 'device_keyed_hmac_test',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    await sessionService.revoke(
      knownSession.id,
      user.id,
      merchant.id,
      'corr-test-keyed-hmac',
      'Test keyed hmac verification',
      testRawIp
    );

    const auditKeyed = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchant.id,
        action: 'SESSION_REVOKED',
        entity_id: knownSession.id,
      },
    });
    assert.ok(auditKeyed, 'Audit record for SESSION_REVOKED must exist');
    assert.ok(auditKeyed.ip_address, 'Keyed audit IP must not be null');

    const { createHmac } = await import('node:crypto');
    const configuredKey =
      process.env.AUDIT_IDENTIFIER_HMAC_KEY || 'test-audit-hmac-key-placeholder-32-chars';
    const expectedPseudonym = createHmac('sha256', configuredKey).update(testRawIp).digest('hex');

    assert.strictEqual(
      auditKeyed.ip_address,
      expectedPseudonym,
      'Audit IP pseudonym must match HMAC-SHA256 keyed with AUDIT_IDENTIFIER_HMAC_KEY'
    );

    const unkeyedSha256 = createHash('sha256').update(testRawIp).digest('hex');
    assert.notStrictEqual(
      auditKeyed.ip_address,
      unkeyedSha256,
      'Audit IP must not use unkeyed plain SHA-256'
    );

    // Verify concurrency safety: simultaneous revocations insert exactly 1 audit record (Finding 3)
    const sessConcurrent = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: createSessionToken().hash,
        device_id: 'device_concurrent_revoke_test',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const [resConc1, resConc2] = await Promise.all([
      sessionService.revoke(
        sessConcurrent.id,
        user.id,
        merchant.id,
        'corr-conc-1',
        'Concurrent revoke 1',
        testRawIp
      ),
      sessionService.revoke(
        sessConcurrent.id,
        user.id,
        merchant.id,
        'corr-conc-2',
        'Concurrent revoke 2',
        testRawIp
      ),
    ]);
    assert.strictEqual(resConc1.status, SessionStatusEnum.REVOKED);
    assert.strictEqual(resConc2.status, SessionStatusEnum.REVOKED);

    const concurrentAudits = await prisma.auditLog.count({
      where: {
        merchant_id: merchant.id,
        action: 'SESSION_REVOKED',
        entity_id: sessConcurrent.id,
      },
    });
    assert.strictEqual(
      concurrentAudits,
      1,
      'Concurrent revocations must insert exactly ONE audit record (no duplicate audits)'
    );

    // Verify fail-closed behavior when AUDIT_IDENTIFIER_HMAC_KEY is absent (Finding 4)
    const savedKey = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
    try {
      delete process.env.AUDIT_IDENTIFIER_HMAC_KEY;
      const sessFailClosed = await prisma.deviceSession.create({
        data: {
          user_id: user.id,
          merchant_id: merchant.id,
          session_token_hash: createSessionToken().hash,
          device_id: 'device_fail_closed_test',
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });

      await assert.rejects(
        async () => {
          await sessionService.revoke(
            sessFailClosed.id,
            user.id,
            merchant.id,
            'corr-fail-closed',
            'Must fail closed',
            testRawIp
          );
        },
        /AUDIT_IDENTIFIER_HMAC_KEY is required for IP pseudonymization/,
        'Must fail closed when AUDIT_IDENTIFIER_HMAC_KEY is absent'
      );

      const sessAfterAbort = await prisma.deviceSession.findUnique({
        where: { id: sessFailClosed.id },
      });
      assert.strictEqual(
        sessAfterAbort?.status,
        SessionStatusEnum.ACTIVE,
        'Session must remain ACTIVE after fail-closed transaction abort'
      );
    } finally {
      process.env.AUDIT_IDENTIFIER_HMAC_KEY = savedKey;
    }

    const res21 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tok18.raw}`)
      .expect(200);
    const bodyStr = JSON.stringify(res21.body);
    assert.strictEqual(
      bodyStr.includes('session_token_hash'),
      false,
      'Response body must not contain session_token_hash'
    );
    assert.strictEqual(
      bodyStr.includes(tok18.raw),
      false,
      'Response body must not contain raw token'
    );
    console.log(
      '  PASS: AC-SESS-21 Zero secrets disclosed; audit log IP is HMAC-SHA256 pseudonymized'
    );

    console.log('================================================================');
    console.log('ALL SESSION TESTS (AC-SESS-01..21) PASSED');
    console.log('================================================================');
  } finally {
    try {
      await prisma.deviceSession.deleteMany({
        where: { merchant_id: { in: [merchant.id, merchant2.id] } },
      });
      await prisma.auditLog.deleteMany({
        where: { merchant_id: { in: [merchant.id, merchant2.id] } },
      });
      await prisma.user.deleteMany({ where: { merchant_id: { in: [merchant.id, merchant2.id] } } });
      await prisma.merchant.deleteMany({ where: { id: { in: [merchant.id, merchant2.id] } } });
    } catch {
      // Ignore cleanup errors
    }
    await app.close();
  }
}

runSessionSupertestSuite().catch((err) => {
  console.error('Session test suite failed:', err);
  process.exit(1);
});
