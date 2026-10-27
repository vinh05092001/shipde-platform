import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from './rbac.service';
import { CanonicalApiException } from '../auth/auth.service';

export const PERMISSIONS_KEY = 'rbac_required_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    let role = req.userRole || req.jwtClaims?.role;
    let customRoleId = req.customRoleId;

    if (!role && req.userId) {
      try {
        const user = await (this.rbacService as any).prisma.user.findUnique({
          where: { id: req.userId },
          select: { role: true, custom_role_id: true },
        });
        if (user) {
          role = user.role;
          customRoleId = user.custom_role_id;
        }
      } catch {
        // Continue
      }
    }

    const actor = {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role,
      customRoleId,
    };

    const hasAll = await this.rbacService.actorHasPermissions(actor, requiredPermissions);
    if (!hasAll) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền thực hiện thao tác này',
        false,
        'Vui lòng liên hệ Chủ Shop để được cấp quyền'
      );
    }

    return true;
  }
}
