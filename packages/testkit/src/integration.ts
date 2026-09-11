/**
 * End-to-end Integration Test Runner for Ship Dễ Foundation (TASK-FOUND-03)
 *
 * Verifies:
 * - Local Docker infrastructure connectivity (PostgreSQL, Redis, MinIO)
 * - API & Worker independent startup, liveness and readiness HTTP probes
 * - Correlation ID header propagation across services
 * - Process-level dependency outage resilience
 * - Live dependency restoration without process restart (AC-FOUND-03-06, Finding 11)
 * - Durable outbox insert within transaction -> BullMQ dispatch -> Smoke worker processing -> Published state
 * - Strict structured JSON log schema parsing, correlation propagation, and zero connection-string leakage (Finding 12)
 * - Clean shutdown of background child processes
 */
import { spawn, ChildProcess, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { assertValidLivenessResponse, assertValidReadinessResponse } from './index';
import { QUEUE_SMOKE_EVENT_TYPE } from '@shipde/contracts';

const ROOT_DIR = process.cwd();

const API_PORT = process.env.PORT || '3001';
const WORKER_PORT = process.env.WORKER_HEALTH_PORT || '3002';
const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || '6379';
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'minioadmin';
const S3_BUCKET = process.env.S3_BUCKET || 'shipde-test';
const CARRIER_MODE = process.env.CARRIER_MODE || 'disabled';

const childEnv = {
  ...process.env,
  PORT: API_PORT,
  WORKER_HEALTH_PORT: WORKER_PORT,
  DATABASE_URL,
  REDIS_HOST,
  REDIS_PORT,
  S3_ENDPOINT,
  S3_REGION,
  S3_ACCESS_KEY,
  S3_SECRET_KEY,
  S3_BUCKET,
  CARRIER_MODE,
  NODE_ENV: 'test',
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url: string, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        return;
      }
    } catch {
      // service not ready yet
    }
    await sleep(300);
  }
  throw new Error(`Timeout waiting for ${url} to respond with 200 OK`);
}

function stopProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc || proc.killed) {
      return resolve();
    }
    proc.on('exit', () => resolve());
    proc.kill('SIGINT');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve();
    }, 2000);
  });
}

async function testDependencyOutage(
  serviceType: 'api' | 'worker',
  brokenEnv: Record<string, string>,
  expectedDownCheck: 'database' | 'redis' | 'storage',
  testPort: number
): Promise<void> {
  const entry = path.join(
    ROOT_DIR,
    serviceType === 'api' ? 'apps/api/dist/main.js' : 'apps/worker/dist/main.js'
  );
  const proc = spawn(process.execPath, [entry], {
    cwd: path.join(ROOT_DIR, serviceType === 'api' ? 'apps/api' : 'apps/worker'),
    env: {
      ...childEnv,
      PORT: String(testPort),
      WORKER_HEALTH_PORT: String(testPort),
      ...brokenEnv,
    },
    stdio: 'ignore',
  });

  try {
    await waitForHttpOk(`http://localhost:${testPort}/health/live`, 15000);
    const liveRes = await fetch(`http://localhost:${testPort}/health/live`);
    if (liveRes.status !== 200) {
      throw new Error(
        `Process failed liveness check when ${expectedDownCheck} is down: status ${liveRes.status}`
      );
    }

    const readyRes = await fetch(`http://localhost:${testPort}/health/ready`);
    if (readyRes.status !== 503) {
      throw new Error(
        `Expected readiness 503 when ${expectedDownCheck} is down, got ${readyRes.status}`
      );
    }
    const readyJson: any = await readyRes.json();
    assertValidReadinessResponse(readyJson, 'error');
    if (readyJson.checks[expectedDownCheck] !== 'down') {
      throw new Error(
        `Expected check ${expectedDownCheck} to be 'down', got: ${readyJson.checks[expectedDownCheck]}`
      );
    }
    console.log(
      `✅ Process-level outage verified: ${serviceType} retains liveness (200) and reports 503 when ${expectedDownCheck} is down`
    );
  } finally {
    await stopProcess(proc);
  }
}

/**
 * Validates and parses every non-empty line of captured application logs (Finding 12).
 * Strictly verifies schema, absence of database connection strings, and correlation.
 */
function validateAndParseStructuredLogs(
  rawChunks: string[],
  serviceName: 'api' | 'worker'
): Array<Record<string, unknown>> {
  const combined = rawChunks.join('');
  const lines = combined
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const parsedRecords: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    // Prohibition: Raw database connection string or unredacted passwords must NEVER appear in logs
    if (line.includes('postgresql://') || line.includes('postgres://')) {
      throw new Error(
        `[SECURITY LEAK] Raw database connection string detected in ${serviceName} logs: ${line}`
      );
    }
    if (line.includes('testPassword') || line.includes('supersecret')) {
      throw new Error(`[SECURITY LEAK] Secret credential detected in ${serviceName} logs: ${line}`);
    }

    // Inspect JSON application log records
    if (line.startsWith('{') && line.endsWith('}')) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line);
      } catch (err: any) {
        throw new Error(
          `Malformed JSON in ${serviceName} structured log: ${line} (${err.message})`
        );
      }

      if (!['debug', 'info', 'warn', 'error'].includes(parsed.level as string)) {
        throw new Error(`Invalid log level '${parsed.level}' in ${serviceName} log: ${line}`);
      }
      if (parsed.service !== serviceName) {
        throw new Error(
          `Mismatched service '${parsed.service}' (expected '${serviceName}') in log: ${line}`
        );
      }
      if (!parsed.message || typeof parsed.message !== 'string') {
        throw new Error(`Missing or non-string message in ${serviceName} log: ${line}`);
      }
      if (!parsed.time || isNaN(Date.parse(parsed.time as string))) {
        throw new Error(`Invalid or missing ISO timestamp in ${serviceName} log: ${line}`);
      }

      parsedRecords.push(parsed);
    }
  }

  return parsedRecords;
}

async function main() {
  console.log('====================================================');
  console.log('Starting Ship Dễ Foundation Integration Tests (TASK-FOUND-03)');
  console.log('====================================================');

  const prisma = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } },
  });

  let apiProc: ChildProcess | null = null;
  let workerProc: ChildProcess | null = null;

  try {
    // 1. Verify Database and S3 Bucket Readiness
    console.log('1. Verifying database connection on port 5433...');
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1 as result`;
    console.log('✅ PostgreSQL connection verified');

    // Ensure configured test bucket exists in MinIO (Finding 9)
    try {
      const s3 = new S3Client({
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
        forcePathStyle: true,
      });
      try {
        await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
      } catch {
        await s3.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
      }
      s3.destroy();
    } catch {
      // Best effort bucket provisioning
    }

    const apiEntry = path.join(ROOT_DIR, 'apps/api/dist/main.js');
    const workerEntry = path.join(ROOT_DIR, 'apps/worker/dist/main.js');

    if (!fs.existsSync(apiEntry) || !fs.existsSync(workerEntry)) {
      console.log('Build artifacts missing. Compiling API and Worker services...');
      execSync('pnpm --filter @shipde/api --filter @shipde/worker build', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    }

    // 2. Start API Service (capturing stdout/stderr for structured log verification - Finding 12)
    console.log(`2. Spawning API service on port ${API_PORT}...`);
    const apiRawLogs: string[] = [];
    apiProc = spawn(process.execPath, [apiEntry], {
      cwd: path.join(ROOT_DIR, 'apps/api'),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    apiProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      apiRawLogs.push(text);
      process.stdout.write(text);
    });
    apiProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      apiRawLogs.push(text);
      process.stderr.write(text);
    });

    // 3. Start Worker Service (capturing stdout/stderr for structured log verification - Finding 12)
    console.log(`3. Spawning Worker service on health port ${WORKER_PORT}...`);
    const workerRawLogs: string[] = [];
    workerProc = spawn(process.execPath, [workerEntry], {
      cwd: path.join(ROOT_DIR, 'apps/worker'),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    workerProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerRawLogs.push(text);
      process.stdout.write(text);
    });
    workerProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerRawLogs.push(text);
      process.stderr.write(text);
    });

    // 4. Wait for Both Services to be Live
    console.log('4. Polling liveness endpoints...');
    await waitForHttpOk(`http://localhost:${API_PORT}/health/live`);
    console.log('✅ API liveness responded 200 OK');

    await waitForHttpOk(`http://localhost:${WORKER_PORT}/health/live`);
    console.log('✅ Worker liveness responded 200 OK');

    // 5. Test API Liveness & Correlation Header Echo
    console.log('5. Testing API liveness and correlation header propagation...');
    const clientApiCorrId = `corr-api-client-${Date.now()}`;
    const apiLiveRes = await fetch(`http://localhost:${API_PORT}/health/live`, {
      headers: { 'x-correlation-id': clientApiCorrId },
    });
    if (apiLiveRes.status !== 200) {
      throw new Error(`API /health/live failed with status ${apiLiveRes.status}`);
    }
    const apiLiveHeaderCorr = apiLiveRes.headers.get('x-correlation-id');
    if (apiLiveHeaderCorr !== clientApiCorrId) {
      throw new Error(
        `API header x-correlation-id mismatch: expected ${clientApiCorrId}, got ${apiLiveHeaderCorr}`
      );
    }
    const apiLiveJson = await apiLiveRes.json();
    assertValidLivenessResponse(apiLiveJson);
    if (apiLiveJson.correlationId !== clientApiCorrId) {
      throw new Error(
        `API body correlationId mismatch: expected ${clientApiCorrId}, got ${apiLiveJson.correlationId}`
      );
    }
    console.log('✅ API liveness probe conforms to contract with correlation propagation');

    // 6. Test API Readiness
    console.log('6. Testing API readiness probe...');
    const apiReadyRes = await fetch(`http://localhost:${API_PORT}/health/ready`);
    if (apiReadyRes.status !== 200) {
      throw new Error(`API /health/ready failed with status ${apiReadyRes.status}`);
    }
    const apiReadyJson = await apiReadyRes.json();
    assertValidReadinessResponse(apiReadyJson, 'ok');
    if (
      apiReadyJson.checks.database !== 'up' ||
      apiReadyJson.checks.redis !== 'up' ||
      apiReadyJson.checks.storage !== 'up'
    ) {
      throw new Error(`API readiness checks not all up: ${JSON.stringify(apiReadyJson.checks)}`);
    }
    console.log('✅ API readiness probe returned 200 OK (all dependencies healthy)');

    // 7. Test Worker Liveness & Correlation Header Echo
    console.log('7. Testing Worker liveness and correlation header propagation...');
    const clientWorkerCorrId = `corr-worker-client-${Date.now()}`;
    const workerLiveRes = await fetch(`http://localhost:${WORKER_PORT}/health/live`, {
      headers: { 'x-correlation-id': clientWorkerCorrId },
    });
    if (workerLiveRes.status !== 200) {
      throw new Error(`Worker /health/live failed with status ${workerLiveRes.status}`);
    }
    const workerLiveHeaderCorr = workerLiveRes.headers.get('x-correlation-id');
    if (workerLiveHeaderCorr !== clientWorkerCorrId) {
      throw new Error(
        `Worker header x-correlation-id mismatch: expected ${clientWorkerCorrId}, got ${workerLiveHeaderCorr}`
      );
    }
    const workerLiveJson = await workerLiveRes.json();
    assertValidLivenessResponse(workerLiveJson);
    if (workerLiveJson.correlationId !== clientWorkerCorrId) {
      throw new Error(
        `Worker body correlationId mismatch: expected ${clientWorkerCorrId}, got ${workerLiveJson.correlationId}`
      );
    }
    console.log('✅ Worker liveness probe conforms to contract with correlation propagation');

    // 8. Test Worker Readiness
    console.log('8. Testing Worker readiness probe...');
    const workerReadyRes = await fetch(`http://localhost:${WORKER_PORT}/health/ready`);
    if (workerReadyRes.status !== 200) {
      throw new Error(`Worker /health/ready failed with status ${workerReadyRes.status}`);
    }
    const workerReadyJson = await workerReadyRes.json();
    assertValidReadinessResponse(workerReadyJson, 'ok');
    if (
      workerReadyJson.checks.database !== 'up' ||
      workerReadyJson.checks.redis !== 'up' ||
      workerReadyJson.checks.storage !== 'up'
    ) {
      throw new Error(
        `Worker readiness checks not all up: ${JSON.stringify(workerReadyJson.checks)}`
      );
    }
    console.log('✅ Worker readiness probe returned 200 OK (all dependencies healthy)');

    // 8.5 Test Process-Level Dependency Outage & Resilience (AC-FOUND-03-04, AC-FOUND-03-06)
    console.log(
      '8.5 Testing process-level dependency outage scenarios (PostgreSQL, Redis, MinIO)...'
    );

    // 8.5.1 API with PostgreSQL Down (port 54399 unused)
    await testDependencyOutage(
      'api',
      {
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54399/shipde_dev?connect_timeout=1',
      },
      'database',
      3011
    );

    // 8.5.2 API with Redis Down (port 63799 unused)
    await testDependencyOutage('api', { REDIS_PORT: '63799' }, 'redis', 3012);

    // 8.5.3 API with MinIO/Storage Down (port 9999 unused)
    await testDependencyOutage('api', { S3_ENDPOINT: 'http://127.0.0.1:9999' }, 'storage', 3013);

    // 8.5.4 Worker with PostgreSQL Down
    await testDependencyOutage(
      'worker',
      {
        DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54399/shipde_dev?connect_timeout=1',
      },
      'database',
      3014
    );

    // 8.5.5 Worker with Redis Down
    await testDependencyOutage('worker', { REDIS_PORT: '63799' }, 'redis', 3015);

    // 8.5.6 Worker with MinIO/Storage Down
    await testDependencyOutage('worker', { S3_ENDPOINT: 'http://127.0.0.1:9999' }, 'storage', 3016);

    // 8.5.7 API with Slow/Blackholed PostgreSQL Connection (RFC 5737 TEST-NET-1)
    await testDependencyOutage(
      'api',
      {
        DATABASE_URL: 'postgresql://postgres:postgres@192.0.2.1:5433/shipde_dev?connect_timeout=2',
      },
      'database',
      3017
    );

    // 8.5.8 Worker with Slow/Blackholed PostgreSQL Connection (RFC 5737 TEST-NET-1)
    await testDependencyOutage(
      'worker',
      {
        DATABASE_URL: 'postgresql://postgres:postgres@192.0.2.1:5433/shipde_dev?connect_timeout=2',
      },
      'database',
      3018
    );

    // 8.6 Live Dependency Restoration Without Process Restart (AC-FOUND-03-06, Finding 11)
    console.log(
      '8.6 Testing live dependency restoration without process restart on primary services...'
    );

    // Test 8.6.1: Live Redis outage and recovery on the same running processes
    try {
      console.log('Pausing Redis container (shipde-redis)...');
      execSync('docker pause shipde-redis', { stdio: 'ignore' });
      const redisOutageStart = Date.now();
      let apiRedisDown = false;
      let workerRedisDown = false;
      while (Date.now() - redisOutageStart < 12000) {
        try {
          const aRes = await fetch(`http://localhost:${API_PORT}/health/ready`);
          const aJson: any = await aRes.json();
          if (aRes.status === 503 && aJson.checks?.redis === 'down') apiRedisDown = true;

          const wRes = await fetch(`http://localhost:${WORKER_PORT}/health/ready`);
          const wJson: any = await wRes.json();
          if (wRes.status === 503 && wJson.checks?.redis === 'down') workerRedisDown = true;

          if (apiRedisDown && workerRedisDown) break;
        } catch {
          // retry
        }
        await sleep(300);
      }
      if (!apiRedisDown || !workerRedisDown) {
        throw new Error(
          `Live API/Worker failed to detect Redis outage: apiDown=${apiRedisDown}, workerDown=${workerRedisDown}`
        );
      }
      console.log(
        '✅ Live API and Worker reported 503 error with redis: down without process restart'
      );
    } finally {
      execSync('docker unpause shipde-redis', { stdio: 'ignore' });
    }

    // Verify recovery without restarting API or Worker
    const redisRecoverStart = Date.now();
    let redisRecovered = false;
    while (Date.now() - redisRecoverStart < 15000) {
      try {
        const aRes = await fetch(`http://localhost:${API_PORT}/health/ready`);
        const wRes = await fetch(`http://localhost:${WORKER_PORT}/health/ready`);
        const aJson: any = await aRes.json();
        const wJson: any = await wRes.json();
        if (
          aRes.status === 200 &&
          aJson.checks?.redis === 'up' &&
          wRes.status === 200 &&
          wJson.checks?.redis === 'up'
        ) {
          redisRecovered = true;
          break;
        }
      } catch {
        // retry
      }
      await sleep(500);
    }
    if (!redisRecovered) {
      throw new Error(
        'Live API and Worker failed to recover readiness after Redis restoration without restart'
      );
    }
    console.log(
      '✅ Redis restoration verified: same live API and Worker returned to 200 OK without restart'
    );

    // Test 8.6.2: Live MinIO outage and recovery on the same running processes
    try {
      console.log('Pausing MinIO container (shipde-minio)...');
      execSync('docker pause shipde-minio', { stdio: 'ignore' });
      const minioOutageStart = Date.now();
      let apiMinioDown = false;
      let workerMinioDown = false;
      while (Date.now() - minioOutageStart < 12000) {
        try {
          const aRes = await fetch(`http://localhost:${API_PORT}/health/ready`);
          const aJson: any = await aRes.json();
          if (aRes.status === 503 && aJson.checks?.storage === 'down') apiMinioDown = true;

          const wRes = await fetch(`http://localhost:${WORKER_PORT}/health/ready`);
          const wJson: any = await wRes.json();
          if (wRes.status === 503 && wJson.checks?.storage === 'down') workerMinioDown = true;

          if (apiMinioDown && workerMinioDown) break;
        } catch {
          // retry
        }
        await sleep(300);
      }
      if (!apiMinioDown || !workerMinioDown) {
        throw new Error(
          `Live API/Worker failed to detect MinIO outage: apiDown=${apiMinioDown}, workerDown=${workerMinioDown}`
        );
      }
      console.log(
        '✅ Live API and Worker reported 503 error with storage: down without process restart'
      );
    } finally {
      execSync('docker unpause shipde-minio', { stdio: 'ignore' });
    }

    // Verify MinIO recovery without restarting API or Worker
    const minioRecoverStart = Date.now();
    let minioRecovered = false;
    while (Date.now() - minioRecoverStart < 15000) {
      try {
        const aRes = await fetch(`http://localhost:${API_PORT}/health/ready`);
        const wRes = await fetch(`http://localhost:${WORKER_PORT}/health/ready`);
        const aJson: any = await aRes.json();
        const wJson: any = await wRes.json();
        if (
          aRes.status === 200 &&
          aJson.checks?.storage === 'up' &&
          wRes.status === 200 &&
          wJson.checks?.storage === 'up'
        ) {
          minioRecovered = true;
          break;
        }
      } catch {
        // retry
      }
      await sleep(500);
    }
    if (!minioRecovered) {
      throw new Error(
        'Live API and Worker failed to recover readiness after MinIO restoration without restart'
      );
    }
    console.log(
      '✅ MinIO restoration verified: same live API and Worker returned to 200 OK without restart'
    );

    // 9. End-to-End Durable Outbox Dispatch to BullMQ and Worker Execution
    console.log('9. Testing durable Outbox -> BullMQ -> SmokeWorker end-to-end flow...');
    const smokeId = `smoke_e2e_${Date.now()}`;
    const correlationId = `corr_e2e_${Date.now()}`;
    const idempotencyKey = `idemp_e2e_${Date.now()}`;

    // Create OutboxEvent in database (simulates API committing business work + outbox atomically)
    const outboxRecord = await prisma.outboxEvent.create({
      data: {
        event_type: QUEUE_SMOKE_EVENT_TYPE,
        payload: {
          smokeId,
          message: 'End-to-end queue smoke event',
          timestamp: new Date().toISOString(),
        },
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
        status: 'PENDING',
      },
    });
    console.log(`Created test outbox event ${outboxRecord.id} with status PENDING`);

    // The Worker background OutboxDispatcher polls every 1s and dispatches to BullMQ;
    // SmokeWorker processes the job and transitions the event to PUBLISHED.
    console.log('Waiting for Worker OutboxDispatcher and SmokeWorker to process the event...');
    let isPublished = false;
    const pollStart = Date.now();
    while (Date.now() - pollStart < 15000) {
      const current = await prisma.outboxEvent.findUnique({
        where: { id: outboxRecord.id },
      });
      if (current && current.status === 'PUBLISHED') {
        isPublished = true;
        if (!current.published_at) {
          throw new Error('Outbox event marked PUBLISHED but published_at is missing');
        }
        break;
      }
      await sleep(500);
    }

    if (!isPublished) {
      throw new Error(
        `Outbox event ${outboxRecord.id} failed to transition to PUBLISHED within 15s`
      );
    }
    console.log(
      `✅ Outbox event ${outboxRecord.id} transitioned to PUBLISHED with published_at timestamp`
    );

    // 10. Verify Structured Log Parsing, Correlation, and Redaction (Finding 12)
    console.log(
      '10. Verifying structured JSON logs for API and Worker (schema, correlation, redaction)...'
    );
    const apiRecords = validateAndParseStructuredLogs(apiRawLogs, 'api');
    const workerRecords = validateAndParseStructuredLogs(workerRawLogs, 'worker');

    if (apiRecords.length === 0) {
      throw new Error('No structured JSON logs captured for API service');
    }
    if (workerRecords.length === 0) {
      throw new Error('No structured JSON logs captured for Worker service');
    }

    // Verify correlation ID propagation in Worker logs
    const matchingWorkerRecord = workerRecords.find(
      (r) =>
        r.correlationId === correlationId &&
        typeof r.message === 'string' &&
        r.message.includes('Successfully executed deterministic smoke effect')
    );
    if (!matchingWorkerRecord) {
      throw new Error(
        `Worker structured logs did not capture correlation ID propagation: expected correlationId ${correlationId}`
      );
    }
    console.log(
      `✅ Worker structured log confirmed correlation ID ${correlationId} propagation: ${JSON.stringify(matchingWorkerRecord)}`
    );
    console.log(
      `✅ Log inspection complete: verified ${apiRecords.length} API and ${workerRecords.length} Worker records without leaks or format errors`
    );

    // Clean up test record
    await prisma.outboxEvent.delete({ where: { id: outboxRecord.id } });

    console.log('====================================================');
    console.log('🎉 All foundation integration tests passed successfully!');
    console.log('====================================================');
  } finally {
    console.log('Cleaning up integration test processes...');
    if (apiProc) {
      await stopProcess(apiProc);
    }
    if (workerProc) {
      await stopProcess(workerProc);
    }
    await prisma.$disconnect();
    console.log('Cleanup complete.');
  }
}

main().catch((err) => {
  console.error('❌ Integration test suite failed:', err);
  process.exit(1);
});
