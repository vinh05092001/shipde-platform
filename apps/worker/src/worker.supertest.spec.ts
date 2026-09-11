import 'reflect-metadata';
import * as assert from 'node:assert';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WorkerAppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';
import { SmokeWorker } from './queue/smoke.worker';
import { OutboxDispatcher } from './dispatcher/outbox.dispatcher';
import { APP_CONFIG } from './config.token';

async function runWorkerSupertestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WORKER SUPERTEST & NESTJS TESTING HARNESS (AC-FOUND-04-05)');
  console.log('================================================================');

  const mockConfig = {
    NODE_ENV: 'test' as const,
    WORKER_HEALTH_PORT: 3098,
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    CARRIER_INTEGRATION_MODE: 'disabled' as const,
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [WorkerAppModule],
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
      getClient: () => ({ status: 'ready', connect: async () => {} }),
      onModuleDestroy: async () => {},
    })
    .overrideProvider(StorageService)
    .useValue({
      checkReadiness: async () => 'up',
    })
    .overrideProvider(SmokeWorker)
    .useValue({
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
    })
    .overrideProvider(OutboxDispatcher)
    .useValue({
      onModuleInit: async () => {},
      onModuleDestroy: async () => {},
    })
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  await app.init();

  try {
    // 1. Test GET /health/live
    console.log('[TEST 1] GET /health/live returns 200 OK with valid worker liveness payload');
    const liveRes = await request(app.getHttpServer()).get('/health/live').expect(200);
    assert.strictEqual(liveRes.body.status, 'ok', 'Status must be ok');
    assert.strictEqual(liveRes.body.service, 'worker', 'Service must be worker');
    assert.ok(liveRes.body.timestamp, 'Timestamp must be present');
    console.log('  PASS: /health/live responded 200 OK');

    // 2. Test GET /health/ready
    console.log('[TEST 2] GET /health/ready returns 200 OK when worker dependencies are up');
    const readyRes = await request(app.getHttpServer()).get('/health/ready').expect(200);
    assert.strictEqual(readyRes.body.status, 'ok', 'Status must be ok');
    assert.strictEqual(readyRes.body.service, 'worker', 'Service must be worker');
    assert.strictEqual(readyRes.body.checks.database, 'up', 'Database check must be up');
    assert.strictEqual(readyRes.body.checks.redis, 'up', 'Redis check must be up');
    assert.strictEqual(readyRes.body.checks.storage, 'up', 'Storage check must be up');
    console.log('  PASS: /health/ready responded 200 with all dependencies up');

    // 3. Test Correlation ID propagation
    console.log('[TEST 3] Propagates x-correlation-id through Worker health endpoint');
    const customCorrelationId = 'worker-correl-uuid-12345';
    const corrRes = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-correlation-id', customCorrelationId)
      .expect(200);
    assert.strictEqual(
      corrRes.headers['x-correlation-id'],
      customCorrelationId,
      'Response header x-correlation-id must match incoming request'
    );
    assert.strictEqual(
      corrRes.body.correlationId,
      customCorrelationId,
      'Response body correlationId must match incoming request'
    );
    console.log('  PASS: Correlation ID propagated correctly in HTTP header and body');

    // 4. Test Dependency Outage / Fail-Closed behavior
    console.log('[TEST 4] GET /health/ready fails closed (503) when database is down');
    const brokenModule: TestingModule = await Test.createTestingModule({
      imports: [WorkerAppModule],
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
        getClient: () => ({ status: 'ready', connect: async () => {} }),
        onModuleDestroy: async () => {},
      })
      .overrideProvider(StorageService)
      .useValue({
        checkReadiness: async () => 'up',
      })
      .overrideProvider(SmokeWorker)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .overrideProvider(OutboxDispatcher)
      .useValue({
        onModuleInit: async () => {},
        onModuleDestroy: async () => {},
      })
      .compile();

    const brokenApp: INestApplication = brokenModule.createNestApplication();
    await brokenApp.init();

    const degradedRes = await request(brokenApp.getHttpServer()).get('/health/ready').expect(503);
    assert.strictEqual(degradedRes.body.status, 'error', 'Status must be error');
    assert.strictEqual(degradedRes.body.service, 'worker', 'Service must be worker');
    assert.strictEqual(degradedRes.body.checks.database, 'down', 'Database must be down');
    console.log('  PASS: Worker outage simulation correctly returned 503 degraded');
    await brokenApp.close();

    console.log('\n================================================================');
    console.log('ALL WORKER SUPERTEST & NESTJS HARNESS TESTS PASSED 100%');
    console.log('================================================================');
  } finally {
    await app.close();
  }
}

runWorkerSupertestSuite().catch((err) => {
  console.error('Worker supertest suite failed:', err);
  process.exit(1);
});
