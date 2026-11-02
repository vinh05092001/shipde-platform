import type { NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';
import { resolveAccessTokenSecret, verifyAccessToken } from '../auth/token.util';

/**
 * TASK-AI-154: establishes the per-request tenant context (AsyncLocalStorage)
 * consumed by the tenant RLS Prisma extension.
 *
 * NestJS runs global middleware before guards, so the tenant cannot be read
 * from `req.merchantId` here (the SessionGuard attaches it later in the
 * pipeline). The tenant is therefore derived from the `mid` claim of the
 * access token and accepted only when the token signature verifies with this
 * service's signing secret — the same verification the SessionGuard performs
 * on every merchant route. This middleware authorizes nothing: session
 * lookup, revocation and role checks remain the SessionGuard's
 * responsibility, and it still runs after this middleware.
 *
 * RLS is defense-in-depth and never access authority. TenantMiddleware only
 * scopes PostgreSQL queries; it does not authorize requests. Session revocation,
 * user status, MFA, and route access control are strictly enforced by SessionGuard
 * and PermissionsGuard before controller handlers execute. Any query reaching the
 * database before SessionGuard remains subject to tenant isolation, but authorization
 * decisions are never delegated to RLS.
 *
 * Requests without a verified merchant claim (public routes, platform
 * operators, invalid or expired tokens) run without a tenant context. The
 * RLS pilot policy is fail-open for such sessions; the SessionGuard rejects
 * unauthenticated merchant routes before any handler can run.
 *
 * The entire downstream pipeline (guards, interceptors, controller) executes
 * as continuations of the async context established here, so
 * `getTenantId()` returns the request's merchant for the duration of the
 * request.
 */
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const tenantId = extractVerifiedMerchantId(req);
    if (tenantId) {
      runWithTenant(tenantId, () => next());
      return;
    }
    next();
  }
}

function extractVerifiedMerchantId(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const rawToken = authHeader.slice(7).trim();
  if (!rawToken.startsWith('v1.')) {
    return null;
  }
  try {
    const claims = verifyAccessToken(
      rawToken,
      resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET)
    );

    // Finding 3: Platform administrators must never be scoped to a merchant tenant.
    if (claims.role === 'PLATFORM_ADMIN') {
      return null;
    }

    // Finding 22: Scope checks. Empty, setup, or malformed scope claims deny tenant context.
    const rawScope = (claims as any).scope;
    const rawScopes = (claims as any).scopes;

    if (rawScope !== undefined) {
      if (typeof rawScope !== 'string') {
        return null;
      }
      const trimmedScope = rawScope.trim();
      if (
        trimmedScope.length === 0 ||
        trimmedScope === 'setup' ||
        trimmedScope.startsWith('setup-')
      ) {
        return null;
      }
    }

    if (rawScopes !== undefined) {
      if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
        return null;
      }
      for (const s of rawScopes) {
        if (typeof s !== 'string') {
          return null;
        }
        const trimmed = s.trim();
        if (trimmed.length === 0 || trimmed === 'setup' || trimmed.startsWith('setup-')) {
          return null;
        }
      }
    }

    if (typeof claims.mid === 'string' && claims.mid.trim().length > 0) {
      return claims.mid.trim();
    }
  } catch {
    // Unverifiable token: no tenant context. The SessionGuard rejects the
    // request before any handler can run.
  }
  return null;
}
