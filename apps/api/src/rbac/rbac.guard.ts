import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService, CanonicalApiException } from './rbac.service';

export const PERMISSIONS_KEY = 'rbac_required_permissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class RbacSeedGuard implements CanActivate {
  constructor(@Inject(RbacService) private readonly rbacService: RbacService) {}

  canActivate(): boolean {
    this.rbacService.assertPlatformSeedReady();
    return true;
  }
}

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
    const actor = await this.rbacService.resolveActorFromSession(req);

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

    req.actorContext = actor;
    return true;
  }
}
