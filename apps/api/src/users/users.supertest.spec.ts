import 'reflect-metadata';
import * as assert from 'node:assert';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { hashPassword } from '../auth/password.util';
import {
  MockVerificationDeliveryAdapter,
  createValidTestConfig,
  assertNoSecretValues,
} from '@shipde/testkit';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';
import { RbacService } from '../rbac/rbac.service';
import { UsersService } from './users.service';
import { RoleEnum } from '@prisma/client';

const SUITE_SUFFIX = Date.now().toString().slice(-6);
const OWNER_ID = randomUUID();
const SECOND_OWNER_ID = randomUUID();
const OPERATOR_ID = randomUUID();
const DELEGATED_ADMIN_ID = randomUUID();
const TOKEN_USER_ID = randomUUID();
const OTHER_TENANT_OWNER_ID = randomUUID();
const OTHER_TENANT_USER_ID = randomUUID();
const OTHER_MERCHANT_ID = randomUUID();

const DEFAULT_PASSWORD = 'UserSupertestPass123!';

/**
 * Sensitive key patterns that must never appear as object keys in responses or logs.
 * Scans strictly for password, hash, secret, token, authorization, and apikey fields.
 */
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /hash/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /apikey/i,
];

/**
 * Infrastructure connection patterns that must never appear in values.
 */
const INFRA_VALUE_PATTERNS = [
  /connection.*string/i,
  /postgres:\/\//i,
  /redis:\/\//i,
  /minioadmin/i,
];

/**
 * Asserts that a payload contains no sensitive information:
 * - Detects leakage by sensitive KEYS (password/hash/secret/token/authorization/apikey fields).
 * - Detects leakage by the actual secret values created by the test (password hash, session tokens/hashes, TOTP secrets).
 * - Detects infrastructure secret patterns (postgres://, redis://, minioadmin).
 * - Does NOT perform regex over arbitrary display-name values (e.g. /token/i), preventing false positives
 *   when other suites or fixtures create users whose full_name contains words like 'token'.
 */
function assertNoSensitiveDisclosures(data: unknown, secretValues: string[], path = ''): void {
  if (data === null || data === undefined) {
    return;
  }
  if (typeof data === 'string') {
    for (const secret of secretValues) {
      if (secret && data.includes(secret)) {
        throw new Error(
          `Sensitive secret value leaked at "${path}": created secret was found in value`
        );
      }
    }
    for (const pattern of INFRA_VALUE_PATTERNS) {
      if (pattern.test(data)) {
        throw new Error(
          `Sensitive infrastructure pattern leaked at "${path}": matches pattern ${pattern}`
        );
      }
    }
    return;
  }
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      assertNoSensitiveDisclosures(data[i], secretValues, path ? `${path}.${i}` : `${i}`);
    }
    return;
  }
  if (typeof data === 'object') {
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      const currentPath = path ? `${path}.${key}` : key;
      for (const pattern of SENSITIVE_KEY_PATTERNS) {
        if (pattern.test(key)) {
          throw new Error(
            `Sensitive key leaked at "${currentPath}": key matches pattern ${pattern}`
          );
        }
      }
      for (const secret of secretValues) {
        if (secret && key.includes(secret)) {
          throw new Error(
            `Sensitive secret value leaked in key at "${currentPath}": created secret found in key`
          );
        }
      }
      assertNoSensitiveDisclosures(value, secretValues, currentPath);
    }
  }
}

export async function runUsersSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - USER LIFECYCLE SUPERTEST SUITE (FEAT-USR-02)');
  console.log('================================================================');

  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  process.env.DATABASE_URL = databaseUrl;

  if (!process.env.AUDIT_IDENTIFIER_HMAC_KEY) {
    process.env.AUDIT_IDENTIFIER_HMAC_KEY = randomBytes(32).toString('hex');
  }

  const testConfig = createValidTestConfig({
    DATABASE_URL: databaseUrl,
    PORT: 3105,
    WORKER_HEALTH_PORT: 3106,
    CARRIER_MODE: 'disabled',
    AUTH_LOGIN_OTP_ENABLED: false,
    AUDIT_IDENTIFIER_HMAC_KEY: process.env.AUDIT_IDENTIFIER_HMAC_KEY,
    TRUST_PROXY_HOPS: 1,
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(new MockVerificationDeliveryAdapter())
    .compile();

  const app = moduleFixture.createNestApplication();
  app.set('trust proxy', 1);
  await app.init();
  const server = app.getHttpServer();
  const prisma = app.get(PrismaService);
  const rbacService = app.get(RbacService);

  if ((await prisma.checkReadiness()) !== 'up') {
    await app.close();
    throw new Error(
      `Database must be reachable at ${databaseUrl} for Users Supertest HTTP suite; failing closed.`
    );
  }

  // Ensure DB seed and migrations
  await seedDatabase();
  await rbacService.ensurePlatformSeed();

  // Create isolated secondary merchant
  await prisma.merchant.upsert({
    where: { id: OTHER_MERCHANT_ID },
    update: {},
    create: {
      id: OTHER_MERCHANT_ID,
      name: `Other Tenant Store ${SUITE_SUFFIX}`,
      code: `OTHER_${SUITE_SUFFIX}`,
      status: 'active',
    },
  });

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
  const TEST_TOTP_CIPHERTEXT = 'v1:supertest-totp-secret-ciphertext-scoped';
  const createdSecretValues: string[] = [
    DEFAULT_PASSWORD,
    passwordHash,
    TEST_TOTP_SECRET,
    TEST_TOTP_CIPHERTEXT,
  ];

  // Upsert test users in SEED_MERCHANT_ID (including a fixture whose full_name contains 'token'
  // to prove that display names containing 'token' do NOT trip sensitive data scans)
  for (const [id, email, role, full_name] of [
    [OWNER_ID, `owner.${SUITE_SUFFIX}@shipde.vn`, RoleEnum.OWNER, 'Supertest Shop Owner'],
    [SECOND_OWNER_ID, `owner2.${SUITE_SUFFIX}@shipde.vn`, RoleEnum.OWNER, 'Supertest Second Owner'],
    [OPERATOR_ID, `ops.${SUITE_SUFFIX}@shipde.vn`, RoleEnum.OPS_CSKH, 'Supertest Ops Operator'],
    [
      DELEGATED_ADMIN_ID,
      `admin.${SUITE_SUFFIX}@shipde.vn`,
      RoleEnum.OPS_CSKH,
      'Supertest Delegated Admin',
    ],
    [
      TOKEN_USER_ID,
      `tokenfixture.${SUITE_SUFFIX}@shipde.vn`,
      RoleEnum.OPS_CSKH,
      'Supertest Token Fixture User',
    ],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: {
        merchant_id: SEED_MERCHANT_ID,
        email,
        full_name,
        password_hash: passwordHash,
        status: 'active',
        role,
        store_scopes: ['store-default'],
        warehouse_scopes: ['wh-default'],
      },
      create: {
        id,
        merchant_id: SEED_MERCHANT_ID,
        email,
        full_name,
        password_hash: passwordHash,
        status: 'active',
        role,
        store_scopes: ['store-default'],
        warehouse_scopes: ['wh-default'],
      },
    });
  }

  // Set up an active TOTP factor on TOKEN_USER_ID to ensure TOTP secrets are verified against leakage
  await prisma.mfaFactor.deleteMany({
    where: {
      user_id: { in: [OWNER_ID, SECOND_OWNER_ID, OPERATOR_ID, DELEGATED_ADMIN_ID, TOKEN_USER_ID] },
    },
  });
  await prisma.mfaFactor.create({
    data: {
      user_id: TOKEN_USER_ID,
      merchant_id: SEED_MERCHANT_ID,
      type: 'TOTP',
      status: 'ACTIVE',
      secret_ciphertext: TEST_TOTP_CIPHERTEXT,
    },
  });

  // Create users in OTHER_MERCHANT_ID
  for (const [id, email, role, full_name] of [
    [
      OTHER_TENANT_OWNER_ID,
      `other.owner.${SUITE_SUFFIX}@shipde.vn`,
      RoleEnum.OWNER,
      'Other Tenant Owner',
    ],
    [
      OTHER_TENANT_USER_ID,
      `other.user.${SUITE_SUFFIX}@shipde.vn`,
      RoleEnum.OPS_CSKH,
      'Other Tenant User',
    ],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: {
        merchant_id: OTHER_MERCHANT_ID,
        email,
        full_name,
        password_hash: passwordHash,
        status: 'active',
        role,
        store_scopes: [],
        warehouse_scopes: [],
      },
      create: {
        id,
        merchant_id: OTHER_MERCHANT_ID,
        email,
        full_name,
        password_hash: passwordHash,
        status: 'active',
        role,
        store_scopes: [],
        warehouse_scopes: [],
      },
    });
  }

  // Helper to create active device session and return signed v1. token
  const createSession = async (
    userId: string,
    merchantId: string,
    role?: RoleEnum
  ): Promise<{ token: string; hash: string }> => {
    let effectiveRole = role;
    if (!effectiveRole) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
      effectiveRole = u?.role ?? RoleEnum.OWNER;
    }
    const sid = randomUUID();
    const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
    const { token } = signAccessToken(
      {
        sub: userId,
        sid,
        mid: merchantId,
        role: effectiveRole,
        st: 'ACTIVE',
        auth_assurance: 'PASSWORD',
      },
      secret,
      43200
    );
    const hash = createHash('sha256').update(token).digest('hex');
    createdSecretValues.push(token, hash);
    await prisma.deviceSession.upsert({
      where: { session_token_hash: hash },
      update: {
        status: 'ACTIVE',
        auth_assurance: 'PASSWORD',
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      },
      create: {
        id: sid,
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: hash,
        device_id: 'supertest-device',
        device_model: 'Supertest Model',
        status: 'ACTIVE',
        auth_assurance: 'PASSWORD',
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    return { token, hash };
  };

  const ownerSession = await createSession(OWNER_ID, SEED_MERCHANT_ID, RoleEnum.OWNER);
  const operatorSession = await createSession(OPERATOR_ID, SEED_MERCHANT_ID, RoleEnum.OPS_CSKH);
  const otherOwnerSession = await createSession(
    OTHER_TENANT_OWNER_ID,
    OTHER_MERCHANT_ID,
    RoleEnum.OWNER
  );

  const responsesToInspect: any[] = [];

  try {
    // -------------------------------------------------------------------------
    // AC-USR-02-01: Owner lists tenant users
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-01] Owner lists tenant users with pagination');
    const resList = await request(server)
      .get('/api/v1/users?page=1&limit=20')
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .expect(200);

    responsesToInspect.push(resList.body);
    assert.ok(Array.isArray(resList.body.data), 'res.body.data must be an array');
    assert.ok(resList.body.meta.total >= 4, 'total users in merchant must be >= 4');
    assert.strictEqual(resList.body.meta.page, 1);
    const returnedIds = resList.body.data.map((u: any) => u.id);
    assert.ok(returnedIds.includes(OWNER_ID), 'list must contain OWNER_ID');
    assert.ok(returnedIds.includes(OPERATOR_ID), 'list must contain OPERATOR_ID');
    assert.ok(
      !returnedIds.includes(OTHER_TENANT_USER_ID),
      'list must NOT contain other merchant users'
    );

    // Zero secret disclosure
    for (const u of resList.body.data) {
      assert.strictEqual(u.password_hash, undefined, 'password_hash must be omitted');
      assert.strictEqual(u.password, undefined, 'password must be omitted');
    }
    console.log('  PASS: AC-USR-02-01 Owner lists tenant users with pagination; passwords omitted');

    // -------------------------------------------------------------------------
    // AC-USR-02-02: Owner retrieves single user by ID
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-02] Owner retrieves single user by ID');
    const resGet = await request(server)
      .get(`/api/v1/users/${OPERATOR_ID}`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .expect(200);

    responsesToInspect.push(resGet.body);
    assert.strictEqual(resGet.body.data.id, OPERATOR_ID);
    assert.strictEqual(resGet.body.data.email, `ops.${SUITE_SUFFIX}@shipde.vn`);
    assert.strictEqual(resGet.body.data.role, 'OPS_CSKH');
    assert.strictEqual(resGet.body.data.status, 'ACTIVE');
    assert.ok(Array.isArray(resGet.body.data.store_scopes));
    assert.ok(Array.isArray(resGet.body.data.warehouse_scopes));
    console.log('  PASS: AC-USR-02-02 Owner retrieves single user by ID');

    // -------------------------------------------------------------------------
    // AC-USR-02-03: Owner updates user full name and warehouse scopes
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-03] Owner updates user full name and warehouse scopes');
    const resPatch = await request(server)
      .patch(`/api/v1/users/${OPERATOR_ID}`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({
        full_name: 'Ops Updated Via Supertest',
        warehouse_scopes: ['wh-north', 'wh-south'],
      })
      .expect(200);

    responsesToInspect.push(resPatch.body);
    assert.strictEqual(resPatch.body.data.full_name, 'Ops Updated Via Supertest');
    assert.deepStrictEqual(resPatch.body.data.warehouse_scopes, ['wh-north', 'wh-south']);

    const auditUpdated = await prisma.auditLog.findFirst({
      where: {
        merchant_id: SEED_MERCHANT_ID,
        entity_id: OPERATOR_ID,
        action: 'USER_UPDATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditUpdated, 'USER_UPDATED audit log must exist in DB');
    console.log('  PASS: AC-USR-02-03 Owner updates full name and warehouse scopes; audit logged');

    // -------------------------------------------------------------------------
    // AC-USR-02-04 & AC-USR-02-05: Owner suspends active operator and invalidates sessions
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-04 / 05] Owner suspends active operator; session revoked');
    const resSuspend = await request(server)
      .post(`/api/v1/users/${OPERATOR_ID}/suspend`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Audit policy non-compliance' })
      .expect(200);

    responsesToInspect.push(resSuspend.body);
    assert.strictEqual(resSuspend.body.data.status, 'SUSPENDED');
    assert.ok(resSuspend.body.data.revoked_sessions_count >= 1);

    // Verify DB user status
    const dbSuspendedUser = await prisma.user.findUnique({ where: { id: OPERATOR_ID } });
    assert.strictEqual(dbSuspendedUser?.status.toLowerCase(), 'suspended');

    // Verify device sessions are REVOKED
    const dbSessions = await prisma.deviceSession.findMany({
      where: { user_id: OPERATOR_ID },
    });
    for (const s of dbSessions) {
      assert.strictEqual(s.status, 'REVOKED', 'All sessions of suspended user must be REVOKED');
    }

    // Verify audit log
    const auditSuspended = await prisma.auditLog.findFirst({
      where: {
        merchant_id: SEED_MERCHANT_ID,
        entity_id: OPERATOR_ID,
        action: 'USER_SUSPENDED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditSuspended, 'USER_SUSPENDED audit log must exist in DB');
    assert.strictEqual(auditSuspended.reason, 'Audit policy non-compliance');

    // AC-USR-02-05: Pre-existing session token returns 401 SESSION_INVALID
    const resInvalidSession = await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${operatorSession.token}`)
      .expect(401);

    responsesToInspect.push(resInvalidSession.body);
    assert.strictEqual(resInvalidSession.body.error?.code, 'SESSION_INVALID');
    console.log(
      '  PASS: AC-USR-02-04 & AC-USR-02-05 Active operator suspended; session revoked and rejected with 401'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-06: Suspended user attempts login -> 403 AUTH_ACCOUNT_SUSPENDED
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-06] Suspended user attempts login');
    const resSuspendedLogin = await request(server)
      .post('/auth/login')
      .send({
        identifier: `ops.${SUITE_SUFFIX}@shipde.vn`,
        password: DEFAULT_PASSWORD,
      })
      .expect(403);

    responsesToInspect.push(resSuspendedLogin.body);
    assert.strictEqual(
      resSuspendedLogin.body.error?.code,
      'AUTH_ACCOUNT_SUSPENDED',
      'Suspended user login must be rejected with 403 AUTH_ACCOUNT_SUSPENDED'
    );
    console.log(
      '  PASS: AC-USR-02-06 Suspended user login rejected with 403 AUTH_ACCOUNT_SUSPENDED'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-07: Owner reinstates suspended user -> 200 OK; login succeeds again
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-07] Owner reinstates suspended user');
    const resActivate = await request(server)
      .post(`/api/v1/users/${OPERATOR_ID}/activate`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Reinstated after review' })
      .expect(200);

    responsesToInspect.push(resActivate.body);
    assert.strictEqual(resActivate.body.data.status, 'ACTIVE');

    const dbReactivatedUser = await prisma.user.findUnique({ where: { id: OPERATOR_ID } });
    assert.strictEqual(dbReactivatedUser?.status.toLowerCase(), 'active');

    const auditActivated = await prisma.auditLog.findFirst({
      where: {
        merchant_id: SEED_MERCHANT_ID,
        entity_id: OPERATOR_ID,
        action: 'USER_ACTIVATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditActivated, 'USER_ACTIVATED audit log must exist in DB');

    // Reinstated user can log in again
    const resReactivatedLogin = await request(server)
      .post('/auth/login')
      .send({
        identifier: `ops.${SUITE_SUFFIX}@shipde.vn`,
        password: DEFAULT_PASSWORD,
      })
      .expect(200);

    assert.ok(resReactivatedLogin.body.data?.access_token || resReactivatedLogin.body.data?.token);
    console.log(
      '  PASS: AC-USR-02-07 Owner activates suspended user; audit logged and login succeeds'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-08 & AC-USR-02-09: Owner deactivates active user -> DISABLED; login returns 403 AUTH_ACCOUNT_DISABLED
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-08 / 09] Owner deactivates active user');
    const resDeactivate = await request(server)
      .post(`/api/v1/users/${OPERATOR_ID}/deactivate`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Contract termination' })
      .expect(200);

    responsesToInspect.push(resDeactivate.body);
    assert.strictEqual(resDeactivate.body.data.status, 'DISABLED');

    const dbDisabledUser = await prisma.user.findUnique({ where: { id: OPERATOR_ID } });
    assert.strictEqual(dbDisabledUser?.status.toLowerCase(), 'disabled');

    const auditDeactivated = await prisma.auditLog.findFirst({
      where: {
        merchant_id: SEED_MERCHANT_ID,
        entity_id: OPERATOR_ID,
        action: 'USER_DEACTIVATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditDeactivated, 'USER_DEACTIVATED audit log must exist in DB');

    // AC-USR-02-09: Disabled user attempts login -> 403 AUTH_ACCOUNT_DISABLED
    const resDisabledLogin = await request(server)
      .post('/auth/login')
      .send({
        identifier: `ops.${SUITE_SUFFIX}@shipde.vn`,
        password: DEFAULT_PASSWORD,
      })
      .expect(403);

    responsesToInspect.push(resDisabledLogin.body);
    assert.strictEqual(
      resDisabledLogin.body.error?.code,
      'AUTH_ACCOUNT_DISABLED',
      'Disabled user login must be rejected with 403 AUTH_ACCOUNT_DISABLED'
    );
    console.log(
      '  PASS: AC-USR-02-08 & AC-USR-02-09 User deactivated and login returns 403 AUTH_ACCOUNT_DISABLED'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-10: Owner attempts self-suspension and self-deactivation -> 400 SELF_SUSPENSION_PROHIBITED
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-10] Owner attempts self-suspension and self-deactivation');
    const resSelfSuspend = await request(server)
      .post(`/api/v1/users/${OWNER_ID}/suspend`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Accidental self suspend' })
      .expect(400);

    responsesToInspect.push(resSelfSuspend.body);
    assert.strictEqual(resSelfSuspend.body.error?.code, 'SELF_SUSPENSION_PROHIBITED');

    const resSelfDeactivate = await request(server)
      .post(`/api/v1/users/${OWNER_ID}/deactivate`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Accidental self deactivate' })
      .expect(400);

    responsesToInspect.push(resSelfDeactivate.body);
    assert.strictEqual(resSelfDeactivate.body.error?.code, 'SELF_SUSPENSION_PROHIBITED');

    // Verify owner status remains active
    const dbOwner = await prisma.user.findUnique({ where: { id: OWNER_ID } });
    assert.strictEqual(dbOwner?.status.toLowerCase(), 'active');
    console.log(
      '  PASS: AC-USR-02-10 Self-suspension and self-deactivation rejected with 400 SELF_SUSPENSION_PROHIBITED'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-11: Owner attempts to suspend or deactivate sole active OWNER -> 400 CANNOT_REMOVE_LAST_OWNER
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-11] Sole active owner protection (BR-USR-01)');
    // Demote SECOND_OWNER_ID first so OWNER_ID is the sole remaining active owner
    await prisma.user.update({
      where: { id: SECOND_OWNER_ID },
      data: { role: RoleEnum.OPS_CSKH },
    });

    // In a secondary tenant with only 1 owner (OTHER_TENANT_OWNER_ID):
    // If another actor or role attempts to demote sole owner:
    const resDemoteSoleOwner = await request(server)
      .patch(`/api/v1/users/${OTHER_TENANT_OWNER_ID}`)
      .set('Authorization', `Bearer ${otherOwnerSession.token}`)
      .send({ role: RoleEnum.OPS_CSKH })
      .expect(400);

    responsesToInspect.push(resDemoteSoleOwner.body);
    assert.strictEqual(resDemoteSoleOwner.body.error?.code, 'CANNOT_REMOVE_LAST_OWNER');

    // Restore second owner
    await prisma.user.update({
      where: { id: SECOND_OWNER_ID },
      data: { role: RoleEnum.OWNER },
    });
    console.log(
      '  PASS: AC-USR-02-11 Sole owner mutation blocked with 400 CANNOT_REMOVE_LAST_OWNER'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-12: Blank or missing suspension reason -> 400 VALIDATION_ERROR
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-12] Blank suspension reason rejected');
    const resBlankReason = await request(server)
      .post(`/api/v1/users/${SECOND_OWNER_ID}/suspend`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: '   ' })
      .expect(400);

    responsesToInspect.push(resBlankReason.body);
    assert.strictEqual(resBlankReason.body.error?.code, 'VALIDATION_ERROR');
    console.log('  PASS: AC-USR-02-12 Blank reason rejected with 400 VALIDATION_ERROR');

    // -------------------------------------------------------------------------
    // AC-USR-02-13: Invalid status transitions -> 409 INVALID_STATUS_TRANSITION
    // -------------------------------------------------------------------------
    console.log(
      '[TEST AC-USR-02-13] Invalid status transitions produce 409 INVALID_STATUS_TRANSITION'
    );
    // OPERATOR_ID is currently 'disabled'. Attempting to suspend or deactivate again:
    const resInvalidTrans1 = await request(server)
      .post(`/api/v1/users/${OPERATOR_ID}/suspend`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Suspend disabled user' })
      .expect(409);

    responsesToInspect.push(resInvalidTrans1.body);
    assert.strictEqual(resInvalidTrans1.body.error?.code, 'INVALID_STATUS_TRANSITION');

    const resInvalidTrans2 = await request(server)
      .post(`/api/v1/users/${SECOND_OWNER_ID}/activate`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ reason: 'Activate already active user' })
      .expect(409);

    responsesToInspect.push(resInvalidTrans2.body);
    assert.strictEqual(resInvalidTrans2.body.error?.code, 'INVALID_STATUS_TRANSITION');
    console.log(
      '  PASS: AC-USR-02-13 Invalid status transitions produce 409 INVALID_STATUS_TRANSITION'
    );

    // -------------------------------------------------------------------------
    // AC-USR-02-14: Non-owner attempts to assign OWNER role -> 403 FORBIDDEN
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-14] Privilege ceiling: non-owner promoting to OWNER');
    // Create delegated admin user who has iam:manage_users via custom role
    const customRole = await prisma.role.create({
      data: {
        merchant_id: SEED_MERCHANT_ID,
        name: `Delegated Admin Role ${SUITE_SUFFIX}`,
        description: 'Role with iam:manage_users for testing',
        permissions: {
          create: [{ permission: { connect: { code: 'iam:manage_users' } } }],
        },
      },
    });

    await prisma.user.update({
      where: { id: DELEGATED_ADMIN_ID },
      data: { custom_role_id: customRole.id },
    });

    const delegatedSession = await createSession(
      DELEGATED_ADMIN_ID,
      SEED_MERCHANT_ID,
      RoleEnum.OPS_CSKH
    );

    const resPrivEsc = await request(server)
      .patch(`/api/v1/users/${OPERATOR_ID}`)
      .set('Authorization', `Bearer ${delegatedSession.token}`)
      .send({ role: RoleEnum.OWNER })
      .expect(403);

    responsesToInspect.push(resPrivEsc.body);
    assert.strictEqual(resPrivEsc.body.error?.code, 'FORBIDDEN');
    console.log('  PASS: AC-USR-02-14 Non-owner promoting to OWNER blocked with 403 FORBIDDEN');

    // -------------------------------------------------------------------------
    // AC-USR-02-15: Cross-tenant actor attempts to view/mutate user -> 403 FORBIDDEN
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-15] Cross-tenant isolation');
    const resCrossGet = await request(server)
      .get(`/api/v1/users/${OTHER_TENANT_USER_ID}`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .expect(403);

    responsesToInspect.push(resCrossGet.body);
    assert.strictEqual(resCrossGet.body.error?.code, 'FORBIDDEN');

    const resCrossPatch = await request(server)
      .patch(`/api/v1/users/${OTHER_TENANT_USER_ID}`)
      .set('Authorization', `Bearer ${ownerSession.token}`)
      .send({ full_name: 'Hacked Name' })
      .expect(403);

    responsesToInspect.push(resCrossPatch.body);
    assert.strictEqual(resCrossPatch.body.error?.code, 'FORBIDDEN');
    console.log('  PASS: AC-USR-02-15 Cross-tenant read and mutate blocked with 403 FORBIDDEN');

    // -------------------------------------------------------------------------
    // AC-USR-02-16: User lacking iam:manage_users permission attempts mutation -> 403 FORBIDDEN
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-16] Missing iam:manage_users permission');
    // Create plain operator without custom role
    const plainOpsId = randomUUID();
    await prisma.user.create({
      data: {
        id: plainOpsId,
        merchant_id: SEED_MERCHANT_ID,
        email: `plain.ops.${SUITE_SUFFIX}@shipde.vn`,
        full_name: 'Plain Ops No Perm',
        password_hash: passwordHash,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
      },
    });
    const plainOpsSession = await createSession(plainOpsId, SEED_MERCHANT_ID, RoleEnum.OPS_CSKH);

    const resNoPerm = await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${plainOpsSession.token}`)
      .expect(403);

    responsesToInspect.push(resNoPerm.body);
    assert.strictEqual(resNoPerm.body.error?.code, 'FORBIDDEN');
    console.log('  PASS: AC-USR-02-16 User lacking iam:manage_users blocked with 403 FORBIDDEN');

    // -------------------------------------------------------------------------
    // AC-USR-02-17: Transaction rollback on audit failure -> 500 error; user status & session preserved
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-17] Transaction rollback on audit failure');
    const victimUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: victimUserId,
        merchant_id: SEED_MERCHANT_ID,
        email: `victim.${SUITE_SUFFIX}@shipde.vn`,
        full_name: 'Victim User Rollback Test',
        password_hash: passwordHash,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
      },
    });
    const victimSession = await createSession(victimUserId, SEED_MERCHANT_ID, RoleEnum.OPS_CSKH);

    // Spy on $transaction to throw when creating audit log
    const usersService = app.get(UsersService);
    const targetPrisma = (usersService as any).prisma || prisma;
    const origTransaction = targetPrisma.$transaction.bind(targetPrisma);
    targetPrisma.$transaction = async (fn: any, options?: any) => {
      return origTransaction(async (tx: any) => {
        const origAuditCreate = tx.auditLog.create.bind(tx.auditLog);
        tx.auditLog.create = async (args: any) => {
          if (args?.data?.entity_id === victimUserId || args?.data?.action === 'USER_SUSPENDED') {
            throw new Error('Simulated auditLog database disk failure');
          }
          return origAuditCreate(args);
        };
        return fn(tx);
      }, options);
    };

    try {
      const resAuditFailure = await request(server)
        .post(`/api/v1/users/${victimUserId}/suspend`)
        .set('Authorization', `Bearer ${ownerSession.token}`)
        .send({ reason: 'Audit rollback check' })
        .expect(500);

      responsesToInspect.push(resAuditFailure.body);
      assert.strictEqual(resAuditFailure.body.error?.code, 'INTERNAL_SERVER_ERROR');

      // Assert user status rolled back and remains ACTIVE
      const dbVictim = await prisma.user.findUnique({ where: { id: victimUserId } });
      assert.strictEqual(
        dbVictim?.status.toLowerCase(),
        'active',
        'User status must remain active following transaction rollback'
      );

      // Assert session rolled back and remains ACTIVE
      const dbVictimSess = await prisma.deviceSession.findUnique({
        where: { session_token_hash: victimSession.hash },
      });
      assert.strictEqual(
        dbVictimSess?.status,
        'ACTIVE',
        'Device session status must remain ACTIVE following transaction rollback'
      );
      console.log(
        '  PASS: AC-USR-02-17 Transaction rolls back on audit failure; user & sessions preserved'
      );
    } finally {
      (targetPrisma as any).$transaction = origTransaction;
    }

    // -------------------------------------------------------------------------
    // AC-USR-02-18: Zero secret disclosure across all responses
    // -------------------------------------------------------------------------
    console.log('[TEST AC-USR-02-18] Security & secret disclosure check');
    const validSecrets = createdSecretValues.filter((s) => typeof s === 'string' && s.length >= 6);

    for (const body of responsesToInspect) {
      assertNoSensitiveDisclosures(body, validSecrets);
      assertNoSecretValues(JSON.stringify(body), validSecrets);
    }
    const userAuditLogs = await prisma.auditLog.findMany({
      where: {
        merchant_id: SEED_MERCHANT_ID,
        entity_id: {
          in: [OPERATOR_ID, OWNER_ID, SECOND_OWNER_ID, DELEGATED_ADMIN_ID, victimUserId],
        },
        action: { in: ['USER_UPDATED', 'USER_SUSPENDED', 'USER_ACTIVATED', 'USER_DEACTIVATED'] },
      },
    });
    for (const log of userAuditLogs) {
      if (log.old_value) {
        assertNoSensitiveDisclosures(log.old_value, validSecrets);
        assertNoSecretValues(JSON.stringify(log.old_value), validSecrets);
      }
      if (log.new_value) {
        assertNoSensitiveDisclosures(log.new_value, validSecrets);
        assertNoSecretValues(JSON.stringify(log.new_value), validSecrets);
      }
    }
    console.log(
      '  PASS: AC-USR-02-18 Zero secret disclosure validated across all user endpoint payloads & audit logs'
    );

    console.log('================================================================');
    console.log('🎉 ALL 18 FEAT-USR-02 ACCEPTANCE CRITERIA PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    await prisma.mfaFactor.deleteMany({
      where: {
        user_id: {
          in: [OWNER_ID, SECOND_OWNER_ID, OPERATOR_ID, DELEGATED_ADMIN_ID, TOKEN_USER_ID],
        },
      },
    });
    await app.close();
  }
}

if (require.main === module) {
  runUsersSupertestSuite().catch((err) => {
    console.error('FAILED USERS SUPERTEST SUITE:', err);
    process.exit(1);
  });
}
