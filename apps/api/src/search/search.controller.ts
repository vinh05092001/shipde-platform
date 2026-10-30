import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SearchService } from './search.service';
import { SearchQueryDto } from './search.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';

@Controller(['api/v1/search', 'search'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
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
   * GET /api/v1/search (AC-COM-01-01..15)
   * Unified global search across orders, waybills, batches, cases, and transactions.
   */
  @Get()
  async search(
    @Query() query: SearchQueryDto,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const actor = await this.resolveActor(req);
    const clientIp = extractClientIp(req);
    const correlationId = normalizeCorrelationId(
      (req.headers['x-correlation-id'] as string) || (req.headers['correlation-id'] as string)
    );

    const result = await this.searchService.search(actor, query, clientIp, correlationId);

    return res.status(HttpStatus.OK).json(result);
  }
}
