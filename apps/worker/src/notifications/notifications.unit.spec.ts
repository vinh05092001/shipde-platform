import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  NOTIFICATION_EVENT,
  buildNotificationOutboxKey,
  buildProviderSubmissionId,
} from '@shipde/contracts';
import { AppConfig } from '@shipde/config';
import { NotificationEmailTransport } from './notification-email.transport';
import { OutboxDispatcher } from '../dispatcher/outbox.dispatcher';
import { OutboxStatusEnum } from '@prisma/client';

/**
 * FEAT-COM-09 Slice A — Worker Unit Tests (runs under Turbo strict `pnpm test`, zero external DB/Redis).
 */
describe('FEAT-COM-09 Worker Unit Suite', () => {
  const baseConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3098,
    WORKER_HEALTH_PORT: 3099,
    DATABASE_URL: 'postgresql://unused:unused@localhost:5433/unused',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: 6379,
    S3_ENDPOINT: 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test-access',
    S3_SECRET_KEY: 'test-secret',
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
  };

  it('D5: NotificationEmailTransport returns truthful NOT_CONFIGURED when unconfigured', async () => {
    const transport = new NotificationEmailTransport(baseConfig);
    const res = await transport.send({
      to: 'owner@shipde.vn',
      subject: 'Security alert',
      body: 'Safe body',
      submissionId: buildProviderSubmissionId('notif-1', 1),
      correlationId: 'corr-unit-1',
    });
    assert.equal(res.outcome, 'NOT_CONFIGURED');
    assert.equal(res.providerMessageId, null);
  });

  it('D6: OutboxDispatcher.dispatchPendingNotifications builds deterministic colon-free BullMQ jobId', async () => {
    const outboxId = '11111111-1111-4111-8111-111111111111';
    const colonKey = buildNotificationOutboxKey({
      merchantId: '22222222-2222-4222-8222-222222222222',
      eventType: 'EVT-COM-09-01',
      sourceFingerprint: 'u1:invite_sent:inv1',
    });
    assert.ok(colonKey.includes(':'));

    const mockPrisma: any = {
      outboxEvent: {
        findMany: async () => [
          {
            id: outboxId,
            event_type: NOTIFICATION_EVENT,
            payload: { schema_version: 1, event: 'EVT-COM-09-01' },
            correlation_id: 'corr-unit-2',
            idempotency_key: colonKey,
            attempts: 2,
            status: OutboxStatusEnum.PENDING,
          },
        ],
        updateMany: async () => ({ count: 1 }),
      },
    };
    const captured: Array<{ data: any; opts: any }> = [];
    const dispatcher = new OutboxDispatcher(baseConfig, mockPrisma);
    (dispatcher as any).notificationQueue = {
      add: async (_name: string, data: any, opts: any) => {
        captured.push({ data, opts });
      },
    };

    const res = await dispatcher.dispatchPendingNotifications(10);
    assert.equal(res.dispatched, 1);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].opts.jobId, `notif-${outboxId}-del-2`);
    assert.equal(captured[0].opts.jobId.includes(':'), false);
    assert.equal(captured[0].data.attempt, 2);
    assert.equal(captured[0].data.idempotencyKey, colonKey);
  });
});
