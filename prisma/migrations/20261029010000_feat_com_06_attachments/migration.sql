-- FEAT-COM-06: Attachments (Private upload, hash, access audit and retention)

CREATE TABLE IF NOT EXISTS "attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "storage_bucket" VARCHAR(128) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL DEFAULT 'GENERAL',
    "entity_id" VARCHAR(255),
    "branch_id" VARCHAR(128),
    "warehouse_id" VARCHAR(128),
    "uploaded_by" VARCHAR(255) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "retention_days" INTEGER,
    "expires_at" TIMESTAMPTZ,
    "metadata" JSONB,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- Foreign Key Constraints
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachments_merchant_id_fkey'
    ) THEN
        ALTER TABLE "attachments" ADD CONSTRAINT "attachments_merchant_id_fkey"
            FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "attachments_merchant_id_created_at_idx" ON "attachments"("merchant_id", "created_at");
CREATE INDEX IF NOT EXISTS "attachments_merchant_id_entity_type_entity_id_idx" ON "attachments"("merchant_id", "entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "attachments_merchant_id_status_expires_at_idx" ON "attachments"("merchant_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "attachments_merchant_id_checksum_sha256_idx" ON "attachments"("merchant_id", "checksum_sha256");
