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

/**
 * Lightweight session-based auth guard for FEAT-AUTH-06.
 *
 * Reads a `session_token` from the `Authorization: Bearer <token>` header,
 * hashes it, and validates it against DeviceSession table.
 *
 * On success, attaches userId, merchantId, sessionId, and sessionTokenHash
 * to the request object for downstream use.
 *
 * When FEAT-AUTH-03 (login + JWT) merges, this guard will be upgraded to
 * validate JWT claims first, then resolve the session from the JWT payload.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  // Explicit @Inject, like every other injectable in this app. The test and
  // dev paths run through tsx, and esbuild does not emit decorator metadata
  // whatever tsconfig says, so Nest has no parameter type to resolve and
  // hands the constructor undefined. The guard then died on
  // `this.sessionService.validateSession` with a 500 that read as an auth
  // failure rather than a wiring one.
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

    if (rawToken.startsWith('v1.')) {
      try {
        const { resolveAccessTokenSecret, verifyAccessToken } = await import('../auth/token.util');
        const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
        const claims = verifyAccessToken(rawToken, secret);
        if (claims.scope === 'mfa_setup') {
          throw new ForbiddenException({
            error: {
              code: 'FORBIDDEN',
              message: 'Token thiết lập MFA không có quyền truy cập dữ liệu cửa hàng',
              retryable: false,
            },
          });
        }
        (req as any).userId = claims.sub;
        (req as any).merchantId = claims.mid;
        (req as any).sessionId = claims.sid;
        (req as any).role = claims.role;
        return true;
      } catch (err: any) {
        if (err instanceof ForbiddenException) {
          throw err;
        }
        throw new UnauthorizedException({
          error: {
            code: 'SESSION_INVALID',
            message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ',
            retryable: false,
            next_action: 'Vui lòng đăng nhập lại',
          },
        });
      }
    }

    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const session = await this.sessionService.validateSession(tokenHash);
    if (!session) {
      throw new UnauthorizedException({
        error: {
          code: 'SESSION_INVALID',
          message: 'Phiên đăng nhập đã hết hạn hoặc bị thu hồi',
          retryable: false,
          next_action: 'Vui lòng đăng nhập lại',
        },
      });
    }

    // Attach session context to request for downstream use
    (req as any).userId = session.userId;
    (req as any).merchantId = session.merchantId;
    (req as any).sessionId = session.sessionId;
    (req as any).sessionTokenHash = tokenHash;

    return true;
  }
}
