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

import { AsyncLocalStorage } from 'node:async_hooks';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantId, TENANT_SETTING } from './tenant-context';

const inBatchTransactionStorage = new AsyncLocalStorage<boolean>();

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
 * Scope & isolation:
 * - All model queries, relations, and raw queries issued on the extended
 *   client inside an authenticated tenant context run inside a transaction
 *   that first establishes `app.tenant_id`.
 * - Interactive transactions set the variable once for their whole duration
 *   and preserve atomicity.
 * - Array transactions preserve a single transaction for the entire batch,
 *   pre-pending the `set_config` statement so that any failure inside the
 *   batch rolls back all operations atomically.
 * - Operations without a tenant context (worker jobs, seed scripts, public
 *   and platform routes) are not wrapped and keep fail-open behavior until
 *   the documented rollout.
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

        // Array form: preserve ONE single transaction for the whole batch.
        // Establish the tenant setting first so all batch operations run
        // with RLS active and roll back atomically if any operation rejects.
        const setConfigPromise = base.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`;
        const batch = [setConfigPromise, ...(first as unknown[])];
        const results = (await inBatchTransactionStorage.run(true, async () =>
          (baseTransaction as any)(batch, options)
        )) as unknown[];
        return results.slice(1);
      },
    },
    query: {
      async $allOperations(payload: {
        model?: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
        __internalParams?: {
          transaction?: { kind: string; id?: string | number };
        };
      }): Promise<unknown> {
        const { args, query, __internalParams } = payload;
        const tenantId = getTenantId();
        // Bind bypass decisions strictly to actual transaction contexts:
        // - Queries executing on a transaction client have `__internalParams.transaction`
        //   (e.g. `kind: 'itx'` or `kind: 'batch'`).
        // - Batch array transactions run with `inBatchTransactionStorage`.
        // Root client queries called from within an interactive transaction callback
        // checkout a separate pooled connection without `__internalParams.transaction`,
        // so they must NOT bypass tenant setup.
        const hasTxClient = Boolean(__internalParams?.transaction);
        const inBatch = inBatchTransactionStorage.getStore() === true;
        if (!tenantId || hasTxClient || inBatch) {
          return query(args);
        }
        const [, result] = (await (base.$transaction as any)([
          base.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`,
          query(args),
        ])) as [number, unknown];
        return result;
      },
    },
  });
}
