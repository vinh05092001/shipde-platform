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
    // `code` is required and unique on Merchant, and the fixture omitted it:
    // prisma.merchant.create() threw PrismaClientValidationError and the whole
    // session suite failed before its first assertion. The suffix is already
    // unique per run, so it keeps parallel runs from colliding on the index.
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
      // `role` has no default on User, so Prisma refuses the insert without it.
      // OWNER is what the suite needs: every session endpoint it exercises is
      // scoped to the caller's own store, and an OWNER is the actor the
      // acceptance criteria describe.
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
  let createdSessionId: string;
  let createdToken: string;

  try {
    // AC-SESS-01: Create a session via the service directly (bypass guard)
    console.log('[TEST 1 / AC-SESS-01] Create a session');
    const tok1 = createSessionToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const sess1 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok1.hash,
        device_id: 'browser_chrome_desktop',
        device_model: 'Chrome 128',
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        status: SessionStatusEnum.ACTIVE,
        expires_at: expiresAt,
      },
    });
    createdSessionId = sess1.id;
    createdToken = tok1.raw;
    assert.ok(createdSessionId);
    console.log('  PASS: AC-SESS-01 Session created in DB');

    // AC-SESS-02: List sessions with Bearer token
    console.log('[TEST 2 / AC-SESS-02] List sessions');
    const res2 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${createdToken}`)
      .expect(200);

    assert.ok(Array.isArray(res2.body.data), 'data must be an array');
    assert.ok(res2.body.meta.total >= 1, 'at least 1 session');
    const listed = res2.body.data.find((s: any) => s.session_id === createdSessionId);
    assert.ok(listed, 'created session must appear in list');
    assert.strictEqual(listed.session_token, undefined, 'token must NOT appear in list');
    assert.ok(listed.is_current, 'should be marked as current');
    assert.ok(listed.expires_at);
    console.log('  PASS: AC-SESS-02 List returns sessions without token');

    // AC-SESS-03: Revoke a session
    console.log('[TEST 3 / AC-SESS-03] Revoke a session');
    const res3 = await request(server)
      .delete(`/api/v1/sessions/${createdSessionId}`)
      .set('Authorization', `Bearer ${createdToken}`)
      .expect(200);

    assert.strictEqual(res3.body.session_id, createdSessionId);
    assert.strictEqual(res3.body.status, 'REVOKED');
    assert.ok(res3.body.message.includes('thu hồi'));
    console.log('  PASS: AC-SESS-03 Session revoked');

    // AC-SESS-04: Revoke already-revoked is idempotent
    // The session from AC-SESS-03 is now REVOKED, so we need a fresh active
    // token to authenticate this request. The guard only passes ACTIVE sessions.
    console.log('[TEST 4 / AC-SESS-04] Idempotent revoke');
    const tok4 = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok4.hash,
        device_id: 'test_device_4_idempotent',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res4 = await request(server)
      .delete(`/api/v1/sessions/${createdSessionId}`)
      .set('Authorization', `Bearer ${tok4.raw}`)
      .expect(200);

    assert.strictEqual(res4.body.status, 'REVOKED');
    console.log('  PASS: AC-SESS-04 Idempotent revoke');

    // AC-SESS-05: Revoke nonexistent session returns 404
    console.log('[TEST 5 / AC-SESS-05] Revoke nonexistent returns 404');
    // Create a fresh session to use as auth token (old one is revoked)
    const tok5 = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok5.hash,
        device_id: 'test_device_5',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res5 = await request(server)
      .delete('/api/v1/sessions/nonexistent-session-id')
      .set('Authorization', `Bearer ${tok5.raw}`)
      .expect(404);

    assert.strictEqual(res5.body.error.code, 'SESSION_NOT_FOUND');
    console.log('  PASS: AC-SESS-05 Not found returns canonical error');

    // AC-SESS-06: Heartbeat
    console.log('[TEST 6 / AC-SESS-06] Heartbeat');
    const tok6 = createSessionToken();
    const sess6 = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok6.hash,
        device_id: 'mobile_ios',
        device_model: 'iPhone 16',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res6 = await request(server)
      .patch(`/api/v1/sessions/${sess6.id}/heartbeat`)
      .set('Authorization', `Bearer ${tok6.raw}`)
      .expect(200);

    assert.strictEqual(res6.body.session_id, sess6.id);
    assert.ok(res6.body.last_active_at);
    console.log('  PASS: AC-SESS-06 Heartbeat updated');

    // AC-SESS-07: Revoke-all
    console.log('[TEST 7 / AC-SESS-07] Revoke all sessions');
    // Create a new session for revoke-all auth
    const tok7 = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tok7.hash,
        device_id: 'tablet_android',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const res7 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tok7.raw}`)
      .send({ include_current: false })
      .expect(200);

    assert.ok(res7.body.revoked_count >= 1);
    assert.ok(res7.body.message.includes('thu hồi'));
    console.log(`  PASS: AC-SESS-07 Revoke-all: ${res7.body.revoked_count} sessions`);

    // AC-SESS-08: Missing Bearer token returns 401
    console.log('[TEST 8 / AC-SESS-08] Missing token returns 401');
    const res8 = await request(server).get('/api/v1/sessions').expect(401);
    assert.strictEqual(res8.body.error.code, 'UNAUTHENTICATED');
    console.log('  PASS: AC-SESS-08 Missing token rejected');

    console.log('[TEST 9] Cross-user and cross-tenant attempts get 403');
    const tokUser2 = createSessionToken();
    const tokUser3 = createSessionToken();
    const sess2 = await prisma.deviceSession.create({
      data: {
        user_id: user2.id,
        merchant_id: merchant.id,
        session_token_hash: tokUser2.hash,
        device_id: 'dev2',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    const sess3 = await prisma.deviceSession.create({
      data: {
        user_id: user3.id,
        merchant_id: merchant2.id,
        session_token_hash: tokUser3.hash,
        device_id: 'dev3',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const res9a = await request(server)
      .delete(`/api/v1/sessions/${sess2.id}`)
      .set('Authorization', `Bearer ${createdToken}`)
      .expect(403);
    assert.strictEqual(res9a.body.error.code, 'FORBIDDEN');
    const res9b = await request(server)
      .delete(`/api/v1/sessions/${sess3.id}`)
      .set('Authorization', `Bearer ${createdToken}`)
      .expect(403);
    assert.strictEqual(res9b.body.error.code, 'FORBIDDEN');
    console.log('  PASS: Cross-user and cross-tenant deleted rejected');

    console.log('[TEST 10] Heartbeat on a non-current session gets 403');
    // tokUser2 has 1 session (sess2). Let's create another one for them.
    const tokUser2b = createSessionToken();
    const sess2b = await prisma.deviceSession.create({
      data: {
        user_id: user2.id,
        merchant_id: merchant.id,
        session_token_hash: tokUser2b.hash,
        device_id: 'dev2b',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    // Using tokUser2 (current session = sess2), trying to heartbeat sess2b
    const res10 = await request(server)
      .patch(`/api/v1/sessions/${sess2b.id}/heartbeat`)
      .set('Authorization', `Bearer ${tokUser2.raw}`)
      .expect(403);
    assert.strictEqual(res10.body.error.code, 'FORBIDDEN');
    console.log('  PASS: Heartbeat on non-current session rejected');

    console.log('[TEST 11] Include current = true behavior');
    const res11 = await request(server)
      .post('/api/v1/sessions/revoke-all')
      .set('Authorization', `Bearer ${tokUser2.raw}`)
      .send({ include_current: true })
      .expect(200);
    assert.strictEqual(res11.body.revoked_count, 2);
    console.log('  PASS: include_current=true revokes all');

    console.log('[TEST 12] Revoked/Expired session rejected');
    // tokUser2 was just revoked, so it should be rejected
    const res12 = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tokUser2.raw}`)
      .expect(401);
    assert.strictEqual(res12.body.error.code, 'UNAUTHENTICATED');

    // Create an expired session
    const tokExpired = createSessionToken();
    await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokExpired.hash,
        device_id: 'exp',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() - 1000),
      },
    });
    const res12b = await request(server)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${tokExpired.raw}`)
      .expect(401);
    assert.strictEqual(res12b.body.error.code, 'UNAUTHENTICATED');
    console.log('  PASS: Expired and revoked sessions rejected');

    console.log('[TEST 13] Audit failure fails the operation');
    const tokAudit = createSessionToken();
    const sessAudit = await prisma.deviceSession.create({
      data: {
        user_id: user.id,
        merchant_id: merchant.id,
        session_token_hash: tokAudit.hash,
        device_id: 'audit-test',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });

    const originalAuditCreate = prisma.auditLog.create;
    let auditCreateCalled = false;
    prisma.auditLog.create = async () => {
      auditCreateCalled = true;
      throw new Error('Simulated audit failure');
    };

    try {
      // 1. Transactional path: Trying to revoke the active session should fail
      const res13 = await request(server)
        .delete(`/api/v1/sessions/${sessAudit.id}`)
        .set('Authorization', `Bearer ${tokAudit.raw}`)
        .expect(500);

      assert.ok(auditCreateCalled, 'auditLog.create should have been called');

      // Verify the session was NOT revoked due to transaction rollback
      const checkSess = await prisma.deviceSession.findUnique({ where: { id: sessAudit.id } });
      assert.strictEqual(
        checkSess?.status,
        SessionStatusEnum.ACTIVE,
        'Session should remain ACTIVE after failed audit'
      );

      // 2. Non-transactional path (idempotent revoke)
      // Manually revoke the session first (bypassing the mock)
      prisma.auditLog.create = originalAuditCreate;
      await prisma.deviceSession.update({
        where: { id: sessAudit.id },
        data: { status: SessionStatusEnum.REVOKED },
      });
      prisma.auditLog.create = async () => {
        auditCreateCalled = true;
        throw new Error('Simulated audit failure on idempotent path');
      };

      auditCreateCalled = false;
      // Now do an idempotent revoke, which should fail because audit fails and we don't swallow
      // We need a fresh active token to auth
      const tokIdemp = createSessionToken();
      await prisma.deviceSession.create({
        data: {
          user_id: user.id,
          merchant_id: merchant.id,
          session_token_hash: tokIdemp.hash,
          device_id: 'audit-idemp',
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        },
      });

      await request(server)
        .delete(`/api/v1/sessions/${sessAudit.id}`)
        .set('Authorization', `Bearer ${tokIdemp.raw}`)
        .expect(500);

      assert.ok(auditCreateCalled, 'auditLog.create should have been called on idempotent path');

      console.log('  PASS: Audit failure aborted the operation and rolled back');
    } finally {
      prisma.auditLog.create = originalAuditCreate;
    }

    console.log('================================================================');
    console.log('ALL SESSION TESTS PASSED');
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
