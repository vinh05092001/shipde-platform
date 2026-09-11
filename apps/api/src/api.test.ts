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

    // Regression tests for malformed port strings with trailing characters / whitespace (Finding 3)
    const malformedPortCases = [
      { PORT: '3001junk' },
      { REDIS_PORT: '6379oops' },
      { WORKER_HEALTH_PORT: '3002extra' },
      { PORT: ' 3001' },
      { PORT: '3001 ' },
      { PORT: '-1' },
      { PORT: '0' },
      { PORT: '65536' },
    ];
    for (const testCase of malformedPortCases) {
      let caught = false;
      try {
        validateConfig({
          ...process.env,
          DATABASE_URL: 'postgresql://postgres:testPassword@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['testPassword']);
        }
      }
      if (!caught) {
        throw new Error(
          `validateConfig failed to fail-closed on malformed port case: ${JSON.stringify(testCase)}`
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
          DATABASE_URL: 'postgresql://postgres:testPassword@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['testPassword']);
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
          DATABASE_URL: 'postgresql://postgres:testPassword@localhost:5433/shipde_dev',
          ...testCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
          assertNoSecretValues(err.message, ['testPassword']);
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

    // Process-level dependency-down liveness resilience (AC-FOUND-03-04, AC-FOUND-03-06, Finding 1)
    console.log('Testing API PrismaService resilience when PostgreSQL is down...');
    const downPrisma = new PrismaService({
      datasources: {
        db: { url: 'postgresql://postgres:postgres@127.0.0.1:54399/shipde_dev?connect_timeout=1' },
      },
    });
    // onModuleInit must not throw or abort API bootstrap
    await downPrisma.onModuleInit();

    const dbReadiness = await downPrisma.checkReadiness();
    if (dbReadiness !== 'down') {
      throw new Error(`Expected downPrisma.checkReadiness() to be 'down', got ${dbReadiness}`);
    }

    // HealthController must still serve liveness 200 independently of DB state
    const liveWhenDbDown = healthController.getLive(mockReq);
    assertValidLivenessResponse(liveWhenDbDown);
    if (liveWhenDbDown.service !== 'api') {
      throw new Error(`Expected service 'api', got ${liveWhenDbDown.service}`);
    }
    await downPrisma.onModuleDestroy();

    // Process-level blackhole/slow-connect resilience (Finding 1)
    console.log('Testing API PrismaService resilience with slow/blackholed database connection...');
    const blackholePrisma = new PrismaService({
      datasources: {
        db: { url: 'postgresql://postgres:postgres@192.0.2.1:5433/shipde_dev?connect_timeout=1' },
      },
    });
    // onModuleInit must return immediately without blocking
    await blackholePrisma.onModuleInit();
    const blackholeDbReadiness = await blackholePrisma.checkReadiness(500);
    if (blackholeDbReadiness !== 'down') {
      throw new Error(`Expected blackholeDbReadiness to be 'down', got ${blackholeDbReadiness}`);
    }
    await blackholePrisma.onModuleDestroy();

    // Test infra wait container health evaluation (AC-FOUND-03-02, Finding 8)
    console.log('Testing isServiceHealthy logic...');
    const { isServiceHealthy } = await import('../../../infra/docker/wait');
    if (!isServiceHealthy({ health: 'healthy', status: 'Up 10 seconds' })) {
      throw new Error('Expected isServiceHealthy to be true for healthy');
    }
    if (!isServiceHealthy({ status: 'Up 10 seconds (healthy)' })) {
      throw new Error('Expected isServiceHealthy to be true for (healthy)');
    }
    if (isServiceHealthy({ status: 'Up 5 seconds (health: starting)' })) {
      throw new Error('Expected isServiceHealthy to be false for starting');
    }
    if (isServiceHealthy({ health: 'starting', status: 'Up 5 seconds' })) {
      throw new Error('Expected isServiceHealthy to be false for starting health');
    }
    if (isServiceHealthy({ status: 'Up 1 minute (unhealthy)' })) {
      throw new Error('Expected isServiceHealthy to be false for unhealthy');
    }
    if (isServiceHealthy({ health: 'unhealthy', status: 'Up 1 minute' })) {
      throw new Error('Expected isServiceHealthy to be false for unhealthy health');
    }
    if (isServiceHealthy({ status: 'Up 1 minute' })) {
      throw new Error(
        'Expected isServiceHealthy to be false when health check is missing/not reported'
      );
    }
    if (isServiceHealthy({ status: 'Exited (1) 2 minutes ago' })) {
      throw new Error('Expected isServiceHealthy to be false for exited container');
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

    const dbStatus = await prismaService.checkReadiness();
    if (dbStatus !== 'up') {
      if (process.env.CI) {
        throw new Error('Database must be reachable in CI environment');
      }
      console.warn(
        `⚠️ PostgreSQL is not reachable at ${config.DATABASE_URL}. Skipping live DB tests (run 'pnpm infra:up' to enable).`
      );
      await prismaService.onModuleDestroy();
      console.log('🎉 All @shipde/api offline tests passed successfully!');
      return;
    }

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

    // Verify formatStructuredLog redacts secrets embedded in message string (Finding 2)
    const logWithSecretMessage = formatStructuredLog({
      service: 'api',
      level: 'error',
      message:
        'Failed to connect postgresql://postgres:leakPassword123@localhost:5433/db with token superSecretToken999',
    });
    assertNoSecretValues(logWithSecretMessage, ['leakPassword123', 'superSecretToken999']);
    const parsedSecretMsg = JSON.parse(logWithSecretMessage);
    if (
      parsedSecretMsg.message.includes('leakPassword123') ||
      parsedSecretMsg.message.includes('superSecretToken999')
    ) {
      throw new Error('Expected credentials to be redacted from message field in structured log');
    }
  }
  console.log('✅ Structured logging and secret redaction tests passed');

  // 5. Clean process startup with .env file test (Finding 1)
  console.log('Testing clean process startup with .env file...');
  {
    const { execSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const pathMod = await import('node:path');
    const tempDir = mkdtempSync(pathMod.join(tmpdir(), 'shipde-env-test-'));
    try {
      const tempEnv = pathMod.join(tempDir, '.env');
      writeFileSync(
        tempEnv,
        'PORT=3099\nDATABASE_URL=postgresql://postgres:test@localhost:5433/shipde_dev\nREDIS_HOST=localhost\nREDIS_PORT=6379\nS3_ACCESS_KEY=minioadmin\nS3_SECRET_KEY=minioadmin\n'
      );
      // Execute node to verify process.loadEnvFile loads the variables
      const cleanEnv = { ...process.env };
      delete cleanEnv.PORT;
      const out = execSync(
        `node --env-file-if-exists="${tempEnv}" -e "console.log(process.env.PORT)"`,
        { cwd: tempDir, encoding: 'utf-8', env: cleanEnv }
      );
      if (out.trim() !== '3099') {
        throw new Error(`Expected PORT 3099 loaded from .env, got: ${out.trim()}`);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
  console.log('✅ Clean process startup with .env file passed');

  // 6. Production Mode Dependency Configuration Tests (Finding 7)
  console.log('Testing production mode explicit dependency requirements (fail-closed)...');
  {
    const prodDepCases = [
      { REDIS_HOST: '' },
      { REDIS_PORT: '' },
      { S3_ENDPOINT: '' },
      { S3_REGION: '' },
      { S3_ACCESS_KEY: '' },
      { S3_SECRET_KEY: '' },
      { S3_BUCKET: '' },
    ];
    for (const depCase of prodDepCases) {
      let caught = false;
      try {
        validateConfig({
          NODE_ENV: 'production',
          PORT: '3001',
          WORKER_HEALTH_PORT: '3002',
          DATABASE_URL: 'postgresql://postgres:pass@remote-host:5432/shipde_prod',
          REDIS_HOST: 'redis.prod.internal',
          REDIS_PORT: '6379',
          S3_ENDPOINT: 'https://s3.prod.internal',
          S3_REGION: 'ap-southeast-1',
          S3_ACCESS_KEY: 'prod-access-key',
          S3_SECRET_KEY: 'prod-secret-key',
          S3_BUCKET: 'prod-bucket',
          CARRIER_MODE: 'live',
          ...depCase,
        });
      } catch (err: unknown) {
        if (err instanceof ConfigValidationError) {
          caught = true;
        }
      }
      if (!caught) {
        throw new Error(
          `Expected validateConfig to fail closed in production for omitted setting: ${JSON.stringify(depCase)}`
        );
      }
    }
  }
  console.log('✅ Production dependency fail-closed validation passed');

  // 7. Complete Connection String URI Redaction Tests (Finding 8)
  console.log('Testing complete connection string URI redaction in structured logs...');
  {
    const logWithPgUri = formatStructuredLog({
      service: 'api',
      level: 'error',
      message:
        'Connection failed to postgresql://postgres:mypassword@db.internal:5432/mydb?sslmode=require',
      metadata: {
        databaseUrl: 'postgresql://postgres:mypassword@db.internal:5432/mydb',
        redisUrl: 'redis://:redispass@redis.internal:6379',
      },
    });
    if (
      logWithPgUri.includes('postgresql://') ||
      logWithPgUri.includes('postgres://') ||
      logWithPgUri.includes('redis://')
    ) {
      throw new Error(
        `Expected connection strings to be completely redacted from structured log: ${logWithPgUri}`
      );
    }
    const parsedPgLog = JSON.parse(logWithPgUri);
    if (
      parsedPgLog.message.includes('db.internal') ||
      parsedPgLog.metadata.databaseUrl.includes('db.internal')
    ) {
      throw new Error(`Expected host and database name to be completely redacted: ${logWithPgUri}`);
    }
  }
  console.log('✅ Connection string URI redaction tests passed');

  // 8. OpenTelemetry Distributed Tracing Foundation Tests (Finding 10)
  console.log('Testing OpenTelemetry distributed tracing foundation...');
  {
    const { initTelemetry, withSpan, extractTraceContext, injectTraceContext } =
      await import('@shipde/config');

    // Test production telemetry does not retain spans indefinitely (Finding 4)
    const prodTelemetry = initTelemetry('test-prod-api');
    await withSpan(prodTelemetry.tracer, 'test.prod_span', async (span) => {
      span.setAttribute('test.attribute', 'valid');
    });
    if (prodTelemetry.getRecordedSpans().length !== 0) {
      throw new Error('Expected production telemetry to not retain spans in process memory');
    }
    await prodTelemetry.shutdown();

    // Test in-memory telemetry for test verification
    const { tracer, shutdown, getRecordedSpans } = initTelemetry('test-api', '0.1.0', {
      inMemory: true,
    });
    await withSpan(tracer, 'test.foundation_span', async (span) => {
      span.setAttribute('test.attribute', 'valid');
    });
    const spans = getRecordedSpans() as any[];
    if (spans.length === 0 || !spans.some((s) => s.name === 'test.foundation_span')) {
      throw new Error('Expected OpenTelemetry span to be recorded');
    }

    // Test trace context extraction and injection
    const carrier: Record<string, string> = {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    const extracted = extractTraceContext(carrier);
    if (!extracted) {
      throw new Error('Expected trace context to be extracted from carrier');
    }
    const injectedCarrier: Record<string, string> = {};
    injectTraceContext(injectedCarrier);

    await shutdown();
  }
  console.log('✅ OpenTelemetry distributed tracing foundation passed');

  // 9. OutboxService Allowlist Enforcement Tests (Finding 6)
  console.log('Testing OutboxService allowlist enforcement on creation...');
  {
    const mockPrismaOutbox: any = {
      outboxEvent: {
        create: async (args: any) => ({ id: 'outbox-1', ...args.data }),
      },
    };
    const outboxSvc = new OutboxService(mockPrismaOutbox);
    let caughtUnsupported = false;
    try {
      await outboxSvc.createOutboxEvent({
        eventType: 'UNSUPPORTED_EVENT_TYPE',
        payload: { foo: 'bar' },
        correlationId: 'corr-1',
      });
    } catch (err: any) {
      if (err.message.includes('Unsupported outbox event type')) {
        caughtUnsupported = true;
      }
    }
    if (!caughtUnsupported) {
      throw new Error('Expected OutboxService.createOutboxEvent to reject non-smoke event types');
    }

    // Test invalid correlationId is normalized before persistence (Round 6 Finding 5)
    let createdArgs: any = null;
    mockPrismaOutbox.outboxEvent.create = async (args: any) => {
      createdArgs = args;
      return { id: 'outbox-1', ...args.data };
    };
    await outboxSvc.createOutboxEvent({
      eventType: QUEUE_SMOKE_EVENT_TYPE,
      payload: { smokeId: 'smoke-norm-1' },
      correlationId: '   ',
    });
    if (!createdArgs?.data?.correlation_id || createdArgs.data.correlation_id.trim().length === 0) {
      throw new Error('Expected whitespace correlationId to be normalized to valid UUID');
    }

    // Test transaction creation normalizes correlationId as well
    let txCreatedArgs: any = null;
    const mockTx: any = {
      outboxEvent: {
        create: async (args: any) => {
          txCreatedArgs = args;
          return { id: 'outbox-tx-1', ...args.data };
        },
      },
    };
    await outboxSvc.createWithinTransaction(mockTx, {
      eventType: QUEUE_SMOKE_EVENT_TYPE,
      payload: { smokeId: 'smoke-norm-2' },
      correlationId: 'invalid@@chars!!',
    });
    if (!txCreatedArgs?.data?.correlation_id || txCreatedArgs.data.correlation_id.includes('@@')) {
      throw new Error(
        'Expected invalid correlationId in transaction to be normalized to valid UUID'
      );
    }
  }
  console.log('✅ OutboxService allowlist enforcement passed');

  // 10. OutboxService Lifecycle Helper Atomic Invariant Tests (Finding 3)
  console.log(
    'Testing OutboxService lifecycle helper atomic invariants and regression prevention...'
  );
  {
    let statusState: OutboxStatusEnum = OutboxStatusEnum.PENDING;
    const mockPrismaLifecycle: any = {
      outboxEvent: {
        findUnique: async () => ({ id: 'evt-1', status: statusState, attempts: 0 }),
        findUniqueOrThrow: async () => ({ id: 'evt-1', status: statusState, attempts: 0 }),
        updateMany: async (args: any) => {
          if (args.where.status?.in?.includes(statusState)) {
            statusState = args.data.status;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    };
    const lifecycleSvc = new OutboxService(mockPrismaLifecycle);

    // Mark published from PENDING -> OK
    await lifecycleSvc.markPublished('evt-1');
    if (statusState !== OutboxStatusEnum.PUBLISHED) {
      throw new Error('Expected markPublished to transition PENDING to PUBLISHED');
    }

    // Subsequent recordFailure on PUBLISHED event must be rejected and NEVER regress to FAILED or PENDING
    let caughtRegress = false;
    try {
      await lifecycleSvc.recordFailure('evt-1', 'late failure');
    } catch (err: any) {
      if (err.message.includes('already PUBLISHED')) {
        caughtRegress = true;
      }
    }
    if (!caughtRegress || statusState !== OutboxStatusEnum.PUBLISHED) {
      throw new Error(
        'Expected recordFailure to reject already PUBLISHED event and prevent regression'
      );
    }
  }
  console.log('✅ OutboxService lifecycle helper atomic invariants passed');

  console.log('🎉 All @shipde/api tests passed successfully!');
}

runApiTests().catch((err) => {
  console.error('❌ @shipde/api test failure:', err);
  process.exit(1);
});
