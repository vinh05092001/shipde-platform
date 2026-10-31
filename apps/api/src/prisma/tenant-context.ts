import { AsyncLocalStorage } from 'node:async_hooks';

export const TENANT_SETTING = 'app.tenant_id';

const tenantStorage = new AsyncLocalStorage<string>();

export function getTenantId(): string | undefined {
  return tenantStorage.getStore();
}

export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantStorage.run(tenantId, fn);
}
