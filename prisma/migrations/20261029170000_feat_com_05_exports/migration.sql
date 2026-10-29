-- FEAT-COM-05: Exports (Permission-aware CSV/XLSX/PDF with generation metadata)

CREATE TABLE IF NOT EXISTS "export_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource" VARCHAR(64) NOT NULL,
    "format" VARCHAR(16) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "filters" JSONB,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "succeeded_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "row_results" JSONB,
    "file_name" VARCHAR(255),
    "file_size_bytes" INTEGER,
    "checksum_sha256" VARCHAR(64),
    "file_data" BYTEA,
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(1024),
    "rule_version" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "export_jobs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "export_jobs_merchant_id_status_idx" ON "export_jobs"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "export_jobs_merchant_id_created_at_idx" ON "export_jobs"("merchant_id", "created_at");
