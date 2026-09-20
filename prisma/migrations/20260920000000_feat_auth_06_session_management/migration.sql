-- FEAT-AUTH-06: Session management migration
-- Adds session lifecycle fields to device_sessions table

-- CreateEnum
CREATE TYPE "SessionStatusEnum" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'INACTIVE');

-- Drop the old index that used is_revoked
DROP INDEX IF EXISTS "device_sessions_user_id_is_revoked_idx";

-- AlterTable: add new columns to device_sessions
ALTER TABLE "device_sessions" ADD COLUMN "merchant_id" UUID;
ALTER TABLE "device_sessions" ADD COLUMN "session_token_hash" VARCHAR(512);
ALTER TABLE "device_sessions" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "device_sessions" ADD COLUMN "ip_address" VARCHAR(64);
ALTER TABLE "device_sessions" ADD COLUMN "status" "SessionStatusEnum" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "device_sessions" ADD COLUMN "expires_at" TIMESTAMPTZ;
ALTER TABLE "device_sessions" ADD COLUMN "revoked_at" TIMESTAMPTZ;
ALTER TABLE "device_sessions" ADD COLUMN "revoked_by" VARCHAR(255);
ALTER TABLE "device_sessions" ADD COLUMN "revoke_reason" VARCHAR(255);

-- Backfill merchant_id from user's merchant_id for any existing rows
UPDATE "device_sessions" SET "merchant_id" = (
  SELECT "users"."merchant_id" FROM "users" WHERE "users"."id" = "device_sessions"."user_id"
) WHERE "merchant_id" IS NULL;

-- Make merchant_id NOT NULL after backfill
ALTER TABLE "device_sessions" ALTER COLUMN "merchant_id" SET NOT NULL;

-- Migrate existing rows: generate token hashes and set expiry for legacy sessions
UPDATE "device_sessions" SET
  "session_token_hash" = encode(gen_random_bytes(32), 'hex'),
  "expires_at" = CURRENT_TIMESTAMP + INTERVAL '90 days'
WHERE "session_token_hash" IS NULL;

-- Make session_token_hash NOT NULL
ALTER TABLE "device_sessions" ALTER COLUMN "session_token_hash" SET NOT NULL;

-- Make expires_at NOT NULL with a default
ALTER TABLE "device_sessions" ALTER COLUMN "expires_at" SET DEFAULT CURRENT_TIMESTAMP + INTERVAL '90 days';
UPDATE "device_sessions" SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '90 days' WHERE "expires_at" IS NULL;
ALTER TABLE "device_sessions" ALTER COLUMN "expires_at" SET NOT NULL;

-- Migrate old is_revoked=true rows to REVOKED status
UPDATE "device_sessions" SET "status" = 'REVOKED' WHERE "is_revoked" = true;

-- Drop old is_revoked column
ALTER TABLE "device_sessions" DROP COLUMN "is_revoked";

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_session_token_hash_key" ON "device_sessions"("session_token_hash");
CREATE INDEX "device_sessions_merchant_id_user_id_status_idx" ON "device_sessions"("merchant_id", "user_id", "status");
CREATE INDEX "device_sessions_user_id_status_idx" ON "device_sessions"("user_id", "status");

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
