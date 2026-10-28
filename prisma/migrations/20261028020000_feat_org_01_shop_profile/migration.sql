-- FEAT-ORG-01: Shop Profile (Legal, Billing and Operating Defaults)
--
-- AlterTable
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "legal_name" VARCHAR(255);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "tax_code" VARCHAR(32);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "contact_email" VARCHAR(255);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "contact_phone" VARCHAR(32);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "legal_address" TEXT;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "billing_email" VARCHAR(255);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "billing_address" TEXT;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "bank_name" VARCHAR(128);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "bank_account_number" VARCHAR(64);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "bank_account_name" VARCHAR(255);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "bank_branch" VARCHAR(255);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh';
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "currency" VARCHAR(16) NOT NULL DEFAULT 'VND';
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "default_fee_payer" VARCHAR(32) NOT NULL DEFAULT 'SHOP';
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "default_weight_unit" VARCHAR(16) NOT NULL DEFAULT 'g';
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "auto_routing_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "operating_notes" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "merchants_tax_code_idx" ON "merchants"("tax_code");
