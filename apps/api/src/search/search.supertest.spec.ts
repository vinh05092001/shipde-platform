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
import {
  Prisma,
  RoleEnum,
  SessionStatusEnum,
  CarrierCodeEnum,
  ShipmentStatusEnum,
  ExceptionTypeEnum,
  DiscrepancyTypeEnum,
} from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';

async function runSearchSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - GLOBAL SEARCH SUPERTEST SUITE (FEAT-COM-01)');
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Search Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Search Supertest suite skipped offline safely!');
    return;
  }

  // Execute the real migration against transaction-local tables, never tenant data.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL search_path TO pg_temp`;
    const tables = [
      'orders',
      'shipments',
      'carrier_statements',
      'exception_cases',
      'discrepancies',
      'claims',
    ] as const;
    await tx.$executeRaw`CREATE TEMP TABLE "orders" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "shipments" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "carrier_statements" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "exception_cases" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "discrepancies" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "claims" (
      id TEXT PRIMARY KEY, merchant_id TEXT, order_id TEXT, shipment_id TEXT,
      branch_id VARCHAR(128), warehouse_id VARCHAR(128)
    ) ON COMMIT DROP`;

    await tx.$executeRaw`INSERT INTO "orders" (id, merchant_id) VALUES ('unknown', 'migration-test')`;
    await tx.$executeRaw`INSERT INTO "shipments" (id, merchant_id) VALUES ('unknown', 'migration-test')`;
    await tx.$executeRaw`INSERT INTO "carrier_statements" (id, merchant_id) VALUES ('unknown', 'migration-test')`;
    await tx.$executeRaw`INSERT INTO "exception_cases" (id, merchant_id) VALUES ('unknown', 'migration-test')`;
    await tx.$executeRaw`INSERT INTO "discrepancies" (id, merchant_id) VALUES ('unknown', 'migration-test')`;
    await tx.$executeRaw`INSERT INTO "claims" (id, merchant_id) VALUES ('unknown', 'migration-test')`;

    await tx.$executeRaw`INSERT INTO "orders" (id, merchant_id, branch_id, warehouse_id)
      VALUES ('assigned', 'migration-test', 'branch-known', 'warehouse-known')`;
    await tx.$executeRaw`INSERT INTO "shipments" (id, merchant_id, order_id)
      VALUES ('assigned', 'migration-test', 'assigned')`;
    await tx.$executeRaw`INSERT INTO "exception_cases" (id, merchant_id, shipment_id)
      VALUES ('assigned', 'migration-test', 'assigned')`;
    await tx.$executeRaw`INSERT INTO "discrepancies" (id, merchant_id, shipment_id)
      VALUES ('assigned', 'migration-test', 'assigned')`;
    await tx.$executeRaw`INSERT INTO "claims" (id, merchant_id, shipment_id)
      VALUES ('assigned', 'migration-test', 'assigned')`;

    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../prisma/migrations/20261029141500_feat_com_01_search_scopes/migration.sql'
      ),
      'utf8'
    );
    for (const statement of migration.split(';').filter((part) => part.trim())) {
      await tx.$executeRaw(Prisma.raw(statement));
    }
    type ScopeRow = { id: string; branch_id: string | null; warehouse_id: string | null };
    const queryMap: Record<string, () => Promise<ScopeRow[]>> = {
      orders: () =>
        tx.$queryRaw<ScopeRow[]>`SELECT id, branch_id, warehouse_id FROM "orders" ORDER BY id`,
      shipments: () =>
        tx.$queryRaw<ScopeRow[]>`SELECT id, branch_id, warehouse_id FROM "shipments" ORDER BY id`,
      carrier_statements: () =>
        tx.$queryRaw<
          ScopeRow[]
        >`SELECT id, branch_id, warehouse_id FROM "carrier_statements" ORDER BY id`,
      exception_cases: () =>
        tx.$queryRaw<
          ScopeRow[]
        >`SELECT id, branch_id, warehouse_id FROM "exception_cases" ORDER BY id`,
      discrepancies: () =>
        tx.$queryRaw<
          ScopeRow[]
        >`SELECT id, branch_id, warehouse_id FROM "discrepancies" ORDER BY id`,
      claims: () =>
        tx.$queryRaw<ScopeRow[]>`SELECT id, branch_id, warehouse_id FROM "claims" ORDER BY id`,
    };
    for (const table of tables) {
      const rows = await queryMap[table]();
      assert.deepStrictEqual(
        rows.find((row) => row.id === 'unknown'),
        { id: 'unknown', branch_id: null, warehouse_id: null },
        `${table}: unknown ownership must remain NULL`
      );
      if (table !== 'carrier_statements') {
        assert.deepStrictEqual(
          rows.find((row) => row.id === 'assigned'),
          { id: 'assigned', branch_id: 'branch-known', warehouse_id: 'warehouse-known' },
          `${table}: authoritative parent ownership must propagate`
        );
      }
    }
  });

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);
  let merchantIdA = '';
  let merchantIdB = '';

  try {
    const tokenSecret = 'test-token-secret-for-search-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    merchantIdA = randomUUID();
    merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Shop Alpha Search ${testSuffix}`,
          code: `ALPHA_SRCH_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP ALPHA SEARCH',
          tax_code: `03${testSuffix}`,
        },
        {
          id: merchantIdB,
          name: `Shop Beta Search ${testSuffix}`,
          code: `BETA_SRCH_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP BETA SEARCH',
          tax_code: `01${testSuffix}`,
        },
      ],
    });

    // Setup carrier accounts
    const carrierAccountIdA = randomUUID();
    const carrierAccountIdB = randomUUID();
    await prisma.carrierAccount.createMany({
      data: [
        {
          id: carrierAccountIdA,
          merchant_id: merchantIdA,
          carrier_code: CarrierCodeEnum.GHN,
          label: `GHN Alpha ${testSuffix}`,
          encrypted_credentials: 'cipher-text-alpha',
        },
        {
          id: carrierAccountIdB,
          merchant_id: merchantIdB,
          carrier_code: CarrierCodeEnum.GHN,
          label: `GHN Beta ${testSuffix}`,
          encrypted_credentials: 'cipher-text-beta',
        },
      ],
    });

    // Helper to create user + session token with optional FEAT-RBAC-02 scopes
    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string,
      scopes?: { store_scopes?: string[]; warehouse_scopes?: string[] }
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
          full_name: `Test User ${role}`,
          password_hash: 'hashed',
          role,
          status: 'active',
          store_scopes: scopes?.store_scopes ?? ['*'],
          warehouse_scopes: scopes?.warehouse_scopes ?? ['*'],
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

    const branch1Id = `branch-north-${testSuffix}`;
    const branch2Id = `branch-south-${testSuffix}`;
    const wh1Id = `wh-north-${testSuffix}`;
    const wh2Id = `wh-south-${testSuffix}`;

    const { token: ownerTokenA } = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner_a');
    const { token: warehouseTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'wh_a'
    );
    const { token: accountantTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.ACCOUNTANT,
      'acct_a'
    );
    const { token: ownerTokenB } = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner_b');

    // Scoped users for FEAT-RBAC-02 testing
    const { token: branch1ScopedToken } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'branch1_scoped',
      { store_scopes: [branch1Id], warehouse_scopes: [] }
    );
    const { token: wh1ScopedToken } = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'wh1_scoped',
      { store_scopes: [], warehouse_scopes: [wh1Id] }
    );
    const { token: emptyScopeToken } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'empty_scoped',
      { store_scopes: [], warehouse_scopes: [] }
    );
    const { token: wildcardToken } = await setupUserSession(
      merchantIdA,
      RoleEnum.OPS_CSKH,
      'wildcard_scoped',
      { store_scopes: ['*'], warehouse_scopes: ['*'] }
    );

    // Seed domain aggregates for Merchant A
    const orderCodeA = `ORD-A-${testSuffix}`;
    const orderIdA = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdA,
        merchant_id: merchantIdA,
        branch_id: branch1Id,
        order_code: orderCodeA,
        recipient_name: 'Nguyễn Văn Alpha',
        recipient_phone: '0901234567',
        recipient_province: 'TP Hồ Chí Minh',
        recipient_address: '123 Nguyễn Thị Minh Khai',
        cod_amount: 150000n,
        created_at: new Date(),
      },
    });

    // Secondary order in different branch and warehouse
    const orderCodeA2 = `ORD-A2-${testSuffix}`;
    const orderIdA2 = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdA2,
        merchant_id: merchantIdA,
        branch_id: branch2Id,
        warehouse_id: wh2Id,
        order_code: orderCodeA2,
        recipient_name: 'Trần Văn Beta Branch',
        recipient_phone: '0909876543',
        recipient_province: 'Hà Nội',
        recipient_address: '456 Phố Huế',
        cod_amount: 300000n,
        created_at: new Date(),
      },
    });

    const trackingCodeA = `GHN${testSuffix}A`;
    const shipmentIdA = randomUUID();
    await prisma.shipment.create({
      data: {
        id: shipmentIdA,
        merchant_id: merchantIdA,
        branch_id: null,
        warehouse_id: wh1Id,
        order_id: orderIdA,
        order_code: orderCodeA,
        carrier_code: CarrierCodeEnum.GHN,
        carrier_account_id: carrierAccountIdA,
        tracking_code: trackingCodeA,
        current_status: ShipmentStatusEnum.IN_TRANSIT,
      },
    });

    const trackingCodeA2 = `GHN${testSuffix}B`;
    const shipmentIdA2 = randomUUID();
    await prisma.shipment.create({
      data: {
        id: shipmentIdA2,
        merchant_id: merchantIdA,
        branch_id: branch2Id,
        warehouse_id: wh2Id,
        order_id: orderIdA2,
        order_code: orderCodeA2,
        carrier_code: CarrierCodeEnum.GHN,
        carrier_account_id: carrierAccountIdA,
        tracking_code: trackingCodeA2,
        current_status: ShipmentStatusEnum.IN_TRANSIT,
      },
    });

    const statementChecksumA = `chk${testSuffix}alpha`;
    const statementIdA = randomUUID();
    await prisma.carrierStatement.create({
      data: {
        id: statementIdA,
        merchant_id: merchantIdA,
        branch_id: branch1Id,
        warehouse_id: wh1Id,
        carrier_account_id: carrierAccountIdA,
        checksum: statementChecksumA,
        period_start: new Date('2026-09-01'),
        period_end: new Date('2026-09-15'),
        file_storage_key: `statements/${statementChecksumA}.xlsx`,
        status: 'RECONCILED',
      },
    });

    const exceptionIdA = randomUUID();
    await prisma.exceptionCase.create({
      data: {
        id: exceptionIdA,
        merchant_id: merchantIdA,
        branch_id: branch1Id,
        warehouse_id: wh1Id,
        shipment_id: shipmentIdA,
        tracking_code: trackingCodeA,
        exception_type: ExceptionTypeEnum.DELIVERY_FAIL,
        deadline_at: new Date(Date.now() + 86400000),
      },
    });

    const claimIdA = randomUUID();
    const claimTicketA = `TCK-${testSuffix}A`;
    await prisma.claim.create({
      data: {
        id: claimIdA,
        merchant_id: merchantIdA,
        branch_id: branch1Id,
        warehouse_id: wh1Id,
        shipment_id: shipmentIdA,
        claim_type: 'DAMAGED',
        carrier_ticket: claimTicketA,
        deadline_at: new Date(Date.now() + 86400000),
      },
    });

    const discrepancyIdA = randomUUID();
    await prisma.discrepancy.create({
      data: {
        id: discrepancyIdA,
        merchant_id: merchantIdA,
        branch_id: branch1Id,
        warehouse_id: wh1Id,
        shipment_id: shipmentIdA,
        tracking_code: trackingCodeA,
        type: DiscrepancyTypeEnum.D1_WEIGHT,
        amount: 25000n,
      },
    });

    // Seed domain entity for Merchant B (Tenant Isolation verification)
    const orderCodeB = `ORD-B-${testSuffix}`;
    const orderIdB = randomUUID();
    await prisma.order.create({
      data: {
        id: orderIdB,
        merchant_id: merchantIdB,
        branch_id: 'branch-b-1',
        warehouse_id: 'wh-b-1',
        order_code: orderCodeB,
        recipient_name: 'Trần Thị Beta',
        recipient_phone: '0909999888',
        recipient_province: 'Hà Nội',
        recipient_address: '456 Cầu Giấy',
        created_at: new Date(),
      },
    });

    // Seed legacy unassigned entity for Merchant A (both scope dimensions null)
    const legacyOrderCodeA = `ORD-LEGACY-${testSuffix}`;
    const legacyOrderIdA = randomUUID();
    await prisma.order.create({
      data: {
        id: legacyOrderIdA,
        merchant_id: merchantIdA,
        branch_id: null,
        warehouse_id: null,
        order_code: legacyOrderCodeA,
        recipient_name: 'Khách Hàng Unassigned',
        recipient_phone: '0901234567',
        recipient_province: 'TP Hồ Chí Minh',
        recipient_address: '100 Lê Duẩn',
        cod_amount: 100000n,
        created_at: new Date(),
      },
    });

    const server = app.getHttpServer();

    // =========================================================================
    // AC-COM-01-01: Order search returns ORDER result
    // =========================================================================
    const resOrd = await request(server)
      .get(`/api/v1/search?q=${orderCodeA}&type=ORDER`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resOrd.body.success, true);
    assert.strictEqual(resOrd.body.data.total, 1);
    assert.strictEqual(resOrd.body.data.items[0].type, 'ORDER');
    assert.strictEqual(resOrd.body.data.items[0].code, orderCodeA);
    assert.ok(resOrd.body.data.items[0].url.includes(orderIdA));

    // =========================================================================
    // AC-COM-01-02: Shipment search returns WAYBILL result
    // =========================================================================
    const resShip = await request(server)
      .get(`/api/v1/search?q=${trackingCodeA}&type=WAYBILL`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resShip.body.success, true);
    assert.strictEqual(resShip.body.data.total, 1);
    assert.strictEqual(resShip.body.data.items[0].type, 'WAYBILL');
    assert.strictEqual(resShip.body.data.items[0].code, trackingCodeA);
    assert.strictEqual(resShip.body.data.items[0].status, 'IN_TRANSIT');

    // =========================================================================
    // AC-COM-01-03: Batch search returns BATCH result for Accountant/Owner
    // =========================================================================
    const resBatch = await request(server)
      .get(`/api/v1/search?q=${statementChecksumA.slice(0, 8)}&type=BATCH`)
      .set('Authorization', `Bearer ${accountantTokenA}`)
      .expect(200);

    assert.strictEqual(resBatch.body.success, true);
    assert.strictEqual(resBatch.body.data.total, 1);
    assert.strictEqual(resBatch.body.data.items[0].type, 'BATCH');
    assert.strictEqual(resBatch.body.data.items[0].status, 'RECONCILED');

    // =========================================================================
    // AC-COM-01-04: Case search returns CASE results (Exceptions and Claims)
    // =========================================================================
    const resCase = await request(server)
      .get(`/api/v1/search?q=${trackingCodeA}&type=CASE`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resCase.body.success, true);
    assert.ok(resCase.body.data.total >= 1);
    assert.ok(resCase.body.data.items.some((i: any) => i.type === 'CASE'));

    // =========================================================================
    // AC-COM-01-05: Transaction search returns TRANSACTION results
    // =========================================================================
    const resTx = await request(server)
      .get(`/api/v1/search?q=${trackingCodeA}&type=TRANSACTION`)
      .set('Authorization', `Bearer ${accountantTokenA}`)
      .expect(200);

    assert.strictEqual(resTx.body.success, true);
    assert.strictEqual(resTx.body.data.total, 1);
    assert.strictEqual(resTx.body.data.items[0].type, 'TRANSACTION');

    // =========================================================================
    // AC-COM-01-06: Validation error on query < 2 characters
    // =========================================================================
    const resShort = await request(server)
      .get('/api/v1/search?q=x')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(400);

    assert.strictEqual(resShort.body.error.code, 'VALIDATION_ERROR');

    // =========================================================================
    // AC-COM-01-07: Validation error on invalid type
    // =========================================================================
    const resBadType = await request(server)
      .get(`/api/v1/search?q=${trackingCodeA}&type=INVALID_TYPE`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(400);

    assert.strictEqual(resBadType.body.error.code, 'VALIDATION_ERROR');

    // =========================================================================
    // AC-COM-01-08: Validation error on invalid limit
    // =========================================================================
    const resBadLimit = await request(server)
      .get(`/api/v1/search?q=${trackingCodeA}&limit=0`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(400);

    assert.strictEqual(resBadLimit.body.error.code, 'VALIDATION_ERROR');

    // =========================================================================
    // AC-COM-01-09: Cross-tenant isolation (Tenant A searching Tenant B code)
    // =========================================================================
    const resCrossTenant = await request(server)
      .get(`/api/v1/search?q=${orderCodeB}&type=ORDER`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resCrossTenant.body.data.total, 0, 'Tenant A must never see Tenant B data');
    assert.strictEqual(resCrossTenant.body.data.items.length, 0);

    // =========================================================================
    // AC-COM-01-10: Role boundary: Warehouse user searching type=ALL excludes batches
    // =========================================================================
    const resWhAll = await request(server)
      .get(`/api/v1/search?q=${testSuffix}&type=ALL`)
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .expect(200);

    assert.strictEqual(resWhAll.body.success, true);
    const hasBatchOrTx = resWhAll.body.data.items.some(
      (i: any) => i.type === 'BATCH' || i.type === 'TRANSACTION'
    );
    assert.strictEqual(hasBatchOrTx, false, 'Warehouse user must not receive reconciliation data');

    // =========================================================================
    // AC-COM-01-11: Role boundary: Warehouse user requesting type=BATCH -> 403
    // =========================================================================
    const resWhBatch = await request(server)
      .get(`/api/v1/search?q=${testSuffix}&type=BATCH`)
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .expect(403);

    assert.strictEqual(resWhBatch.body.error.code, 'FORBIDDEN');

    // =========================================================================
    // AC-COM-01-12: PII masking: Warehouse user gets masked recipient phone
    // =========================================================================
    const resPiiMasked = await request(server)
      .get(`/api/v1/search?q=${orderCodeA}&type=ORDER`)
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .expect(200);

    const maskedItem = resPiiMasked.body.data.items[0];
    assert.strictEqual(maskedItem.metadata.recipient_phone, '090****567');
    assert.ok(maskedItem.subtitle.includes('090****567'));
    assert.ok(!maskedItem.subtitle.includes('0901234567'));

    // =========================================================================
    // AC-COM-01-13: Audit log integrity & masked search query
    // =========================================================================
    const auditRes = await request(server)
      .get('/api/v1/search?q=0901234567&type=ORDER')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(auditRes.body.success, true);
    const auditRecord = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'GLOBAL_SEARCH_QUERY',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(auditRecord, 'Audit log must be created');
    const logNewVal = auditRecord?.new_value as any;
    assert.strictEqual(logNewVal.query, '090****567', 'Audit log query must mask phone number');

    // =========================================================================
    // AC-COM-01-14: Unauthenticated request -> 401
    // =========================================================================
    await request(server).get('/api/v1/search?q=test').expect(401);

    // =========================================================================
    // AC-COM-01-15: Route alias without /api/v1 prefix -> 200
    // =========================================================================
    const resAlias = await request(server)
      .get(`/search?q=${orderCodeA}&type=ORDER`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resAlias.body.success, true);
    assert.strictEqual(resAlias.body.data.total, 1);
    assert.strictEqual(resAlias.body.data.items[0].code, orderCodeA);

    // =========================================================================
    // AC-COM-01-27: FEAT-RBAC-02 Branch Scope: User scoped to Branch 1 only sees Branch 1 orders
    // =========================================================================
    const resBranchScoped = await request(server)
      .get(`/api/v1/search?q=ORD-A&type=ORDER`)
      .set('Authorization', `Bearer ${branch1ScopedToken}`)
      .expect(200);

    assert.strictEqual(resBranchScoped.body.success, true);
    assert.strictEqual(resBranchScoped.body.data.total, 1);
    assert.strictEqual(resBranchScoped.body.data.items[0].code, orderCodeA);

    // =========================================================================
    // AC-COM-01-28: FEAT-RBAC-02 Warehouse Scope: User scoped to Warehouse 1 only sees Warehouse 1 shipments
    // =========================================================================
    const resWhScoped = await request(server)
      .get(`/api/v1/search?q=GHN${testSuffix}&type=WAYBILL`)
      .set('Authorization', `Bearer ${wh1ScopedToken}`)
      .expect(200);

    assert.strictEqual(resWhScoped.body.success, true);
    assert.strictEqual(resWhScoped.body.data.total, 1);
    assert.strictEqual(resWhScoped.body.data.items[0].code, trackingCodeA);

    // =========================================================================
    // AC-COM-01-29: User with empty scopes receives 0 results
    // =========================================================================
    const resEmptyScoped = await request(server)
      .get(`/api/v1/search?q=ORD-A&type=ORDER`)
      .set('Authorization', `Bearer ${emptyScopeToken}`)
      .expect(200);

    assert.strictEqual(resEmptyScoped.body.success, true);
    assert.strictEqual(resEmptyScoped.body.data.total, 0);
    assert.strictEqual(resEmptyScoped.body.data.items.length, 0);

    // =========================================================================
    // AC-COM-01-30: Audit masking handles formatted phone numbers
    // =========================================================================
    await request(server)
      .get('/api/v1/search?q=090-123-4567&type=ORDER')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    const formattedPhoneLog = await prisma.auditLog.findFirst({
      where: {
        merchant_id: merchantIdA,
        action: 'GLOBAL_SEARCH_QUERY',
      },
      orderBy: { created_at: 'desc' },
    });
    assert.ok(formattedPhoneLog, 'Formatted phone audit log must exist');
    assert.strictEqual(
      (formattedPhoneLog.new_value as any).query,
      '090****567',
      'Formatted phone number must be masked in audit log'
    );

    // =========================================================================
    // Wildcard scopes alone cannot authorize unassigned records
    // =========================================================================
    const resWildcardOrder = await request(server)
      .get(`/api/v1/search?q=${legacyOrderCodeA}&type=ORDER`)
      .set('Authorization', `Bearer ${wildcardToken}`)
      .expect(200);

    assert.strictEqual(resWildcardOrder.body.success, true);
    assert.strictEqual(resWildcardOrder.body.data.total, 0);
    assert.deepStrictEqual(resWildcardOrder.body.data.items, []);

    const resTenantWide = await request(server)
      .get(`/api/v1/search?q=${legacyOrderCodeA}&type=ORDER`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    assert.strictEqual(resTenantWide.body.data.total, 1);
    assert.strictEqual(resTenantWide.body.data.items[0].id, legacyOrderIdA);

    console.log('🎉 All Search Supertest Acceptance Criteria Passed Successfully!');
  } finally {
    const tenantIds = [merchantIdA, merchantIdB].filter(Boolean);
    if (tenantIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.claim.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.discrepancy.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.statementRow.deleteMany({
        where: { statement: { merchant_id: { in: tenantIds } } },
      });
      await prisma.carrierStatement.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.exceptionContactLog.deleteMany({
        where: { user: { merchant_id: { in: tenantIds } } },
      });
      await prisma.exceptionCase.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.shipmentEvent.deleteMany({
        where: { shipment: { merchant_id: { in: tenantIds } } },
      });
      await prisma.returnRecord.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.shipment.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.order.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.carrierAccount.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.deviceSession.deleteMany({
        where: { user: { merchant_id: { in: tenantIds } } },
      });
      await prisma.user.deleteMany({ where: { merchant_id: { in: tenantIds } } });
      await prisma.merchant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await app.close();
  }
}

runSearchSupertestSuite()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Search Supertest suite failed:', err);
    process.exit(1);
  });
