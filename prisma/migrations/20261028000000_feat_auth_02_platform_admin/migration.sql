-- AlterEnum
ALTER TYPE "RoleEnum" ADD VALUE 'PLATFORM_ADMIN';

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "merchant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "device_sessions" ALTER COLUMN "merchant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "actor" VARCHAR(255);
