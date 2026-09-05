import {
  assertValidLivenessResponse,
  assertValidReadinessResponse,
  createValidTestConfig,
} from '@shipde/testkit';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { SmokeWorker, SmokeJobData } from './queue/smoke.worker';
import { OutboxDispatcher } from './dispatcher/outbox.dispatcher';
import { QUEUE_SMOKE_EVENT_TYPE, SMOKE_QUEUE_NAME } from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';
import { CORRELATION_ID_HEADER } from '@shipde/config';
import { Job } from 'bullmq';

async function runWorkerTests() {
  console.log('--- Starting @shipde/worker tests ---');

  const config = createValidTestConfig();

  // 1. Worker Health Controller Tests (AC-FOUND-03-04, AC-FOUND-03-05, AC-FOUND-03-06)
  console.log('Testing Worker HealthService and HealthController...');
  {
    const mockPrisma: any = { checkReadiness: async () => 'up' as const };
    const mockRedis: any = { checkReadiness: async () => 'up' as const };
    const mockStorage: any = { checkReadiness: async () => 'up' as const };

    const healthService = new HealthService(mockPrisma, mockRedis, mockStorage);
    const healthController = new HealthController(healthService);

    // Mock Express Request & Response
    const headers: Record<string, string> = {};
    let responseStatus: number = 0;
    let responseJson: any = null;

    const createMockRes = () => ({
      setHeader(name: string, val: string) {
        headers[name] = val;
      },
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(body: any) {
        responseJson = body;
        return this;
      },
    });

    // Test liveness probe
    const mockReqLive: any = {
      headers: { [CORRELATION_ID_HEADER]: 'worker-live-corr-123' },
    };
    healthController.getLive(mockReqLive, createMockRes() as any);
    if (responseStatus !== 200) {
      throw new Error(`Expected worker liveness 200, got ${responseStatus}`);
    }
    assertValidLivenessResponse(responseJson);
    if (responseJson.service !== 'worker') {
      throw new Error(`Expected service 'worker', got ${responseJson.service}`);
    }
    if (responseJson.correlationId !== 'worker-live-corr-123') {
      throw new Error(`Correlation ID mismatch: ${responseJson.correlationId}`);
    }

    // Test readiness probe when healthy (200)
    await healthController.getReady(mockReqLive, createMockRes() as any);
    if ((responseStatus as number) !== 200) {
      throw new Error(`Expected worker readiness 200, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'ok');

    // Test readiness probe when Redis is down (503)
    mockRedis.checkReadiness = async () => 'down' as const;
    await healthController.getReady(mockReqLive, createMockRes() as any);
    if ((responseStatus as number) !== 503) {
      throw new Error(`Expected worker readiness 503 on redis down, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'error');
    if ((responseJson.checks.redis as string) !== 'down') {
      throw new Error('Expected redis "down" in worker readiness');
    }

    // Test readiness recovery (200)
    mockRedis.checkReadiness = async () => 'up' as const;
    await healthController.getReady(mockReqLive, createMockRes() as any);
    if ((responseStatus as number) !== 200) {
      throw new Error(`Expected worker readiness 200 after recovery, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'ok');
  }
  console.log('✅ Worker HealthService and HealthController tests passed');

  // 2. Queue Smoke Processing & Deduplication Tests (AC-FOUND-03-09, AC-FOUND-03-10)
  console.log('Testing SmokeWorker processing and deduplication with real database...');
  {
    const prismaService = new PrismaService({
      datasources: {
        db: {
          url: config.DATABASE_URL,
        },
      },
    });
    await prismaService.onModuleInit();

    const smokeWorker = new SmokeWorker(config, prismaService);

    const testSmokeId = `smoke_${Date.now()}`;
    const testCorrelationId = `corr-smoke-${Date.now()}`;
    const testIdempotencyKey = `idemp-smoke-${Date.now()}`;

    // Create test pending outbox record
    const outboxRecord = await prismaService.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: { smokeId: testSmokeId, message: 'Synthetic queue smoke event' },
        correlation_id: testCorrelationId,
        idempotency_key: testIdempotencyKey,
        status: OutboxStatusEnum.PENDING,
      },
    });

    try {
      const mockJob = {
        id: outboxRecord.id,
        data: {
          outboxId: outboxRecord.id,
          smokeId: testSmokeId,
          correlationId: testCorrelationId,
          eventType: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: testSmokeId },
          idempotencyKey: testIdempotencyKey,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      // 2.1 First delivery: processes successfully and updates outbox to PUBLISHED
      const firstResult = await smokeWorker.processJob(mockJob);
      if (!firstResult.success || firstResult.duplicate) {
        throw new Error(
          `Expected successful non-duplicate processing, got: ${JSON.stringify(firstResult)}`
        );
      }
      if (smokeWorker.processedCount !== 1) {
        throw new Error(`Expected processedCount 1, got ${smokeWorker.processedCount}`);
      }

      // Verify DB state updated
      const updatedRecord = await prismaService.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (!updatedRecord || updatedRecord.status !== OutboxStatusEnum.PUBLISHED) {
        throw new Error(`Expected outbox event to be PUBLISHED, got ${updatedRecord?.status}`);
      }
      if (!updatedRecord.published_at) {
        throw new Error('Expected published_at timestamp to be set');
      }

      // 2.2 Duplicate delivery: re-delivery of the same job acknowledges without duplicate effect
      const secondResult = await smokeWorker.processJob(mockJob);
      if (!secondResult.success || !secondResult.duplicate) {
        throw new Error(`Expected duplicate detection, got: ${JSON.stringify(secondResult)}`);
      }
      if (smokeWorker.duplicateCount !== 1) {
        throw new Error(`Expected duplicateCount 1, got ${smokeWorker.duplicateCount}`);
      }
      // processedCount should still be 1 (no duplicate side effects)
      if (smokeWorker.processedCount !== 1) {
        throw new Error(`Expected processedCount to remain 1, got ${smokeWorker.processedCount}`);
      }

      // Clean up test record
      await prismaService.outboxEvent.delete({ where: { id: outboxRecord.id } });
    } finally {
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ SmokeWorker queue processing and deduplication tests passed');

  // 3. Outbox Dispatcher Tests (AC-FOUND-03-09, AC-FOUND-03-10)
  console.log('Testing OutboxDispatcher with real database and Redis queue...');
  {
    const prismaService = new PrismaService({
      datasources: {
        db: {
          url: config.DATABASE_URL,
        },
      },
    });
    await prismaService.onModuleInit();

    const dispatcher = new OutboxDispatcher(config, prismaService);
    await dispatcher.onModuleInit();

    const testCorrelationId = `corr-disp-${Date.now()}`;
    const testIdempotencyKey = `idemp-disp-${Date.now()}`;

    // Create a pending outbox record
    const event = await prismaService.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: { smokeId: 'disp-test-1', message: 'Dispatcher smoke event' },
        correlation_id: testCorrelationId,
        idempotency_key: testIdempotencyKey,
        status: OutboxStatusEnum.PENDING,
      },
    });

    try {
      // Dispatch pending events
      const result = await dispatcher.dispatchPending(10);
      if (result.dispatched < 1) {
        throw new Error(`Expected at least 1 dispatched event, got ${result.dispatched}`);
      }

      // Verify DB record transitioned to PROCESSING
      const dispatchedRecord = await prismaService.outboxEvent.findUnique({
        where: { id: event.id },
      });
      if (!dispatchedRecord || dispatchedRecord.status !== OutboxStatusEnum.PROCESSING) {
        throw new Error(`Expected outbox event to be PROCESSING, got ${dispatchedRecord?.status}`);
      }

      // Clean up BullMQ queue job
      const queue = dispatcher.getQueue();
      const job = await queue.getJob(event.idempotency_key || event.id);
      if (job) {
        await job.remove();
      }

      // Clean up DB record
      await prismaService.outboxEvent.delete({ where: { id: event.id } });
    } finally {
      await dispatcher.onModuleDestroy();
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ OutboxDispatcher tests passed');

  console.log('🎉 All @shipde/worker tests passed successfully!');
}

runWorkerTests().catch((err) => {
  console.error('❌ @shipde/worker test failure:', err);
  process.exit(1);
});
