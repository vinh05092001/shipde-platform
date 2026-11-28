import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  ALL_NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_MATRIX_RULES,
  buildNotificationOutboxKey,
  buildNotificationResolutionOutboxKey,
  buildProviderSubmissionId,
  maskNotificationEmail,
  validateNotificationEnvelope,
} from '@shipde/contracts';
import { buildFixtureNotificationEnvelope } from '@shipde/testkit';
import { resolveNotificationDeliveryConfig, validateConfig } from '@shipde/config';

describe('FEAT-COM-09 Slice A — Notification Contracts & Rules Unit Suite', () => {
  const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

  it('TEST-COM-09-01: validates all 14 matrix event contracts & rejects unknown/missing fields', () => {
    assert.equal(ALL_NOTIFICATION_EVENT_TYPES.length, 14);
    for (const eventType of ALL_NOTIFICATION_EVENT_TYPES) {
      const env = buildFixtureNotificationEnvelope(eventType, { merchantId: MERCHANT_ID });
      const res = validateNotificationEnvelope(env);
      assert.equal(res.valid, true, `Expected ${eventType} fixture to be valid: ${res.error}`);
      assert.ok(res.sourceFingerprint, `Expected sourceFingerprint for ${eventType}`);
      assert.ok(res.groupKey, `Expected groupKey for ${eventType}`);

      // Verify matrix metadata exists for every event
      const rule = NOTIFICATION_MATRIX_RULES[eventType];
      assert.ok(rule, `Missing matrix rule for ${eventType}`);
      assert.ok(rule.defaultChannels.includes('in_app'));
    }

    // Reject unknown field in payload (D6 dead-letter rule)
    const badExtra = buildFixtureNotificationEnvelope('EVT-COM-09-01', {
      merchantId: MERCHANT_ID,
    });
    (badExtra.payload as any).injected_unknown = true;
    const badExtraRes = validateNotificationEnvelope(badExtra);
    assert.equal(badExtraRes.valid, false);

    // Reject wrong type (non-integer VND in EVT-COM-09-12)
    const badFloat = buildFixtureNotificationEnvelope('EVT-COM-09-12', {
      merchantId: MERCHANT_ID,
    });
    (badFloat.payload as any).difference_vnd = 12.5;
    assert.equal(validateNotificationEnvelope(badFloat).valid, false);
  });

  it('TEST-COM-09-04 & 05: outbox transport keys separate active, resolution, recurring incidents, and versions', () => {
    const activeKey1 = buildNotificationOutboxKey({
      merchantId: MERCHANT_ID,
      eventType: 'EVT-COM-09-02',
      sourceFingerprint: 'ca-1:expiring:inc-1',
    });
    const resolveKey1 = buildNotificationResolutionOutboxKey({
      merchantId: MERCHANT_ID,
      eventType: 'EVT-COM-09-02',
      targetGroupKey: 'ca-1:expiring:inc-1',
      resolutionId: 'res-1',
    });
    const activeKey2 = buildNotificationOutboxKey({
      merchantId: MERCHANT_ID,
      eventType: 'EVT-COM-09-02',
      sourceFingerprint: 'ca-1:expiring:inc-2',
    });
    assert.notEqual(activeKey1, resolveKey1);
    assert.notEqual(activeKey1, activeKey2);

    // Recurring daily digest windows & revisions produce distinct keys
    const digestDay1 = buildNotificationOutboxKey({
      merchantId: MERCHANT_ID,
      eventType: 'EVT-COM-09-10',
      sourceFingerprint: 'all',
      digestWindow: '2026-11-28',
      queueRevision: 1,
    });
    const digestDay2 = buildNotificationOutboxKey({
      merchantId: MERCHANT_ID,
      eventType: 'EVT-COM-09-10',
      sourceFingerprint: 'all',
      digestWindow: '2026-11-29',
      queueRevision: 1,
    });
    assert.notEqual(digestDay1, digestDay2);

    // Distinct order input revisions produce distinct group keys (AC-COM-09-05)
    const rev1 = validateNotificationEnvelope(
      buildFixtureNotificationEnvelope('EVT-COM-09-03', {
        merchantId: MERCHANT_ID,
        sourceId: 'ord-1',
        inputRevision: 1,
      })
    );
    const rev2 = validateNotificationEnvelope(
      buildFixtureNotificationEnvelope('EVT-COM-09-03', {
        merchantId: MERCHANT_ID,
        sourceId: 'ord-1',
        inputRevision: 2,
      })
    );
    assert.notEqual(rev1.groupKey, rev2.groupKey);
  });

  it('TEST-COM-09-10 & 13: provider submission id format, email masking, and config validation', () => {
    assert.equal(buildProviderSubmissionId('notif-123', 1), 'com09-email:notif-123:1');
    assert.equal(maskNotificationEmail('owner@shipde.vn'), 'ow***@shipde.vn');
    assert.equal(maskNotificationEmail(null), null);

    const cfg = validateConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/shipde_dev',
      S3_ACCESS_KEY: 'test-access-key',
      S3_SECRET_KEY: 'test-secret-key',
      NOTIFICATION_EMAIL_PROVIDER_MODE: 'unconfigured',
      NOTIFICATION_EMAIL_LOOKUP_SUPPORTED: 'false',
      NOTIFICATION_EMAIL_MAX_ATTEMPTS: '3',
    });
    const resolved = resolveNotificationDeliveryConfig(cfg);
    assert.equal(resolved.emailProviderMode, 'unconfigured');
    assert.equal(resolved.emailLookupSupported, false);
    assert.equal(resolved.emailMaxAttempts, 3);
    assert.equal(resolved.listMaxLimit, 100);
  });
});
