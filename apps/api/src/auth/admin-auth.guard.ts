import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatusEnum, RoleEnum } from '@prisma/client';
import { CanonicalApiException } from './auth.service';
import { verifyAccessToken, resolveAccessTokenSecret } from './token.util';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    const authHeader = req.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Phiên đăng nhập không tồn tại hoặc đã hết hạn',
        false,
        'Vui lòng đăng nhập với tài khoản Quản trị viên nền tảng'
      );
    }

    const rawToken = authHeader.slice(7).trim();
    if (!rawToken) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Phiên đăng nhập không hợp lệ',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    let jwtClaims: any = null;
    if (rawToken.startsWith('v1.')) {
      try {
        const secret = resolveAccessTokenSecret(process.env.AUTH_TOKEN_SECRET);
        jwtClaims = verifyAccessToken(rawToken, secret);
      } catch {
        throw new CanonicalApiException(
          HttpStatus.UNAUTHORIZED,
          'SESSION_INVALID',
          'Phiên đăng nhập đã hết hạn hoặc không hợp lệ',
          false,
          'Vui lòng đăng nhập lại'
        );
      }
    }

    // If Prisma is available, validate session against database
    if (this.prisma) {
      const now = new Date();
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      const session = await this.prisma.deviceSession.findFirst({
        where: {
          OR: [
            { session_token_hash: tokenHash },
            ...(jwtClaims?.sid ? [{ id: jwtClaims.sid }] : []),
          ],
          status: SessionStatusEnum.ACTIVE,
          expires_at: { gt: now },
        },
        include: {
          user: true,
        },
      });

      if (!session || !session.user) {
        throw new CanonicalApiException(
          HttpStatus.UNAUTHORIZED,
          'SESSION_INVALID',
          'Phiên đăng nhập đã hết hạn hoặc bị thu hồi',
          false,
          'Vui lòng đăng nhập lại'
        );
      }

      if (session.user.role !== RoleEnum.PLATFORM_ADMIN) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Truy cập bị từ chối: Yêu cầu quyền quản trị viên nền tảng (PLATFORM_ADMIN)',
          false,
          'Chỉ quản trị viên nền tảng mới có quyền truy cập khu vực này'
        );
      }

      (req as any).userId = session.user.id;
      (req as any).adminActor = session.user.id;
      (req as any).user = session.user;
      (req as any).session = session;
      return true;
    }

    // Fallback when Prisma is not injected (e.g. unit test environment)
    if (!jwtClaims) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'SESSION_INVALID',
        'Phiên đăng nhập không hợp lệ',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    if (jwtClaims.role !== RoleEnum.PLATFORM_ADMIN && jwtClaims.role !== 'PLATFORM_ADMIN') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Truy cập bị từ chối: Yêu cầu quyền quản trị viên nền tảng (PLATFORM_ADMIN)',
        false,
        'Chỉ quản trị viên nền tảng mới có quyền truy cập khu vực này'
      );
    }

    (req as any).userId = jwtClaims.sub;
    (req as any).adminActor = jwtClaims.sub;
    return true;
  }
}
