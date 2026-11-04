import { ForbiddenException, type NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';
import { resolveAccessTokenSecret, verifyAccessToken } from '../auth/token.util';

export interface TenantResolution {
  status: 'ESTABLISHED' | 'NONE' | 'DENIED';
  tenantId?: string;
  reason?: string;
}

const SETUP_ALLOWED_PATHNAMES = new Set([
  '/auth/mfa/status',
  '/auth/mfa/setup',
  '/auth/mfa/setup/verify',
  '/auth/logout',
  '/api/v1/auth/mfa/status',
  '/api/v1/auth/mfa/setup',
  '/api/v1/auth/mfa/setup/verify',
  '/api/v1/auth/logout',
]);

function isSetupPath(req: Request): boolean {
  const rawPath =
    typeof (req as any).originalUrl === 'string' && (req as any).originalUrl.length > 0
      ? (req as any).originalUrl.split('?')[0]
      : typeof req.path === 'string' && req.path.length > 0 && req.path !== '/'
        ? req.path
        : typeof (req as any).url === 'string'
          ? (req as any).url.split('?')[0]
          : '';
  const normalizedPath =
    rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  return SETUP_ALLOWED_PATHNAMES.has(normalizedPath);
}

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
 * Reject invalid merchant scopes before protected handlers execute (Finding 1):
 * When an authenticated merchant token contains an invalid or empty scope, the
 * middleware rejects the request with HTTP 403 Forbidden rather than allowing it
 * to continue uncontexted into the pilot fail-open RLS bypass.
 *
 * The entire downstream pipeline (guards, interceptors, controller) executes
 * as continuations of the async context established here, so
 * `getTenantId()` returns the request's merchant for the duration of the
 * request.
 */
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const resolution = resolveTenantContext(req);
    if (resolution.status === 'DENIED') {
      if (res && typeof res.status === 'function') {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: resolution.reason || 'Truy cập bị từ chối: Phạm vi quyền (scope) không hợp lệ',
            retryable: false,
          },
        });
        return;
      }
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: resolution.reason || 'Truy cập bị từ chối: Phạm vi quyền (scope) không hợp lệ',
          retryable: false,
        },
      });
    }

    if (resolution.status === 'ESTABLISHED' && resolution.tenantId) {
      runWithTenant(resolution.tenantId, () => next());
      return;
    }

    next();
  }
}

export function extractVerifiedMerchantId(req: Request): string | null {
  const resolution = resolveTenantContext(req);
  return resolution.status === 'ESTABLISHED' && resolution.tenantId ? resolution.tenantId : null;
}

export function resolveTenantContext(req: Request): TenantResolution {
  const authHeader = req.headers['authorization'];
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { status: 'NONE' };
  }
  const rawToken = authHeader.slice(7).trim();
  if (!rawToken.startsWith('v1.')) {
    return { status: 'NONE' };
  }
  try {
    const claims = verifyAccessToken(
      rawToken,
      resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET)
    );

    // Finding 3: Platform administrators must never be scoped to a merchant tenant.
    if (claims.role === 'PLATFORM_ADMIN') {
      return { status: 'NONE' };
    }

    // Requests without a merchant ID run uncontexted (pilot fail-open / public / unauthenticated)
    if (typeof claims.mid !== 'string' || claims.mid.trim().length > 0 === false) {
      return { status: 'NONE' };
    }

    // Finding 1 & 22: Scope checks. Empty, setup, or malformed scope claims deny tenant context
    // and fail closed (reject request before protected handlers execute).
    const rawScope = (claims as any).scope;
    const rawScopes = (claims as any).scopes;

    if (rawScope !== undefined) {
      if (typeof rawScope !== 'string') {
        return { status: 'DENIED', reason: 'Scope claim must be a string' };
      }
      const trimmedScope = rawScope.trim();
      if (trimmedScope.length === 0) {
        return { status: 'DENIED', reason: 'Scope claim cannot be empty or whitespace-only' };
      }
      if (trimmedScope === 'setup' || trimmedScope.startsWith('setup-')) {
        if (isSetupPath(req)) {
          return { status: 'NONE' };
        }
        return {
          status: 'DENIED',
          reason: 'Setup-scoped token cannot access protected merchant resources',
        };
      }
    }

    if (rawScopes !== undefined) {
      if (!Array.isArray(rawScopes) || rawScopes.length === 0) {
        return { status: 'DENIED', reason: 'Scopes claim must be a non-empty array' };
      }
      for (const s of rawScopes) {
        if (typeof s !== 'string') {
          return { status: 'DENIED', reason: 'Scopes array elements must be strings' };
        }
        const trimmed = s.trim();
        if (trimmed.length === 0) {
          return {
            status: 'DENIED',
            reason: 'Scopes array elements cannot be empty or whitespace-only',
          };
        }
        if (trimmed === 'setup' || trimmed.startsWith('setup-')) {
          if (isSetupPath(req)) {
            return { status: 'NONE' };
          }
          return {
            status: 'DENIED',
            reason: 'Setup-scoped token cannot access protected merchant resources',
          };
        }
      }
    }

    return { status: 'ESTABLISHED', tenantId: claims.mid.trim() };
  } catch {
    // Unverifiable token: no tenant context. The SessionGuard rejects the
    // request before any handler can run.
    return { status: 'NONE' };
  }
}
