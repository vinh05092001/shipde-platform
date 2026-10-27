import * as fs from 'fs';
import * as path from 'path';

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
    const dropPattern = new RegExp(
      `DROP\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?(?:["']?${idx}["']?)`,
      'i'
    );
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
 * CLI execution entrypoint: executed during CI (via `apps/api/package.json` test script)
 * to fail build immediately if any migration file or prisma migrate diff drops protected partial unique indexes (BR-INV-08).
 */
export function runMigrationGuardCli(): void {
  try {
    assertNoMigrationIndexDrift();
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
