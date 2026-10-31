-- TASK-AI-154: pilot Postgres row-level security for tenant isolation on
-- the tenant-owned `orders` table.
--
-- Defense in depth: service-level merchant_id filters remain the primary
-- enforcement layer; this policy is a second, database-level layer that
-- denies cross-tenant access even when a service forgets its filter.
--
-- FORCE ROW LEVEL SECURITY makes the table owner (the application database
-- role used in production) subject to the policy. Environments that connect
-- as a superuser (typical local development and CI test databases) bypass
-- RLS and therefore observe no behavior change.
--
-- Pilot scope (fail-open for non-tenant sessions): when `app.tenant_id` is
-- not set, the policy does not restrict rows. System contexts (worker jobs,
-- seed scripts, platform administration) do not carry a tenant and must
-- keep today's behavior until the documented rollout in
-- docs/product-spec/work-items/TASK-AI-154.md covers them. When the setting
-- IS set (authenticated merchant requests, established by the tenant
-- middleware from the signature-verified token claim), the policy enforces
-- merchant_id equality for reads (USING) and writes (WITH CHECK).
--
-- If the setting is present but not a valid UUID, the cast below raises an
-- error and the statement fails closed (no rows are returned or written).

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
