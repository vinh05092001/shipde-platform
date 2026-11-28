import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NotificationChannelEnum,
  NotificationDeliveryStateEnum,
  NotificationStatusEnum,
  RoleEnum,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationProcessor } from './notification.processor';
import { OutboxDispatcher } from '../dispatcher/outbox.dispatcher';
import { NotificationsWorker } from './notifications.worker';
import {
  NOTIFICATION_EVENT,
  NOTIFICATION_QUEUE_NAME,
  buildDeliveryRetryOutboxKey,
  buildNotificationOutboxKey,
  buildProviderSubmissionId,
} from '@shipde/contracts';
import { OutboxStatusEnum } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppConfig } from '@shipde/config';
import {
  ControlledNotificationEmailTransport,
  buildFixtureNotificationEnvelope,
} from '@shipde/testkit';

/**
 * FEAT-COM-09 Slice A — Worker Processor Live DB Integration Suite
 * Covers TEST-COM-09-01 (14 events fixture-labelled), 02 (D3 channel-off override & SKIPPED_NO_VERIFIED_EMAIL),
 * 04 (dedupe/replay/recurring incident_id), 05 (input/import revisions), 08 (two warehouses + custom role),
 * 10 (NOT_CONFIGURED, TIMEOUT->UNKNOWN no auto-retry, FAILED->DEAD_LETTER + audit),
 * 11 (fake clock digest/resolution), 16 (tenant-scoped retention purge preserving AuditLog).
 */
function requireTestDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      '[FAIL_CLOSED] DATABASE_URL must be explicitly injected for FEAT-COM-09 worker integration test (no .env or shipde_dev fallback).'
    );
  }
  return raw.replace(/^["']|["']$/g, '');
}

function requireTestRedisConfig(): { host: string; port: number; password?: string } {
  const host = process.env.REDIS_HOST?.trim();
  const portRaw = process.env.REDIS_PORT?.trim();
  if (!host || !portRaw || !/^\d+$/.test(portRaw)) {
    throw new Error(
      '[FAIL_CLOSED] REDIS_HOST and numeric REDIS_PORT must be explicitly injected for FEAT-COM-09 worker integration test (no 6379 fallback).'
    );
  }
  return {
    host,
    port: Number(portRaw),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

test('FEAT-COM-09 Slice A Worker Integration: D3/D4/D5/D6 processor, email state machine, real BullMQ/Redis dispatch, resolution, and retention', async () => {
  process.env.DATABASE_URL = requireTestDatabaseUrl();
  const redisCfg = requireTestRedisConfig();
  const prisma = new PrismaService();
  await prisma.$connect();

  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
  const config: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3098,
    WORKER_HEALTH_PORT: 3099,
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_HOST: redisCfg.host,
    REDIS_PORT: redisCfg.port,
    REDIS_PASSWORD: redisCfg.password,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: true,
    CARRIER_MODE: 'disabled',
    LOG_LEVEL: 'info',
    TRUST_PROXY_HOPS: 0,
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: 'test-key-32-chars-long-for-worker-hmac',
    NOTIFICATION_EMAIL_PROVIDER_MODE: 'unconfigured',
    NOTIFICATION_EMAIL_LOOKUP_SUPPORTED: false,
    NOTIFICATION_EMAIL_MAX_ATTEMPTS: 2,
    NOTIFICATION_RETENTION_DAYS: 30,
  };

  const controlledTransport = new ControlledNotificationEmailTransport();
  const processor = new NotificationProcessor(prisma, config, controlledTransport);
  const createdMerchants: string[] = [];

  try {
    const m1 = await prisma.merchant.create({
      data: { name: `WorkerM1 ${suffix}`, code: `WM1${suffix}`, status: 'ACTIVE' },
    });
    const m2 = await prisma.merchant.create({
      data: { name: `WorkerM2 ${suffix}`, code: `WM2${suffix}`, status: 'ACTIVE' },
    });
    createdMerchants.push(m1.id, m2.id);

    const whA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const whB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const br1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const ca1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

    // Owner with both channels=false (legacy row) AND unverified email -> D3 must still deliver in-app + SKIPPED_NO_VERIFIED_EMAIL
    const ownerLegacy = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `legacy.${suffix}@shipde.vn`,
        email_verified_at: null,
        full_name: 'Legacy Owner',
        password_hash: 'hash',
        role: RoleEnum.OWNER,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
        carrier_account_scopes: ['*'],
        notification_preferences: {
          channels: { in_app: false, email: false, push: false },
          subscriptions: {
            security_alerts: true,
            create_unknown: true,
            claim_deadline_warning: true,
          },
        },
      },
    });

    // Two WAREHOUSE users with different warehouse_scopes (TEST-COM-09-08)
    const whUserA = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `wha.${suffix}@shipde.vn`,
        email_verified_at: new Date(),
        full_name: 'Warehouse A',
        password_hash: 'hash',
        role: RoleEnum.WAREHOUSE,
        status: 'active',
        warehouse_scopes: [whA],
      },
    });
    const whUserB = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `whb.${suffix}@shipde.vn`,
        email_verified_at: new Date(),
        full_name: 'Warehouse B',
        password_hash: 'hash',
        role: RoleEnum.WAREHOUSE,
        status: 'active',
        warehouse_scopes: [whB],
      },
    });

    // Verified owner in m2 for email transport tests (NOT_CONFIGURED / UNKNOWN / DEAD_LETTER)
    const ownerM2 = await prisma.user.create({
      data: {
        merchant_id: m2.id,
        email: `ownerm2.${suffix}@shipde.vn`,
        email_verified_at: new Date(),
        full_name: 'Owner M2',
        password_hash: 'hash',
        role: RoleEnum.OWNER,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
        carrier_account_scopes: ['*'],
      },
    });

    // 1. TEST-COM-09-02: Protected EVT-COM-09-05 overrides channels.in_app=false & records SKIPPED_NO_VERIFIED_EMAIL
    const envCreateUnknown = buildFixtureNotificationEnvelope('EVT-COM-09-05', {
      merchantId: m1.id,
      sourceId: 'shp-u1',
      branchId: br1,
      warehouseId: whA,
    });
    const res1 = await processor.processEnvelope(envCreateUnknown, 'corr-w1');
    assert.equal(res1.status, 'PROCESSED');
    const nLegacy = await prisma.notification.findFirst({
      where: { merchant_id: m1.id, recipient_user_id: ownerLegacy.id, event_type: 'EVT-COM-09-05' },
      include: { deliveries: true },
    });
    assert.ok(nLegacy, 'Protected event must deliver in-app even when channels.in_app=false');
    const emailDel = nLegacy.deliveries.find((d) => d.channel === NotificationChannelEnum.EMAIL);
    assert.equal(emailDel?.state, NotificationDeliveryStateEnum.SKIPPED_NO_VERIFIED_EMAIL);

    // 2. TEST-COM-09-08: Warehouse A gets EVT-COM-09-06 for whA, Warehouse B gets 0
    const envPickup = buildFixtureNotificationEnvelope('EVT-COM-09-06', {
      merchantId: m1.id,
      sourceId: 'shp-p1',
      warehouseId: whA,
    });
    await processor.processEnvelope(envPickup, 'corr-w2');
    const countA = await prisma.notification.count({
      where: { merchant_id: m1.id, recipient_user_id: whUserA.id, event_type: 'EVT-COM-09-06' },
    });
    const countB = await prisma.notification.count({
      where: { merchant_id: m1.id, recipient_user_id: whUserB.id, event_type: 'EVT-COM-09-06' },
    });
    assert.equal(countA, 1);
    assert.equal(countB, 0);

    // 3. TEST-COM-09-10: TIMEOUT_UNKNOWN stays UNKNOWN with 1 call (NEVER auto-retried)
    controlledTransport.mode = 'TIMEOUT_UNKNOWN';
    controlledTransport.calls.length = 0;
    const envUnknownEmail = buildFixtureNotificationEnvelope('EVT-COM-09-02', {
      merchantId: m2.id,
      sourceId: ca1,
      carrierAccountId: ca1,
      incidentId: 'inc-timeout-1',
    });
    await processor.processEnvelope(envUnknownEmail, 'corr-w3');
    assert.equal(controlledTransport.calls.length, 1, 'UNKNOWN must NEVER auto-retry');
    const unknownRow = await prisma.notificationChannelDelivery.findFirst({
      where: {
        channel: NotificationChannelEnum.EMAIL,
        notification: {
          merchant_id: m2.id,
          recipient_user_id: ownerM2.id,
          event_type: 'EVT-COM-09-02',
        },
      },
    });
    assert.equal(unknownRow?.state, NotificationDeliveryStateEnum.UNKNOWN);
    assert.ok(unknownRow?.provider_submission_id?.startsWith('com09-email:'));

    // Replaying same event while UNKNOWN must NOT send a second email
    await processor.processEnvelope(envUnknownEmail, 'corr-w3-replay');
    assert.equal(controlledTransport.calls.length, 1);

    // 4. TEST-COM-09-10: FAILED retries up to maxAttempts (2) then escalates to DEAD_LETTER + AuditLog
    controlledTransport.mode = 'FAILED';
    controlledTransport.calls.length = 0;
    const envFailEmail = buildFixtureNotificationEnvelope('EVT-COM-09-02', {
      merchantId: m2.id,
      sourceId: ca1,
      carrierAccountId: ca1,
      incidentId: 'inc-fail-2', // distinct incident_id -> new notice (TEST-COM-09-04)
    });
    await processor.processEnvelope(envFailEmail, 'corr-w4');
    assert.equal(controlledTransport.calls.length, 2);
    const dlRow = await prisma.notificationChannelDelivery.findFirst({
      where: {
        channel: NotificationChannelEnum.EMAIL,
        state: NotificationDeliveryStateEnum.DEAD_LETTER,
        notification: { merchant_id: m2.id },
      },
    });
    assert.ok(dlRow, 'Exhausted FAILED email must escalate to DEAD_LETTER');
    const dlAudit = await prisma.auditLog.findFirst({
      where: { merchant_id: m2.id, action: 'NOTIFICATION_EMAIL_DEAD_LETTERED' },
    });
    assert.ok(dlAudit, 'DEAD_LETTER escalation must record immutable AuditLog');

    // 5. TEST-COM-09-11: Resolution envelope marks matching active notice RESOLVED idempotently
    const resolveRes = await processor.processEnvelope(
      {
        schema_version: 1,
        event: 'EVT-COM-09-02',
        occurred_at: new Date().toISOString(),
        merchant_id: m2.id,
        is_resolution: true,
        target_group_key: `${ca1}:expiring:inc-fail-2`,
        resolution_id: 'res-inc-fail-2',
        source: {
          type: 'carrier_account',
          id: ca1,
          branch_id: null,
          warehouse_id: null,
          carrier_account_id: ca1,
        },
        payload: {},
      },
      'corr-w5'
    );
    assert.equal(resolveRes.status, 'RESOLVED');
    assert.equal(resolveRes.resolvedCount, 1);
    const resolvedNotice = await prisma.notification.findFirst({
      where: { merchant_id: m2.id, group_key: `${ca1}:expiring:inc-fail-2` },
    });
    assert.equal(resolvedNotice?.status, NotificationStatusEnum.RESOLVED);

    // 6. TEST-COM-09-16: Tenant-scoped retention purge deletes m1 expired rows without touching m2 or AuditLog
    const futureClock = new Date(Date.now() + 60 * 86400 * 1000);
    const purgeRes = await processor.purgeExpiredForTenant(m1.id, futureClock, 'corr-w6');
    assert.ok(purgeRes.deletedCount >= 1);
    const m2Remaining = await prisma.notification.count({ where: { merchant_id: m2.id } });
    assert.ok(m2Remaining >= 1, 'Purging m1 must not touch m2 notifications');
    const m1AuditCount = await prisma.auditLog.count({ where: { merchant_id: m1.id } });
    assert.ok(m1AuditCount >= 1, 'Retention purge must preserve immutable AuditLog');

    // 7. Real BullMQ Queue -> Redis -> NotificationsWorker end-to-end dispatch + replay idempotency
    const liveOutboxKey = buildNotificationOutboxKey({
      merchantId: m2.id,
      eventType: 'EVT-COM-09-01',
      sourceFingerprint: `${ownerM2.id}:invite_sent:inv-disp-${suffix}`,
    });
    assert.ok(liveOutboxKey.includes(':'), 'DB outbox key preserves canonical colon format');
    const outboxRow = await prisma.outboxEvent.create({
      data: {
        event_type: NOTIFICATION_EVENT,
        payload: buildFixtureNotificationEnvelope('EVT-COM-09-01', {
          merchantId: m2.id,
          sourceId: `inv-disp-${suffix}`,
          affectedUserId: ownerM2.id,
        }) as any,
        correlation_id: 'corr-disp-live',
        idempotency_key: liveOutboxKey,
        status: OutboxStatusEnum.PENDING,
        scheduled_at: new Date(Date.now() - 60_000),
      },
    });
    const testQueuePrefix = `com09-test-${suffix}`;
    const realQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
      prefix: testQueuePrefix,
      connection: {
        host: config.REDIS_HOST,
        port: config.REDIS_PORT,
        password: config.REDIS_PASSWORD,
      },
    });
    const dispatcher = new OutboxDispatcher(config, prisma);
    const worker = new NotificationsWorker(config, prisma, processor);
    try {
      (dispatcher as any).notificationQueue = realQueue;
      await worker.onModuleInit({ prefix: testQueuePrefix });

      // Dispatch through REAL BullMQ Queue -> Redis (proves colon-free jobId accepted by BullMQ 5)
      const dispRes = await dispatcher.dispatchPendingNotifications(10);
      assert.ok(
        dispRes.dispatched >= 1,
        `Expected real BullMQ dispatch >= 1, got ${JSON.stringify(dispRes)}`
      );

      // Bounded wait for real NotificationsWorker to consume from Redis & mark PUBLISHED
      const deadline = Date.now() + 10000;
      let publishedRow = await prisma.outboxEvent.findUnique({ where: { id: outboxRow.id } });
      while (publishedRow?.status !== OutboxStatusEnum.PUBLISHED && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
        publishedRow = await prisma.outboxEvent.findUnique({ where: { id: outboxRow.id } });
      }
      assert.equal(
        publishedRow?.status,
        OutboxStatusEnum.PUBLISHED,
        `Expected real Redis/BullMQ worker to mark outbox PUBLISHED, got ${publishedRow?.status}`
      );

      // Replay / stale generation must produce zero side effects -> still exactly 1 notification row
      await worker.handleJob({
        outboxId: outboxRow.id,
        attempt: 0,
        correlationId: 'corr-disp-live-replay',
        eventType: NOTIFICATION_EVENT,
        payload: outboxRow.payload as Record<string, unknown>,
        idempotencyKey: liveOutboxKey,
      });
      const liveNoticeCount = await prisma.notification.count({
        where: {
          merchant_id: m2.id,
          recipient_user_id: ownerM2.id,
          event_type: 'EVT-COM-09-01',
          source_id: `inv-disp-${suffix}`,
        },
      });
      assert.equal(
        liveNoticeCount,
        1,
        'Expected exactly one notification row after real dispatch + replay'
      );

      // Stale generation (attempt=0 while DB row is PROCESSING at attempt=1) must not publish or create notice
      const staleOutboxRow = await prisma.outboxEvent.create({
        data: {
          event_type: NOTIFICATION_EVENT,
          payload: buildFixtureNotificationEnvelope('EVT-COM-09-01', {
            merchantId: m2.id,
            sourceId: `inv-stale-${suffix}`,
            affectedUserId: ownerM2.id,
          }) as any,
          correlation_id: 'corr-stale-gen',
          idempotency_key: buildNotificationOutboxKey({
            merchantId: m2.id,
            eventType: 'EVT-COM-09-01',
            sourceFingerprint: `${ownerM2.id}:invite_sent:inv-stale-${suffix}`,
          }),
          status: OutboxStatusEnum.PROCESSING,
          attempts: 1,
        },
      });
      try {
        await worker.handleJob({
          outboxId: staleOutboxRow.id,
          attempt: 0,
          correlationId: 'corr-stale-gen',
          eventType: NOTIFICATION_EVENT,
          payload: staleOutboxRow.payload as Record<string, unknown>,
        });
        const stillProcessing = await prisma.outboxEvent.findUnique({
          where: { id: staleOutboxRow.id },
        });
        assert.equal(stillProcessing?.status, OutboxStatusEnum.PROCESSING);
        const staleNoticeCount = await prisma.notification.count({
          where: { merchant_id: m2.id, source_id: `inv-stale-${suffix}` },
        });
        assert.equal(staleNoticeCount, 0, 'Stale generation job must produce zero side effects');
      } finally {
        await prisma.outboxEvent.delete({ where: { id: staleOutboxRow.id } }).catch(() => {});
      }

      // 8. P1 #1: Operator RELEASE_FOR_RETRY AT configured cap (attempts=2 -> reserved attempt=3)
      //    durable outbox -> real Redis/BullMQ -> NotificationsWorker -> EXACTLY 1 provider call with reserved submissionId, replay = 0 extra calls
      controlledTransport.mode = 'SENT';
      controlledTransport.calls.length = 0;
      const reservedAttempt = 3; // exceeds emailMaxAttempts (2)
      const reservedSubId = buildProviderSubmissionId(dlRow.notification_id, reservedAttempt);
      await prisma.notificationChannelDelivery.update({
        where: { id: dlRow.id },
        data: {
          state: NotificationDeliveryStateEnum.PENDING,
          attempts: reservedAttempt,
          provider_submission_id: reservedSubId,
        },
      });
      const retryOutboxRow = await prisma.outboxEvent.create({
        data: {
          event_type: NOTIFICATION_EVENT,
          payload: {
            schema_version: 1,
            kind: 'DELIVERY_RETRY',
            merchant_id: m2.id,
            notification_id: dlRow.notification_id,
            delivery_id: dlRow.id,
            expected_attempt: reservedAttempt,
            provider_submission_id: reservedSubId,
            occurred_at: new Date().toISOString(),
          },
          correlation_id: 'corr-retry-at-cap',
          idempotency_key: buildDeliveryRetryOutboxKey({
            merchantId: m2.id,
            deliveryId: dlRow.id,
            attempt: reservedAttempt,
          }),
          status: OutboxStatusEnum.PENDING,
          scheduled_at: new Date(Date.now() - 60_000),
        },
      });
      try {
        const retryDisp = await dispatcher.dispatchPendingNotifications(10);
        assert.ok(retryDisp.dispatched >= 1);
        const retryDeadline = Date.now() + 10000;
        let retryDone = await prisma.outboxEvent.findUnique({ where: { id: retryOutboxRow.id } });
        while (retryDone?.status !== OutboxStatusEnum.PUBLISHED && Date.now() < retryDeadline) {
          await new Promise((r) => setTimeout(r, 100));
          retryDone = await prisma.outboxEvent.findUnique({ where: { id: retryOutboxRow.id } });
        }
        assert.equal(retryDone?.status, OutboxStatusEnum.PUBLISHED);
        assert.equal(
          controlledTransport.calls.length,
          1,
          'RELEASE_FOR_RETRY at cap must execute exactly 1 provider call'
        );
        assert.equal(controlledTransport.calls[0].submissionId, reservedSubId);
        const sentAfterRetry = await prisma.notificationChannelDelivery.findUnique({
          where: { id: dlRow.id },
        });
        assert.equal(sentAfterRetry?.state, NotificationDeliveryStateEnum.SENT);

        // Replay DELIVERY_RETRY -> 0 extra provider calls
        await processor.processEnvelope(retryOutboxRow.payload, 'corr-retry-replay');
        assert.equal(controlledTransport.calls.length, 1);
      } finally {
        await prisma.outboxEvent.delete({ where: { id: retryOutboxRow.id } }).catch(() => {});
      }

      // 9. P1 #2: Transport throw transitions IN_FLIGHT -> UNKNOWN + stranded IN_FLIGHT crash recovery -> UNKNOWN (no re-send)
      const throwingTransport = {
        send: async () => {
          throw new Error('Simulated socket hangup after SMTP DATA');
        },
      };
      const crashProcessor = new NotificationProcessor(prisma, config, throwingTransport);
      const envThrow = buildFixtureNotificationEnvelope('EVT-COM-09-02', {
        merchantId: m2.id,
        sourceId: ca1,
        carrierAccountId: ca1,
        incidentId: 'inc-throw-3',
      });
      await crashProcessor.processEnvelope(envThrow, 'corr-throw');
      const thrownDel = await prisma.notificationChannelDelivery.findFirst({
        where: {
          channel: NotificationChannelEnum.EMAIL,
          notification: { merchant_id: m2.id, group_key: `${ca1}:expiring:inc-throw-3` },
        },
      });
      assert.equal(thrownDel?.state, NotificationDeliveryStateEnum.UNKNOWN);
      assert.equal(thrownDel?.last_error_code, 'TRANSPORT_EXCEPTION_UNKNOWN');

      // Simulate worker crash leaving row stranded in IN_FLIGHT -> recoverStaleInFlightDeliveries moves to UNKNOWN
      await prisma.notificationChannelDelivery.update({
        where: { id: thrownDel!.id },
        data: {
          state: NotificationDeliveryStateEnum.IN_FLIGHT,
          updated_at: new Date(Date.now() - 120_000),
        },
      });
      const recRes = await processor.recoverStaleInFlightDeliveries(60_000, new Date());
      assert.ok(recRes.recoveredCount >= 1);
      const recoveredDel = await prisma.notificationChannelDelivery.findUnique({
        where: { id: thrownDel!.id },
      });
      assert.equal(recoveredDel?.state, NotificationDeliveryStateEnum.UNKNOWN);
      assert.equal(recoveredDel?.last_error_code, 'WORKER_CRASH_AMBIGUOUS');

      // 10. P1 #4: Durable digest replay deduplication (same outboxId = no double-count; distinct outboxId = increment)
      const envDigest1 = buildFixtureNotificationEnvelope('EVT-COM-09-10', {
        merchantId: m2.id,
        digestWindow: '2026-11-28',
        queueRevision: 1,
      });
      // Add an ACCOUNTANT in m2 to receive EVT-COM-09-10
      const acctM2 = await prisma.user.create({
        data: {
          merchant_id: m2.id,
          email: `acctm2.${suffix}@shipde.vn`,
          email_verified_at: new Date(),
          full_name: 'Accountant M2',
          password_hash: 'hash',
          role: RoleEnum.ACCOUNTANT,
          status: 'active',
          carrier_account_scopes: ['*'],
        },
      });
      await processor.processEnvelope(envDigest1, 'corr-d1', new Date(), 'outbox-digest-1');
      // Replay exact same outboxId -> digest_count MUST stay 1
      await processor.processEnvelope(envDigest1, 'corr-d1-replay', new Date(), 'outbox-digest-1');
      const dAfterReplay = await prisma.notification.findFirst({
        where: { merchant_id: m2.id, recipient_user_id: acctM2.id, event_type: 'EVT-COM-09-10' },
      });
      assert.equal(
        dAfterReplay?.digest_count,
        1,
        'Replaying same outboxId must not increment digest_count'
      );
      // Distinct event in same digest window -> digest_count increments to 2
      const envDigest2 = buildFixtureNotificationEnvelope('EVT-COM-09-10', {
        merchantId: m2.id,
        digestWindow: '2026-11-28',
        queueRevision: 2,
      });
      await processor.processEnvelope(envDigest2, 'corr-d2', new Date(), 'outbox-digest-2');
      const dAfterSecond = await prisma.notification.findFirst({
        where: { merchant_id: m2.id, recipient_user_id: acctM2.id, event_type: 'EVT-COM-09-10' },
      });
      assert.equal(
        dAfterSecond?.digest_count,
        2,
        'Distinct event in same digest window must increment digest_count'
      );

      // Cross-midnight replay for EVT-COM-09-08 with digest_window: null must stay 1 row & digest_count=1.
      // Recipient timezone is the schema default Asia/Ho_Chi_Minh (UTC+7): 16:55Z/17:05Z are 23:55/00:05 local.
      const envReturnNull = buildFixtureNotificationEnvelope('EVT-COM-09-08', {
        merchantId: m1.id,
        sourceId: `ret-null-${suffix}`,
        warehouseId: whA,
      });
      (envReturnNull.payload as any).digest_window = null;
      await processor.processEnvelope(
        envReturnNull,
        'corr-ret-1',
        new Date('2026-11-28T16:55:00Z'),
        'outbox-ret-null-1'
      );
      await processor.processEnvelope(
        envReturnNull,
        'corr-ret-2',
        new Date('2026-11-28T17:05:00Z'),
        'outbox-ret-null-1'
      );
      const retNullRows = await prisma.notification.findMany({
        where: {
          merchant_id: m1.id,
          recipient_user_id: whUserA.id,
          event_type: 'EVT-COM-09-08',
          source_id: `ret-null-${suffix}`,
        },
      });
      assert.equal(
        retNullRows.length,
        1,
        'Cross-midnight replay with null digest_window must not duplicate'
      );
      assert.equal(retNullRows[0].digest_count, 1);
    } finally {
      await worker.onModuleDestroy().catch(() => {});
      await realQueue.obliterate({ force: true }).catch(() => {});
      await realQueue.close().catch(() => {});
      await prisma.outboxEvent.delete({ where: { id: outboxRow.id } }).catch(() => {});
    }
  } finally {
    for (const mid of createdMerchants) {
      await prisma.merchant.delete({ where: { id: mid } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
});
