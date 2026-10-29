-- FEAT-ORG-02: Branches (CRUD, activate/deactivate, and reporting scope)
--
-- CreateTable
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

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "branches_merchant_id_code_key" ON "branches"("merchant_id", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "branches_merchant_id_status_idx" ON "branches"("merchant_id", "status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'branches_merchant_id_fkey'
    ) THEN
        ALTER TABLE "branches" ADD CONSTRAINT "branches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
