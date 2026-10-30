import {
  Controller,
  Get,
  Post,
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
import { OnboardingService } from './onboarding.service';
import { CompleteStepDto } from './onboarding.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';

@Controller(['api/v1/onboarding', 'onboarding'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class OnboardingController {
  constructor(
    @Inject(OnboardingService) private readonly onboardingService: OnboardingService,
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
   * Resolve view capabilities through the authoritative RBAC registry.
   * Role codes and display names never grant onboarding access directly.
   */
  private async assertCanViewOnboarding(actor: ActorContext): Promise<void> {
    const hasConfig = await this.rbacService.actorHasPermissions(actor, ['iam:shop_config']);
    if (hasConfig) {
      return;
    }
    const hasView = await this.rbacService.actorHasPermissions(actor, ['iam:shop_view']);
    if (hasView) {
      return;
    }
    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Bạn không có quyền xem thông tin thiết lập ban đầu của cửa hàng',
      false,
      'Vui lòng liên hệ Chủ Shop để được cấp quyền'
    );
  }

  /**
   * GET /api/v1/onboarding (AC-ONB-01-01, AC-ONB-01-15)
   */
  @Get()
  async getOnboarding(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);
    await this.assertCanViewOnboarding(actor);
    const canEdit = await this.rbacService.actorHasPermissions(actor, ['iam:shop_config']);

    const result = await this.onboardingService.getOnboardingState(
      actor.merchantId,
      correlationId,
      clientIp,
      canEdit
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/onboarding/steps/:stepId/complete (AC-ONB-01-02..04, AC-ONB-01-07, AC-ONB-01-14)
   */
  @Post('steps/:stepId/complete')
  @RequirePermissions('iam:shop_config')
  async completeStep(
    @Param('stepId') stepId: string,
    @Body() dto: CompleteStepDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.onboardingService.completeStep(
      actor.merchantId,
      stepId,
      dto,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/onboarding/steps/:stepId/skip (AC-ONB-01-05, AC-ONB-01-06)
   */
  @Post('steps/:stepId/skip')
  @RequirePermissions('iam:shop_config')
  async skipStep(
    @Param('stepId') stepId: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.onboardingService.skipStep(
      actor.merchantId,
      stepId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/onboarding/reset (AC-ONB-01-10)
   */
  @Post('reset')
  @RequirePermissions('iam:shop_config')
  async resetOnboarding(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.onboardingService.resetOnboarding(
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * POST /api/v1/onboarding/dismiss (AC-ONB-01-08, AC-ONB-01-09)
   */
  @Post('dismiss')
  @RequirePermissions('iam:shop_config')
  async dismissOnboarding(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.onboardingService.dismissOnboarding(
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );
    return res.status(HttpStatus.OK).json(result);
  }
}
