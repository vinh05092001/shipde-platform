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
import { ExportResource, ExportFormat, ExportJobStatus, ExportErrorCode } from '@shipde/contracts';
import { ExportsService } from './exports.service';

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

    // Test 7: AC-COM-05-09 - Download pending export returns 409 EXPORT_NOT_READY
    console.log('Testing: AC-COM-05-09 Download pending export');
    const manualPendingId = randomUUID();
    await prisma.exportJob.create({
      data: {
        id: manualPendingId,
        merchant_id: merchantIdA,
        user_id: userIdA,
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        status: ExportJobStatus.PENDING,
      },
    });

    const notReadyRes = await request(httpServer)
      .get(`/api/v1/exports/${manualPendingId}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(
      notReadyRes.status,
      409,
      `Expected 409 EXPORT_NOT_READY but got ${notReadyRes.status}: ${JSON.stringify(notReadyRes.body)}`
    );
    assert.strictEqual(notReadyRes.body.code, 'EXPORT_NOT_READY');

    // Test 8: Finding 4 / AC-COM-05-06 - RBAC 403 when user lacks capability
    console.log('Testing: RBAC 403 on resource without permission');
    const noPermUserId = randomUUID();
    const noPermSessionId = randomUUID();
    await prisma.user.create({
      data: {
        id: noPermUserId,
        merchant_id: merchantIdA,
        email: `warehouse_${testSuffix}@alpha.test`,
        phone: `092${testSuffix}`,
        full_name: 'Alpha Warehouse Worker',
        password_hash: 'mock_password_hash',
        role: RoleEnum.WAREHOUSE,
        warehouse_scopes: ['*'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: noPermSessionId,
        user_id: noPermUserId,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash_noperm',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const noPermToken = signAccessToken(
      {
        sub: noPermUserId,
        session_id: noPermSessionId,
        merchant_id: merchantIdA,
        role: 'WAREHOUSE',
      },
      tokenSecret
    );

    const forbiddenRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${noPermToken}`)
      .send({
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        sync: true,
      });

    assert.strictEqual(forbiddenRes.status, 403);
    assert.strictEqual(forbiddenRes.body.code, 'FORBIDDEN');

    // Test 9 & 10: Finding 5 & AC-COM-05-05 - FEAT-RBAC-02 Per-row scope & PII masking
    console.log('Testing: FEAT-RBAC-02 Per-row scope & PII masking');
    // Create a second warehouse for Merchant A
    const wh2Id = randomUUID();
    await prisma.warehouse.create({
      data: {
        id: wh2Id,
        merchant_id: merchantIdA,
        name: `Kho Hà Nội ${testSuffix}`,
        code: `WH_HN_${testSuffix}`,
        status: 'active',
        is_default: false,
        contact_name: 'Lê Kho Bắc',
        contact_phone: '0909876543',
        contact_email: 'khobac@alpha.test',
        address_line: '88 Đường Cầu Giấy',
        district: 'Quận Cầu Giấy',
        city: 'Hà Nội',
        address_json: { contact_name: 'Lê Kho Bắc', contact_phone: '0909876543' },
      },
    });

    // Create a scoped operator role with iam:shop_config but NO pii:unmask
    const shopConfigPerm = await prisma.permission.findFirst({
      where: { code: 'iam:shop_config' },
    });
    assert.ok(shopConfigPerm, 'iam:shop_config permission must exist in DB');

    const scopedRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: scopedRoleId,
        merchant_id: merchantIdA,
        code: `ROLE_SCOPED_${testSuffix}`,
        name: 'Scoped Warehouse Operator',
        is_system: false,
        permissions: {
          create: [{ permission_id: shopConfigPerm.id }],
        },
      },
    });

    // Create scoped operator user: only permitted to warehouse WH_A_ (first warehouse)
    const wh1Record = await prisma.warehouse.findFirst({
      where: { merchant_id: merchantIdA, code: `WH_A_${testSuffix}` },
    });
    assert.ok(wh1Record);

    const scopedUserId = randomUUID();
    const scopedSessionId = randomUUID();
    await prisma.user.create({
      data: {
        id: scopedUserId,
        merchant_id: merchantIdA,
        email: `operator_${testSuffix}@alpha.test`,
        phone: `093${testSuffix}`,
        full_name: 'Alpha Scoped Operator',
        password_hash: 'mock_password_hash',
        role: RoleEnum.STAFF,
        custom_role_id: scopedRoleId,
        warehouse_scopes: [wh1Record.id], // Scoped only to wh1
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: scopedSessionId,
        user_id: scopedUserId,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash_scoped',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const scopedToken = signAccessToken(
      {
        sub: scopedUserId,
        session_id: scopedSessionId,
        merchant_id: merchantIdA,
        role: 'STAFF',
      },
      tokenSecret
    );

    const scopedExportRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${scopedToken}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        sync: true,
      });

    assert.strictEqual(scopedExportRes.status, 201);
    assert.strictEqual(scopedExportRes.body.data.total_rows, 2);
    assert.strictEqual(scopedExportRes.body.data.succeeded_rows, 1);
    assert.strictEqual(scopedExportRes.body.data.failed_rows, 1);

    // Verify row_results contains truthful SCOPE_FORBIDDEN for wh2
    const wh2Result = scopedExportRes.body.data.row_results?.find(
      (r: any) => r.entity_id === wh2Id
    );
    assert.ok(wh2Result, 'Out-of-scope warehouse must be recorded in row_results');
    assert.strictEqual(wh2Result.status, 'failed');
    assert.strictEqual(wh2Result.error_code, 'SCOPE_FORBIDDEN');

    // Download file created by scoped operator and verify PII is masked (Finding 5)
    const scopedDownloadRes = await request(httpServer)
      .get(`/api/v1/exports/${scopedExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${scopedToken}`);

    assert.strictEqual(scopedDownloadRes.status, 200);
    const csvContent = scopedDownloadRes.text;

    // Must contain wh1 code and masked contact phone
    assert.strictEqual(csvContent.includes(`WH_A_${testSuffix}`), true);
    assert.strictEqual(csvContent.includes('090****567'), true);
    assert.strictEqual(csvContent.includes('0901234567'), false);
    // Must NOT contain wh2 code (out-of-scope)
    assert.strictEqual(csvContent.includes(`WH_HN_${testSuffix}`), false);

    // Test 11: AC-COM-05-12 - Audit logs recorded with IP and metadata
    console.log('Testing: Immutable audit logs in database');
    const auditLogs = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA, entity_type: 'export_job' },
    });

    assert.strictEqual(
      auditLogs.some((l) => l.action === 'EXPORT_REQUESTED'),
      true,
      'Must contain EXPORT_REQUESTED audit log'
    );
    assert.strictEqual(
      auditLogs.some((l) => l.action === 'EXPORT_DOWNLOADED'),
      true,
      'Must contain EXPORT_DOWNLOADED audit log'
    );
    for (const log of auditLogs) {
      assert.ok(log.ip_address, 'Audit log must record client IP hash');
      assert.ok(log.new_value, 'Audit log must record new_value payload');
    }

    // Test 12: Finding 4 - Restricted download of another user's export containing out-of-scope rows
    console.log(
      'Testing: Finding 4 - Scoped operator cannot download another user unrestricted export'
    );
    const outOfScopeDlRes = await request(httpServer)
      .get(`/api/v1/exports/${createdExportId}/download`)
      .set('Authorization', `Bearer ${scopedToken}`);

    assert.strictEqual(outOfScopeDlRes.status, 403);
    assert.strictEqual(outOfScopeDlRes.body.code, 'SCOPE_FORBIDDEN');

    // Test 13: Finding 9 - HTTP assertion proving permission revocation on download
    console.log('Testing: Finding 9 - Revoked permission rejects download with 403 FORBIDDEN');
    const manageUsersPerm = await prisma.permission.findFirst({
      where: { code: 'iam:manage_users' },
    });
    assert.ok(manageUsersPerm);

    const revokableRoleId = randomUUID();
    const rolePermRecord = await prisma.role.create({
      data: {
        id: revokableRoleId,
        merchant_id: merchantIdA,
        code: `ROLE_REVOKABLE_${testSuffix}`,
        name: 'Revokable User Manager',
        is_system: false,
        permissions: {
          create: [{ permission_id: manageUsersPerm.id }],
        },
      },
    });

    const revokableUserId = randomUUID();
    const revokableSessionId = randomUUID();
    await prisma.user.create({
      data: {
        id: revokableUserId,
        merchant_id: merchantIdA,
        email: `revokable_${testSuffix}@alpha.test`,
        phone: `094${testSuffix}`,
        full_name: 'Alpha Revokable Manager',
        password_hash: 'mock_password_hash',
        role: RoleEnum.STAFF,
        custom_role_id: revokableRoleId,
        warehouse_scopes: ['*'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: revokableSessionId,
        user_id: revokableUserId,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash_revokable',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const revokableToken = signAccessToken(
      {
        sub: revokableUserId,
        session_id: revokableSessionId,
        merchant_id: merchantIdA,
        role: 'STAFF',
      },
      tokenSecret
    );

    // Create users export while authorized
    const usersExportRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${revokableToken}`)
      .send({
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(usersExportRes.status, 201);
    const usersExportId = usersExportRes.body.data.id;

    // Revoke permission by deleting role permissions
    await prisma.rolePermission.deleteMany({
      where: { role_id: revokableRoleId },
    });

    // Attempt download after permission revocation
    const revokedDlRes = await request(httpServer)
      .get(`/api/v1/exports/${usersExportId}/download`)
      .set('Authorization', `Bearer ${revokableToken}`);

    assert.strictEqual(revokedDlRes.status, 403);
    assert.strictEqual(revokedDlRes.body.code, 'FORBIDDEN');

    // Test 14: Finding 9 & AC-COM-05-13 - HTTP assertion proving unmask privilege
    console.log('Testing: AC-COM-05-13 - Unmask privilege delivers plaintext identifiers');
    const piiUnmaskPerm = await prisma.permission.findFirst({
      where: { code: 'pii:unmask' },
    });
    assert.ok(piiUnmaskPerm);

    const unmaskRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: unmaskRoleId,
        merchant_id: merchantIdA,
        code: `ROLE_UNMASK_${testSuffix}`,
        name: 'Warehouse Manager with Unmask',
        is_system: false,
        permissions: {
          create: [{ permission_id: shopConfigPerm.id }, { permission_id: piiUnmaskPerm.id }],
        },
      },
    });

    const unmaskUserId = randomUUID();
    const unmaskSessionId = randomUUID();
    await prisma.user.create({
      data: {
        id: unmaskUserId,
        merchant_id: merchantIdA,
        email: `unmask_${testSuffix}@alpha.test`,
        phone: `095${testSuffix}`,
        full_name: 'Alpha Unmask Manager',
        password_hash: 'mock_password_hash',
        role: RoleEnum.STAFF,
        custom_role_id: unmaskRoleId,
        warehouse_scopes: ['*'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: unmaskSessionId,
        user_id: unmaskUserId,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash_unmask',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const unmaskToken = signAccessToken(
      {
        sub: unmaskUserId,
        session_id: unmaskSessionId,
        merchant_id: merchantIdA,
        role: 'STAFF',
      },
      tokenSecret
    );

    const unmaskExportRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${unmaskToken}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(unmaskExportRes.status, 201);

    const unmaskDlRes = await request(httpServer)
      .get(`/api/v1/exports/${unmaskExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${unmaskToken}`);

    assert.strictEqual(unmaskDlRes.status, 200);
    // Must contain plaintext unmasked contact phone and email
    assert.strictEqual(unmaskDlRes.text.includes('0901234567'), true);
    assert.strictEqual(unmaskDlRes.text.includes('kho@alpha.test'), true);

    // Test 14b: Finding 9 - Creator PII revocation over HTTP
    console.log(
      'Testing: Finding 9 - Creator PII revocation over HTTP rejects download with 403 FORBIDDEN'
    );
    await prisma.rolePermission.deleteMany({
      where: { role_id: unmaskRoleId, permission_id: piiUnmaskPerm.id },
    });
    const creatorRevokedDlRes = await request(httpServer)
      .get(`/api/v1/exports/${unmaskExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${unmaskToken}`);

    assert.strictEqual(creatorRevokedDlRes.status, 403);
    assert.strictEqual(creatorRevokedDlRes.body.code, 'FORBIDDEN');

    // Test 14c: Finding 3 / Prior 4 - Historical unmarked file fails closed over HTTP
    console.log(
      'Testing: Finding 3 / Prior 4 - Historical unmarked file fails closed without pii:unmask'
    );
    const historicalJobId = randomUUID();
    await prisma.exportJob.create({
      data: {
        id: historicalJobId,
        merchant_id: merchantIdA,
        user_id: userIdA,
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        status: ExportJobStatus.COMPLETED,
        filters: { city: 'Hà Nội' }, // historical: NO __unmasked_pii marker
        file_data: Buffer.from('id,name,phone\n1,Alpha,0901234567'),
        file_name: 'historical_users.csv',
        checksum_sha256: 'mock_checksum_historical',
      },
    });

    const histNoUnmaskRes = await request(httpServer)
      .get(`/api/v1/exports/${historicalJobId}/download`)
      .set('Authorization', `Bearer ${scopedToken}`);
    assert.strictEqual(histNoUnmaskRes.status, 403);
    assert.strictEqual(histNoUnmaskRes.body.code, 'FORBIDDEN');

    const histWithUnmaskRes = await request(httpServer)
      .get(`/api/v1/exports/${historicalJobId}/download`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert.strictEqual(histWithUnmaskRes.status, 200);
    assert.strictEqual(histWithUnmaskRes.text.includes('0901234567'), true);

    // Test 14d: Prior 7 - Restart recovery marks stranded jobs as FAILED with PROCESSING_TIMEOUT
    console.log('Testing: Prior 7 - Restart recovery handles stranded jobs');
    const staleJobId = randomUUID();
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.exportJob.create({
      data: {
        id: staleJobId,
        merchant_id: merchantIdA,
        user_id: userIdA,
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        status: ExportJobStatus.PROCESSING,
        filters: {},
        created_at: twentyMinutesAgo,
        updated_at: twentyMinutesAgo,
      },
    });

    const exportsServiceInstance = app.get(ExportsService);
    await exportsServiceInstance.recoverStaleJobs(merchantIdA);
    const recoveredJob = await prisma.exportJob.findUnique({ where: { id: staleJobId } });
    assert.ok(recoveredJob);
    assert.strictEqual(recoveredJob.status, ExportJobStatus.FAILED);
    assert.strictEqual(recoveredJob.error_code, ExportErrorCode.PROCESSING_TIMEOUT);

    // Test 14e: Finding 7 & Finding 10 - Branch scope authorization on ledgers export
    console.log(
      'Testing: Finding 7 & Finding 10 - Scoped operator cannot export ledger for out-of-scope branch'
    );
    const reconAuditPerm = await prisma.permission.findFirst({
      where: { code: 'reconciliation:run_review_audit' },
    });
    assert.ok(reconAuditPerm);

    const ledgerScopedRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: ledgerScopedRoleId,
        merchant_id: merchantIdA,
        code: `ROLE_LEDGER_SCOPED_${testSuffix}`,
        name: 'Ledger Scoped Auditor',
        is_system: false,
        permissions: {
          create: [{ permission_id: reconAuditPerm.id }],
        },
      },
    });

    const ledgerScopedUserId = randomUUID();
    const ledgerScopedSessionId = randomUUID();
    await prisma.user.create({
      data: {
        id: ledgerScopedUserId,
        merchant_id: merchantIdA,
        email: `ledger_scoped_${testSuffix}@alpha.test`,
        phone: `096${testSuffix}`,
        full_name: 'Ledger Scoped Auditor',
        password_hash: 'mock_password_hash',
        role: RoleEnum.STAFF,
        custom_role_id: ledgerScopedRoleId,
        store_scopes: ['branch-allowed-1'],
        status: 'active',
      },
    });

    await prisma.deviceSession.create({
      data: {
        id: ledgerScopedSessionId,
        user_id: ledgerScopedUserId,
        merchant_id: merchantIdA,
        token_hash: 'mock_hash_ledger_scoped',
        status: SessionStatusEnum.ACTIVE,
        ip_address: '127.0.0.1',
        last_seen_at: new Date(),
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    const ledgerScopedToken = signAccessToken(
      {
        sub: ledgerScopedUserId,
        session_id: ledgerScopedSessionId,
        merchant_id: merchantIdA,
        role: 'STAFF',
      },
      tokenSecret
    );

    const outOfScopeBranchRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${ledgerScopedToken}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        filters: { branch_id: 'branch-disallowed-99' },
        sync: true,
      });

    assert.strictEqual(outOfScopeBranchRes.status, 403);
    assert.strictEqual(outOfScopeBranchRes.body.code, 'SCOPE_FORBIDDEN');

    // Test 15: Finding 9 - Ledger calculations using tenant-separated persisted fixtures
    console.log('Testing: Finding 9 - Tenant-separated persisted ledger calculations');
    // Seed fixtures for Merchant A
    const carrierAccountIdA = randomUUID();
    await prisma.carrierAccount.create({
      data: {
        id: carrierAccountIdA,
        merchant_id: merchantIdA,
        carrier_code: 'GHN',
        account_name: `GHN Alpha ${testSuffix}`,
        status: 'active',
      },
    });

    const orderIdA = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdA,
        merchant_id: merchantIdA,
        order_code: `ORD_A_${testSuffix}`,
        status: 'COMPLETED',
        total_amount: 1500000n,
      },
    });

    const shipmentIdA = randomUUID();
    await prisma.shipment.create({
      data: {
        id: shipmentIdA,
        merchant_id: merchantIdA,
        carrier_account_id: carrierAccountIdA,
        order_id: orderIdA,
        order_code: `ORD_A_${testSuffix}`,
        tracking_code: `TRK_A_${testSuffix}`,
        carrier_code: 'GHN',
        current_status: 'DELIVERED',
        cod_amount: 1000000n,
      },
    });

    await prisma.claim.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantIdA,
        shipment_id: shipmentIdA,
        claim_type: 'LOST',
        requested_amount: 500000n,
        accepted_amount: 500000n,
        recovered_amount: 500000n,
        status: 'ACCEPTED',
        deadline_at: new Date(Date.now() + 86400000),
      },
    });

    await prisma.exceptionCase.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantIdA,
        shipment_id: shipmentIdA,
        tracking_code: `TRK_A_${testSuffix}`,
        exception_type: 'DELIVERY_FAIL',
        status: 'RESCUED',
        deadline_at: new Date(Date.now() + 86400000),
      },
    });

    await prisma.discrepancy.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantIdA,
        shipment_id: shipmentIdA,
        tracking_code: `TRK_A_${testSuffix}`,
        type: 'FEE_WEIGHT',
        amount: 50000n,
        status: 'OPEN',
      },
    });

    // Seed fixtures for Merchant B (Cross-tenant pollution guard)
    const carrierAccountIdB = randomUUID();
    await prisma.carrierAccount.create({
      data: {
        id: carrierAccountIdB,
        merchant_id: merchantIdB,
        carrier_code: 'GHN',
        account_name: `GHN Beta ${testSuffix}`,
        status: 'active',
      },
    });

    const orderIdB = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdB,
        merchant_id: merchantIdB,
        order_code: `ORD_B_${testSuffix}`,
        status: 'COMPLETED',
        total_amount: 99000000n,
      },
    });

    const shipmentIdB = randomUUID();
    await prisma.shipment.create({
      data: {
        id: shipmentIdB,
        merchant_id: merchantIdB,
        carrier_account_id: carrierAccountIdB,
        order_id: orderIdB,
        order_code: `ORD_B_${testSuffix}`,
        tracking_code: `TRK_B_${testSuffix}`,
        carrier_code: 'GHN',
        current_status: 'DELIVERED',
        cod_amount: 9999999n,
      },
    });

    await prisma.claim.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantIdB,
        shipment_id: shipmentIdB,
        claim_type: 'LOST',
        requested_amount: 88888888n,
        accepted_amount: 88888888n,
        recovered_amount: 88888888n,
        status: 'ACCEPTED',
        deadline_at: new Date(Date.now() + 86400000),
      },
    });

    // Request ledgers export for Merchant A
    const ledgerExportRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        sync: true,
      });

    assert.strictEqual(ledgerExportRes.status, 201);
    const ledgerDlRes = await request(httpServer)
      .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(ledgerDlRes.status, 200);
    const ledgerCsv = ledgerDlRes.text;

    // Assert Merchant A's values are present with exact row & metric assertions
    const dataRows = ledgerCsv.split('\r\n').filter((l) => l && !l.startsWith('#'));
    const row1 = dataRows.find((r) => r.includes('Sổ 1: Tiền thực nhận'));
    assert.ok(row1, 'Must include Sổ 1 row');
    assert.strictEqual(row1.includes('500000'), true, 'Merchant A claim must be 500000');

    const row2 = dataRows.find((r) => r.includes('Sổ 2: Đơn cứu được'));
    assert.ok(row2, 'Must include Sổ 2 row');
    assert.strictEqual(row2.includes('1000000'), true, 'Merchant A rescued GMV must be 1000000');
    assert.strictEqual(row2.includes('15000'), true, 'Merchant A rescued fee saved must be 15000');

    const row3 = dataRows.find((r) => r.includes('Sổ 3: Lệch cước vận chuyển'));
    assert.ok(row3, 'Must include Sổ 3 row');
    assert.strictEqual(row3.includes('50000'), true, 'Merchant A open discrepancy must be 50000');

    // Assert Merchant B's values are completely excluded
    assert.strictEqual(
      ledgerCsv.includes('88888888'),
      false,
      'Merchant B claim must NOT be present'
    );
    assert.strictEqual(ledgerCsv.includes('9999999'), false, 'Merchant B GMV must NOT be present');

    // Test filtered ledger calculation (carrier_code: VTP)
    console.log('Testing: Finding 7 & Finding 10 - Filtered ledger calculation by carrier');
    const filteredLedgerRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        filters: { carrier_code: 'VTP' },
        sync: true,
      });

    assert.strictEqual(filteredLedgerRes.status, 201);
    const filteredDlRes = await request(httpServer)
      .get(`/api/v1/exports/${filteredLedgerRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    assert.strictEqual(filteredDlRes.status, 200);
    const filteredDataRows = filteredDlRes.text
      .split('\r\n')
      .filter((l) => l && !l.startsWith('#'));
    const fRow1 = filteredDataRows.find((r) => r.includes('Sổ 1: Tiền thực nhận'));
    assert.ok(fRow1);
    // Recovered amount for VTP must be exactly 0
    assert.strictEqual(fRow1.includes(',0,'), true, 'VTP recovered amount must be 0');

    console.log('🎉 All Exports Supertest tests passed successfully!');
  } finally {
    // Explicitly join on active background processing before cleaning up tenant rows (Finding 9)
    try {
      const exportsService = app.get(ExportsService);
      await exportsService.drainActiveJobs();
    } catch {
      // safe fallback if app not initialized
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Cleanup fixtures
    if (merchantIdA) {
      await prisma.exportJob.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.discrepancy.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.exceptionContactLog.deleteMany({
        where: { exception_case: { merchant_id: merchantIdA } },
      });
      await prisma.exceptionCase.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.claim.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.shipmentEvent.deleteMany({ where: { shipment: { merchant_id: merchantIdA } } });
      await prisma.shipment.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.order.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.carrierAccount.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.warehouse.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.deviceSession.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.auditLog.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.user.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.rolePermission.deleteMany({ where: { role: { merchant_id: merchantIdA } } });
      await prisma.role.deleteMany({ where: { merchant_id: merchantIdA } });
      await prisma.merchant.deleteMany({ where: { id: merchantIdA } });
    }
    if (merchantIdB) {
      await prisma.exportJob.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.claim.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.shipment.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.order.deleteMany({ where: { merchant_id: merchantIdB } });
      await prisma.carrierAccount.deleteMany({ where: { merchant_id: merchantIdB } });
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
