import 'reflect-metadata';
import { describeDatabaseTarget, createApiTestModule } from '../../test-support/test-module';
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config.token';
import { VERIFICATION_ADAPTER } from '../auth/auth.tokens';
import { AppConfig } from '@shipde/config';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import {
  NotificationChannelEnum,
  NotificationDeliveryStateEnum,
  NotificationSeverityEnum,
  NotificationStatusEnum,
  RoleEnum,
  SessionStatusEnum,
} from '@prisma/client';
import { signAccessToken, resolveAccessTokenSecret } from '../auth/token.util';
import { NOTIFICATION_EVENT, buildProviderSubmissionId } from '@shipde/contracts';

/**
 * FEAT-COM-09 — Slice A Supertest Suite
 * Covers TEST-COM-09-01 (live D1 invite producer -> outbox), 02, 06 (API read concurrency),
 * 08 (tenant/recipient/PLATFORM_ADMIN isolation), 09 (revoked session), 10 (recovery listing & redeliver 409/idempotency),
 * 13 (immutable audit & email masking), 14 (D3 preferences compatibility).
 */
async function bootTestApp() {
  const rawDbUrl = process.env.DATABASE_URL?.trim();
  if (!rawDbUrl) {
    throw new Error(
      '[FAIL_CLOSED] DATABASE_URL must be explicitly injected for FEAT-COM-09 live DB supertest (no .env or shipde_dev fallback).'
    );
  }
  const databaseUrl = rawDbUrl.replace(/^["']|["']$/g, '');
  process.env.DATABASE_URL = databaseUrl;

  const testConfig: AppConfig = {
    NODE_ENV: 'test',
    PORT: 3097,
    WORKER_HEALTH_PORT: 3096,
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
    LOG_LEVEL: 'info',
    TRUST_PROXY_HOPS: 1,
    AUTH_TOKEN_TTL_SECONDS: 43200,
    AUTH_LOGIN_OTP_ENABLED: false,
    PASSWORD_RESET_TTL_SECONDS: 3600,
    FRONTEND_URL: 'http://localhost:3000',
    AUDIT_IDENTIFIER_HMAC_KEY: ['test', 'key', '32', 'chars', 'long', 'for', 'hmac'].join('-'),
  };

  const mockDeliveryAdapter = new MockVerificationDeliveryAdapter();
  const moduleFixture: TestingModule = await createApiTestModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(testConfig)
    .overrideProvider(VERIFICATION_ADAPTER)
    .useValue(mockDeliveryAdapter)
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', 1);
  await app.init();

  const prisma = app.get(PrismaService);
  const dbStatus = await prisma.checkReadiness();
  if (dbStatus !== 'up') {
    await app.close();
    throw new Error(
      `[FAIL_CLOSED] PostgreSQL database is not reachable at ${describeDatabaseTarget(databaseUrl)}.`
    );
  }

  return { app, prisma };
}

test('FEAT-COM-09 Slice A API: list/count/read isolation, D1 live invite outbox, D3 prefs audit, D5 recovery preconditions & idempotency', async () => {
  const { app, prisma } = await bootTestApp();
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
  const createdMerchants: string[] = [];
  const createdUserIds: string[] = [];

  const makeToken = async (userId: string, merchantId: string | null, role: RoleEnum) => {
    const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
    const { token } = signAccessToken(
      {
        sub: userId,
        sid: randomUUID(),
        mid: merchantId || undefined,
        role,
        st: 'ACTIVE',
      },
      secret,
      43200
    );
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.deviceSession.create({
      data: {
        user_id: userId,
        merchant_id: merchantId,
        session_token_hash: tokenHash,
        device_id: `com09_client_${randomUUID().slice(0, 8)}`,
        device_model: 'Supertest',
        user_agent: 'FEAT-COM-09 Slice A Harness',
        status: SessionStatusEnum.ACTIVE,
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    return { token, tokenHash };
  };

  try {
    const m1 = await prisma.merchant.create({
      data: { name: `Com09 M1 ${suffix}`, code: `C09M1${suffix}`, status: 'ACTIVE' },
    });
    createdMerchants.push(m1.id);

    const m2 = await prisma.merchant.create({
      data: { name: `Com09 M2 ${suffix}`, code: `C09M2${suffix}`, status: 'ACTIVE' },
    });
    createdMerchants.push(m2.id);

    const owner1 = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `owner1.${suffix}@shipde.vn`,
        full_name: 'Owner One',
        password_hash: 'hashedpassword',
        role: RoleEnum.OWNER,
        status: 'active',
        email_verified_at: new Date(),
      },
    });
    const ops1 = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `ops1.${suffix}@shipde.vn`,
        full_name: 'Ops One',
        password_hash: 'hashedpassword',
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        email_verified_at: new Date(),
      },
    });
    const owner2 = await prisma.user.create({
      data: {
        merchant_id: m2.id,
        email: `owner2.${suffix}@shipde.vn`,
        full_name: 'Owner Two',
        password_hash: 'hashedpassword',
        role: RoleEnum.OWNER,
        status: 'active',
        email_verified_at: new Date(),
      },
    });
    const platformAdmin = await prisma.user.create({
      data: {
        merchant_id: null,
        email: `padmin.${suffix}@shipde.vn`,
        full_name: 'Platform Admin',
        password_hash: 'hashedpassword',
        role: RoleEnum.PLATFORM_ADMIN,
        status: 'active',
        email_verified_at: new Date(),
      },
    });
    createdUserIds.push(platformAdmin.id);

    const { token: owner1Token } = await makeToken(owner1.id, m1.id, RoleEnum.OWNER);
    const { token: ops1Token, tokenHash: ops1Hash } = await makeToken(
      ops1.id,
      m1.id,
      RoleEnum.OPS_CSKH
    );
    const { token: owner2Token } = await makeToken(owner2.id, m2.id, RoleEnum.OWNER);
    const { token: padminToken } = await makeToken(platformAdmin.id, null, RoleEnum.PLATFORM_ADMIN);

    // Prove real auth /api/v1/me = 200
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(meRes.status, 200);

    // Seed notifications for owner1 (critical + medium) and owner2 (other tenant)
    const retention = new Date(Date.now() + 90 * 86400 * 1000);
    const nCritical = await prisma.notification.create({
      data: {
        merchant_id: m1.id,
        recipient_user_id: owner1.id,
        event_type: 'EVT-COM-09-05',
        severity: NotificationSeverityEnum.CRITICAL,
        severity_rank: 3,
        title: 'Unknown create outcome',
        body: 'Reconcile shipment before retry',
        source_type: 'shipment',
        source_id: 'shp-1',
        group_key: 'shp-1:att-1',
        link_path: '/shipments/shp-1',
        status: NotificationStatusEnum.ACTIVE,
        retention_until: retention,
      },
    });
    const nMedium = await prisma.notification.create({
      data: {
        merchant_id: m1.id,
        recipient_user_id: owner1.id,
        event_type: 'EVT-COM-09-03',
        severity: NotificationSeverityEnum.MEDIUM,
        severity_rank: 1,
        title: 'All carriers unavailable',
        body: 'Order has no serviceable carrier',
        source_type: 'order',
        source_id: 'ord-1',
        group_key: 'ord-1:1',
        link_path: '/orders/ord-1',
        status: NotificationStatusEnum.ACTIVE,
        retention_until: retention,
      },
    });
    const nOtherTenant = await prisma.notification.create({
      data: {
        merchant_id: m2.id,
        recipient_user_id: owner2.id,
        event_type: 'EVT-COM-09-01',
        severity: NotificationSeverityEnum.HIGH,
        severity_rank: 2,
        title: 'Other tenant notice',
        body: 'Tenant 2 only',
        source_type: 'invitation',
        source_id: 'inv-other',
        group_key: 'u2:invite_sent:inv-other',
        link_path: '/settings/notifications',
        status: NotificationStatusEnum.ACTIVE,
        retention_until: retention,
      },
    });

    // 1. TEST-COM-09-02: GET /api/v1/notifications returns 200 ordered by severity_rank desc
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.data.items.length, 2);
    assert.equal(listRes.body.data.items[0].id, nCritical.id);
    assert.equal(listRes.body.data.items[1].id, nMedium.id);

    // Unread count
    const countRes = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(countRes.status, 200);
    assert.equal(countRes.body.data.unread_count, 2);

    // 2. TEST-COM-09-08: Tenant/recipient isolation + PLATFORM_ADMIN 403
    const crossRead = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${nOtherTenant.id}/read`)
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(crossRead.status, 404); // identical 404 anti-enumeration

    const otherRecipientRead = await request(app.getHttpServer())
      .post(`/api/v1/notifications/${nCritical.id}/read`)
      .set('Authorization', `Bearer ${ops1Token}`);
    assert.equal(otherRecipientRead.status, 404);

    const padminList = await request(app.getHttpServer())
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${padminToken}`);
    assert.equal(padminList.status, 403);

    // 3. TEST-COM-09-06: Concurrent idempotent read mutations preserve ACTIVE status
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/notifications/${nCritical.id}/read`)
        .set('Authorization', `Bearer ${owner1Token}`),
      request(app.getHttpServer())
        .post(`/api/v1/notifications/${nCritical.id}/read`)
        .set('Authorization', `Bearer ${owner1Token}`),
    ]);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(r1.body.data.status, 'ACTIVE'); // reading never resolves incident

    const countAfterRead = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(countAfterRead.body.data.unread_count, 1);

    // 4. TEST-COM-09-09: Revoked session denied with 401 without leakage
    await prisma.deviceSession.updateMany({
      where: { session_token_hash: ops1Hash },
      data: { status: SessionStatusEnum.REVOKED },
    });
    const revokedRes = await request(app.getHttpServer())
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', `Bearer ${ops1Token}`);
    assert.equal(revokedRes.status, 401);

    // 5. TEST-COM-09-10: Recovery listing (masked email) + redeliver preconditions (409) + idempotency
    const subId1 = buildProviderSubmissionId(nCritical.id, 1);
    const unknownDelivery = await prisma.notificationChannelDelivery.create({
      data: {
        notification_id: nCritical.id,
        channel: NotificationChannelEnum.EMAIL,
        state: NotificationDeliveryStateEnum.UNKNOWN,
        attempts: 1,
        provider_submission_id: subId1,
        last_error_code: 'PROVIDER_TIMEOUT',
        correlation_id: 'corr-com09-rec',
      },
    });

    // Other tenant OWNER sees 0 items
    const otherRecovery = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-deliveries')
      .set('Authorization', `Bearer ${owner2Token}`);
    assert.equal(otherRecovery.status, 200);
    assert.equal(otherRecovery.body.data.items.length, 0);

    // Merchant 1 OWNER sees masked email & preconditions
    const m1Recovery = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-deliveries')
      .set('Authorization', `Bearer ${owner1Token}`);
    assert.equal(m1Recovery.status, 200);
    assert.equal(m1Recovery.body.data.items.length, 1);
    assert.ok(m1Recovery.body.data.items[0].recipient_email_masked.includes('***@'));
    assert.equal(m1Recovery.body.data.items[0].provider_submission_id, subId1);

    // Stale OWNER JWT after server-side role downgrade -> 403 FORBIDDEN (D4/D5 live server role check)
    const demotedOwner = await prisma.user.create({
      data: {
        merchant_id: m1.id,
        email: `demoted.${suffix}@shipde.vn`,
        full_name: 'Demoted Owner',
        password_hash: 'hashedpassword',
        role: RoleEnum.OWNER,
        status: 'active',
        email_verified_at: new Date(),
      },
    });
    const { token: staleOwnerToken } = await makeToken(demotedOwner.id, m1.id, RoleEnum.OWNER);
    await prisma.user.update({
      where: { id: demotedOwner.id },
      data: { role: RoleEnum.WAREHOUSE },
    });
    const staleRoleRecovery = await request(app.getHttpServer())
      .get('/api/v1/admin/notification-deliveries')
      .set('Authorization', `Bearer ${staleOwnerToken}`);
    assert.equal(staleRoleRecovery.status, 403);

    const staleRoleRedeliver = await request(app.getHttpServer())
      .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
      .set('Authorization', `Bearer ${staleOwnerToken}`)
      .send({
        expected_attempt: 1,
        expected_provider_submission_id: subId1,
        idempotency_key: 'idem-stale-role-1',
        resolution: 'MARK_SENT',
        provider_message_id: 'msg-stale-role',
      });
    assert.equal(staleRoleRedeliver.status, 403);

    // Stale expected_attempt -> 409 STALE_DELIVERY_PRECONDITION
    const staleRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        expected_attempt: 99,
        expected_provider_submission_id: subId1,
        idempotency_key: 'idem-stale-1',
        resolution: 'RELEASE_FOR_RETRY',
        provider_message_id: null,
      });
    assert.equal(staleRes.status, 409);
    assert.equal(staleRes.body.error.code, 'STALE_DELIVERY_PRECONDITION');

    // Valid RELEASE_FOR_RETRY (concurrent identical pair -> BOTH 200 with same attempt=2 + durable DELIVERY_RETRY outbox row)
    const [releaseRes, concurrentReleaseRes] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
        .set('Authorization', `Bearer ${owner1Token}`)
        .send({
          expected_attempt: 1,
          expected_provider_submission_id: subId1,
          idempotency_key: 'idem-release-1',
          resolution: 'RELEASE_FOR_RETRY',
          provider_message_id: null,
        }),
      request(app.getHttpServer())
        .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
        .set('Authorization', `Bearer ${owner1Token}`)
        .send({
          expected_attempt: 1,
          expected_provider_submission_id: subId1,
          idempotency_key: 'idem-release-1',
          resolution: 'RELEASE_FOR_RETRY',
          provider_message_id: null,
        }),
    ]);
    assert.equal(releaseRes.status, 200);
    assert.equal(concurrentReleaseRes.status, 200);
    assert.equal(releaseRes.body.data.state, 'PENDING');
    assert.equal(releaseRes.body.data.attempts, 2);
    assert.equal(concurrentReleaseRes.body.data.attempts, 2);
    assert.equal(
      releaseRes.body.data.provider_submission_id,
      buildProviderSubmissionId(nCritical.id, 2)
    );
    const retryOutbox = await prisma.outboxEvent.findFirst({
      where: {
        event_type: NOTIFICATION_EVENT,
        idempotency_key: { contains: `delivery-retry:${unknownDelivery.id}:2` },
      },
    });
    assert.ok(
      retryOutbox,
      'RELEASE_FOR_RETRY must atomically enqueue durable DELIVERY_RETRY outbox row'
    );

    // Duplicate same idempotency_key + same params -> idempotent replay (does not increment attempts)
    const replayRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        expected_attempt: 1,
        expected_provider_submission_id: subId1,
        idempotency_key: 'idem-release-1',
        resolution: 'RELEASE_FOR_RETRY',
        provider_message_id: null,
      });
    assert.equal(replayRes.status, 200);
    assert.equal(replayRes.body.data.attempts, 2);

    // Same idempotency_key + conflicting params -> 409 IDEMPOTENCY_CONFLICT
    const conflictRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/notification-deliveries/${unknownDelivery.id}/redeliver`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        expected_attempt: 1,
        expected_provider_submission_id: subId1,
        idempotency_key: 'idem-release-1',
        resolution: 'MARK_SENT',
        provider_message_id: 'msg-conflict',
      });
    assert.equal(conflictRes.status, 409);
    assert.equal(conflictRes.body.error.code, 'IDEMPOTENCY_CONFLICT');

    // 6. TEST-COM-09-02 & 13: D3 protected preference rejection audited
    const rejectPrefRes = await request(app.getHttpServer())
      .patch('/api/v1/me/preferences')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        notification_preferences: {
          subscriptions: { security_alerts: false },
        },
      });
    assert.equal(rejectPrefRes.status, 400);
    const prefAudit = await prisma.auditLog.findFirst({
      where: {
        merchant_id: m1.id,
        user_id: owner1.id,
        action: 'PROTECTED_PREFERENCE_WRITE_REJECTED',
      },
    });
    assert.ok(prefAudit, 'Expected immutable AuditLog entry for protected preference rejection');

    // 7. TEST-COM-09-01: Live D1 producer (invitation sent) atomically writes NOTIFICATION_EVENT outbox row
    const inviteRes = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        email: `invited.${suffix}@shipde.vn`,
        role: RoleEnum.WAREHOUSE,
        store_scopes: [],
        warehouse_scopes: ['*'],
      });
    assert.equal(inviteRes.status, 201, JSON.stringify(inviteRes.body));
    const invitationId = inviteRes.body.data.id;
    const outboxRow = await prisma.outboxEvent.findFirst({
      where: {
        event_type: NOTIFICATION_EVENT,
        idempotency_key: { contains: invitationId },
      },
    });
    assert.ok(outboxRow, 'Expected atomic NOTIFICATION_EVENT outbox row for live invite_sent');
  } finally {
    await prisma.outboxEvent
      .deleteMany({
        where: {
          event_type: NOTIFICATION_EVENT,
          idempotency_key: { contains: createdMerchants[0] || '' },
        },
      })
      .catch(() => {});
    for (const mid of createdMerchants) {
      await prisma.merchant.delete({ where: { id: mid } }).catch(() => {});
    }
    for (const uid of createdUserIds) {
      await prisma.user.delete({ where: { id: uid } }).catch(() => {});
    }
    await app.close();
  }
});
