import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Req,
  Res,
  HttpStatus,
  UseGuards,
  UseFilters,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ImportsService } from './imports.service';
import {
  UploadImportDto,
  ListImportsDto,
  ListImportRowsDto,
  validateUploadImportDto,
} from './imports.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';

@Controller(['api/v1/imports', 'imports'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class ImportsController {
  constructor(
    @Inject(ImportsService) private readonly importsService: ImportsService,
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
   * GET /api/v1/imports/templates/:templateType (COM-04-01)
   */
  @Get('templates/:templateType')
  @RequirePermissions('iam:shop_config')
  async downloadTemplate(
    @Param('templateType') templateType: string,
    @Query('format') format: string,
    @Res() res: Response
  ): Promise<void> {
    const cleanFormat = format === 'xlsx' ? 'xlsx' : 'csv';
    const result = this.importsService.getTemplate(templateType, cleanFormat);

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.status(HttpStatus.OK).send(result.buffer);
  }

  /**
   * POST /api/v1/imports/upload (COM-04-01, COM-04-02, COM-04-06)
   */
  @Post('upload')
  @RequirePermissions('iam:shop_config')
  async uploadImport(
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);

    const dto = validateUploadImportDto(body);

    let fileBuffer: Buffer;
    let fileName = dto.file_name || `import_${dto.template_type}.csv`;
    let mimeType = 'text/csv';

    if (dto.file_base64) {
      try {
        fileBuffer = Buffer.from(dto.file_base64, 'base64');
      } catch {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'INVALID_BASE64',
          'Dữ liệu file_base64 không phải là chuỗi base64 hợp lệ',
          false
        );
      }
      if (fileName.toLowerCase().endsWith('.xlsx')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
    } else if (dto.content !== undefined) {
      fileBuffer = Buffer.from(dto.content, 'utf8');
      mimeType = 'text/csv';
    } else {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'MISSING_FILE_CONTENT',
        'Nội dung tệp tin (content hoặc file_base64) là bắt buộc',
        false,
        undefined,
        [
          {
            field: 'content',
            code: 'MISSING_FILE_CONTENT',
            message: 'Thiếu nội dung tệp tin',
          },
        ]
      );
    }

    const result = await this.importsService.uploadAndProcess(
      actor.merchantId,
      actor,
      dto,
      fileBuffer,
      fileName,
      mimeType,
      idempotencyKey,
      correlationId,
      clientIp
    );

    return res.status(result.statusCode).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  /**
   * GET /api/v1/imports/:id (COM-04-03, COM-04-04, COM-04-05)
   */
  @Get(':id')
  @RequirePermissions('iam:shop_config')
  async getImportDetail(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const result = await this.importsService.getImportDetail(id, actor.merchantId, correlationId);
    return res.status(HttpStatus.OK).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  /**
   * GET /api/v1/imports/:id/rows (COM-04-05)
   */
  @Get(':id/rows')
  @RequirePermissions('iam:shop_config')
  async listImportRows(
    @Param('id') id: string,
    @Query('status') status: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    const result = await this.importsService.listImportRows(
      id,
      actor.merchantId,
      {
        status,
        page: isNaN(parsedPage) ? 1 : parsedPage,
        limit: isNaN(parsedLimit) ? 50 : parsedLimit,
      },
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  /**
   * GET /api/v1/imports/:id/issues/export (COM-04-03)
   */
  @Get(':id/issues/export')
  @RequirePermissions('iam:shop_config')
  async exportIssues(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const csvContent = await this.importsService.exportIssuesCsv(
      id,
      actor.merchantId,
      correlationId
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="issues_${id}.csv"`);
    res.status(HttpStatus.OK).send('\uFEFF' + csvContent);
  }

  /**
   * POST /api/v1/imports/:id/promote (COM-04-07, COM-04-08, COM-04-09)
   */
  @Post(':id/promote')
  @RequirePermissions('iam:shop_config')
  async promoteImport(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const clientIp = extractClientIp(req);
    const actor = await this.resolveActor(req);

    const result = await this.importsService.promoteImport(
      id,
      actor.merchantId,
      actor,
      correlationId,
      clientIp
    );

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  /**
   * GET /api/v1/imports
   */
  @Get()
  @RequirePermissions('iam:shop_config')
  async listImports(
    @Query('template_type') templateType: string,
    @Query('status') status: string,
    @Query('limit') limit: string,
    @Query('offset') offset: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const result = await this.importsService.listImports(
      actor.merchantId,
      {
        template_type: templateType,
        status,
        limit: isNaN(parsedLimit) ? 20 : parsedLimit,
        offset: isNaN(parsedOffset) ? 0 : parsedOffset,
      },
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }
}
