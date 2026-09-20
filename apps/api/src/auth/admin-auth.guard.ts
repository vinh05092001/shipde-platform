import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Platform admin API key guard (BR-ADMIN-01).
 *
 * Validates the X-Platform-Admin-Key header against the PLATFORM_ADMIN_KEY
 * environment variable. Returns 403 FORBIDDEN if the key is missing or
 * does not match.
 *
 * This is an intentionally minimal admin authentication boundary for the
 * operator provisioning flow. A full RBAC admin user model is out of scope
 * for FEAT-AUTH-02.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const providedKey = request.headers['x-platform-admin-key'] as string | undefined;

    const expectedKey = process.env.PLATFORM_ADMIN_KEY;

    if (!expectedKey) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Platform admin key is not configured. Contact system administrator.',
          retryable: false,
        },
      });
    }

    if (!providedKey || providedKey !== expectedKey) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Invalid or missing platform admin key.',
          retryable: false,
        },
      });
    }

    return true;
  }
}
