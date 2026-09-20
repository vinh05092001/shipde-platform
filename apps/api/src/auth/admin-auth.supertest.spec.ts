import 'reflect-metadata';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { RateLimitService } from './rate-limit.service';
import { VERIFICATION_ADAPTER } from './auth.tokens';
import { APP_CONFIG } from '../config.token';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { seedDatabase } from '../../../../infra/docker/seed';

const VALID_ADMIN_KEY = 'test-admin-key-2026';

async function runAdminAuthSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - ADMIN AUTH SUPERTEST SUITE (FEAT-AUTH-02)');
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

  process.env.PLATFORM_ADMIN_KEY = VALID_ADMIN_KEY;

  let databaseUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  if (
    (databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) ||
    (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))
  ) {
    databaseUrl = databaseUrl.slice(1, -1);
  }
  process.env.DATABASE_URL = databaseUrl;

  const testConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3099,
    WORKER_HEALTH_PORT: 3098,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: Number(process.env.REDIS_PORT || 6379),
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: true,
    CARRIER_MODE: 'disabled',
    LOG_LEVEL: 'info',
  };

  const mockDeliveryAdapter = new MockVerificationDeliveryAdapter();
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(mockDeliveryAdapter)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();
  const prisma = app.get(PrismaService);

  // Non-blocking connect in onModuleInit may not have completed yet
  try {
    await prisma.$connect();
  } catch {
    /* already connected or failing */
  }
  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    if (process.env.CI) {
      throw new Error('Database must be reachable in CI');
    }
    console.warn('PostgreSQL not reachable. Skipping admin auth tests.');
    await app.close();
    return;
  }

  await seedDatabase(prisma);
  const ts = Date.now().toString().slice(-6);
  let p = 0;
  let f = 0;
  const fails: string[] = [];
  function pass(n: string) {
    p++;
    console.log('  PASS: ' + n);
  }
  function fail(n: string, r: string) {
    f++;
    fails.push(n + ': ' + r);
    console.log('  FAIL: ' + n);
  }

  try {
    // Clean up test-created data from previous runs
    await prisma.auditLog.deleteMany({ where: { action: 'ADMIN_CREATE_SHOP' } });
    await prisma.user.deleteMany({ where: { created_by: 'platform_admin' } });
    await prisma.merchant.deleteMany({
      where: {
        OR: [
          { code: { startsWith: 'ADMIN_SHOP_' } },
          { code: { startsWith: 'PHONE_SHOP_' } },
          { code: { startsWith: 'CUSTOMPWD_' } },
          { code: { startsWith: 'CASENORM_' } },
          { code: { startsWith: 'BOTH_' } },
          { code: { startsWith: 'D1_' } },
          { code: { startsWith: 'D2_' } },
          { code: { startsWith: 'DP1_' } },
          { code: { startsWith: 'DP2_' } },
          { code: { startsWith: 'NONAME_' } },
          { code: { startsWith: 'BADEMAIL_' } },
          { code: { startsWith: 'BADPHONE_' } },
          { code: { startsWith: 'SHORTPWD_' } },
          { code: { startsWith: 'NOCONTACT_' } },
        ],
      },
    });

    // AC-ADMIN-01: Missing admin key
    console.log('[AC-ADMIN-01] Missing admin key returns 403');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .send({ merchant_name: 'T', owner_full_name: 'AT', owner_email: 'a@b.com' });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('AC-ADMIN-01');
    } catch (e: any) {
      fail('AC-ADMIN-01', e.message);
    }

    // AC-ADMIN-02: Invalid admin key
    console.log('[AC-ADMIN-02] Invalid admin key returns 403');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', 'wrong')
        .send({ merchant_name: 'T', owner_full_name: 'AT', owner_email: 'a@b.com' });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error.code, 'FORBIDDEN');
      pass('AC-ADMIN-02');
    } catch (e: any) {
      fail('AC-ADMIN-02', e.message);
    }

    // AC-ADMIN-03: Valid key + email-only → 201
    console.log('[AC-ADMIN-03] Valid admin key, email-only registration');
    let shopId1: string;
    let userId1: string;
    try {
      const em = 'admin.owner.' + ts + '@test.com';
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .set('x-forwarded-for', '203.0.113.1')
        .send({
          merchant_name: 'Admin Shop ' + ts,
          owner_full_name: 'Admin Created Owner',
          owner_email: em,
        });
      assert.strictEqual(res.status, 201);
      assert.ok(res.body.data);
      assert.ok(res.body.data.merchant);
      assert.ok(res.body.data.user);
      assert.strictEqual(res.body.data.merchant.status, 'active');
      assert.strictEqual(res.body.data.user.status, 'active');
      assert.strictEqual(res.body.data.user.role, 'OWNER');
      assert.strictEqual(res.body.data.user.email, em);
      assert.ok(res.body.data.temporary_password);
      assert.strictEqual(res.body.data.temporary_password.length, 16);
      shopId1 = res.body.data.merchant.id;
      userId1 = res.body.data.user.id;
      pass('AC-ADMIN-03');
    } catch (e: any) {
      fail('AC-ADMIN-03', e.message);
    }

    // AC-ADMIN-04: DB verification
    console.log('[AC-ADMIN-04] DB: user active, verified timestamps');
    try {
      const user = await prisma.user.findUnique({ where: { id: userId1! } });
      assert.ok(user);
      assert.strictEqual(user!.status, 'active');
      assert.ok(user!.email_verified_at);
      assert.strictEqual(user!.created_by, 'platform_admin');
      assert.ok(user!.activated_at);
      assert.ok(user!.terms_accepted_at);
      assert.strictEqual(user!.role, 'OWNER');
      pass('AC-ADMIN-04');
    } catch (e: any) {
      fail('AC-ADMIN-04', e.message);
    }

    // AC-ADMIN-05: Merchant code generation
    console.log('[AC-ADMIN-05] Merchant code generation');
    try {
      const m = await prisma.merchant.findUnique({ where: { id: shopId1! } });
      assert.ok(m);
      assert.ok(m!.code.startsWith('ADMIN_SHOP_'));
      assert.ok(m!.code.length > 10);
      pass('AC-ADMIN-05');
    } catch (e: any) {
      fail('AC-ADMIN-05', e.message);
    }

    // AC-ADMIN-06: Phone-only registration
    console.log('[AC-ADMIN-06] Phone-only registration');
    try {
      const ph = '0912345678';
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({
          merchant_name: 'Phone Shop ' + ts,
          owner_full_name: 'Phone Owner',
          owner_phone: ph,
        });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.user.phone, ph);
      assert.strictEqual(res.body.data.user.email, null);
      const pu = await prisma.user.findUnique({ where: { id: res.body.data.user.id } });
      assert.ok(pu!.phone_verified_at);
      assert.strictEqual(pu!.email_verified_at, null);
      pass('AC-ADMIN-06');
    } catch (e: any) {
      fail('AC-ADMIN-06', e.message);
    }

    // AC-ADMIN-07: Custom password → no temporary_password
    console.log('[AC-ADMIN-07] Custom password: no temporary_password');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({
          merchant_name: 'CustomPwd ' + ts,
          owner_full_name: 'CP Owner',
          owner_email: 'cp.' + ts + '@test.com',
          owner_password: 'MySecurePassword123',
        });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.temporary_password, undefined);
      pass('AC-ADMIN-07');
    } catch (e: any) {
      fail('AC-ADMIN-07', e.message);
    }

    // AC-ADMIN-08: Duplicate email (active) → 400
    console.log('[AC-ADMIN-08] Duplicate email (active) returns 400');
    try {
      const de = 'dupe.' + ts + '@test.com';
      await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'D1 ' + ts, owner_full_name: 'D1', owner_email: de });
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'D2 ' + ts, owner_full_name: 'D2', owner_email: de });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(
        res.body.error.fields?.some((f: any) => f.field === 'owner_email' && f.code === 'DUPLICATE')
      );
      pass('AC-ADMIN-08');
    } catch (e: any) {
      fail('AC-ADMIN-08', e.message);
    }

    // AC-ADMIN-09: Missing both email and phone → 400
    console.log('[AC-ADMIN-09] Missing both email and phone');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'NoContact ' + ts, owner_full_name: 'NC Owner' });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(res.body.error.fields?.some((f: any) => f.field === 'owner_email'));
      pass('AC-ADMIN-09');
    } catch (e: any) {
      fail('AC-ADMIN-09', e.message);
    }

    // AC-ADMIN-10: Invalid email format → 400
    console.log('[AC-ADMIN-10] Invalid email format');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({
          merchant_name: 'BadEmail ' + ts,
          owner_full_name: 'BE',
          owner_email: 'not-an-email',
        });
      assert.strictEqual(res.status, 400);
      assert.ok(
        res.body.error.fields?.some(
          (f: any) => f.field === 'owner_email' && f.code === 'INVALID_FORMAT'
        )
      );
      pass('AC-ADMIN-10');
    } catch (e: any) {
      fail('AC-ADMIN-10', e.message);
    }

    // AC-ADMIN-11: Invalid phone format → 400
    console.log('[AC-ADMIN-11] Invalid phone format');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'BadPhone ' + ts, owner_full_name: 'BP', owner_phone: '12345' });
      assert.strictEqual(res.status, 400);
      assert.ok(
        res.body.error.fields?.some(
          (f: any) => f.field === 'owner_phone' && f.code === 'INVALID_FORMAT'
        )
      );
      pass('AC-ADMIN-11');
    } catch (e: any) {
      fail('AC-ADMIN-11', e.message);
    }

    // AC-ADMIN-12: Short password → 400
    console.log('[AC-ADMIN-12] Short password');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({
          merchant_name: 'ShortPwd ' + ts,
          owner_full_name: 'SP',
          owner_email: 'sp.' + ts + '@test.com',
          owner_password: 'abc',
        });
      assert.strictEqual(res.status, 400);
      assert.ok(
        res.body.error.fields?.some(
          (f: any) => f.field === 'owner_password' && f.code === 'INVALID_FORMAT'
        )
      );
      pass('AC-ADMIN-12');
    } catch (e: any) {
      fail('AC-ADMIN-12', e.message);
    }

    // AC-ADMIN-13: Missing merchant_name → 400
    console.log('[AC-ADMIN-13] Missing merchant_name');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ owner_full_name: 'NN', owner_email: 'nn.' + ts + '@test.com' });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.fields?.some((f: any) => f.field === 'merchant_name'));
      pass('AC-ADMIN-13');
    } catch (e: any) {
      fail('AC-ADMIN-13', e.message);
    }

    // AC-ADMIN-14: GET /admin/shops lists merchants
    console.log('[AC-ADMIN-14] GET /admin/shops lists merchants');
    try {
      const res = await request(app.getHttpServer())
        .get('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.ok(res.body.meta);
      assert.ok(typeof res.body.meta.total === 'number');
      assert.ok(res.body.data.length > 0);
      const first = res.body.data[0];
      assert.ok(first.id);
      assert.ok(first.name);
      assert.ok(first.code);
      assert.ok(first.owner);
      assert.ok(first.created_at);
      pass('AC-ADMIN-14');
    } catch (e: any) {
      fail('AC-ADMIN-14', e.message);
    }

    // AC-ADMIN-15: GET /admin/shops without key → 403
    console.log('[AC-ADMIN-15] GET /admin/shops without key returns 403');
    try {
      const res = await request(app.getHttpServer()).get('/admin/shops');
      assert.strictEqual(res.status, 403);
      pass('AC-ADMIN-15');
    } catch (e: any) {
      fail('AC-ADMIN-15', e.message);
    }

    // AC-ADMIN-16: Duplicate phone (active) → 400
    console.log('[AC-ADMIN-16] Duplicate phone (active) returns 400');
    try {
      const dp = '0987654321';
      await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'DP1 ' + ts, owner_full_name: 'DP1', owner_phone: dp });
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'DP2 ' + ts, owner_full_name: 'DP2', owner_phone: dp });
      assert.strictEqual(res.status, 400);
      assert.ok(
        res.body.error.fields?.some((f: any) => f.field === 'owner_phone' && f.code === 'DUPLICATE')
      );
      pass('AC-ADMIN-16');
    } catch (e: any) {
      fail('AC-ADMIN-16', e.message);
    }

    // AC-ADMIN-17: Pagination
    console.log('[AC-ADMIN-17] Pagination');
    try {
      const res = await request(app.getHttpServer())
        .get('/admin/shops?page=1&limit=2')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.data.length <= 2);
      assert.strictEqual(res.body.meta.page, 1);
      assert.strictEqual(res.body.meta.limit, 2);
      pass('AC-ADMIN-17');
    } catch (e: any) {
      fail('AC-ADMIN-17', e.message);
    }

    // AC-ADMIN-18: Both email + phone both verified
    console.log('[AC-ADMIN-18] Both email + phone: both verified');
    try {
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({
          merchant_name: 'Both ' + ts,
          owner_full_name: 'BO',
          owner_email: 'both.' + ts + '@test.com',
          owner_phone: '0911223344',
        });
      assert.strictEqual(res.status, 201);
      const u = await prisma.user.findUnique({ where: { id: res.body.data.user.id } });
      assert.ok(u!.email_verified_at);
      assert.ok(u!.phone_verified_at);
      pass('AC-ADMIN-18');
    } catch (e: any) {
      fail('AC-ADMIN-18', e.message);
    }

    // AC-ADMIN-19: Audit log persisted
    console.log('[AC-ADMIN-19] Audit log persisted for ADMIN_CREATE_SHOP');
    try {
      const al = await prisma.auditLog.findMany({
        where: { action: 'ADMIN_CREATE_SHOP' },
        orderBy: { created_at: 'desc' },
        take: 1,
      });
      assert.ok(al.length > 0);
      assert.strictEqual(al[0].action, 'ADMIN_CREATE_SHOP');
      assert.strictEqual(al[0].entity_type, 'Merchant');
      assert.ok(al[0].new_value);
      pass('AC-ADMIN-19');
    } catch (e: any) {
      fail('AC-ADMIN-19', e.message);
    }

    // AC-ADMIN-20: Email case normalization
    console.log('[AC-ADMIN-20] Email case normalization');
    try {
      const mce = 'Mixed.Case.' + ts + '@Test.COM';
      const res = await request(app.getHttpServer())
        .post('/admin/shops')
        .set('X-Platform-Admin-Key', VALID_ADMIN_KEY)
        .send({ merchant_name: 'CaseNorm ' + ts, owner_full_name: 'CN', owner_email: mce });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.data.user.email, mce.toLowerCase());
      pass('AC-ADMIN-20');
    } catch (e: any) {
      fail('AC-ADMIN-20', e.message);
    }
  } finally {
    console.log('================================================================');
    console.log('RESULTS: ' + p + ' passed, ' + f + ' failed');
    for (const x of fails) console.log('  FAIL: ' + x);
    console.log('================================================================');
    await app.close();
  }
}

runAdminAuthSupertestSuite().catch((err) => {
  console.error('Admin Auth Supertest suite failed:', err);
  process.exit(1);
});
