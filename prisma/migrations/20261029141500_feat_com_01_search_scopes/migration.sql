-- AlterTable
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "carrier_statements" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "carrier_statements" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "exception_cases" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "exception_cases" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "discrepancies" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "branch_id" VARCHAR(128);
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "warehouse_id" VARCHAR(128);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_merchant_id_branch_id_idx" ON "orders"("merchant_id", "branch_id");
CREATE INDEX IF NOT EXISTS "orders_merchant_id_warehouse_id_idx" ON "orders"("merchant_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "shipments_merchant_id_branch_id_idx" ON "shipments"("merchant_id", "branch_id");
CREATE INDEX IF NOT EXISTS "shipments_merchant_id_warehouse_id_idx" ON "shipments"("merchant_id", "warehouse_id");
