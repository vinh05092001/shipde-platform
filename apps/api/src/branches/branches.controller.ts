import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';

@Controller(['api/v1/branches', 'branches'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class BranchesController {
  constructor(
    @Inject(BranchesService) private readonly branchesService: BranchesService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  private async resolveActor(req: any): Promise<ActorContext> {
    if (req.actorContext) {
      return req.actorContext;
    }
    const actor = await this.rbacService.resolveActorFromSession(req);
    req.actorContext = actor;
    return actor;
  }

  /**
   * Helper to ensure actor belongs to the merchant tenant.
   */
  private assertTenantMembership(actor: ActorContext): void {
    if (!actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại'
      );
    }
  }

  /**
   * Resolve view and configuration capabilities through the authoritative RBAC
   * registry. Role codes and display names never grant branch access directly.
   */
  private async assertCanViewBranches(actor: ActorContext): Promise<void> {
    const hasPerm = await this.rbacService.actorHasPermissions(actor, ['iam:shop_config']);
    if (hasPerm) {
      return;
    }

    if (!(await this.rbacService.actorHasPermissions(actor, ['iam:shop_view']))) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền xem danh sách chi nhánh',
        false,
        'Vui lòng liên hệ Chủ Shop để được cấp quyền'
      );
    }
  }

  /**
   * GET /api/v1/branches (AC-ORG-02-01, AC-ORG-02-02, FEAT-COM-02)
   */
  @Get()
  async listBranches(
    @Query() query: any,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);
    await this.assertCanViewBranches(actor);

    const queryObj = typeof query === 'string' ? { status: query } : query || {};

    const result = await this.branchesService.listBranches(
      actor.merchantId,
      actor,
      queryObj,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/branches (AC-ORG-02-03, AC-ORG-02-04, AC-ORG-02-05)
   */
  @Post()
  @RequirePermissions('iam:shop_config')
  async createBranch(
    @Body() dto: CreateBranchDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.branchesService.createBranch(
      actor.merchantId,
      actor,
      dto,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.CREATED).json(result);
  }

  /**
   * GET /api/v1/branches/:id (AC-ORG-02-11, AC-ORG-02-12)
   */
  @Get(':id')
  async getBranchById(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);
    await this.assertCanViewBranches(actor);

    const result = await this.branchesService.getBranchById(id, actor, correlationId);
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * PATCH /api/v1/branches/:id (AC-ORG-02-06, AC-ORG-02-07, AC-ORG-02-10)
   */
  @Patch(':id')
  @RequirePermissions('iam:shop_config')
  async updateBranch(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.branchesService.updateBranch(
      id,
      actor.merchantId,
      actor,
      dto,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/branches/:id/activate (AC-ORG-02-08)
   */
  @Post(':id/activate')
  @RequirePermissions('iam:shop_config')
  async activateBranch(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.branchesService.activateBranch(
      id,
      actor.merchantId,
      actor,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/branches/:id/deactivate (AC-ORG-02-09, AC-ORG-02-10)
   */
  @Post(':id/deactivate')
  @RequirePermissions('iam:shop_config')
  async deactivateBranch(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.branchesService.deactivateBranch(
      id,
      actor.merchantId,
      actor,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * DELETE /api/v1/branches/:id
   */
  @Delete(':id')
  @RequirePermissions('iam:shop_config')
  async deleteBranch(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.branchesService.deleteBranch(
      id,
      actor.merchantId,
      actor,
      clientIp,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }
}
