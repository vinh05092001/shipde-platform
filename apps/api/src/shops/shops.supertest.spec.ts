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

async function runShopsSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - SHOP PROFILE SUPERTEST SUITE (FEAT-ORG-01)');
  console.log('================================================================');

  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
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
      `⚠️ PostgreSQL is not reachable at ${databaseUrl}. Skipping live Shops Supertest tests (run 'pnpm infra:up' to enable).`
    );
    await app.close();
    console.log('🎉 Shops Supertest suite skipped offline safely!');
    return;
  }

  await app.get(RbacService).ensurePlatformSeed();

  const testSuffix = Date.now().toString().slice(-6);

  try {
    const tokenSecret = 'test-token-secret-for-shops-supertest-32-chars';
    process.env.AUTH_TOKEN_SECRET = tokenSecret;

    // 1. Fixture: Merchant A & Merchant B
    const merchantIdA = randomUUID();
    const merchantIdB = randomUUID();

    await prisma.merchant.createMany({
      data: [
        {
          id: merchantIdA,
          name: `Shop Alpha ${testSuffix}`,
          code: `ALPHA_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP ALPHA',
          tax_code: '0312345678',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          default_fee_payer: 'SHOP',
          default_weight_unit: 'g',
          auto_routing_enabled: false,
        },
        {
          id: merchantIdB,
          name: `Shop Beta ${testSuffix}`,
          code: `BETA_${testSuffix}`,
          status: 'active',
          legal_name: 'CTY CP BETA',
          tax_code: '0101234567',
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
          default_fee_payer: 'SHOP',
          default_weight_unit: 'g',
          auto_routing_enabled: false,
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

    const { token: ownerTokenA } = await setupUserSession(merchantIdA, RoleEnum.OWNER, 'owner_a');
    const { token: warehouseTokenA } = await setupUserSession(
      merchantIdA,
      RoleEnum.WAREHOUSE,
      'wh_a'
    );
    const { token: ownerTokenB } = await setupUserSession(merchantIdB, RoleEnum.OWNER, 'owner_b');

    // ========================================================================
    // AC-ORG-01-01: Authenticated owner requests shop profile
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-01: GET /api/v1/shops/profile (Owner A)...');
    const resGetProfile = await request(app.getHttpServer())
      .get('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resGetProfile.body.success, true);
    assert.strictEqual(resGetProfile.body.data.id, merchantIdA);
    assert.strictEqual(resGetProfile.body.data.name, `Shop Alpha ${testSuffix}`);
    assert.strictEqual(resGetProfile.body.data.legal_name, 'CTY CP ALPHA');
    assert.strictEqual(resGetProfile.body.data.tax_code, '0312345678');
    assert.strictEqual(resGetProfile.body.data.default_fee_payer, 'SHOP');
    console.log('  PASS: AC-ORG-01-01 verified successfully.');

    // ========================================================================
    // AC-ORG-01-02: Update legal profile and verify audit log
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-02: PATCH /api/v1/shops/profile (Legal profile)...');
    const resPatchLegal = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        name: `Shop Alpha Updated ${testSuffix}`,
        legal_name: 'Công ty Cổ phần Thời trang Alpha Toàn Cầu',
        tax_code: '0312345678-001',
        contact_email: 'lienhe@alpha.vn',
        contact_phone: '0901234567',
        legal_address: '100 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
      })
      .expect(200);

    assert.strictEqual(resPatchLegal.body.success, true);
    assert.strictEqual(resPatchLegal.body.data.name, `Shop Alpha Updated ${testSuffix}`);
    assert.strictEqual(
      resPatchLegal.body.data.legal_name,
      'Công ty Cổ phần Thời trang Alpha Toàn Cầu'
    );
    assert.strictEqual(resPatchLegal.body.data.tax_code, '0312345678-001');
    assert.strictEqual(resPatchLegal.body.data.contact_email, 'lienhe@alpha.vn');
    assert.strictEqual(resPatchLegal.body.data.contact_phone, '0901234567');
    assert.strictEqual(
      resPatchLegal.body.data.legal_address,
      '100 Lê Lợi, Quận 1, TP. Hồ Chí Minh'
    );

    // Verify DB update
    const dbMerchantAfterLegal = await prisma.merchant.findUnique({ where: { id: merchantIdA } });
    assert.strictEqual(dbMerchantAfterLegal?.name, `Shop Alpha Updated ${testSuffix}`);
    assert.strictEqual(dbMerchantAfterLegal?.tax_code, '0312345678-001');

    // Verify audit log
    const auditLogsAfterLegal = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA, action: 'SHOP_PROFILE_UPDATED' },
    });
    assert.ok(
      auditLogsAfterLegal.length >= 1,
      'Expected at least 1 SHOP_PROFILE_UPDATED audit log'
    );
    const legalAudit = auditLogsAfterLegal[auditLogsAfterLegal.length - 1];
    assert.strictEqual(legalAudit.entity_type, 'merchant');
    assert.strictEqual(legalAudit.entity_id, merchantIdA);
    assert.strictEqual(legalAudit.actor, 'OWNER');
    console.log('  PASS: AC-ORG-01-02 verified with DB and audit proof.');

    // ========================================================================
    // AC-ORG-01-03: Update billing profile
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-03: PATCH /api/v1/shops/profile (Billing profile)...');
    const resPatchBilling = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        billing_email: 'ketoan@alpha.vn',
        billing_address: '100 Lê Lợi, Quận 1, TP. Hồ Chí Minh',
        bank_name: 'Vietcombank',
        bank_account_number: '0071001234567',
        bank_account_name: 'cty cp alpha toan cau',
        bank_branch: 'Chi nhánh TP.HCM',
      })
      .expect(200);

    assert.strictEqual(resPatchBilling.body.data.billing_email, 'ketoan@alpha.vn');
    assert.strictEqual(resPatchBilling.body.data.bank_name, 'Vietcombank');
    assert.strictEqual(resPatchBilling.body.data.bank_account_number, '0071001234567');
    assert.strictEqual(resPatchBilling.body.data.bank_account_name, 'CTY CP ALPHA TOAN CAU');
    console.log('  PASS: AC-ORG-01-03 verified with uppercase normalized bank account name.');

    // ========================================================================
    // AC-ORG-01-04: Update operating defaults
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-04: PATCH /api/v1/shops/profile (Operating defaults)...');
    const resPatchOperating = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({
        default_fee_payer: 'RECIPIENT',
        default_weight_unit: 'kg',
        auto_routing_enabled: true,
        operating_notes: 'Kiểm tra kỹ tem niêm phong',
      })
      .expect(200);

    assert.strictEqual(resPatchOperating.body.data.default_fee_payer, 'RECIPIENT');
    assert.strictEqual(resPatchOperating.body.data.default_weight_unit, 'kg');
    assert.strictEqual(resPatchOperating.body.data.auto_routing_enabled, true);
    assert.strictEqual(resPatchOperating.body.data.operating_notes, 'Kiểm tra kỹ tem niêm phong');
    console.log('  PASS: AC-ORG-01-04 verified successfully.');

    // ========================================================================
    // AC-ORG-01-05: Validation error on invalid tax code
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-05: Invalid tax code validation...');
    const resInvalidTax = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ tax_code: '12345' })
      .expect(400);

    assert.strictEqual(resInvalidTax.body.error.code, 'VALIDATION_ERROR');
    assert.ok(
      resInvalidTax.body.error.fields.some((f: any) => f.field === 'tax_code'),
      'Expected field error for tax_code'
    );
    console.log('  PASS: AC-ORG-01-05 verified with 400 VALIDATION_ERROR.');

    // ========================================================================
    // AC-ORG-01-06: Validation error on invalid email / phone
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-06: Invalid email & phone validation...');
    const resInvalidEmail = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ contact_email: 'not-an-email', contact_phone: '123' })
      .expect(400);

    assert.strictEqual(resInvalidEmail.body.error.code, 'VALIDATION_ERROR');
    assert.ok(resInvalidEmail.body.error.fields.some((f: any) => f.field === 'contact_email'));
    assert.ok(resInvalidEmail.body.error.fields.some((f: any) => f.field === 'contact_phone'));
    console.log('  PASS: AC-ORG-01-06 verified.');

    // ========================================================================
    // AC-ORG-01-07: Validation error on invalid bank account number
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-07: Invalid bank account number...');
    const resInvalidBank = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ bank_account_number: '12' })
      .expect(400);

    assert.strictEqual(resInvalidBank.body.error.code, 'VALIDATION_ERROR');
    assert.ok(resInvalidBank.body.error.fields.some((f: any) => f.field === 'bank_account_number'));
    console.log('  PASS: AC-ORG-01-07 verified.');

    // ========================================================================
    // AC-ORG-01-08: Validation error on invalid fee payer
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-08: Invalid fee payer enum...');
    const resInvalidFee = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ default_fee_payer: 'NEITHER' })
      .expect(400);

    assert.strictEqual(resInvalidFee.body.error.code, 'VALIDATION_ERROR');
    assert.ok(resInvalidFee.body.error.fields.some((f: any) => f.field === 'default_fee_payer'));
    console.log('  PASS: AC-ORG-01-08 verified.');

    // ========================================================================
    // AC-ORG-01-08b: Validation error on invalid timezone and currency
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-08b: Invalid timezone and currency...');
    const resInvalidTzCurr = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ timezone: 'Invalid/Timezone_Fake', currency: 'USD' })
      .expect(400);

    assert.strictEqual(resInvalidTzCurr.body.error.code, 'VALIDATION_ERROR');
    assert.ok(resInvalidTzCurr.body.error.fields.some((f: any) => f.field === 'timezone'));
    assert.ok(resInvalidTzCurr.body.error.fields.some((f: any) => f.field === 'currency'));
    console.log('  PASS: AC-ORG-01-08b verified invalid timezone and currency.');

    // ========================================================================
    // AC-ORG-01-09: User lacking iam:shop_config capability (WAREHOUSE) -> 403
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-09: Unauthorized role (WAREHOUSE) attempting mutation...');
    const resForbiddenWh = await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .set('Authorization', `Bearer ${warehouseTokenA}`)
      .send({ name: 'Hacked Shop Name' })
      .expect(403);

    assert.strictEqual(resForbiddenWh.body.error.code, 'FORBIDDEN');
    console.log('  PASS: AC-ORG-01-09 verified with 403 FORBIDDEN.');

    // ========================================================================
    // AC-ORG-01-10: Cross-tenant isolation
    // ========================================================================
    console.log(
      '🧪 Testing AC-ORG-01-10: Cross-tenant isolation (Owner A targeting Merchant B)...'
    );
    // Read attempt on foreign tenant ID
    const resCrossGet = await request(app.getHttpServer())
      .get(`/api/v1/shops/${merchantIdB}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(403);
    assert.strictEqual(resCrossGet.body.error.code, 'FORBIDDEN');

    // Update attempt on foreign tenant ID
    const resCrossPatch = await request(app.getHttpServer())
      .patch(`/api/v1/shops/${merchantIdB}`)
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ name: 'Tampered Beta Name' })
      .expect(403);
    assert.strictEqual(resCrossPatch.body.error.code, 'FORBIDDEN');

    // Verify Merchant B is completely unmodified
    const dbMerchantB = await prisma.merchant.findUnique({ where: { id: merchantIdB } });
    assert.strictEqual(dbMerchantB?.name, `Shop Beta ${testSuffix}`);
    console.log('  PASS: AC-ORG-01-10 verified cross-tenant protection.');

    // ========================================================================
    // AC-ORG-01-11: Unauthenticated request
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-11: Unauthenticated request rejection...');
    await request(app.getHttpServer()).get('/api/v1/shops/profile').expect(401);
    await request(app.getHttpServer())
      .patch('/api/v1/shops/profile')
      .send({ name: 'No Auth' })
      .expect(401);
    console.log('  PASS: AC-ORG-01-11 verified with 401.');

    // ========================================================================
    // AC-ORG-01-12: List shops query
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-12: GET /api/v1/shops...');
    const resList = await request(app.getHttpServer())
      .get('/api/v1/shops')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    assert.strictEqual(resList.body.success, true);
    assert.ok(Array.isArray(resList.body.data.shops));
    assert.strictEqual(resList.body.data.shops[0].id, merchantIdA);
    console.log('  PASS: AC-ORG-01-12 verified.');

    // ========================================================================
    // AC-ORG-01-13: Route alias without /api/v1 prefix
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-13: Non-prefixed /shops/profile route alias...');
    const resAliasGet = await request(app.getHttpServer())
      .get('/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);
    assert.strictEqual(resAliasGet.body.data.id, merchantIdA);

    const resAliasPatch = await request(app.getHttpServer())
      .patch('/shops/profile')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .send({ operating_notes: 'Updated via alias route' })
      .expect(200);
    assert.strictEqual(resAliasPatch.body.data.operating_notes, 'Updated via alias route');
    console.log('  PASS: AC-ORG-01-13 verified alias routing.');

    // ========================================================================
    // AC-ORG-01-14: Audit log integrity
    // ========================================================================
    console.log('🧪 Testing AC-ORG-01-14: Audit log security inspection...');
    const finalAuditLogs = await prisma.auditLog.findMany({
      where: { merchant_id: merchantIdA },
    });
    for (const log of finalAuditLogs) {
      assert.strictEqual(log.merchant_id, merchantIdA);
      assert.ok(!JSON.stringify(log).includes('password_hash'));
      assert.ok(!JSON.stringify(log).includes('session_token'));
    }
    console.log(
      `  PASS: AC-ORG-01-14 verified ${finalAuditLogs.length} audit logs clean of secrets.`
    );

    console.log('================================================================');
    console.log('🎉 ALL FEAT-ORG-01 SUPERTEST CHECKS PASSED (AC-01..14)!');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runShopsSupertestSuite().catch((err) => {
  console.error('❌ Shops supertest suite failed:', err);
  process.exit(1);
});
