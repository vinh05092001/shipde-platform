/**
 * Resolves the frontend base URL strictly from allowlisted environment configurations.
 * Prevents host-header/Origin injection attacks that could leak raw tokens to attacker servers (SECURITY-NFR / BR-INV-02).
 */
export function resolveFrontendBaseUrl(requestOrigin?: string): string {
  const configured = [
    process.env.FRONTEND_URL,
    process.env.APP_BASE_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
  ].filter(Boolean) as string[];

  const defaultBaseUrl =
    process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:3000';

  if (!requestOrigin) {
    return defaultBaseUrl;
  }

  try {
    const originHost = new URL(requestOrigin).origin;
    const isAllowlisted = configured.some((allowed) => {
      try {
        return new URL(allowed).origin === originHost;
      } catch {
        return false;
      }
    });

    if (isAllowlisted) {
      return originHost;
    }
  } catch {
    // Malformed origin header
  }

  return defaultBaseUrl;
}
