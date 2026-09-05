import {
  validateConfig,
  ConfigValidationError,
  normalizeCorrelationId,
  formatStructuredLog,
  redactSensitiveData,
} from '@shipde/config';
import {
  assertValidLivenessResponse,
  assertValidReadinessResponse,
  assertNoSensitiveData,
  assertNoSecretValues,
  createValidTestConfig,
} from '@shipde/testkit';
import { HealthService } from './health/health.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { OutboxService } from './outbox/outbox.service';
import { QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';

async function runApiTests() {
  console.log('--- Starting @shipde/api tests ---');

  // 1. Config Validation Tests (AC-FOUND-03-03)
  console.log('Testing configuration validation...');
  {
    // Valid config
    const testConfig = createValidTestConfig();
    const validated = validateConfig({
      NODE_ENV: testConfig.NODE_ENV,
      PORT: String(testConfig.PORT),
      WORKER_HEALTH_PORT: String(testConfig.WORKER_HEALTH_PORT),
      DATABASE_URL: testConfig.DATABASE_URL,
      REDIS_HOST: testConfig.REDIS_HOST,
      REDIS_PORT: String(testConfig.REDIS_PORT),
      S3_ENDPOINT: testConfig.S3_ENDPOINT,
      S3_REGION: testConfig.S3_REGION,
      S3_ACCESS_KEY: testConfig.S3_ACCESS_KEY,
      S3_SECRET_KEY: testConfig.S3_SECRET_KEY,
      S3_BUCKET: testConfig.S3_BUCKET,
      CARRIER_MODE: testConfig.CARRIER_MODE,
    });
    if (validated.PORT !== 3001) {
      throw new Error(`Expected PORT 3001, got ${validated.PORT}`);
    }

    // Missing required fields fail closed
    let caughtMissing = false;
    try {
      validateConfig({
        NODE_ENV: 'test',
        // Missing DATABASE_URL, REDIS_HOST, etc.
      });
    } catch (err: unknown) {
      if (err instanceof ConfigValidationError) {
        caughtMissing = true;
        if (!err.invalidFields.some((f) => f.includes('DATABASE_URL'))) {
          throw new Error('Expected invalidFields to list DATABASE_URL');
        }
        // Assert error message NEVER reveals secrets
        assertNoSecretValues(err.message, ['minioadmin', 'supersecret', 'testPassword']);
      }
    }
    if (!caughtMissing) {
      throw new Error('validateConfig failed to throw ConfigValidationError on missing fields');
    }

    // Malformed fields fail closed
    let caughtMalformed = false;
    try {
      validateConfig({
        ...process.env,
        DATABASE_URL: 'postgresql://postgres:testPassword@localhost:5433/shipde_dev',
        PORT: '99999', // out of range
        CARRIER_MODE: 'invalid_carrier_mode' as any,
      });
    } catch (err: unknown) {
      if (err instanceof ConfigValidationError) {
        caughtMalformed = true;
        assertNoSecretValues(err.message, ['testPassword']);
      }
    }
    if (!caughtMalformed) {
      throw new Error('validateConfig failed to throw on malformed port / carrier mode');
    }
  }
  console.log('✅ Configuration validation tests passed');

  // 2. Health Service & Controller Tests (AC-FOUND-03-04, AC-FOUND-03-05, AC-FOUND-03-06)
  console.log('Testing HealthService and HealthController...');
  {
    // Mock dependencies
    const mockPrisma: any = {
      checkReadiness: async () => 'up' as const,
    };
    const mockRedis: any = {
      checkReadiness: async () => 'up' as const,
    };
    const mockStorage: any = {
      checkReadiness: async () => 'up' as const,
    };

    const healthService = new HealthService(mockPrisma, mockRedis, mockStorage);
    const healthController = new HealthController(healthService);

    // Test liveness probe
    const mockReq: any = {
      correlationId: 'test-corr-id-12345678',
      headers: {},
    };
    const liveRes = healthController.getLive(mockReq);
    assertValidLivenessResponse(liveRes);
    if (liveRes.correlationId !== 'test-corr-id-12345678') {
      throw new Error(`Correlation ID was not preserved in liveness: ${liveRes.correlationId}`);
    }

    // Test readiness probe when all services are healthy (200)
    let responseStatus: number = 0;
    let responseJson: any = null;
    const mockRes: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      json(body: any) {
        responseJson = body;
        return this;
      },
    };

    await healthController.getReady(mockReq, mockRes);
    if ((responseStatus as number) !== 200) {
      throw new Error(`Expected readiness 200, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'ok');
    if (
      (responseJson.checks.database as string) !== 'up' ||
      (responseJson.checks.redis as string) !== 'up' ||
      (responseJson.checks.storage as string) !== 'up'
    ) {
      throw new Error('Expected all checks to be "up" in healthy readiness');
    }

    // Test readiness probe when PostgreSQL is unavailable (503)
    mockPrisma.checkReadiness = async () => 'down' as const;
    await healthController.getReady(mockReq, mockRes);
    if ((responseStatus as number) !== 503) {
      throw new Error(`Expected readiness 503 on database failure, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'error');
    if (
      (responseJson.checks.database as string) !== 'down' ||
      (responseJson.checks.redis as string) !== 'up'
    ) {
      throw new Error('Expected database "down" and redis "up" on partial failure');
    }

    // Test readiness recovery when PostgreSQL recovers (200)
    mockPrisma.checkReadiness = async () => 'up' as const;
    await healthController.getReady(mockReq, mockRes);
    if ((responseStatus as number) !== 200) {
      throw new Error(`Expected readiness 200 after recovery, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'ok');

    // Test readiness probe when Redis is unavailable (503)
    mockRedis.checkReadiness = async () => 'down' as const;
    await healthController.getReady(mockReq, mockRes);
    if ((responseStatus as number) !== 503) {
      throw new Error(`Expected readiness 503 on redis failure, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'error');
    if ((responseJson.checks.redis as string) !== 'down') {
      throw new Error('Expected redis "down" on redis failure');
    }

    // Test readiness probe when Storage is unavailable (503)
    mockRedis.checkReadiness = async () => 'up' as const;
    mockStorage.checkReadiness = async () => 'down' as const;
    await healthController.getReady(mockReq, mockRes);
    if ((responseStatus as number) !== 503) {
      throw new Error(`Expected readiness 503 on storage failure, got ${responseStatus}`);
    }
    assertValidReadinessResponse(responseJson, 'error');
    if ((responseJson.checks.storage as string) !== 'down') {
      throw new Error('Expected storage "down" on storage failure');
    }
  }
  console.log('✅ HealthService and HealthController tests passed');

  // 3. Outbox Atomic Commit and Rollback Tests (AC-FOUND-03-08)
  console.log('Testing Outbox transaction commit and rollback with real database...');
  {
    const config = createValidTestConfig();
    const prismaService = new PrismaService({
      datasources: {
        db: {
          url: config.DATABASE_URL,
        },
      },
    });
    await prismaService.onModuleInit();

    const outboxService = new OutboxService(prismaService);
    const correlationId = normalizeCorrelationId('corr-tx-test');
    const idempotencyKey = `idemp-tx-${Date.now()}`;

    try {
      // 3.1: Atomic Commit
      let committedEventId: string | null = null;
      await prismaService.$transaction(async (tx) => {
        const created = await outboxService.createWithinTransaction(tx, {
          eventType: QUEUE_SMOKE_EVENT_TYPE,
          payload: { smoke: true, testCase: 'commit' },
          correlationId,
          idempotencyKey,
        });
        committedEventId = created.id;
      });

      if (!committedEventId) {
        throw new Error('Failed to create outbox event within transaction');
      }

      // Verify event exists in DB after commit
      const persisted = await prismaService.outboxEvent.findUnique({
        where: { id: committedEventId },
      });
      if (!persisted) {
        throw new Error('Outbox event was not persisted after transaction commit');
      }
      if (persisted.status !== OutboxStatusEnum.PENDING) {
        throw new Error(`Expected PENDING status, got ${persisted.status}`);
      }
      if (persisted.correlation_id !== correlationId) {
        throw new Error(
          `Expected correlation_id ${correlationId}, got ${persisted.correlation_id}`
        );
      }

      // 3.2: Atomic Rollback
      const rollbackIdempotencyKey = `idemp-rollback-${Date.now()}`;
      let rollbackAttemptFailed = false;
      try {
        await prismaService.$transaction(async (tx) => {
          await outboxService.createWithinTransaction(tx, {
            eventType: QUEUE_SMOKE_EVENT_TYPE,
            payload: { smoke: true, testCase: 'rollback' },
            correlationId: 'corr-rollback',
            idempotencyKey: rollbackIdempotencyKey,
          });
          // Explicit rollback trigger
          throw new Error('Intentional transaction abort for rollback verification');
        });
      } catch (err: unknown) {
        if ((err as Error).message.includes('Intentional transaction abort')) {
          rollbackAttemptFailed = true;
        } else {
          throw err;
        }
      }

      if (!rollbackAttemptFailed) {
        throw new Error('Rollback transaction did not throw as expected');
      }

      // Verify rolled-back event DOES NOT exist in DB
      const notFound = await prismaService.outboxEvent.findUnique({
        where: { idempotency_key: rollbackIdempotencyKey },
      });
      if (notFound !== null) {
        throw new Error('Rolled-back outbox event was found in database! Atomicity violated.');
      }

      // Clean up test event
      await prismaService.outboxEvent.delete({ where: { id: committedEventId } });
    } finally {
      await prismaService.onModuleDestroy();
    }
  }
  console.log('✅ Outbox transaction commit and rollback tests passed');

  // 4. Structured Logging and Secret Redaction Tests (AC-FOUND-03-11)
  console.log('Testing structured logging and secret redaction...');
  {
    const logLine = formatStructuredLog({
      service: 'api',
      level: 'info',
      message: 'Processing operational request',
      correlationId: 'corr-log-test',
      metadata: {
        safeField: 'safeValue',
        authorization: 'Bearer super_secret_token_12345',
        databaseUrl: 'postgresql://postgres:myPassword123@localhost:5433/shipde_dev',
      },
    });

    const parsed = JSON.parse(logLine);
    if (parsed.service !== 'api' || parsed.level !== 'info') {
      throw new Error('Invalid fields in structured log');
    }
    if (parsed.correlationId !== 'corr-log-test') {
      throw new Error('Correlation ID missing from structured log');
    }

    // Verify secrets are redacted from log line
    if (parsed.metadata.authorization !== '[REDACTED]') {
      throw new Error('Expected authorization to be redacted in log metadata');
    }
    if (parsed.metadata.databaseUrl.includes('myPassword123')) {
      throw new Error('Database password was not redacted in log metadata');
    }
    assertNoSecretValues(logLine, ['myPassword123', 'super_secret_token_12345']);

    const redacted = redactSensitiveData({
      secretKey: 'minioadmin',
      password: 'mypassword',
      token: 'jwt.token.here',
    }) as Record<string, unknown>;
    if (redacted.password !== '[REDACTED]' || redacted.token !== '[REDACTED]') {
      throw new Error('redactSensitiveData failed to redact sensitive fields');
    }
  }
  console.log('✅ Structured logging and secret redaction tests passed');

  console.log('🎉 All @shipde/api tests passed successfully!');
}

runApiTests().catch((err) => {
  console.error('❌ @shipde/api test failure:', err);
  process.exit(1);
});
