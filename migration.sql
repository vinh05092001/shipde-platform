-- FEAT-AUTH-02: Admin-created shop account
-- Add admin provisioning tracking fields to users table.

-- AlterTable: add nullable columns for admin provisioning tracking.
-- No data backfill required; existing rows retain NULL.
ALTER TABLE "users" ADD COLUMN "created_by" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN "activated_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "created_by_ip" VARCHAR(64);
