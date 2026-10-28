-- FEAT-RBAC-01: Roles and Permissions Migration
--
-- Forward Notes:
-- - Creates roles, permissions, and role_permissions tables
-- - Extends users table with custom_role_id for tenant-scoped custom role assignment
-- - Implements multi-tenant isolation, unique role names per merchant, and cascade deletion

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "custom_role_id" UUID;

-- CreateTable
CREATE TABLE IF NOT EXISTS "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "merchant_id" UUID,
    "code" VARCHAR(64),
    "name" VARCHAR(255) NOT NULL,
    "name_lower" VARCHAR(255),
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- AlterTable (idempotency if roles table already existed without name_lower)
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "name_lower" VARCHAR(255);
UPDATE "roles" SET "name_lower" = LOWER("name") WHERE "name_lower" IS NULL;

-- Trigger to maintain name_lower automatically
CREATE OR REPLACE FUNCTION set_role_name_lower() RETURNS trigger AS $$
BEGIN
    NEW.name_lower := LOWER(NEW.name);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_name_lower ON "roles";
CREATE TRIGGER trg_role_name_lower
BEFORE INSERT OR UPDATE OF "name" ON "roles"
FOR EACH ROW
EXECUTE FUNCTION set_role_name_lower();

-- CreateTable
CREATE TABLE IF NOT EXISTS "permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "roles_merchant_id_name_lower_key" ON "roles"("merchant_id", "name_lower");
CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "roles_merchant_id_is_system_idx" ON "roles"("merchant_id", "is_system");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_id_permission_id_key" ON "role_permissions"("role_id", "permission_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_merchant_id_custom_role_id_idx" ON "users"("merchant_id", "custom_role_id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'roles_merchant_id_fkey') THEN
        ALTER TABLE "roles" ADD CONSTRAINT "roles_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_fkey') THEN
        ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_fkey') THEN
        ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey (DEFERRABLE INITIALLY DEFERRED so tenant cascade and role delete both have one defined outcome)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_custom_role_id_fkey') THEN
        ALTER TABLE "users" DROP CONSTRAINT "users_custom_role_id_fkey";
    END IF;
    ALTER TABLE "users" ADD CONSTRAINT "users_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
END $$;

-- Same-merchant constraint trigger (BR-RBAC-04 / database ownership)
CREATE OR REPLACE FUNCTION check_user_custom_role_same_merchant()
RETURNS TRIGGER AS $$
DECLARE
    v_role_merchant_id UUID;
    v_is_system BOOLEAN;
BEGIN
    IF NEW.custom_role_id IS NOT NULL THEN
        SELECT merchant_id, is_system INTO v_role_merchant_id, v_is_system
        FROM roles
        WHERE id = NEW.custom_role_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Custom role % does not exist', NEW.custom_role_id;
        END IF;

        IF v_is_system THEN
            RAISE EXCEPTION 'Cannot assign system role % as custom_role_id', NEW.custom_role_id;
        END IF;

        IF v_role_merchant_id IS DISTINCT FROM NEW.merchant_id THEN
            RAISE EXCEPTION 'Cross-tenant custom role assignment: user merchant % does not match role merchant %',
                NEW.merchant_id, v_role_merchant_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_user_custom_role_same_merchant ON users;
CREATE TRIGGER trg_check_user_custom_role_same_merchant
    BEFORE INSERT OR UPDATE OF custom_role_id, merchant_id ON users
    FOR EACH ROW
    EXECUTE FUNCTION check_user_custom_role_same_merchant();

-- Allow platform-level system audit logs without customer merchant binding (Finding 1 / Round 12 / Finding 1 / Round 14 / P1-03 / BR-RBAC-07 / BR-RBAC-04)
-- Downstream consumer compatibility & null-safety:
-- 1. Existing customer audit log rows retain their non-null merchant_id; only platform-level bootstrap events omit merchant_id.
-- 2. Downstream tenant queries (WHERE merchant_id = :tenant_id) continue to return tenant-scoped events without regression.
-- 3. Downstream platform audit consumers must handle nullable merchant_id (WHERE merchant_id IS NULL or merchant_id IS NOT NULL).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'audit_logs' AND column_name = 'merchant_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE "audit_logs" ALTER COLUMN "merchant_id" DROP NOT NULL;
    END IF;
END $$;

