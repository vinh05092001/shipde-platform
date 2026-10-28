import 'reflect-metadata';
import * as assert from 'node:assert';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { APP_CONFIG } from './config.token';

function createMockPrismaForHarness(readiness: 'up' | 'down' = 'up') {
  const permissions: any[] = [];
  const roles: any[] = [];
  const rolePermissions: any[] = [];
  const auditLogs: any[] = [];

  const tx = {
    permission: {
      upsert: async ({ where, create, update }: any) => {
        let p = permissions.find((x) => x.code === where?.code);
        if (!p) {
          p = { id: create?.id, ...create };
          permissions.push(p);
        } else {
          Object.assign(p, update);
        }
        return p;
      },
      findMany: async () => [...permissions],
    },
    role: {
      upsert: async ({ where, create, update }: any) => {
        let r = roles.find((x) => x.code === where?.code);
        if (!r) {
          r = { id: create?.id, ...create };
          roles.push(r);
        } else {
          Object.assign(r, update);
        }
        return r;
      },
    },
    rolePermission: {
      findMany: async ({ where }: any) =>
        rolePermissions.filter((rp) => rp.role_id === where?.role_id),
      deleteMany: async ({ where }: any) => {
        const ids = where?.permission_id?.in || [];
        for (let i = rolePermissions.length - 1; i >= 0; i--) {
          if (
            rolePermissions[i].role_id === where?.role_id &&
            ids.includes(rolePermissions[i].permission_id)
          ) {
            rolePermissions.splice(i, 1);
          }
        }
      },
      create: async ({ data }: any) => {
        const record = { id: `rp-${data.role_id}-${data.permission_id}`, ...data };
        rolePermissions.push(record);
        return record;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data };
        auditLogs.push(record);
        return record;
      },
    },
  };

  return {
    checkReadiness: async () => readiness,
    $connect: async () => {},
    $disconnect: async () => {},
    $transaction: async (fn: (client: any) => Promise<any>) => {
      if (readiness === 'down') {
        throw new Error('Database connection failed');
      }
      return fn(tx);
    },
  };
}

async function runSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - SUPERTEST & NESTJS TESTING HARNESS (AC-FOUND-04-05)');
  console.log('================================================================');

  const mockConfig = {
    env: 'test' as const,
    port: 3099,
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    redis: { host: 'localhost', port: 6379 },
    s3: {
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'test-bucket',
    },
    carrierMode: 'disabled' as const,
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(mockConfig)
    .overrideProvider(PrismaService)
    .useValue(createMockPrismaForHarness('up'))
    .overrideProvider(RedisService)
    .useValue({
      checkReadiness: async () => 'up',
      onModuleDestroy: async () => {},
    })
    .overrideProvider(StorageService)
    .useValue({
      checkReadiness: async () => 'up',
    })
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  try {
    // 1. Test GET /health/live
    console.log('[TEST 1] GET /health/live returns 200 OK with valid liveness payload');
    const liveRes = await request(app.getHttpServer()).get('/health/live').expect(200);
    assert.strictEqual(liveRes.body.status, 'ok', 'Status must be ok');
    assert.ok(liveRes.body.timestamp, 'Timestamp must be present');
    console.log('  PASS: /health/live responded 200 OK');

    // 2. Test GET /health/ready
    console.log('[TEST 2] GET /health/ready returns 200 OK when dependencies are up');
    const readyRes = await request(app.getHttpServer()).get('/health/ready').expect(200);
    assert.strictEqual(readyRes.body.status, 'ok', 'Status must be ok');
    assert.strictEqual(readyRes.body.checks.database, 'up', 'Database check must be up');
    assert.strictEqual(readyRes.body.checks.redis, 'up', 'Redis check must be up');
    assert.strictEqual(readyRes.body.checks.storage, 'up', 'Storage check must be up');
    assert.strictEqual(readyRes.body.checks.rbac, 'up', 'RBAC check must be up');
    console.log('  PASS: /health/ready responded 200 with all dependencies up');

    // 3. Test Correlation ID propagation
    console.log('[TEST 3] Propagates x-correlation-id through NestJS middleware');
    const customCorrelationId = 'c0rrel-test-uuid-98765';
    const corrRes = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-correlation-id', customCorrelationId)
      .expect(200);
    assert.strictEqual(
      corrRes.headers['x-correlation-id'],
      customCorrelationId,
      'Response header x-correlation-id must match incoming request'
    );
    console.log('  PASS: Correlation ID propagated correctly in HTTP header');

    // 4. Test Dependency Outage / Fail-Closed behavior
    console.log('[TEST 4] GET /health/ready fails closed (503) when database is down');
    const brokenModule: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(mockConfig)
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaForHarness('down'))
      .overrideProvider(RedisService)
      .useValue({
        checkReadiness: async () => 'up',
        onModuleDestroy: async () => {},
      })
      .overrideProvider(StorageService)
      .useValue({
        checkReadiness: async () => 'up',
      })
      .compile();

    const brokenApp: INestApplication = brokenModule.createNestApplication();
    await brokenApp.init();

    const degradedRes = await request(brokenApp.getHttpServer()).get('/health/ready').expect(503);
    assert.strictEqual(degradedRes.body.status, 'error', 'Status must be error');
    assert.strictEqual(degradedRes.body.checks.database, 'down', 'Database must be down');
    assert.strictEqual(
      degradedRes.body.checks.rbac,
      'down',
      'RBAC check must be down when DB is down'
    );
    console.log('  PASS: Outage simulation correctly returned 503 degraded');
    await brokenApp.close();

    console.log('\n================================================================');
    console.log('ALL SUPERTEST & NESTJS HARNESS TESTS PASSED 100%');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runSupertestSuite().catch((err) => {
  console.error('Supertest suite failed:', err);
  process.exit(1);
});
