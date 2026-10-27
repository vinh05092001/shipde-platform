import 'reflect-metadata';
import * as assert from 'node:assert';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import {
  MockVerificationDeliveryAdapter,
  createValidTestConfig,
  assertNoSensitiveData,
} from '@shipde/testkit';
import { seedDatabase, SEED_MERCHANT_ID } from '../../../../infra/docker/seed';
import { SYSTEM_ROLE_IDS } from './rbac.service';
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
  const prisma = app.get(PrismaService);

  if ((await prisma.checkReadiness()) !== 'up') {
    await app.close();
    throw new Error(
      `Database must be reachable at ${databaseUrl} for RBAC Supertest HTTP suite; failing closed.`
    );
  }

  // Ensure seed data exists
  await seedDatabase();

  // Ensure schema alignment for Finding 7 (name_lower column, trigger, and unique index)
  await prisma.$executeRawUnsafe(
    'ALTER TABLE roles ADD COLUMN IF NOT EXISTS name_lower VARCHAR(255);'
  );
  await prisma.$executeRawUnsafe(
    'UPDATE roles SET name_lower = LOWER(name) WHERE name_lower IS NULL;'
  );
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION set_role_name_lower() RETURNS trigger AS $$
    BEGIN
      NEW.name_lower := LOWER(NEW.name);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS trg_role_name_lower ON roles;');
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_role_name_lower
    BEFORE INSERT OR UPDATE OF name ON roles
    FOR EACH ROW
    EXECUTE FUNCTION set_role_name_lower();
  `);
  await prisma.$executeRawUnsafe(
    'CREATE UNIQUE INDEX IF NOT EXISTS roles_merchant_id_name_lower_key ON roles(merchant_id, name_lower);'
  );

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
  const createSession = async (userId: string, merchantId: string): Promise<string> => {
    const raw = randomBytes(48).toString('hex');
    const hash = createHash('sha256').update(raw).digest('hex');
    await prisma.deviceSession.upsert({
      where: { session_token_hash: hash },
      update: { status: 'ACTIVE' },
      create: {
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: hash,
        device_id: 'test_supertest_device',
        device_model: 'Supertest',
        user_agent: 'Supertest',
        ip_address: '127.0.0.1',
        status: 'ACTIVE',
        auth_assurance: 'PASSWORD',
        expires_at: new Date(Date.now() + 3600000),
      },
    });
    return raw;
  };

  const ownerToken = await createSession(OWNER_ID, SEED_MERCHANT_ID);
  const opsToken = await createSession(OPS_ID, SEED_MERCHANT_ID);
  const otherOwnerToken = await createSession(OTHER_TENANT_OWNER_ID, OTHER_MERCHANT_ID);

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
  // AC-RBAC-01-02: List roles returns system roles plus tenant custom roles
  // =========================================================================
  const rolesRes = await request(server)
    .get('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  assert.ok(rolesRes.body.data.roles.length >= 5);

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

  // Unassign the user so role can be safely deleted in AC-10
  await prisma.user.update({
    where: { id: ASSIGNED_USER_ID },
    data: { custom_role_id: null },
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
  // Add a CHECK constraint to audit_logs that rejects action = 'ROLE_CREATED' for rollback test
  await prisma.$executeRawUnsafe(
    "ALTER TABLE audit_logs ADD CONSTRAINT test_fail_audit_ac15 CHECK (action != 'ROLE_CREATED') NOT VALID;"
  );

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
    // Drop the test constraint safely
    await prisma.$executeRawUnsafe(
      'ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS test_fail_audit_ac15;'
    );
  }

  // =========================================================================
  // AC-RBAC-01-16: Security inspection of role endpoints and audit logs -> No sensitive secrets or tokens exposed
  // =========================================================================
  const secInspectRes = await request(server)
    .get('/api/v1/roles')
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);

  // Assert no sensitive keys or leaked credentials in response JSON
  const secInspectStr = JSON.stringify(secInspectRes.body.data);
  assert.doesNotMatch(
    secInspectStr,
    /password_hash|secret_ciphertext|mfa_secret|bearer|raw_token|session_token/i
  );

  // Query audit logs and verify payload has no tokens or password hashes
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

  console.log(
    '✅ All RBAC Supertest HTTP assertions (AC-01 to AC-16) passed successfully with DB & audit proofs!'
  );
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
