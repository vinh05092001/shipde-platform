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
 * Sanitizes prisma migrate diff SQL output by stripping any generated DROP INDEX statements
 * targeting the protected PostgreSQL partial unique indexes, ensuring they survive automated
 * Prisma migrate diff schema synchronization without index degradation (BR-INV-08).
 */
export function sanitizePrismaMigrateDiff(diffSql: string): string {
  const lines = diffSql.split('\n');
  const safeLines: string[] = [];

  for (const line of lines) {
    let shouldDrop = false;
    for (const idx of PROTECTED_PARTIAL_INDEXES) {
      const dropPattern = new RegExp(
        `DROP\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?(?:["']?${idx}["']?)`,
        'i'
      );
      if (dropPattern.test(line)) {
        shouldDrop = true;
        break;
      }
    }
    if (!shouldDrop) {
      safeLines.push(line);
    }
  }

  return safeLines.join('\n');
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
