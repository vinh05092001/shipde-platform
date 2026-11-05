-- FEAT-COM-03: Shared Bulk Actions Framework & Entity Models (Branches, Warehouses, BulkActionBatches)

-- 1. Branches Table
CREATE TABLE IF NOT EXISTS "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(32),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "branches_merchant_id_code_key" ON "branches"("merchant_id", "code");
CREATE INDEX IF NOT EXISTS "branches_merchant_id_status_idx" ON "branches"("merchant_id", "status");

-- 2. Warehouses Table
CREATE TABLE IF NOT EXISTS "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "contact_name" VARCHAR(255) NOT NULL,
    "contact_phone" VARCHAR(32) NOT NULL,
    "contact_email" VARCHAR(255),
    "address_line" TEXT NOT NULL,
    "ward" VARCHAR(128),
    "district" VARCHAR(128) NOT NULL,
    "city" VARCHAR(128) NOT NULL,
    "postal_code" VARCHAR(32),
    "address_json" JSONB NOT NULL,
    "use_different_return_address" BOOLEAN NOT NULL DEFAULT false,
    "return_contact_name" VARCHAR(255),
    "return_contact_phone" VARCHAR(32),
    "return_address_line" TEXT,
    "return_ward" VARCHAR(128),
    "return_district" VARCHAR(128),
    "return_city" VARCHAR(128),
    "return_address_json" JSONB,
    "operating_hours" JSONB,
    "cutoff_time" VARCHAR(10),
    "schedule_notes" VARCHAR(500),
    "contacts_json" JSONB,
    "printer_paper_size" VARCHAR(32) NOT NULL DEFAULT 'A6',
    "printer_dpi" INTEGER NOT NULL DEFAULT 203,
    "printer_name" VARCHAR(255),
    "printer_auto_print" BOOLEAN NOT NULL DEFAULT false,
    "printer_config" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "warehouses_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_merchant_id_code_key" ON "warehouses"("merchant_id", "code");
CREATE INDEX IF NOT EXISTS "warehouses_merchant_id_status_idx" ON "warehouses"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "warehouses_merchant_id_is_default_idx" ON "warehouses"("merchant_id", "is_default");

-- 3. Bulk Action Batches Table
CREATE TABLE IF NOT EXISTS "bulk_action_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(255),
    "request_hash" VARCHAR(64),
    "status" VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    "total_count" INTEGER NOT NULL,
    "success_count" INTEGER NOT NULL,
    "failure_count" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bulk_action_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bulk_action_batches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bulk_action_batches_merchant_id_idempotency_key_key" ON "bulk_action_batches"("merchant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "bulk_action_batches_merchant_id_entity_type_action_idx" ON "bulk_action_batches"("merchant_id", "entity_type", "action");
CREATE INDEX IF NOT EXISTS "bulk_action_batches_merchant_id_created_at_idx" ON "bulk_action_batches"("merchant_id", "created_at");
