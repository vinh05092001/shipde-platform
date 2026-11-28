import 'reflect-metadata';
import { createApiTestModule } from '../../test-support/test-module';
import { createHash, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';

/**
 * FEAT-COM-09 Slice A — HTTP leg of the combined D5 recovery acceptance path.
 *
 * Not a standalone suite: notifications.integration.spec.ts (apps/worker) runs this script with the
 * delivery it seeded, then feeds the outbox row this real HTTP request committed through the real
 * dispatcher, BullMQ/Redis and NotificationsWorker. It boots the real AppModule in-process, signs an
 * OWNER session for the seeded merchant, sends RELEASE_FOR_RETRY, replays the same idempotency key, and
 * prints one JSON line prefixed with RELEASE_E2E_RESULT. Input: env RELEASE_E2E_INPUT (JSON).
 */
interface ReleaseInput {
  merchantId: string;
  ownerUserId: string;
  deliveryId: string;
  expectedAttempt: number;
  expectedSubmissionId: string;
  idempotencyKey: string;
}

async function main(): Promise<void> {
  const input = JSON.parse(process.env.RELEASE_E2E_INPUT || '{}') as ReleaseInput;
  const databaseUrl = (process.env.DATABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  if (!databaseUrl || !input.deliveryId) {
    throw new Error('[FAIL_CLOSED] DATABASE_URL and RELEASE_E2E_INPUT are required');
  }
  const testConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3095,
    WORKER_HEALTH_PORT: 3094,
    DATABASE_URL: databaseUrl,
    REDIS_HOST: process.env.REDIS_HOST || 'localhost',
    REDIS_PORT: Number(process.env.REDIS_PORT || 6379),
    S3_ENDPOINT: process.env.S3_ENDPOINT || 'http://localhost:9000',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'minioadmin',
    S3_SECRET_KEY: 'minioadmin',
    S3_BUCKET: 'test-bucket',
    S3_FORCE_PATH_STYLE: true,
    CARRIER_MODE: 'disabled',
    LOG_LEVEL: 'error',
    TRUST_PROXY_HOPS: 1,
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: ['test', 'key', '32', 'chars', 'long', 'for', 'hmac'].join('-'),
  };
  const moduleFixture = await createApiTestModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(new MockVerificationDeliveryAdapter())
    .compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();
  const prisma = app.get(PrismaService);
  let sessionHash: string | null = null;
  try {
    const { token } = signAccessToken(
      {
        sub: input.ownerUserId,
        sid: randomUUID(),
        mid: input.merchantId,
        role: RoleEnum.OWNER,
        st: 'ACTIVE',
      },
      resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET),
      43200
    );
    sessionHash = createHash('sha256').update(token).digest('hex');
    await prisma.deviceSession.create({
      data: {
        user_id: input.ownerUserId,
        merchant_id: input.merchantId,
        session_token_hash: sessionHash,
        device_id: `com09_e2e_${randomUUID().slice(0, 8)}`,
        device_model: 'Supertest',
        user_agent: 'FEAT-COM-09 combined recovery path',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    const body = {
      expected_attempt: input.expectedAttempt,
      expected_provider_submission_id: input.expectedSubmissionId,
      idempotency_key: input.idempotencyKey,
      resolution: 'RELEASE_FOR_RETRY',
      provider_message_id: null,
    };
    const post = () =>
      request(app.getHttpServer())
        .post(`/api/v1/admin/notification-deliveries/${input.deliveryId}/redeliver`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    const release = await post();
    const replay = await post();
    process.stdout.write(
      'RELEASE_E2E_RESULT ' +
        JSON.stringify({
          releaseStatus: release.status,
          release: release.body?.data ?? release.body,
          replayStatus: replay.status,
          replay: replay.body?.data ?? replay.body,
        }) +
        '\n'
    );
  } finally {
    if (sessionHash) {
      await prisma.deviceSession
        .deleteMany({ where: { session_token_hash: sessionHash } })
        .catch(() => {});
    }
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`RELEASE_E2E_ERROR ${(err as Error)?.message ?? String(err)}\n`);
  process.exit(1);
});
