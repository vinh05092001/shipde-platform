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
    .useValue({
      checkReadiness: async () => 'up',
      $connect: async () => {},
      $disconnect: async () => {},
    })
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
      .useValue({
        checkReadiness: async () => 'down',
        $connect: async () => {},
        $disconnect: async () => {},
      })
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
