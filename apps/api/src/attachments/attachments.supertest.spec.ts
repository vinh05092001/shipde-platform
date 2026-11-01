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
import { StorageService } from '../storage/storage.service';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';

async function runAttachmentsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - ATTACHMENTS SUPERTEST SUITE (FEAT-COM-06)');
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

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();

  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error('Database must be reachable in CI environment');
    }
    console.warn(
      "⚠️ PostgreSQL is not reachable. Skipping live Attachments Supertest tests (run 'pnpm infra:up' to enable)."
    );
    await app.close();
    console.log('🎉 Attachments Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';
  const uploadedS3Keys: string[] = [];
  const cleanupErrors: Error[] = [];

  try {
    const tokenSecret = 'test-token-secret-for-attachments-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Attachment Merchant A ${testSuffix}`,
          code: `ATT_M_A_${testSuffix}`,
          status: 'active',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
        {
          id: merchantIdB,
          name: `Attachment Merchant B ${testSuffix}`,
          code: `ATT_M_B_${testSuffix}`,
          status: 'active',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
      ],
    });

    // Create real warehouse and branch entities for merchantIdA
    const whId1 = randomUUID();
    const whId2 = randomUUID();
    const branchId1 = randomUUID();

    await prisma.warehouse.create({
      data: {
        id: whId1,
        merchant_id: merchantIdA,
        name: 'Warehouse HCM Scope',
        code: `wh_hcm_${testSuffix}`,
        status: 'active',
        contact_name: 'Nguyen Van A',
        contact_phone: '0901234567',
        address_line: '123 Nguyen Hue',
        district: 'Quan 1',
        city: 'Ho Chi Minh',
        address_json: {},
      },
    });

    await prisma.warehouse.create({
      data: {
        id: whId2,
        merchant_id: merchantIdA,
        name: 'Warehouse Da Nang Scope',
        code: `wh_danang_${testSuffix}`,
        status: 'active',
        contact_name: 'Tran Van B',
        contact_phone: '0907654321',
        address_line: '456 Le Duan',
        district: 'Hai Chau',
        city: 'Da Nang',
        address_json: {},
      },
    });

    await prisma.branch.create({
      data: {
        id: branchId1,
        merchant_id: merchantIdA,
        name: 'Branch HCM Scope',
        code: `br_hcm_${testSuffix}`,
        status: 'ACTIVE',
      },
    });

    // Create real carrier account, order, shipment, and returnRecord for ret-scan-99
    const carrierAccountId = randomUUID();
    await prisma.carrierAccount.create({
      data: {
        id: carrierAccountId,
        merchant_id: merchantIdA,
        carrier_code: 'GHN',
        label: `Test GHN ${testSuffix}`,
        encrypted_credentials: 'mock_encrypted_credentials',
        status: 'active',
      },
    });

    const orderId = randomUUID();
    await prisma.order.create({
      data: {
        id: orderId,
        merchant_id: merchantIdA,
        order_code: `ORD_${testSuffix}`,
        branch_id: branchId1,
        warehouse_id: whId1,
        recipient_name: 'Test Recipient',
        recipient_phone: '0901112233',
        recipient_province: 'Ho Chi Minh',
        recipient_address: '123 Test St',
        created_at: new Date(),
      },
    });

    const shipmentId = randomUUID();
    await prisma.shipment.create({
      data: {
        id: shipmentId,
        merchant_id: merchantIdA,
        order_id: orderId,
        order_code: `ORD_${testSuffix}`,
        carrier_code: 'GHN',
        carrier_account_id: carrierAccountId,
        tracking_code: `TRACK_${testSuffix}`,
        warehouse_id: whId1,
        branch_id: branchId1,
      },
    });

    const returnRecordId = randomUUID();
    await prisma.returnRecord.create({
      data: {
        id: returnRecordId,
        merchant_id: merchantIdA,
        shipment_id: shipmentId,
        tracking_code: 'ret-scan-99',
        return_warehouse_id: whId1,
      },
    });

    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      warehouseScopes: string[] = role === RoleEnum.OWNER ? ['*'] : [],
      storeScopes: string[] = role === RoleEnum.OWNER ? ['*'] : []
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
          email: `user_att_${emailSuffix}_${testSuffix}@shipde.vn`,
          full_name: `User Att ${emailSuffix}`,
          password_hash: 'mock_hash',
          role,
          status: 'active',
          warehouse_scopes: warehouseScopes,
          store_scopes: storeScopes,
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
    const scopedUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'wh-a',
      [whId1],
      [branchId1]
    );
    const mixedUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'mixed-a',
      [whId1],
      ['*']
    );
    const emptyUserA = await setupUserSession(merchantIdA, RoleEnum.WAREHOUSE, 'empty-a', [], []);
    const scopedAdminUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.OWNER,
      'scoped-admin-a',
      [whId1],
      ['*']
    );
    const emptyAdminUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.OWNER,
      'empty-admin-a',
      [],
      []
    );
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner-b');

    // ========================================================================
    // AC-COM-06-01: Upload valid attachment (Valid PNG magic header)
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-01: Upload valid attachment (PNG)...');
    const fileBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
      0x15, 0xc4, 0x89,
    ]);
    const validChecksum = createHash('sha256').update(fileBytes).digest('hex');

    const uploadRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        file_name: `damaged_box_${testSuffix}.png`,
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        checksum_sha256: validChecksum,
        entity_type: 'RETURN',
        entity_id: 'ret-scan-99',
      });

    if (uploadRes.body?.data?.storage_key) {
      uploadedS3Keys.push(uploadRes.body.data.storage_key);
    }

    assert.strictEqual(uploadRes.status, 201);
    assert.strictEqual(uploadRes.body.success, true);
    assert.strictEqual(uploadRes.body.data.file_name, `damaged_box_${testSuffix}.png`);
    assert.strictEqual(uploadRes.body.data.checksum_sha256, validChecksum);
    assert.strictEqual(uploadRes.body.data.status, 'ACTIVE');
    assert.strictEqual(uploadRes.body.data.metadata.scan_status, 'HEURISTIC_PASSED');
    assert.strictEqual(uploadRes.body.data.metadata.scan_clearance, false);
    assert.ok(uploadRes.body.data.id);
    const createdAttachmentId = uploadRes.body.data.id;

    // Finding 9: Real storage verification
    const headCheck = await storage.headObject(uploadRes.body.data.storage_key);
    assert.strictEqual(headCheck.exists, true);

    // ========================================================================
    // AC-COM-06-03: Upload with mismatched checksum -> 400 CHECKSUM_MISMATCH
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-03: Mismatched checksum rejection...');
    const badChecksumRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        file_name: 'tampered.png',
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        checksum_sha256: '0000000000000000000000000000000000000000000000000000000000000000',
      });

    assert.strictEqual(badChecksumRes.status, 400);
    assert.strictEqual(badChecksumRes.body.error.code, 'CHECKSUM_MISMATCH');

    // ========================================================================
    // AC-COM-06-04: Disallowed extension -> 400 INVALID_FILE_TYPE
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-04: Disallowed extension rejection (.exe)...');
    const badExtRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        file_name: 'payload.exe',
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
      });

    assert.strictEqual(badExtRes.status, 400);
    assert.strictEqual(badExtRes.body.error.code, 'INVALID_FILE_TYPE');

    // ========================================================================
    // AC-COM-06-07: List attachments with pagination
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-07: List attachments with pagination...');
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/attachments?page=1&limit=10')
      .set('Authorization', `Bearer ${ownerA.token}`);

    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.success, true);
    assert.ok(Array.isArray(listRes.body.data));
    assert.ok(listRes.body.data.length >= 1);
    assert.ok(listRes.body.meta.total >= 1);

    // ========================================================================
    // AC-COM-06-10: Get attachment metadata
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-10: Get attachment metadata...');
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}`)
      .set('Authorization', `Bearer ${ownerA.token}`);

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.data.id, createdAttachmentId);
    assert.strictEqual(getRes.body.data.merchant_id, merchantIdA);

    // ========================================================================
    // AC-COM-06-11: Cross-tenant isolation -> 404 ATTACHMENT_NOT_FOUND
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-11: Cross-tenant access rejection...');
    const crossRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}`)
      .set('Authorization', `Bearer ${ownerB.token}`);

    assert.strictEqual(crossRes.status, 404);
    assert.strictEqual(crossRes.body.error.code, 'ATTACHMENT_NOT_FOUND');

    // ========================================================================
    // AC-COM-06-13: Download attachment content (Finding 8: filename contract)
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-13: Download attachment content...');
    // Review P1 (Finding 1) HTTP negative test: download rejected before external AV clearance
    const preClearanceDl = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}/download`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    assert.strictEqual(preClearanceDl.status, 403);
    assert.strictEqual(preClearanceDl.body.error.code, 'ATTACHMENT_UNAVAILABLE');

    // External AV clearance daemon marks the attachment CLEAN
    const attRow = await prisma.attachment.findFirst({ where: { id: createdAttachmentId } });
    await prisma.attachment.update({
      where: { id: createdAttachmentId },
      data: {
        metadata: {
          ...((attRow?.metadata as any) ?? {}),
          scan_status: 'CLEAN',
          scan_clearance: true,
        },
      },
    });

    const dlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}/download`)
      .set('Authorization', `Bearer ${ownerA.token}`);

    assert.strictEqual(dlRes.status, 200);
    assert.strictEqual(dlRes.headers['content-type'], 'image/png');
    assert.ok(dlRes.headers['content-disposition']?.includes(`damaged_box_${testSuffix}.png`));

    // ========================================================================
    // Finding 9: Exercise scopedUserA for scope denial on Da Nang attachment
    // ========================================================================
    console.log('🧪 Testing Finding 9: Scoped user access denial...');
    const danangRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        file_name: `danang_${testSuffix}.png`,
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        warehouse_id: whId2, // Da Nang warehouse (not in scopedUserA scope)
      });
    if (danangRes.body?.data?.storage_key) {
      uploadedS3Keys.push(danangRes.body.data.storage_key);
    }
    assert.strictEqual(danangRes.status, 201);
    const danangAttId = danangRes.body.data.id;

    // scopedUserA cannot download Da Nang attachment
    const deniedDlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${danangAttId}/download`)
      .set('Authorization', `Bearer ${scopedUserA.token}`);
    assert.strictEqual(deniedDlRes.status, 403);
    assert.strictEqual(deniedDlRes.body.error.code, 'SCOPE_FORBIDDEN');

    // scopedUserA CAN download HCM attachment (createdAttachmentId was derived to whId1 via ret-scan-99)
    const allowedDlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}/download`)
      .set('Authorization', `Bearer ${scopedUserA.token}`);
    assert.strictEqual(allowedDlRes.status, 200);

    // ========================================================================
    // AC-COM-06-16: Delete without confirmation -> 400 CONFIRMATION_REQUIRED
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-16: Delete without confirmation rejection...');
    const noConfirmDel = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${createdAttachmentId}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({});

    assert.strictEqual(noConfirmDel.status, 400);
    assert.strictEqual(noConfirmDel.body.error.code, 'CONFIRMATION_REQUIRED');

    // ========================================================================
    // AC-COM-06-15: Delete with confirmation -> 200 OK (Finding 9: S3 verified)
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-15: Delete with confirm: true...');
    const confirmDel = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${createdAttachmentId}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ confirm: true });

    assert.strictEqual(confirmDel.status, 200);
    assert.strictEqual(confirmDel.body.success, true);

    const headAfterDelete = await storage.headObject(uploadRes.body.data.storage_key);
    assert.strictEqual(headAfterDelete.exists, false);

    // ========================================================================
    // AC-COM-06-20: Bulk delete attachments
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-20: Bulk delete attachments...');
    const bulkRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/bulk-delete')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        ids: [createdAttachmentId, randomUUID()],
        confirm: true,
      });

    assert.strictEqual(bulkRes.status, 200);
    assert.strictEqual(bulkRes.body.data.total, 2);
    assert.strictEqual(bulkRes.body.data.failure_count, 2);

    // ========================================================================
    // Review P1 (Finding 4): HTTP-level negative tests for mixed-scope and empty-scope actors
    // ========================================================================
    console.log('🧪 Testing Review P1 (Finding 4): Mixed-scope and empty-scope actor access...');

    // Upload an unscoped attachment using ownerA
    const unscopedRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        file_name: `unscoped_${testSuffix}.png`,
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        entity_type: 'GENERAL',
      });
    assert.strictEqual(unscopedRes.status, 201);
    const unscopedAttId = unscopedRes.body.data.id;
    if (unscopedRes.body?.data?.storage_key) {
      uploadedS3Keys.push(unscopedRes.body.data.storage_key);
    }

    // Mark unscoped attachment CLEAN so clearance check is satisfied
    const unscopedRow = await prisma.attachment.findFirst({ where: { id: unscopedAttId } });
    await prisma.attachment.update({
      where: { id: unscopedAttId },
      data: {
        metadata: {
          ...((unscopedRow?.metadata as any) ?? {}),
          scan_status: 'CLEAN',
          scan_clearance: true,
        },
      },
    });

    // 1. mixedUserA (wh: [whId1], store: ['*']) attempting unscoped attachment
    const mixedGetRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${unscopedAttId}`)
      .set('Authorization', `Bearer ${mixedUserA.token}`);
    assert.strictEqual(mixedGetRes.status, 403);
    assert.strictEqual(mixedGetRes.body.error.code, 'SCOPE_FORBIDDEN');

    const mixedDlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${unscopedAttId}/download`)
      .set('Authorization', `Bearer ${mixedUserA.token}`);
    assert.strictEqual(mixedDlRes.status, 403);
    assert.strictEqual(mixedDlRes.body.error.code, 'SCOPE_FORBIDDEN');

    const mixedDelRes = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${unscopedAttId}`)
      .set('Authorization', `Bearer ${mixedUserA.token}`)
      .send({ confirm: true });
    assert.strictEqual(mixedDelRes.status, 403);
    assert.strictEqual(mixedDelRes.body.error.code, 'SCOPE_FORBIDDEN');

    const mixedUploadRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${mixedUserA.token}`)
      .send({
        file_name: `attempt_unscoped_${testSuffix}.png`,
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        entity_type: 'GENERAL',
      });
    assert.strictEqual(mixedUploadRes.status, 403);
    assert.strictEqual(mixedUploadRes.body.error.code, 'SCOPE_FORBIDDEN');

    const mixedListRes = await request(app.getHttpServer())
      .get('/api/v1/attachments')
      .set('Authorization', `Bearer ${mixedUserA.token}`);
    assert.strictEqual(mixedListRes.status, 200);
    assert.strictEqual(
      mixedListRes.body.data.some((a: any) => a.id === unscopedAttId),
      false
    );

    // 2. emptyUserA (wh: [], store: []) attempting operations
    const emptyListRes = await request(app.getHttpServer())
      .get('/api/v1/attachments')
      .set('Authorization', `Bearer ${emptyUserA.token}`);
    assert.strictEqual(emptyListRes.status, 200);
    assert.strictEqual(emptyListRes.body.data.length, 0);

    const emptyGetRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${unscopedAttId}`)
      .set('Authorization', `Bearer ${emptyUserA.token}`);
    assert.strictEqual(emptyGetRes.status, 403);
    assert.strictEqual(emptyGetRes.body.error.code, 'SCOPE_FORBIDDEN');

    const emptyUploadRes = await request(app.getHttpServer())
      .post('/api/v1/attachments/upload')
      .set('Authorization', `Bearer ${emptyUserA.token}`)
      .send({
        file_name: `empty_upload_${testSuffix}.png`,
        mime_type: 'image/png',
        content_base64: fileBytes.toString('base64'),
        warehouse_id: whId1,
      });
    assert.strictEqual(emptyUploadRes.status, 403);
    assert.strictEqual(emptyUploadRes.body.error.code, 'SCOPE_FORBIDDEN');

    // ========================================================================
    // Review Round 2 (Finding 10): Scoped administrator cannot bypass warehouse/branch by ID
    // ========================================================================
    console.log('🧪 Testing Review Round 2 (Finding 10): Scoped & empty-scope admin access by ID...');

    // 1. Scoped admin (holds iam:shop_config, scoped to whId1) cannot access whId2 attachment by ID
    const scopedAdminGetRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${danangAttId}`)
      .set('Authorization', `Bearer ${scopedAdminUserA.token}`);
    assert.strictEqual(scopedAdminGetRes.status, 403);
    assert.strictEqual(scopedAdminGetRes.body.error.code, 'SCOPE_FORBIDDEN');

    const scopedAdminDlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${danangAttId}/download`)
      .set('Authorization', `Bearer ${scopedAdminUserA.token}`);
    assert.strictEqual(scopedAdminDlRes.status, 403);
    assert.strictEqual(scopedAdminDlRes.body.error.code, 'SCOPE_FORBIDDEN');

    const scopedAdminDelRes = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${danangAttId}`)
      .set('Authorization', `Bearer ${scopedAdminUserA.token}`)
      .send({ confirm: true });
    assert.strictEqual(scopedAdminDelRes.status, 403);
    assert.strictEqual(scopedAdminDelRes.body.error.code, 'SCOPE_FORBIDDEN');

    const scopedAdminListRes = await request(app.getHttpServer())
      .get('/api/v1/attachments')
      .set('Authorization', `Bearer ${scopedAdminUserA.token}`);
    assert.strictEqual(scopedAdminListRes.status, 200);
    assert.strictEqual(
      scopedAdminListRes.body.data.some((a: any) => a.id === danangAttId),
      false
    );

    // 2. Empty-scope admin (holds iam:shop_config, scopes []) denied across all actions
    const emptyAdminListRes = await request(app.getHttpServer())
      .get('/api/v1/attachments')
      .set('Authorization', `Bearer ${emptyAdminUserA.token}`);
    assert.strictEqual(emptyAdminListRes.status, 200);
    assert.strictEqual(emptyAdminListRes.body.data.length, 0);

    const emptyAdminGetRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${danangAttId}`)
      .set('Authorization', `Bearer ${emptyAdminUserA.token}`);
    assert.strictEqual(emptyAdminGetRes.status, 403);
    assert.strictEqual(emptyAdminGetRes.body.error.code, 'SCOPE_FORBIDDEN');

    const emptyAdminDlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${danangAttId}/download`)
      .set('Authorization', `Bearer ${emptyAdminUserA.token}`);
    assert.strictEqual(emptyAdminDlRes.status, 403);
    assert.strictEqual(emptyAdminDlRes.body.error.code, 'SCOPE_FORBIDDEN');

    const emptyAdminDelRes = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${danangAttId}`)
      .set('Authorization', `Bearer ${emptyAdminUserA.token}`)
      .send({ confirm: true });
    assert.strictEqual(emptyAdminDelRes.status, 403);
    assert.strictEqual(emptyAdminDelRes.body.error.code, 'SCOPE_FORBIDDEN');

    // ========================================================================
    // Review P1 (Finding 5): Audit log sensitive data inspection
    // ========================================================================
    console.log('🧪 Testing Review P1 (Finding 5): Audit logs mask PII & sensitive text...');
    const auditLogs = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA },
    });
    assert.ok(auditLogs.length > 0);
    for (const log of auditLogs) {
      // Reason must never contain storage key or raw filename
      if (log.reason) {
        assert.strictEqual(
          log.reason.includes(`damaged_box_${testSuffix}.png`),
          false,
          'Audit log reason must not contain raw filename'
        );
      }
      if (log.new_value) {
        const valStr = JSON.stringify(log.new_value);
        assert.strictEqual(
          valStr.includes(`damaged_box_${testSuffix}.png`),
          false,
          'Audit new_value must not contain raw filename'
        );
      }
    }

    console.log('🎉 All Attachments Supertest assertions passed!');
  } finally {
    // Finding 9: Verified cleanup of S3 objects and tenant DB rows without swallowing errors
    for (const key of uploadedS3Keys) {
      try {
        await storage.deleteObject(key);
      } catch (err: any) {
        cleanupErrors.push(err);
      }
    }

    if (merchantIdA) {
      try {
        await prisma.attachment.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.returnRecord.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.shipment.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.order.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.carrierAccount.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.warehouse.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.branch.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.deviceSession.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.user.deleteMany({ where: { merchant_id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.merchant.deleteMany({ where: { id: merchantIdA } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
    }
    if (merchantIdB) {
      try {
        await prisma.attachment.deleteMany({ where: { merchant_id: merchantIdB } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdB } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.deviceSession.deleteMany({ where: { merchant_id: merchantIdB } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.user.deleteMany({ where: { merchant_id: merchantIdB } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
      try {
        await prisma.merchant.deleteMany({ where: { id: merchantIdB } });
      } catch (err: any) {
        cleanupErrors.push(err);
      }
    }

    await app.close();

    // Finding 9: Cleanup verification fails test when cleanup is incomplete
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Supertest cleanup failed with ${cleanupErrors.length} error(s). Test suite must not leave tenant rows or objects behind.`
      );
    }
  }
}

runAttachmentsSupertestSuite().catch((err) => {
  console.error('Attachments supertest failed:', err);
  process.exit(1);
});
