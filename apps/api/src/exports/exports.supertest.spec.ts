import 'reflect-metadata';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { signAccessToken } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';
import { ExportResource, ExportFormat, ExportJobStatus } from '@shipde/contracts';

async function runExportsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - EXPORTS SUPERTEST SUITE (FEAT-COM-05)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Exports Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Exports Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

  try {
    const tokenSecret = 'test-token-secret-for-exports-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Shop Alpha Exports ${testSuffix}`,
          code: `ALPHA_EXP_${testSuffix}`,
          status: 'active',
        },
        {
          id: merchantIdB,
          name: `Shop Beta Exports ${testSuffix}`,
          code: `BETA_EXP_${testSuffix}`,
          status: 'active',
        },
      ],
    });

    // 2. Fixture: Owner User for Merchant A
    const userIdA = randomUUID();
    const sessionIdA = randomUUID();

    await prisma.user.create({
      data: {
        id: userIdA,
        merchant_id: merchantIdA,
        email: `owner_${testSuffix}@alpha.test`,
        phone: `090${testSuffix}`,
        full_name: 'Alpha Export Owner',
        password_hash: 'mock_password_hash',
        role: RoleEnum.OWNER,
        warehouse_scopes: ['*'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: sessionIdA,
        user_id: userIdA,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const tokenA = signAccessToken(
      {
        sub: userIdA,
        session_id: sessionIdA,
        merchant_id: merchantIdA,
        role: 'OWNER',
      },
      tokenSecret
    );

    // 3. Fixture: Warehouses for Merchant A
    await prisma.warehouse.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantIdA,
        name: `Kho Alpha ${testSuffix}`,
        code: `WH_A_${testSuffix}`,
        status: 'active',
        is_default: true,
        contact_name: 'Nguyễn Văn Kho Alpha',
        contact_phone: '0901234567',
        contact_email: 'kho@alpha.test',
        address_line: '128 Đường Trường Chinh',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        address_json: { contact_name: 'Nguyễn Văn Kho Alpha', contact_phone: '0901234567' },
      },
    });

    const httpServer = app.getHttpServer();

    // Test 1: POST /api/v1/exports (AC-COM-05-01) - Create valid export job
    console.log('Testing: POST /api/v1/exports with valid payload');
    const postRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        sync: true,
      });

    assert.strictEqual(
      postRes.status,
      201,
      `Expected 201 Created but got ${postRes.status}: ${JSON.stringify(postRes.body)}`
    );
    assert.strictEqual(postRes.body.data.resource, ExportResource.WAREHOUSES);
    assert.strictEqual(postRes.body.data.format, ExportFormat.CSV);
    assert.strictEqual(postRes.body.data.status, ExportJobStatus.COMPLETED);
    assert.ok(postRes.body.data.checksum_sha256);
    const createdExportId = postRes.body.data.id;

    // Test 2: GET /api/v1/exports - List export jobs
    console.log('Testing: GET /api/v1/exports');
    const listRes = await request(httpServer)
      .get('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listRes.body.data.length >= 1, true);
    assert.strictEqual(listRes.body.meta.total >= 1, true);

    // Test 3: GET /api/v1/exports/:id - Get export job by ID
    console.log('Testing: GET /api/v1/exports/:id');
    const getRes = await request(httpServer)
      .get(`/api/v1/exports/${createdExportId}`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.data.id, createdExportId);

    // Test 4: GET /api/v1/exports/:id/download (AC-COM-05-08) - Download export file
    console.log('Testing: GET /api/v1/exports/:id/download');
    const downloadRes = await request(httpServer)
      .get(`/api/v1/exports/${createdExportId}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(downloadRes.status, 200);
    assert.strictEqual(downloadRes.headers['content-type'], 'text/csv; charset=utf-8');
    assert.ok(downloadRes.headers['x-export-checksum']);
    assert.ok(downloadRes.headers['content-disposition'].includes('attachment'));

    // Test 5: POST /api/v1/exports with invalid body - Validation error (400)
    console.log('Testing: POST /api/v1/exports with invalid body');
    const badRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: 'invalid_resource',
        format: 'unsupported_format',
      });

    assert.strictEqual(badRes.status, 400);
    assert.strictEqual(badRes.body.code, 'VALIDATION_ERROR');

    // Test 6: Cross-tenant isolation - User from Tenant B cannot access Tenant A export
    const userIdB = randomUUID();
    const sessionIdB = randomUUID();

    await prisma.user.create({
      data: {
        id: userIdB,
        merchant_id: merchantIdB,
        email: `owner_${testSuffix}@beta.test`,
        phone: `091${testSuffix}`,
        full_name: 'Beta Export Owner',
        password_hash: 'mock_password_hash',
        role: RoleEnum.OWNER,
        warehouse_scopes: ['*'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: sessionIdB,
        user_id: userIdB,
        merchant_id: merchantIdB,
        token_hash: 'mock_hash_b',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const tokenB = signAccessToken(
      {
        sub: userIdB,
        session_id: sessionIdB,
        merchant_id: merchantIdB,
        role: 'OWNER',
      },
      tokenSecret
    );

    console.log('Testing: Cross-tenant query isolation');
    const crossRes = await request(httpServer)
      .get(`/api/v1/exports/${createdExportId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    assert.strictEqual(crossRes.status, 404);
    assert.strictEqual(crossRes.body.code, 'EXPORT_NOT_FOUND');

    console.log('🎉 All Exports Supertest tests passed successfully!');
  } finally {
    // Cleanup fixtures
    if (merchantIdA) {
      await prisma.exportJob.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.warehouse.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.deviceSession.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.user.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.merchant.deleteMany({ where: { id: merchantIdA } });
    }
    if (merchantIdB) {
      await prisma.exportJob.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.deviceSession.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.user.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.merchant.deleteMany({ where: { id: merchantIdB } });
    }
    await app.close();
  }
}

runExportsSupertestSuite().catch((err) => {
  console.error('Exports Supertest Suite Failed:', err);
  process.exit(1);
});
