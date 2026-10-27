-- CreateEnum
CREATE TYPE "InvitationStatusEnum" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(32),
    "role" "RoleEnum" NOT NULL,
    "store_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warehouse_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_hash" VARCHAR(255) NOT NULL,
    "status" "InvitationStatusEnum" NOT NULL DEFAULT 'PENDING',
    "invited_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_merchant_id_status_idx" ON "invitations"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "invitations_merchant_id_email_idx" ON "invitations"("merchant_id", "email");

-- CreateIndex
CREATE INDEX "invitations_merchant_id_phone_idx" ON "invitations"("merchant_id", "phone");

-- CreateIndex
CREATE INDEX "invitations_expires_at_idx" ON "invitations"("expires_at");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
