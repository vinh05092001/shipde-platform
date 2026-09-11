import { execSync } from 'node:child_process';

const ALLOWED_LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'postgres',
  'shipde-postgres',
]);

const ALLOWED_DB_NAMES = new Set(['shipde_dev', 'shipde_test', 'shipde-test', 'test', 'dev']);

/**
 * Validates that the target database configuration is explicitly an isolated local or test environment
 * before permitting destructive operations such as schema drop or reset.
 */
export function assertSafeDatabaseReset(
  databaseUrl: string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV
): void {
  if (nodeEnv === 'production') {
    throw new Error(
      '[db:reset] Destructive database reset is strictly prohibited when NODE_ENV is "production".'
    );
  }

  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error('[db:reset] DATABASE_URL must be defined to verify safe reset boundary.');
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(`[db:reset] Invalid DATABASE_URL format: unable to parse connection string.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `[db:reset] Destructive reset rejected: host '${hostname}' is not an authorized local or test host (${Array.from(ALLOWED_LOCAL_HOSTS).join(', ')}).`
    );
  }

  const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
  const isAllowedDb =
    ALLOWED_DB_NAMES.has(dbName) || dbName.includes('test') || dbName.includes('dev');

  if (!isAllowedDb) {
    throw new Error(
      `[db:reset] Destructive reset rejected: database '${dbName}' is not an authorized local or test database name.`
    );
  }
}

export function runSafeDatabaseReset(): void {
  const dbUrl =
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev?schema=public';
  assertSafeDatabaseReset(dbUrl, process.env.NODE_ENV);

  console.log(
    `[db:reset] Target database verified as safe local/test environment. Executing reset...`
  );
  execSync('prisma migrate reset --force --schema=prisma/schema.prisma', {
    stdio: 'inherit',
    env: process.env,
  });
}

if (
  (typeof require !== 'undefined' && require.main === module) ||
  (typeof process !== 'undefined' &&
    process.argv[1]?.replace(/\\/g, '/').endsWith('infra/docker/reset-db.ts'))
) {
  try {
    runSafeDatabaseReset();
  } catch (err: any) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
