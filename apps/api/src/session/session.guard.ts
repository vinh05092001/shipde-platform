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

    let jwtClaims: any;
    // Check if it's a signed JWT (v1.<payload>.<signature>)
    if (rawToken.startsWith('v1.')) {
      try {
        const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
        const claims = verifyAccessToken(rawToken, secret);

        if (claims.scope === 'setup') {
          // Bounded setup token (AC-AUTH-05-12)
          const url = req.originalUrl || req.url || '';
          const isAllowedSetupRoute =
            url.includes('/auth/mfa/status') ||
            url.includes('/auth/mfa/setup') ||
            url.includes('/auth/logout');

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

          (req as any).userId = claims.sub;
          (req as any).merchantId = claims.mid;
          (req as any).userRole = claims.role;
          (req as any).isSetupOnly = true;
          return true;
        }

        // For non-setup tokens, continue to validate against DeviceSession
        jwtClaims = claims;
        (req as any).jwtClaims = claims;
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
    }

    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const session = await this.sessionService.validateSession(
      tokenHash,
      jwtClaims ? { userId: jwtClaims.sub, merchantId: jwtClaims.mid } : undefined
    );
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
