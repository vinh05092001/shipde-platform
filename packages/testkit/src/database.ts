import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '@prisma/client';

export function isLocalTestDb(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TEST_DB === 'local';
}

/**
 * Masked database target for readiness diagnostics (BR-LOCAL-06): `host:port/db` only.
 * Built from `new URL()` parts so username, password and query are never included;
 * unparseable input fails closed to a fixed marker instead of echoing the raw string.
 */
export function describeDatabaseTarget(url: string | undefined): string {
  try {
    const parsed = new URL(url ?? '');
    // Opaque URLs (no authority) keep credentials in the path; never describe them.
    if (!parsed.hostname) return '[unparseable database URL]';
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.hostname}${port}${parsed.pathname}`;
  } catch {
    return '[unparseable database URL]';
  }
}

export const LOCAL_DB_CONCURRENCY_REASON =
  'TEST_DB=local: PGlite has one connection; overlapping transactions and locking require PostgreSQL in CI';
export const LOCAL_DB_INFRASTRUCTURE_REASON =
  'TEST_DB=local: Redis, MinIO, worker/outbox and service recovery require infrastructure in CI';
export const LOCAL_DB_CONNECTION_REASON =
  'TEST_DB=local: a root Prisma query inside an interactive transaction needs an independent connection; PGlite has one connection, so run this scenario on PostgreSQL in CI';

/** The runner records these named omissions separately from passing suite processes. */
export function skipLocalDbTest(name: string, reason = LOCAL_DB_CONCURRENCY_REASON): boolean {
  if (!isLocalTestDb()) return false;
  console.log(`SHIPDE_TEST_SKIP ${JSON.stringify({ name, reason })}`);
  return true;
}

export function isGitleaksBinaryAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const pathVal = env.PATH ?? env.Path;
  if (!pathVal) return false;
  try {
    execFileSync('gitleaks', ['version'], {
      stdio: 'ignore',
      shell: false,
      env,
    });
    return true;
  } catch {
    return false;
  }
}

export interface SkipSecretsScanOptions {
  probe?: (env?: NodeJS.ProcessEnv) => boolean;
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export function skipSecretsScanWhenGitleaksMissing(
  name = 'rbac security secrets git scan',
  options: SkipSecretsScanOptions = {}
): boolean {
  const probe = options.probe ?? (() => isGitleaksBinaryAvailable(options.env));
  const log = options.log ?? console.log;
  if (probe(options.env)) return false;
  const reason =
    'Gitleaks CLI binary is unavailable; commit history scan is enforced by the pnpm security:secrets CI workflow step';
  log(`SHIPDE_TEST_SKIP ${JSON.stringify({ name, reason })}`);
  return true;
}

export interface LocalTestDatabase<T extends PrismaClient> {
  prisma: T;
  migrations: readonly string[];
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** Creates only a disposable memory database. No caller URL or data directory is accepted. */
export async function createLocalTestDatabase<T extends PrismaClient>(
  Client: new (options: Prisma.PrismaClientOptions) => T,
  env: NodeJS.ProcessEnv = process.env
): Promise<LocalTestDatabase<T>> {
  if (!isLocalTestDb(env)) throw new Error('Local database requires TEST_DB=local');
  if (env.NODE_ENV === 'production')
    throw new Error('Local test database is forbidden in production');

  // Default PostgreSQL tests never load the optional local driver.
  const { PGlite } = await import('@electric-sql/pglite');
  const { PrismaPGlite } = await import('pglite-prisma-adapter');
  const directory = fileURLToPath(new URL('../../../prisma/migrations/', import.meta.url));
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0)
    throw new Error('Local database requires the repository migration history');
  const migrations = await Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(join(directory, name, 'migration.sql'), 'utf8'),
    }))
  );
  const pg = new PGlite();
  let prisma: T | undefined;

  async function migrate(): Promise<void> {
    for (const migration of migrations) {
      try {
        // Whole files preserve PL/pgSQL bodies. Separate exec calls commit enum additions
        // before later migrations use them, just as migrate deploy does on PostgreSQL.
        await pg.exec(migration.sql);
      } catch (error) {
        const code = (error as { code?: string }).code;
        throw new Error(
          `Local database migration failed: ${migration.name}${code ? ` (SQLSTATE ${code})` : ''}`,
          { cause: error }
        );
      }
    }
  }

  try {
    await pg.waitReady;
    await migrate();
    const client = new Client({
      // The adapter's driver-adapter-utils 6.10.1 types are structurally closed against the
      // copies bundled in @prisma/client 6.19; the wire protocol is unchanged, so cast once here.
      // No datasourceUrl: Prisma rejects a custom URL once an adapter owns the connection.
      adapter: new PrismaPGlite(pg) as unknown as Prisma.PrismaClientOptions['adapter'],
    });
    prisma = client;
    await client.$connect();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        try {
          await client.$disconnect();
        } finally {
          await pg.close();
        }
      })();
      return closing;
    };
    return {
      prisma: client,
      migrations: names,
      async reset() {
        if (closing) throw new Error('Cannot reset a closed local test database');
        await client.$disconnect();
        // Reapply data migrations too; TRUNCATE alone would lose migration-owned seed rows.
        await pg.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
        await migrate();
        await client.$connect();
      },
      close,
    };
  } catch (error) {
    await prisma?.$disconnect().catch(() => undefined);
    await pg.close().catch(() => undefined);
    throw error;
  }
}
