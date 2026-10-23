-- FEAT-AUTH-05: Multi-Factor Authentication (MFA) Migration
--
-- Forward Notes:
-- - Adds mfa_factors, mfa_recovery_codes, and mfa_challenges tables.
-- - Extends device_sessions with mfa_verified_at and auth_assurance.
-- - Key Availability: All factor secrets are encrypted at rest with AES-256-GCM
--   using MFA_ENCRYPTION_KEY configured in environment. In production, if
--   MFA_ENCRYPTION_KEY is absent or shorter than 32 characters, API bootstrap
--   fails closed and cannot decrypt or encrypt factor secrets.
-- - Recovery codes are stored only as one-way cryptographic SHA-256 verifiers.
-- - Challenges are stored only as SHA-256 hashes of opaque single-use tokens.

-- AlterTable: add MFA assurance columns to device_sessions
ALTER TABLE "device_sessions" ADD COLUMN "mfa_verified_at" TIMESTAMPTZ;
ALTER TABLE "device_sessions" ADD COLUMN "auth_assurance" VARCHAR(32) NOT NULL DEFAULT 'PASSWORD';

-- CreateTable: mfa_factors
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "type" VARCHAR(32) NOT NULL DEFAULT 'TOTP',
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    "secret_ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "setup_expires_at" TIMESTAMPTZ,
    "activated_at" TIMESTAMPTZ,
    "reset_at" TIMESTAMPTZ,
    "last_accepted_step" BIGINT,
    "created_by" VARCHAR(255),
    "updated_by" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mfa_recovery_codes
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "factor_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "consumed_by_session_id" VARCHAR(255),
    "consumed_correlation_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mfa_challenges
CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge_hash" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "login_transaction_ref" VARCHAR(255),
    "purpose" VARCHAR(32) NOT NULL DEFAULT 'MFA_LOGIN',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "correlation_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_status_idx" ON "mfa_factors"("user_id", "status");
CREATE INDEX "mfa_factors_merchant_id_user_id_idx" ON "mfa_factors"("merchant_id", "user_id");

CREATE INDEX "mfa_recovery_codes_factor_id_consumed_at_idx" ON "mfa_recovery_codes"("factor_id", "consumed_at");
CREATE INDEX "mfa_recovery_codes_code_hash_idx" ON "mfa_recovery_codes"("code_hash");

CREATE UNIQUE INDEX "mfa_challenges_challenge_hash_key" ON "mfa_challenges"("challenge_hash");
CREATE INDEX "mfa_challenges_user_id_consumed_at_expires_at_idx" ON "mfa_challenges"("user_id", "consumed_at", "expires_at");

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "mfa_factors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
