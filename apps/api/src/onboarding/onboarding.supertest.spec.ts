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
import { RbacService, SYSTEM_ROLE_IDS } from '../rbac/rbac.service';
import { OnboardingStepId, OnboardingStepStatus, OnboardingOverallStatus } from './onboarding.dto';

async function runOnboardingSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - GUIDED ONBOARDING SUPERTEST SUITE (FEAT-ONB-01)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Onboarding Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Onboarding Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);

  let merchantIdA: string | undefined;
  let merchantIdB: string | undefined;
  let financeRoleId: string | undefined;
  let noPermRoleId: string | undefined;

  try {
    const tokenSecret = 'test-token-secret-for-onboarding-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Shop Alpha ${testSuffix}`,
          code: `ALPHA_${testSuffix}`,
          status: 'active',
          legal_name: null,
          tax_code: null,
        },
        {
          id: merchantIdB,
          name: `Shop Beta ${testSuffix}`,
          code: `BETA_${testSuffix}`,
          status: 'active',
          legal_name: null,
          tax_code: null,
        },
      ],
    });

    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      customRoleId?: string
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
          full_name: `Test User ${customRoleId ? 'FINANCE' : role}`,
          password_hash: 'hashed',
          role,
          warehouse_scopes: role === RoleEnum.OWNER ? ['*'] : [],
          custom_role_id: customRoleId || null,
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

    const ownerA = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner_a');
    const warehouseUserA = await setupUserSession(merchantIdA, RoleEnum.WAREHOUSE, 'wh_a');
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner_b');

    // Retrieve canonical iam:shop_view permission from RBAC seed
    const shopViewPerm = await prisma.permission.findUnique({
      where: { code: 'iam:shop_view' },
    });
    assert.ok(shopViewPerm, 'iam:shop_view permission must exist in DB');

    // Create custom Finance role for Merchant A WITH iam:shop_view attached
    financeRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: financeRoleId,
        merchant_id: merchantIdA,
        code: `FINANCE_${testSuffix}`,
        name: 'Tài chính Đối soát',
        description: 'Xem báo cáo tài chính và cấu hình',
        is_system: false,
      },
    });
    await prisma.rolePermission.create({
      data: {
        role_id: financeRoleId,
        permission_id: shopViewPerm.id,
      },
    });
    const financeUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'fin_a',
      financeRoleId
    );

    // Create unprivileged custom role with "FINANCE" name/code but ZERO registry permissions
    noPermRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: noPermRoleId,
        merchant_id: merchantIdA,
        code: `FINANCE_UNPRIVILEGED_${testSuffix}`,
        name: 'Nhân viên Tài chính Chưa Cấp Quyền',
        description: 'Role with finance substring but zero registry permissions',
        is_system: false,
      },
    });
    const unprivilegedFinanceUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'fin_unprivileged_a',
      noPermRoleId
    );

    const server = app.getHttpServer();

    // ------------------------------------------------------------------------
    // AC-ONB-01-01: Authenticated owner retrieves initial onboarding state
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-01: GET /api/v1/onboarding initial state...');
    const resInit = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resInit.body.success, true);
    assert.strictEqual(resInit.body.data.merchant_id, merchantIdA);
    assert.strictEqual(resInit.body.data.status, OnboardingOverallStatus.IN_PROGRESS);
    assert.strictEqual(resInit.body.data.current_step, OnboardingStepId.SHOP_PROFILE);
    assert.strictEqual(resInit.body.data.progress_percentage, 0);
    assert.strictEqual(resInit.body.data.steps.length, 6);
    console.log('✓ AC-ONB-01-01 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-04: Cannot complete WAREHOUSE before prerequisite SHOP_PROFILE
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-04: STEP_BLOCKED on premature WAREHOUSE complete...');
    const resBlocked = await request(server)
      .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        data: {
          name: 'Kho Tân Bình',
          phone: '0901234567',
          address: '123 Cộng Hòa, Tân Bình, TP.HCM',
          district: 'Tan Binh',
          city: 'Ho Chi Minh',
        },
      })
      .expect(400);

    assert.strictEqual(resBlocked.body.error.code, 'STEP_BLOCKED');
    console.log('✓ AC-ONB-01-04 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-14: Invalid warehouse payload validation
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-14: VALIDATION_ERROR on invalid warehouse payload...');
    const resValErr = await request(server)
      .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        data: {
          name: 'A',
          phone: '12345',
          address: 'ab',
          district: 'Tan Binh',
          city: 'Ho Chi Minh',
        },
      })
      .expect(400);

    assert.strictEqual(resValErr.body.error.code, 'VALIDATION_ERROR');
    console.log('✓ AC-ONB-01-14 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-02: Complete SHOP_PROFILE step
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-02: Complete SHOP_PROFILE step...');
    const resStep1 = await request(server)
      .post('/api/v1/onboarding/steps/SHOP_PROFILE/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({})
      .expect(200);

    assert.strictEqual(resStep1.body.success, true);
    assert.strictEqual(resStep1.body.data.completed_required_steps, 1);
    assert.strictEqual(resStep1.body.data.progress_percentage, 25);

    // Verify audit log entry
    const auditStep1 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'ONBOARDING_STEP_COMPLETED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditStep1);
    assert.strictEqual((auditStep1.new_value as any)?.step_id, OnboardingStepId.SHOP_PROFILE);
    console.log('✓ AC-ONB-01-02 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-03: Complete WAREHOUSE step with warehouse payload
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-03: Complete WAREHOUSE step with payload...');
    const resStep2 = await request(server)
      .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        data: {
          name: 'Kho Tân Bình',
          phone: '0901234567',
          address: '123 Cộng Hòa, Tân Bình, TP.HCM',
          district: 'Tan Binh',
          city: 'Ho Chi Minh',
        },
      })
      .expect(200);

    assert.strictEqual(resStep2.body.success, true);
    assert.strictEqual(resStep2.body.data.completed_required_steps, 2);
    assert.strictEqual(resStep2.body.data.progress_percentage, 50);

    // Verify audit log masks phone
    const auditStep2 = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'ONBOARDING_STEP_COMPLETED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditStep2);
    const warehouseId = resStep2.body.data.steps.find(
      (s: any) => s.id === OnboardingStepId.WAREHOUSE
    ).data.warehouse_id;
    const persistedWarehouse = await prisma.warehouse.findFirstOrThrow({
      where: { id: warehouseId, merchant_id: merchantIdA },
    });
    assert.strictEqual(persistedWarehouse.address_line, '123 Cộng Hòa, Tân Bình, TP.HCM');
    assert.strictEqual(persistedWarehouse.contact_phone, '0901234567');
    assert.strictEqual(persistedWarehouse.is_default, true);
    assert.strictEqual((auditStep2.new_value as any)?.data?.warehouse_id, warehouseId);
    const warehouseAudit = await prisma.auditLog.findFirstOrThrow({
      where: { merchant_id: merchantIdA, entity_id: warehouseId, action: 'WAREHOUSE_CREATED' },
    });
    assert.strictEqual((warehouseAudit.new_value as any).contact_phone, '090****567');
    assert.ok(!JSON.stringify(auditStep2.new_value).includes('0901234567'));
    console.log('✓ AC-ONB-01-03 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-06: Cannot skip required CARRIER_ACCOUNT step
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-06: CANNOT_SKIP_REQUIRED_STEP...');
    const resSkipReq = await request(server)
      .post('/api/v1/onboarding/steps/CARRIER_ACCOUNT/skip')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(400);

    assert.strictEqual(resSkipReq.body.error.code, 'CANNOT_SKIP_REQUIRED_STEP');
    console.log('✓ AC-ONB-01-06 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-05: Skip optional INVITE_USERS step
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-05: Skip optional INVITE_USERS step...');
    const resSkipOpt = await request(server)
      .post('/api/v1/onboarding/steps/INVITE_USERS/skip')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resSkipOpt.body.success, true);
    const inviteStep = resSkipOpt.body.data.steps.find(
      (s: any) => s.id === OnboardingStepId.INVITE_USERS
    );
    assert.strictEqual(inviteStep.status, OnboardingStepStatus.SKIPPED);
    console.log('✓ AC-ONB-01-05 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-09: Cannot dismiss while required steps are incomplete
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-09: ONBOARDING_INCOMPLETE on premature dismiss...');
    const resDismissFail = await request(server)
      .post('/api/v1/onboarding/dismiss')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(400);

    assert.strictEqual(resDismissFail.body.error.code, 'ONBOARDING_INCOMPLETE');
    console.log('✓ AC-ONB-01-09 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-07: Complete all remaining required steps -> status COMPLETED
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-07: Complete all required steps -> COMPLETED...');
    await request(server)
      .post('/api/v1/onboarding/steps/CARRIER_ACCOUNT/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({})
      .expect(200);

    const resCompleted = await request(server)
      .post('/api/v1/onboarding/steps/TEST_ORDER/complete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({})
      .expect(200);

    assert.strictEqual(resCompleted.body.data.status, OnboardingOverallStatus.COMPLETED);
    assert.strictEqual(resCompleted.body.data.progress_percentage, 100);
    assert.ok(resCompleted.body.data.completed_at);
    console.log('✓ AC-ONB-01-07 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-08: Dismiss completed onboarding
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-08: Dismiss completed onboarding...');
    const resDismiss = await request(server)
      .post('/api/v1/onboarding/dismiss')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resDismiss.body.data.status, OnboardingOverallStatus.DISMISSED);
    console.log('✓ AC-ONB-01-08 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-10: Reset onboarding
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-10: Reset onboarding...');
    await prisma.merchant.update({
      where: { id: merchantIdA },
      data: {
        legal_name: 'Configured merchant',
        tax_code: testSuffix,
        operating_notes: 'Configured defaults',
      },
    });
    const resReset = await request(server)
      .post('/api/v1/onboarding/reset')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resReset.body.data.status, OnboardingOverallStatus.IN_PROGRESS);
    assert.strictEqual(resReset.body.data.progress_percentage, 0);

    // Verify reset sticks on immediate subsequent GET
    const resGetAfterReset = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resGetAfterReset.body.data.status, OnboardingOverallStatus.IN_PROGRESS);
    assert.strictEqual(resGetAfterReset.body.data.progress_percentage, 0);
    console.log('✓ AC-ONB-01-10 passed (reset persisted and verified on subsequent GET)');

    const cleared = await prisma.onboardingState.findUniqueOrThrow({
      where: { merchant_id: merchantIdA },
    });
    assert.deepStrictEqual(cleared.completed_steps, []);
    assert.deepStrictEqual(cleared.skipped_steps, []);
    assert.strictEqual(cleared.step_data, null);
    assert.strictEqual(cleared.completed_at, null);
    assert.strictEqual(cleared.current_step, OnboardingStepId.SHOP_PROFILE);
    assert.ok(cleared.reset_at);
    assert.strictEqual(await prisma.warehouse.count({ where: { merchant_id: merchantIdA } }), 1);

    // ------------------------------------------------------------------------
    // AC-ONB-01-11: User lacking iam:shop_config rejected with 403 FORBIDDEN
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-11: 403 FORBIDDEN for WAREHOUSE role on mutation...');
    const resForbidden = await request(server)
      .post('/api/v1/onboarding/steps/SHOP_PROFILE/complete')
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .send({})
      .expect(403);

    assert.strictEqual(resForbidden.body.error.code, 'FORBIDDEN');
    console.log('✓ AC-ONB-01-11 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-12: Unauthenticated request rejected with 401 UNAUTHORIZED
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-12: 401 UNAUTHORIZED on unauthenticated request...');
    await request(server).get('/api/v1/onboarding').expect(401);
    console.log('✓ AC-ONB-01-12 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-13: Cross-tenant isolation (Merchant B is isolated from A)
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-13: Strict tenant scoping & mutation isolation...');
    const resMerchantB = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${ownerB.token}`)
      .expect(200);

    assert.strictEqual(resMerchantB.body.data.merchant_id, merchantIdB);
    assert.notStrictEqual(resMerchantB.body.data.merchant_id, merchantIdA);

    // Tenant B mutates its own step
    const resMutateB = await request(server)
      .post('/api/v1/onboarding/steps/SHOP_PROFILE/complete')
      .set('Authorization', `Bearer ${ownerB.token}`)
      .send({})
      .expect(200);

    assert.strictEqual(resMutateB.body.data.merchant_id, merchantIdB);
    assert.strictEqual(resMutateB.body.data.completed_required_steps, 1);

    // Tenant A's state is completely unaffected by Tenant B's mutation
    const resCheckA = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(resCheckA.body.data.merchant_id, merchantIdA);
    assert.strictEqual(resCheckA.body.data.progress_percentage, 0);
    console.log('✓ AC-ONB-01-13 passed');

    // ------------------------------------------------------------------------
    // AC-ONB-01-15: RBAC registry authorization (iam:shop_view view-only, unprivileged role denied)
    // ------------------------------------------------------------------------
    console.log('Testing AC-ONB-01-15: RBAC registry permissions guard (view-only vs denied)...');
    // 1. Role with iam:shop_view can GET view-only
    const resFinGet = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${financeUserA.token}`)
      .expect(200);

    assert.strictEqual(resFinGet.body.success, true);
    assert.strictEqual(resFinGet.body.data.can_edit, false);

    // 2. Role with iam:shop_view cannot mutate
    const resFinMutate = await request(server)
      .post('/api/v1/onboarding/steps/SHOP_PROFILE/complete')
      .set('Authorization', `Bearer ${financeUserA.token}`)
      .send({})
      .expect(403);

    assert.strictEqual(resFinMutate.body.error.code, 'FORBIDDEN');

    // 3. Unprivileged role (even with "FINANCE" in name/code) without iam:shop_view is denied with 403
    const resUnprivGet = await request(server)
      .get('/api/v1/onboarding')
      .set('Authorization', `Bearer ${unprivilegedFinanceUserA.token}`)
      .expect(403);

    assert.strictEqual(resUnprivGet.body.error.code, 'FORBIDDEN');
    console.log(
      '✓ AC-ONB-01-15 passed (RBAC registry permissions strictly enforced; name/code substrings ignored)'
    );

    console.log('================================================================');
    console.log('ALL 15 GUIDED ONBOARDING SUPERTEST ACCEPTANCE CRITERIA PASSED!');
    console.log('================================================================');
    // Concurrent transactions must preserve both completions, skip and JSON data.
    const concurrent = await Promise.all([
      request(server)
        .post('/api/v1/onboarding/steps/SHOP_PROFILE/complete')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ data: { legal_name: 'Concurrent profile' } })
        .expect(200),
      request(server)
        .post('/api/v1/onboarding/steps/OPERATING_DEFAULTS/complete')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ data: { default_fee_payer: 'SHOP' } })
        .expect(200),
      request(server)
        .post('/api/v1/onboarding/steps/INVITE_USERS/skip')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .expect(200),
    ]);
    assert.strictEqual(concurrent.length, 3);
    const persisted = await prisma.onboardingState.findUniqueOrThrow({
      where: { merchant_id: merchantIdB },
    });
    assert.ok(persisted.completed_steps.includes(OnboardingStepId.SHOP_PROFILE));
    assert.ok(persisted.completed_steps.includes(OnboardingStepId.OPERATING_DEFAULTS));
    assert.ok(persisted.skipped_steps.includes(OnboardingStepId.INVITE_USERS));
    assert.strictEqual((persisted.step_data as any).operating_defaults.default_fee_payer, 'SHOP');
    assert.strictEqual((persisted.step_data as any).shop_profile.legal_name, 'Concurrent profile');

    const validWarehouse: Record<string, any> = {
      name: 'Warehouse',
      phone: '0901234567',
      address: '123 Street',
      district: 'District',
      city: 'City',
    };
    for (const field of Object.keys(validWarehouse)) {
      const partial = { ...validWarehouse };
      delete partial[field];
      for (const data of [partial, { warehouse: partial }]) {
        const rejected = await request(server)
          .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
          .set('Authorization', `Bearer ${ownerB.token}`)
          .send({ data })
          .expect(400);
        assert.strictEqual(rejected.body.error.code, 'VALIDATION_ERROR');
        assert.ok(rejected.body.error.fields.some((error: any) => error.field === field));
      }
    }
    // Shop config permission alone cannot bypass warehouse scope.
    await prisma.user.update({ where: { id: ownerB.userId }, data: { warehouse_scopes: [] } });
    const deniedWarehouse = await request(server)
      .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
      .set('Authorization', `Bearer ${ownerB.token}`)
      .send({ data: validWarehouse })
      .expect(403);
    assert.strictEqual(deniedWarehouse.body.error.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
    assert.strictEqual(await prisma.warehouse.count({ where: { merchant_id: merchantIdB } }), 0);
    assert.strictEqual(
      await prisma.auditLog.count({
        where: { merchant_id: merchantIdB, action: 'WAREHOUSE_CREATED' },
      }),
      0
    );
    const afterDenied = await prisma.onboardingState.findUniqueOrThrow({
      where: { merchant_id: merchantIdB },
    });
    assert.ok(!afterDenied.completed_steps.includes(OnboardingStepId.WAREHOUSE));
    await prisma.user.update({ where: { id: ownerB.userId }, data: { warehouse_scopes: ['*'] } });
    const retries = await Promise.all([
      request(server)
        .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ data: { warehouse: validWarehouse } })
        .expect(200),
      request(server)
        .post('/api/v1/onboarding/steps/WAREHOUSE/complete')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ data: validWarehouse })
        .expect(200),
    ]);
    const warehouseIds = retries.map(
      (response) =>
        response.body.data.steps.find((step: any) => step.id === OnboardingStepId.WAREHOUSE).data
          .warehouse_id
    );
    assert.strictEqual(warehouseIds[0], warehouseIds[1]);
    assert.strictEqual(await prisma.warehouse.count({ where: { merchant_id: merchantIdB } }), 1);
    assert.strictEqual(await prisma.warehouse.count({ where: { merchant_id: merchantIdA } }), 1);
    const saved = await prisma.warehouse.findFirstOrThrow({
      where: { id: warehouseIds[0], merchant_id: merchantIdB },
    });
    assert.strictEqual(saved.address_line, validWarehouse.address);
    assert.strictEqual(saved.is_default, true);
    assert.strictEqual(
      await prisma.auditLog.count({
        where: { merchant_id: merchantIdB, action: 'WAREHOUSE_CREATED' },
      }),
      1
    );
  } finally {
    if (prisma) {
      const createdMerchantIds = [merchantIdA, merchantIdB].filter(
        (id): id is string => typeof id === 'string'
      );
      const createdRoleIds = [financeRoleId, noPermRoleId].filter(
        (id): id is string => typeof id === 'string'
      );

      if (createdMerchantIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: { merchant_id: { in: createdMerchantIds } },
        });
        await prisma.warehouse.deleteMany({ where: { merchant_id: { in: createdMerchantIds } } });
        await prisma.onboardingState.deleteMany({
          where: { merchant_id: { in: createdMerchantIds } },
        });
        await prisma.deviceSession.deleteMany({
          where: { merchant_id: { in: createdMerchantIds } },
        });
        await prisma.user.deleteMany({
          where: { merchant_id: { in: createdMerchantIds } },
        });
      }
      if (createdRoleIds.length > 0) {
        await prisma.rolePermission.deleteMany({
          where: { role_id: { in: createdRoleIds } },
        });
        await prisma.role.deleteMany({
          where: { id: { in: createdRoleIds } },
        });
      }
      if (createdMerchantIds.length > 0) {
        await prisma.merchant.deleteMany({
          where: { id: { in: createdMerchantIds } },
        });
      }
    }
    await app.close();
  }
}

if (require.main === module) {
  runOnboardingSupertestSuite().catch((err) => {
    console.error('Supertest suite error:', err);
    process.exit(1);
  });
}
