import 'reflect-metadata';
import * as assert from 'node:assert';
import { randomUUID, createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';
import { ImportStatus } from '@shipde/contracts';
import { createZipArchive } from './imports.parser';

function buildStoredZip(
  files: Array<{ name: string; data: Buffer }>,
  overrides?: { corruptCrc?: boolean; wrongUncompSize?: number }
): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    let crc = zlib.crc32(file.data) >>> 0;
    let uncompSize = file.data.length;
    if (overrides?.corruptCrc) crc = (crc ^ 0xdeadbeef) >>> 0;
    if (overrides?.wrongUncompSize !== undefined) uncompSize = overrides.wrongUncompSize;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); // stored
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(file.data.length, 18);
    lh.writeUInt32LE(uncompSize, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const localEntry = Buffer.concat([lh, nameBuf, file.data]);
    parts.push(localEntry);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(file.data.length, 20);
    cd.writeUInt32LE(uncompSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    cdEntries.push(Buffer.concat([cd, nameBuf]));
    offset += localEntry.length;
  }
  const cdBuf = Buffer.concat(cdEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

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

  function redactDatabaseUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return rawUrl.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@');
    }
  }

  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  if (
    (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
    (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
  ) {
    databaseUrl = databaseUrl.slice(1, -1);
  }
  if (databaseUrl.includes('localhost:5433')) {
    databaseUrl = databaseUrl.replace('localhost:5433', '127.0.0.1:5433');
  }
  process.env.DATABASE_URL = databaseUrl;

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
      throw new Error(
        `Database must be reachable in CI environment at ${redactDatabaseUrl(databaseUrl)}`
      );
    }
    console.warn(
      `⚠️ PostgreSQL is not reachable at ${redactDatabaseUrl(
        databaseUrl
      )}. Skipping live Imports Supertest tests (run 'pnpm infra:up' to enable).`
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
      storeScopes: string[] = role === RoleEnum.OWNER ? ['*'] : [],
      customRoleId?: string | null
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
          custom_role_id: customRoleId ?? null,
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

    // Custom role carrying exactly iam:shop_config (permission resolved from seeded registry)
    const scopedRoleA = await prisma.role.create({
      data: {
        merchant_id: merchantIdA,
        name: `Scoped Import Operator ${testSuffix}`,
        name_lower: `scoped import operator ${testSuffix}`.toLowerCase(),
        description: 'Test fixture: iam:shop_config with restricted warehouse/store scopes',
        is_system: false,
      },
    });
    const shopConfigPermission = await prisma.permission.findUnique({
      where: { code: 'iam:shop_config' },
    });
    assert.ok(shopConfigPermission, 'iam:shop_config permission must exist after platform seed');
    await prisma.rolePermission.create({
      data: {
        role_id: scopedRoleA.id,
        permission_id: shopConfigPermission.id,
      },
    });

    const ownerA = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner-a');
    // OWNER with explicitly empty store and warehouse scopes (Finding 5: prove no OWNER bypass)
    const ownerEmptyScopesA = await setupUserSession(
      merchantIdA,
      RoleEnum.OWNER,
      'owner-empty-a',
      [],
      []
    );
    const scopedUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'scoped-a',
      [`WH-A-01-${testSuffix}`],
      [`BR-A-01-${testSuffix}`],
      scopedRoleA.id
    );
    // ACCOUNTANT holds no iam:shop_config in the canonical registry, so the guard denies it.
    const noPermUserA = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'viewer-a',
      [],
      []
    );
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner-b');

    const server = app.getHttpServer();

    // Polling helper for durable asynchronous processing boundary (Finding 10)
    const waitForImportStatus = async (
      importId: string,
      token: string,
      targetStatuses: ImportStatus[] = [
        ImportStatus.STAGED,
        ImportStatus.BLOCKED,
        ImportStatus.FAILED,
      ],
      timeoutMs = 6000
    ): Promise<any> => {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        const res = await request(server)
          .get(`/api/v1/imports/${importId}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status === 200 && res.body?.data?.import) {
          const imp = res.body.data.import;
          if (targetStatuses.includes(imp.status)) {
            return imp;
          }
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      throw new Error(
        `Import ${importId} did not reach target status [${targetStatuses.join(
          ', '
        )}] within ${timeoutMs}ms`
      );
    };

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
    // COM-04-01 & COM-04-05: Upload valid warehouse CSV -> 202 ACCEPTED -> poll STAGED (Finding 10)
    // ------------------------------------------------------------------------
    let import1Id = '';
    const whCode1 = `WH-A-01-${testSuffix}`;
    const whCode2 = `WH-A-02-${testSuffix}`;
    const validCsvContent = `code,name,status,is_default,contact_name,contact_phone,contact_email,address_line,ward,district,city,postal_code,cutoff_time\n${whCode1},Kho Tân Bình,active,true,Nguyễn Văn A,0901234567,tanbinh@example.com,55 Cộng Hòa,Phường 13,Quận Tân Bình,TP. Hồ Chí Minh,700000,16:00\n${whCode2},Kho Long Biên,active,false,Trần Văn B,0912345678,longbien@example.com,10 Ngô Gia Tự,Phường Đức Giang,Quận Long Biên,Hà Nội,100000,17:00`;

    {
      const res = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Correlation-Id', `corr-upload-wh-${testSuffix}`)
        .send({
          template_type: 'warehouses',
          file_name: 'valid_warehouses.csv',
          content: validCsvContent,
        });

      // Finding 10: 202 ACCEPTED returned immediately across durable asynchronous boundary
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.import.revision, 1);
      import1Id = res.body.data.import.id;

      // Poll until background processing stages the file
      const stagedImp = await waitForImportStatus(import1Id, ownerA.token, [ImportStatus.STAGED]);
      assert.strictEqual(stagedImp.status, ImportStatus.STAGED);
      assert.strictEqual(stagedImp.total_rows, 2);
      assert.strictEqual(stagedImp.valid_rows, 2);
      assert.strictEqual(stagedImp.error_rows, 0);

      // Verify IMPORT_UPLOADED audit log includes correlationId (Finding 12 / Finding 9 Part 3)
      const uploadAudit = await prisma.auditLog.findFirst({
        where: {
          merchant_id: merchantIdA,
          action: 'IMPORT_UPLOADED',
          entity_id: import1Id,
        },
      });
      assert.ok(uploadAudit, 'IMPORT_UPLOADED audit log must exist');
      assert.ok(
        uploadAudit.reason?.includes(`corr-upload-wh-${testSuffix}`),
        'Audit log must retain correlation ID'
      );
      assert.strictEqual(uploadAudit.user_id, ownerA.userId);
      console.log('PASS: COM-04-01 & COM-04-05 Upload valid warehouses CSV -> 202 ACCEPTED -> STAGED');
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
    // COM-04-07: Scope Enforcement per row, empty scopes deny, and NO OWNER BYPASS (Finding 5)
    // ------------------------------------------------------------------------
    {
      // 1. scopedUserA only has scope for whCode1, but import1Id contains whCode1 AND whCode2 -> 403
      const resScopedPromote = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${scopedUserA.token}`);

      assert.strictEqual(resScopedPromote.status, 403);
      assert.strictEqual(resScopedPromote.body.error?.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');

      // 2. OWNER with empty warehouse_scopes -> MUST be denied 403 (Proves NO OWNER bypass!)
      const resOwnerEmptyPromote = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${ownerEmptyScopesA.token}`);

      assert.strictEqual(
        resOwnerEmptyPromote.status,
        403,
        'OWNER with empty warehouse_scopes must be denied (no wildcard OWNER bypass)'
      );
      assert.strictEqual(resOwnerEmptyPromote.body.error?.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');

      // 3. noPermUserA lacks iam:shop_config
      const resNoPerm = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${noPermUserA.token}`);

      assert.strictEqual(resNoPerm.status, 403);

      // 4. Cross-tenant: Owner B accessing Merchant A's import -> 404
      const resCrossTenant = await request(server)
        .get(`/api/v1/imports/${import1Id}`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      assert.strictEqual(resCrossTenant.status, 404);
      console.log(
        'PASS: COM-04-07 Scope enforcement per row, empty scopes deny, no OWNER bypass, and tenant isolation'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-08 & COM-04-09: Explicit Promotion by Owner & Masked Audit Verification (Finding 9 Part 3)
    // ------------------------------------------------------------------------
    {
      const resPromote = await request(server)
        .post(`/api/v1/imports/${import1Id}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('X-Correlation-Id', `corr-promote-wh-${testSuffix}`);

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

      // Verify IMPORT_PROMOTED Audit Log was recorded with correlationId and masked values
      const promoteAudit = await prisma.auditLog.findFirst({
        where: {
          merchant_id: merchantIdA,
          action: 'IMPORT_PROMOTED',
          entity_id: import1Id,
        },
      });
      assert.ok(promoteAudit);
      assert.strictEqual(promoteAudit.user_id, ownerA.userId);
      assert.ok(
        promoteAudit.reason?.includes(`corr-promote-wh-${testSuffix}`),
        'Audit reason must persist correlation ID'
      );

      // Verify WAREHOUSE_CREATED Audit Log masks contact_phone (Finding 9 Part 3)
      const whCreatedAudit = await prisma.auditLog.findFirst({
        where: {
          merchant_id: merchantIdA,
          action: 'WAREHOUSE_CREATED',
          entity_id: dbWh1.id,
        },
      });
      assert.ok(whCreatedAudit, 'WAREHOUSE_CREATED audit log must exist');
      assert.ok(
        whCreatedAudit.reason?.includes(`corr-promote-wh-${testSuffix}`),
        'Warehouse mutation audit must persist correlation ID'
      );
      const whAuditVal = whCreatedAudit.new_value as any;
      assert.ok(
        whAuditVal?.contact_phone?.includes('****'),
        'contact_phone in audit log must be masked with ****'
      );
      assert.strictEqual(
        whAuditVal?.contact_phone?.includes('0901234567'),
        false,
        'Raw contact_phone must not leak into audit log'
      );
      console.log(
        'PASS: COM-04-08 & COM-04-09 Explicit promotion, persistence, and masked audit logs'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-06: Checksum Replay Key Binding sequence (Finding 6)
    // Upload A with K1 -> replay A with K2 -> upload B with K2 -> 409 CONFLICT
    // ------------------------------------------------------------------------
    {
      const key1 = `k1-${testSuffix}`;
      const key2 = `k2-${testSuffix}`;
      const contentA = `code,name,status,is_default,contact_name,contact_phone,address_line,district,city\nWH-K-01-${testSuffix},Kho K1,active,false,Name,0901234567,Addr,Dist,City`;
      const contentB = `code,name,status,is_default,contact_name,contact_phone,address_line,district,city\nWH-K-02-${testSuffix},Kho K2 Different,active,false,Name,0901234567,Addr,Dist,City`;

      // Step 1: Upload A with K1
      const resA1 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', key1)
        .send({
          template_type: 'warehouses',
          file_name: 'content_a.csv',
          content: contentA,
        });
      assert.strictEqual(resA1.status, 202);
      const impAId = resA1.body.data.import.id;
      await waitForImportStatus(impAId, ownerA.token, [ImportStatus.STAGED]);

      // Step 2: Replay content A with K2 -> should bind K2 to content A
      const resA2 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', key2)
        .send({
          template_type: 'warehouses',
          file_name: 'content_a.csv',
          content: contentA,
        });
      assert.strictEqual(resA2.status, 200, 'Replay of content A must succeed (200 OK)');
      assert.strictEqual(resA2.body.data.import.id, impAId);

      // Step 3: Upload different content B with K2 -> MUST throw 409 IDEMPOTENCY_CONFLICT
      const resB2 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .set('Idempotency-Key', key2)
        .send({
          template_type: 'warehouses',
          file_name: 'content_b.csv',
          content: contentB,
        });
      assert.strictEqual(
        resB2.status,
        409,
        'K2 was bound to content A on replay; content B with K2 must return 409 CONFLICT'
      );
      assert.strictEqual(resB2.body.error?.code, 'IDEMPOTENCY_CONFLICT');
      console.log(
        'PASS: COM-04-06 Checksum replay binds newly supplied idempotency key (Finding 6)'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-02: MIME allowlisting exact match and extension mismatch (Finding 4 & Finding 7)
    // ------------------------------------------------------------------------
    {
      // 1. Claimed MIME text/csv-unapproved when allowlist allows text/csv (exact match, Finding 4)
      const resUnapprovedMime = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'test.csv',
          content: 'code,name\nWH-01,Test',
          mime_type: 'text/csv-unapproved',
        });
      assert.strictEqual(resUnapprovedMime.status, 400);
      assert.strictEqual(resUnapprovedMime.body.error?.code, 'INVALID_FILE_TYPE');

      // 2. Extension and MIME mismatch: .csv with xlsx MIME
      const resMismatch1 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'test.csv',
          content: 'code,name\nWH-01,Test',
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
      assert.strictEqual(resMismatch1.status, 400);
      assert.strictEqual(resMismatch1.body.error?.code, 'INVALID_FILE_TYPE');

      // 3. Extension and MIME mismatch: .xlsx with csv MIME
      const resMismatch2 = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'test.xlsx',
          file_base64: Buffer.from('dummy').toString('base64'),
          mime_type: 'text/csv',
        });
      assert.strictEqual(resMismatch2.status, 400);
      assert.strictEqual(resMismatch2.body.error?.code, 'INVALID_FILE_TYPE');

      // 4. Corrupted ZIP entry CRC-32 (Finding 3)
      const cleanSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row></sheetData>
</worksheet>`;
      const corruptCrcZip = buildStoredZip(
        [{ name: 'xl/worksheets/sheet1.xml', data: Buffer.from(cleanSheetXml) }],
        { corruptCrc: true }
      );
      const resCorruptCrc = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'corrupt.xlsx',
          file_base64: corruptCrcZip.toString('base64'),
        });
      assert.strictEqual(resCorruptCrc.status, 400);
      assert.strictEqual(resCorruptCrc.body.error?.code, 'FILE_PARSE_ERROR');

      // 5. Sparse cell coordinate memory exhaustion rejected during background staging (Finding 5)
      const sparseSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>code</t></is></c></row>
    <row r="2"><c r="ZZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row>
  </sheetData>
</worksheet>`;
      const sparseZip = createZipArchive([
        { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sparseSheetXml) },
      ]);
      const resSparse = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'sparse.xlsx',
          file_base64: sparseZip.toString('base64'),
        });
      assert.strictEqual(resSparse.status, 202);
      const sparseImpId = resSparse.body.data.import.id;
      const failedSparse = await waitForImportStatus(sparseImpId, ownerA.token, [
        ImportStatus.FAILED,
      ]);
      assert.strictEqual(failedSparse.status, ImportStatus.FAILED);
      assert.strictEqual(failedSparse.control_totals?.error_code, 'FILE_PARSE_ERROR');

      // 6. Deflated EICAR malware inside XLSX (Finding 7)
      const eicarPayload = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      const maliciousXlsx = createZipArchive([
        {
          name: 'xl/worksheets/sheet1.xml',
          data: Buffer.from(cleanSheetXml),
        },
        {
          name: 'xl/drawings/payload.xml',
          data: Buffer.from(eicarPayload),
        },
      ]);
      const resEicar = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'eicar.xlsx',
          file_base64: maliciousXlsx.toString('base64'),
        });
      assert.strictEqual(resEicar.status, 400);
      assert.strictEqual(resEicar.body.error?.code, 'MALWARE_DETECTED');
      console.log('PASS: COM-04-02 Negative validation: MIME, ZIP CRC, bounds, and deflated malware');
    }

    // ------------------------------------------------------------------------
    // COM-04-03: Row validation issues & preservation of surplus row (Finding 8)
    // ------------------------------------------------------------------------
    let blockedImportId = '';
    {
      // Row with empty declared columns but nonempty surplus value: must NOT disappear
      const surplusCsv = `code,name,contact_name,contact_phone,address_line,district,city\n,,,,,,"surplus_value"\n${whCode1},Kho Tân Bình,Nguyễn A,0901234567,123 Đường,Quận 1,TP.HCM`;
      const resBlocked = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'surplus_and_valid.csv',
          content: surplusCsv,
        });

      assert.strictEqual(resBlocked.status, 202);
      blockedImportId = resBlocked.body.data.import.id;

      // Poll until BLOCKED
      const blockedImp = await waitForImportStatus(blockedImportId, ownerA.token, [
        ImportStatus.BLOCKED,
      ]);
      assert.strictEqual(blockedImp.status, ImportStatus.BLOCKED);
      assert.strictEqual(blockedImp.total_rows, 2, 'Empty declared row with surplus must NOT be dropped');
      assert.strictEqual(blockedImp.error_rows, 1);

      // Promotion must be blocked
      const resPromoteBlocked = await request(server)
        .post(`/api/v1/imports/${blockedImportId}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resPromoteBlocked.status, 400);
      assert.strictEqual(resPromoteBlocked.body.error?.code, 'IMPORT_BLOCKED');
      console.log(
        'PASS: COM-04-03 Row errors set BLOCKED status and surplus records are preserved (Finding 8)'
      );
    }

    // ------------------------------------------------------------------------
    // COM-04-04: Ambiguous duplicate header mapping rejection (Finding 9)
    // ------------------------------------------------------------------------
    {
      const ambiguousCsv = `code,Mã chi nhánh,name,status\nBR-DUP-01,BR-DUP-01,Chi Nhánh Trùng,active`;
      const resAmbig = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'branches',
          file_name: 'ambiguous_headers.csv',
          content: ambiguousCsv,
        });

      assert.strictEqual(resAmbig.status, 202);
      const ambigId = resAmbig.body.data.import.id;

      const failedImp = await waitForImportStatus(ambigId, ownerA.token, [ImportStatus.FAILED]);
      assert.strictEqual(failedImp.status, ImportStatus.FAILED);
      assert.strictEqual(failedImp.control_totals?.error_code, 'DUPLICATE_HEADER_MAPPING');
      console.log('PASS: COM-04-04 Ambiguous duplicate header mappings rejected before staging (Finding 9)');
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
    // COM-04-08: New revision supersedes prior revision (Decision 2)
    // ------------------------------------------------------------------------
    {
      const newRevisionCsv = `code,name,status,is_default,contact_name,contact_phone,contact_email,address_line,ward,district,city\n${whCode1},Kho Tân Bình V2,active,true,Nguyễn Văn A,0901234567,tanbinh@example.com,55 Cộng Hòa Mới,Phường 13,Tân Bình,TP.HCM`;

      const resRev = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          template_type: 'warehouses',
          file_name: 'warehouses_v2.csv',
          content: newRevisionCsv,
        });

      assert.strictEqual(resRev.status, 202);
      const newImpId = resRev.body.data.import.id;
      const stagedRev = await waitForImportStatus(newImpId, ownerA.token, [ImportStatus.STAGED]);
      assert.strictEqual(stagedRev.status, ImportStatus.STAGED);

      // Promote new revision
      const resPromoteRev = await request(server)
        .post(`/api/v1/imports/${newImpId}/promote`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      assert.strictEqual(resPromoteRev.status, 200);

      // Verify revision 1 is now SUPERSEDED
      const dbImp1 = await prisma.import.findUnique({ where: { id: import1Id } });
      assert.strictEqual(dbImp1?.status, ImportStatus.SUPERSEDED);

      // Verify new revision is PROMOTED
      const dbImpNew = await prisma.import.findUnique({ where: { id: newImpId } });
      assert.strictEqual(dbImpNew?.status, ImportStatus.PROMOTED);
      console.log('PASS: COM-04-08 New revision promotion supersedes prior revision');
    }

    // ------------------------------------------------------------------------
    // COM-04-01 & COM-04-08: Initial multirow branch import assigns first branch default (Finding 2)
    // ------------------------------------------------------------------------
    {
      const brCode1 = `BR-INIT-01-${testSuffix}`;
      const brCode2 = `BR-INIT-02-${testSuffix}`;
      // Initial branch import for Merchant B (has 0 branches) with NO explicit is_default column
      const initialBranchCsv = `code,name,status,contact_name,contact_phone,address_line,district,city\n${brCode1},Chi Nhánh Đầu Tiên,active,Nguyễn A,0901234567,1 Lê Lợi,Quận 1,TP.HCM\n${brCode2},Chi Nhánh Thứ Hai,active,Nguyễn B,0901234568,2 Lê Lợi,Quận 1,TP.HCM`;

      const resInitBr = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({
          template_type: 'branches',
          file_name: 'initial_branches.csv',
          content: initialBranchCsv,
        });

      assert.strictEqual(resInitBr.status, 202);
      const initBrId = resInitBr.body.data.import.id;
      await waitForImportStatus(initBrId, ownerB.token, [ImportStatus.STAGED]);

      const resInitBrPromote = await request(server)
        .post(`/api/v1/imports/${initBrId}/promote`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      assert.strictEqual(resInitBrPromote.status, 200);

      // Verify in DB: exactly first branch is default; second branch is not (Finding 2)
      const dbBr1 = await prisma.branch.findUnique({
        where: { merchant_id_code: { merchant_id: merchantIdB, code: brCode1 } },
      });
      const dbBr2 = await prisma.branch.findUnique({
        where: { merchant_id_code: { merchant_id: merchantIdB, code: brCode2 } },
      });
      assert.ok(dbBr1);
      assert.ok(dbBr2);
      assert.strictEqual(dbBr1.is_default, true, 'First branch on initial import must be default');
      assert.strictEqual(dbBr2.is_default, false, 'Second branch on initial import must not be default');

      // Negative check: multiple rows specifying is_default=true is rejected (Finding 2)
      const multiDefaultCsv = `code,name,status,is_default,contact_name,contact_phone,address_line,district,city\nBR-MD-1,Chi Nhánh MD 1,active,true,Nguyễn A,0901234567,123 Đường,Quận 1,TP.HCM\nBR-MD-2,Chi Nhánh MD 2,active,true,Nguyễn B,0901234568,456 Đường,Quận 1,TP.HCM`;
      const resMultiDef = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({
          template_type: 'branches',
          file_name: 'multi_default.csv',
          content: multiDefaultCsv,
        });
      assert.strictEqual(resMultiDef.status, 202);
      const multiDefId = resMultiDef.body.data.import.id;
      const stagedMultiDef = await waitForImportStatus(multiDefId, ownerB.token, [
        ImportStatus.STAGED,
        ImportStatus.BLOCKED,
      ]);
      // If staged with validation issues, promotion fails
      const resPromoteMultiDef = await request(server)
        .post(`/api/v1/imports/${multiDefId}/promote`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      assert.strictEqual(resPromoteMultiDef.status, 400);

      // Displaced default branch scope check (Part 3 Finding 5 & P1-Finding-14)
      // Actor holds scope for brCode2 only, displacing existing default brCode1 (out of scope) -> 403
      const scopedRoleB = await prisma.role.create({
        data: {
          merchant_id: merchantIdB,
          name: `Scoped Op B ${testSuffix}`,
          name_lower: `scoped op b ${testSuffix}`.toLowerCase(),
          description: 'Scoped user in Merchant B',
          is_system: false,
        },
      });
      await prisma.rolePermission.create({
        data: {
          role_id: scopedRoleB.id,
          permission_id: shopConfigPermission.id,
        },
      });
      const scopedUserB = await setupUserSession(
        merchantIdB,
        RoleEnum.OPS_CSKH,
        'scoped-b',
        [],
        [brCode2], // ONLY has scope for brCode2, lacks scope for default brCode1!
        scopedRoleB.id
      );

      const displaceCsv = `code,name,status,is_default,contact_name,contact_phone,address_line,district,city\n${brCode2},Chi Nhánh 2 Mới Thành Mặc Định,active,true,Nguyễn B,0901234568,2 Lê Lợi,Quận 1,TP.HCM`;
      const resDisplaceUpload = await request(server)
        .post('/api/v1/imports/upload')
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({
          template_type: 'branches',
          file_name: 'displace_default.csv',
          content: displaceCsv,
        });
      assert.strictEqual(resDisplaceUpload.status, 202);
      const displaceImpId = resDisplaceUpload.body.data.import.id;
      await waitForImportStatus(displaceImpId, ownerB.token, [ImportStatus.STAGED]);

      const resDisplacePromote = await request(server)
        .post(`/api/v1/imports/${displaceImpId}/promote`)
        .set('Authorization', `Bearer ${scopedUserB.token}`);
      assert.strictEqual(
        resDisplacePromote.status,
        403,
        'Restricted actor displacing out-of-scope default branch must be denied 403'
      );
      assert.strictEqual(resDisplacePromote.body.error?.code, 'SCOPE_UNAUTHORIZED');
      assert.ok(
        resDisplacePromote.body.error?.message?.includes(brCode1),
        'Error message must cite displaced out-of-scope default branch code'
      );

      console.log(
        'PASS: COM-04-01 & COM-04-08 Initial branch import assigns exactly one default, rejects multiple defaults, and verifies displaced default scope check'
      );
    }

    console.log('🎉 ALL FEAT-COM-04 SUPERTEST INTEGRATION TESTS PASSED!');
  } finally {
    // Clean up only our created tenant records and uploaded storage objects (Rule 9 & Finding 8)
    const cleanupTenant = async (mId: string) => {
      if (!mId) return;

      // 1. Remove uploaded storage files on disk
      const storageBase = process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), '.storage');
      const merchantStorageDir = path.resolve(storageBase, 'imports', mId);
      if (fs.existsSync(merchantStorageDir)) {
        fs.rmSync(merchantStorageDir, { recursive: true, force: true });
      }

      // 2. Database records deletion without swallowing errors
      await prisma.importRow.deleteMany({ where: { import: { merchant_id: mId } } });
      await prisma.import.deleteMany({ where: { merchant_id: mId } });
      await prisma.warehouse.deleteMany({ where: { merchant_id: mId } });
      await prisma.branch.deleteMany({ where: { merchant_id: mId } });
      await prisma.auditLog.deleteMany({ where: { merchant_id: mId } });
      await prisma.deviceSession.deleteMany({ where: { merchant_id: mId } });
      await prisma.user.deleteMany({ where: { merchant_id: mId } });
      await prisma.rolePermission.deleteMany({ where: { role: { merchant_id: mId } } });
      await prisma.role.deleteMany({ where: { merchant_id: mId, is_system: false } });
      await prisma.merchant.delete({ where: { id: mId } });
    };

    if (merchantIdA) {
      await cleanupTenant(merchantIdA);
    }
    if (merchantIdB) {
      await cleanupTenant(merchantIdB);
    }
    await app.close();
  }
}

runImportsSupertestSuite().catch((err) => {
  console.error('FAILED: Imports Supertest Suite', err);
  process.exit(1);
});
