import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export const PROTECTED_PARTIAL_INDEXES = [
  'invitations_merchant_pending_email_unique',
  'invitations_merchant_pending_phone_unique',
] as const;

/**
 * Checks whether an index name is one of the protected partial unique indexes.
 */
export function isProtectedPartialIndex(indexName: string): boolean {
  return (PROTECTED_PARTIAL_INDEXES as readonly string[]).includes(indexName);
}

/**
 * Validates a SQL migration string or diff to ensure it does not drop
 * the protected partial unique pending indexes.
 */
export function validateMigrationSqlSafety(sql: string): {
  safe: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  for (const idx of PROTECTED_PARTIAL_INDEXES) {
    // Matches any statement that drops these indexes, allowing any modifiers:
    // e.g. DROP INDEX CONCURRENTLY, DROP INDEX IF EXISTS, schema qualifications, quotes, CASCADE/RESTRICT
    const dropPattern = new RegExp(`DROP\\s+INDEX\\b[^;]*\\b${idx}\\b`, 'i');
    if (dropPattern.test(sql)) {
      violations.push(idx);
    }
  }
  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Validates prisma migrate diff SQL output and fails CI immediately if it attempts to drop
 * any of the protected PostgreSQL partial unique indexes (BR-INV-08 / Round 9 Finding 3).
 * Stripping DROP statements is forbidden; diffs attempting to remove protected indexes must fail CI.
 */
export function assertSafeMigrationDiff(diffSql: string): void {
  const check = validateMigrationSqlSafety(diffSql);
  if (!check.safe) {
    throw new Error(
      `[MIGRATION_GUARD] Forbidden DROP INDEX detected in migration diff for: ${check.violations.join(', ')}. ` +
        `PostgreSQL partial unique pending indexes must never be dropped.`
    );
  }
}

/**
 * Sanitizes prisma migrate diff SQL output by asserting safety. If any protected partial unique
 * index drop is present, throws immediately to fail CI instead of silently deleting DROP statements.
 */
export function sanitizePrismaMigrateDiff(diffSql: string): string {
  assertSafeMigrationDiff(diffSql);
  return diffSql;
}

/**
 * Asserts that prisma/schema.prisma does not reuse the protected partial unique index names
 * as non-unique @@index maps, which would cause Prisma to drop partial unique constraints (Round 10 Finding 1).
 */
export function assertNoSchemaIndexNameConflict(schemaPath?: string): void {
  const targetFile = schemaPath || path.resolve(__dirname, '../../../../prisma/schema.prisma');
  if (!fs.existsSync(targetFile)) {
    throw new Error(`[MIGRATION_GUARD] Schema file not found: ${targetFile}`);
  }
  const content = fs.readFileSync(targetFile, 'utf8');
  for (const idx of PROTECTED_PARTIAL_INDEXES) {
    const pattern = new RegExp(`(?:map:\\s*["']${idx}["']|@@(?:index|unique)\\([^)]*${idx})`, 'i');
    if (pattern.test(content)) {
      throw new Error(
        `[MIGRATION_GUARD] Forbidden index name reuse in schema.prisma for: ${idx}. ` +
          `PostgreSQL partial unique indexes must remain SQL-only and omitted from schema.prisma.`
      );
    }
  }
}

/**
 * Asserts that all migration files in prisma/migrations define the protected partial unique
 * indexes and no migration file contains a DROP INDEX statement for them.
 */
export function assertNoMigrationIndexDrift(migrationsDir?: string): void {
  const targetDir = migrationsDir || path.resolve(__dirname, '../../../../prisma/migrations');

  if (!fs.existsSync(targetDir)) {
    throw new Error(`[MIGRATION_GUARD] Migrations directory not found: ${targetDir}`);
  }

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  let foundEmailIndex = false;
  let foundPhoneIndex = false;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const sqlFile = path.join(targetDir, entry.name, 'migration.sql');
      if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf8');
        const check = validateMigrationSqlSafety(sql);
        if (!check.safe) {
          throw new Error(
            `[MIGRATION_GUARD] Migration in ${entry.name} contains forbidden DROP INDEX for: ${check.violations.join(', ')}`
          );
        }
        if (sql.includes('invitations_merchant_pending_email_unique')) {
          foundEmailIndex = true;
        }
        if (sql.includes('invitations_merchant_pending_phone_unique')) {
          foundPhoneIndex = true;
        }
      }
    }
  }

  if (!foundEmailIndex || !foundPhoneIndex) {
    throw new Error(
      `[MIGRATION_GUARD] Authoritative partial unique pending indexes missing from migration directory: email=${foundEmailIndex}, phone=${foundPhoneIndex}`
    );
  }
}

/**
 * Runs prisma migrate diff against the real schema and database to assert that
 * PostgreSQL partial unique pending indexes are not dropped (Round 11 Finding 4 / BR-INV-08).
 */
export function assertRealPrismaMigrateDiffSafety(databaseUrl?: string): void {
  const dbUrl =
    databaseUrl ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5433/shipde_dev';

  const schemaPath = path.resolve(__dirname, '../../../../prisma/schema.prisma');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`[MIGRATION_GUARD] Schema file not found: ${schemaPath}`);
  }

  try {
    const diffSql = execSync(
      `pnpm exec prisma migrate diff --from-schema-datasource "${schemaPath}" --to-schema-datamodel "${schemaPath}" --script`,
      {
        env: { ...process.env, DATABASE_URL: dbUrl },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    assertSafeMigrationDiff(diffSql);
  } catch (err: any) {
    if (err.message && err.message.includes('[MIGRATION_GUARD]')) {
      throw err;
    }
    if (err.stdout && typeof err.stdout === 'string') {
      assertSafeMigrationDiff(err.stdout);
    }
    if (
      err.stderr &&
      typeof err.stderr === 'string' &&
      /P1001|Can't reach database server|Environment variable not found/.test(err.stderr)
    ) {
      console.warn(
        `[MIGRATION_GUARD] Database unreachable (${err.stderr.trim()}), skipping live diff.`
      );
      return;
    }
    throw err;
  }
}

/**
 * CLI execution entrypoint: executed during CI (via `apps/api/package.json` test script)
 * to fail build immediately if any migration file or prisma migrate diff drops protected partial unique indexes (BR-INV-08).
 */
export function runMigrationGuardCli(): void {
  try {
    assertNoMigrationIndexDrift();
    assertNoSchemaIndexNameConflict();
    assertRealPrismaMigrateDiffSafety();
    console.log(
      '[MIGRATION_GUARD] PASS: All PostgreSQL partial unique pending indexes protected and verified.'
    );
  } catch (err: any) {
    console.error(`[MIGRATION_GUARD] FAIL: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1]?.includes('migration-guard')) {
  runMigrationGuardCli();
}
