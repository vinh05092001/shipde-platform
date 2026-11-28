-- FEAT-COM-09: Notifications center, durable channel deliveries, redeliver idempotency,
-- and D3 protected notification preference backfill (single forward migration).

-- 1. Enums & Outbox key width alignment (D6 transport keys with 3 UUIDs / resolve / digest exceed 128 chars)
ALTER TABLE "outbox_events" ALTER COLUMN "idempotency_key" TYPE VARCHAR(512);

CREATE TYPE "NotificationSeverityEnum" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM');
CREATE TYPE "NotificationStatusEnum" AS ENUM ('ACTIVE', 'RESOLVED');
CREATE TYPE "NotificationChannelEnum" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "NotificationDeliveryStateEnum" AS ENUM (
  'PENDING',
  'IN_FLIGHT',
  'SENT',
  'FAILED',
  'UNKNOWN',
  'SKIPPED_NO_VERIFIED_EMAIL',
  'NOT_CONFIGURED',
  'DEAD_LETTER'
);

-- 2. Notifications table
CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "merchant_id" UUID NOT NULL,
  "recipient_user_id" UUID NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "severity" "NotificationSeverityEnum" NOT NULL,
  "severity_rank" INTEGER NOT NULL DEFAULT 1,
  "title" VARCHAR(255) NOT NULL,
  "body" TEXT NOT NULL,
  "source_type" VARCHAR(64) NOT NULL,
  "source_id" VARCHAR(128) NOT NULL,
  "source_branch_id" UUID,
  "source_warehouse_id" UUID,
  "source_carrier_account_id" UUID,
  "group_key" VARCHAR(255) NOT NULL,
  "digest_count" INTEGER NOT NULL DEFAULT 1,
  "link_path" VARCHAR(512) NOT NULL,
  "status" "NotificationStatusEnum" NOT NULL DEFAULT 'ACTIVE',
  "read_at" TIMESTAMPTZ,
  "resolved_at" TIMESTAMPTZ,
  "retention_until" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_merchant_id_event_type_group_key_recipient_user_id_key"
  ON "notifications"("merchant_id", "event_type", "group_key", "recipient_user_id");

CREATE INDEX "notifications_merchant_id_recipient_user_id_status_severity_created_at_idx"
  ON "notifications"("merchant_id", "recipient_user_id", "status", "severity", "created_at");

CREATE INDEX "notifications_merchant_id_recipient_user_id_read_at_idx"
  ON "notifications"("merchant_id", "recipient_user_id", "read_at");

CREATE INDEX "notifications_merchant_id_retention_until_idx"
  ON "notifications"("merchant_id", "retention_until");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. NotificationChannelDelivery table
CREATE TABLE "notification_channel_deliveries" (
  "id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "channel" "NotificationChannelEnum" NOT NULL,
  "state" "NotificationDeliveryStateEnum" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "provider_submission_id" VARCHAR(255),
  "provider_message_id" VARCHAR(255),
  "last_error_code" VARCHAR(128),
  "sent_at" TIMESTAMPTZ,
  "correlation_id" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_channel_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_channel_deliveries_provider_submission_id_key"
  ON "notification_channel_deliveries"("provider_submission_id");

CREATE UNIQUE INDEX "notification_channel_deliveries_notification_id_channel_key"
  ON "notification_channel_deliveries"("notification_id", "channel");

CREATE INDEX "notification_channel_deliveries_channel_state_created_at_idx"
  ON "notification_channel_deliveries"("channel", "state", "created_at");

ALTER TABLE "notification_channel_deliveries"
  ADD CONSTRAINT "notification_channel_deliveries_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. NotificationRedeliverIdempotency table (D5 durable redeliver idempotency)
CREATE TABLE "notification_redeliver_idempotency" (
  "id" UUID NOT NULL,
  "merchant_id" UUID NOT NULL,
  "delivery_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" VARCHAR(128) NOT NULL,
  "response_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_redeliver_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_redeliver_idempotency_merchant_id_delivery_id_idempotency_key_key"
  ON "notification_redeliver_idempotency"("merchant_id", "delivery_id", "idempotency_key");

CREATE INDEX "notification_redeliver_idempotency_merchant_id_created_at_idx"
  ON "notification_redeliver_idempotency"("merchant_id", "created_at");

-- 4b. NotificationDigestContribution table (D6 durable digest replay deduplication)
CREATE TABLE "notification_digest_contributions" (
  "id" UUID NOT NULL,
  "notification_id" UUID NOT NULL,
  "contribution_key" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_digest_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_digest_contributions_notification_id_contribution_key_key"
  ON "notification_digest_contributions"("notification_id", "contribution_key");

ALTER TABLE "notification_digest_contributions"
  ADD CONSTRAINT "notification_digest_contributions_notification_id_fkey"
  FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. D3 Compatibility Backfill: force protected subscription keys to true in-place
-- while preserving all other preference keys and channel booleans.
UPDATE "users"
SET "notification_preferences" = jsonb_set(
  COALESCE("notification_preferences", '{}'::jsonb),
  '{subscriptions}',
  COALESCE("notification_preferences"->'subscriptions', '{}'::jsonb)
    || '{"security_alerts": true, "create_unknown": true, "claim_deadline_warning": true}'::jsonb,
  true
)
WHERE "notification_preferences" IS NOT NULL;
