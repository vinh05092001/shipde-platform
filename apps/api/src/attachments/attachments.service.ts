import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import {
  UploadAttachmentDto,
  ListAttachmentsQueryDto,
  RetentionPurgeDto,
  BulkDeleteAttachmentsDto,
  isValidUuid,
  sanitizeFileName,
  maskAttachmentAuditObject,
} from './attachments.dto';
import {
  FormattedAttachment,
  AttachmentBulkActionResult,
  AttachmentAuditEvent,
} from '@shipde/contracts';

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  public hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex')
      .substring(0, 16);
  }

  public formatAttachment(att: any): FormattedAttachment {
    return {
      id: att.id,
      merchant_id: att.merchant_id,
      file_name: att.file_name,
      file_size: Number(att.file_size),
      mime_type: att.mime_type,
      checksum_sha256: att.checksum_sha256,
      storage_key: att.storage_key,
      entity_type: att.entity_type,
      entity_id: att.entity_id ?? null,
      branch_id: att.branch_id ?? null,
      warehouse_id: att.warehouse_id ?? null,
      uploaded_by: att.uploaded_by,
      status: att.status,
      retention_days: att.retention_days ?? null,
      expires_at:
        att.expires_at instanceof Date ? att.expires_at.toISOString() : (att.expires_at ?? null),
      metadata: (att.metadata as Record<string, unknown>) ?? null,
      created_at: att.created_at instanceof Date ? att.created_at.toISOString() : att.created_at,
      updated_at: att.updated_at instanceof Date ? att.updated_at.toISOString() : att.updated_at,
    };
  }

  /**
   * Fetches the actor's live warehouse and branch/store scopes from the database.
   * If actor is OWNER, scopes include wildcard '*'.
   */
  public async getActorScopes(
    actor: ActorContext
  ): Promise<{ warehouseScopes: string[]; storeScopes: string[]; isOwner: boolean }> {
    if (!actor.userId) {
      return { warehouseScopes: [], storeScopes: [], isOwner: false };
    }
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: { role: true, warehouse_scopes: true, store_scopes: true },
    });

    const isOwner = user?.role === 'OWNER' || actor.role === 'OWNER';
    const warehouseScopes = isOwner
      ? ['*']
      : user?.warehouse_scopes && user.warehouse_scopes.length > 0
        ? user.warehouse_scopes
        : [];
    const storeScopes = isOwner
      ? ['*']
      : user?.store_scopes && user.store_scopes.length > 0
        ? user.store_scopes
        : [];

    return { warehouseScopes, storeScopes, isOwner };
  }

  /**
   * Evaluates if the actor is permitted to access an attachment per FEAT-RBAC-02.
   */
  public checkAttachmentScope(
    attachment: { warehouse_id?: string | null; branch_id?: string | null },
    scopes: { warehouseScopes: string[]; storeScopes: string[]; isOwner: boolean }
  ): boolean {
    if (scopes.isOwner) {
      return true;
    }

    if (attachment.warehouse_id) {
      const hasAccess =
        scopes.warehouseScopes.includes('*') ||
        scopes.warehouseScopes.includes(attachment.warehouse_id);
      if (!hasAccess) return false;
    }

    if (attachment.branch_id) {
      const hasAccess =
        scopes.storeScopes.includes('*') || scopes.storeScopes.includes(attachment.branch_id);
      if (!hasAccess) return false;
    }

    return true;
  }

  /**
   * Upload an attachment file with server-side SHA-256 calculation and S3 storage.
   */
  async uploadAttachment(
    actor: ActorContext,
    dto: UploadAttachmentDto,
    buffer: Buffer,
    ipAddress: string,
    correlationId: string
  ): Promise<FormattedAttachment> {
    const scopes = await this.getActorScopes(actor);

    // Verify actor is authorized to upload to specified warehouse/branch
    if (
      dto.warehouse_id &&
      !scopes.warehouseScopes.includes('*') &&
      !scopes.warehouseScopes.includes(dto.warehouse_id)
    ) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SCOPE_FORBIDDEN',
        `Bạn không có quyền tải tệp đính kèm lên kho '${dto.warehouse_id}'.`
      );
    }
    if (
      dto.branch_id &&
      !scopes.storeScopes.includes('*') &&
      !scopes.storeScopes.includes(dto.branch_id)
    ) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SCOPE_FORBIDDEN',
        `Bạn không có quyền tải tệp đính kèm lên chi nhánh '${dto.branch_id}'.`
      );
    }

    // Cryptographic SHA-256 calculation
    const computedSha256 = createHash('sha256').update(buffer).digest('hex');

    // Verify client checksum if provided (fail closed on mismatch)
    if (dto.checksum_sha256 && dto.checksum_sha256.trim().toLowerCase() !== computedSha256) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'CHECKSUM_MISMATCH',
        `Mã kiểm tra SHA-256 không khớp. Nhận được: ${dto.checksum_sha256.trim().toLowerCase()}, Tính toán: ${computedSha256}.`,
        false,
        'Kiểm tra lại tệp tin gốc và mã SHA-256 trước khi tải lại.'
      );
    }

    const attachmentId = randomUUID();
    const sanitizedName = sanitizeFileName(dto.file_name);
    const storageKey = `merchants/${actor.merchantId}/attachments/${attachmentId}/${sanitizedName}`;
    const storageBucket = this.config.S3_BUCKET;

    // S3 Private Upload
    try {
      await this.storage.putObject(storageKey, buffer, dto.mime_type.toLowerCase());
    } catch {
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_UNAVAILABLE',
        'Không thể lưu trữ tệp tin vào hệ thống lưu trữ đối tượng S3. Vui lòng thử lại sau.',
        true,
        'Thử lại sau ít phút.'
      );
    }

    // Calculate retention
    const retentionDays = dto.retention_days ?? this.config.ATTACHMENT_DEFAULT_RETENTION_DAYS;
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    const attachment = await this.prisma.attachment.create({
      data: {
        id: attachmentId,
        merchant_id: actor.merchantId,
        file_name: sanitizedName,
        file_size: BigInt(buffer.length),
        mime_type: dto.mime_type.toLowerCase(),
        checksum_sha256: computedSha256,
        storage_key: storageKey,
        storage_bucket: storageBucket,
        entity_type: dto.entity_type ? dto.entity_type.trim().toUpperCase() : 'GENERAL',
        entity_id: dto.entity_id?.trim() || null,
        branch_id: dto.branch_id?.trim() || null,
        warehouse_id: dto.warehouse_id?.trim() || null,
        uploaded_by: actor.userId || 'system',
        status: 'ACTIVE',
        retention_days: retentionDays,
        expires_at: expiresAt,
        metadata: dto.metadata ? (maskAttachmentAuditObject(dto.metadata) as any) : undefined,
      },
    });

    // Immutable Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          actor: actor.userId,
          action: AttachmentAuditEvent.ATTACHMENT_UPLOADED,
          entity_type: 'ATTACHMENT',
          entity_id: attachment.id,
          new_value: {
            file_name: sanitizedName,
            file_size: buffer.length,
            mime_type: dto.mime_type.toLowerCase(),
            checksum_sha256: computedSha256,
            entity_type: attachment.entity_type,
            warehouse_id: attachment.warehouse_id,
            branch_id: attachment.branch_id,
            retention_days: retentionDays,
          },
          ip_address: this.hashIp(ipAddress),
          reason: `Uploaded attachment ${sanitizedName} (${buffer.length} bytes)`,
        },
      });
    } catch (auditErr: any) {
      console.warn(`[AttachmentsService] Audit logging failed: ${auditErr.message}`);
    }

    return this.formatAttachment(attachment);
  }

  /**
   * List attachments with pagination, filters, and FEAT-RBAC-02 warehouse/store scope enforcement.
   */
  async listAttachments(
    actor: ActorContext,
    query: ListAttachmentsQueryDto,
    correlationId: string
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const allowedSortFields = new Set(['created_at', 'file_size', 'file_name', 'expires_at']);
    const sortBy =
      query.sort_by && allowedSortFields.has(query.sort_by) ? query.sort_by : 'created_at';
    const sortOrder = query.sort_order === 'asc' ? 'asc' : 'desc';

    const scopes = await this.getActorScopes(actor);

    // Fail closed if actor is non-owner and has empty scopes
    if (!scopes.isOwner && scopes.warehouseScopes.length === 0 && scopes.storeScopes.length === 0) {
      return {
        success: true,
        data: [],
        meta: {
          page,
          limit,
          total: 0,
          total_pages: 0,
          correlation_id: correlationId,
        },
      };
    }

    const where: any = {
      merchant_id: actor.merchantId,
      status: query.status ? query.status.trim().toUpperCase() : 'ACTIVE',
    };

    if (query.entity_type) {
      where.entity_type = query.entity_type.trim().toUpperCase();
    }
    if (query.entity_id) {
      where.entity_id = query.entity_id.trim();
    }
    if (query.warehouse_id) {
      where.warehouse_id = query.warehouse_id.trim();
    }
    if (query.branch_id) {
      where.branch_id = query.branch_id.trim();
    }

    // Scope conditions
    const scopeConditions: any[] = [];
    if (!scopes.warehouseScopes.includes('*')) {
      scopeConditions.push({
        OR: [{ warehouse_id: null }, { warehouse_id: { in: scopes.warehouseScopes } }],
      });
    }
    if (!scopes.storeScopes.includes('*')) {
      scopeConditions.push({
        OR: [{ branch_id: null }, { branch_id: { in: scopes.storeScopes } }],
      });
    }

    if (scopeConditions.length > 0) {
      where.AND = scopeConditions;
    }

    const [total, rows] = await Promise.all([
      this.prisma.attachment.count({ where }),
      this.prisma.attachment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
    ]);

    return {
      success: true,
      data: rows.map((r) => this.formatAttachment(r)),
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit) || 0,
        correlation_id: correlationId,
      },
    };
  }

  /**
   * Retrieve attachment metadata by ID with tenant and FEAT-RBAC-02 scope checks.
   */
  async getAttachment(
    actor: ActorContext,
    id: string,
    correlationId: string
  ): Promise<FormattedAttachment> {
    if (!isValidUuid(id)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Mã tệp '${id}' không đúng định dạng UUID.`
      );
    }

    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        merchant_id: actor.merchantId,
        status: { not: 'DELETED' },
      },
    });

    if (!attachment) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ATTACHMENT_NOT_FOUND',
        `Không tìm thấy tệp đính kèm với mã '${id}'.`
      );
    }

    const scopes = await this.getActorScopes(actor);
    const hasScopeAccess = this.checkAttachmentScope(attachment, scopes);
    if (!hasScopeAccess) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SCOPE_FORBIDDEN',
        'Bạn không có quyền truy cập tệp đính kèm thuộc kho hoặc chi nhánh này.'
      );
    }

    return this.formatAttachment(attachment);
  }

  /**
   * Download attachment content with immutable access audit logging.
   */
  async downloadAttachment(
    actor: ActorContext,
    id: string,
    ipAddress: string,
    correlationId: string
  ): Promise<{ buffer: Buffer; mimeType: string; fileName: string; fileSize: number }> {
    if (!isValidUuid(id)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Mã tệp '${id}' không đúng định dạng UUID.`
      );
    }

    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        merchant_id: actor.merchantId,
        status: { not: 'DELETED' },
      },
    });

    if (!attachment) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ATTACHMENT_NOT_FOUND',
        `Không tìm thấy tệp đính kèm với mã '${id}'.`
      );
    }

    const scopes = await this.getActorScopes(actor);
    const hasScopeAccess = this.checkAttachmentScope(attachment, scopes);
    if (!hasScopeAccess) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SCOPE_FORBIDDEN',
        'Bạn không có quyền tải xuống tệp đính kèm thuộc kho hoặc chi nhánh này.'
      );
    }

    let s3Obj;
    try {
      s3Obj = await this.storage.getObject(attachment.storage_key);
    } catch {
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_UNAVAILABLE',
        'Không thể lấy tệp tin từ hệ thống lưu trữ đối tượng S3. Vui lòng thử lại sau.'
      );
    }

    // Immutable Access Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          actor: actor.userId,
          action: AttachmentAuditEvent.ATTACHMENT_ACCESSED,
          entity_type: 'ATTACHMENT',
          entity_id: attachment.id,
          new_value: {
            file_name: attachment.file_name,
            file_size: Number(attachment.file_size),
            mime_type: attachment.mime_type,
            storage_key: attachment.storage_key,
          },
          ip_address: this.hashIp(ipAddress),
          reason: `Downloaded attachment ${attachment.file_name} (${attachment.file_size} bytes)`,
        },
      });
    } catch (auditErr: any) {
      console.warn(`[AttachmentsService] Access audit logging failed: ${auditErr.message}`);
    }

    return {
      buffer: s3Obj.body,
      mimeType: attachment.mime_type,
      fileName: attachment.file_name,
      fileSize: s3Obj.contentLength || Number(attachment.file_size),
    };
  }

  /**
   * Delete attachment with confirmation check, scope check, and audit trail.
   */
  async deleteAttachment(
    actor: ActorContext,
    id: string,
    confirm: boolean,
    ipAddress: string,
    correlationId: string
  ): Promise<{ success: boolean; id: string; message: string }> {
    if (confirm !== true) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_REQUIRED',
        'Hành động xóa tệp đính kèm yêu cầu xác nhận rõ ràng (confirm: true).'
      );
    }

    if (!isValidUuid(id)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Mã tệp '${id}' không đúng định dạng UUID.`
      );
    }

    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id,
        merchant_id: actor.merchantId,
        status: { not: 'DELETED' },
      },
    });

    if (!attachment) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ATTACHMENT_NOT_FOUND',
        `Không tìm thấy tệp đính kèm với mã '${id}'.`
      );
    }

    const scopes = await this.getActorScopes(actor);
    const hasScopeAccess = this.checkAttachmentScope(attachment, scopes);
    if (!hasScopeAccess) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SCOPE_FORBIDDEN',
        'Bạn không có quyền xóa tệp đính kèm thuộc kho hoặc chi nhánh này.'
      );
    }

    // Soft delete in database
    await this.prisma.attachment.update({
      where: { id },
      data: {
        status: 'DELETED',
        deleted_at: new Date(),
      },
    });

    // Remove from S3
    try {
      await this.storage.deleteObject(attachment.storage_key);
    } catch (s3Err: any) {
      console.warn(`[AttachmentsService] S3 object removal warning: ${s3Err.message}`);
    }

    // Immutable Deletion Audit Log
    try {
      await this.prisma.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          actor: actor.userId,
          action: AttachmentAuditEvent.ATTACHMENT_DELETED,
          entity_type: 'ATTACHMENT',
          entity_id: attachment.id,
          old_value: {
            status: attachment.status,
            file_name: attachment.file_name,
            file_size: Number(attachment.file_size),
          },
          new_value: {
            status: 'DELETED',
          },
          ip_address: this.hashIp(ipAddress),
          reason: `Deleted attachment ${attachment.file_name}`,
        },
      });
    } catch (auditErr: any) {
      console.warn(`[AttachmentsService] Delete audit logging failed: ${auditErr.message}`);
    }

    return {
      success: true,
      id,
      message: 'Tệp đính kèm đã được xóa thành công.',
    };
  }

  /**
   * Asynchronous retention purge job processing expired items with per-row results.
   */
  async purgeExpiredRetention(
    actor: ActorContext,
    dto: RetentionPurgeDto,
    ipAddress: string,
    correlationId: string
  ): Promise<AttachmentBulkActionResult> {
    const isDryRun = dto.dry_run === true;
    const now = new Date();

    const where: any = {
      merchant_id: actor.merchantId,
      status: 'ACTIVE',
      expires_at: { lte: now },
    };

    if (dto.entity_type) {
      where.entity_type = dto.entity_type.trim().toUpperCase();
    }

    const expiredAttachments = await this.prisma.attachment.findMany({
      where,
      take: 100, // Safe batch limit
    });

    const results: Array<{
      id: string;
      status: 'SUCCEEDED' | 'FAILED';
      code?: string;
      message?: string;
    }> = [];
    const succeeded_ids: string[] = [];
    const failed_ids: string[] = [];

    for (const att of expiredAttachments) {
      try {
        if (!isDryRun) {
          await this.prisma.attachment.update({
            where: { id: att.id },
            data: { status: 'DELETED', deleted_at: new Date() },
          });
          await this.storage.deleteObject(att.storage_key);

          await this.prisma.auditLog.create({
            data: {
              merchant_id: actor.merchantId,
              user_id: actor.userId,
              actor: actor.userId,
              action: AttachmentAuditEvent.ATTACHMENT_PURGED,
              entity_type: 'ATTACHMENT',
              entity_id: att.id,
              new_value: { status: 'DELETED', reason: 'RETENTION_EXPIRED' },
              ip_address: this.hashIp(ipAddress),
              reason: `Retention expired after ${att.retention_days} days`,
            },
          });
        }
        succeeded_ids.push(att.id);
        results.push({ id: att.id, status: 'SUCCEEDED' });
      } catch (err: any) {
        failed_ids.push(att.id);
        results.push({
          id: att.id,
          status: 'FAILED',
          code: 'PURGE_FAILED',
          message: err.message || 'Lỗi khi xóa tệp hết hạn',
        });
      }
    }

    return {
      success: failed_ids.length === 0,
      total: expiredAttachments.length,
      success_count: succeeded_ids.length,
      failure_count: failed_ids.length,
      succeeded_ids,
      failed_ids,
      results,
    };
  }

  /**
   * Bulk delete attachments with truthful per-row results and scope verification.
   */
  async bulkDeleteAttachments(
    actor: ActorContext,
    dto: BulkDeleteAttachmentsDto,
    ipAddress: string,
    correlationId: string
  ): Promise<AttachmentBulkActionResult> {
    if (dto.confirm !== true) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'CONFIRMATION_REQUIRED',
        'Hành động xóa hàng loạt yêu cầu xác nhận rõ ràng (confirm: true).'
      );
    }

    const scopes = await this.getActorScopes(actor);
    const results: Array<{
      id: string;
      status: 'SUCCEEDED' | 'FAILED';
      code?: string;
      message?: string;
    }> = [];
    const succeeded_ids: string[] = [];
    const failed_ids: string[] = [];

    for (const id of dto.ids) {
      if (!isValidUuid(id)) {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'VALIDATION_ERROR',
          message: `Mã tệp '${id}' không phải UUID hợp lệ.`,
        });
        continue;
      }

      const attachment = await this.prisma.attachment.findFirst({
        where: {
          id,
          merchant_id: actor.merchantId,
          status: { not: 'DELETED' },
        },
      });

      if (!attachment) {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'ATTACHMENT_NOT_FOUND',
          message: `Không tìm thấy tệp đính kèm với mã '${id}'.`,
        });
        continue;
      }

      const hasScopeAccess = this.checkAttachmentScope(attachment, scopes);
      if (!hasScopeAccess) {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'SCOPE_FORBIDDEN',
          message: 'Bạn không có quyền thao tác trên tệp đính kèm này.',
        });
        continue;
      }

      try {
        await this.prisma.attachment.update({
          where: { id },
          data: { status: 'DELETED', deleted_at: new Date() },
        });
        await this.storage.deleteObject(attachment.storage_key);

        await this.prisma.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            actor: actor.userId,
            action: AttachmentAuditEvent.ATTACHMENT_BULK_DELETE,
            entity_type: 'ATTACHMENT',
            entity_id: id,
            new_value: { status: 'DELETED' },
            ip_address: this.hashIp(ipAddress),
            reason: `Bulk deleted attachment ${attachment.file_name}`,
          },
        });

        succeeded_ids.push(id);
        results.push({ id, status: 'SUCCEEDED' });
      } catch (err: any) {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'DELETE_ERROR',
          message: err.message || 'Lỗi khi xóa tệp.',
        });
      }
    }

    return {
      success: failed_ids.length === 0,
      total: dto.ids.length,
      success_count: succeeded_ids.length,
      failure_count: failed_ids.length,
      succeeded_ids,
      failed_ids,
      results,
    };
  }
}
