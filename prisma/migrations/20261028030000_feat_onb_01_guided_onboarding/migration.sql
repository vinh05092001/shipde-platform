-- FEAT-ONB-01: Guided Onboarding State
--
-- CreateTable
CREATE TABLE IF NOT EXISTS "onboarding_states" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS',
    "current_step" VARCHAR(64) NOT NULL DEFAULT 'SHOP_PROFILE',
    "completed_steps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "skipped_steps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "step_data" JSONB,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "onboarding_states_merchant_id_key" ON "onboarding_states"("merchant_id");
CREATE INDEX IF NOT EXISTS "onboarding_states_merchant_id_status_idx" ON "onboarding_states"("merchant_id", "status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_states_merchant_id_fkey'
    ) THEN
        ALTER TABLE "onboarding_states"
        ADD CONSTRAINT "onboarding_states_merchant_id_fkey"
        FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
