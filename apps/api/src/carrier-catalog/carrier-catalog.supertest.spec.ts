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
import { RoleEnum, SessionStatusEnum, CarrierCodeEnum, CarrierTierEnum } from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { RbacService } from '../rbac/rbac.service';
import {
  CATALOG_REVISION_2026_10_31,
  SEED_CARRIERS,
  SEED_CARRIER_SERVICES,
  SEED_CANONICAL_STATUSES,
  SEED_FEE_COMPONENTS,
  SEED_COMPATIBILITY_MAPPINGS,
} from '@shipde/testkit';

async function seedCatalogIfMissing(prisma: PrismaService) {
  for (const c of SEED_CARRIERS) {
    await prisma.carrier.upsert({
      where: {
        catalogRevision_code: {
          catalogRevision: c.catalog_revision,
          code: c.code,
        },
      },
      update: {
        name: c.name,
        logoUrl: c.logo_url,
        isActive: c.is_active,
        evidenceLevel: c.evidence_level,
        description: c.description,
      },
      create: {
        id: c.id,
        catalogRevision: c.catalog_revision,
        code: c.code,
        name: c.name,
        logoUrl: c.logo_url,
        isActive: c.is_active,
        evidenceLevel: c.evidence_level,
        description: c.description,
      },
    });
  }

  for (const s of SEED_CARRIER_SERVICES) {
    await prisma.carrierService.upsert({
      where: {
        catalogRevision_carrierCode_code: {
          catalogRevision: s.catalog_revision,
          carrierCode: s.carrier_code,
          code: s.code,
        },
      },
      update: {
        name: s.name,
        serviceType: s.service_type,
        description: s.description,
        isActive: s.is_active,
        evidenceLevel: s.evidence_level,
        sourceRevision: s.source_revision,
      },
      create: {
        id: s.id,
        carrierId: s.carrier_id,
        catalogRevision: s.catalog_revision,
        carrierCode: s.carrier_code,
        code: s.code,
        name: s.name,
        serviceType: s.service_type,
        description: s.description,
        isActive: s.is_active,
        evidenceLevel: s.evidence_level,
        sourceRevision: s.source_revision,
      },
    });
  }

  for (const st of SEED_CANONICAL_STATUSES) {
    await prisma.canonicalStatusReference.upsert({
      where: {
        catalogRevision_code: {
          catalogRevision: st.catalog_revision,
          code: st.code,
        },
      },
      update: {
        category: st.category,
        label: st.label,
        description: st.description,
        stageOrder: st.stage_order,
      },
      create: {
        id: st.id,
        catalogRevision: st.catalog_revision,
        code: st.code,
        category: st.category,
        label: st.label,
        description: st.description,
        stageOrder: st.stage_order,
      },
    });
  }

  for (const fc of SEED_FEE_COMPONENTS) {
    await prisma.feeComponentReference.upsert({
      where: {
        catalogRevision_code: {
          catalogRevision: fc.catalog_revision,
          code: fc.code,
        },
      },
      update: {
        name: fc.name,
        category: fc.category,
        description: fc.description,
        isRefundable: fc.is_refundable,
        vatApplicable: fc.vat_applicable,
      },
      create: {
        id: fc.id,
        catalogRevision: fc.catalog_revision,
        code: fc.code,
        name: fc.name,
        category: fc.category,
        description: fc.description,
        isRefundable: fc.is_refundable,
        vatApplicable: fc.vat_applicable,
      },
    });
  }

  for (const m of SEED_COMPATIBILITY_MAPPINGS) {
    await prisma.catalogCompatibilityMapping.upsert({
      where: {
        id: m.id,
      },
      update: {
        catalogRevision: m.catalog_revision,
        carrierCode: m.carrier_code,
        domain: m.domain,
        rawKey: m.raw_key,
        canonicalCode: m.canonical_code,
        disposition: m.disposition,
      },
      create: {
        id: m.id,
        catalogRevision: m.catalog_revision,
        carrierCode: m.carrier_code,
        domain: m.domain,
        rawKey: m.raw_key,
        canonicalCode: m.canonical_code,
        disposition: m.disposition,
      },
    });
  }
}

async function runCarrierCatalogSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - CARRIER CATALOG SUPERTEST SUITE (FEAT-CAR-01)');
  console.log('================================================================');

  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../../../../.env'),
    path.resolve(__dirname, '../../../../.env'),
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Carrier Catalog Supertest tests.`
    );
    await app.close();
    console.log('🎉 Carrier Catalog Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();
  await seedCatalogIfMissing(prisma);

  const testSuffix = Date.now().toString().slice(-6);
  const merchantIdA = randomUUID();
  const merchantIdB = randomUUID();

  try {
    const tokenSecret = 'test-token-secret-for-catalog-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Catalog Shop A ${testSuffix}`,
          code: `CAT_A_${testSuffix}`,
          status: 'active',
        },
        {
          id: merchantIdB,
          name: `Catalog Shop B ${testSuffix}`,
          code: `CAT_B_${testSuffix}`,
          status: 'active',
        },
      ],
    });

    // Helper to create user + session token
    const setupUserSession = async (
      mId: string,
      role: RoleEnum,
      emailSuffix: string
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

    const ownerA = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'ownerA');
    const opsA = await setupUserSession(merchantIdA, RoleEnum.OPS_CSKH, 'opsA');
    const warehouseA = await setupUserSession(merchantIdA, RoleEnum.WAREHOUSE, 'warehouseA');
    const ownerB = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'ownerB');

    // Create a private carrier account for Tenant B to prove Tenant A never sees it (AC-CAR-01-08)
    const privateAccountId = randomUUID();
    await prisma.carrierAccount.create({
      data: {
        id: privateAccountId,
        merchant_id: merchantIdB,
        carrier_code: CarrierCodeEnum.GHN,
        label: `Private GHN Account ${testSuffix}`,
        tier: CarrierTierEnum.L1_ASSIST,
        encrypted_credentials: '{"token":"super-secret-ghn-key-tenant-b"}',
        status: 'ACTIVE',
      },
    });

    const initialAccountCount = await prisma.carrierAccount.count();

    // --------------------------------------------------------------------------
    // AC-CAR-01-01 / TEST-CAR-01-CATALOG-LIST
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-01: List Carriers (/api/v1/carrier-catalog/carriers)');
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(listRes.body.catalog_revision, CATALOG_REVISION_2026_10_31);
    assert.strictEqual(listRes.body.data.length, 4);
    assert.deepStrictEqual(
      listRes.body.data.map((c: any) => c.code),
      ['GHN', 'GHTK', 'VIETTEL_POST', 'JT']
    );
    // Verify GHN details
    const ghnCarrier = listRes.body.data[0];
    assert.strictEqual(ghnCarrier.name, 'Giao Hàng Nhanh');
    assert.strictEqual(ghnCarrier.evidence_level, 'VERIFIED_OFFICIAL');
    assert.strictEqual(ghnCarrier.is_active, true);
    assert.strictEqual(ghnCarrier.logo_url, null);

    // Also verify non-prefixed route works identically
    const listResNonPrefixed = await request(app.getHttpServer())
      .get('/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);
    assert.deepStrictEqual(listRes.body, listResNonPrefixed.body);

    // Filter ?is_active=true
    const activeRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers?is_active=true')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);
    assert.strictEqual(activeRes.body.data.length, 4);

    console.log('  ✔ AC-CAR-01-01: List Carriers returned 200 with 4 canonical carriers');

    // --------------------------------------------------------------------------
    // AC-CAR-01-02 / TEST-CAR-01-CARRIER-DETAIL
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-02: Carrier Detail (/api/v1/carrier-catalog/carriers/:code)');
    const detailRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers/GHN')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(detailRes.body.catalog_revision, CATALOG_REVISION_2026_10_31);
    assert.strictEqual(detailRes.body.data.code, 'GHN');
    assert.strictEqual(detailRes.body.data.name, 'Giao Hàng Nhanh');
    assert.strictEqual(detailRes.body.data.evidence_level, 'VERIFIED_OFFICIAL');
    assert.strictEqual(detailRes.body.data.services.length, 2);

    const ghnServiceCodes = detailRes.body.data.services.map((s: any) => s.code);
    assert.ok(ghnServiceCodes.includes('GHN_STANDARD'));
    assert.ok(ghnServiceCodes.includes('GHN_FAST'));
    console.log('  ✔ AC-CAR-01-02: Carrier Detail returned 200 with services');

    // --------------------------------------------------------------------------
    // AC-CAR-01-03 / TEST-CAR-01-ALIAS-RESOLUTION
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-03: Alias Resolution (VTP -> VIETTEL_POST, JT_EXPRESS -> JT)');
    const vtpRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers/VTP')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    const canonicalVtpRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers/VIETTEL_POST')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(vtpRes.body.data.code, 'VIETTEL_POST');
    assert.strictEqual(vtpRes.body.data.name, 'Viettel Post');
    assert.deepStrictEqual(vtpRes.body, canonicalVtpRes.body);

    const jtExpRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers/JT_EXPRESS')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    const canonicalJtRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers/JT')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(jtExpRes.body.data.code, 'JT');
    assert.strictEqual(jtExpRes.body.data.name, 'J&T Express Vietnam');
    assert.deepStrictEqual(jtExpRes.body, canonicalJtRes.body);

    // Case-sensitivity and unknown codes: 404 RESOURCE_NOT_FOUND
    const badTokens = ['vtp', 'ViettelPost', 'J&T', 'UNKNOWN'];
    for (const token of badTokens) {
      const errRes = await request(app.getHttpServer())
        .get(`/api/v1/carrier-catalog/carriers/${token}`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .expect(404);

      assert.strictEqual(errRes.body.error.code, 'RESOURCE_NOT_FOUND');
    }
    console.log('  ✔ AC-CAR-01-03: Alias resolution and 404 RESOURCE_NOT_FOUND verified');

    // --------------------------------------------------------------------------
    // AC-CAR-01-04 / TEST-CAR-01-STATUSES
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-04: Canonical Shipment Statuses');
    const statusesRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/statuses')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(statusesRes.body.catalog_revision, CATALOG_REVISION_2026_10_31);
    assert.strictEqual(statusesRes.body.data.length, 17);
    // Verify sorted by stage_order
    for (let i = 1; i < statusesRes.body.data.length; i++) {
      assert.ok(statusesRes.body.data[i].stage_order >= statusesRes.body.data[i - 1].stage_order);
    }
    console.log('  ✔ AC-CAR-01-04: Canonical Statuses returned 17 states ordered by stage_order');

    // --------------------------------------------------------------------------
    // AC-CAR-01-05 / TEST-CAR-01-FEES
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-05: Canonical Fee Components');
    const feesRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/fee-components')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(feesRes.body.catalog_revision, CATALOG_REVISION_2026_10_31);
    assert.strictEqual(feesRes.body.data.length, 8);
    const feeCodes = feesRes.body.data.map((f: any) => f.code);
    assert.ok(feeCodes.includes('BASE_FREIGHT'));
    assert.ok(feeCodes.includes('VAT'));
    console.log('  ✔ AC-CAR-01-05: Fee components returned 8 canonical definitions');

    // --------------------------------------------------------------------------
    // AC-CAR-01-06 / Compatibility Mappings Endpoint
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-06: Compatibility Mappings Endpoint');
    const mapRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/compatibility?domain=STATUS&carrier_code=GHN')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    assert.strictEqual(mapRes.body.catalog_revision, CATALOG_REVISION_2026_10_31);
    assert.ok(mapRes.body.data.length > 0);
    const failMap = mapRes.body.data.find((m: any) => m.raw_key === 'delivery_fail');
    assert.ok(failMap);
    assert.strictEqual(failMap.canonical_code, 'DELIVERY_FAILED');

    // Empty result for unknown key (does not 404)
    const emptyMapRes = await request(app.getHttpServer())
      .get(
        '/api/v1/carrier-catalog/compatibility?domain=STATUS&carrier_code=GHN&raw_key=nonexistent'
      )
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);
    assert.deepStrictEqual(emptyMapRes.body.data, []);
    console.log('  ✔ AC-CAR-01-06: Compatibility mapping queried successfully');

    // --------------------------------------------------------------------------
    // AC-CAR-01-07 / TEST-CAR-01-AUTHZ-DENIED
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-07: Authorization and Authentication Enforcement');
    // Anonymous request -> 401 UNAUTHORIZED
    const anonRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .expect(401);
    assert.strictEqual(anonRes.body.error.code, 'UNAUTHENTICATED');

    // Unauthorized role (WAREHOUSE lacks iam:carrier_catalog:read) -> 403 FORBIDDEN
    const forbiddenRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${warehouseA.token}`)
      .expect(403);
    assert.strictEqual(forbiddenRes.body.error.code, 'FORBIDDEN');
    // Zero catalog data leaked
    assert.strictEqual(forbiddenRes.body.data, undefined);

    // Permitted roles: OPS_CSKH can access catalog
    const opsRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${opsA.token}`)
      .expect(200);
    assert.strictEqual(opsRes.body.data.length, 4);

    console.log('  ✔ AC-CAR-01-07: Authz denied 401/403 enforced and Ops permitted');

    // --------------------------------------------------------------------------
    // AC-CAR-01-08 / TEST-CAR-01-TENANT-ISOLATION
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-08: Tenant Isolation');
    const tenantARes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .expect(200);

    const tenantBRes = await request(app.getHttpServer())
      .get('/api/v1/carrier-catalog/carriers')
      .set('Authorization', `Bearer ${ownerB.token}`)
      .expect(200);

    // Both tenants see identical platform catalog
    assert.deepStrictEqual(tenantARes.body, tenantBRes.body);

    // Ensure zero leak of Tenant B's private account token or account details
    const serializedA = JSON.stringify(tenantARes.body);
    assert.ok(!serializedA.includes('super-secret-ghn-key-tenant-b'));
    assert.ok(!serializedA.includes(privateAccountId));
    console.log('  ✔ AC-CAR-01-08: Tenant isolation verified with zero private account leak');

    // --------------------------------------------------------------------------
    // AC-CAR-01-09 / TEST-CAR-01-NO-SIDE-EFFECTS
    // --------------------------------------------------------------------------
    console.log('▶ Testing AC-CAR-01-09: Browsing catalog produces zero side effects');
    const finalAccountCount = await prisma.carrierAccount.count();
    assert.strictEqual(
      finalAccountCount,
      initialAccountCount,
      'Browsing catalog must insert 0 carrier_accounts rows'
    );
    console.log('  ✔ AC-CAR-01-09: Zero database side-effects verified');

    console.log('================================================================');
    console.log('🎉 ALL CARRIER CATALOG SUPERTEST TESTS PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    // Teardown test fixtures
    try {
      await prisma.carrierAccount.deleteMany({
        where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
      });
      await prisma.deviceSession.deleteMany({
        where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
      });
      await prisma.user.deleteMany({
        where: { merchant_id: { in: [merchantIdA, merchantIdB] } },
      });
      await prisma.merchant.deleteMany({
        where: { id: { in: [merchantIdA, merchantIdB] } },
      });
    } catch {
      // Ignore cleanup error in teardown
    }
    await app.close();
  }
}

if (require.main === module || process.argv[1]?.includes('carrier-catalog.supertest.spec.ts')) {
  runCarrierCatalogSupertestSuite().catch((err) => {
    console.error('❌ Carrier Catalog Supertest Suite failed:', err);
    process.exit(1);
  });
}
