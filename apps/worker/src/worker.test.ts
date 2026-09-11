import {
  assertValidLivenessResponse,
  assertValidReadinessResponse,
  assertNoSecretValues,
  createValidTestConfig,
} from '@shipde/testkit';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { SmokeWorker, SmokeJobData } from './queue/smoke.worker';
import { OutboxDispatcher } from './dispatcher/outbox.dispatcher';
import { QUEUE_SMOKE_EVENT_TYPE, SMOKE_QUEUE_NAME } from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';
import {
  CORRELATION_ID_HEADER,
  validateConfig,
  ConfigValidationError,
  formatStructuredLog,
} from '@shipde/config';
import { Job } from 'bullmq';

async function runWorkerTests() {
  console.log('--- Starting @shipde/worker tests ---');

  // 1. Worker Configuration Validation Tests (AC-FOUND-03-03, Finding 3)
  console.log('Testing Worker configuration validation...');
  {
    const validConfig = createValidTestConfig();
    const validated = validateConfig({
      ...process.env,
      DATABASE_URL: validConfig.DATABASE_URL,
      REDIS_HOST: validConfig.REDIS_HOST,
      REDIS_PORT: String(validConfig.REDIS_PORT),
      PORT: String(validConfig.PORT),
      WORKER_HEALTH_PORT: String(validConfig.WORKER_HEALTH_PORT),
      S3_ACCESS_KEY: validConfig.S3_ACCESS_KEY,
      S3_SECRET_KEY: validConfig.S3_SECRET_KEY,
      CARRIER_MODE: validConfig.CARRIER_MODE,
    });
    if (!validated) {
      throw new Error('Expected valid config to parse successfully');
    }

    // Malformed port regression cases: must fail closed without secret leakage
    const malformedCases = [
      { PORT: '3001junk' },
      { REDIS_PORT: '6379oops' },
      { WORKER_HEALTH_PORT: '3002extra' },
      { PORT: ' 3001' },
      { PORT: '3001 ' },
      { PORT: '-1' },
      { PORT: '0' },
      { PORT: '65536' },
    ];
    for (const testCase of malformedCases) {
      let caught = false;
      try {
        validateConfig({
          ...process.env,
          DATABASE_URL: 'postgresql://postgres:secretWorkerPassword123@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['secretWorkerPassword123']);
        }
      }
      if (!caught) {
        throw new Error(
          `validateConfig failed to fail-closed on malformed case: ${JSON.stringify(testCase)}`
        );
      }
    }

    // Regression tests for malformed DATABASE_URL and S3_ENDPOINT (Finding 1)
    const malformedUrlCases = [
      { DATABASE_URL: 'postgresql://' },
      { DATABASE_URL: 'postgres://' },
      { DATABASE_URL: 'http://localhost:5432' },
      { DATABASE_URL: 'not-a-url' },
      { DATABASE_URL: 'postgresql://   ' },
      { S3_ENDPOINT: 'http://' },
      { S3_ENDPOINT: 'https://' },
      { S3_ENDPOINT: 'ftp://localhost:9000' },
      { S3_ENDPOINT: 'not-a-url' },
      { S3_ENDPOINT: 'http://   ' },
    ];
    for (const testCase of malformedUrlCases) {
      let caught = false;
      try {
        validateConfig({
          ...process.env,
          DATABASE_URL: 'postgresql://postgres:secretWorkerPassword123@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['secretWorkerPassword123']);
        }
      }
      if (!caught) {
        throw new Error(
          `validateConfig failed to fail-closed on malformed URL case: ${JSON.stringify(testCase)}`
        );
      }
    }

    // Regression tests for malformed S3_FORCE_PATH_STYLE (Finding 3)
    const malformedS3ForcePathStyleCases = [
      { S3_FORCE_PATH_STYLE: 'invalid' },
      { S3_FORCE_PATH_STYLE: '1' },
      { S3_FORCE_PATH_STYLE: '0' },
      { S3_FORCE_PATH_STYLE: 'yes' },
      { S3_FORCE_PATH_STYLE: 'no' },
      { S3_FORCE_PATH_STYLE: 'true ' },
      { S3_FORCE_PATH_STYLE: ' false' },
      { S3_FORCE_PATH_STYLE: 'falsee' },
    ];
    for (const testCase of malformedS3ForcePathStyleCases) {
      let caught = false;
      try {
        validateConfig({
          ...process.env,
          DATABASE_URL: 'postgresql://postgres:secretWorkerPassword123@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['secretWorkerPassword123']);
        }
      }
      if (!caught) {
        throw new Error(
          `validateConfig failed to fail-closed on malformed S3_FORCE_PATH_STYLE case: ${JSON.stringify(
            testCase
          )}`
        );
      }
    }
  }
  console.log('✅ Worker configuration validation tests passed');

  const config = createValidTestConfig();

  // 2. Worker Health Controller Tests (AC-FOUND-03-04, AC-FOUND-03-05, AC-FOUND-03-06)
  console.log('Testing Worker HealthService and HealthController...');
  {
    const mockPrisma: any = { checkReadiness: async () => 'up' as const };
    const mockRedis: any = { checkReadiness: async () => 'up' as const };
    const mockStorage: any = { checkReadiness: async () => 'up' as const };

    const healthService = new HealthService(mockPrisma, mockRedis, mockStorage);
    const healthController = new HealthController(healthService);

    let responseStatus: number = 0;
    let responseJson: any = null;

    const createMockRes = () => ({
      setHeader() {},
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

    // Test readiness recovery (200)
    mockRedis.checkReadiness = async () => 'up' as const;
    await healthController.getReady(mockReqLive, createMockRes() as any);
    if ((responseStatus as number) !== 200) {
      throw new Error(`Expected worker readiness 200 after recovery, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'ok');

    // Test process-level DB-down liveness resilience (Finding 2)
    console.log('Testing Worker PrismaService resilience when PostgreSQL is down...');
    const downPrisma = new PrismaService({
      datasources: {
        db: { url: 'postgresql://postgres:postgres@127.0.0.1:54399/shipde_dev?connect_timeout=1' },
      },
    });
    await downPrisma.onModuleInit();
    const dbReadiness = await downPrisma.checkReadiness();
    if (dbReadiness !== 'down') {
      throw new Error(
        `Expected worker downPrisma.checkReadiness() to be 'down', got ${dbReadiness}`
      );
    }
    // Liveness remains 200 independently of DB state
    healthController.getLive(mockReqLive, createMockRes() as any);
    if (responseStatus !== 200) {
      throw new Error(`Expected worker liveness 200 while DB is down, got ${responseStatus}`);
    }
    await downPrisma.onModuleDestroy();
  }
  console.log('✅ Worker HealthService and HealthController tests passed');

  // 2.5 Offline Unit Tests for Worker & Dispatcher logic (Findings 1, 2, 3, 4, 5, 7)
  console.log('Testing SmokeWorker and OutboxDispatcher offline unit behaviors...');
  {
    // A. SmokeWorker atomic deduplication claim race condition (Finding 4)
    let updateManyCalls = 0;
    const mockPrismaWorker: any = {
      outboxEvent: {
        findUnique: async () => ({
          id: 'test-outbox-1',
          status: OutboxStatusEnum.PROCESSING,
          attempts: 0,
        }),
        updateMany: async (args: any) => {
          updateManyCalls++;
          // Ensure query requires in-flight status guard
          const statusClause = args.where.status;
          const isValidGuard =
            statusClause === OutboxStatusEnum.PROCESSING ||
            (statusClause?.in &&
              Array.isArray(statusClause.in) &&
              statusClause.in.includes(OutboxStatusEnum.PROCESSING));
          if (!isValidGuard) {
            throw new Error('updateMany must require in-flight status guard');
          }
          // First call succeeds (count 1), concurrent call fails (count 0)
          return { count: updateManyCalls === 1 ? 1 : 0 };
        },
      },
    };
    const mockRedisWorker: any = {
      getClient: () => ({
        set: async () => 'OK',
        get: async () => null,
      }),
    };

    const workerUnit = new SmokeWorker(config, mockPrismaWorker, mockRedisWorker);
    const mockJob1 = {
      id: 'job-unit-1',
      data: {
        outboxId: 'test-outbox-1',
        smokeId: 'smoke-1',
        correlationId: 'corr-unit-1',
        eventType: QUEUE_SMOKE_EVENT_TYPE,
      },
    } as any;

    // Delivery 1: Atomic update succeeds -> marked processed
    const res1 = await workerUnit.processJob(mockJob1);
    if (!res1.success || res1.duplicate) {
      throw new Error(
        `Expected delivery 1 to succeed without duplicate, got: ${JSON.stringify(res1)}`
      );
    }
    if (workerUnit.processedCount !== 1 || workerUnit.duplicateCount !== 0) {
      throw new Error('Expected processedCount 1, duplicateCount 0');
    }

    // Delivery 2 (Concurrent race where DB already updated): count is 0 -> flagged duplicate
    const res2 = await workerUnit.processJob(mockJob1);
    if (!res2.success || !res2.duplicate) {
      throw new Error(
        `Expected concurrent delivery 2 to be flagged as duplicate, got: ${JSON.stringify(res2)}`
      );
    }
    if (workerUnit.processedCount !== 1 || workerUnit.duplicateCount !== 1) {
      throw new Error('Expected processedCount to remain 1, duplicateCount to become 1');
    }

    // B. SmokeWorker ignores unsupported event types (Finding 5)
    const mockJobUnsupported = {
      id: 'job-unit-unsupported',
      data: {
        outboxId: 'test-outbox-2',
        smokeId: 'smoke-2',
        correlationId: 'corr-unit-2',
        eventType: 'EVT-UNSUPPORTED-TYPE',
      },
    } as any;
    const resUnsupported = await workerUnit.processJob(mockJobUnsupported);
    if (resUnsupported.success !== false || resUnsupported.duplicate !== false) {
      throw new Error('Expected unsupported event type to be ignored by SmokeWorker');
    }

    // B2. Late failure handler race: if event already PUBLISHED, handleJobFailure does NOT overwrite (Finding 4)
    let lateFailureUpdated = false;
    const mockPrismaLateFailure: any = {
      outboxEvent: {
        updateMany: async (args: any) => {
          // Status check must require PROCESSING
          if (args.where.status !== OutboxStatusEnum.PROCESSING) {
            throw new Error('handleJobFailure updateMany must require status: PROCESSING');
          }
          // Returns 0 because event is already PUBLISHED
          lateFailureUpdated = true;
          return { count: 0 };
        },
      },
    };
    const workerLateFailure = new SmokeWorker(config, mockPrismaLateFailure, mockRedisWorker);
    const mockLateFailedJob = {
      id: 'job-late-failure',
      attemptsMade: 1,
      opts: { attempts: 3 },
      data: {
        outboxId: 'published-outbox-id',
        smokeId: 'smoke-late',
        correlationId: 'corr-late',
      },
    } as any;
    await workerLateFailure.handleJobFailure(
      mockLateFailedJob,
      new Error('Late timeout after published with password secretPassLate999')
    );
    if (!lateFailureUpdated) {
      throw new Error('Expected handleJobFailure to call updateMany with conditional status check');
    }

    // B3. Verify formatStructuredLog redacts secrets in message string (Finding 2)
    const logSecretMsg = formatStructuredLog({
      service: 'worker',
      level: 'error',
      message:
        'Worker failed connecting postgresql://usr:secretWorkerPass123@localhost:5433/db with token superSecret123',
    });
    assertNoSecretValues(logSecretMsg, ['secretWorkerPass123', 'superSecret123']);

    // C. OutboxDispatcher offline routing & correlation ID propagation (Findings 5 & 7)
    let enqueuedJobName = '';
    let enqueuedJobData: any = null;
    let enqueuedJobOpts: any = null;
    const mockQueue: any = {
      add: async (name: string, data: any, opts: any) => {
        enqueuedJobName = name;
        enqueuedJobData = data;
        enqueuedJobOpts = opts;
      },
      getJobs: async () => [],
    };

    let findManyWhere: any = null;
    const mockPrismaDispatcher: any = {
      outboxEvent: {
        findMany: async (args: any) => {
          findManyWhere = args.where;
          return [
            {
              id: 'outbox-disp-1',
              event_type: QUEUE_SMOKE_EVENT_TYPE,
              payload: { smokeId: 'smoke-disp-1' },
              correlation_id: 'corr-disp-prop-123',
              idempotency_key: 'idemp-disp-1',
              attempts: 0,
              status: OutboxStatusEnum.PENDING,
            },
          ];
        },
        updateMany: async () => ({ count: 1 }),
      },
    };

    const dispatcherUnit = new OutboxDispatcher(config, mockPrismaDispatcher);
    (dispatcherUnit as any).queue = mockQueue;

    await dispatcherUnit.dispatchPending(10);

    // Verify filter restricts strictly to QUEUE_SMOKE_EVENT_TYPE (Finding 5)
    if (findManyWhere?.event_type !== QUEUE_SMOKE_EVENT_TYPE) {
      throw new Error(
        `Expected findMany to filter by QUEUE_SMOKE_EVENT_TYPE, got ${findManyWhere?.event_type}`
      );
    }

    // Verify correlation ID is propagated to BullMQ job data (Finding 7)
    if (enqueuedJobData?.correlationId !== 'corr-disp-prop-123') {
      throw new Error(
        `Expected BullMQ job correlationId 'corr-disp-prop-123', got ${enqueuedJobData?.correlationId}`
      );
    }
    if (!enqueuedJobOpts?.jobId?.startsWith('idemp-disp-1-del-0-')) {
      throw new Error(`Expected delivery generation jobId, got ${enqueuedJobOpts?.jobId}`);
    }

    // D. OutboxDispatcher retryFailed purges retained queue jobs (Finding 2)
    const removedJobs: string[] = [];
    const mockRetainedJobs = [
      {
        id: 'idemp-disp-1-del-0-1234',
        data: { outboxId: 'outbox-disp-1' },
        remove: async () => {
          removedJobs.push('idemp-disp-1-del-0-1234');
        },
      },
      {
        id: 'unrelated-job-999',
        data: { outboxId: 'other-id' },
        remove: async () => {
          removedJobs.push('unrelated-job-999');
        },
      },
    ];
    mockQueue.getJobs = async () => mockRetainedJobs;
    let updateRecordArgs: any = null;
    mockPrismaDispatcher.outboxEvent.findUnique = async () => ({
      id: 'outbox-disp-1',
      idempotency_key: 'idemp-disp-1',
      attempts: 3,
      status: OutboxStatusEnum.FAILED,
    });
    mockPrismaDispatcher.outboxEvent.update = async (args: any) => {
      updateRecordArgs = args;
      return { id: 'outbox-disp-1', status: OutboxStatusEnum.PENDING, attempts: 0 };
    };

    await dispatcherUnit.retryFailed('outbox-disp-1');
    if (
      !removedJobs.includes('idemp-disp-1-del-0-1234') ||
      removedJobs.includes('unrelated-job-999')
    ) {
      throw new Error(
        `retryFailed did not purge matching retained jobs correctly: ${JSON.stringify(removedJobs)}`
      );
    }
    if (
      updateRecordArgs?.data?.status !== OutboxStatusEnum.PENDING ||
      updateRecordArgs?.data?.attempts !== 0
    ) {
      throw new Error('retryFailed did not reset status to PENDING and attempts to 0');
    }

    // E. OutboxDispatcher recoverStaleProcessing conditional update (Finding 3)
    let staleWhere: any = null;
    let staleUpdateManyArgs: any = null;
    mockPrismaDispatcher.outboxEvent.findMany = async (args: any) => {
      staleWhere = args.where;
      return [
        {
          id: 'stale-1',
          attempts: 1,
          last_error: null,
        },
      ];
    };
    mockPrismaDispatcher.outboxEvent.updateMany = async (args: any) => {
      staleUpdateManyArgs = args;
      return { count: 1 };
    };

    const staleRes = await dispatcherUnit.recoverStaleProcessing(60000);
    if (staleRes.recovered !== 1) {
      throw new Error(`Expected recovered count 1, got ${staleRes.recovered}`);
    }
    if (
      staleWhere?.event_type !== QUEUE_SMOKE_EVENT_TYPE ||
      staleWhere?.status !== OutboxStatusEnum.PROCESSING
    ) {
      throw new Error(
        'recoverStaleProcessing must filter by QUEUE_SMOKE_EVENT_TYPE and PROCESSING'
      );
    }
    if (staleUpdateManyArgs?.where?.status !== OutboxStatusEnum.PROCESSING) {
      throw new Error('recoverStaleProcessing updateMany must require status: PROCESSING');
    }
    if (staleUpdateManyArgs?.data?.status !== OutboxStatusEnum.PENDING) {
      throw new Error('recoverStaleProcessing must set status to PENDING');
    }
  }
  console.log('✅ SmokeWorker and OutboxDispatcher offline unit behaviors passed');

  // 3. SmokeWorker Redis Deduplication Guard Tests (AC-FOUND-03-10, Finding 2)
  console.log('Testing SmokeWorker Redis deduplication (smoke:dedup:${jobId})...');
  {
    const prismaService = new PrismaService({
      datasources: { db: { url: config.DATABASE_URL } },
    });
    await prismaService.onModuleInit();

    const redisService = new RedisService(config);
    const dbStatus = await prismaService.checkReadiness();
    const redisStatus = await redisService.checkReadiness();

    if (dbStatus !== 'up' || redisStatus !== 'up') {
      if (process.env.CI) {
        throw new Error('PostgreSQL and Redis must be reachable in CI environment');
      }
      console.warn(
        `⚠️ Infrastructure not reachable (DB: ${dbStatus}, Redis: ${redisStatus}). Skipping live worker tests (run 'pnpm infra:up' to enable).`
      );
      await redisService.onModuleDestroy();
      await prismaService.onModuleDestroy();
      console.log('🎉 All @shipde/worker offline tests passed successfully!');
      return;
    }

    const redis = redisService.getClient();

    const smokeWorker = new SmokeWorker(config, prismaService, redisService);

    const testSmokeId = `smoke_dedup_${Date.now()}`;
    const testCorrelationId = `corr-dedup-${Date.now()}`;
    const testJobId = `job-dedup-${Date.now()}`;
    const dedupKey = `smoke:dedup:${testJobId}`;

    // Ensure clean state in Redis
    await redis.del(dedupKey);

    const outboxRecord = await prismaService.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: { smokeId: testSmokeId, message: 'Deduplication smoke test' },
        correlation_id: testCorrelationId,
        idempotency_key: testJobId,
        status: OutboxStatusEnum.PROCESSING,
      },
    });

    try {
      const mockJob = {
        id: testJobId,
        data: {
          outboxId: outboxRecord.id,
          smokeId: testSmokeId,
          correlationId: testCorrelationId,
          eventType: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: testSmokeId },
          idempotencyKey: testJobId,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      // 3.1 First delivery: acquires Redis key, processes successfully and updates outbox to PUBLISHED
      const firstResult = await smokeWorker.processJob(mockJob);
      if (!firstResult.success || firstResult.duplicate) {
        throw new Error(`Expected first delivery to succeed, got: ${JSON.stringify(firstResult)}`);
      }
      if (smokeWorker.processedCount !== 1) {
        throw new Error(`Expected processedCount 1, got ${smokeWorker.processedCount}`);
      }

      // Verify Redis deduplication key was set
      const redisVal = await redis.get(dedupKey);
      if (redisVal !== '1') {
        throw new Error(`Expected Redis key ${dedupKey} to be set to '1', got: ${redisVal}`);
      }

      // Verify DB state updated
      const updatedRecord = await prismaService.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (!updatedRecord || updatedRecord.status !== OutboxStatusEnum.PUBLISHED) {
        throw new Error(`Expected outbox event to be PUBLISHED, got ${updatedRecord?.status}`);
      }

      // 3.2 Duplicate delivery: intercepted by Redis deduplication guard without committing side effects
      const secondResult = await smokeWorker.processJob(mockJob);
      if (!secondResult.success || !secondResult.duplicate) {
        throw new Error(`Expected duplicate detection, got: ${JSON.stringify(secondResult)}`);
      }
      if (smokeWorker.duplicateCount !== 1) {
        throw new Error(`Expected duplicateCount 1, got ${smokeWorker.duplicateCount}`);
      }
      // processedCount MUST remain 1 (no duplicate side effects committed!)
      if (smokeWorker.processedCount !== 1) {
        throw new Error(`Expected processedCount to remain 1, got ${smokeWorker.processedCount}`);
      }

      // 3.3 Crash recovery test: Redis dedup key exists but DB is still PROCESSING (crash before PUBLISHED committed)
      // The worker must reconcile against durable state and mark it PUBLISHED instead of stranding it (Finding 4)
      const crashSmokeId = `smoke_crash_${Date.now()}`;
      const crashJobId = `job-crash-${Date.now()}`;
      const crashDedupKey = `smoke:dedup:${crashJobId}`;
      const uncommittedEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: crashSmokeId },
          correlation_id: `corr-uncommitted-${Date.now()}`,
          idempotency_key: crashJobId,
          status: OutboxStatusEnum.PROCESSING,
        },
      });
      await redis.set(crashDedupKey, '1', 'EX', 86400);

      const mockCrashJob = {
        id: crashJobId,
        data: {
          outboxId: uncommittedEvent.id,
          smokeId: crashSmokeId,
          correlationId: uncommittedEvent.correlation_id,
          eventType: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: crashSmokeId },
          idempotencyKey: crashJobId,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      const reconciledResult = await smokeWorker.processJob(mockCrashJob);
      if (!reconciledResult.success) {
        throw new Error(
          `Expected crash reconciliation to succeed, got: ${JSON.stringify(reconciledResult)}`
        );
      }

      const reconciledRecord = await prismaService.outboxEvent.findUnique({
        where: { id: uncommittedEvent.id },
      });
      if (!reconciledRecord || reconciledRecord.status !== OutboxStatusEnum.PUBLISHED) {
        throw new Error(
          `Expected uncommitted event to be reconciled to PUBLISHED, got ${reconciledRecord?.status}`
        );
      }

      // Clean up Redis & DB
      await redis.del(dedupKey);
      await redis.del(crashDedupKey);
      await prismaService.outboxEvent.delete({ where: { id: outboxRecord.id } });
      await prismaService.outboxEvent.delete({ where: { id: uncommittedEvent.id } });
    } finally {
      await redisService.onModuleDestroy();
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ SmokeWorker Redis deduplication tests passed');

  // 4. SmokeWorker Transient Handler Failure & Recovery Tests (Finding 1 & Finding 2)
  console.log('Testing SmokeWorker transient handler failure and recovery...');
  {
    const prismaService = new PrismaService({
      datasources: { db: { url: config.DATABASE_URL } },
    });
    await prismaService.onModuleInit();

    const redisService = new RedisService(config);
    const smokeWorker = new SmokeWorker(config, prismaService, redisService);

    const testSmokeId = `smoke_transient_${Date.now()}`;
    const testCorrelationId = `corr-transient-${Date.now()}`;
    const testJobId = `job-transient-${Date.now()}`;

    // Create an outbox event in PROCESSING state (in-flight)
    const outboxRecord = await prismaService.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: { smokeId: testSmokeId },
        correlation_id: testCorrelationId,
        idempotency_key: testJobId,
        status: OutboxStatusEnum.PROCESSING,
        attempts: 0,
      },
    });

    try {
      const mockJobAttempt1 = {
        id: testJobId,
        attemptsMade: 1,
        opts: { attempts: 3 },
        data: {
          outboxId: outboxRecord.id,
          smokeId: testSmokeId,
          correlationId: testCorrelationId,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      // 4.1 Transient failure: attempt 1 fails with simulated error containing a sensitive password
      const secretError = new Error('Transient DB timeout with password superSecretDbPass123');
      await smokeWorker.handleJobFailure(mockJobAttempt1, secretError);

      // Verify outbox record remains recoverable in PROCESSING with recorded attempt and sanitized error
      const transientRecord = await prismaService.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (!transientRecord) throw new Error('Expected outbox record to exist');
      if (transientRecord.status !== OutboxStatusEnum.PROCESSING) {
        throw new Error(
          `Expected status PROCESSING during transient failure, got: ${transientRecord.status}`
        );
      }
      if (transientRecord.attempts !== 1) {
        throw new Error(`Expected attempts 1, got: ${transientRecord.attempts}`);
      }
      if (!transientRecord.last_error) {
        throw new Error('Expected last_error to be recorded');
      }
      // Assert sensitive password is fully redacted
      assertNoSecretValues(transientRecord.last_error, ['superSecretDbPass123']);

      // 4.2 Subsequent retry succeeds: job processes cleanly and transitions to PUBLISHED
      const retryJob = {
        id: testJobId,
        data: {
          outboxId: outboxRecord.id,
          smokeId: testSmokeId,
          correlationId: testCorrelationId,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      const retryResult = await smokeWorker.processJob(retryJob);
      if (!retryResult.success) {
        throw new Error('Expected retry delivery to succeed');
      }

      const recoveredRecord = await prismaService.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (!recoveredRecord || recoveredRecord.status !== OutboxStatusEnum.PUBLISHED) {
        throw new Error(
          `Expected recovered event to be PUBLISHED, got: ${recoveredRecord?.status}`
        );
      }
      if (!recoveredRecord.published_at) {
        throw new Error('Expected published_at timestamp to be populated upon recovery');
      }

      // Clean up
      await redisService.getClient().del(`smoke:dedup:${testJobId}`);
      await prismaService.outboxEvent.delete({ where: { id: outboxRecord.id } });
    } finally {
      await redisService.onModuleDestroy();
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ SmokeWorker transient handler failure and recovery tests passed');

  // 5. SmokeWorker Exhausted Handler Failure Tests (Finding 1 & Finding 2)
  console.log('Testing SmokeWorker exhausted handler failure (transition to FAILED)...');
  {
    const prismaService = new PrismaService({
      datasources: { db: { url: config.DATABASE_URL } },
    });
    await prismaService.onModuleInit();

    const redisService = new RedisService(config);
    const smokeWorker = new SmokeWorker(config, prismaService, redisService);

    const testSmokeId = `smoke_exhausted_${Date.now()}`;
    const testCorrelationId = `corr-exhausted-${Date.now()}`;
    const testJobId = `job-exhausted-${Date.now()}`;

    const outboxRecord = await prismaService.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: { smokeId: testSmokeId },
        correlation_id: testCorrelationId,
        idempotency_key: testJobId,
        status: OutboxStatusEnum.PROCESSING,
        attempts: 2,
      },
    });

    try {
      // Attempt 3: exhausted failure (attemptsMade >= 3)
      const mockJobAttempt3 = {
        id: testJobId,
        attemptsMade: 3,
        opts: { attempts: 3 },
        data: {
          outboxId: outboxRecord.id,
          smokeId: testSmokeId,
          correlationId: testCorrelationId,
        } as SmokeJobData,
      } as Job<SmokeJobData>;

      const exhaustedError = new Error(
        'Permanent downstream failure: token secretToken999 rejected'
      );
      await smokeWorker.handleJobFailure(mockJobAttempt3, exhaustedError);

      // Verify outbox record transitions to FAILED deterministically (NOT stranded in PROCESSING!)
      const failedRecord = await prismaService.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (!failedRecord) throw new Error('Expected outbox record to exist');
      if (failedRecord.status !== OutboxStatusEnum.FAILED) {
        throw new Error(
          `Expected exhausted job to transition to FAILED, got: ${failedRecord.status}`
        );
      }
      if (failedRecord.attempts !== 3) {
        throw new Error(`Expected attempts 3, got: ${failedRecord.attempts}`);
      }
      if (!failedRecord.last_error) {
        throw new Error('Expected last_error to be recorded on FAILED record');
      }
      assertNoSecretValues(failedRecord.last_error, ['secretToken999']);

      // 5.1 Recovery of FAILED record via OutboxDispatcher retryFailed()
      const dispatcher = new OutboxDispatcher(config, prismaService);
      const retriedRecord = await dispatcher.retryFailed(failedRecord.id);
      if (retriedRecord.status !== OutboxStatusEnum.PENDING) {
        throw new Error(`Expected retryFailed to set status PENDING, got: ${retriedRecord.status}`);
      }
      if (retriedRecord.attempts !== 0) {
        throw new Error(
          `Expected retryFailed to reset attempts to 0, got: ${retriedRecord.attempts}`
        );
      }

      // Clean up
      await redisService.getClient().del(`smoke:dedup:${testJobId}`);
      await prismaService.outboxEvent.delete({ where: { id: outboxRecord.id } });
    } finally {
      await redisService.onModuleDestroy();
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ SmokeWorker exhausted handler failure tests passed');

  // 6. Outbox Dispatcher Tests (AC-FOUND-03-09, AC-FOUND-03-10, Finding 1 & 2)
  console.log('Testing OutboxDispatcher with real database and Redis queue...');
  {
    const prismaService = new PrismaService({
      datasources: { db: { url: config.DATABASE_URL } },
    });
    await prismaService.onModuleInit();
    const redisService = new RedisService(config);

    const dispatcher = new OutboxDispatcher(config, prismaService);
    await dispatcher.onModuleInit();

    const testCorrelationId = `corr-disp-${Date.now()}`;
    const testIdempotencyKey = `idemp-disp-${Date.now()}`;

    // 6.1 Successful dispatch: PENDING -> PROCESSING
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

      // Clean up BullMQ queue job & assert correlation propagation (Finding 7)
      const queue = dispatcher.getQueue();
      const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
      const matchingJob = jobs.find((j) => j.id?.startsWith(event.idempotency_key || event.id));
      if (!matchingJob) {
        throw new Error('Expected enqueued BullMQ job to be found in queue');
      }
      if (matchingJob.data.correlationId !== testCorrelationId) {
        throw new Error(
          `Expected BullMQ job correlationId ${testCorrelationId}, got ${matchingJob.data.correlationId}`
        );
      }
      for (const j of jobs) {
        if (j.id?.startsWith(event.idempotency_key || event.id)) {
          await j.remove();
        }
      }

      // 6.2 Stale processing recovery test
      const staleEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: 'stale-1' },
          correlation_id: `corr-stale-${Date.now()}`,
          status: OutboxStatusEnum.PROCESSING,
          scheduled_at: new Date(Date.now() - 120000), // 2 minutes ago
          attempts: 1,
        },
      });

      const recoveryResult = await dispatcher.recoverStaleProcessing(60000);
      if (recoveryResult.recovered < 1) {
        throw new Error(`Expected at least 1 recovered event, got: ${recoveryResult.recovered}`);
      }

      const recoveredStale = await prismaService.outboxEvent.findUnique({
        where: { id: staleEvent.id },
      });
      if (!recoveredStale || recoveredStale.status !== OutboxStatusEnum.PENDING) {
        throw new Error(
          `Expected recovered stale event to be PENDING, got: ${recoveredStale?.status}`
        );
      }

      // 6.2b Ensure recoverStaleProcessing does NOT regress PUBLISHED records (Finding 3)
      const publishedStaleEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: 'stale-pub-1' },
          correlation_id: `corr-stale-pub-${Date.now()}`,
          status: OutboxStatusEnum.PUBLISHED,
          scheduled_at: new Date(Date.now() - 120000),
          published_at: new Date(),
          attempts: 1,
        },
      });

      await dispatcher.recoverStaleProcessing(60000);
      const verifiedPublished = await prismaService.outboxEvent.findUnique({
        where: { id: publishedStaleEvent.id },
      });
      if (verifiedPublished?.status !== OutboxStatusEnum.PUBLISHED) {
        throw new Error('recoverStaleProcessing regressed PUBLISHED event to PENDING!');
      }

      // Clean up DB records
      await prismaService.outboxEvent.delete({ where: { id: event.id } });
      await prismaService.outboxEvent.delete({ where: { id: staleEvent.id } });
      await prismaService.outboxEvent.delete({ where: { id: publishedStaleEvent.id } });

      // 6.3 Concurrent dispatcher claim & idempotency race test (Finding 3)
      console.log('Testing concurrent dispatcher atomic claim...');
      const concurrentEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: 'concurrent-claim-1' },
          correlation_id: `corr-race-${Date.now()}`,
          status: OutboxStatusEnum.PENDING,
        },
      });

      // Simulate 2 workers attempting to atomically claim the same PENDING record
      const claim1 = await prismaService.outboxEvent.updateMany({
        where: { id: concurrentEvent.id, status: OutboxStatusEnum.PENDING },
        data: { status: OutboxStatusEnum.PROCESSING },
      });
      const claim2 = await prismaService.outboxEvent.updateMany({
        where: { id: concurrentEvent.id, status: OutboxStatusEnum.PENDING },
        data: { status: OutboxStatusEnum.PROCESSING },
      });

      if (claim1.count !== 1) {
        throw new Error(`Expected claim1 to succeed with count 1, got ${claim1.count}`);
      }
      if (claim2.count !== 0) {
        throw new Error(`Expected claim2 to fail with count 0, got ${claim2.count}`);
      }

      // Ensure status cannot regress from PUBLISHED back to PROCESSING
      await prismaService.outboxEvent.update({
        where: { id: concurrentEvent.id },
        data: { status: OutboxStatusEnum.PUBLISHED, published_at: new Date() },
      });

      const regressedAttempt = await prismaService.outboxEvent.updateMany({
        where: { id: concurrentEvent.id, status: OutboxStatusEnum.PENDING },
        data: { status: OutboxStatusEnum.PROCESSING },
      });
      if (regressedAttempt.count !== 0) {
        throw new Error('Expected atomic claim to reject regressing PUBLISHED to PROCESSING');
      }

      // Ensure dispatch error handler update cannot regress PUBLISHED back to PENDING/FAILED (Finding 1)
      const dispatchCatchTest = await prismaService.outboxEvent.updateMany({
        where: { id: concurrentEvent.id, status: OutboxStatusEnum.PROCESSING },
        data: { status: OutboxStatusEnum.FAILED, attempts: 3, last_error: 'simulated late error' },
      });
      if (dispatchCatchTest.count !== 0) {
        throw new Error(
          'Expected dispatch error recovery to reject regressing PUBLISHED to FAILED'
        );
      }

      await prismaService.outboxEvent.delete({ where: { id: concurrentEvent.id } });

      // 6.4 Live retryFailed: purges BullMQ queue and enables clean re-dispatch (Finding 2)
      console.log('Testing live retryFailed queue purge and re-dispatch...');
      const liveFailedEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: 'failed-live-1' },
          correlation_id: `corr-failed-live-${Date.now()}`,
          idempotency_key: `idemp-failed-live-${Date.now()}`,
          status: OutboxStatusEnum.FAILED,
          attempts: 3,
        },
      });
      // Enqueue retained job into queue
      await queue.add(
        'smoke-job',
        { outboxId: liveFailedEvent.id },
        { jobId: `${liveFailedEvent.idempotency_key}-attempt-0` }
      );

      const retriedEvent = await dispatcher.retryFailed(liveFailedEvent.id);
      if (retriedEvent.status !== OutboxStatusEnum.PENDING || retriedEvent.attempts !== 0) {
        throw new Error('retryFailed failed to reset live event to PENDING with 0 attempts');
      }

      // Verify retained job was purged from BullMQ
      const retainedJobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      ]);
      const stillInQueue = retainedJobs.find((j) =>
        j.id?.startsWith(liveFailedEvent.idempotency_key!)
      );
      if (stillInQueue) {
        throw new Error('retryFailed failed to purge retained job from BullMQ queue');
      }

      // Clean re-dispatch succeeds
      const retryDispatchResult = await dispatcher.dispatchPending(10);
      if (retryDispatchResult.dispatched < 1) {
        throw new Error('Expected retried event to be successfully re-dispatched');
      }
      const reDispatchedJobs = await queue.getJobs([
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      ]);
      for (const j of reDispatchedJobs) {
        if (j.id?.startsWith(liveFailedEvent.idempotency_key!)) {
          await j.remove();
        }
      }
      await prismaService.outboxEvent.delete({ where: { id: liveFailedEvent.id } });

      // 6.5 Live concurrent worker delivery: atomic DB claim commits effect once (Finding 4)
      console.log('Testing live concurrent worker delivery atomic claim race...');
      const raceEvent = await prismaService.outboxEvent.create({
        data: {
          event_type: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smokeId: 'race-effect-live' },
          correlation_id: `corr-race-live-${Date.now()}`,
          status: OutboxStatusEnum.PROCESSING,
          attempts: 0,
        },
      });
      const smokeWorkerConcurrent = new SmokeWorker(config, prismaService, redisService);
      const raceJob = {
        id: `race-job-${Date.now()}`,
        data: {
          outboxId: raceEvent.id,
          smokeId: 'race-effect-live',
          correlationId: raceEvent.correlation_id,
          eventType: QUEUE_SMOKE_EVENT_TYPE,
        },
      } as any;

      const [raceRes1, raceRes2] = await Promise.all([
        smokeWorkerConcurrent.processJob(raceJob),
        smokeWorkerConcurrent.processJob(raceJob),
      ]);
      const allResults = [raceRes1, raceRes2];
      const primaryCount = allResults.filter((r) => r.success && !r.duplicate).length;
      const duplicateCount = allResults.filter((r) => r.success && r.duplicate).length;
      if (primaryCount !== 1 || duplicateCount !== 1) {
        throw new Error(
          `Expected exactly 1 primary effect and 1 duplicate, got: ${JSON.stringify(allResults)}`
        );
      }
      await prismaService.outboxEvent.delete({ where: { id: raceEvent.id } });
    } finally {
      await redisService.onModuleDestroy();
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
