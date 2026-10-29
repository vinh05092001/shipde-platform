-- FEAT-RBAC-02: Scope Assignment Migration (Carrier Account Scopes)
--
-- Forward Notes:
-- - Extends users table with carrier_account_scopes TEXT[]
-- - Extends invitations table with carrier_account_scopes TEXT[]
-- - Backwards-compatible default empty array

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "carrier_account_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "carrier_account_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
