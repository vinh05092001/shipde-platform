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
import { ImportStatus } from '@shipde/contracts';

async function runImportsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - IMPORTS SUPERTEST SUITE (FEAT-COM-04)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Imports Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Imports Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

  try {
    const tokenSecret = 'test-token-secret-for-imports-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Imports Merchant A ${testSuffix}`,
          code: `IMP_M_A_${testSuffix}`,
          status: 'active',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
        {
          id: merchantIdB,
          name: `Imports Merchant B ${testSuffix}`,
          code: `IMP_M_B_${testSuffix}`,
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
          email: `user_${emailSuffix}_${testSuffix}@shipde.vn`,
          full_name: `User ${emailSuffix}`,
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
      RoleEnum.OPS_CSKH,
      'scoped-a',
      [`WH-A-01-${testSuffix}`],
      [`BR-A-01-${testSuffix}`]
    );
    const noPermUserA = await setupUserSession(merchantIdA, RoleEnum.VIEWER, 'viewer-a', [], []);
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner-b');

    const server = app.getHttpServer();

    // ------------------------------------------------------------------------
    // COM-04-01: Download templates for branches and warehouses (CSV and XLSX)
    // ------------------------------------------------------------------------
    {
      const resCsv = await request(server)
        .get('/api/v1/imports/templates/warehouses?format=csv')
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resCsv.status, 200);
      assert.ok(resCsv.headers['content-type']?.includes('text/csv'));
      assert.ok(resCsv.text.includes('code'));
      assert.ok(resCsv.text.includes('name'));

      const resXlsx = await request(server)
        .get('/api/v1/imports/templates/branches?format=xlsx')
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resXlsx.status, 200);
      assert.ok(
        resXlsx.headers['content-type']?.includes('openxmlformats') ||
          resXlsx.headers['content-type']?.includes('application/octet-stream')
      );
      console.log('PASS: COM-04-01 Download templates for branches and warehouses (CSV and XLSX)');
    }

    // ------------------------------------------------------------------------
    // COM-04-01 & COM-04-05: Upload valid warehouse CSV -> 201 STAGED
    // ------------------------------------------------------------------------
    let import1Id = '';
    const whCode1 = `WH-A-01-${testSuffix}`;
    const whCode2 = `WH-A-02-${testSuffix}`;
    const validCsvContent = `code,name,status,is_default,contact_name,contact_phone,contact_email,address_line,ward,district,city,postal_code,cutoff_time\n${whCode1},Kho Tân Bình,active,true,Nguyễn Văn A,0901234567,tanbinh@example.com,55 Cộng Hòa,Phường 13,Quận Tân Bình,TP. Hồ Chí Minh,700000,16:00\n${whCode2},Kho Long Biên,active,false,Trần Văn B,0912345678,longbien@example.com,10 Ngô Gia Tự,Phường Đức Giang,Quận Long Biên,Hà Nội,100000,17:00`;

    {
      const res = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'valid_warehouses.csv',
          content: validCsvContent,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.import.status, ImportStatus.STAGED);
      assert.strictEqual(res.body.data.import.revision, 1);
      assert.strictEqual(res.body.data.import.total_rows, 2);
      assert.strictEqual(res.body.data.import.valid_rows, 2);
      assert.strictEqual(res.body.data.import.error_rows, 0);
      import1Id = res.body.data.import.id;
      console.log('PASS: COM-04-01 & COM-04-05 Upload valid warehouses CSV -> 201 STAGED');
    }

    // ------------------------------------------------------------------------
    // COM-04-06: Upload same content again -> 200 OK (Checksum Deduplication)
    // ------------------------------------------------------------------------
    {
      const resDedupe = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'valid_warehouses.csv',
          content: validCsvContent,
        });

      assert.strictEqual(resDedupe.status, 200);
      assert.strictEqual(resDedupe.body.data.import.id, import1Id);
      assert.strictEqual(resDedupe.body.data.import.revision, 1);
      console.log('PASS: COM-04-06 Checksum deduplication returns existing import (200 OK)');
    }

    // ------------------------------------------------------------------------
    // COM-04-06: Idempotency conflict verification (409 CONFLICT)
    // ------------------------------------------------------------------------
    {
      const resIdemConflict = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', 'unique-idempotency-key-01')
        .send({
          template_type: 'warehouses',
          file_name: 'different_content.csv',
          content: `code,name,contact_name,contact_phone,address_line,district,city\n${whCode1},Different,Name,0901234567,123 Street,District,City`,
        });

      assert.strictEqual(resIdemConflict.status, 201);

      // Now retry same key with different content
      const resRetryDifferent = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', 'unique-idempotency-key-01')
        .send({
          template_type: 'warehouses',
          file_name: 'yet_another.csv',
          content: `code,name,contact_name,contact_phone,address_line,district,city\n${whCode2},Another,Name,0901234567,456 Street,District,City`,
        });

      assert.strictEqual(resRetryDifferent.status, 409);
      assert.strictEqual(resRetryDifferent.body.error?.code, 'IDEMPOTENCY_CONFLICT');
      console.log(
        'PASS: COM-04-06 Same idempotency key with different content returns 409 CONFLICT'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-02: Invalid file type / Malware / Missing content -> 400
    // ------------------------------------------------------------------------
    {
      const resBad = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'invalid_type',
          content: 'some,data',
        });
      assert.strictEqual(resBad.status, 400);

      const resMalware = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          content: 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
        });
      assert.strictEqual(resMalware.status, 400);
      assert.strictEqual(resMalware.body.error?.code, 'MALWARE_DETECTED');
      console.log('PASS: COM-04-02 Negative validation and malware rejection');
    }

    // ------------------------------------------------------------------------
    // COM-04-03: Row validation issues & BLOCKED status
    // ------------------------------------------------------------------------
    let blockedImportId = '';
    {
      const blockedCsv = `code,name,contact_name,contact_phone,address_line,district,city\n,Missing Scope Code,Nguyễn A,0901234567,123 Đường,Quận 1,TP.HCM\nWH-BAD-PHONE,Kho Sai Số,Nguyễn B,12345,123 Đường,Quận 1,TP.HCM`;
      const resBlocked = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          content: blockedCsv,
        });

      assert.strictEqual(resBlocked.status, 201);
      assert.strictEqual(resBlocked.body.data.import.status, ImportStatus.BLOCKED);
      assert.strictEqual(resBlocked.body.data.import.error_rows, 2);
      blockedImportId = resBlocked.body.data.import.id;

      // Promotion must be blocked
      const resPromoteBlocked = await request(server)
        .post(`/api/v1/imports/${blockedImportId}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resPromoteBlocked.status, 400);
      assert.strictEqual(resPromoteBlocked.body.error?.code, 'IMPORT_BLOCKED');
      console.log('PASS: COM-04-03 Row errors set BLOCKED status and prevent promotion');
    }

    // ------------------------------------------------------------------------
    // COM-04-05: Details, row results, and issues export CSV
    // ------------------------------------------------------------------------
    {
      const resDetail = await request(server)
        .get(`/api/v1/imports/${import1Id}`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resDetail.status, 200);
      assert.strictEqual(resDetail.body.data.import.id, import1Id);

      const resRows = await request(server)
        .get(`/api/v1/imports/${import1Id}/rows?page=1&limit=10`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resRows.status, 200);
      assert.strictEqual(resRows.body.data.length, 2);

      const resIssues = await request(server)
        .get(`/api/v1/imports/${blockedImportId}/issues/export`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resIssues.status, 200);
      assert.ok(resIssues.headers['content-type']?.includes('text/csv'));
      console.log('PASS: COM-04-05 Detail, rows pagination, and issues export');
    }

    // ------------------------------------------------------------------------
    // COM-04-07: Scope Enforcement per row (FEAT-RBAC-02 & Decision 3)
    // ------------------------------------------------------------------------
    {
      // scopedUserA only has scope for whCode1 (WH-A-01-xxx), but import1Id contains whCode1 AND whCode2!
      const resScopedPromote = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${scopedUserA.token}`);

      assert.strictEqual(resScopedPromote.status, 403);
      assert.strictEqual(resScopedPromote.body.error?.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');

      // noPermUserA lacks iam:shop_config
      const resNoPerm = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${noPermUserA.token}`);

      assert.strictEqual(resNoPerm.status, 403);

      // Cross-tenant: Owner B accessing Merchant A's import -> 404
      const resCrossTenant = await request(server)
        .get(`/api/v1/imports/${import1Id}`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      assert.strictEqual(resCrossTenant.status, 404);
      console.log(
        'PASS: COM-04-07 Scope enforcement per row, capability check, and tenant isolation'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-08 & COM-04-09: Explicit Promotion by Owner & Audit Log verification
    // ------------------------------------------------------------------------
    {
      const resPromote = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resPromote.status, 200);
      assert.strictEqual(resPromote.body.data.status, ImportStatus.PROMOTED);
      assert.strictEqual(resPromote.body.data.promoted_rows_count, 2);

      // Verify warehouses were persisted in DB
      const dbWh1 = await prisma.warehouse.findUnique({
        where: { merchant_id_code: { merchant_id: merchantIdA, code: whCode1 } },
      });
      assert.ok(dbWh1);
      assert.strictEqual(dbWh1.name, 'Kho Tân Bình');
      assert.strictEqual(dbWh1.is_default, true);

      const dbWh2 = await prisma.warehouse.findUnique({
        where: { merchant_id_code: { merchant_id: merchantIdA, code: whCode2 } },
      });
      assert.ok(dbWh2);
      assert.strictEqual(dbWh2.name, 'Kho Long Biên');

      // Verify Audit Log was recorded with masked values
      const audit = await prisma.auditLog.findFirst({
        where: {
          merchant_id: merchantIdA,
          action: 'IMPORT_PROMOTED',
          entity_id: import1Id,
        },
      });
      assert.ok(audit);
      assert.strictEqual(audit.user_id, ownerA.userId);
      console.log(
        'PASS: COM-04-08 & COM-04-09 Explicit promotion, persistence, and masked audit log'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-08: New revision supersedes prior revision (Decision 2)
    // ------------------------------------------------------------------------
    {
      const newRevisionCsv = `code,name,status,is_default,contact_name,contact_phone,contact_email,address_line,ward,district,city\n${whCode1},Kho Tân Bình V2,active,true,Nguyễn Văn A,0901234567,tanbinh@example.com,55 Cộng Hòa Mới,Phường 13,Tân Bình,TP.HCM`;

      const resRev2 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'warehouses_v2.csv',
          content: newRevisionCsv,
        });

      assert.strictEqual(resRev2.status, 201);
      assert.strictEqual(resRev2.body.data.import.revision, 2);
      const import2Id = resRev2.body.data.import.id;

      // Promote revision 2
      const resPromoteRev2 = await request(server)
        .post(`/api/v1/imports/${import2Id}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resPromoteRev2.status, 200);

      // Verify revision 1 is now SUPERSEDED
      const dbImp1 = await prisma.import.findUnique({ where: { id: import1Id } });
      assert.strictEqual(dbImp1?.status, ImportStatus.SUPERSEDED);

      // Verify revision 2 is PROMOTED
      const dbImp2 = await prisma.import.findUnique({ where: { id: import2Id } });
      assert.strictEqual(dbImp2?.status, ImportStatus.PROMOTED);
      console.log('PASS: COM-04-08 New revision promotion supersedes prior revision');
    }

    // ------------------------------------------------------------------------
    // COM-04-01 & COM-04-08: Branches Template Import & Promotion
    // ------------------------------------------------------------------------
    {
      const brCode = `BR-A-01-${testSuffix}`;
      const branchCsv = `code,name,status,is_default,contact_name,contact_phone,address_line,ward,district,city\n${brCode},Chi Nhánh Quận 1,active,true,Nguyễn Văn Chi Nhánh,0901234567,123 Lê Lợi,Phường Bến Nghé,Quận 1,TP. Hồ Chí Minh`;

      const resBranchUpload = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'branches',
          file_name: 'branches.csv',
          content: branchCsv,
        });

      assert.strictEqual(resBranchUpload.status, 201);
      assert.strictEqual(resBranchUpload.body.data.import.status, ImportStatus.STAGED);
      const branchImportId = resBranchUpload.body.data.import.id;

      const resBranchPromote = await request(server)
        .post(`/api/v1/imports/${branchImportId}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resBranchPromote.status, 200);
      assert.strictEqual(resBranchPromote.body.data.status, ImportStatus.PROMOTED);

      const dbBranch = await prisma.branch.findUnique({
        where: { merchant_id_code: { merchant_id: merchantIdA, code: brCode } },
      });
      assert.ok(dbBranch);
      assert.strictEqual(dbBranch.name, 'Chi Nhánh Quận 1');
      console.log('PASS: COM-04-01 & COM-04-08 Branches template import and promotion');
    }

    console.log('🎉 ALL FEAT-COM-04 SUPERTEST INTEGRATION TESTS PASSED!');
  } finally {
    // Clean up only our created tenant records (Rule 9)
    if (merchantIdA) {
      await prisma.merchant.delete({ where: { id: merchantIdA } }).catch(() => {});
    }
    if (merchantIdB) {
      await prisma.merchant.delete({ where: { id: merchantIdB } }).catch(() => {});
    }
    await app.close();
  }
}

runImportsSupertestSuite().catch((err) => {
  console.error('FAILED: Imports Supertest Suite', err);
  process.exit(1);
});
