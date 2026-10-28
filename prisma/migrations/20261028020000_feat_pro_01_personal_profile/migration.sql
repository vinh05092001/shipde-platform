-- FEAT-PRO-01: Personal Profile Migration
--
-- Forward Notes:
-- - Extends users table with avatar_url, language, timezone, notification_preferences, and default_warehouse_id
-- - Sets defaults: language='vi', timezone='Asia/Ho_Chi_Minh'
-- - Idempotent column additions for safe re-runs

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(512);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) NOT NULL DEFAULT 'vi';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_preferences" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "default_warehouse_id" UUID;
