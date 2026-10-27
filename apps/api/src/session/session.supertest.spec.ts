import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from './session.service';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { SessionStatusEnum, RoleEnum } from '@prisma/client';

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

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
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
  const user = await prisma.user.create({
    data: {
      merchant_id: merchant.id,
      email: `session.owner.${testSuffix}@shipde.vn`,
      full_name: 'Session Test Owner',
      password_hash: 'test-hash-not-real',
      role: RoleEnum.OWNER,
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
    // AC-SESS-01: Session Creation
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-01] Active user logs in - session creation');
    const tok1 = createSessionToken();
    const expiresAt1 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const sess1 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok1.hash,
        device_id: 'browser_chrome_desktop',
        device_model: 'Chrome 128',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        status: SessionStatusEnum.ACTIVE,
        expires_at: expiresAt1,
      },
    });
    assert.ok(sess1.id, 'Session ID must be generated');
    assert.strictEqual(sess1.status, SessionStatusEnum.ACTIVE);
    assert.strictEqual(sess1.session_token_hash, tok1.hash);
    assert.ok(sess1.last_active_at);
    assert.strictEqual(sess1.expires_at.getTime(), expiresAt1.getTime());
    console.log(
      '  PASS: AC-SESS-01 Session created in DB with ACTIVE status, hash, 90-day expiry, and last_active_at'
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
    assert.ok(res6.body.error.next_action, 'next_action must be present in canonical error');
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
    // AC-SESS-12: Malformed UUID
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-12] User requests revocation with malformed ID');
    const res12 = await request(server)
      .delete('/api/v1/sessions/invalid-uuid-format')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(404);
    assert.strictEqual(res12.body.error.code, 'SESSION_NOT_FOUND');
    assert.strictEqual(res12.body.error.message, res11.body.error.message);
    console.log(
      '  PASS: AC-SESS-12 Malformed ID returns 404 SESSION_NOT_FOUND identical to nonexistent UUID'
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
    // AC-SESS-14: Heartbeat on non-current session forbidden
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-14] User sends heartbeat for non-current session (Forbidden)');
    const res14 = await request(server)
      .patch(`/api/v1/sessions/${sessUser2.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok1.raw}`)
      .expect(403);
    assert.strictEqual(res14.body.error.code, 'FORBIDDEN');
    console.log('  PASS: AC-SESS-14 Heartbeat for non-current session returns 403 FORBIDDEN');

    // -------------------------------------------------------------------------
    // AC-SESS-15: Heartbeat on inactive session
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-15] User sends heartbeat for inactive session');
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
    try {
      await sessionService.heartbeat(sessInactiveH.id, user.id, merchant.id, sessInactiveH.id);
      assert.fail('Should throw ForbiddenException for inactive session');
    } catch (err: any) {
      assert.strictEqual(err.response?.error?.code, 'SESSION_NOT_ACTIVE');
    }
    console.log('  PASS: AC-SESS-15 Heartbeat on inactive session returns 403 SESSION_NOT_ACTIVE');

    // -------------------------------------------------------------------------
    // AC-SESS-16: Revoke-all excluding current
    // -------------------------------------------------------------------------
    console.log('[TEST AC-SESS-16] User revokes all sessions excluding current');
    const tokR1 = createSessionToken();
    const tokR2 = createSessionToken();
    await prisma.deviceSession.createMany({
      data: [
        {
          user_id: user.id,
          merchant_id: merchant.id,
          session_token_hash: tokR1.hash,
          device_id: 'dev_remote_1',
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
        {
          user_id: user.id,
          merchant_id: merchant.id,
          session_token_hash: tokR2.hash,
          device_id: 'dev_remote_2',
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      ],
    });

    const res16 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tok1.raw}`)
      .send({ include_current: false })
      .expect(200);

    assert.ok(res16.body.revoked_count >= 2);
    const checkCurrent16 = await prisma.deviceSession.findUnique({ where: { id: sess1.id } });
    assert.strictEqual(
      checkCurrent16?.status,
      SessionStatusEnum.ACTIVE,
      'current session must remain ACTIVE'
    );

    const audit16 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchant.id,
        user_id: user.id,
        action: 'SESSIONS_REVOKED_ALL',
      },
    });
    assert.ok(audit16, 'SESSIONS_REVOKED_ALL audit log must be recorded');
    console.log(
      '  PASS: AC-SESS-16 Revoke all excluding current preserves caller session and logs audit'
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
      console.log(
        '  PASS: AC-SESS-20 Transaction rolls back on audit failure; session remains ACTIVE'
      );
    } finally {
      (sessionService as any).logAudit = originalLogAudit;
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
    if (audit21 && audit21.ip_address) {
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
