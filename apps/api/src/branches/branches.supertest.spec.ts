import 'reflect-metadata';
import * as assert from 'node:assert';
import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';
import { BranchesService } from './branches.service';

async function runBranchesSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - BRANCHES SUPERTEST SUITE (FEAT-ORG-02)');
  console.log('================================================================');

  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../../../../.env'),
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

  const databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();

  const prisma = app.get(PrismaService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error(`Database must be reachable in CI environment at ${databaseUrl}`);
    }
    console.warn(
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Branches Supertest tests.`
    );
    await app.close();
    console.log('🎉 Branches Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  const merchantIdA = randomUUID();
  const merchantIdB = randomUUID();

  try {
    const tokenSecret = 'test-token-secret-for-branches-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Shop Org Branch A ${testSuffix}`,
          code: `ORG_A_${testSuffix}`,
          status: 'active',
        },
        {
          id: merchantIdB,
          name: `Shop Org Branch B ${testSuffix}`,
          code: `ORG_B_${testSuffix}`,
          status: 'active',
        },
      ],
    });

    // Helper to create user + session token
    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      storeScopes: string[] = [],
      customRoleId: string | null = null
    ): Promise<{ userId: string; token: string }> => {
      const uId = randomUUID();
      const sId = randomUUID();
      const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
      const { token } = signAccessToken(
        {
          sub: uId,
          sid: sId,
          mid: mId,
          role,
          st: 'ACTIVE',
        },
        secret,
        3600
      );

      await prisma.user.create({
        data: {
          id: uId,
          merchant_id: mId,
          email: `user_${emailSuffix}_${testSuffix}@shipde.vn`,
          full_name: `Test User ${role}`,
          password_hash: 'hashed',
          role,
          custom_role_id: customRoleId,
          store_scopes: storeScopes,
          status: 'active',
        },
      });

      await prisma.deviceSession.create({
        data: {
          id: sId,
          user_id: uId,
          merchant_id: mId,
          session_token_hash: createHash('sha256').update(token).digest('hex'),
          device_id: `test-device-${emailSuffix}`,
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 3600 * 1000),
        },
      });

      return { userId: uId, token };
    };

    const { token: ownerTokenA } = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner_a');
    const { token: warehouseTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'wh_a'
    );
    const { token: ownerTokenB } = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner_b');

    // ========================================================================
    // AC-ORG-02-03: Create first branch (automatically becomes default)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-03: POST /api/v1/branches (First branch -> default)...');
    const resCreate1 = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
        code: 'hcm-q3',
        address: '128 Nguyễn Trãi, P. 3, Q. 5, TP. HCM',
        phone: '0901234567',
      })
      .expect(201);

    assert.strictEqual(resCreate1.body.success, true);
    assert.strictEqual(resCreate1.body.data.name, 'Chi Nhánh Quận 3 (Trụ Sở Chính)');
    assert.strictEqual(resCreate1.body.data.code, 'HCM-Q3');
    assert.strictEqual(resCreate1.body.data.is_default, true);
    assert.strictEqual(resCreate1.body.data.status, 'ACTIVE');

    const branch1Id = resCreate1.body.data.id;

    // Verify DB
    const dbBranch1 = await prisma.branch.findUnique({ where: { id: branch1Id } });
    assert.ok(dbBranch1);
    assert.strictEqual(dbBranch1.is_default, true);
    assert.strictEqual(dbBranch1.code, 'HCM-Q3');

    // Verify audit log
    const audit1 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'BRANCH_CREATED',
        entity_id: branch1Id,
      },
    });
    assert.ok(audit1);
    assert.strictEqual((audit1.new_value as any).code, 'HCM-Q3');
    assert.strictEqual((audit1.new_value as any).phone, '090****567'); // masked phone
    console.log('  PASS: AC-ORG-02-03 verified with DB and audit proof.');

    // Create a scoped user assigned only to HCM-Q3
    const { token: scopedTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'scoped_a',
      ['HCM-Q3']
    );

    // ========================================================================
    // AC-ORG-02-03b: Create second branch (Kho Vận Tân Bình)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-03b: Create second branch (non-default)...');
    const resCreate2 = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: 'Kho Vận Tân Bình',
        code: 'HCM-TB',
        address: '55 CMT8, P. 5, Tân Bình, TP. HCM',
        phone: '0909876543',
        is_default: false,
      })
      .expect(201);

    assert.strictEqual(resCreate2.body.data.code, 'HCM-TB');
    assert.strictEqual(resCreate2.body.data.is_default, false);
    const branch2Id = resCreate2.body.data.id;
    console.log('  PASS: Second branch created successfully.');

    // ========================================================================
    // AC-ORG-02-01: List branches (Owner sees all 2 branches)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-01: GET /api/v1/branches (Owner sees all)...');
    const resListOwner = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resListOwner.body.success, true);
    assert.strictEqual(resListOwner.body.data.branches.length, 2);
    assert.strictEqual(resListOwner.body.data.branches[0].is_default, true);
    console.log('  PASS: AC-ORG-02-01 verified successfully.');

    // ========================================================================
    // AC-ORG-02-02: Scoped user lists branches (only sees HCM-Q3)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-02: Scoped user lists branches...');
    const resListScoped = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${scopedTokenA}`)
      .expect(200);

    assert.strictEqual(resListScoped.body.success, true);
    assert.strictEqual(resListScoped.body.data.branches.length, 1);
    assert.strictEqual(resListScoped.body.data.branches[0].code, 'HCM-Q3');
    console.log('  PASS: AC-ORG-02-02 verified: scoped user filtered to assigned branch.');

    // ========================================================================
    // AC-ORG-02-04: Duplicate code in same merchant -> 409 BRANCH_CODE_EXISTS
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-04: Duplicate branch code rejection...');
    const resDup = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: 'Trùng mã Q3',
        code: 'hcm-q3',
      })
      .expect(409);

    assert.strictEqual(resDup.body.error.code, 'BRANCH_CODE_EXISTS');
    console.log('  PASS: AC-ORG-02-04 verified with 409 BRANCH_CODE_EXISTS.');

    // ========================================================================
    // AC-ORG-02-05: Validation error on invalid data
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-05: Validation errors on empty name and invalid phone...');
    const resVal = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: ' ',
        code: 'VALID-01',
        phone: '12345',
      })
      .expect(400);

    assert.strictEqual(resVal.body.error.code, 'VALIDATION_ERROR');
    assert.ok(resVal.body.error.fields.some((f: any) => f.field === 'name'));
    assert.ok(resVal.body.error.fields.some((f: any) => f.field === 'phone'));
    console.log('  PASS: AC-ORG-02-05 verified with 400 VALIDATION_ERROR.');

    // ========================================================================
    // AC-ORG-02-06: Update branch details
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-06: PATCH /api/v1/branches/:id...');
    const resUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branch2Id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: 'Kho Vận Tân Bình (Mở rộng)',
        phone: '0908888999',
      })
      .expect(200);

    assert.strictEqual(resUpdate.body.data.name, 'Kho Vận Tân Bình (Mở rộng)');
    const auditUpdate = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'BRANCH_UPDATED',
        entity_id: branch2Id,
      },
    });
    assert.ok(auditUpdate);
    assert.strictEqual((auditUpdate.new_value as any).name, 'Kho Vận Tân Bình (Mở rộng)');
    assert.strictEqual((auditUpdate.new_value as any).phone, '090****999'); // masked phone
    console.log('  PASS: AC-ORG-02-06 verified with DB and audit diff.');

    // ========================================================================
    // AC-ORG-02-07: Setting is_default = true resets previous default
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-07: Setting branch 2 as default...');
    const resSetDefault = await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branch2Id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ is_default: true })
      .expect(200);

    assert.strictEqual(resSetDefault.body.data.is_default, true);
    const dbB1 = await prisma.branch.findUnique({ where: { id: branch1Id } });
    const dbB2 = await prisma.branch.findUnique({ where: { id: branch2Id } });
    assert.strictEqual(dbB1?.is_default, false);
    assert.strictEqual(dbB2?.is_default, true);
    console.log('  PASS: AC-ORG-02-07 verified atomic default branch reset.');

    // Reset default back to branch 1
    await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ is_default: true })
      .expect(200);

    // ========================================================================
    // AC-ORG-02-09 & 08: Deactivate non-default branch and activate
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-09: Deactivate branch 2...');
    const resDeact = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branch2Id}/deactivate`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resDeact.body.data.status, 'INACTIVE');
    const auditDeact = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'BRANCH_DEACTIVATED',
        entity_id: branch2Id,
      },
    });
    assert.ok(auditDeact);
    console.log('  PASS: AC-ORG-02-09 verified branch deactivation.');

    console.log('🧪 Testing AC-ORG-02-08: Activate branch 2...');
    const resAct = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branch2Id}/activate`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resAct.body.data.status, 'ACTIVE');
    console.log('  PASS: AC-ORG-02-08 verified branch activation.');

    // ========================================================================
    // AC-ORG-02-10: Reject deactivating default branch
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-10: Reject deactivating default branch...');
    const resDeactDefault = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branch1Id}/deactivate`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(400);

    assert.strictEqual(resDeactDefault.body.error.code, 'CANNOT_DEACTIVATE_DEFAULT_BRANCH');
    console.log('  PASS: AC-ORG-02-10 verified CANNOT_DEACTIVATE_DEFAULT_BRANCH.');

    // ========================================================================
    // AC-ORG-02-11: Scoped user attempting to access out-of-scope branch
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-11: Scoped user accessing unassigned branch 2 -> 403...');
    const resScopedDenied = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch2Id}`)
      .set('Authorization', `Bearer ${scopedTokenA}`)
      .expect(403);

    assert.strictEqual(resScopedDenied.body.error.code, 'FORBIDDEN');
    console.log('  PASS: AC-ORG-02-11 verified out-of-scope branch blocked with 403.');

    // Scoped user accessing assigned branch 1 -> 200 OK
    const resScopedAllowed = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${scopedTokenA}`)
      .expect(200);
    assert.strictEqual(resScopedAllowed.body.data.id, branch1Id);
    console.log('  PASS: Scoped user successfully accesses assigned branch.');

    // ========================================================================
    // FEAT-ORG-02 review P0 / BR-BRANCH-05: activate/deactivate/delete must
    // enforce the branch scope check, not only the iam:shop_config permission.
    // A scoped iam:shop_config holder may only mutate branches inside their
    // store_scopes; out-of-scope mutations must fail closed with 403.
    // ========================================================================
    const scopedConfigRoleRes = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: `Scoped Branch Config ${testSuffix}`,
        description: 'Scoped iam:shop_config role for branch mutation scope tests',
        permissions: ['iam:shop_config'],
      })
      .expect(201);
    const scopedConfigRoleId = scopedConfigRoleRes.body.data.role.id;

    const { token: scopedConfigTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'scoped_config_a',
      ['HCM-Q3'],
      scopedConfigRoleId
    );

    // Scoped config holder (scope HCM-Q3) must NOT activate out-of-scope branch 2 (HCM-TB)
    const resActOutOfScope = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branch2Id}/activate`)
      .set('Authorization', `Bearer ${scopedConfigTokenA}`)
      .expect(403);
    assert.strictEqual(resActOutOfScope.body.error.code, 'FORBIDDEN');
    console.log(
      '  PASS: Scoped iam:shop_config holder cannot activate an out-of-scope branch (403).'
    );

    // Scoped config holder must NOT deactivate out-of-scope branch 2 (HCM-TB)
    const resDeactOutOfScope = await request(app.getHttpServer())
      .post(`/api/v1/branches/${branch2Id}/deactivate`)
      .set('Authorization', `Bearer ${scopedConfigTokenA}`)
      .expect(403);
    assert.strictEqual(resDeactOutOfScope.body.error.code, 'FORBIDDEN');
    console.log(
      '  PASS: Scoped iam:shop_config holder cannot deactivate an out-of-scope branch (403).'
    );

    // Scoped config holder must NOT delete out-of-scope branch 2 (HCM-TB)
    const resDeleteOutOfScope = await request(app.getHttpServer())
      .delete(`/api/v1/branches/${branch2Id}`)
      .set('Authorization', `Bearer ${scopedConfigTokenA}`)
      .expect(403);
    assert.strictEqual(resDeleteOutOfScope.body.error.code, 'FORBIDDEN');
    // Branch 2 must still exist after the rejected delete
    const branch2AfterDeniedDelete = await prisma.branch.findUnique({
      where: { id: branch2Id },
    });
    assert.ok(branch2AfterDeniedDelete, 'Branch 2 must remain after a denied out-of-scope delete');
    console.log(
      '  PASS: Scoped iam:shop_config holder cannot delete an out-of-scope branch (403).'
    );

    // ========================================================================
    // FEAT-ORG-02 review P1: createBranch must respect store_scopes. A scoped
    // iam:shop_config holder cannot create a branch outside their scope.
    // ========================================================================
    const resCreateOutOfScope = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${scopedConfigTokenA}`)
      .send({
        name: 'Chi nhánh ngoài phạm vi',
        code: 'HCM-TB',
        address: 'Ngoài phạm vi',
      })
      .expect(403);
    assert.strictEqual(resCreateOutOfScope.body.error.code, 'FORBIDDEN');
    console.log(
      '  PASS: Scoped iam:shop_config holder cannot create an out-of-scope branch (403).'
    );

    // ========================================================================
    // FEAT-ORG-02 review round 2 Finding 3: createBranch/updateBranch with
    // is_default: true must NOT clear default status on out-of-scope branches.
    // An actor scoped to ['HCM-TB', 'HCM-NEW-SCOPED'] cannot create a branch with
    // is_default: true when the existing default branch (HCM-Q3) is outside scope.
    // Out-of-scope default branch must remain unchanged.
    // ========================================================================
    const { token: scopedOtherBranchTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'scoped_other_a',
      ['HCM-TB', 'HCM-NEW-SCOPED'],
      scopedConfigRoleId
    );

    // 1. Attempt createBranch with is_default: true while current default (HCM-Q3) is out-of-scope -> 403 FORBIDDEN
    const resCreateDefaultOutOfScope = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${scopedOtherBranchTokenA}`)
      .send({
        name: 'Chi nhánh Mới Có Default',
        code: 'HCM-NEW-SCOPED',
        is_default: true,
      })
      .expect(403);
    assert.strictEqual(resCreateDefaultOutOfScope.body.error.code, 'FORBIDDEN');

    // Verify out-of-scope default branch HCM-Q3 remains default and new branch was NOT created
    const createdBranchCheck = await prisma.branch.findFirst({
      where: { merchant_id: merchantIdA, code: 'HCM-NEW-SCOPED' },
    });
    assert.strictEqual(
      createdBranchCheck,
      null,
      'Branch must not be created when out-of-scope default cannot be cleared'
    );
    const branch1StillDefault = await prisma.branch.findUnique({
      where: { id: branch1Id },
    });
    assert.strictEqual(
      branch1StillDefault?.is_default,
      true,
      'Out-of-scope default branch must remain is_default: true'
    );
    console.log(
      '  PASS: createBranch with is_default=true rejected when existing default is out-of-scope (default unchanged).'
    );

    // 2. Attempt updateBranch with is_default: true on scoped branch (HCM-TB) while current default (HCM-Q3) is out-of-scope -> 403 FORBIDDEN
    const resUpdateDefaultOutOfScope = await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branch2Id}`)
      .set('Authorization', `Bearer ${scopedOtherBranchTokenA}`)
      .send({
        is_default: true,
      })
      .expect(403);
    assert.strictEqual(resUpdateDefaultOutOfScope.body.error.code, 'FORBIDDEN');

    // Verify branch 2 remains non-default and branch 1 remains default
    const branch2StillNonDefault = await prisma.branch.findUnique({
      where: { id: branch2Id },
    });
    assert.strictEqual(
      branch2StillNonDefault?.is_default,
      false,
      'Target branch must remain non-default after rejected patch'
    );
    const branch1DefaultAfterPatch = await prisma.branch.findUnique({
      where: { id: branch1Id },
    });
    assert.strictEqual(
      branch1DefaultAfterPatch?.is_default,
      true,
      'Out-of-scope default branch must remain is_default: true'
    );
    console.log(
      '  PASS: updateBranch with is_default=true rejected when existing default is out-of-scope (default unchanged).'
    );

    // ========================================================================
    // FEAT-ORG-02 review P1: GET /branches and GET /branches/:id require the
    // read guard. A WAREHOUSE role (no iam:shop_config, not in allow-list) must
    // be rejected with 403, while FINANCE (view-only allow-list) may read.
    // ========================================================================
    const resWarehouseListDenied = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .expect(403);
    assert.strictEqual(resWarehouseListDenied.body.error.code, 'FORBIDDEN');
    console.log('  PASS: WAREHOUSE role cannot read branch list (403 read guard).');

    const resWarehouseGetDenied = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .expect(403);
    assert.strictEqual(resWarehouseGetDenied.body.error.code, 'FORBIDDEN');
    console.log('  PASS: WAREHOUSE role cannot read branch detail (403 read guard).');

    // ========================================================================
    // FEAT-ORG-02 review round 2 Finding 2: A custom role named "Non-Finance"
    // (arbitrary display name containing "Finance") without code and without
    // iam:shop_config must NOT bypass the read guard.
    // Must be rejected with 403 for both list and detail endpoints.
    // ========================================================================
    const nonFinanceRoleRes = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: `Non-Finance Auditor ${testSuffix}`,
        description: 'Custom role with Non-Finance in display name but no code or iam:shop_config',
        permissions: ['order:view_create'],
      })
      .expect(201);
    const nonFinanceRoleId = nonFinanceRoleRes.body.data.role.id;

    const { token: nonFinanceTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'non_fin_a',
      ['*'],
      nonFinanceRoleId
    );

    const resNonFinanceListDenied = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${nonFinanceTokenA}`)
      .expect(403);
    assert.strictEqual(resNonFinanceListDenied.body.error.code, 'FORBIDDEN');
    console.log(
      '  PASS: Custom role named "Non-Finance" cannot read branch list (403 read guard).'
    );

    const resNonFinanceDetailDenied = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${nonFinanceTokenA}`)
      .expect(403);
    assert.strictEqual(resNonFinanceDetailDenied.body.error.code, 'FORBIDDEN');
    console.log(
      '  PASS: Custom role named "Non-Finance" cannot read branch detail (403 read guard).'
    );

    // View-only role (iam:shop_view in RBAC matrix) may read the list but the server
    // must report can_edit: false (no iam:shop_config).
    const financeRoleRes = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: `Finance Viewer ${testSuffix}`,
        description: 'View-only role with iam:shop_view for branch read test',
        permissions: ['iam:shop_view'],
      })
      .expect(201);
    const financeRoleId = financeRoleRes.body.data.role.id;

    const { token: financeTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'fin_a',
      [],
      financeRoleId
    );
    const resFinanceList = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${financeTokenA}`)
      .expect(200);
    assert.strictEqual(resFinanceList.body.success, true);
    assert.strictEqual(resFinanceList.body.data.can_edit, false);
    console.log('  PASS: View-only role reads branch list with server-derived can_edit=false.');

    // Owner (holds iam:shop_config) must receive can_edit: true on the list
    const resOwnerList = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    assert.strictEqual(resOwnerList.body.data.can_edit, true);
    console.log('  PASS: OWNER receives server-derived can_edit=true.');

    // Scoped iam:shop_config holder (custom role) must receive can_edit: true
    const resScopedConfigList = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${scopedConfigTokenA}`)
      .expect(200);
    assert.strictEqual(resScopedConfigList.body.data.can_edit, true);
    assert.strictEqual(resScopedConfigList.body.data.branches.length, 1);
    assert.strictEqual(resScopedConfigList.body.data.branches[0].code, 'HCM-Q3');
    console.log('  PASS: Scoped iam:shop_config holder gets can_edit=true and filtered list.');

    // ========================================================================
    // AC-ORG-02-12: Cross-tenant isolation
    // ========================================================================
    console.log(
      '🧪 Testing AC-ORG-02-12: Cross-tenant isolation (Owner B targeting Branch 1 of A)...'
    );
    const resCrossGet = await request(app.getHttpServer())
      .get(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .expect(404);

    assert.strictEqual(resCrossGet.body.error.code, 'BRANCH_NOT_FOUND');

    const resCrossPatch = await request(app.getHttpServer())
      .patch(`/api/v1/branches/${branch1Id}`)
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .send({ name: 'Malicious Tenant B rename' })
      .expect(404);

    assert.strictEqual(resCrossPatch.body.error.code, 'BRANCH_NOT_FOUND');
    const branch1Unmodified = await prisma.branch.findUnique({ where: { id: branch1Id } });
    assert.strictEqual(branch1Unmodified?.name, 'Chi Nhánh Quận 3 (Trụ Sở Chính)');
    console.log('  PASS: AC-ORG-02-12 verified cross-tenant isolation.');

    // ========================================================================
    // AC-ORG-02-13: Missing permission (WAREHOUSE role lacks iam:shop_config)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-13: User lacking iam:shop_config (WAREHOUSE) -> 403...');
    const resPerm = await request(app.getHttpServer())
      .post('/api/v1/branches')
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .send({ name: 'Warehouse unauthorized branch', code: 'WH-DENIED' })
      .expect(403);

    assert.strictEqual(resPerm.body.error.code, 'FORBIDDEN');
    console.log('  PASS: AC-ORG-02-13 verified RBAC permission check.');

    // ========================================================================
    // AC-ORG-02-14: Unauthenticated request rejection
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-14: Unauthenticated request...');
    await request(app.getHttpServer()).get('/api/v1/branches').expect(401);
    console.log('  PASS: AC-ORG-02-14 verified with 401.');

    // ========================================================================
    // AC-ORG-02-16: Route alias without /api/v1 prefix
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-16: Route alias /branches...');
    const resAlias = await request(app.getHttpServer())
      .get('/branches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resAlias.body.success, true);
    assert.strictEqual(resAlias.body.data.branches.length, 2);
    console.log('  PASS: AC-ORG-02-16 verified alias routing.');

    // ========================================================================
    // AC-ORG-02-15: Audit log inspection (verify all branch audit records)
    // ========================================================================
    console.log('🧪 Testing AC-ORG-02-15: Audit log security & masking...');
    const allAudits = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA, entity_type: 'branch' },
    });
    assert.ok(allAudits.length >= 3);
    for (const audit of allAudits) {
      const serialized = JSON.stringify(audit);
      assert.ok(
        !serialized.includes('0901234567'),
        'Plaintext phone 1 must not appear in audit log'
      );
      assert.ok(
        !serialized.includes('0908888999'),
        'Plaintext phone 2 must not appear in audit log'
      );
    }
    console.log('  PASS: AC-ORG-02-15 verified audit log masking.');

    // Real overlapping transactions: the privileged writer holds the tenant lock
    // and changes the default while the scoped request is entering its transaction.
    // The scoped request must re-read the committed default and leave it untouched.
    for (const operation of ['create', 'update'] as const) {
      const prefix = `RACE-${operation.toUpperCase()}`;
      const [current, target, outside] = await Promise.all(
        ['CURRENT', 'TARGET', 'OUTSIDE'].map((suffix) =>
          prisma.branch.create({
            data: { merchant_id: merchantIdA, code: `${prefix}-${suffix}`, name: suffix },
          })
        )
      );
      await prisma.branch.updateMany({
        where: { merchant_id: merchantIdA },
        data: { is_default: false },
      });
      await prisma.branch.update({ where: { id: current.id }, data: { is_default: true } });
      const { userId } = await setupUserSession(
        merchantIdA,
        RoleEnum.OPS_CSKH,
        `race_${operation}`,
        [current.code, target.code, `${prefix}-NEW`]
      );
      const actor = { userId, merchantId: merchantIdA, role: RoleEnum.OPS_CSKH };
      let entered!: () => void;
      const transactionEntered = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const db = new Proxy(prisma, {
        get(client, key) {
          if (key === '$transaction') {
            return (cb: any) =>
              client.$transaction(async (tx) => {
                entered();
                return cb(tx);
              });
          }
          return Reflect.get(client, key);
        },
      });
      const service = new BranchesService(db, app.get(RbacService));
      const correlationId = `race-${operation}-${testSuffix}`;
      let result!: Promise<unknown>;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantIdA}::uuid FOR NO KEY UPDATE`;
        await tx.branch.update({ where: { id: current.id }, data: { is_default: false } });
        await tx.branch.update({ where: { id: outside.id }, data: { is_default: true } });
        const pending =
          operation === 'create'
            ? service.createBranch(
                merchantIdA,
                actor,
                { name: 'Concurrent create', code: `${prefix}-NEW`, is_default: true },
                '',
                correlationId
              )
            : service.updateBranch(
                target.id,
                merchantIdA,
                actor,
                { is_default: true },
                '',
                correlationId
              );
        result = assert.rejects(
          pending,
          (err: any) => err.getStatus() === 403 && err.code === 'FORBIDDEN'
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            transactionEntered,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Scoped transaction did not start')), 3000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      });
      await result;
      const defaults = await prisma.branch.findMany({
        where: { merchant_id: merchantIdA, is_default: true },
      });
      assert.deepStrictEqual(
        defaults.map((branch) => branch.id),
        [outside.id]
      );
      assert.strictEqual(
        await prisma.branch.count({ where: { merchant_id: merchantIdA, code: `${prefix}-NEW` } }),
        0
      );
      assert.strictEqual(
        await prisma.auditLog.count({
          where: { merchant_id: merchantIdA, reason: `correlation_id:${correlationId}` },
        }),
        0
      );
    }

    console.log('================================================================');
    console.log('🎉 ALL FEAT-ORG-02 SUPERTEST CHECKS PASSED (AC-01..16)!');
    console.log('================================================================');
  } finally {
    // Cleanup ONLY fixture tenant rows. Never delete another tenant's audit rows.
    await prisma.auditLog.deleteMany({
      where: {
        merchant_id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await prisma.branch.deleteMany({
      where: {
        merchant_id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await prisma.deviceSession.deleteMany({
      where: {
        merchant_id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        merchant_id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        role: {
          merchant_id: {
            in: [merchantIdA, merchantIdB],
          },
        },
      },
    });
    await prisma.role.deleteMany({
      where: {
        merchant_id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await prisma.merchant.deleteMany({
      where: {
        id: {
          in: [merchantIdA, merchantIdB],
        },
      },
    });
    await app.close();
  }
}

runBranchesSupertestSuite().catch((err) => {
  console.error('Branches Supertest suite failed:', err);
  process.exit(1);
});
