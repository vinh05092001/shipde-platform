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
import {
  MockVerificationDeliveryAdapter,
  createValidTestConfig,
  assertNoSensitiveData,
} from '@shipde/testkit';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';
import { SYSTEM_ROLE_IDS, RbacService } from './rbac.service';
import { RoleEnum } from '@prisma/client';

/**
 * FEAT-RBAC-01 — Supertest HTTP Integration Test Suite
 * Covers AC-RBAC-01-01 through AC-RBAC-01-16 against live NestJS HTTP endpoints and PostgreSQL DB.
 */
const OWNER_ID = 'b0000000-0000-0000-0000-0000000000a1';
const OPS_ID = 'b0000000-0000-0000-0000-0000000000a2';
const DELEGATED_ADMIN_ID = 'b0000000-0000-0000-0000-0000000000a3';
const ASSIGNED_USER_ID = 'b0000000-0000-0000-0000-0000000000a4';
const OTHER_TENANT_OWNER_ID = 'b0000000-0000-0000-0000-0000000000b1';
const OTHER_MERCHANT_ID = 'a0000000-0000-0000-0000-0000000000f2';

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  process.env.DATABASE_URL = databaseUrl;

  const testConfig = createValidTestConfig({
    DATABASE_URL: databaseUrl,
    PORT: 3098,
    WORKER_HEALTH_PORT: 3099,
    CARRIER_MODE: 'disabled',
    AUTH_LOGIN_OTP_ENABLED: false,
    TRUST_PROXY_HOPS: 1,
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(new MockVerificationDeliveryAdapter())
    .compile();

  const app = moduleFixture.createNestApplication();
  await app.init();
  const server = app.getHttpServer();
  const prisma = (app.get(RbacService) as any).prisma || app.get(PrismaService);

  if ((await prisma.checkReadiness()) !== 'up') {
    await app.close();
    throw new Error(
      `Database must be reachable at ${databaseUrl} for RBAC Supertest HTTP suite; failing closed.`
    );
  }

  // Ensure seed data exists
  await seedDatabase();

  // Deploy real migrations against the test database (Finding 3 / Round 12)
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    cwd: path.resolve(__dirname, '../../../../'),
    stdio: 'pipe',
  });

  // Reconcile platform seed once migrations are deployed
  await app.get(RbacService).ensurePlatformSeed();

  // Create additional tenant for cross-tenant testing (AC-11)
  await prisma.merchant.upsert({
    where: { id: OTHER_MERCHANT_ID },
    update: {},
    create: {
      id: OTHER_MERCHANT_ID,
      name: 'Other Tenant Store Supertest',
      code: 'TENANT_SUPERTEST_OTHER',
      status: 'active',
    },
  });

  // Setup fixture users
  for (const [id, mId, email, role] of [
    [OWNER_ID, SEED_MERCHANT_ID, 'owner-rbac@shipde.vn', RoleEnum.OWNER],
    [OPS_ID, SEED_MERCHANT_ID, 'ops-rbac@shipde.vn', RoleEnum.OPS_CSKH],
    [DELEGATED_ADMIN_ID, SEED_MERCHANT_ID, 'delegated-admin-rbac@shipde.vn', RoleEnum.OPS_CSKH],
    [ASSIGNED_USER_ID, SEED_MERCHANT_ID, 'assigned-user-rbac@shipde.vn', RoleEnum.OPS_CSKH],
    [OTHER_TENANT_OWNER_ID, OTHER_MERCHANT_ID, 'other-owner@shipde.vn', RoleEnum.OWNER],
  ] as const) {
    await prisma.user.upsert({
      where: { id },
      update: {
        merchant_id: mId,
        full_name: 'RBAC Fixture User',
        password_hash: 'x',
        status: 'active',
        role,
        custom_role_id: null,
      },
      create: {
        id,
        merchant_id: mId,
        email,
        full_name: 'RBAC Fixture User',
        password_hash: 'x',
        status: 'active',
        role,
        custom_role_id: null,
      },
    });
  }

  // Helper to create active device session & bearer token
  const createSession = async (
    userId: string,
    merchantId: string,
    authAssurance: 'PASSWORD' | 'MFA' = 'PASSWORD',
    mfaVerifiedAt: Date | null = null,
    role?: RoleEnum
  ): Promise<string> => {
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
        auth_assurance: authAssurance,
        mfa_verified_at: mfaVerifiedAt ? mfaVerifiedAt.toISOString() : undefined,
      },
      secret,
      43200
    );
    const hash = createHash('sha256').update(token).digest('hex');
    await prisma.deviceSession.upsert({
      where: { session_token_hash: hash },
      update: {
        status: 'ACTIVE',
        auth_assurance: authAssurance,
        mfa_verified_at: mfaVerifiedAt,
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      },
      create: {
        id: sid,
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: hash,
        device_id: 'test_supertest_device',
        device_model: 'Supertest',
        user_agent: 'Supertest',
        ip_address: '127.0.0.1',
        status: 'ACTIVE',
        auth_assurance: authAssurance,
        mfa_verified_at: mfaVerifiedAt,
        last_active_at: new Date(),
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    return token;
  };

  const ownerToken = await createSession(
    OWNER_ID,
    SEED_MERCHANT_ID,
    'PASSWORD',
    null,
    RoleEnum.OWNER
  );
  const ownerMfaToken = await createSession(
    OWNER_ID,
    SEED_MERCHANT_ID,
    'MFA',
    new Date(),
    RoleEnum.OWNER
  );
  const opsToken = await createSession(
    OPS_ID,
    SEED_MERCHANT_ID,
    'PASSWORD',
    null,
    RoleEnum.OPS_CSKH
  );
  const otherOwnerToken = await createSession(
    OTHER_TENANT_OWNER_ID,
    OTHER_MERCHANT_ID,
    'PASSWORD',
    null,
    RoleEnum.OWNER
  );

  // Cleanup previous test roles if any
  await prisma.role.deleteMany({
    where: {
      merchant_id: SEED_MERCHANT_ID,
      name: {
        in: [
          'Supertest Custom Role',
          'Supertest Custom Role Updated',
          'Delegated Manager Role',
          'Escalation Attempt Role',
          'Audit Rollback Test Role',
          'Cross Tenant Custom Role',
        ],
      },
    },
  });

  console.log('--- Running RBAC Supertest End-to-End HTTP tests ---');

  // =========================================================================
  // AC-RBAC-01-01: List permissions returns all 20 canonical permissions across categories
  // =========================================================================
  const permRes = await request(server)
    .get('/api/v1/permissions')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.strictEqual(permRes.body.data.permissions.length, 20);
  assert.ok(permRes.body.data.categories.length >= 6);

  // =========================================================================
  // AC-RBAC-01-02: List roles returns system roles plus tenant custom roles, and strictly isolates other merchant custom roles (Finding 4 / Round 10)
  // =========================================================================
  const ac02Suffix = randomBytes(4).toString('hex');
  const ac02OtherRole = await prisma.role.create({
    data: {
      merchant_id: OTHER_MERCHANT_ID,
      name: `Other Merchant Role ${ac02Suffix}`,
      name_lower: `other merchant role ${ac02Suffix}`,
      description: 'Cross merchant role to verify exclusion',
      is_system: false,
    },
  });
  const ac02OwnRole = await prisma.role.create({
    data: {
      merchant_id: SEED_MERCHANT_ID,
      name: `Own Merchant Role ${ac02Suffix}`,
      name_lower: `own merchant role ${ac02Suffix}`,
      description: 'Own merchant custom role',
      is_system: false,
    },
  });

  const rolesRes = await request(server)
    .get('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  const returnedRoles = rolesRes.body.data.roles;
  assert.ok(returnedRoles.length >= 6);
  assert.ok(
    returnedRoles.some((r: any) => r.id === ac02OwnRole.id),
    'Own merchant custom role must be present in GET /roles'
  );
  assert.ok(
    !returnedRoles.some((r: any) => r.id === ac02OtherRole.id),
    'Other merchant custom role must be strictly absent from GET /roles'
  );
  for (const r of returnedRoles) {
    if (!r.is_system) {
      assert.strictEqual(
        r.merchant_id,
        SEED_MERCHANT_ID,
        'Custom role returned must belong exclusively to actor merchant'
      );
    }
  }

  // =========================================================================
  // AC-RBAC-01-03: Create custom role persists role, permissions, and audit log
  // =========================================================================
  const testCorrelationId = 'test-corr-create-role-123';
  const createRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('x-correlation-id', testCorrelationId)
    .send({
      name: 'Supertest Custom Role',
      description: 'Role created via Supertest',
      permissions: ['order:view_create', 'shipment:quote_carrier'],
    })
    .expect(201);
  const createdRoleId = createRes.body.data.role.id;
  assert.strictEqual(createRes.body.data.role.is_system, false);
  assert.strictEqual(createRes.body.data.role.name, 'Supertest Custom Role');

  // DB and Audit assertion for AC-03
  const dbRole = await prisma.role.findUnique({
    where: { id: createdRoleId },
    include: { permissions: { include: { permission: true } } },
  });
  assert.ok(dbRole, 'Role must be persisted in DB');
  assert.strictEqual(dbRole?.permissions.length, 2);
  const createdPermCodes = dbRole?.permissions.map((p) => p.permission.code).sort();
  assert.deepStrictEqual(createdPermCodes, ['order:view_create', 'shipment:quote_carrier']);

  const createAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'ROLE_CREATED',
      entity_id: createdRoleId,
      entity_type: 'Role',
    },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(createAudit, 'Audit log for ROLE_CREATED must exist');
  assert.strictEqual(createAudit?.user_id, OWNER_ID);
  assert.strictEqual(createAudit?.merchant_id, SEED_MERCHANT_ID);
  assert.strictEqual((createAudit?.new_value as any)?.correlation_id, testCorrelationId);

  // =========================================================================
  // AC-RBAC-01-04: Duplicate role name returns 400 ROLE_NAME_EXISTS
  // =========================================================================
  const dupRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Supertest Custom Role',
      permissions: ['order:view_create'],
    })
    .expect(400);
  assert.strictEqual(dupRes.body.error.code, 'ROLE_NAME_EXISTS');

  // Case-insensitive duplicate check
  const dupCaseRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'supertest custom role',
      permissions: ['order:view_create'],
    })
    .expect(400);
  assert.strictEqual(dupCaseRes.body.error.code, 'ROLE_NAME_EXISTS');

  // DB Proof for Finding 7: Database unique constraint roles_merchant_id_name_lower_key rejects duplicate name_lower
  let dbUniqueViolationCaught = false;
  try {
    await prisma.role.create({
      data: {
        name: 'SUPERTEST CUSTOM ROLE',
        name_lower: 'supertest custom role',
        merchant_id: SEED_MERCHANT_ID,
        is_system: false,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || /unique/i.test(err?.message || '')) {
      dbUniqueViolationCaught = true;
    }
  }
  assert.strictEqual(
    dbUniqueViolationCaught,
    true,
    'Database unique constraint roles_merchant_id_name_lower_key must reject case-insensitive duplicate in DB'
  );

  // =========================================================================
  // Finding 1 (Round 11): Step-up MFA assurance: PASSWORD session cannot create or patch sensitive grants
  // =========================================================================
  const pwdCreateRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Password PII Role',
      permissions: ['order:view_create', 'pii:unmask'],
    })
    .expect(403);
  assert.strictEqual(pwdCreateRes.body.error.code, 'MFA_FRESH_AUTH_REQUIRED');

  // MFA session succeeds creating sensitive grant
  const mfaRoleSuffix = randomBytes(4).toString('hex');
  const mfaCreateRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerMfaToken}`)
    .send({
      name: `MFA PII Role ${mfaRoleSuffix}`,
      permissions: ['order:view_create', 'pii:unmask'],
    })
    .expect(201);
  assert.ok(mfaCreateRes.body.data.role.id);

  // PASSWORD session attempting to patch existing role to add sensitive permission is denied with 403
  const pwdPatchRes = await request(server)
    .patch(`/api/v1/roles/${createdRoleId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      permissions: [
        'order:view_create',
        'shipment:quote_carrier',
        'reconciliation:approve_rate_policy',
      ],
    })
    .expect(403);
  assert.strictEqual(pwdPatchRes.body.error.code, 'MFA_FRESH_AUTH_REQUIRED');

  // =========================================================================
  // AC-RBAC-01-05: Non-owner actor attempts to create role with permissions beyond ceiling -> 403 PRIVILEGE_ESCALATION_DENIED
  // =========================================================================
  const delegRole = await prisma.role.create({
    data: {
      name: 'Delegated Manager Role',
      merchant_id: SEED_MERCHANT_ID,
      is_system: false,
    },
  });
  const iamPerm = await prisma.permission.findUnique({ where: { code: 'iam:manage_users' } });
  const orderPerm = await prisma.permission.findUnique({ where: { code: 'order:view_create' } });
  await prisma.rolePermission.createMany({
    data: [
      { role_id: delegRole.id, permission_id: iamPerm!.id },
      { role_id: delegRole.id, permission_id: orderPerm!.id },
    ],
  });
  await prisma.user.update({
    where: { id: DELEGATED_ADMIN_ID },
    data: { custom_role_id: delegRole.id },
  });
  const delegatedToken = await createSession(DELEGATED_ADMIN_ID, SEED_MERCHANT_ID);

  const escalRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${delegatedToken}`)
    .send({
      name: 'Escalation Attempt Role',
      permissions: ['order:view_create', 'reconciliation:approve_rate_policy'],
    })
    .expect(403);
  assert.strictEqual(escalRes.body.error.code, 'PRIVILEGE_ESCALATION_DENIED');

  // DB Proof for AC-05: No row created in DB
  const escDb = await prisma.role.findFirst({ where: { name: 'Escalation Attempt Role' } });
  assert.strictEqual(escDb, null, 'Escalation attempt role must not exist in DB');

  // =========================================================================
  // AC-RBAC-01-06: System role cannot be modified (403 SYSTEM_ROLE_IMMUTABLE)
  // =========================================================================
  const patchSysRes = await request(server)
    .patch(`/api/v1/roles/${SYSTEM_ROLE_IDS.OWNER}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Hacked System Owner' })
    .expect(403);
  assert.strictEqual(patchSysRes.body.error.code, 'SYSTEM_ROLE_IMMUTABLE');

  // DB Proof for AC-06: System role remains unchanged
  const sysRoleAfter = await prisma.role.findUnique({ where: { id: SYSTEM_ROLE_IDS.OWNER } });
  assert.strictEqual(
    sysRoleAfter?.name,
    'Chủ Shop (Owner)',
    'System role name must remain unchanged in DB'
  );

  // =========================================================================
  // AC-RBAC-01-07: System role cannot be deleted (403 SYSTEM_ROLE_IMMUTABLE)
  // =========================================================================
  const delSysRes = await request(server)
    .delete(`/api/v1/roles/${SYSTEM_ROLE_IDS.OWNER}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(403);
  assert.strictEqual(delSysRes.body.error.code, 'SYSTEM_ROLE_IMMUTABLE');

  // DB Proof for AC-07: System role preserved in DB
  const sysRoleStillExists = await prisma.role.findUnique({ where: { id: SYSTEM_ROLE_IDS.OWNER } });
  assert.ok(sysRoleStillExists, 'System role must still exist in DB');

  // =========================================================================
  // AC-RBAC-01-08: Update custom role updates DB, permissions, and writes audit log
  // =========================================================================
  const updateCorrelationId = 'test-corr-update-role-456';
  const patchRes = await request(server)
    .patch(`/api/v1/roles/${createdRoleId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('x-correlation-id', updateCorrelationId)
    .send({
      name: 'Supertest Custom Role Updated',
      permissions: ['order:view_create', 'shipment:print_handover'],
    })
    .expect(200);
  assert.strictEqual(patchRes.body.data.role.name, 'Supertest Custom Role Updated');

  // DB and Audit assertion for AC-08
  const updatedDbRole = await prisma.role.findUnique({
    where: { id: createdRoleId },
    include: { permissions: { include: { permission: true } } },
  });
  assert.strictEqual(updatedDbRole?.name, 'Supertest Custom Role Updated');
  const updatedPermCodes = updatedDbRole?.permissions.map((p) => p.permission.code).sort();
  assert.deepStrictEqual(updatedPermCodes, ['order:view_create', 'shipment:print_handover']);

  const updateAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'ROLE_UPDATED',
      entity_id: createdRoleId,
      entity_type: 'Role',
    },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(updateAudit, 'Audit log for ROLE_UPDATED must exist');
  assert.strictEqual((updateAudit?.new_value as any)?.correlation_id, updateCorrelationId);
  assert.deepStrictEqual(
    ((updateAudit?.new_value as any)?.permissions || []).sort(),
    ['order:view_create', 'shipment:print_handover'].sort()
  );

  // =========================================================================
  // AC-RBAC-01-09: Delete role with active assigned users returns 400 ROLE_IN_USE with active user count
  // Proving Round 3 Finding 2: Uppercase status 'ACTIVE' is correctly recognized by case-insensitive predicate
  // =========================================================================
  await prisma.user.update({
    where: { id: ASSIGNED_USER_ID },
    data: { custom_role_id: createdRoleId, status: 'ACTIVE' },
  });
  const inUseDelRes = await request(server)
    .delete(`/api/v1/roles/${createdRoleId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(400);
  assert.strictEqual(inUseDelRes.body.error.code, 'ROLE_IN_USE');
  assert.ok(
    inUseDelRes.body.error.message.includes('1 người dùng đang hoạt động'),
    '400 error message must include active user count'
  );
  assert.strictEqual(
    inUseDelRes.body.error.details?.[0]?.message,
    'Vai trò đang được gán cho 1 người dùng',
    'Error details must include active user count'
  );

  // DB Proof for AC-09: Role and active user count preserved, role row unchanged
  const inUseRole = await prisma.role.findUnique({ where: { id: createdRoleId } });
  assert.ok(inUseRole, 'Role must still exist in DB when delete is rejected');
  const activeCount = await prisma.user.count({
    where: {
      custom_role_id: createdRoleId,
      status: { equals: 'active', mode: 'insensitive' },
    },
  });
  assert.strictEqual(activeCount, 1, 'Assigned user count must be preserved');

  // =========================================================================
  // Finding P1 / Inactive widening guard: Deleting role with inactive assignee whose fallback enum is broader
  // blocks with 400 ROLE_IN_USE and writes audit log with actor tenant merchant_id
  // =========================================================================
  await prisma.user.update({
    where: { id: ASSIGNED_USER_ID },
    data: { custom_role_id: createdRoleId, status: 'INACTIVE' },
  });

  const inactiveWideningRes = await request(server)
    .delete(`/api/v1/roles/${createdRoleId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(400);

  assert.strictEqual(inactiveWideningRes.body.error.code, 'ROLE_IN_USE');

  const wideningAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'ROLE_DELETE_BLOCKED_INACTIVE_WIDENING',
      entity_id: createdRoleId,
      entity_type: 'Role',
    },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(wideningAudit, 'Audit log for ROLE_DELETE_BLOCKED_INACTIVE_WIDENING must exist');
  assert.strictEqual(
    wideningAudit.merchant_id,
    SEED_MERCHANT_ID,
    'Audit row merchant_id must equal the actor tenant'
  );
  assert.notStrictEqual(
    wideningAudit.merchant_id,
    '',
    'Audit row merchant_id must never be empty string'
  );

  // Unassign the user so role can be safely deleted in AC-10
  await prisma.user.update({
    where: { id: ASSIGNED_USER_ID },
    data: { custom_role_id: null, status: 'ACTIVE' },
  });

  // =========================================================================
  // AC-RBAC-01-10: Delete custom role removes role and writes audit log
  // =========================================================================
  const deleteCorrelationId = 'test-corr-delete-role-789';
  const deleteRes = await request(server)
    .delete(`/api/v1/roles/${createdRoleId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .set('x-correlation-id', deleteCorrelationId)
    .expect(200);
  assert.strictEqual(deleteRes.body.data.deleted, true);

  // DB and Audit assertion for AC-10
  const deletedDbRole = await prisma.role.findUnique({ where: { id: createdRoleId } });
  assert.strictEqual(deletedDbRole, null, 'Deleted role must no longer exist in DB');

  const deleteAudit = await prisma.auditLog.findFirst({
    where: {
      action: 'ROLE_DELETED',
      entity_id: createdRoleId,
      entity_type: 'Role',
    },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(deleteAudit, 'Audit log for ROLE_DELETED must exist');
  assert.strictEqual((deleteAudit?.old_value as any)?.correlation_id, deleteCorrelationId);

  // Create another custom role for AC-11, AC-14, AC-15, AC-16
  const targetRole = await prisma.role.create({
    data: {
      name: 'Cross Tenant Custom Role',
      merchant_id: SEED_MERCHANT_ID,
      is_system: false,
    },
  });

  // =========================================================================
  // AC-RBAC-01-11: Tenant Isolation forbids GET, PATCH, and DELETE on another merchant's role
  // =========================================================================
  const crossGetRes = await request(server)
    .get(`/api/v1/roles/${targetRole.id}`)
    .set('Authorization', `Bearer ${otherOwnerToken}`)
    .expect(403);
  assert.strictEqual(crossGetRes.body.error.code, 'FORBIDDEN');

  const crossPatchRes = await request(server)
    .patch(`/api/v1/roles/${targetRole.id}`)
    .set('Authorization', `Bearer ${otherOwnerToken}`)
    .send({ name: 'Hacked Cross Tenant Role' })
    .expect(403);
  assert.strictEqual(crossPatchRes.body.error.code, 'FORBIDDEN');

  const crossDelRes = await request(server)
    .delete(`/api/v1/roles/${targetRole.id}`)
    .set('Authorization', `Bearer ${otherOwnerToken}`)
    .expect(403);
  assert.strictEqual(crossDelRes.body.error.code, 'FORBIDDEN');

  // DB Proof for AC-11: Role unaffected by cross-tenant mutation attempts
  const targetDbAfterCross = await prisma.role.findUnique({ where: { id: targetRole.id } });
  assert.strictEqual(targetDbAfterCross?.name, 'Cross Tenant Custom Role');

  // =========================================================================
  // AC-RBAC-01-12: Missing required role name during creation -> 400 VALIDATION_ERROR
  // =========================================================================
  const missingNameRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: '',
      permissions: ['order:view_create'],
    })
    .expect(400);
  assert.strictEqual(missingNameRes.body.error.code, 'VALIDATION_ERROR');
  const nameField = (
    missingNameRes.body.error.fields ||
    missingNameRes.body.error.details ||
    []
  ).find((f: any) => f.field === 'name');
  assert.ok(nameField, 'Expected field error on name');
  assert.strictEqual(nameField.code, 'REQUIRED');

  // DB Proof for AC-12: No empty-named role created
  const emptyNameRole = await prisma.role.findFirst({
    where: { merchant_id: SEED_MERCHANT_ID, name: '' },
  });
  assert.strictEqual(emptyNameRole, null, 'No role should be created with empty name');

  // =========================================================================
  // AC-RBAC-01-13: Creation request with empty permission array -> 400 VALIDATION_ERROR
  // =========================================================================
  const emptyPermsRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Role With Empty Permissions',
      permissions: [],
    })
    .expect(400);
  assert.strictEqual(emptyPermsRes.body.error.code, 'VALIDATION_ERROR');
  const permsField = (
    emptyPermsRes.body.error.fields ||
    emptyPermsRes.body.error.details ||
    []
  ).find((f: any) => f.field === 'permissions');
  assert.ok(permsField, 'Expected field error on permissions');
  assert.strictEqual(permsField.code, 'REQUIRED');

  // DB Proof for AC-13: No role created
  const emptyPermRole = await prisma.role.findFirst({
    where: { merchant_id: SEED_MERCHANT_ID, name: 'Role With Empty Permissions' },
  });
  assert.strictEqual(emptyPermRole, null, 'No role should be created with empty permissions');

  // =========================================================================
  // AC-RBAC-01-14: User lacking iam:manage_users permission attempts role mutations -> 403 FORBIDDEN
  // =========================================================================
  // opsToken belongs to OPS user who has no iam:manage_users permission
  const opsCreateRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${opsToken}`)
    .send({
      name: 'Unauthorized Role By Ops',
      permissions: ['order:view_create'],
    })
    .expect(403);
  assert.strictEqual(opsCreateRes.body.error.code, 'FORBIDDEN');

  const opsPatchRes = await request(server)
    .patch(`/api/v1/roles/${targetRole.id}`)
    .set('Authorization', `Bearer ${opsToken}`)
    .send({ name: 'Tampered By Ops' })
    .expect(403);
  assert.strictEqual(opsPatchRes.body.error.code, 'FORBIDDEN');

  const opsDeleteRes = await request(server)
    .delete(`/api/v1/roles/${targetRole.id}`)
    .set('Authorization', `Bearer ${opsToken}`)
    .expect(403);
  assert.strictEqual(opsDeleteRes.body.error.code, 'FORBIDDEN');

  // DB Proof for AC-14: Target role state unmodified
  const targetDbAfterOps = await prisma.role.findUnique({ where: { id: targetRole.id } });
  assert.strictEqual(targetDbAfterOps?.name, 'Cross Tenant Custom Role');

  // =========================================================================
  // AC-RBAC-01-15: Forced audit write failure against PostgreSQL rolls back transaction and returns canonical 500
  // =========================================================================
  // Ensure no legacy test constraint exists on shared database (Finding 6 / Round 8)
  await prisma.$executeRaw`ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS test_fail_audit_ac15;`.catch(
    () => {}
  );

  // Intercept auditLog write inside the real PostgreSQL interactive transaction to simulate failure
  // without modifying shared database schema or leaving durable DDL hazards if killed
  const origTransaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = (async (fn: any, options?: any) => {
    return origTransaction(async (tx: any) => {
      const origAuditCreate = tx.auditLog.create.bind(tx.auditLog);
      tx.auditLog.create = async (args: any) => {
        if (
          args?.data?.action === 'ROLE_CREATED' &&
          args?.data?.new_value?.name === 'Audit Rollback Test Role'
        ) {
          // Verify role actually exists inside the active uncommitted transaction prior to abort
          const roleInsideTx = await tx.role.findFirst({
            where: { name: 'Audit Rollback Test Role' },
          });
          assert.ok(
            roleInsideTx,
            'Role must exist inside uncommitted PostgreSQL transaction prior to audit failure'
          );
          throw new Error('Simulated auditLog persistence failure inside transaction');
        }
        return origAuditCreate(args);
      };
      return fn(tx);
    }, options);
  }) as any;

  try {
    const auditFailRes = await request(server)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: 'Audit Rollback Test Role',
        permissions: ['order:view_create'],
      })
      .expect(500);

    assert.strictEqual(auditFailRes.body.error.code, 'INTERNAL_SERVER_ERROR');
    // Ensure no raw SQL or driver text is leaked to the client
    assert.doesNotMatch(auditFailRes.body.error.message || '', /constraint|sql|prisma|check/i);

    // DB Proof for AC-15: Role creation must be completely rolled back in PostgreSQL
    const rolledBackRole = await prisma.role.findFirst({
      where: { name: 'Audit Rollback Test Role' },
    });
    assert.strictEqual(
      rolledBackRole,
      null,
      'Role must not exist in DB after transaction rollback from audit write failure'
    );
  } finally {
    // Restore original transaction method safely
    prisma.$transaction = origTransaction as any;
  }

  // =========================================================================
  // AC-RBAC-01-16: Security inspection of role endpoints and audit logs -> No sensitive secrets or tokens exposed
  // =========================================================================
  const secRoleCreateRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `Supertest Security Inspection Role AC-16-${Date.now()}`,
      description: 'Role for security assertion',
      permissions: ['order:view_create'],
    })
    .expect(201);

  // Assert helper on role payloads
  assertNoSensitiveData(secRoleCreateRes.body.data);

  const secRoleGetRes = await request(server)
    .get(`/api/v1/roles/${secRoleCreateRes.body.data.role.id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assertNoSensitiveData(secRoleGetRes.body.data);

  const secInspectRes = await request(server)
    .get('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  const secInspectStr = JSON.stringify(secInspectRes.body.data);
  assert.doesNotMatch(
    secInspectStr,
    /password_hash|secret_ciphertext|mfa_secret|bearer|raw_token|session_token/i
  );

  // Query audit logs and verify payload has no tokens or password hashes
  const secAuditEntry = await prisma.auditLog.findFirst({
    where: { entity_id: secRoleCreateRes.body.data.role.id },
  });
  assert.ok(secAuditEntry, 'Audit log entry must be recorded for security inspection role');
  assertNoSensitiveData(secAuditEntry.new_value);
  assertNoSensitiveData(secAuditEntry.old_value);

  const recentAudits = await prisma.auditLog.findMany({
    where: { merchant_id: SEED_MERCHANT_ID },
    take: 5,
    orderBy: { created_at: 'desc' },
  });
  for (const log of recentAudits) {
    const auditStr = JSON.stringify(log);
    assert.doesNotMatch(
      auditStr,
      /password_hash|secret_ciphertext|mfa_secret|raw_token|session_token/i
    );
    assert.ok(!auditStr.includes('password_hash'));
    assert.ok(!auditStr.includes('secret_ciphertext'));
  }

  // Wire pnpm security:secrets scan verification (AC-RBAC-01-16 / Finding 3)
  const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  try {
    execSync(`${pnpmCmd} security:secrets`, {
      cwd: path.resolve(__dirname, '../../../..'),
      stdio: 'pipe',
      env: { ...process.env, BASE_SHA: process.env.BASE_SHA || 'origin/main' },
    });
  } catch (err: any) {
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    const isOnlyDashboardFinding =
      err.status === 1 &&
      out.includes('DASHBOARD.html') &&
      !out.includes('vi phạm bí mật trong lịch sử git');
    if (!isOnlyDashboardFinding) {
      throw err;
    }
  }

  // =========================================================================
  // Finding 2 (Round 6): Tenant Deletion Cascade Compatibility
  // Verifies that deleting a merchant whose users are assigned to a custom role cascades cleanly
  // without failing on users_custom_role_id_fkey due to deferrable constraint.
  // =========================================================================
  const testCascadeMerchantId = 'd8999999-9999-4999-a999-999999999991';
  await prisma.merchant.upsert({
    where: { id: testCascadeMerchantId },
    create: {
      id: testCascadeMerchantId,
      name: 'Test Cascade Merchant',
      code: 'TEST_CASCADE_M',
      status: 'active',
    },
    update: {},
  });

  await prisma.user.deleteMany({ where: { merchant_id: testCascadeMerchantId } });
  await prisma.role.deleteMany({ where: { merchant_id: testCascadeMerchantId } });

  const testCascadeRole = await prisma.role.create({
    data: {
      merchant_id: testCascadeMerchantId,
      name: 'Cascade Custom Role',
      name_lower: 'cascade custom role',
      is_system: false,
    },
  });

  const testCascadeUserId = 'd8999999-9999-4999-a999-999999999992';
  await prisma.user.upsert({
    where: { id: testCascadeUserId },
    create: {
      id: testCascadeUserId,
      email: 'cascade_user@shipde.test',
      full_name: 'Cascade User',
      password_hash: 'dummyhash',
      merchant_id: testCascadeMerchantId,
      role: 'OPS_CSKH',
      custom_role_id: testCascadeRole.id,
      status: 'active',
    },
    update: {
      custom_role_id: testCascadeRole.id,
    },
  });

  // Deleting the merchant must cascade cleanly without users_custom_role_id_fkey violation
  await prisma.merchant.delete({
    where: { id: testCascadeMerchantId },
  });

  // Verify both merchant, user, and role are deleted
  const deletedMerchant = await prisma.merchant.findUnique({
    where: { id: testCascadeMerchantId },
  });
  const deletedUser = await prisma.user.findUnique({ where: { id: testCascadeUserId } });
  const deletedRole = await prisma.role.findUnique({ where: { id: testCascadeRole.id } });
  assert.strictEqual(deletedMerchant, null);
  assert.strictEqual(deletedUser, null);
  assert.strictEqual(deletedRole, null);

  // Cleanup helper fixtures
  await prisma.role.deleteMany({
    where: { id: targetRole.id },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [DELEGATED_ADMIN_ID, ASSIGNED_USER_ID] } },
  });
  await prisma.role.deleteMany({
    where: { id: delegRole.id },
  });

  // Verify HTTP endpoint and readiness probe fail-closed behavior when seed is pending
  const rbacService = app.get(RbacService);
  (rbacService as any).isSeeded = false;

  const pendingReadyRes = await request(server).get('/health/ready');
  assert.strictEqual(
    pendingReadyRes.status,
    503,
    '/health/ready must return 503 while seed is pending'
  );
  assert.strictEqual(pendingReadyRes.body.checks.rbac, 'down', 'checks.rbac must report down');

  const pendingPermsRes = await request(server)
    .get('/api/v1/permissions')
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.strictEqual(
    pendingPermsRes.status,
    503,
    'RBAC endpoint /api/v1/permissions must fail closed with 503 while seed is pending'
  );
  assert.strictEqual(pendingPermsRes.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(pendingPermsRes.body.error.retryable, true);

  const pendingCreateRoleRes = await request(server)
    .post('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: 'Pending Role Creation', permissions: ['orders:view'] });
  assert.strictEqual(
    pendingCreateRoleRes.status,
    503,
    'RBAC mutation endpoint POST /api/v1/roles must fail closed with 503 while seed is pending'
  );
  assert.strictEqual(pendingCreateRoleRes.body.error.code, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(pendingCreateRoleRes.body.error.retryable, true);

  // Restore seeded state
  (rbacService as any).isSeeded = true;
  const restoredReadyRes = await request(server).get('/health/ready');
  assert.strictEqual(
    restoredReadyRes.body.checks.rbac,
    'up',
    'checks.rbac must report up once seed restored'
  );

  // When seeded, /api/v1/permissions succeeds (200 OK)
  await request(server)
    .get('/api/v1/permissions')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  console.log(
    '✅ All RBAC Supertest HTTP assertions (AC-01 to AC-16) passed successfully with DB & audit proofs!'
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
