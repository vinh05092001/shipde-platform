-- DropIndex: replace tenant-scoped uniqueness with a platform-wide constraint (BR-AUTH-03:
-- self-registration mints a brand-new tenant per account, so email/phone must be unique
-- across the whole platform, not merely within one merchant).
DROP INDEX "users_merchant_id_email_key";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'pending_verification';
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "terms_version" VARCHAR(32);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "otp" VARCHAR(16),
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_idx" ON "verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "verification_tokens_identifier_channel_idx" ON "verification_tokens"("identifier", "channel");

-- CreateIndex: platform-wide uniqueness on the login identifiers (Postgres treats each NULL
-- as distinct, so phone-only or email-only accounts remain unaffected).
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
