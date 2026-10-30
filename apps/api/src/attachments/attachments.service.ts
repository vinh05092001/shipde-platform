import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CanonicalApiException } from '../auth/auth.service';
import { RbacService, isUserActiveStatus } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { AppConfig, sanitizeErrorMessage } from '@shipde/config';
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
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RbacService) private readonly rbacService: RbacService
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
   * Fetches the actor's live warehouse and branch/store scopes and permissions.
   * Resolves effective scopes and permissions through the database/registry without hardcoding role bypasses.
   */
  public async getActorScopes(
    actor: ActorContext
  ): Promise<{ warehouseScopes: string[]; storeScopes: string[]; permissions: Set<string> }> {
    if (!actor.userId) {
      return { warehouseScopes: [], storeScopes: [], permissions: new Set() };
    }
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: {
        id: true,
        role: true,
        custom_role_id: true,
        status: true,
        warehouse_scopes: true,
        store_scopes: true,
      },
    });

    if (!user || !isUserActiveStatus(user.status)) {
      return { warehouseScopes: [], storeScopes: [], permissions: new Set() };
    }

    const warehouseScopes = Array.isArray(user.warehouse_scopes) ? user.warehouse_scopes : [];
    const storeScopes = Array.isArray(user.store_scopes) ? user.store_scopes : [];

    const actorPerms = await this.rbacService.getActorPermissions(actor);
    const permissions = new Set(actorPerms);

    return { warehouseScopes, storeScopes, permissions };
  }

  /**
   * Evaluates if the actor is permitted to access an attachment per FEAT-RBAC-02.
   * Enforces server-side warehouse and branch scopes; rejects unscoped access for non-wildcard actors.
   */
  public checkAttachmentScope(
    attachment: { warehouse_id?: string | null; branch_id?: string | null },
    scopes: { warehouseScopes: string[]; storeScopes: string[]; permissions: Set<string> }
  ): boolean {
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

    // Unscoped attachment (no warehouse_id and no branch_id)
    // Finding 3: Omitting scope fields must not create an unscoped record accessible to anyone.
    // Unscoped attachments require wildcard scope ('*') OR tenant-wide access permission.
    if (!attachment.warehouse_id && !attachment.branch_id) {
      const hasWildcardScope =
        scopes.warehouseScopes.includes('*') || scopes.storeScopes.includes('*');
      const hasTenantWidePermission =
        scopes.permissions.has('iam:shop_config') || scopes.permissions.has('search:tenant_wide');
      if (!hasWildcardScope && !hasTenantWidePermission) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validates actor capabilities against the requested attachment action and entity type.
   */
  public verifyAttachmentCapabilities(
    scopes: { permissions: Set<string> },
    entityType?: string
  ): void {
    const ATTACHMENT_CAPABILITIES = [
      'iam:shop_config',
      'order:view_create',
      'shipment:receive_return',
      'claim:verify_submit',
      'reconciliation:import_settlement_bank',
      'reconciliation:run_review_audit',
      'shipment:create_update',
      'shipment:track_exceptions',
      'iam:shop_view',
    ];

    const hasAnyCapability = ATTACHMENT_CAPABILITIES.some((cap) => scopes.permissions.has(cap));
    if (!hasAnyCapability) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền thao tác trên tệp đính kèm trong hệ thống.'
      );
    }

    if (!entityType) return;
    const normalizedType = entityType.trim().toUpperCase();

    if (scopes.permissions.has('iam:shop_config')) {
      return;
    }

    switch (normalizedType) {
      case 'RETURN':
        if (!scopes.permissions.has('shipment:receive_return')) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            "Bạn không có quyền 'shipment:receive_return' để đính kèm bằng chứng hàng hoàn."
          );
        }
        break;
      case 'CLAIM':
        if (!scopes.permissions.has('claim:verify_submit')) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            "Bạn không có quyền 'claim:verify_submit' để đính kèm chứng từ khiếu nại."
          );
        }
        break;
      case 'STATEMENT':
        if (!scopes.permissions.has('reconciliation:import_settlement_bank')) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            "Bạn không có quyền 'reconciliation:import_settlement_bank' để đính kèm sao kê/bảng kê."
          );
        }
        break;
      case 'DISCREPANCY':
        if (!scopes.permissions.has('reconciliation:run_review_audit')) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            "Bạn không có quyền 'reconciliation:run_review_audit' để đính kèm chứng từ sai lệch."
          );
        }
        break;
      case 'ORDER':
        if (!scopes.permissions.has('order:view_create')) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            "Bạn không có quyền 'order:view_create' để đính kèm tệp cho đơn hàng."
          );
        }
        break;
      case 'SHIPMENT':
        if (
          !scopes.permissions.has('shipment:create_update') &&
          !scopes.permissions.has('shipment:track_exceptions') &&
          !scopes.permissions.has('order:view_create')
        ) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Bạn không có quyền xử lý vận đơn để đính kèm tệp cho vận đơn.'
          );
        }
        break;
    }
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

    // Finding 2: Check registry permissions for actor and entity type
    this.verifyAttachmentCapabilities(scopes, dto.entity_type);

    let resolvedWarehouseId: string | null = null;
    let resolvedBranchId: string | null = null;

    // Finding 3: Validate and resolve referenced warehouse ownership server-side
    if (dto.warehouse_id) {
      const wh = await this.prisma.warehouse.findFirst({
        where: {
          merchant_id: actor.merchantId,
          OR: [{ id: dto.warehouse_id }, { code: dto.warehouse_id }],
        },
      });
      if (!wh) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          `Kho '${dto.warehouse_id}' không tồn tại hoặc không thuộc tổ chức của bạn.`
        );
      }
      if (
        !scopes.warehouseScopes.includes('*') &&
        !scopes.warehouseScopes.includes(wh.id) &&
        !scopes.warehouseScopes.includes(wh.code)
      ) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'SCOPE_FORBIDDEN',
          `Bạn không có quyền tải tệp đính kèm lên kho '${dto.warehouse_id}'.`
        );
      }
      resolvedWarehouseId = wh.id;
    }

    // Finding 3: Validate and resolve referenced branch ownership server-side
    if (dto.branch_id) {
      const br = await this.prisma.branch.findFirst({
        where: {
          merchant_id: actor.merchantId,
          OR: [{ id: dto.branch_id }, { code: dto.branch_id }],
        },
      });
      if (!br) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          `Chi nhánh '${dto.branch_id}' không tồn tại hoặc không thuộc tổ chức của bạn.`
        );
      }
      if (
        !scopes.storeScopes.includes('*') &&
        !scopes.storeScopes.includes(br.id) &&
        !scopes.storeScopes.includes(br.code)
      ) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'SCOPE_FORBIDDEN',
          `Bạn không có quyền tải tệp đính kèm lên chi nhánh '${dto.branch_id}'.`
        );
      }
      resolvedBranchId = br.id;
    }

    // Finding 3: Validate referenced entity and derive/verify attachment scopes
    if (dto.entity_id) {
      const entityId = dto.entity_id.trim();
      const entityType = (dto.entity_type || 'GENERAL').trim().toUpperCase();

      if (entityType === 'ORDER') {
        const order = await this.prisma.order.findFirst({
          where: { id: entityId, merchant_id: actor.merchantId },
        });
        if (!order) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Đơn hàng '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
        if (order.branch_id) {
          if (resolvedBranchId && resolvedBranchId !== order.branch_id) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              `Chi nhánh không khớp với đơn hàng '${entityId}'.`
            );
          }
          resolvedBranchId = order.branch_id;
        }
      } else if (entityType === 'SHIPMENT') {
        const shipment = await this.prisma.shipment.findFirst({
          where: { id: entityId, merchant_id: actor.merchantId },
        });
        if (!shipment) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Vận đơn '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
        if (shipment.warehouse_id) {
          if (resolvedWarehouseId && resolvedWarehouseId !== shipment.warehouse_id) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              `Kho không khớp với vận đơn '${entityId}'.`
            );
          }
          resolvedWarehouseId = shipment.warehouse_id;
        }
      } else if (entityType === 'RETURN') {
        const returnRecord = await this.prisma.returnRecord.findFirst({
          where: {
            merchant_id: actor.merchantId,
            OR: [...(isValidUuid(entityId) ? [{ id: entityId }] : []), { tracking_code: entityId }],
          },
        });
        if (!returnRecord) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Hồ sơ hàng hoàn '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
        if (returnRecord.return_warehouse_id) {
          if (resolvedWarehouseId && resolvedWarehouseId !== returnRecord.return_warehouse_id) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              `Kho không khớp với hồ sơ hàng hoàn '${entityId}'.`
            );
          }
          resolvedWarehouseId = returnRecord.return_warehouse_id;
        }
      } else if (entityType === 'CLAIM') {
        const claim = await this.prisma.claim.findFirst({
          where: { id: entityId, merchant_id: actor.merchantId },
        });
        if (!claim) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Hồ sơ khiếu nại '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
        if (claim.warehouse_id) {
          if (resolvedWarehouseId && resolvedWarehouseId !== claim.warehouse_id) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              `Kho không khớp với hồ sơ khiếu nại '${entityId}'.`
            );
          }
          resolvedWarehouseId = claim.warehouse_id;
        }
      } else if (entityType === 'DISCREPANCY') {
        const discrepancy = await this.prisma.discrepancy.findFirst({
          where: { id: entityId, merchant_id: actor.merchantId },
        });
        if (!discrepancy) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Hồ sơ sai lệch '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
        if (discrepancy.warehouse_id) {
          if (resolvedWarehouseId && resolvedWarehouseId !== discrepancy.warehouse_id) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'VALIDATION_ERROR',
              `Kho không khớp với hồ sơ sai lệch '${entityId}'.`
            );
          }
          resolvedWarehouseId = discrepancy.warehouse_id;
        }
      } else if (entityType === 'STATEMENT') {
        const statement = await this.prisma.carrierStatement.findFirst({
          where: { id: entityId, merchant_id: actor.merchantId },
        });
        if (!statement) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            `Bảng kê '${entityId}' không tồn tại hoặc không thuộc tổ chức của bạn.`
          );
        }
      }
    }

    // Finding 3: Validate and authorize resolved/derived scopes BEFORE uploading bytes
    if (resolvedWarehouseId) {
      const hasWhAccess =
        scopes.warehouseScopes.includes('*') ||
        scopes.warehouseScopes.includes(resolvedWarehouseId);
      if (!hasWhAccess) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'SCOPE_FORBIDDEN',
          `Bạn không có quyền tải tệp đính kèm lên kho '${resolvedWarehouseId}'.`
        );
      }
    }

    if (resolvedBranchId) {
      const hasBranchAccess =
        scopes.storeScopes.includes('*') || scopes.storeScopes.includes(resolvedBranchId);
      if (!hasBranchAccess) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'SCOPE_FORBIDDEN',
          `Bạn không có quyền tải tệp đính kèm lên chi nhánh '${resolvedBranchId}'.`
        );
      }
    }

    // Unscoped validation: scoped actors (non-wildcard) cannot create unscoped records
    if (!resolvedWarehouseId && !resolvedBranchId) {
      const hasWildcardScope =
        scopes.warehouseScopes.includes('*') && scopes.storeScopes.includes('*');
      const hasTenantWidePermission =
        scopes.permissions.has('iam:shop_config') || scopes.permissions.has('search:tenant_wide');
      if (!hasWildcardScope && !hasTenantWidePermission) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'SCOPE_FORBIDDEN',
          'Người dùng với phạm vi giới hạn phải liên kết tệp đính kèm với kho hoặc chi nhánh được cấp quyền.'
        );
      }
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

    // Finding 5 & 6: Transactional database + audit log creation with compensation
    let attachment: any;
    try {
      attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
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
            branch_id: resolvedBranchId,
            warehouse_id: resolvedWarehouseId,
            uploaded_by: actor.userId || 'system',
            status: 'ACTIVE',
            retention_days: retentionDays,
            expires_at: expiresAt,
            metadata: {
              ...(dto.metadata ? maskAttachmentAuditObject(dto.metadata) : {}),
              scan_status: 'CLEAN',
              scanned_at: new Date().toISOString(),
              scanner: 'shipde-content-gate',
            } as any,
          },
        });

        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            actor: actor.userId,
            action: AttachmentAuditEvent.ATTACHMENT_UPLOADED,
            entity_type: 'ATTACHMENT',
            entity_id: created.id,
            new_value: {
              file_name: sanitizedName,
              file_size: buffer.length,
              mime_type: dto.mime_type.toLowerCase(),
              checksum_sha256: computedSha256,
              entity_type: created.entity_type,
              warehouse_id: created.warehouse_id,
              branch_id: created.branch_id,
              retention_days: retentionDays,
              correlation_id: correlationId,
            },
            ip_address: this.hashIp(ipAddress),
            reason: correlationId
              ? `correlation_id:${correlationId}`
              : `Uploaded attachment ${sanitizedName} (${buffer.length} bytes)`,
          },
        });

        return created;
      });
    } catch (dbErr: any) {
      // Finding 6: Compensation - remove orphaned S3 object if database transaction fails
      try {
        await this.storage.deleteObject(storageKey);
      } catch (cleanupErr: any) {
        // Finding 7: Redact raw exception details
        console.warn(
          `[AttachmentsService] Failed to clean up orphaned S3 object ${storageKey} (code: ${cleanupErr?.name || 'STORAGE_ERROR'})`
        );
      }
      if (dbErr instanceof CanonicalApiException) throw dbErr;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'UPLOAD_FAILED',
        'Không thể lưu thông tin tệp đính kèm và nhật ký kiểm toán. Vui lòng thử lại.',
        true
      );
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

    // Finding 2: Verify caller possesses general attachment capability
    this.verifyAttachmentCapabilities(scopes);

    const hasWarehouseWildcard = scopes.warehouseScopes.includes('*');
    const hasStoreWildcard = scopes.storeScopes.includes('*');
    const hasTenantWide =
      scopes.permissions.has('iam:shop_config') || scopes.permissions.has('search:tenant_wide');

    // Fail closed if actor has empty scopes and no wildcard/tenant-wide access
    if (
      !hasTenantWide &&
      !hasWarehouseWildcard &&
      !hasStoreWildcard &&
      scopes.warehouseScopes.length === 0 &&
      scopes.storeScopes.length === 0
    ) {
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

    // Finding 10: Apply per-dimension authorization semantics with AND (never OR across dimensions)
    const andConditions: any[] = [];

    if (!hasWarehouseWildcard) {
      andConditions.push({
        OR: [{ warehouse_id: null }, { warehouse_id: { in: scopes.warehouseScopes } }],
      });
    }

    if (!hasStoreWildcard) {
      andConditions.push({
        OR: [{ branch_id: null }, { branch_id: { in: scopes.storeScopes } }],
      });
    }

    // Unscoped items (warehouse_id == null && branch_id == null) require tenant-wide permission
    // OR wildcard in both dimensions
    if (!hasTenantWide && (!hasWarehouseWildcard || !hasStoreWildcard)) {
      andConditions.push({
        NOT: {
          warehouse_id: null,
          branch_id: null,
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
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

    // Finding 2: Verify capability for entity type
    this.verifyAttachmentCapabilities(scopes, attachment.entity_type);

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
      },
    });

    if (!attachment || attachment.status === 'DELETED') {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ATTACHMENT_NOT_FOUND',
        `Không tìm thấy tệp đính kèm với mã '${id}'.`
      );
    }

    // Finding 1: Quarantine/safety status gate
    if (attachment.status === 'QUARANTINED') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ATTACHMENT_QUARANTINED',
        'Tệp đính kèm đã bị cách ly do nghi ngờ mã độc hoặc vi phạm chính sách an toàn.'
      );
    }

    if (attachment.status !== 'ACTIVE') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'ATTACHMENT_UNAVAILABLE',
        'Tệp đính kèm hiện không ở trạng thái sẵn sàng để tải xuống.'
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

    // Finding 2: Verify capability for entity type
    this.verifyAttachmentCapabilities(scopes, attachment.entity_type);

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

    // Finding 5: Durable access audit log must be persisted before acknowledging success or releasing content
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
            correlation_id: correlationId,
          },
          ip_address: this.hashIp(ipAddress),
          reason: correlationId
            ? `correlation_id:${correlationId}`
            : `Downloaded attachment ${attachment.file_name} (${attachment.file_size} bytes)`,
        },
      });
    } catch (auditErr: any) {
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUDIT_LOG_FAILED',
        'Không thể ghi nhật ký kiểm toán truy cập tệp. Yêu cầu tải tệp bị hủy vì lý do an toàn.',
        true
      );
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

    // Finding 2: Capability check for deletion
    this.verifyAttachmentCapabilities(scopes, attachment.entity_type);

    // Finding 5: Persist durable deletion intent and audit log in DB FIRST before external effect
    if (attachment.status !== 'PENDING_DELETION') {
      await this.prisma.$transaction(async (tx) => {
        await tx.attachment.update({
          where: { id },
          data: {
            status: 'PENDING_DELETION',
          },
        });

        await tx.auditLog.create({
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
              status: 'PENDING_DELETION',
              correlation_id: correlationId,
            },
            ip_address: this.hashIp(ipAddress),
            reason: correlationId
              ? `correlation_id:${correlationId}`
              : `Requested deletion of attachment ${attachment.file_name}`,
          },
        });
      });
    }

    // Finding 6: Execute external S3 storage removal; if S3 fails, row remains PENDING_DELETION (retryable)
    try {
      await this.storage.deleteObject(attachment.storage_key);
    } catch {
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_UNAVAILABLE',
        'Không thể xóa tệp khỏi hệ thống lưu trữ S3. Thao tác xóa đang chờ xử lý và có thể thử lại sau.',
        true
      );
    }

    // Finalize database record to DELETED after successful storage removal
    await this.prisma.attachment.update({
      where: { id },
      data: {
        status: 'DELETED',
        deleted_at: new Date(),
      },
    });

    return {
      success: true,
      id,
      message: 'Tệp đính kèm đã được xóa thành công.',
    };
  }

  /**
   * Asynchronous retention purge job processing expired items with per-row results and scope verification.
   */
  async purgeExpiredRetention(
    actor: ActorContext,
    dto: RetentionPurgeDto,
    ipAddress: string,
    correlationId: string
  ): Promise<AttachmentBulkActionResult> {
    const scopes = await this.getActorScopes(actor);

    // Finding 4: Enforce registry permission for retention purge
    if (!scopes.permissions.has('iam:shop_config')) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        "Bạn không có quyền 'iam:shop_config' để dọn dẹp tệp đính kèm hết hạn."
      );
    }

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

    // Finding 4: Scope conditions during discovery
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
      // Per-row scope check
      if (!this.checkAttachmentScope(att, scopes)) {
        continue;
      }

      if (isDryRun) {
        succeeded_ids.push(att.id);
        results.push({ id: att.id, status: 'SUCCEEDED' });
        continue;
      }

      try {
        // Finding 5: Persist durable deletion intent and audit log in DB FIRST
        await this.prisma.$transaction(async (tx) => {
          await tx.attachment.update({
            where: { id: att.id },
            data: { status: 'PENDING_DELETION' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: actor.merchantId,
              user_id: actor.userId,
              actor: actor.userId,
              action: AttachmentAuditEvent.ATTACHMENT_PURGED,
              entity_type: 'ATTACHMENT',
              entity_id: att.id,
              new_value: {
                status: 'PENDING_DELETION',
                reason: 'RETENTION_EXPIRED',
                correlation_id: correlationId,
              },
              ip_address: this.hashIp(ipAddress),
              reason: correlationId
                ? `correlation_id:${correlationId}`
                : `Retention expired after ${att.retention_days} days`,
            },
          });
        });

        // Finding 6: Execute external S3 storage removal
        try {
          await this.storage.deleteObject(att.storage_key);
        } catch {
          failed_ids.push(att.id);
          results.push({
            id: att.id,
            status: 'FAILED',
            code: 'STORAGE_UNAVAILABLE',
            message:
              'Không thể xóa tệp khỏi hệ thống lưu trữ S3. Thao tác dọn dẹp có thể thử lại sau.',
          });
          continue;
        }

        // Finalize DB record to DELETED
        await this.prisma.attachment.update({
          where: { id: att.id },
          data: { status: 'DELETED', deleted_at: new Date() },
        });

        succeeded_ids.push(att.id);
        results.push({ id: att.id, status: 'SUCCEEDED' });
      } catch (err: any) {
        // Finding 7: Never serialize raw unredacted exception messages
        failed_ids.push(att.id);
        results.push({
          id: att.id,
          status: 'FAILED',
          code: 'PURGE_FAILED',
          message: sanitizeErrorMessage(
            err?.message || 'Lỗi khi cập nhật cơ sở dữ liệu sau khi xóa tệp.'
          ),
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

      // Finding 2: Capability check for attachment entity
      try {
        this.verifyAttachmentCapabilities(scopes, attachment.entity_type);
      } catch {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'FORBIDDEN',
          message: 'Bạn không có quyền thao tác trên loại tệp đính kèm này.',
        });
        continue;
      }

      // Finding 5: Persist durable deletion intent and audit log in DB FIRST
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.attachment.update({
            where: { id },
            data: { status: 'PENDING_DELETION' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: actor.merchantId,
              user_id: actor.userId,
              actor: actor.userId,
              action: AttachmentAuditEvent.ATTACHMENT_BULK_DELETE,
              entity_type: 'ATTACHMENT',
              entity_id: id,
              new_value: { status: 'PENDING_DELETION', correlation_id: correlationId },
              ip_address: this.hashIp(ipAddress),
              reason: correlationId
                ? `correlation_id:${correlationId}`
                : `Bulk deleted attachment ${attachment.file_name}`,
            },
          });
        });
      } catch (err: any) {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'DELETE_ERROR',
          message: sanitizeErrorMessage(err?.message || 'Lỗi khi ghi nhận yêu cầu xóa tệp.'),
        });
        continue;
      }

      // Finding 6: Execute external S3 storage removal
      try {
        await this.storage.deleteObject(attachment.storage_key);
      } catch {
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'STORAGE_UNAVAILABLE',
          message: 'Không thể xóa tệp khỏi hệ thống lưu trữ S3. Thao tác có thể thử lại sau.',
        });
        continue;
      }

      // Finalize DB record to DELETED
      try {
        await this.prisma.attachment.update({
          where: { id },
          data: { status: 'DELETED', deleted_at: new Date() },
        });

        succeeded_ids.push(id);
        results.push({ id, status: 'SUCCEEDED' });
      } catch (err: any) {
        // Finding 7: Never serialize raw unredacted exception messages
        failed_ids.push(id);
        results.push({
          id,
          status: 'FAILED',
          code: 'DELETE_ERROR',
          message: sanitizeErrorMessage(err?.message || 'Lỗi khi cập nhật trạng thái xóa tệp.'),
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

  /**
   * Quarantines an attachment due to safety policy or malware detection (Finding 1).
   */
  async quarantineAttachment(
    actor: ActorContext,
    id: string,
    reason: string,
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
        'Bạn không có quyền cách ly tệp đính kèm này.'
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.attachment.update({
        where: { id },
        data: {
          status: 'QUARANTINED',
        },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          actor: actor.userId,
          action: 'ATTACHMENT_QUARANTINED',
          entity_type: 'ATTACHMENT',
          entity_id: id,
          old_value: { status: attachment.status },
          new_value: { status: 'QUARANTINED', reason, correlation_id: correlationId },
          ip_address: this.hashIp('127.0.0.1'),
          reason: correlationId
            ? `correlation_id:${correlationId}`
            : `Quarantined attachment ${attachment.file_name}: ${reason}`,
        },
      });

      return res;
    });

    return this.formatAttachment(updated);
  }

  /**
   * Reconciles attachments stuck in PENDING_DELETION status (Finding 6).
   * Retries S3 storage deletion and transitions to DELETED upon success.
   */
  async reconcilePendingDeletions(
    actor: ActorContext,
    correlationId: string
  ): Promise<{ reconciled: number; failed: number }> {
    const scopes = await this.getActorScopes(actor);
    this.verifyAttachmentCapabilities(scopes);

    const pending = await this.prisma.attachment.findMany({
      where: {
        merchant_id: actor.merchantId,
        status: 'PENDING_DELETION',
      },
      take: 50,
    });

    let reconciled = 0;
    let failed = 0;

    for (const att of pending) {
      try {
        await this.storage.deleteObject(att.storage_key);
        await this.prisma.attachment.update({
          where: { id: att.id },
          data: {
            status: 'DELETED',
            deleted_at: new Date(),
          },
        });
        reconciled++;
      } catch {
        failed++;
      }
    }

    return { reconciled, failed };
  }
}
