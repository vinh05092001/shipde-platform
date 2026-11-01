/**
 * Redacts username and password credentials from database connection URLs
 * to ensure diagnostics and logs never leak secrets. (Finding 9)
 */
export function redactDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return rawUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://***:***@');
  }
}
