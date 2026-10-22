-- AlterTable
ALTER TABLE "device_sessions" ADD COLUMN "mfa_verified_at" TIMESTAMPTZ,
ADD COLUMN "auth_assurance" VARCHAR(32) DEFAULT 'PASSWORD';

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'TOTP',
    "encrypted_secret" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ,
    "activated_at" TIMESTAMPTZ,
    "reset_at" TIMESTAMPTZ,
    "reset_by" VARCHAR(255),
    "reset_reason" VARCHAR(255),
    "last_accepted_step" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "factor_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "consumed_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "challenge_hash" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "purpose" VARCHAR(32) NOT NULL DEFAULT 'LOGIN',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_status_idx" ON "mfa_factors"("user_id", "status");
CREATE INDEX "mfa_factors_merchant_id_user_id_idx" ON "mfa_factors"("merchant_id", "user_id");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_factor_id_consumed_at_idx" ON "mfa_recovery_codes"("factor_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenges_challenge_hash_key" ON "mfa_challenges"("challenge_hash");
CREATE INDEX "mfa_challenges_user_id_expires_at_idx" ON "mfa_challenges"("user_id", "expires_at");
CREATE INDEX "mfa_challenges_challenge_hash_idx" ON "mfa_challenges"("challenge_hash");

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "mfa_factors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
