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

/**
 * Thrown when a query under an active tenant context is submitted inside a
 * transaction whose tenant setup this extension cannot prove.
 *
 * Prisma stamps `__internalParams.transaction` on every operation that runs
 * inside any transaction (interactive `itx` or batch `batch`), regardless of
 * which client created the transaction. An extended model or raw query can
 * therefore be adopted by a transaction opened on an UNEXTENDED client
 * (e.g. `plainClient.$transaction([extended.order.findMany()])`). That
 * transaction never executed `set_config('app.tenant_id', ...)`, so on its
 * connection the pilot policy's fail-open clause applies and the query would
 * read across tenants. Transaction metadata alone is not proof of setup;
 * the extension fails closed instead.
 */
export class TenantRlsUnconfiguredTransactionError extends Error {
  constructor(operation: string) {
    super(
      `Tenant RLS: ${operation} executed inside a transaction that was not ` +
        'established by the tenant RLS extension. The transaction never ' +
        "set the transaction-local 'app.tenant_id' setting, so running the " +
        'query would rely on the pilot fail-open clause and could expose ' +
        'cross-tenant rows. Route the transaction through the extended ' +
        "client's $transaction so the tenant setting is established first."
    );
    this.name = 'TenantRlsUnconfiguredTransactionError';
  }
}

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
 * - A query that arrives with Prisma transaction metadata can only run
 *   without an extra setup wrapper when THIS extension established the
 *   surrounding transaction (per-instance AsyncLocalStorage mark, set only
 *   after the `set_config` statement is in flight). Metadata stamped by a
 *   foreign, unextended client's transaction is NOT proof of setup; such
 *   queries are rejected with TenantRlsUnconfiguredTransactionError instead
 *   of running under the pilot fail-open clause.
 * - Root client queries (no transaction metadata), including those issued
 *   from inside a transaction callback, always get their own
 *   `set_config` + query transaction because they checkout separate pooled
 *   connections.
 * - Operations without a tenant context (worker jobs, seed scripts, public
 *   and platform routes) are not wrapped and keep fail-open behavior until
 *   the documented rollout.
 */
export function tenantRlsExtension(base: PrismaClient) {
  const baseTransaction = base.$transaction.bind(base) as (...inner: unknown[]) => Promise<unknown>;

  // Marks the async scopes in which this extension instance has established
  // (or is establishing, in the very same transaction) the transaction-local
  // `app.tenant_id` setting. Presence of the mark — never Prisma's
  // `__internalParams.transaction` metadata alone — is the proof that a
  // surrounding transaction is tenant-configured. The storage is created per
  // extension instance: a mark owned by an extension built on a different
  // base client is not evidence for this one.
  const establishedTxStorage = new AsyncLocalStorage<object>();

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
            // Mark only after set_config succeeded: anything observing the
            // mark knows the setting is live for this transaction.
            return establishedTxStorage.run({}, () =>
              (first as (txClient: Prisma.TransactionClient) => Promise<unknown>)(tx)
            );
          }, options);
        }

        // Array form: preserve ONE single transaction for the whole batch.
        // Establish the tenant setting first so all batch operations run
        // with RLS active and roll back atomically if any operation rejects.
        const batch = [
          base.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`,
          ...(first as unknown[]),
        ];
        const results = (await establishedTxStorage.run({}, async () =>
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
        const { args, query, __internalParams, model, operation } = payload;
        const tenantId = getTenantId();
        if (!tenantId) {
          // Pilot fail-open for non-tenant sessions (BR-RLS-05): workers,
          // seed scripts, public and platform routes keep today's behavior.
          return query(args);
        }
        const inTransaction = Boolean(__internalParams?.transaction);
        if (!inTransaction) {
          // Root client query (including root-client queries issued from
          // inside a transaction callback): it will run on its own pooled
          // connection, so establish the tenant setting in a dedicated
          // transaction for exactly this query.
          const [, result] = (await (base.$transaction as any)([
            base.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${tenantId}, true)`,
            query(args),
          ])) as [number, unknown];
          return result;
        }
        if (establishedTxStorage.getStore() !== undefined) {
          // This extension established the surrounding transaction and its
          // set_config statement is live on the transaction's connection;
          // no extra wrapper is needed.
          return query(args);
        }
        // The query carries transaction metadata, but the surrounding
        // transaction was opened by an unextended client (or another
        // extension instance) and never established app.tenant_id. Running
        // it would fall under the pilot fail-open clause and could read or
        // write across tenants: fail closed.
        throw new TenantRlsUnconfiguredTransactionError(
          model ? `${model}.${operation}` : operation
        );
      },
    },
  });
}
