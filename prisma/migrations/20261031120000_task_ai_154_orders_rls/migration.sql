-- TASK-AI-154: pilot Postgres row-level security for tenant isolation on the
-- tenant-owned `orders` table. Service-level merchant_id filters remain the
-- primary layer; this policy is the database-level second layer.
--
-- FORCE ROW LEVEL SECURITY subjects the table owner to the policy. Superuser
-- connections (typical local/CI databases) bypass RLS, so behavior is
-- unchanged there.
--
-- Pilot fail-open: a null/empty `app.tenant_id` (worker jobs, seed scripts,
-- platform administration) is not restricted. When set by the tenant
-- middleware from a verified token claim, reads (USING) and writes
-- (WITH CHECK) require merchant_id equality. A present but non-UUID value
-- raises a cast error and fails closed.

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "orders_tenant_isolation" ON "orders"
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "merchant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "merchant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
  );
