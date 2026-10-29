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

-- Backfill from authoritative ownership:
-- 1. Propagate scopes from parent orders to shipments
UPDATE "shipments" s
SET "branch_id" = COALESCE(s."branch_id", o."branch_id"),
    "warehouse_id" = COALESCE(s."warehouse_id", o."warehouse_id")
FROM "orders" o
WHERE s."order_id" = o."id";

-- 2. Propagate scopes from shipments to exception cases
UPDATE "exception_cases" ec
SET "branch_id" = COALESCE(ec."branch_id", s."branch_id"),
    "warehouse_id" = COALESCE(ec."warehouse_id", s."warehouse_id")
FROM "shipments" s
WHERE ec."shipment_id" = s."id";

-- 3. Propagate scopes from shipments to discrepancies
UPDATE "discrepancies" d
SET "branch_id" = COALESCE(d."branch_id", s."branch_id"),
    "warehouse_id" = COALESCE(d."warehouse_id", s."warehouse_id")
FROM "shipments" s
WHERE d."shipment_id" = s."id";

-- 4. Propagate scopes from shipments to claims
UPDATE "claims" c
SET "branch_id" = COALESCE(c."branch_id", s."branch_id"),
    "warehouse_id" = COALESCE(c."warehouse_id", s."warehouse_id")
FROM "shipments" s
WHERE c."shipment_id" = s."id";

-- 5. Fallback for remaining unassigned aggregates
UPDATE "orders"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

UPDATE "shipments"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

UPDATE "carrier_statements"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

UPDATE "exception_cases"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

UPDATE "discrepancies"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

UPDATE "claims"
SET "branch_id" = COALESCE("branch_id", 'default'),
    "warehouse_id" = COALESCE("warehouse_id", 'default')
WHERE "branch_id" IS NULL AND "warehouse_id" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "orders_merchant_id_branch_id_idx" ON "orders"("merchant_id", "branch_id");
CREATE INDEX IF NOT EXISTS "orders_merchant_id_warehouse_id_idx" ON "orders"("merchant_id", "warehouse_id");
CREATE INDEX IF NOT EXISTS "shipments_merchant_id_branch_id_idx" ON "shipments"("merchant_id", "branch_id");
CREATE INDEX IF NOT EXISTS "shipments_merchant_id_warehouse_id_idx" ON "shipments"("merchant_id", "warehouse_id");
