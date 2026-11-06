/**
 * Portions of this file are derived from prisma/prisma-client-extensions:
 * https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security
 *
 * Copyright 2023 Prisma Data, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantId, TENANT_SETTING } from './tenant-context';

/**
 * Tenant RLS Prisma client extension (TASK-AI-154 pilot).
 *
 * Pattern adapted from the row-level-security example in
 * prisma/prisma-client-extensions (Apache-2.0,
 * https://github.com/prisma/prisma-client-extensions): the Postgres session
 * variable consumed by the orders row-level security policy is set with
 * `set_config('app.tenant_id', ..., true)`. The third argument `true` makes
 * the value local to the current transaction, so it is discarded on commit
 * or rollback and can never leak across pooled connections or requests.
 *
 * Pilot scope:
 * - Order operations issued on the extended client run inside a transaction
 *   that first sets `app.tenant_id` for that transaction.
 * - Interactive transactions issued on the extended client set the variable
 *   once for their whole duration; use the provided transaction client for
 *   operations inside them.
 * - Operations without a tenant context (worker jobs, seed scripts, public
 *   and platform routes) are not wrapped and keep today's behavior; the RLS
 *   policy is fail-open for such sessions until the documented rollout.
 */
export function tenantRlsExtension(base: PrismaClient) {
  const baseTransaction = base.$transaction.bind(base) as (...inner: unknown[]) => Promise<unknown>;

  return Prisma.defineExtension({
    name: 'tenant-rls',
    client: {
      async $transaction(...args: unknown[]): Promise<unknown> {
        const tenantId = getTenantId();
        const [first, options] = args;
        if (!tenantId) {
          return baseTransaction(...args);
        }
        if (!Array.isArray(first)) {
          return baseTransaction(async (tx: Prisma.TransactionClient) => {
            await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`;
            return (first as (txClient: Prisma.TransactionClient) => Promise<unknown>)(tx);
          }, options);
        }
        // Array form: pass through untouched. Each Order operation inside it
        // still sets the tenant in its own nested transaction via the query
        // hook below, so per-operation RLS isolation holds; batch atomicity
        // across mixed models is not part of the pilot scope.
        return baseTransaction(...args);
      },
    },
    query: {
      order: {
        async $allOperations({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }): Promise<unknown> {
          const tenantId = getTenantId();
          if (!tenantId) {
            return query(args);
          }
          const [, result] = (await (base.$transaction as any)([
            base.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`,
            query(args),
          ])) as [number, unknown];
          return result;
        },
      },
    },
  });
}
