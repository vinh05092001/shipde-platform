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

async function runWarehousesSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WAREHOUSES SUPERTEST SUITE (FEAT-WH-01)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Warehouses Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Warehouses Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

  try {
    const tokenSecret = 'test-token-secret-for-warehouses-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Warehouse Merchant A ${testSuffix}`,
          code: `WH_M_A_${testSuffix}`,
          status: 'active',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
        {
          id: merchantIdB,
          name: `Warehouse Merchant B ${testSuffix}`,
          code: `WH_M_B_${testSuffix}`,
          status: 'active',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
      ],
    });

    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      warehouseScopes: string[] = role === RoleEnum.OWNER ? ['*'] : []
    ): Promise<{ token: string; userId: string; sessionId: string }> => {
      const userId = randomUUID();
      const sessionId = randomUUID();
      const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
      const { token } = signAccessToken(
        {
          sub: userId,
          sid: sessionId,
          mid: mId,
          role,
          st: 'ACTIVE',
        },
        secret,
        3600
      );

      await prisma.user.create({
        data: {
          id: userId,
          merchant_id: mId,
          email: `user_${emailSuffix}_${testSuffix}@shipde.vn`,
          full_name: `User ${emailSuffix}`,
          password_hash: 'mock_hash',
          role,
          status: 'active',
          warehouse_scopes: warehouseScopes,
        },
      });

      await prisma.deviceSession.create({
        data: {
          id: sessionId,
          user_id: userId,
          merchant_id: mId,
          session_token_hash: createHash('sha256').update(token).digest('hex'),
          device_id: `test-device-${emailSuffix}`,
          status: SessionStatusEnum.ACTIVE,
          expires_at: new Date(Date.now() + 3600 * 1000),
        },
      });

      return { token, userId, sessionId };
    };

    const ownerA = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner-a');
    const warehouseUserA = await setupUserSession(merchantIdA, RoleEnum.WAREHOUSE, 'wh-a', []);
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner-b');

    let warehouseId1 = '';
    let warehouseCode1 = `WH-HCM-${testSuffix}`;
    let warehouseId2 = '';
    let warehouseCode2 = `WH-HN-${testSuffix}`;

    // ========================================================================
    // AC-WH-01-06 & AC-WH-01-07: Create warehouse (First becomes default)
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-06 & 07: Create first warehouse (auto default)...');
    const createRes1 = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: `Kho Tân Bình ${testSuffix}`,
        code: warehouseCode1,
        contact_name: 'Nguyễn Văn Kho',
        contact_phone: '0901234567',
        contact_email: 'kho.tanbinh@gumac.vn',
        address_line: '128 Đường Trường Chinh, P.12',
        ward: 'Phường 12',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        postal_code: '700000',
        use_different_return_address: false,
        operating_hours: {
          monday: { open: '08:00', close: '18:00' },
        },
        cutoff_time: '16:00',
        schedule_notes: 'Lấy hàng cửa số 2',
        printer_paper_size: 'A6',
        printer_dpi: 203,
        printer_name: 'Xprinter XP-420B',
        printer_auto_print: true,
      })
      .expect(201);

    assert.strictEqual(createRes1.body.success, true);
    assert.strictEqual(createRes1.body.data.name, `Kho Tân Bình ${testSuffix}`);
    assert.strictEqual(createRes1.body.data.code, warehouseCode1);
    assert.strictEqual(
      createRes1.body.data.is_default,
      true,
      'First created warehouse must be default'
    );
    assert.strictEqual(createRes1.body.data.printer_paper_size, 'A6');
    assert.strictEqual(createRes1.body.data.printer_dpi, 203);
    assert.strictEqual(createRes1.body.data.status, 'active');
    warehouseId1 = createRes1.body.data.id;

    // Verify DB persistence
    const dbWh1 = await prisma.warehouse.findUnique({ where: { id: warehouseId1 } });
    assert.ok(dbWh1);
    assert.strictEqual(dbWh1.merchant_id, merchantIdA);
    assert.strictEqual(dbWh1.is_default, true);

    // Verify audit log
    const auditCreated = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        entity_id: warehouseId1,
        action: 'WAREHOUSE_CREATED',
      },
    });
    assert.ok(auditCreated);
    assert.strictEqual((auditCreated.new_value as any).code, warehouseCode1);
    // Sensitive contact phone must be masked at top-level and nested in address_json
    assert.strictEqual((auditCreated.new_value as any).contact_phone, '090****567');
    assert.strictEqual((auditCreated.new_value as any).address_json.contact_phone, '090****567');
    assert.strictEqual(
      (auditCreated.new_value as any).address_json.contact_email,
      'k****h@gumac.vn'
    );
    console.log(
      '  PASS: AC-WH-01-06 & 07 verified first warehouse creation, auto-default, and audit masking.'
    );

    // ========================================================================
    // AC-WH-01-08: Reject create warehouse with duplicate code
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-08: Reject duplicate warehouse code (409 CONFLICT)...');
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: 'Kho Trùng Mã',
        code: warehouseCode1,
        contact_name: 'Người Trùng',
        contact_phone: '0901234567',
        address_line: '123 ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
      })
      .expect(409);

    assert.strictEqual(dupRes.body.error.code, 'WAREHOUSE_CODE_EXISTS');
    console.log('  PASS: AC-WH-01-08 verified duplicate code rejection.');

    // ========================================================================
    // AC-WH-01-09..11: Validation errors
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-09..11: Validation errors on invalid fields...');
    // Invalid phone
    const badPhoneRes = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: 'Kho Test',
        contact_name: 'Test',
        contact_phone: '0123456789',
        address_line: '123 ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
      })
      .expect(400);
    assert.strictEqual(badPhoneRes.body.error.code, 'VALIDATION_ERROR');

    // Invalid cutoff time
    const badCutoffRes = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: 'Kho Test',
        contact_name: 'Test',
        contact_phone: '0901234567',
        address_line: '123 ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
        cutoff_time: '25:99',
      })
      .expect(400);
    assert.strictEqual(badCutoffRes.body.error.code, 'VALIDATION_ERROR');

    // Invalid printer paper size
    const badPaperRes = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: 'Kho Test',
        contact_name: 'Test',
        contact_phone: '0901234567',
        address_line: '123 ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
        printer_paper_size: 'LETTER',
      })
      .expect(400);
    assert.strictEqual(badPaperRes.body.error.code, 'VALIDATION_ERROR');
    console.log('  PASS: AC-WH-01-09..11 verified validation errors.');

    // ========================================================================
    // Create second warehouse
    // ========================================================================
    console.log('🧪 Creating second warehouse (WH-HN)...');
    const createRes2 = await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: `Kho Long Biên ${testSuffix}`,
        code: warehouseCode2,
        is_default: false,
        contact_name: 'Trần Văn Bắc',
        contact_phone: '0987654321',
        contact_email: 'kho.longbien@gumac.vn',
        address_line: '45 Đường Nguyễn Văn Cừ',
        ward: 'Phường Bồ Đề',
        district: 'Quận Long Biên',
        city: 'TP. Hà Nội',
        cutoff_time: '17:00',
        printer_paper_size: 'K80',
        printer_dpi: 300,
      })
      .expect(201);
    warehouseId2 = createRes2.body.data.id;
    assert.strictEqual(createRes2.body.data.is_default, false);

    // ========================================================================
    // AC-WH-01-01: Owner lists all warehouses for tenant
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-01: Owner lists all warehouses in tenant...');
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(listRes.body.success, true);
    assert.strictEqual(listRes.body.data.length, 2);
    const ids = listRes.body.data.map((w: any) => w.id);
    assert.ok(ids.includes(warehouseId1));
    assert.ok(ids.includes(warehouseId2));
    console.log('  PASS: AC-WH-01-01 verified owner warehouse list.');

    // ========================================================================
    // AC-WH-01-02 & 03: Scoped user lists and views permitted warehouse
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-02 & 03: Scoped user access control...');
    // Assign warehouseId1 to warehouseUserA
    await prisma.user.update({
      where: { id: warehouseUserA.userId },
      data: { warehouse_scopes: [warehouseId1] },
    });

    // Scoped list
    const scopedListRes = await request(app.getHttpServer())
      .get('/api/v1/warehouses')
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .expect(200);

    assert.strictEqual(scopedListRes.body.data.length, 1);
    assert.strictEqual(scopedListRes.body.data[0].id, warehouseId1);

    // Scoped GET permitted warehouse
    const scopedGetPermitted = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId1}`)
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .expect(200);
    assert.strictEqual(scopedGetPermitted.body.data.id, warehouseId1);
    console.log('  PASS: AC-WH-01-02 & 03 verified scoped user access.');

    // ========================================================================
    // AC-WH-01-04: Scoped user gets 403 on unassigned warehouse
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-04: Scoped user blocked from unassigned warehouse (403)...');
    const scopedGetForbidden = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId2}`)
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .expect(403);
    assert.strictEqual(scopedGetForbidden.body.error.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
    console.log('  PASS: AC-WH-01-04 verified 403 on out-of-scope warehouse.');

    // ========================================================================
    // AC-WH-01-05: Cross-tenant isolation (Owner B targeting Merchant A warehouse)
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-05: Cross-tenant isolation (Owner B querying warehouse 1)...');
    const foreignGetRes = await request(app.getHttpServer())
      .get(`/api/v1/warehouses/${warehouseId1}`)
      .set('Authorization', `Bearer ${ownerB.token}`)
      .expect(404);
    assert.strictEqual(foreignGetRes.body.error.code, 'WAREHOUSE_NOT_FOUND');
    console.log('  PASS: AC-WH-01-05 verified cross-tenant isolation.');

    // ========================================================================
    // AC-WH-01-12: Update warehouse details and log masked audit
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-12: Update warehouse attributes...');
    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId1}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        name: `Kho Tân Bình Mở Rộng ${testSuffix}`,
        contact_phone: '0919123456',
        cutoff_time: '18:00',
      })
      .expect(200);

    assert.strictEqual(updateRes.body.data.name, `Kho Tân Bình Mở Rộng ${testSuffix}`);
    assert.strictEqual(updateRes.body.data.cutoff_time, '18:00');

    // Verify DB update
    const dbWhUpdated = await prisma.warehouse.findUnique({ where: { id: warehouseId1 } });
    assert.strictEqual(dbWhUpdated?.name, `Kho Tân Bình Mở Rộng ${testSuffix}`);

    // Verify audit log
    const auditUpdated = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        entity_id: warehouseId1,
        action: 'WAREHOUSE_UPDATED',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditUpdated);
    assert.strictEqual((auditUpdated.old_value as any).contact_phone, '090****567');
    assert.strictEqual((auditUpdated.new_value as any).contact_phone, '091****456');
    assert.strictEqual((auditUpdated.old_value as any).address_json.contact_phone, '090****567');
    assert.strictEqual((auditUpdated.new_value as any).address_json.contact_phone, '091****456');
    console.log('  PASS: AC-WH-01-12 verified update and audit log with nested masking.');

    // ========================================================================
    // AC-WH-01-13: Set warehouse as default
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-13: Set warehouse 2 as default...');
    const setDefaultRes = await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId2}/default`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(setDefaultRes.body.data.id, warehouseId2);
    assert.strictEqual(setDefaultRes.body.data.is_default, true);

    // Verify warehouse 1 has is_default = false and warehouse 2 has is_default = true in DB
    const checkWh1 = await prisma.warehouse.findUnique({ where: { id: warehouseId1 } });
    const checkWh2 = await prisma.warehouse.findUnique({ where: { id: warehouseId2 } });
    assert.strictEqual(checkWh1?.is_default, false, 'Previous default must be unset');
    assert.strictEqual(checkWh2?.is_default, true, 'New warehouse must be default');

    // Verify audit log
    const auditDefault = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        entity_id: warehouseId2,
        action: 'WAREHOUSE_SET_DEFAULT',
      },
    });
    assert.ok(auditDefault);
    console.log('  PASS: AC-WH-01-13 verified setting default warehouse atomically.');

    // ========================================================================
    // AC-WH-01-14: Deactivate warehouse (soft-delete)
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-14: Deactivate warehouse...');
    const deactRes = await request(app.getHttpServer())
      .delete(`/api/v1/warehouses/${warehouseId1}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(deactRes.body.data.status, 'inactive');
    const dbDeact = await prisma.warehouse.findUnique({ where: { id: warehouseId1 } });
    assert.strictEqual(dbDeact?.status, 'inactive');

    const auditDeact = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        entity_id: warehouseId1,
        action: 'WAREHOUSE_DEACTIVATED',
      },
    });
    assert.ok(auditDeact);
    console.log('  PASS: AC-WH-01-14 verified warehouse deactivation.');

    // ========================================================================
    // AC-WH-01-15: Actor lacking iam:shop_config blocked from mutations (403)
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-15: WAREHOUSE role blocked from mutations (403)...');
    await request(app.getHttpServer())
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .send({
        name: 'Kho Trái Phép',
        contact_name: 'Test',
        contact_phone: '0901234567',
        address_line: '123 ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
      })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouses/${warehouseId2}`)
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .send({ name: 'Sửa Trái Phép' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/v1/warehouses/${warehouseId2}`)
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/warehouses/${warehouseId2}/default`)
      .set('Authorization', `Bearer ${warehouseUserA.token}`)
      .expect(403);
    console.log('  PASS: AC-WH-01-15 verified 403 FORBIDDEN for unauthorized mutations.');

    // ========================================================================
    // AC-WH-01-16: Unauthenticated request rejected (401)
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-16: Unauthenticated request rejection (401)...');
    await request(app.getHttpServer()).get('/api/v1/warehouses').expect(401);
    console.log('  PASS: AC-WH-01-16 verified 401 UNAUTHORIZED.');

    // ========================================================================
    // Alias routing: /warehouses route without /api/v1 prefix
    // ========================================================================
    console.log('🧪 Testing alias route /warehouses...');
    const aliasRes = await request(app.getHttpServer())
      .get('/warehouses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);
    assert.strictEqual(aliasRes.body.data.length, 2);
    console.log('  PASS: Verified alias route /warehouses.');

    // ========================================================================
    // AC-WH-01-17: Audit log security & PII masking verification
    // ========================================================================
    console.log('🧪 Testing AC-WH-01-17: Audit log security & PII inspection...');
    const allWhAudits = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA, entity_type: 'warehouse' },
    });
    assert.ok(allWhAudits.length >= 4, 'Expected at least 4 audit logs');
    for (const log of allWhAudits) {
      assert.strictEqual(log.merchant_id, merchantIdA);
      const str = JSON.stringify(log);
      assert.ok(!str.includes('password_hash'));
      assert.ok(!str.includes('session_token'));
      // Raw PII must never be present in audit diffs (Finding 1)
      assert.ok(!str.includes('0901234567'), 'Raw phone 0901234567 leaked in audit log');
      assert.ok(!str.includes('0919123456'), 'Raw phone 0919123456 leaked in audit log');
      assert.ok(!str.includes('kho.tanbinh@gumac.vn'), 'Raw email leaked in audit log');
    }
    console.log(
      `  PASS: AC-WH-01-17 verified ${allWhAudits.length} audit logs clean of secrets and PII.`
    );

    console.log('================================================================');
    console.log('🎉 ALL FEAT-WH-01 SUPERTEST CHECKS PASSED (AC-01..17)!');
    console.log('================================================================');
  } finally {
    // Finding 5: Clean up all tenant rows created during the test run
    try {
      if (merchantIdA && merchantIdB) {
        const tenantIds = [merchantIdA, merchantIdB];
        await prisma.auditLog.deleteMany({ where: { merchant_id: { in: tenantIds } } });
        await prisma.warehouse.deleteMany({ where: { merchant_id: { in: tenantIds } } });
        await prisma.deviceSession.deleteMany({ where: { merchant_id: { in: tenantIds } } });
        await prisma.user.deleteMany({ where: { merchant_id: { in: tenantIds } } });
        await prisma.merchant.deleteMany({ where: { id: { in: tenantIds } } });
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Test cleanup warning:', cleanupErr);
    }
    await app.close();
  }
}

runWarehousesSupertestSuite().catch((err) => {
  console.error('❌ Warehouses supertest suite failed:', err);
  process.exit(1);
});
