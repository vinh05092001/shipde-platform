import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ShopsService } from './shops.service';
import { UpdateShopProfileDto } from './shops.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller(['api/v1/shops', 'shops'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class ShopsController {
  constructor(
    @Inject(ShopsService) private readonly shopsService: ShopsService,
    @Inject(RbacService) private readonly rbacService: RbacService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  private async resolveActor(req: any): Promise<ActorContext> {
    if (req.actorContext) {
      return req.actorContext;
    }
    const actor = await this.rbacService.resolveActorFromSession(req);
    req.actorContext = actor;
    return actor;
  }

  private async assertCanViewShopConfig(actor: ActorContext): Promise<void> {
    const hasPerm = await this.rbacService.actorHasPermissions(actor, ['iam:shop_config']);
    const allowedRoles = ['OWNER', 'OPS_CSKH', 'FINANCE'];
    let roleCode = actor.role;
    if (actor.customRoleId) {
      const customRole = await this.prisma.role.findUnique({
        where: { id: actor.customRoleId },
        select: { code: true, name: true },
      });
      if (customRole?.code) {
        roleCode = customRole.code;
      } else if (
        customRole?.name &&
        (customRole.name.toUpperCase().includes('FINANCE') ||
          customRole.name.toUpperCase().includes('TÀI CHÍNH'))
      ) {
        roleCode = 'FINANCE';
      }
    }
    if (!hasPerm && (!roleCode || !allowedRoles.includes(roleCode))) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền xem cấu hình cửa hàng',
        false,
        'Vui lòng liên hệ Chủ Shop để được cấp quyền'
      );
    }
  }

  /**
   * GET /api/v1/shops/profile (AC-ORG-01-01)
   */
  @Get('profile')
  async getProfile(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    await this.assertCanViewShopConfig(actor);
    const result = await this.shopsService.getShopProfile(actor.merchantId, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * PATCH /api/v1/shops/profile (AC-ORG-01-02..08)
   */
  @Patch('profile')
  @RequirePermissions('iam:shop_config')
  async updateProfile(
    @Body() dto: UpdateShopProfileDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.shopsService.updateShopProfile(
      actor.merchantId,
      actor,
      dto,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * GET /api/v1/shops (AC-ORG-01-12)
   */
  @Get()
  async listShops(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    await this.assertCanViewShopConfig(actor);
    const result = await this.shopsService.listShops(actor.merchantId, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * GET /api/v1/shops/:id (AC-ORG-01-10)
   */
  @Get(':id')
  async getShopById(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    await this.assertCanViewShopConfig(actor);
    const result = await this.shopsService.getShopById(id, actor, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * PATCH /api/v1/shops/:id (AC-ORG-01-10)
   */
  @Patch(':id')
  @RequirePermissions('iam:shop_config')
  async updateShopById(
    @Param('id') id: string,
    @Body() dto: UpdateShopProfileDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    const result = await this.shopsService.updateShopById(id, actor, dto, clientIp, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }
}
