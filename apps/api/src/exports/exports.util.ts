/**
 * Redacts username and password credentials from database connection URLs
 * to ensure diagnostics and logs never leak secrets. (Finding 9)
 */
export function redactDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (/(user|password|pass|token|secret|credential|api.?key)/i.test(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    // An invalid URL cannot be safely parsed into public and credential fields.
    return '[invalid database URL]';
  }
}

export async function handleUnavailableDatabase(
  databaseUrl: string,
  close: () => Promise<void>,
  isCi: boolean
): Promise<void> {
  const redactedUrl = redactDatabaseUrl(databaseUrl);
  await close();
  if (isCi) {
    throw new Error(`Database must be reachable in CI environment at ${redactedUrl}`);
  }
  console.warn(
    `⚠️ PostgreSQL is not reachable at ${redactedUrl}. Skipping live Exports Supertest tests (run 'pnpm infra:up' to enable).`
  );
}
