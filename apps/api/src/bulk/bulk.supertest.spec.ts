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
import { BulkItemStatus } from '@shipde/contracts';

async function runBulkSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - BULK ACTIONS SUPERTEST SUITE (FEAT-COM-03)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Bulk Actions Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Bulk Actions Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

  try {
    const tokenSecret = 'test-token-secret-for-bulk-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Bulk Shop Alpha ${testSuffix}`,
          code: `BULK_A_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP BULK ALPHA',
          tax_code: '0399887766',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          default_fee_payer: 'SHOP',
          default_weight_unit: 'g',
          auto_routing_enabled: false,
        },
        {
          id: merchantIdB,
          name: `Bulk Shop Beta ${testSuffix}`,
          code: `BULK_B_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP BULK BETA',
          tax_code: '0199887766',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          default_fee_payer: 'SHOP',
          default_weight_unit: 'g',
          auto_routing_enabled: false,
        },
      ],
    });

    // Helper to create user + session token
    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      storeScopes: string[] = ['*'],
      warehouseScopes: string[] = ['*']
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
          email: `bulk_${emailSuffix}_${testSuffix}@shipde.vn`,
          full_name: `Bulk User ${role}`,
          phone: '0901234567',
          password_hash: 'hashed',
          role,
          status: 'active',
          store_scopes: storeScopes,
          warehouse_scopes: warehouseScopes,
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

    const { userId: ownerAId, token: ownerTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.OWNER,
      'owner_a'
    );

    const { userId: staffAId, token: staffTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'staff_scoped_a',
      ['branch-north'],
      ['wh-north']
    );

    const { userId: staffBId, token: staffTokenB } = await setupUserSession(
      merchantIdB,
      RoleEnum.OPS_CSKH,
      'staff_b'
    );

    // Create target users in Merchant A
    const targetUser1Id = randomUUID();
    const targetUser2Id = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: targetUser1Id,
          merchant_id: merchantIdA,
          email: `target1_${testSuffix}@gumac.vn`,
          phone: '0901111111',
          full_name: 'Target User 1 Suspended',
          password_hash: 'hashed',
          role: RoleEnum.OPS_CSKH,
          status: 'suspended',
          store_scopes: ['branch-north'],
          warehouse_scopes: ['wh-north'],
        },
        {
          id: targetUser2Id,
          merchant_id: merchantIdA,
          email: `target2_${testSuffix}@gumac.vn`,
          phone: '0902222222',
          full_name: 'Target User 2 Active',
          password_hash: 'hashed',
          role: RoleEnum.OPS_CSKH,
          status: 'active',
          store_scopes: ['branch-south'],
          warehouse_scopes: ['wh-south'],
        },
      ],
    });

    // Create target user in Merchant B (for tenant isolation test)
    const targetUserBId = randomUUID();
    await prisma.user.create({
      data: {
        id: targetUserBId,
        merchant_id: merchantIdB,
        email: `target_b_${testSuffix}@other.vn`,
        phone: '0903333333',
        full_name: 'Target User Merchant B',
        password_hash: 'hashed',
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
      },
    });

    // Create target branches in Merchant A
    const branch1Id = randomUUID();
    const branch2Id = randomUUID();
    await prisma.branch.createMany({
      data: [
        {
          id: branch1Id,
          merchant_id: merchantIdA,
          name: `Branch North ${testSuffix}`,
          code: `BN_${testSuffix}`,
          status: 'INACTIVE',
          address: '123 North St, HK, HN',
          phone: '0905555555',
          is_default: false,
        },
        {
          id: branch2Id,
          merchant_id: merchantIdA,
          name: `Branch South ${testSuffix}`,
          code: `BS_${testSuffix}`,
          status: 'ACTIVE',
          address: '456 South St, Q1, HCM',
          phone: '0906666666',
          is_default: false,
        },
      ],
    });

    // Create target warehouse in Merchant A
    const warehouse1Id = randomUUID();
    await prisma.warehouse.create({
      data: {
        id: warehouse1Id,
        merchant_id: merchantIdA,
        name: `Warehouse Hub ${testSuffix}`,
        code: `WH_${testSuffix}`,
        status: 'inactive',
        contact_name: 'Logistics Lead',
        contact_phone: '0907777777',
        contact_email: `wh_${testSuffix}@gumac.vn`,
        address_line: '789 Logistics Park',
        district: 'Thu An',
        city: 'Binh Duong',
        address_json: {
          line: '789 Logistics Park',
          district: 'Thu An',
          city: 'Binh Duong',
        },
        is_default: false,
      },
    });

    // ========================================================================
    // 1. Unauthenticated request check (401)
    // ========================================================================
    console.log('🧪 Testing 401 UNAUTHORIZED without token...');
    await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [targetUser1Id],
      })
      .expect(401);
    console.log('  PASS: 401 rejected without token.');

    // ========================================================================
    // 2. DTO Validation checks (400)
    // ========================================================================
    console.log('🧪 Testing 400 VALIDATION_ERROR on unsupported entity (orders)...');
    const resOrders = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'orders',
        action: 'activate',
        ids: [targetUser1Id],
      })
      .expect(400);
    assert.strictEqual(resOrders.body.error.code, 'UNSUPPORTED_BULK_ENTITY');
    console.log('  PASS: Orders blocked with UNSUPPORTED_BULK_ENTITY.');

    console.log('🧪 Testing 400 VALIDATION_ERROR on empty ids array...');
    const resEmptyIds = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [],
      })
      .expect(400);
    assert.strictEqual(resEmptyIds.body.error.code, 'VALIDATION_ERROR');
    console.log('  PASS: Empty IDs rejected with 400.');

    console.log('🧪 Testing 400 CONFIRMATION_REQUIRED on deactivate without confirm: true...');
    const resConfirmReq = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'deactivate',
        ids: [targetUser2Id],
      })
      .expect(400);
    assert.strictEqual(resConfirmReq.body.error.code, 'CONFIRMATION_REQUIRED');
    console.log('  PASS: Destructive deactivate blocked without confirmation.');

    // ========================================================================
    // 3. AC-COM-03-01: Bulk activate users
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-01: Bulk activate users...');
    const resActivateUsers = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [targetUser1Id],
      })
      .expect(200);

    assert.strictEqual(resActivateUsers.body.data.total_count, 1);
    assert.strictEqual(resActivateUsers.body.data.success_count, 1);
    assert.strictEqual(resActivateUsers.body.data.failure_count, 0);
    assert.strictEqual(resActivateUsers.body.data.is_partial_failure, false);
    assert.strictEqual(resActivateUsers.body.data.results[0].status, BulkItemStatus.SUCCEEDED);

    const user1InDb = await prisma.user.findUnique({ where: { id: targetUser1Id } });
    assert.strictEqual(user1InDb?.status, 'active');
    console.log('  PASS: AC-COM-03-01 verified successfully.');

    // ========================================================================
    // 4. AC-COM-03-02: Partial failure with truthful result
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-02: Partial failure (valid ID + non-existent ID)...');
    const nonExistentUserId = randomUUID();
    const resPartial = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [targetUser1Id, nonExistentUserId],
      })
      .expect(200);

    assert.strictEqual(resPartial.body.data.total_count, 2);
    assert.strictEqual(resPartial.body.data.success_count, 1);
    assert.strictEqual(resPartial.body.data.failure_count, 1);
    assert.strictEqual(resPartial.body.data.is_partial_failure, true);
    assert.deepStrictEqual(resPartial.body.data.succeeded_ids, [targetUser1Id]);
    assert.deepStrictEqual(resPartial.body.data.failed_ids, [nonExistentUserId]);
    const failedItem = resPartial.body.data.results.find((r: any) => r.id === nonExistentUserId);
    assert.strictEqual(failedItem?.error?.code, 'ITEM_NOT_FOUND');
    console.log('  PASS: AC-COM-03-02 verified partial failure reporting.');

    // ========================================================================
    // 5. AC-COM-03-03: Tenant Isolation
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-03: Tenant isolation on cross-tenant user...');
    const resCrossTenant = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [targetUserBId],
      })
      .expect(200);

    assert.strictEqual(resCrossTenant.body.data.failure_count, 1);
    assert.strictEqual(resCrossTenant.body.data.results[0].error.code, 'ITEM_NOT_FOUND');
    // Ensure Merchant B target user was untouched
    const targetBInDb = await prisma.user.findUnique({ where: { id: targetUserBId } });
    assert.strictEqual(targetBInDb?.merchant_id, merchantIdB);
    console.log('  PASS: AC-COM-03-03 tenant isolation guaranteed.');

    // ========================================================================
    // 6. AC-COM-03-06 & 07: Concurrent Idempotency Replay and Conflict Detection
    // ========================================================================
    console.log(
      '🧪 Testing AC-COM-03-06 & 07: Concurrent idempotency replay and conflict detection...'
    );
    const idempotencyKey = `idemp-bulk-${Date.now()}`;
    const initialPayload = {
      entity_type: 'branches',
      action: 'activate',
      ids: [branch1Id],
    };

    // Issue concurrent requests with identical payload & key (Finding 5)
    const [resIdemp1, resIdemp2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bulk-actions')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(initialPayload),
      request(app.getHttpServer())
        .post('/api/v1/bulk-actions')
        .set('Authorization', `Bearer ${ownerTokenA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(initialPayload),
    ]);

    assert.strictEqual(resIdemp1.status, 200);
    assert.strictEqual(resIdemp2.status, 200);
    assert.strictEqual(resIdemp1.body.data.batch_id, resIdemp2.body.data.batch_id);
    assert.strictEqual(resIdemp1.body.data.success_count, 1);
    assert.strictEqual(resIdemp2.body.data.success_count, 1);

    // Finding 7: independently count mutations & audit events to prove single execution
    const batches = await prisma.bulkActionBatch.findMany({
      where: {
        merchant_id: merchantIdA,
        idempotency_key: idempotencyKey,
      },
    });
    assert.strictEqual(
      batches.length,
      1,
      'concurrent requests must create exactly one batch record'
    );

    const branchAuditLogs = await prisma.auditLog.findMany({
      where: {
        merchant_id: merchantIdA,
        action: 'BRANCH_ACTIVATED',
        entity_id: branch1Id,
      },
    });
    assert.strictEqual(
      branchAuditLogs.length,
      1,
      'concurrent requests must trigger exactly one audit mutation'
    );

    // Conflict test: Send altered payload with SAME idempotency key -> must return 409
    const resIdempConflict = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        entity_type: 'branches',
        action: 'activate',
        ids: [branch2Id], // altered payload
      })
      .expect(409);

    assert.strictEqual(resIdempConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    console.log('  PASS: AC-COM-03-06 & 07 concurrent idempotency and conflict verified.');

    // ========================================================================
    // 7. AC-COM-03-09: Destructive action confirmation (confirm: true)
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-09: Deactivate with confirm: true...');
    const resDeactivateBranch = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'branches',
        action: 'deactivate',
        ids: [branch2Id],
        confirm: true,
      })
      .expect(200);

    assert.strictEqual(resDeactivateBranch.body.data.success_count, 1);
    const branch2InDb = await prisma.branch.findUnique({ where: { id: branch2Id } });
    assert.strictEqual(branch2InDb?.status, 'INACTIVE');
    console.log('  PASS: Destructive action confirmed and executed.');

    // ========================================================================
    // 8. AC-COM-03-10: Self-deactivation and sole owner protection
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-10: Self-deactivation protection...');
    const resSelfDeact = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'deactivate',
        ids: [ownerAId],
        confirm: true,
      })
      .expect(200);

    assert.strictEqual(resSelfDeact.body.data.failure_count, 1);
    assert.strictEqual(resSelfDeact.body.data.results[0].error.code, 'SELF_SUSPENSION_PROHIBITED');
    console.log('  PASS: Self-deactivation blocked.');

    // Sole owner protection: Distinct caller with iam:manage_users attempts to deactivate sole active owner
    // Must reach database transaction and fail with CANNOT_REMOVE_LAST_OWNER (Finding 5)
    console.log(
      '🧪 Testing AC-COM-03-10: Sole active owner protection (CANNOT_REMOVE_LAST_OWNER)...'
    );
    const { userId: ownerA2Id, token: ownerTokenA2 } = await setupUserSession(
      merchantIdA,
      RoleEnum.OWNER,
      'owner_a2'
    );

    // Deactivate ownerA2 first so ownerAId becomes the sole active owner
    const resDeactOwner2 = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'deactivate',
        ids: [ownerA2Id],
        confirm: true,
      })
      .expect(200);

    assert.strictEqual(resDeactOwner2.body.data.success_count, 1);

    // Create a delegated admin user in merchantIdA holding wildcard scopes and iam:manage_users
    const iamPerm = await prisma.permission.findUnique({ where: { code: 'iam:manage_users' } });
    let adminCustomRoleId: string | undefined = undefined;
    if (iamPerm) {
      const customRole = await prisma.role.create({
        data: {
          merchant_id: merchantIdA,
          name: `Delegated Admin Sole Owner Test ${testSuffix}`,
          description: 'Custom role with iam:manage_users for sole owner testing',
          permissions: {
            create: [{ permission: { connect: { id: iamPerm.id } } }],
          },
        },
      });
      adminCustomRoleId = customRole.id;
    }

    const { userId: adminUserId, token: adminToken } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'admin_user_sole_owner',
      ['*'],
      ['*']
    );

    if (adminCustomRoleId) {
      await prisma.user.update({
        where: { id: adminUserId },
        data: { custom_role_id: adminCustomRoleId },
      });
    }

    const resSoleOwner = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        entity_type: 'users',
        action: 'deactivate',
        ids: [ownerAId],
        confirm: true,
      })
      .expect(200);

    assert.strictEqual(resSoleOwner.body.data.failure_count, 1);
    assert.strictEqual(resSoleOwner.body.data.results[0].error.code, 'CANNOT_REMOVE_LAST_OWNER');
    console.log('  PASS: Sole active owner deactivation blocked with CANNOT_REMOVE_LAST_OWNER.');

    // ========================================================================
    // 8b. Per-item savepoint isolation (real PostgreSQL): one item's database
    //     failure must not abort the shared transaction (review Finding 3)
    // ========================================================================
    console.log('🧪 Testing per-item savepoint isolation with a real database error...');
    const savepointFailUserId = randomUUID();
    const savepointHealthyUserId = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: savepointFailUserId,
          merchant_id: merchantIdA,
          email: `spfail_${testSuffix}@gumac.vn`,
          phone: '0909000001',
          full_name: 'Savepoint Fail Target',
          password_hash: 'hashed',
          role: RoleEnum.OPS_CSKH,
          status: 'suspended',
          store_scopes: ['branch-north'],
          warehouse_scopes: ['wh-north'],
        },
        {
          id: savepointHealthyUserId,
          merchant_id: merchantIdA,
          email: `sphlth_${testSuffix}@gumac.vn`,
          phone: '0909000002',
          full_name: 'Savepoint Healthy Target',
          password_hash: 'hashed',
          role: RoleEnum.OPS_CSKH,
          status: 'suspended',
          store_scopes: ['branch-north'],
          warehouse_scopes: ['wh-north'],
        },
      ],
    });

    // Test-owned trigger aborts only the failing target's UPDATE; dropped right
    // after the assertions (and again in cleanup) so no untracked DB objects remain.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION bulk_test_item_failure_guard(target uuid) RETURNS trigger AS $fn$
       BEGIN
         IF NEW.id = target THEN
           RAISE EXCEPTION 'simulated per-item database failure';
         END IF;
         RETURN NEW;
       END;
       $fn$ LANGUAGE plpgsql`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER bulk_test_item_fail_trg BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION bulk_test_item_failure_guard('${savepointFailUserId}')`
    );

    const savepointKey = `idemp-bulk-savepoint-${Date.now()}`;
    const resSavepoint = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('Idempotency-Key', savepointKey)
      .send({
        entity_type: 'users',
        action: 'activate',
        ids: [savepointFailUserId, savepointHealthyUserId],
      })
      .expect(200);

    // Truthful partial outcome: the database failure of item 1 does not abort
    // the shared transaction or the healthy item.
    assert.strictEqual(resSavepoint.body.data.total_count, 2);
    assert.strictEqual(resSavepoint.body.data.success_count, 1);
    assert.strictEqual(resSavepoint.body.data.failure_count, 1);
    assert.deepStrictEqual(resSavepoint.body.data.succeeded_ids, [savepointHealthyUserId]);
    assert.deepStrictEqual(resSavepoint.body.data.failed_ids, [savepointFailUserId]);
    const spFailedItem = resSavepoint.body.data.results.find(
      (r: any) => r.id === savepointFailUserId
    );
    assert.ok(
      spFailedItem?.error?.message?.includes('simulated per-item database failure'),
      'failed item must surface the database error'
    );

    // The failed item's aborted update is rolled back; the healthy item persists
    const spFailInDb = await prisma.user.findUnique({ where: { id: savepointFailUserId } });
    assert.strictEqual(
      spFailInDb?.status,
      'suspended',
      'failed item update must be rolled back by its savepoint'
    );
    const spHealthyInDb = await prisma.user.findUnique({ where: { id: savepointHealthyUserId } });
    assert.strictEqual(
      spHealthyInDb?.status,
      'active',
      'healthy item must persist despite the sibling item failure'
    );

    // Exactly one audit entry: the healthy item's (the failed item aborted first)
    const spAudit = await prisma.auditLog.findMany({
      where: {
        merchant_id: merchantIdA,
        action: 'USER_ACTIVATED',
        entity_id: { in: [savepointFailUserId, savepointHealthyUserId] },
      },
    });
    assert.strictEqual(spAudit.length, 1, 'only the healthy item may be audited');
    assert.strictEqual(spAudit[0].entity_id, savepointHealthyUserId);

    // Durable batch record with the truthful partial outcome
    const spBatch = await prisma.bulkActionBatch.findUnique({
      where: {
        merchant_id_idempotency_key: {
          merchant_id: merchantIdA,
          idempotency_key: savepointKey,
        },
      },
    });
    assert.strictEqual(spBatch?.status, 'PARTIAL_FAILURE');
    assert.strictEqual(spBatch?.success_count, 1);
    assert.strictEqual(spBatch?.failure_count, 1);

    // Release the test-owned trigger objects immediately
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS bulk_test_item_fail_trg ON users`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS bulk_test_item_failure_guard(uuid)`);
    console.log('  PASS: Per-item savepoint isolation verified against real PostgreSQL.');

    // ========================================================================
    // 9. AC-COM-03-11: Assign scopes & privilege ceiling
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-11: Assign scopes by Owner (success)...');
    const resAssignScopes = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'assign_scopes',
        ids: [targetUser1Id],
        params: {
          store_scopes: ['branch-north', 'branch-south'],
          warehouse_scopes: ['wh-north'],
        },
      })
      .expect(200);

    assert.strictEqual(resAssignScopes.body.data.success_count, 1);
    const user1Scopes = await prisma.user.findUnique({ where: { id: targetUser1Id } });
    assert.deepStrictEqual(user1Scopes?.store_scopes, ['branch-north', 'branch-south']);
    console.log('  PASS: Scopes assigned by owner.');

    // Privilege ceiling: Staff A has only store_scopes ['branch-north']
    console.log('🧪 Testing AC-COM-03-11: Privilege ceiling violation by scoped staff...');
    const resCeiling = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${staffTokenA}`)
      .send({
        entity_type: 'users',
        action: 'assign_scopes',
        ids: [targetUser1Id],
        params: {
          store_scopes: ['branch-south'], // Staff A does NOT hold branch-south
        },
      })
      .expect(200);

    assert.strictEqual(resCeiling.body.data.failure_count, 1);
    assert.strictEqual(resCeiling.body.data.results[0].error.code, 'PRIVILEGE_CEILING_EXCEEDED');
    console.log('  PASS: Privilege ceiling enforced.');

    // ========================================================================
    // 10. AC-COM-03-12: CSV Export with masked PII
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-12: Export selected users to CSV...');
    const resExport = await request(app.getHttpServer())
      .post('/api/v1/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'users',
        action: 'export_csv',
        ids: [targetUser1Id, targetUser2Id],
      })
      .expect(200);

    assert.strictEqual(resExport.body.data.success_count, 2);
    const csvContent = resExport.body.data.export_payload;
    assert.ok(typeof csvContent === 'string', 'Expected RFC 4180 CSV export payload string');
    assert.ok(csvContent.includes('id,full_name,email,phone,role,status'));
    // Plaintext phone '0901111111' must NOT appear, masked '090****111' must appear
    assert.ok(!csvContent.includes('0901111111'), 'Plaintext phone must not appear in CSV');
    assert.ok(csvContent.includes('090****111'), 'Masked phone must appear in CSV');
    console.log('  PASS: CSV export verified with masked PII.');

    // ========================================================================
    // 11. Route alias /bulk-actions
    // ========================================================================
    console.log('🧪 Testing route alias /bulk-actions...');
    const resAlias = await request(app.getHttpServer())
      .post('/bulk-actions')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        entity_type: 'warehouses',
        action: 'activate',
        ids: [warehouse1Id],
      })
      .expect(200);
    assert.strictEqual(resAlias.body.data.success_count, 1);
    const whInDb = await prisma.warehouse.findUnique({ where: { id: warehouse1Id } });
    assert.strictEqual(whInDb?.status, 'active');
    console.log('  PASS: Alias route verified.');

    // ========================================================================
    // 12. AC-COM-03-13: Audit log security & masking verification
    // ========================================================================
    console.log('🧪 Testing AC-COM-03-13: Audit log inspection for PII masking...');
    const auditLogs = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA },
    });
    assert.ok(auditLogs.length > 0, 'Audit logs must be created for bulk actions');
    for (const log of auditLogs) {
      const serialized = JSON.stringify(log);
      assert.ok(
        !serialized.includes('password_hash'),
        'Password hash must never appear in audit log'
      );
      assert.ok(
        !serialized.includes('session_token'),
        'Session token must never appear in audit log'
      );
      assert.ok(
        !serialized.includes('0901111111'),
        'Plaintext phone must never appear in audit log'
      );
    }
    console.log(`  PASS: Verified ${auditLogs.length} audit logs clean of plaintext secrets/PII.`);

    console.log('================================================================');
    console.log('🎉 ALL FEAT-COM-03 SUPERTEST CHECKS PASSED (AC-01..13)!');
    console.log('================================================================');
  } finally {
    try {
      if (merchantIdA && merchantIdB) {
        // Guaranteed teardown of the test-owned trigger/function (idempotent)
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS bulk_test_item_fail_trg ON users`);
        await prisma.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS bulk_test_item_failure_guard(uuid)`
        );
        await prisma.bulkActionBatch.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.auditLog.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.deviceSession.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.user.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.role.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.branch.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.warehouse.deleteMany({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        await prisma.merchant.deleteMany({
          where: { id: { in: [merchantIdA, merchantIdB] } },
        });

        // Verify clean removal of test tenants without suppressing errors (Finding 5)
        const remainingMerchants = await prisma.merchant.count({
          where: { id: { in: [merchantIdA, merchantIdB] } },
        });
        assert.strictEqual(remainingMerchants, 0, 'Test tenants must be cleanly removed');

        const remainingUsers = await prisma.user.count({
          where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
        });
        assert.strictEqual(remainingUsers, 0, 'Test users must be cleanly removed');
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  }
}

runBulkSupertestSuite().catch((err) => {
  console.error('❌ Bulk actions supertest suite failed:', err);
  process.exit(1);
});
