import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
  Headers,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BulkService } from './bulk.service';
import { validateBulkActionDto } from './bulk.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId, resolveBulkActionMaxItems } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';

@Controller(['api/v1/bulk-actions', 'bulk-actions'])
@UseGuards(RbacSeedGuard, SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class BulkController {
  constructor(
    @Inject(BulkService) private readonly bulkService: BulkService,
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

  private assertTenantMembership(actor: ActorContext): void {
    if (!actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false,
        'Vui lòng đăng nhập lại vào cửa hàng của bạn'
      );
    }
  }

  /**
   * POST /api/v1/bulk-actions (FEAT-COM-03)
   * Executes permission-aware bulk actions with per-item truthful results.
   */
  @Post()
  async executeBulkAction(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKeyHeader: string | undefined,
    @Headers('x-idempotency-key') xIdempotencyKeyHeader: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    // Validate DTO with configured max items cap (no hardcode, fails closed on invalid config)
    const maxItems = resolveBulkActionMaxItems();
    const validatedDto = validateBulkActionDto(body, maxItems);

    const effectiveIdempotencyKey = idempotencyKeyHeader || xIdempotencyKeyHeader;

    const result = await this.bulkService.executeBulkAction(
      actor.merchantId,
      actor,
      validatedDto,
      clientIp,
      correlationId,
      effectiveIdempotencyKey
    );

    return res.status(HttpStatus.OK).json(result);
  }
}
