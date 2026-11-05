import {
  Controller,
  Get,
  Post,
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
import { ExportsService } from './exports.service';
import { validateCreateExportJobDto, validateListExportJobsQuery } from './exports.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';

@Controller(['api/v1/exports', 'exports'])
@UseGuards(RbacSeedGuard, SessionGuard)
@UseFilters(CanonicalExceptionFilter)
export class ExportsController {
  constructor(
    @Inject(ExportsService) private readonly exportsService: ExportsService,
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
   * POST /api/v1/exports (AC-COM-05-01)
   * Requests a new export job for a resource with permission-awareness and per-row scoping.
   */
  @Post()
  async createExport(
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const validation = validateCreateExportJobDto(body);
    if (!validation.valid || !validation.dto) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu yêu cầu xuất tệp không hợp lệ',
        false,
        'Vui lòng kiểm tra lại loại tài nguyên và định dạng xuất dữ liệu',
        validation.errors
      );
    }

    const result = await this.exportsService.createExportJob(
      actor.merchantId,
      actor,
      validation.dto,
      clientIp,
      correlationId
    );

    return res.status(HttpStatus.CREATED).json(result);
  }

  /**
   * GET /api/v1/exports
   * Lists export history for the authenticated tenant with pagination and filters.
   */
  @Get()
  async listExports(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const validation = validateListExportJobsQuery(query);
    if (!validation.valid) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tham số phân trang hoặc bộ lọc không hợp lệ',
        false,
        'Vui lòng kiểm tra lại tham số trang và giới hạn',
        validation.errors
      );
    }

    const result = await this.exportsService.listExportJobs(
      actor.merchantId,
      actor,
      {
        page: validation.page,
        limit: validation.limit,
        status: validation.status,
        resource: validation.resource,
      },
      correlationId
    );

    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * GET /api/v1/exports/:id
   * Retrieves export job details, progress, and per-row results with strict tenant scoping.
   */
  @Get(':id')
  async getExport(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const result = await this.exportsService.getExportJob(
      actor.merchantId,
      actor,
      id,
      correlationId
    );
    return res.status(HttpStatus.OK).json(result);
  }

  /**
   * GET /api/v1/exports/:id/download (AC-COM-05-08)
   * Streams the generated export file with appropriate Content-Type and audit logging.
   */
  @Get(':id/download')
  async downloadExport(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);
    this.assertTenantMembership(actor);

    const download = await this.exportsService.downloadExport(
      actor.merchantId,
      actor,
      id,
      clientIp,
      correlationId
    );

    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${download.fileName}"`);
    res.setHeader('Content-Length', download.fileSize);
    res.setHeader('X-Export-Checksum', download.checksum);
    res.setHeader('x-correlation-id', correlationId);

    res.status(HttpStatus.OK).send(download.fileBuffer);
  }
}
