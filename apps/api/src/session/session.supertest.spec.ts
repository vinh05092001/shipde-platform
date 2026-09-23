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
import { SessionStatusEnum } from '@prisma/client';

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
    assert.ok(res3.body.message.includes('thu hoi'));
    console.log('  PASS: AC-SESS-03 Session revoked');

    // AC-SESS-04: Revoke already-revoked is idempotent
    console.log('[TEST 4 / AC-SESS-04] Idempotent revoke');
    const res4 = await request(server)
      .delete(`/api/v1/sessions/${createdSessionId}`)
      .set('Authorization', `Bearer ${createdToken}`)
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
    assert.ok(res7.body.message.includes('thu hoi'));
    console.log(`  PASS: AC-SESS-07 Revoke-all: ${res7.body.revoked_count} sessions`);

    // AC-SESS-08: Missing Bearer token returns 401
    console.log('[TEST 8 / AC-SESS-08] Missing token returns 401');
    const res8 = await request(server).get('/api/v1/sessions').expect(401);
    assert.strictEqual(res8.body.error.code, 'UNAUTHENTICATED');
    console.log('  PASS: AC-SESS-08 Missing token rejected');

    console.log('================================================================');
    console.log('ALL SESSION TESTS PASSED');
    console.log('================================================================');
  } finally {
    try {
      await prisma.deviceSession.deleteMany({
        where: { merchant_id: merchant.id },
      });
      await prisma.auditLog.deleteMany({
        where: { merchant_id: merchant.id },
      });
      await prisma.user.deleteMany({ where: { merchant_id: merchant.id } });
      await prisma.merchant.delete({ where: { id: merchant.id } });
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
