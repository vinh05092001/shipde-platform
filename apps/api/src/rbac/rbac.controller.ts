import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto, ActorContext } from './rbac.dto';
import { SessionGuard } from '../session/session.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1', ''])
@UseGuards(SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class RbacController {
  constructor(@Inject(RbacService) private readonly rbacService: RbacService) {}

  private async resolveActor(req: any): Promise<ActorContext> {
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
        // Continue with whatever is present
      }
    }

    return {
      userId: req.userId as string,
      merchantId: req.merchantId as string,
      role,
      customRoleId,
      authAssurance: req.authAssurance || req.jwtClaims?.auth_assurance,
      mfaVerifiedAt: req.mfaVerifiedAt || req.jwtClaims?.mfa_verified_at,
    };
  }

  /**
   * GET /api/v1/permissions (AC-RBAC-01-01)
   */
  @Get('permissions')
  async getPermissions(@Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    return this.rbacService.getPermissions(correlationId);
  }

  /**
   * GET /api/v1/roles (AC-RBAC-01-02)
   */
  @Get('roles')
  async getRoles(@Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    return this.rbacService.getRoles(actor.merchantId, correlationId);
  }

  /**
   * GET /api/v1/roles/:id (AC-RBAC-01-11)
   */
  @Get('roles/:id')
  async getRoleById(@Param('id') id: string, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    return this.rbacService.getRoleById(id, actor, correlationId);
  }

  /**
   * POST /api/v1/roles (AC-RBAC-01-03, 04, 05, 12, 13, 14, 15)
   */
  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  async createRole(@Body() dto: CreateRoleDto, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    return this.rbacService.createRole(dto, actor, clientIp, correlationId);
  }

  /**
   * PATCH /api/v1/roles/:id (AC-RBAC-01-06, 08, 11)
   */
  @Patch('roles/:id')
  @HttpCode(HttpStatus.OK)
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    return this.rbacService.updateRole(id, dto, actor, clientIp, correlationId);
  }

  /**
   * DELETE /api/v1/roles/:id (AC-RBAC-01-07, 09, 10, 11)
   */
  @Delete('roles/:id')
  @HttpCode(HttpStatus.OK)
  async deleteRole(@Param('id') id: string, @Req() req: any) {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    return this.rbacService.deleteRole(id, actor, clientIp, correlationId);
  }
}
