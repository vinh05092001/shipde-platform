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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Attachments Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Attachments Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

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
      ['wh-hcm-scope'],
      ['branch-hcm-scope']
    );
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner-b');

    // ========================================================================
    // AC-COM-06-01: Upload valid attachment
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-01: Upload valid attachment (PNG)...');
    const fileBytes = Buffer.from('test png content image data');
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

    assert.strictEqual(uploadRes.status, 201);
    assert.strictEqual(uploadRes.body.success, true);
    assert.strictEqual(uploadRes.body.data.file_name, `damaged_box_${testSuffix}.png`);
    assert.strictEqual(uploadRes.body.data.checksum_sha256, validChecksum);
    assert.strictEqual(uploadRes.body.data.status, 'ACTIVE');
    assert.ok(uploadRes.body.data.id);
    const createdAttachmentId = uploadRes.body.data.id;

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
    // AC-COM-06-13: Download attachment content
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-13: Download attachment content...');
    const dlRes = await request(app.getHttpServer())
      .get(`/api/v1/attachments/${createdAttachmentId}/download`)
      .set('Authorization', `Bearer ${ownerA.token}`);

    assert.strictEqual(dlRes.status, 200);
    assert.strictEqual(dlRes.headers['content-type'], 'image/png');
    assert.ok(dlRes.headers['content-disposition']?.includes(createdAttachmentId));

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
    // AC-COM-06-15: Delete with confirmation -> 200 OK
    // ========================================================================
    console.log('🧪 Testing AC-COM-06-15: Delete with confirm: true...');
    const confirmDel = await request(app.getHttpServer())
      .delete(`/api/v1/attachments/${createdAttachmentId}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ confirm: true });

    assert.strictEqual(confirmDel.status, 200);
    assert.strictEqual(confirmDel.body.success, true);

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
    assert.strictEqual(bulkRes.body.data.failure_count, 2); // Both are either already deleted or non-existent

    console.log('🎉 All Attachments Supertest assertions passed!');
  } finally {
    // Clean up created test tenant rows (Rule 9: tests create and delete only their own rows)
    if (merchantIdA) {
      await prisma.attachment.deleteMany({ where: { merchant_id: merchantIdA } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdA } }).catch(() => {});
      await prisma.deviceSession
        .deleteMany({ where: { merchant_id: merchantIdA } })
        .catch(() => {});
      await prisma.user.deleteMany({ where: { merchant_id: merchantIdA } }).catch(() => {});
      await prisma.merchant.deleteMany({ where: { id: merchantIdA } }).catch(() => {});
    }
    if (merchantIdB) {
      await prisma.attachment.deleteMany({ where: { merchant_id: merchantIdB } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdB } }).catch(() => {});
      await prisma.deviceSession
        .deleteMany({ where: { merchant_id: merchantIdB } })
        .catch(() => {});
      await prisma.user.deleteMany({ where: { merchant_id: merchantIdB } }).catch(() => {});
      await prisma.merchant.deleteMany({ where: { id: merchantIdB } }).catch(() => {});
    }
    await app.close();
  }
}

runAttachmentsSupertestSuite().catch((err) => {
  console.error('Attachments supertest failed:', err);
  process.exit(1);
});
