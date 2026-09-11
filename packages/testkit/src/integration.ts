/**
 * End-to-end Integration Test Runner for Ship Dễ Foundation (TASK-FOUND-03)
 *
 * Verifies:
 * - Local Docker infrastructure connectivity (PostgreSQL, Redis, MinIO)
 * - API & Worker independent startup, liveness and readiness HTTP probes
 * - Correlation ID header propagation across services
 * - Durable outbox insert within transaction -> BullMQ dispatch -> Smoke worker processing -> Published state
 * - Clean shutdown of background child processes
 */
import { spawn, ChildProcess, execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
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
const CARRIER_MODE = process.env.CARRIER_MODE || 'mock';

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
    // 1. Verify Database Connectivity
    console.log('1. Verifying database connection on port 5433...');
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1 as result`;
    console.log('✅ PostgreSQL connection verified');

    const apiEntry = path.join(ROOT_DIR, 'apps/api/dist/main.js');
    const workerEntry = path.join(ROOT_DIR, 'apps/worker/dist/main.js');

    // Build prerequisites if missing (Finding 6)
    if (!fs.existsSync(apiEntry) || !fs.existsSync(workerEntry)) {
      console.log('Build artifacts missing. Compiling API and Worker services...');
      execSync('pnpm --filter @shipde/api --filter @shipde/worker build', {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    }

    // 2. Start API Service
    console.log(`2. Spawning API service on port ${API_PORT}...`);
    apiProc = spawn(process.execPath, [apiEntry], {
      cwd: path.join(ROOT_DIR, 'apps/api'),
      env: childEnv,
      stdio: 'inherit',
    });

    // 3. Start Worker Service (capturing stdout/stderr for correlation log assertions - Finding 7)
    console.log(`3. Spawning Worker service on health port ${WORKER_PORT}...`);
    const workerLogs: string[] = [];
    workerProc = spawn(process.execPath, [workerEntry], {
      cwd: path.join(ROOT_DIR, 'apps/worker'),
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    workerProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerLogs.push(text);
      process.stdout.write(text);
    });

    workerProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      workerLogs.push(text);
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

    // 10. Verify correlation ID propagation in Worker structured logs (AC-FOUND-03-09, AC-FOUND-03-11, Finding 7)
    console.log('10. Verifying Worker structured logs for correlation ID propagation...');
    const hasCorrelationLog = workerLogs.some(
      (log) =>
        log.includes(correlationId) &&
        log.includes('Successfully executed deterministic smoke effect for job')
    );
    if (!hasCorrelationLog) {
      throw new Error(
        `Worker structured logs did not capture correlation ID propagation: expected correlationId ${correlationId}`
      );
    }
    console.log(`✅ Worker structured log confirmed correlation ID ${correlationId} propagation`);

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
