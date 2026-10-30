-- FEAT-COM-04: Imports & Branches Migration
--
-- Forward Notes:
-- - Creates "branches" table with tenant scoping, unique code per merchant, contact and address fields
-- - Creates "imports" table with tenant scoping, template_type, file checksum, revisioning, status, control totals and audit timestamps
-- - Creates "import_rows" table for durable per-row ingestion results, normalized data, issues, and scope identifiers

-- 1. Create branches table
CREATE TABLE IF NOT EXISTS "branches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(32),
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "contact_name" VARCHAR(255),
    "contact_phone" VARCHAR(32),
    "address_line" TEXT,
    "ward" VARCHAR(128),
    "district" VARCHAR(128),
    "city" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Ensure existing branches table gains all required columns and correct status default
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "phone" VARCHAR(32);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "contact_name" VARCHAR(255);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "contact_phone" VARCHAR(32);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "address_line" TEXT;
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "ward" VARCHAR(128);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "district" VARCHAR(128);
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "city" VARCHAR(128);
ALTER TABLE "branches" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS "branches_merchant_id_code_key" ON "branches"("merchant_id", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "branches_id_merchant_id_key" ON "branches"("id", "merchant_id");
CREATE INDEX IF NOT EXISTS "branches_merchant_id_status_idx" ON "branches"("merchant_id", "status");

-- 2. Create imports table
CREATE TABLE IF NOT EXISTS "imports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "template_type" VARCHAR(64) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_hash" VARCHAR(64) NOT NULL,
    "mime_type" VARCHAR(128) NOT NULL,
    "storage_path" VARCHAR(512),
    "status" VARCHAR(32) NOT NULL DEFAULT 'UPLOADED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" VARCHAR(255),
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "control_totals" JSONB,
    "created_by_user_id" UUID,
    "promoted_by_user_id" UUID,
    "promoted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "imports_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "imports_merchant_id_template_type_revision_key" ON "imports"("merchant_id", "template_type", "revision");
CREATE INDEX IF NOT EXISTS "imports_merchant_id_template_type_idx" ON "imports"("merchant_id", "template_type");
CREATE INDEX IF NOT EXISTS "imports_merchant_id_file_hash_idx" ON "imports"("merchant_id", "file_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "imports_merchant_id_idempotency_key_key" ON "imports"("merchant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "imports_merchant_id_idempotency_key_idx" ON "imports"("merchant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "imports_merchant_id_status_idx" ON "imports"("merchant_id", "status");

-- 3. Create import_rows table
CREATE TABLE IF NOT EXISTS "import_rows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "normalized_data" JSONB,
    "status" VARCHAR(32) NOT NULL,
    "scope_identifier" VARCHAR(64),
    "issues_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "import_rows_import_id_status_idx" ON "import_rows"("import_id", "status");
CREATE INDEX IF NOT EXISTS "import_rows_import_id_row_number_idx" ON "import_rows"("import_id", "row_number");
