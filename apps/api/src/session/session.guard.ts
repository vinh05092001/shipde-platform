import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { verifyAccessToken, resolveAccessTokenSecret } from '../auth/token.util';

/**
 * Exact pathname allowlist for bounded setup-only tokens (FEAT-AUTH-05 AC-AUTH-05-12 / BR-SESS-01).
 * Matches req.path only (excluding query string) to prevent query string bypass.
 */
const SETUP_TOKEN_ALLOWED_PATHNAMES = new Set([
  '/auth/mfa/status',
  '/auth/mfa/setup',
  '/auth/mfa/setup/verify',
  '/auth/logout',
  '/api/v1/auth/mfa/status',
  '/api/v1/auth/mfa/setup',
  '/api/v1/auth/mfa/setup/verify',
  '/api/v1/auth/logout',
]);

/**
 * Session and Access-Token Auth Guard.
 * Supports:
 * 1. Standard active device sessions via SHA-256 token hash.
 * 2. Setup-only tokens (FEAT-AUTH-05 AC-AUTH-05-12) for bounded MFA enrollment.
 * 3. Attaches userId, merchantId, sessionId, authAssurance, and mfaVerifiedAt to req.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Vui lòng đăng nhập để tiếp tục',
          retryable: false,
        },
      });
    }

    const rawToken = authHeader.slice(7).trim();
    if (!rawToken) {
      throw new UnauthorizedException({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Phiên đăng nhập không hợp lệ',
          retryable: false,
        },
      });
    }

    // BR-SESS-01: Derive tenant/user scope for all accepted tokens. Reject token formats without claims.
    if (!rawToken.startsWith('v1.')) {
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_INVALID',
          message: 'Phiên đăng nhập không hợp lệ hoặc định dạng token không được hỗ trợ',
          retryable: false,
          next_action: 'LOGIN',
        },
      });
    }

    let jwtClaims: any;
    try {
      const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
      jwtClaims = verifyAccessToken(rawToken, secret);

      if (jwtClaims.scope === 'setup') {
        // Bounded setup token (AC-AUTH-05-12, BR-SESS-01)
        // Match req.path only against exact pathname allowlist to prevent query parameter bypass.
        const rawPath =
          typeof req.path === 'string'
            ? req.path
            : typeof (req as any).url === 'string'
              ? (req as any).url.split('?')[0]
              : '';
        const normalizedPath =
          rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
        const isAllowedSetupRoute = SETUP_TOKEN_ALLOWED_PATHNAMES.has(normalizedPath);

        if (!isAllowedSetupRoute) {
          throw new ForbiddenException({
            error: {
              code: 'FORBIDDEN',
              message:
                'Tài khoản của bạn bắt buộc phải hoàn tất thiết lập MFA trước khi truy cập ứng dụng',
              retryable: false,
              next_action: 'Vui lòng hoàn thành thiết lập xác thực hai yếu tố',
            },
          });
        }

        (req as any).userId = jwtClaims.sub;
        (req as any).merchantId = jwtClaims.mid ?? null;
        (req as any).userRole = jwtClaims.role;
        (req as any).isSetupOnly = true;
        return true;
      }

      // For non-setup tokens, continue to validate against DeviceSession
      (req as any).jwtClaims = jwtClaims;
    } catch (err: any) {
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_INVALID',
          message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ',
          retryable: false,
          next_action: 'LOGIN',
        },
      });
    }

    if (!jwtClaims || !jwtClaims.sub) {
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_INVALID',
          message: 'Phiên đăng nhập không hợp lệ',
          retryable: false,
          next_action: 'LOGIN',
        },
      });
    }

    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // Scoped DB validation enforced by user and tenant claims (BR-SESS-01)
    const session = await this.sessionService.validateSession(tokenHash, {
      userId: jwtClaims.sub,
      merchantId: jwtClaims.mid ?? null,
    });
    if (!session) {
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_INVALID',
          message: 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi',
          retryable: false,
          next_action: 'LOGIN',
        },
      });
    }

    // Attach session context to request for downstream use
    (req as any).userId = session.userId;
    (req as any).merchantId = session.merchantId;
    (req as any).sessionId = session.sessionId;
    (req as any).sessionTokenHash = tokenHash;
    (req as any).authAssurance = session.authAssurance;
    (req as any).mfaVerifiedAt = session.mfaVerifiedAt;

    return true;
  }
}
