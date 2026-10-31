-- FEAT-COM-06: Durable orphan-cleanup outbox for attachment upload compensation.
-- When an attachment row/audit creation fails AND immediate S3 object removal also fails,
-- a PENDING record is persisted here so the object can never become an unrecoverable orphan.
-- Reconciled (and marked DONE) by the reconcile-pending maintenance endpoint.

CREATE TABLE IF NOT EXISTS "attachment_orphan_cleanups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "storage_bucket" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(64) NOT NULL DEFAULT 'UPLOAD_ROLLBACK',
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correlation_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_orphan_cleanups_pkey" PRIMARY KEY ("id")
);

-- Foreign Key Constraint
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'attachment_orphan_cleanups_merchant_id_fkey'
    ) THEN
        ALTER TABLE "attachment_orphan_cleanups" ADD CONSTRAINT "attachment_orphan_cleanups_merchant_id_fkey"
            FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "attachment_orphan_cleanups_merchant_id_status_idx" ON "attachment_orphan_cleanups"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "attachment_orphan_cleanups_status_updated_at_idx" ON "attachment_orphan_cleanups"("status", "updated_at");
