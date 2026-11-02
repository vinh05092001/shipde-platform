import 'reflect-metadata';
import * as assert from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum, SessionStatusEnum, DiscrepancyTypeEnum } from '@prisma/client';
import { signAccessToken } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';
import {
  ExportResource,
  ExportFormat,
  ExportJobStatus,
  ExportErrorCode,
  ExportAuditEvent,
} from '@shipde/contracts';
import { ExportsService } from './exports.service';
import { readXlsx } from './generators/xlsx.generator';
import JSZip from 'jszip';

import { handleUnavailableDatabase, redactDatabaseUrl } from './exports.util';
export { redactDatabaseUrl };

async function waitForWorker(entered: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      entered,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Export worker did not reach data retrieval')), 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';

  if (!process.env.CI && databaseUrl.includes('localhost:5433')) {
    databaseUrl = databaseUrl.replace('localhost:5433', '127.0.0.1:5433');
    process.env.DATABASE_URL = databaseUrl;
  }

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();

  const prisma = app.get(PrismaService);

  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    await handleUnavailableDatabase(databaseUrl, () => app.close(), Boolean(process.env.CI));
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

    const setupTestUserSession = async (params: {
      userId: string;
      sessionId: string;
      merchantId: string;
      email: string;
      phone: string;
      fullName: string;
      role?: RoleEnum | string;
      customRoleId?: string;
      warehouseScopes?: string[];
      storeScopes?: string[];
      carrierAccountScopes?: string[];
    }): Promise<string> => {
      const canonicalRole =
        params.role && params.role in RoleEnum ? (params.role as RoleEnum) : RoleEnum.ACCOUNTANT;

      const { token } = signAccessToken(
        {
          sub: params.userId,
          sid: params.sessionId,
          mid: params.merchantId,
          role: canonicalRole,
          st: 'active',
        },
        tokenSecret,
        86400
      );

      const userPhone = params.phone || `09${Math.floor(10000000 + Math.random() * 90000000)}`;

      await prisma.user.create({
        data: {
          id: params.userId,
          merchant_id: params.merchantId,
          email: params.email,
          phone: userPhone,
          full_name: params.fullName,
          password_hash: 'mock_password_hash',
          role: canonicalRole,
          custom_role_id: params.customRoleId,
          warehouse_scopes: params.warehouseScopes ?? ['*'],
          store_scopes: params.storeScopes ?? ['*'],
          carrier_account_scopes: params.carrierAccountScopes ?? ['*'],
          status: 'active',
        },
      });

      await prisma.deviceSession.create({
        data: {
          id: params.sessionId,
          user_id: params.userId,
          merchant_id: params.merchantId,
          session_token_hash: createHash('sha256').update(token).digest('hex'),
          device_id: `test-device-${params.userId.slice(0, 8)}`,
          status: SessionStatusEnum.ACTIVE,
          ip_address: '127.0.0.1',
          last_active_at: new Date(),
          expires_at: new Date(Date.now() + 86400000),
        },
      });

      return token;
    };

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
    const tokenA = await setupTestUserSession({
      userId: userIdA,
      sessionId: sessionIdA,
      merchantId: merchantIdA,
      email: `owner_${testSuffix}@alpha.test`,
      phone: `090${testSuffix}`,
      fullName: 'Alpha Export Owner',
      role: RoleEnum.OWNER,
    });

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
    assert.strictEqual(badRes.body.error?.code || badRes.body.code, 'VALIDATION_ERROR');

    // Test 6: Cross-tenant isolation - User from Tenant B cannot access Tenant A export
    const userIdB = randomUUID();
    const sessionIdB = randomUUID();
    const tokenB = await setupTestUserSession({
      userId: userIdB,
      sessionId: sessionIdB,
      merchantId: merchantIdB,
      email: `owner_${testSuffix}@beta.test`,
      phone: `091${testSuffix}`,
      fullName: 'Beta Export Owner',
      role: RoleEnum.OWNER,
    });

    console.log('Testing: Cross-tenant query isolation');
    const crossRes = await request(httpServer)
      .get(`/api/v1/exports/${createdExportId}`)
      .set('Authorization', `Bearer ${tokenB}`);

    assert.strictEqual(crossRes.status, 404);
    assert.strictEqual(crossRes.body.error?.code || crossRes.body.code, 'EXPORT_NOT_FOUND');

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
    assert.strictEqual(notReadyRes.body.error?.code || notReadyRes.body.code, 'EXPORT_NOT_READY');

    // Test 8: Finding 4 / AC-COM-05-06 - RBAC 403 when user lacks capability
    console.log('Testing: RBAC 403 on resource without permission');
    const noPermUserId = randomUUID();
    const noPermSessionId = randomUUID();
    const noPermToken = await setupTestUserSession({
      userId: noPermUserId,
      sessionId: noPermSessionId,
      merchantId: merchantIdA,
      email: `warehouse_${testSuffix}@alpha.test`,
      phone: `092${testSuffix}`,
      fullName: 'Alpha Warehouse Worker',
      role: RoleEnum.WAREHOUSE,
    });

    const forbiddenRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${noPermToken}`)
      .send({
        resource: ExportResource.USERS,
        format: ExportFormat.CSV,
        sync: true,
      });

    assert.strictEqual(forbiddenRes.status, 403);
    assert.strictEqual(forbiddenRes.body.error?.code || forbiddenRes.body.code, 'FORBIDDEN');

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
    const scopedToken = await setupTestUserSession({
      userId: scopedUserId,
      sessionId: scopedSessionId,
      merchantId: merchantIdA,
      email: `operator_${testSuffix}@alpha.test`,
      phone: `093${testSuffix}`,
      fullName: 'Alpha Scoped Operator',
      role: RoleEnum.STAFF,
      customRoleId: scopedRoleId,
      warehouseScopes: [wh1Record.id], // Scoped only to wh1
    });

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
    // Owner creates an unrestricted warehouse export now that both wh1 and wh2 exist in the database
    const unrestrictedWhRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(unrestrictedWhRes.status, 201);
    const unrestrictedWhExportId = unrestrictedWhRes.body.data.id;

    const outOfScopeDlRes = await request(httpServer)
      .get(`/api/v1/exports/${unrestrictedWhExportId}/download`)
      .set('Authorization', `Bearer ${scopedToken}`);

    assert.strictEqual(outOfScopeDlRes.status, 403);
    assert.strictEqual(
      outOfScopeDlRes.body.error?.code || outOfScopeDlRes.body.code,
      'SCOPE_FORBIDDEN'
    );

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
    const revokableToken = await setupTestUserSession({
      userId: revokableUserId,
      sessionId: revokableSessionId,
      merchantId: merchantIdA,
      email: `revokable_${testSuffix}@alpha.test`,
      phone: `094${testSuffix}`,
      fullName: 'Alpha Revokable Manager',
      role: RoleEnum.STAFF,
      customRoleId: revokableRoleId,
    });

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
    assert.strictEqual(revokedDlRes.body.error?.code || revokedDlRes.body.code, 'FORBIDDEN');

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
    const unmaskToken = await setupTestUserSession({
      userId: unmaskUserId,
      sessionId: unmaskSessionId,
      merchantId: merchantIdA,
      email: `unmask_${testSuffix}@alpha.test`,
      phone: `095${testSuffix}`,
      fullName: 'Alpha Unmask Manager',
      role: RoleEnum.STAFF,
      customRoleId: unmaskRoleId,
    });

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
    assert.strictEqual(
      creatorRevokedDlRes.body.error?.code || creatorRevokedDlRes.body.code,
      'FORBIDDEN'
    );

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

    // Create a staff user who has iam:manage_users capability, but NO pii:unmask
    const userMgrRoleId = randomUUID();
    await prisma.role.create({
      data: {
        id: userMgrRoleId,
        merchant_id: merchantIdA,
        code: `ROLE_USER_MGR_${testSuffix}`,
        name: 'User Manager No Unmask',
        is_system: false,
        permissions: {
          create: [{ permission_id: manageUsersPerm.id }],
        },
      },
    });

    const userMgrUserId = randomUUID();
    const userMgrSessionId = randomUUID();
    const userMgrToken = await setupTestUserSession({
      userId: userMgrUserId,
      sessionId: userMgrSessionId,
      merchantId: merchantIdA,
      email: `usermgr_${testSuffix}@alpha.test`,
      phone: `097${testSuffix}`,
      fullName: 'Alpha User Manager',
      role: RoleEnum.STAFF,
      customRoleId: userMgrRoleId,
    });

    const histNoUnmaskRes = await request(httpServer)
      .get(`/api/v1/exports/${historicalJobId}/download`)
      .set('Authorization', `Bearer ${userMgrToken}`);
    assert.strictEqual(histNoUnmaskRes.status, 403);
    assert.strictEqual(histNoUnmaskRes.body.error?.code || histNoUnmaskRes.body.code, 'FORBIDDEN');

    const histWithUnmaskRes = await request(httpServer)
      .get(`/api/v1/exports/${historicalJobId}/download`)
      .set('Authorization', `Bearer ${tokenA}`);
    assert.strictEqual(histWithUnmaskRes.status, 200);
    assert.strictEqual(histWithUnmaskRes.text.includes('0901234567'), true);

    // Finding 5: change real role permissions after the generation snapshot, during data retrieval.
    console.log('Testing: Finding 5 - Mid-generation PII grant/revocation preserves the file marker');
    const findUsers = prisma.user.findMany.bind(prisma.user);
    const updateJobs = prisma.exportJob.updateMany.bind(prisma.exportJob);
    const completionWrites: any[] = [];
    (prisma.exportJob as any).updateMany = async (args: any) => {
      if (args.data.status === ExportJobStatus.COMPLETED) completionWrites.push(args);
      return updateJobs(args);
    };
    try {
      for (const initiallyUnmasked of [false, true]) {
        if (initiallyUnmasked) {
          await prisma.rolePermission.create({
            data: { role_id: userMgrRoleId, permission_id: piiUnmaskPerm.id },
          });
        }
        (prisma.user as any).findMany = async (args: any) => {
          const rows = await findUsers(args);
          if (initiallyUnmasked) {
            await prisma.rolePermission.deleteMany({
              where: { role_id: userMgrRoleId, permission_id: piiUnmaskPerm.id },
            });
          } else {
            await prisma.rolePermission.create({
              data: { role_id: userMgrRoleId, permission_id: piiUnmaskPerm.id },
            });
          }
          return rows;
        };
        const writeCount = completionWrites.length;
        const generated = await request(httpServer).post('/api/v1/exports')
          .set('Authorization', `Bearer ${userMgrToken}`)
          .send({ resource: ExportResource.USERS, format: ExportFormat.CSV, sync: true });
        assert.strictEqual(generated.status, 201);
        (prisma.user as any).findMany = findUsers;
        assert.strictEqual(completionWrites.length, writeCount + 1);
        const completion = completionWrites[writeCount];
        assert.strictEqual(completion.data.filters.__unmasked_pii, initiallyUnmasked);
        assert.ok(completion.data.file_data, 'Marker and bytes must share one completion write');
        const persisted = await prisma.exportJob.findUnique({ where: { id: generated.body.data.id } });
        assert.ok(persisted?.file_data);
        assert.strictEqual((persisted.filters as any).__unmasked_pii, initiallyUnmasked);
        assert.deepStrictEqual(Buffer.from(persisted.file_data), Buffer.from(completion.data.file_data));
        assert.strictEqual(Buffer.from(persisted.file_data).toString('utf8')
          .includes(`owner_${testSuffix}@alpha.test`), initiallyUnmasked);
        await prisma.rolePermission.deleteMany({
          where: { role_id: userMgrRoleId, permission_id: piiUnmaskPerm.id },
        });
        const download = await request(httpServer)
          .get(`/api/v1/exports/${generated.body.data.id}/download`)
          .set('Authorization', `Bearer ${userMgrToken}`);
        assert.strictEqual(download.status, initiallyUnmasked ? 403 : 200);
        if (initiallyUnmasked) assert.strictEqual(download.body.error?.code, ExportErrorCode.FORBIDDEN);
      }
    } finally {
      (prisma.user as any).findMany = findUsers;
      (prisma.exportJob as any).updateMany = updateJobs;
      await prisma.rolePermission.deleteMany({
        where: { role_id: userMgrRoleId, permission_id: piiUnmaskPerm.id },
      });
    }

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
      },
    });

    const exportsServiceInstance = app.get(ExportsService);
    await exportsServiceInstance.recoverStaleJobs(merchantIdA);
    const recoveredJob = await prisma.exportJob.findUnique({ where: { id: staleJobId } });
    assert.ok(recoveredJob);
    assert.strictEqual(recoveredJob.status, ExportJobStatus.FAILED);
    assert.strictEqual(recoveredJob.error_code, ExportErrorCode.PROCESSING_TIMEOUT);

    // Finding 7: pause an active HTTP-created worker while another worker/maintenance overlaps.
    console.log('Testing: Finding 7 - Active worker ownership and recovery overlap over HTTP');
    for (const reclaim of [false, true]) {
      let signalEntered!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      let dataReads = 0;
      (prisma.user as any).findMany = async (args: any) => {
        if (dataReads++ === 0) {
          signalEntered();
          await resume;
        }
        return findUsers(args);
      };
      try {
        const started = await request(httpServer).post('/api/v1/exports')
          .set('Authorization', `Bearer ${userMgrToken}`)
          .send({ resource: ExportResource.USERS, format: ExportFormat.CSV, sync: false });
        assert.strictEqual(started.status, 201);
        await waitForWorker(entered);
        const jobId = started.body.data.id;
        const active = await prisma.exportJob.findUnique({ where: { id: jobId } });
        assert.ok(active);
        assert.strictEqual(active.status, ExportJobStatus.PROCESSING);
        const lease = (active.filters as any).__worker_lease;
        assert.ok(lease.worker_id);
        // Model a queued job older than the cutoff; a live lease must still protect it.
        await prisma.exportJob.update({ where: { id: jobId }, data: {
          created_at: new Date(Date.now() - 20 * 60 * 1000),
          ...(reclaim ? { filters: { ...(active.filters as any), __worker_lease: {
            ...lease, expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
          } } } : {}),
        } });
        const cutoff = new Date(Date.now() - 5 * 60 * 1000);
        assert.strictEqual(await exportsServiceInstance.recoverStaleJobs(merchantIdA, cutoff), reclaim ? 1 : 0);
        if (!reclaim) {
          await assert.rejects(exportsServiceInstance.processExportJob(
            merchantIdA, { userId: userMgrUserId, merchantId: merchantIdA, role: RoleEnum.STAFF }, jobId,
            { resource: ExportResource.USERS, format: ExportFormat.CSV }, '127.0.0.1', 'corr-second-http-worker'
          ));
          const stillActive = await prisma.exportJob.findUnique({ where: { id: jobId } });
          assert.strictEqual(stillActive?.status, ExportJobStatus.PROCESSING);
          assert.strictEqual((stillActive?.filters as any).__worker_lease.worker_id, lease.worker_id);
        }
        release();
        await exportsServiceInstance.drainActiveJobs();
        const finalJob = await prisma.exportJob.findUnique({ where: { id: jobId } });
        assert.ok(finalJob);
        assert.strictEqual(finalJob.status, reclaim ? ExportJobStatus.FAILED : ExportJobStatus.COMPLETED);
        assert.strictEqual(Boolean(finalJob.file_data), !reclaim);
        const status = await request(httpServer).get(`/api/v1/exports/${jobId}`)
          .set('Authorization', `Bearer ${userMgrToken}`);
        assert.strictEqual(status.status, 200);
        assert.strictEqual(status.body.data.status, finalJob.status);
        const download = await request(httpServer).get(`/api/v1/exports/${jobId}/download`)
          .set('Authorization', `Bearer ${userMgrToken}`);
        assert.strictEqual(download.status, reclaim ? 400 : 200);
        if (reclaim) assert.strictEqual(download.body.error?.code, ExportErrorCode.EXPORT_FAILED);
      } finally {
        release();
        await exportsServiceInstance.drainActiveJobs();
        (prisma.user as any).findMany = findUsers;
      }
    }

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
    const ledgerScopedToken = await setupTestUserSession({
      userId: ledgerScopedUserId,
      sessionId: ledgerScopedSessionId,
      merchantId: merchantIdA,
      email: `ledger_scoped_${testSuffix}@alpha.test`,
      phone: `096${testSuffix}`,
      fullName: 'Ledger Scoped Auditor',
      role: RoleEnum.STAFF,
      customRoleId: ledgerScopedRoleId,
      storeScopes: ['branch-allowed-1'],
    });

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
    assert.strictEqual(
      outOfScopeBranchRes.body.error?.code || outOfScopeBranchRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    // Finding 2 negative test: Actor with empty store_scopes is denied ledger export
    console.log('Testing: Finding 2 - Actor with empty store_scopes is denied ledger export');
    const beforeEmptyScopes = await prisma.exportJob.count({ where: { merchant_id: merchantIdA } });
    const beforeEmptyScopeAudits = await prisma.auditLog.count({ where: {
      merchant_id: merchantIdA, action: ExportAuditEvent.EXPORT_REQUESTED,
    } });
    const emptyScopesUserId = randomUUID();
    const emptyScopesSessionId = randomUUID();
    const emptyScopesToken = await setupTestUserSession({
      userId: emptyScopesUserId,
      sessionId: emptyScopesSessionId,
      merchantId: merchantIdA,
      email: `empty_scopes_${testSuffix}@alpha.test`,
      phone: `098${testSuffix}`,
      fullName: 'Empty Scopes Auditor',
      role: RoleEnum.STAFF,
      customRoleId: ledgerScopedRoleId,
      storeScopes: [],
    });
    const emptyScopesRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${emptyScopesToken}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(emptyScopesRes.status, 403);
    assert.strictEqual(
      emptyScopesRes.body.error?.code || emptyScopesRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    // Finding 2 negative HTTP test: Actor with empty carrier_account_scopes is denied ledger export
    console.log(
      'Testing: Finding 2 - Actor with empty carrier_account_scopes is denied ledger export (negative HTTP test)'
    );
    const emptyCarrierToken = await setupTestUserSession({
      userId: randomUUID(),
      sessionId: randomUUID(),
      merchantId: merchantIdA,
      email: `empty_carrier_${randomUUID().slice(0, 8)}_${testSuffix}@alpha.test`,
      phone: `097${Math.floor(1000000 + Math.random() * 9000000)}`,
      fullName: 'Empty Carrier Scopes Auditor',
      role: RoleEnum.STAFF,
      customRoleId: ledgerScopedRoleId,
      carrierAccountScopes: [],
    });
    const emptyCarrierRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${emptyCarrierToken}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(emptyCarrierRes.status, 403);
    assert.strictEqual(
      emptyCarrierRes.body.error?.code || emptyCarrierRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    // Finding 2 negative HTTP test: Actor with empty warehouse_scopes is denied ledger export
    console.log(
      'Testing: Finding 2 - Actor with empty warehouse_scopes is denied ledger export (negative HTTP test)'
    );
    const emptyWhLedgerToken = await setupTestUserSession({
      userId: randomUUID(),
      sessionId: randomUUID(),
      merchantId: merchantIdA,
      email: `empty_wh_ld_${randomUUID().slice(0, 8)}_${testSuffix}@alpha.test`,
      phone: `096${Math.floor(1000000 + Math.random() * 9000000)}`,
      fullName: 'Empty Warehouse Scopes Auditor',
      role: RoleEnum.STAFF,
      customRoleId: ledgerScopedRoleId,
      warehouseScopes: [],
    });
    const emptyWhLedgerRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${emptyWhLedgerToken}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(emptyWhLedgerRes.status, 403);
    assert.strictEqual(
      emptyWhLedgerRes.body.error?.code || emptyWhLedgerRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    // Finding 2 negative HTTP test: Actor with empty warehouse_scopes is denied warehouse export
    console.log(
      'Testing: Finding 2 - Actor with empty warehouse_scopes is denied warehouse export (negative HTTP test)'
    );
    const emptyWhOperatorToken = await setupTestUserSession({
      userId: randomUUID(),
      sessionId: randomUUID(),
      merchantId: merchantIdA,
      email: `empty_wh_op_${randomUUID().slice(0, 8)}_${testSuffix}@alpha.test`,
      phone: `095${Math.floor(1000000 + Math.random() * 9000000)}`,
      fullName: 'Empty Warehouse Operator',
      role: RoleEnum.STAFF,
      customRoleId: scopedRoleId,
      warehouseScopes: [],
    });
    const emptyWhOpRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${emptyWhOperatorToken}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        sync: true,
      });
    assert.strictEqual(emptyWhOpRes.status, 403);
    assert.strictEqual(emptyWhOpRes.body.error?.code || emptyWhOpRes.body.code, 'SCOPE_FORBIDDEN');
    assert.strictEqual(await prisma.exportJob.count({ where: { merchant_id: merchantIdA } }), beforeEmptyScopes);
    assert.strictEqual(await prisma.auditLog.count({ where: {
      merchant_id: merchantIdA, action: ExportAuditEvent.EXPORT_REQUESTED,
    } }), beforeEmptyScopeAudits, 'Denied scopes must create neither jobs nor request audits');

    // Finding 3 test: Privileged user creates export with filter containing email & phone -> audit metadata ALWAYS masked
    console.log('Testing: Finding 3 - Audit log metadata always masks PII in filters');
    const auditMaskTestRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        filters: {
          city: 'secret_owner@shopde.vn',
        },
        sync: true,
      });
    assert.strictEqual(auditMaskTestRes.status, 201);
    const reqAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_REQUESTED,
        entity_id: auditMaskTestRes.body.data.id,
      },
    });
    assert.ok(reqAudit);
    const reqNewVal = reqAudit.new_value as any;
    const reqFiltersJson = JSON.stringify(reqNewVal.filters);
    assert.strictEqual(
      reqFiltersJson.includes('secret_owner@shopde.vn'),
      false,
      'Audit log EXPORT_REQUESTED must NOT contain plaintext email'
    );
    assert.strictEqual(
      reqFiltersJson.includes('s****r@shopde.vn'),
      true,
      'Audit log EXPORT_REQUESTED must contain masked email'
    );

    // Download audit log check
    await request(httpServer)
      .get(`/api/v1/exports/${auditMaskTestRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dlAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_DOWNLOADED,
        entity_id: auditMaskTestRes.body.data.id,
      },
    });
    assert.ok(dlAudit);
    const dlNewVal = dlAudit.new_value as any;
    const dlFiltersJson = JSON.stringify(dlNewVal.filters);
    assert.strictEqual(
      dlFiltersJson.includes('secret_owner@shopde.vn'),
      false,
      'Audit log EXPORT_DOWNLOADED must NOT contain plaintext email'
    );
    assert.strictEqual(
      dlFiltersJson.includes('s****r@shopde.vn'),
      true,
      'Audit log EXPORT_DOWNLOADED must contain masked email'
    );

    // Finding 3 negative HTTP test: Privileged user creates export with filter containing phone -> audit metadata ALWAYS masked
    const auditMaskPhoneRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        filters: {
          city: '0912345678',
        },
        sync: true,
      });
    assert.strictEqual(auditMaskPhoneRes.status, 201);
    const reqPhoneAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_REQUESTED,
        entity_id: auditMaskPhoneRes.body.data.id,
      },
    });
    assert.ok(reqPhoneAudit);
    const reqPhoneVal = reqPhoneAudit.new_value as any;
    const reqPhoneJson = JSON.stringify(reqPhoneVal.filters);
    assert.strictEqual(
      reqPhoneJson.includes('0912345678'),
      false,
      'Audit log EXPORT_REQUESTED must NOT contain plaintext phone'
    );
    assert.strictEqual(
      reqPhoneJson.includes('091****678'),
      true,
      'Audit log EXPORT_REQUESTED must contain masked phone'
    );

    await request(httpServer)
      .get(`/api/v1/exports/${auditMaskPhoneRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);

    const dlPhoneAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_DOWNLOADED,
        entity_id: auditMaskPhoneRes.body.data.id,
      },
    });
    assert.ok(dlPhoneAudit);
    const dlPhoneVal = dlPhoneAudit.new_value as any;
    const dlPhoneJson = JSON.stringify(dlPhoneVal.filters);
    assert.strictEqual(
      dlPhoneJson.includes('0912345678'),
      false,
      'Audit log EXPORT_DOWNLOADED must NOT contain plaintext phone'
    );
    assert.strictEqual(
      dlPhoneJson.includes('091****678'),
      true,
      'Audit log EXPORT_DOWNLOADED must contain masked phone'
    );

    // Finding 3 negative HTTP test: PII nested inside a permitted filter is still masked
    const auditNestedRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.CSV,
        filters: {
          city: 'Kho nested_owner@shopde.vn 2026-10-31 090.111.1222 0987654321',
        },
        sync: true,
      });
    assert.strictEqual(auditNestedRes.status, 201);
    const nestedAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_REQUESTED,
        entity_id: auditNestedRes.body.data.id,
      },
    });
    assert.ok(nestedAudit);
    const nestedJson = JSON.stringify((nestedAudit.new_value as any).filters);
    assert.strictEqual(nestedJson.includes('nested_owner@shopde.vn'), false);
    assert.strictEqual(nestedJson.includes('0901111222'), false);
    assert.strictEqual(nestedJson.includes('090.111.1222'), false);
    assert.strictEqual(nestedJson.includes('0987654321'), false);
    assert.strictEqual(nestedJson.includes('__unmasked_pii'), false);
    assert.strictEqual(nestedJson.includes('__worker_lease'), false);

    await request(httpServer)
      .get(`/api/v1/exports/${auditNestedRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`);
    const nestedDlAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: ExportAuditEvent.EXPORT_DOWNLOADED,
        entity_id: auditNestedRes.body.data.id,
      },
    });
    assert.ok(nestedDlAudit);
    const nestedDlJson = JSON.stringify((nestedDlAudit.new_value as any).filters);
    assert.strictEqual(nestedDlJson.includes('nested_owner@shopde.vn'), false);
    assert.strictEqual(nestedDlJson.includes('0901111222'), false);
    assert.strictEqual(nestedDlJson.includes('090.111.1222'), false);
    assert.strictEqual(nestedDlJson.includes('0987654321'), false);
    assert.strictEqual(nestedDlJson.includes('__unmasked_pii'), false);
    assert.strictEqual(nestedDlJson.includes('__effective_scopes'), false);
    assert.strictEqual(nestedDlJson.includes('__worker_lease'), false);

    // Test 15: Finding 9 - Ledger calculations using tenant-separated persisted fixtures
    console.log('Testing: Finding 9 - Tenant-separated persisted ledger calculations');
    // Seed fixtures for Merchant A
    const carrierAccountIdA = randomUUID();
    await prisma.carrierAccount.create({
      data: {
        id: carrierAccountIdA,
        merchant_id: merchantIdA,
        carrier_code: 'GHN',
        label: `GHN Alpha ${testSuffix}`,
        encrypted_credentials: 'mock_encrypted_credentials',
        status: 'active',
      },
    });

    const orderIdA = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdA,
        merchant_id: merchantIdA,
        order_code: `ORD_A_${testSuffix}`,
        source_type: 'pancake',
        created_at: new Date(),
        cod_amount: 1000000n,
        declared_weight_g: 500,
        recipient_name: 'Nguyễn Văn A',
        recipient_phone: '0901234567',
        recipient_province: 'Hà Nội',
        recipient_address: '123 Cầu Giấy',
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
        recovered_amount: 100000n,
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
        type: DiscrepancyTypeEnum.D1_WEIGHT,
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
        label: `GHN Beta ${testSuffix}`,
        encrypted_credentials: 'mock_encrypted_credentials',
        status: 'active',
      },
    });

    const orderIdB = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdB,
        merchant_id: merchantIdB,
        order_code: `ORD_B_${testSuffix}`,
        source_type: 'pancake',
        created_at: new Date(),
        cod_amount: 9999999n,
        declared_weight_g: 500,
        recipient_name: 'Trần Văn B',
        recipient_phone: '0912345678',
        recipient_province: 'TP. Hồ Chí Minh',
        recipient_address: '456 Lê Lợi',
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
    const row1 = dataRows.find(
      (r) => r.includes('Sổ 1 (Tiền thực nhận)') && r.includes('LEDGER1_RECOVERED_AMOUNT')
    );
    assert.ok(row1, 'Must include Sổ 1 row');
    assert.strictEqual(row1.includes('100000'), true, 'Merchant A claim recovered must be 100000');

    // Finding 6: Partial recovery must retain outstanding pending amount (500k - 100k = 400k)
    const row1Pending = dataRows.find(
      (r) => r.includes('Sổ 1 (Tiền thực nhận)') && r.includes('LEDGER1_PENDING_ACCEPTANCE')
    );
    assert.ok(row1Pending, 'Must include Sổ 1 pending acceptance row');
    assert.strictEqual(
      row1Pending.includes('400000'),
      true,
      'Merchant A claim pending acceptance must be 400000 (500000 - 100000)'
    );

    const row2 = dataRows.find(
      (r) => r.includes('Sổ 2 (Đơn cứu được)') && r.includes('LEDGER2_RESCUED_GMV')
    );
    assert.ok(row2, 'Must include Sổ 2 GMV row');
    assert.strictEqual(row2.includes('1000000'), true, 'Merchant A rescued GMV must be 1000000');
    const row2Fee = dataRows.find(
      (r) => r.includes('Sổ 2 (Đơn cứu được)') && r.includes('LEDGER2_RETURN_FEE_SAVED')
    );
    assert.ok(row2Fee, 'Must include Sổ 2 return fee row');
    assert.strictEqual(
      row2Fee.includes('15000'),
      true,
      'Merchant A rescued fee saved must be 15000'
    );

    const row3 = dataRows.find(
      (r) =>
        r.includes('Sổ 3 (Độ phủ kiểm soát)') && r.includes('LEDGER3_DISCREPANCIES_DETECTED_COUNT')
    );
    assert.ok(row3, 'Must include Sổ 3 row');
    assert.strictEqual(row3.includes('1'), true, 'Merchant A discrepancies count must be 1');

    // Assert Merchant B's values are completely excluded
    assert.strictEqual(
      ledgerCsv.includes('88888888'),
      false,
      'Merchant B claim must NOT be present'
    );
    assert.strictEqual(ledgerCsv.includes('9999999'), false, 'Merchant B GMV must NOT be present');

    // Finding 1 negative HTTP test: Owner's unfiltered ledger export downloaded by restricted finance user
    console.log(
      'Testing: Finding 1 - Restricted finance user cannot download unfiltered owner ledger export (negative HTTP test)'
    );
    const storedLedger = await prisma.exportJob.findUnique({ where: { id: ledgerExportRes.body.data.id } });
    assert.ok(storedLedger);
    const universalScopes = { warehouse_scopes: ['*'], store_scopes: ['*'], carrier_account_scopes: ['*'] };
    assert.deepStrictEqual((storedLedger.filters as any).__effective_scopes, universalScopes);
    assert.deepStrictEqual((storedLedger.generation_metadata as any).effective_scopes, universalScopes);
    const unfiltDlRes = await request(httpServer)
      .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${ledgerScopedToken}`);
    assert.strictEqual(unfiltDlRes.status, 403);
    assert.strictEqual(unfiltDlRes.body.error?.code || unfiltDlRes.body.code, 'SCOPE_FORBIDDEN');

    for (const scopes of [{ warehouseScopes: [`WH_A_${testSuffix}`] },
      { carrierAccountScopes: [carrierAccountIdA] }]) {
      const scopedToken = await setupTestUserSession({
        userId: randomUUID(), sessionId: randomUUID(), merchantId: merchantIdA,
        email: `restricted_${randomUUID()}@alpha.test`,
        phone: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
        fullName: 'Restricted Ledger Auditor', role: RoleEnum.STAFF,
        customRoleId: ledgerScopedRoleId, ...scopes,
      });
      const denied = await request(httpServer)
        .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
        .set('Authorization', `Bearer ${scopedToken}`);
      assert.strictEqual(denied.status, 403);
      assert.strictEqual(denied.body.error?.code, ExportErrorCode.SCOPE_FORBIDDEN);
    }

    // Finding 2 negative HTTP download tests: Users with empty scopes cannot download ledger export
    const emptyScopesDlRes = await request(httpServer)
      .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${emptyScopesToken}`);
    assert.strictEqual(emptyScopesDlRes.status, 403);
    assert.strictEqual(
      emptyScopesDlRes.body.error?.code || emptyScopesDlRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    const emptyCarrierDlRes = await request(httpServer)
      .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${emptyCarrierToken}`);
    assert.strictEqual(emptyCarrierDlRes.status, 403);
    assert.strictEqual(
      emptyCarrierDlRes.body.error?.code || emptyCarrierDlRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    const emptyWhDlRes = await request(httpServer)
      .get(`/api/v1/exports/${ledgerExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${emptyWhLedgerToken}`);
    assert.strictEqual(emptyWhDlRes.status, 403);
    assert.strictEqual(emptyWhDlRes.body.error?.code || emptyWhDlRes.body.code, 'SCOPE_FORBIDDEN');

    // Finding 1 positive HTTP test: Owner creates ledger export explicitly filtered to branch-allowed-1
    console.log(
      'Testing: Finding 1 - Restricted finance user CAN download ledger export filtered to their branch'
    );
    const filteredForBranchRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.LEDGERS,
        format: ExportFormat.CSV,
        filters: { branch_id: 'branch-allowed-1' },
        sync: true,
      });
    assert.strictEqual(filteredForBranchRes.status, 201);
    const storedFilteredLedger = await prisma.exportJob.findUnique({ where: { id: filteredForBranchRes.body.data.id } });
    assert.ok(storedFilteredLedger);
    assert.deepStrictEqual((storedFilteredLedger.filters as any).__effective_scopes.store_scopes, ['branch-allowed-1']);
    assert.deepStrictEqual((storedFilteredLedger.generation_metadata as any).effective_scopes.store_scopes, ['branch-allowed-1']);
    const allowedBranchDlRes = await request(httpServer)
      .get(`/api/v1/exports/${filteredForBranchRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${ledgerScopedToken}`);
    assert.strictEqual(allowedBranchDlRes.status, 200);

    try {
      await prisma.exportJob.update({ where: { id: storedFilteredLedger.id }, data: {
        filters: { ...(storedFilteredLedger.filters as any), __effective_scopes: {
          ...(storedFilteredLedger.filters as any).__effective_scopes, store_scopes: [],
        } },
      } });
      const emptyStoredScopeDownload = await request(httpServer)
        .get(`/api/v1/exports/${storedFilteredLedger.id}/download`)
        .set('Authorization', `Bearer ${ledgerScopedToken}`);
      assert.strictEqual(emptyStoredScopeDownload.status, 403);
      assert.strictEqual(emptyStoredScopeDownload.body.error?.code, ExportErrorCode.SCOPE_FORBIDDEN);
    } finally {
      await prisma.exportJob.update({ where: { id: storedFilteredLedger.id },
        data: { filters: storedFilteredLedger.filters as any } });
    }

    // Finding 1 negative HTTP test: User scoped to a different branch cannot download branch-allowed-1 export
    const otherBranchUserId = randomUUID();
    const otherBranchSessionId = randomUUID();
    const otherBranchToken = await setupTestUserSession({
      userId: otherBranchUserId,
      sessionId: otherBranchSessionId,
      merchantId: merchantIdA,
      email: `other_br_${testSuffix}@alpha.test`,
      phone: `099${testSuffix}`,
      fullName: 'Other Branch Auditor',
      role: RoleEnum.STAFF,
      customRoleId: ledgerScopedRoleId,
      storeScopes: ['branch-allowed-2'],
    });
    const forbiddenBranchDlRes = await request(httpServer)
      .get(`/api/v1/exports/${filteredForBranchRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${otherBranchToken}`);
    assert.strictEqual(forbiddenBranchDlRes.status, 403);
    assert.strictEqual(
      forbiddenBranchDlRes.body.error?.code || forbiddenBranchDlRes.body.code,
      'SCOPE_FORBIDDEN'
    );

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
    const fRow1 = filteredDataRows.find(
      (r) => r.includes('Sổ 1 (Tiền thực nhận)') && r.includes('LEDGER1_RECOVERED_AMOUNT')
    );
    assert.ok(fRow1, 'Must include filtered Sổ 1 row');
    // Recovered amount for VTP must be exactly 0
    assert.strictEqual(
      fRow1.includes(',0,') || fRow1.includes('"0"'),
      true,
      'VTP recovered amount must be 0'
    );

    // Finding 2 negative HTTP download test: Actor with empty warehouse scopes cannot download warehouse export
    const emptyWhOpDlRes = await request(httpServer)
      .get(`/api/v1/exports/${auditMaskTestRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${emptyWhOperatorToken}`);
    assert.strictEqual(emptyWhOpDlRes.status, 403);
    assert.strictEqual(
      emptyWhOpDlRes.body.error?.code || emptyWhOpDlRes.body.code,
      'SCOPE_FORBIDDEN'
    );

    // Finding 10: XLSX generation returns valid OOXML ZIP package verified by XLSX reader
    console.log('Testing: Finding 10 - XLSX generation returns conformant OOXML ZIP workbook');
    const xlsxExportRes = await request(httpServer)
      .post('/api/v1/exports')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        resource: ExportResource.WAREHOUSES,
        format: ExportFormat.XLSX,
        sync: true,
      });
    assert.strictEqual(xlsxExportRes.status, 201);
    assert.strictEqual(xlsxExportRes.body.data.file_name.endsWith('.xlsx'), true);

    const xlsxDlRes = await request(httpServer)
      .get(`/api/v1/exports/${xlsxExportRes.body.data.id}/download`)
      .set('Authorization', `Bearer ${tokenA}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) =>
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', (err) => callback(err, Buffer.alloc(0)));
      });
    assert.strictEqual(xlsxDlRes.status, 200);
    assert.strictEqual(
      xlsxDlRes.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    assert.strictEqual(xlsxDlRes.body instanceof Buffer, true);
    assert.strictEqual(xlsxDlRes.body.readUInt32LE(0), 0x04034b50, 'Must be valid PKZIP');

    // Parse with XLSX reader
    const parsedXlsx = readXlsx(xlsxDlRes.body);
    assert.ok(parsedXlsx.sheets.Data, 'Data worksheet must be present');
    assert.ok(parsedXlsx.sheets.Data.headers.includes('Tên kho hàng'));
    assert.ok(parsedXlsx.metadata['Export ID']);
    assert.strictEqual(parsedXlsx.metadata['Format'], ExportFormat.XLSX);

    // Negative test: readXlsx throws on invalid/legacy XML bytes
    assert.throws(
      () => readXlsx(Buffer.from('<?xml version="1.0"?><Workbook></Workbook>')),
      /Invalid XLSX package/
    );

    // Finding 10: independent third-party ZIP consumer (JSZip, zero shared code with the
    // generator) verifies the downloaded OOXML package structure and entry CRC-32 integrity.
    const independentZip = await JSZip.loadAsync(xlsxDlRes.body, { checkCRC32: true });
    const independentPartNames = Object.keys(independentZip.files);
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]) {
      assert.ok(
        independentPartNames.includes(part),
        `Independent ZIP consumer must see required OOXML part ${part}`
      );
    }
    const independentSheet1 = await independentZip
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    assert.ok(
      independentSheet1.includes('Tên kho hàng'),
      'Independent consumer must round-trip the Vietnamese Data sheet header'
    );
    const independentSheet2 = await independentZip
      .file('xl/worksheets/sheet2.xml')!
      .async('string');
    assert.ok(
      independentSheet2.includes('Data Payload Checksum (SHA-256)'),
      'Independent consumer must round-trip the Metadata sheet'
    );

    // Negative test: the independent consumer rejects legacy (non-ZIP) spreadsheet bytes
    let legacyRejected = false;
    try {
      await JSZip.loadAsync(Buffer.from('D0CF11E0A1B11AE1legacy-biff-bytes-not-a-zip-package'));
    } catch {
      legacyRejected = true;
    }
    assert.strictEqual(
      legacyRejected,
      true,
      'Independent consumer must reject non-ZIP legacy bytes'
    );

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
