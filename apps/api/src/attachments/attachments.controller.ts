import {
  Controller,
  Get,
  Post,
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
import { AttachmentsService } from './attachments.service';
import {
  UploadAttachmentDto,
  ListAttachmentsQueryDto,
  RetentionPurgeDto,
  BulkDeleteAttachmentsDto,
  validateUploadAttachmentDto,
  validateDeleteAttachmentDto,
  validateBulkDeleteDto,
} from './attachments.dto';
import { SessionGuard } from '../session/session.guard';
import { RbacSeedGuard, PermissionsGuard, RequirePermissions } from '../rbac/rbac.guard';
import { CanonicalExceptionFilter } from '../auth/canonical-exception.filter';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { normalizeCorrelationId, AppConfig } from '@shipde/config';
import { extractClientIp } from '../utils/ip.util';
import { CanonicalApiException } from '../auth/auth.service';
import { APP_CONFIG } from '../config.token';

@Controller(['api/v1/attachments', 'attachments'])
@UseGuards(RbacSeedGuard, SessionGuard, PermissionsGuard)
@UseFilters(CanonicalExceptionFilter)
export class AttachmentsController {
  constructor(
    @Inject(AttachmentsService) private readonly attachmentsService: AttachmentsService,
    @Inject(RbacService) private readonly rbacService: RbacService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
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
   * POST /api/v1/attachments/upload (AC-COM-06-01 .. 06)
   */
  @Post('upload')
  async uploadAttachment(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: UploadAttachmentDto
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const ipAddress = extractClientIp(req);

    // Validate DTO and payload bounds
    const validation = validateUploadAttachmentDto(body, this.config.MAX_ATTACHMENT_SIZE_BYTES);
    if (!validation.valid || !validation.buffer) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        validation.errorCode || 'VALIDATION_ERROR',
        validation.message || 'Dữ liệu tệp đính kèm không hợp lệ.',
        false,
        undefined,
        validation.fields
      );
    }

    const attachment = await this.attachmentsService.uploadAttachment(
      actor,
      body,
      validation.buffer,
      ipAddress,
      correlationId
    );

    return res.status(HttpStatus.CREATED).json({
      success: true,
      data: attachment,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * GET /api/v1/attachments (AC-COM-06-07 .. 09)
   */
  @Get()
  async listAttachments(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: ListAttachmentsQueryDto
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const result = await this.attachmentsService.listAttachments(actor, query, correlationId);

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result.data,
      meta: result.meta,
    });
  }

  /**
   * POST /api/v1/attachments/retention-purge (AC-COM-06-19)
   */
  @Post('retention-purge')
  @RequirePermissions('iam:shop_config')
  async purgeRetention(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: RetentionPurgeDto
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const ipAddress = extractClientIp(req);

    const result = await this.attachmentsService.purgeExpiredRetention(
      actor,
      body || {},
      ipAddress,
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: result.success,
      data: result,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * POST /api/v1/attachments/bulk-delete (AC-COM-06-20, 21)
   */
  @Post('bulk-delete')
  async bulkDelete(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: BulkDeleteAttachmentsDto
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const ipAddress = extractClientIp(req);

    const validation = validateBulkDeleteDto(body);
    if (!validation.valid) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        validation.errorCode || 'VALIDATION_ERROR',
        validation.message || 'Yêu cầu xóa hàng loạt không hợp lệ.',
        false,
        undefined,
        validation.fields
      );
    }

    const result = await this.attachmentsService.bulkDeleteAttachments(
      actor,
      body,
      ipAddress,
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: result.success,
      data: result,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * GET /api/v1/attachments/:id (AC-COM-06-10 .. 12)
   */
  @Get(':id')
  async getAttachment(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const attachment = await this.attachmentsService.getAttachment(actor, id, correlationId);

    return res.status(HttpStatus.OK).json({
      success: true,
      data: attachment,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * GET /api/v1/attachments/:id/download (AC-COM-06-13, 14)
   */
  @Get(':id/download')
  async downloadAttachment(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string
  ): Promise<void> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const ipAddress = extractClientIp(req);

    const result = await this.attachmentsService.downloadAttachment(
      actor,
      id,
      ipAddress,
      correlationId
    );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${result.fileName}"`);
    res.setHeader('Content-Length', result.fileSize);
    res.setHeader('x-correlation-id', correlationId);

    res.status(HttpStatus.OK).send(result.buffer);
  }

  /**
   * DELETE /api/v1/attachments/:id (AC-COM-06-15 .. 18)
   */
  @Delete(':id')
  async deleteAttachment(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: any,
    @Query('confirm') confirmQuery: string
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);
    const ipAddress = extractClientIp(req);

    const confirm = body?.confirm === true || body?.confirm === 'true' || confirmQuery === 'true';

    if (confirm !== true) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_REQUIRED',
        'Hành động xóa tệp đính kèm yêu cầu xác nhận rõ ràng (confirm: true).'
      );
    }

    const result = await this.attachmentsService.deleteAttachment(
      actor,
      id,
      true,
      ipAddress,
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * POST /api/v1/attachments/:id/quarantine (Finding 1: Quarantine lifecycle)
   */
  @Post(':id/quarantine')
  @RequirePermissions('iam:shop_config')
  async quarantineAttachment(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Body('reason') reason?: string
  ): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const result = await this.attachmentsService.quarantineAttachment(
      actor,
      id,
      reason || 'Quarantined by safety policy',
      correlationId
    );

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result,
      meta: { correlation_id: correlationId },
    });
  }

  /**
   * POST /api/v1/attachments/reconcile-pending (Finding 6: Reconcile pending deletions)
   */
  @Post('reconcile-pending')
  @RequirePermissions('iam:shop_config')
  async reconcilePending(@Req() req: Request, @Res() res: Response): Promise<Response> {
    const correlationId = (req as any).correlationId || normalizeCorrelationId();
    const actor = await this.resolveActor(req);

    const result = await this.attachmentsService.reconcilePendingDeletions(actor, correlationId);

    return res.status(HttpStatus.OK).json({
      success: true,
      data: result,
      meta: { correlation_id: correlationId },
    });
  }
}
