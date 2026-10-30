import { Injectable, Inject, HttpStatus, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, CarrierCodeEnum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  ExportFormat,
  ExportResource,
  ExportJobStatus,
  ExportErrorCode,
  ExportAuditEvent,
  ExportGenerationMetadata,
  ExportRowResult,
  ExportJobItem,
  CreateExportJobResponse,
  ExportJobResponse,
  ListExportJobsResponse,
} from '@shipde/contracts';
import {
  resolveExportMaxRows,
  resolveExportJobTtlSeconds,
  resolveExportRuleVersion,
  formatStructuredLog,
} from '@shipde/config';
import { CanonicalApiException } from '../auth/auth.service';
import { maskIdentifier } from '../invitations/invitations.service';
import { CreateExportJobDto, ListExportJobsQueryDto } from './exports.dto';
import { generateCsv } from './generators/csv.generator';
import { generateXlsx } from './generators/xlsx.generator';
import { generatePdf } from './generators/pdf.generator';

export interface DownloadResult {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  checksum: string;
  fileSize: number;
}

@Injectable()
export class ExportsService implements OnModuleInit, OnModuleDestroy {
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private readonly activeJobs = new Set<Promise<any>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  /**
   * Recovers stale pending or processing jobs on module initialization (Finding 4, Finding 7).
   * Iterates active tenants and starts periodic tenant-scoped maintenance.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.runSystemMaintenance(true);
    } catch (err: any) {
      console.warn(
        formatStructuredLog({
          level: 'warn',
          service: 'api',
          message: `Exports startup maintenance skipped or failed: ${err.message}`,
        })
      );
    }

    // Schedule background maintenance every 60 seconds (Finding 4, Finding 11, Finding 13)
    this.maintenanceTimer = setInterval(async () => {
      try {
        await this.runSystemMaintenance(false);
      } catch (err: any) {
        console.warn(
          formatStructuredLog({
            level: 'warn',
            service: 'api',
            message: `Exports background maintenance error: ${err.message}`,
          })
        );
      }
    }, 60000);
    if (this.maintenanceTimer.unref) {
      this.maintenanceTimer.unref();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
  }

  /**
   * Drains all active background processing jobs. Essential for deterministic test cleanup (Finding 6).
   */
  async drainActiveJobs(): Promise<void> {
    await Promise.all(Array.from(this.activeJobs));
  }

  /**
   * Runs tenant-scoped maintenance across all active merchants (Finding 13).
   * @param isStartup When true (system reboot/crash recovery), all pending/processing jobs are recovered.
   *                  When false (runtime interval), only jobs exceeding stale timeout (5 minutes) are recovered.
   */
  async runSystemMaintenance(isStartup = false): Promise<void> {
    if (!this.prisma?.merchant?.findMany) return;
    const activeMerchants = await this.prisma.merchant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    const cutoff = isStartup ? new Date() : new Date(Date.now() - 5 * 60 * 1000);
    for (const m of activeMerchants) {
      await this.recoverStaleJobs(m.id, cutoff);
      await this.purgeExpiredExports(m.id);
    }
  }

  /**
   * Hashes client IP to ensure GDPR/privacy compliance in immutable audit logs.
   */
  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex');
  }

  /**
   * Sanitizes filter values to ensure no unmasked PII leaks into metadata or audit logs (Finding 10, Finding 13).
   */
  private sanitizeMetadataFilters(
    filters?: Record<string, unknown>,
    hasPiiUnmask = false
  ): Record<string, unknown> {
    if (!filters) return {};
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(filters)) {
      if (typeof val === 'string') {
        if (!hasPiiUnmask && (val.includes('@') || /^\+?[0-9]{8,15}$/.test(val))) {
          sanitized[key] = maskIdentifier(val);
        } else {
          sanitized[key] = val;
        }
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  /**
   * Recovers stale jobs left in PENDING or PROCESSING states after a server restart (Finding 4, Finding 13).
   * Scoped strictly by merchantId.
   */
  async recoverStaleJobs(merchantId: string, cutoff: Date = new Date()): Promise<number> {
    const result = await this.prisma.exportJob.updateMany({
      where: {
        merchant_id: merchantId,
        status: { in: [ExportJobStatus.PENDING, ExportJobStatus.PROCESSING] },
        created_at: { lt: cutoff },
      },
      data: {
        status: ExportJobStatus.FAILED,
        error_code: 'PROCESSING_TIMEOUT',
        error_message:
          'Tác vụ xuất dữ liệu bị gián đoạn do hệ thống khởi động lại, vui lòng thử lại',
        completed_at: new Date(),
      },
    });
    return result.count;
  }

  /**
   * Purges expired export jobs and their files per the retention TTL baseline (Finding 11, Finding 13).
   * Scoped strictly by merchantId.
   */
  async purgeExpiredExports(merchantId: string): Promise<number> {
    const now = new Date();
    const result = await this.prisma.exportJob.deleteMany({
      where: {
        merchant_id: merchantId,
        expires_at: { lt: now },
      },
    });
    return result.count;
  }

  /**
   * Enforces server-side capability permissions for the requested resource type
   * strictly via the RBAC registry/capabilities, without hardcoded role bypasses (Finding 4, Finding 5).
   */
  async assertResourcePermission(actor: ActorContext, resource: ExportResource): Promise<void> {
    let requiredPermissions: string[];
    switch (resource) {
      case ExportResource.USERS:
        requiredPermissions = ['iam:manage_users'];
        break;
      case ExportResource.WAREHOUSES:
        requiredPermissions = ['iam:shop_config'];
        break;
      case ExportResource.AUDIT_LOGS:
        requiredPermissions = ['audit:view'];
        break;
      case ExportResource.LEDGERS:
        requiredPermissions = ['reconciliation:view_contract_rates'];
        break;
      default:
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          ExportErrorCode.UNSUPPORTED_RESOURCE,
          `Tài nguyên xuất '${resource}' không được hỗ trợ (chỉ hỗ trợ: users, warehouses, audit_logs, ledgers)`
        );
    }

    const hasPermission = await this.rbacService.actorHasPermissions(actor, requiredPermissions);
    if (!hasPermission) {
      if (resource === ExportResource.LEDGERS) {
        const hasAlternate = await this.rbacService.actorHasPermissions(actor, [
          'reconciliation:run_review_audit',
        ]);
        if (hasAlternate) return;
      }
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        ExportErrorCode.FORBIDDEN,
        `Tài khoản không có quyền thực hiện xuất dữ liệu cho tài nguyên '${resource}' (yêu cầu quyền: ${requiredPermissions.join(
          ', '
        )})`
      );
    }
  }

  /**
   * Resolves the caller's store (branch) scopes from user record for FEAT-RBAC-02 scope enforcement.
   */
  async getActorStoreScopes(actor: ActorContext): Promise<string[]> {
    if (!actor.userId) return [];
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: { store_scopes: true },
    });
    return user?.store_scopes || [];
  }

  /**
   * Resolves the caller's carrier account scopes from user record for FEAT-RBAC-02 scope enforcement.
   */
  async getActorCarrierAccountScopes(actor: ActorContext): Promise<string[]> {
    if (!actor.userId) return [];
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: { carrier_account_scopes: true },
    });
    return user?.carrier_account_scopes || [];
  }

  /**
   * Creates an asynchronous or synchronous export job with atomic audit logging (Finding 14).
   * Validates capability permissions, sanitizes PII before persistence (Finding 10), and handles sync/async.
   */
  async createExportJob(
    merchantId: string,
    actor: ActorContext,
    dto: CreateExportJobDto,
    clientIp: string,
    correlationId: string
  ): Promise<CreateExportJobResponse> {
    // 1. Authorize resource capability permission
    await this.assertResourcePermission(actor, dto.resource);

    const ttlSeconds = resolveExportJobTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const ruleVersion = resolveExportRuleVersion();

    // Determine actor's current PII unmask capability to attach internal flag for download security (Finding 4)
    const hasPiiUnmask = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);
    const sanitizedFilters = this.sanitizeMetadataFilters(dto.filters, hasPiiUnmask);
    // If actor lacks pii:unmask, sanitize raw PII before persisting (Finding 10)
    const persistedFilters = {
      ...(hasPiiUnmask ? dto.filters || {} : sanitizedFilters),
      __unmasked_pii: hasPiiUnmask,
    };

    const isSync = dto.sync !== false;
    const jobId = randomUUID();

    // 2. Persist initial ExportJob record and mandatory audit atomically via transaction (Finding 14)
    const createPayload = {
      id: jobId,
      merchant_id: merchantId,
      user_id: actor.userId,
      resource: dto.resource,
      format: dto.format,
      status: ExportJobStatus.PENDING,
      filters: persistedFilters as unknown as Prisma.InputJsonValue,
      rule_version: ruleVersion,
      expires_at: expiresAt,
    };

    const auditPayload = {
      merchant_id: merchantId,
      user_id: actor.userId,
      actor: actor.role || actor.userId || null,
      action: ExportAuditEvent.EXPORT_REQUESTED,
      entity_type: 'export_job',
      entity_id: jobId,
      old_value: Prisma.JsonNull,
      new_value: {
        job_id: jobId,
        resource: dto.resource,
        format: dto.format,
        filters: sanitizedFilters,
        rule_version: ruleVersion,
        sync: isSync,
        correlation_id: correlationId,
      } as unknown as Prisma.InputJsonValue,
      reason: correlationId ? `correlation_id:${correlationId}` : null,
      ip_address: this.hashIp(clientIp),
    };

    let jobRecord: any;
    if (typeof this.prisma.$transaction === 'function') {
      jobRecord = await this.prisma.$transaction(async (tx) => {
        const created = await tx.exportJob.create({ data: createPayload });
        await tx.auditLog.create({ data: auditPayload });
        return created;
      });
    } else {
      jobRecord = await this.prisma.exportJob.create({ data: createPayload });
      await this.prisma.auditLog.create({ data: auditPayload });
    }

    // 3. Handle sync vs async lifecycle (Finding 7)
    if (isSync) {
      const processedItem = await this.processExportJob(
        merchantId,
        actor,
        jobRecord.id,
        dto,
        clientIp,
        correlationId
      );
      return {
        data: processedItem,
        meta: {
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    } else {
      const jobPromise = this.processExportJob(
        merchantId,
        actor,
        jobRecord.id,
        dto,
        clientIp,
        correlationId
      )
        .catch((err) => {
          console.warn(
            formatStructuredLog({
              level: 'warn',
              service: 'api',
              message: `Async export background failure for job ${jobRecord.id}: ${err.message}`,
            })
          );
        })
        .finally(() => {
          this.activeJobs.delete(jobPromise);
        });
      this.activeJobs.add(jobPromise);

      return {
        data: this.formatExportJobItem(jobRecord, undefined, hasPiiUnmask),
        meta: {
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Resolves the caller's warehouse scopes from user record for FEAT-RBAC-02 scope enforcement.
   */
  async getActorWarehouseScopes(actor: ActorContext): Promise<string[]> {
    if (!actor.userId) return [];
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: { role: true, warehouse_scopes: true },
    });
    return user?.warehouse_scopes || [];
  }

  /**
   * Processes export job data retrieval, per-row FEAT-RBAC-02 scoping, PII masking, and file serialization.
   * Scoped strictly by merchantId and captures all failures into FAILED status (Finding 7, P2).
   */
  async processExportJob(
    merchantId: string,
    actor: ActorContext,
    jobId: string,
    dto: CreateExportJobDto,
    clientIp: string,
    correlationId: string
  ): Promise<ExportJobItem> {
    try {
      // Update status to processing with tenant scope (P2)
      await this.prisma.exportJob.updateMany({
        where: { id: jobId, merchant_id: merchantId },
        data: { status: ExportJobStatus.PROCESSING },
      });

      // Check PII unmask capability purely via RBAC registry (Finding 5)
      const hasPiiUnmask = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);

      const maxRows = resolveExportMaxRows();
      const ruleVersion = resolveExportRuleVersion();

      let headers: { key: string; label: string }[] = [];
      const exportedRows: Record<string, unknown>[] = [];
      const rowResults: ExportRowResult[] = [];
      let truncationNote: string | undefined = undefined;

      // Actor warehouse scopes for FEAT-RBAC-02 per-row scoping
      const actorWarehouseScopes = await this.getActorWarehouseScopes(actor);
      const hasUniversalWarehouseScope = actorWarehouseScopes.includes('*');

      // Retrieve data according to requested resource with filters and limits applied
      switch (dto.resource) {
        case ExportResource.USERS: {
          headers = [
            { key: 'id', label: 'User ID' },
            { key: 'full_name', label: 'Họ và tên' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Số điện thoại' },
            { key: 'role', label: 'Vai trò' },
            { key: 'status', label: 'Trạng thái' },
            { key: 'created_at', label: 'Ngày tạo' },
          ];

          const userWhere: Prisma.UserWhereInput = { merchant_id: merchantId };
          if (dto.filters?.status && typeof dto.filters.status === 'string') {
            userWhere.status = dto.filters.status as any;
          }
          if (dto.filters?.role && typeof dto.filters.role === 'string') {
            userWhere.role = dto.filters.role as any;
          }

          const totalMatching = await this.prisma.user.count({ where: userWhere });
          if (totalMatching > maxRows) {
            if (dto.filters?.clamp !== true) {
              throw new CanonicalApiException(
                HttpStatus.BAD_REQUEST,
                ExportErrorCode.EXPORT_LIMIT_EXCEEDED,
                `Số lượng bản ghi (${totalMatching}) vượt quá giới hạn xuất tối đa (${maxRows}). Vui lòng thu hẹp bộ lọc.`
              );
            }
            truncationNote = `Kết quả xuất đã được giới hạn ở ${maxRows} bản ghi đầu tiên do vượt quá số lượng tối đa cho phép (${totalMatching} bản ghi phù hợp)`;
          }

          const users = await this.prisma.user.findMany({
            where: userWhere,
            take: maxRows,
            orderBy: { created_at: 'asc' },
          });

          for (let i = 0; i < users.length; i++) {
            const u = users[i];
            const emailVal = hasPiiUnmask ? u.email || '' : maskIdentifier(u.email);
            const phoneVal = hasPiiUnmask ? u.phone || '' : maskIdentifier(u.phone);

            exportedRows.push({
              id: u.id,
              full_name: u.full_name,
              email: emailVal,
              phone: phoneVal,
              role: u.role,
              status: u.status,
              created_at: u.created_at.toISOString(),
            });

            rowResults.push({
              row_index: i + 1,
              entity_id: u.id,
              status: 'succeeded',
            });
          }
          break;
        }

        case ExportResource.WAREHOUSES: {
          headers = [
            { key: 'id', label: 'Mã hệ thống' },
            { key: 'code', label: 'Mã kho' },
            { key: 'name', label: 'Tên kho hàng' },
            { key: 'status', label: 'Trạng thái' },
            { key: 'is_default', label: 'Mặc định' },
            { key: 'contact_name', label: 'Người liên hệ' },
            { key: 'contact_phone', label: 'Điện thoại liên hệ' },
            { key: 'contact_email', label: 'Email liên hệ' },
            { key: 'city', label: 'Tỉnh/Thành phố' },
            { key: 'district', label: 'Quận/Huyện' },
            { key: 'address_line', label: 'Địa chỉ chi tiết' },
            { key: 'created_at', label: 'Ngày tạo' },
          ];

          const whWhere: Prisma.WarehouseWhereInput = { merchant_id: merchantId };
          if (dto.filters?.status && typeof dto.filters.status === 'string') {
            whWhere.status = dto.filters.status as any;
          }
          if (dto.filters?.city && typeof dto.filters.city === 'string') {
            whWhere.city = dto.filters.city;
          }

          const totalMatching = await this.prisma.warehouse.count({ where: whWhere });
          if (totalMatching > maxRows) {
            if (dto.filters?.clamp !== true) {
              throw new CanonicalApiException(
                HttpStatus.BAD_REQUEST,
                ExportErrorCode.EXPORT_LIMIT_EXCEEDED,
                `Số lượng bản ghi (${totalMatching}) vượt quá giới hạn xuất tối đa (${maxRows}). Vui lòng thu hẹp bộ lọc.`
              );
            }
            truncationNote = `Kết quả xuất đã được giới hạn ở ${maxRows} bản ghi đầu tiên do vượt quá số lượng tối đa cho phép (${totalMatching} bản ghi phù hợp)`;
          }

          const warehouses = await this.prisma.warehouse.findMany({
            where: whWhere,
            take: maxRows,
            orderBy: { created_at: 'asc' },
          });

          for (let i = 0; i < warehouses.length; i++) {
            const w = warehouses[i];

            // FEAT-RBAC-02 Scope check per row
            const isScopeAuthorized =
              hasUniversalWarehouseScope ||
              actorWarehouseScopes.includes(w.id) ||
              actorWarehouseScopes.includes(w.code);

            if (!isScopeAuthorized) {
              rowResults.push({
                row_index: i + 1,
                entity_id: w.id,
                status: 'failed',
                error_code: ExportErrorCode.SCOPE_FORBIDDEN,
                error_message: 'Kho hàng nằm ngoài phạm vi kho được phân quyền của tài khoản',
              });
              continue;
            }

            const phoneVal = hasPiiUnmask ? w.contact_phone : maskIdentifier(w.contact_phone);
            const emailVal = hasPiiUnmask ? w.contact_email || '' : maskIdentifier(w.contact_email);

            exportedRows.push({
              id: w.id,
              code: w.code,
              name: w.name,
              status: w.status,
              is_default: w.is_default ? 'Có' : 'Không',
              contact_name: w.contact_name,
              contact_phone: phoneVal,
              contact_email: emailVal,
              city: w.city,
              district: w.district,
              address_line: w.address_line,
              created_at: w.created_at.toISOString(),
            });

            rowResults.push({
              row_index: i + 1,
              entity_id: w.id,
              status: 'succeeded',
            });
          }
          break;
        }

        case ExportResource.AUDIT_LOGS: {
          headers = [
            { key: 'id', label: 'Mã log' },
            { key: 'action', label: 'Hành động' },
            { key: 'entity_type', label: 'Thực thể' },
            { key: 'entity_id', label: 'Mã thực thể' },
            { key: 'actor', label: 'Người thực hiện' },
            { key: 'ip_address', label: 'IP Hash' },
            { key: 'created_at', label: 'Thời gian' },
          ];

          const logWhere: Prisma.AuditLogWhereInput = { merchant_id: merchantId };
          if (dto.filters?.action && typeof dto.filters.action === 'string') {
            logWhere.action = dto.filters.action;
          }
          if (dto.filters?.entity_type && typeof dto.filters.entity_type === 'string') {
            logWhere.entity_type = dto.filters.entity_type;
          }
          if (dto.filters?.from_date && typeof dto.filters.from_date === 'string') {
            logWhere.created_at = {
              ...(logWhere.created_at as object),
              gte: new Date(dto.filters.from_date),
            };
          }
          if (dto.filters?.to_date && typeof dto.filters.to_date === 'string') {
            logWhere.created_at = {
              ...(logWhere.created_at as object),
              lte: new Date(dto.filters.to_date),
            };
          }

          const totalMatching = await this.prisma.auditLog.count({ where: logWhere });
          if (totalMatching > maxRows) {
            if (dto.filters?.clamp !== true) {
              throw new CanonicalApiException(
                HttpStatus.BAD_REQUEST,
                ExportErrorCode.EXPORT_LIMIT_EXCEEDED,
                `Số lượng bản ghi (${totalMatching}) vượt quá giới hạn xuất tối đa (${maxRows}). Vui lòng thu hẹp bộ lọc.`
              );
            }
            truncationNote = `Kết quả xuất đã được giới hạn ở ${maxRows} bản ghi đầu tiên do vượt quá số lượng tối đa cho phép (${totalMatching} bản ghi phù hợp)`;
          }

          const logs = await this.prisma.auditLog.findMany({
            where: logWhere,
            take: maxRows,
            orderBy: { created_at: 'desc' },
          });

          for (let i = 0; i < logs.length; i++) {
            const l = logs[i];
            exportedRows.push({
              id: l.id,
              action: l.action,
              entity_type: l.entity_type,
              entity_id: l.entity_id || '',
              actor: l.actor || l.user_id || '',
              ip_address: l.ip_address || '',
              created_at: l.created_at.toISOString(),
            });

            rowResults.push({
              row_index: i + 1,
              entity_id: l.id,
              status: 'succeeded',
            });
          }
          break;
        }

        case ExportResource.LEDGERS: {
          headers = [
            { key: 'ledger_group', label: 'Sổ' },
            { key: 'metric_code', label: 'Mã chỉ tiêu' },
            { key: 'metric_name', label: 'Tên chỉ tiêu' },
            { key: 'value', label: 'Giá trị (VND / Số lượng)' },
            { key: 'unit', label: 'Đơn vị' },
            { key: 'rule_note', label: 'Ghi chú quy tắc' },
          ];

          // 1. Warehouse scope & filter
          let scopedWarehouseFilter: Prisma.StringNullableFilter | undefined = undefined;
          if (!hasUniversalWarehouseScope) {
            if (actorWarehouseScopes.length === 0) {
              scopedWarehouseFilter = { in: ['__no_access__'] };
            } else {
              scopedWarehouseFilter = { in: actorWarehouseScopes };
            }
          }

          if (dto.filters?.warehouse_id && typeof dto.filters.warehouse_id === 'string') {
            const requestedWhId = dto.filters.warehouse_id;
            if (!hasUniversalWarehouseScope && !actorWarehouseScopes.includes(requestedWhId)) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                ExportErrorCode.SCOPE_FORBIDDEN,
                'Kho hàng được lọc nằm ngoài phạm vi kho được phân quyền của tài khoản'
              );
            }
            scopedWarehouseFilter = { equals: requestedWhId };
          }

          // 2. Branch scope & filter authorization (Finding 7)
          const actorStoreScopes = await this.getActorStoreScopes(actor);
          const hasUniversalStoreScope = actorStoreScopes.includes('*');

          if (dto.filters?.branch_id && typeof dto.filters.branch_id === 'string') {
            if (!hasUniversalStoreScope && !actorStoreScopes.includes(dto.filters.branch_id)) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                ExportErrorCode.SCOPE_FORBIDDEN,
                'Tài khoản không có quyền truy cập dữ liệu chi nhánh được yêu cầu'
              );
            }
          }

          const effectiveBranchFilter =
            dto.filters?.branch_id && typeof dto.filters.branch_id === 'string'
              ? { equals: dto.filters.branch_id }
              : !hasUniversalStoreScope && actorStoreScopes.length > 0
                ? { in: actorStoreScopes }
                : undefined;

          // 3. Carrier account scope & filter authorization (Finding 7)
          const actorCarrierScopes = await this.getActorCarrierAccountScopes(actor);
          const hasUniversalCarrierScope = actorCarrierScopes.includes('*');

          if (
            dto.filters?.carrier_account_id &&
            typeof dto.filters.carrier_account_id === 'string'
          ) {
            if (
              !hasUniversalCarrierScope &&
              !actorCarrierScopes.includes(dto.filters.carrier_account_id)
            ) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                ExportErrorCode.SCOPE_FORBIDDEN,
                'Tài khoản không có quyền truy cập tài khoản vận chuyển được yêu cầu'
              );
            }
          }

          const effectiveCarrierAccountFilter =
            dto.filters?.carrier_account_id && typeof dto.filters.carrier_account_id === 'string'
              ? { equals: dto.filters.carrier_account_id }
              : !hasUniversalCarrierScope && actorCarrierScopes.length > 0
                ? { in: actorCarrierScopes }
                : undefined;

          // 4. Carrier code filter (Finding 7)
          let carrierCodeFilter: Prisma.EnumCarrierCodeEnumFilter | CarrierCodeEnum | undefined =
            undefined;
          if (dto.filters?.carrier_code && typeof dto.filters.carrier_code === 'string') {
            const rawCode = dto.filters.carrier_code.toUpperCase();
            if (rawCode === 'VTP' || rawCode === 'VIETTEL_POST') {
              carrierCodeFilter = CarrierCodeEnum.VIETTEL_POST;
            } else if (rawCode === 'GHN') {
              carrierCodeFilter = CarrierCodeEnum.GHN;
            } else if (rawCode === 'GHTK') {
              carrierCodeFilter = CarrierCodeEnum.GHTK;
            } else if (rawCode === 'JT' || rawCode === 'J&T') {
              carrierCodeFilter = CarrierCodeEnum.JT;
            } else {
              carrierCodeFilter = { in: [] };
            }
          }

          // Date filters
          const fromDateRaw = (dto.filters?.from_date || dto.filters?.period_start) as
            string | undefined;
          const toDateRaw = (dto.filters?.to_date || dto.filters?.period_end) as string | undefined;
          let dateFilter: Prisma.DateTimeFilter | undefined = undefined;
          if (fromDateRaw || toDateRaw) {
            dateFilter = {};
            if (fromDateRaw) dateFilter.gte = new Date(fromDateRaw);
            if (toDateRaw) dateFilter.lte = new Date(toDateRaw);
          }

          // Shared shipment filter for relations
          const shipmentRelationFilter =
            carrierCodeFilter || effectiveCarrierAccountFilter
              ? {
                  ...(carrierCodeFilter ? { carrier_code: carrierCodeFilter } : {}),
                  ...(effectiveCarrierAccountFilter
                    ? { carrier_account_id: effectiveCarrierAccountFilter }
                    : {}),
                }
              : undefined;

          // Sổ 1: Tiền thực nhận (Recovered Cash) using BigInt lossless arithmetic (Finding 7, Finding 11)
          const claimWhere: Prisma.ClaimWhereInput = {
            merchant_id: merchantId,
            ...(scopedWarehouseFilter ? { warehouse_id: scopedWarehouseFilter } : {}),
            ...(effectiveBranchFilter ? { branch_id: effectiveBranchFilter } : {}),
            ...(dateFilter ? { created_at: dateFilter } : {}),
            ...(shipmentRelationFilter ? { shipment: shipmentRelationFilter } : {}),
          };

          const claims = await this.prisma.claim.findMany({
            where: claimWhere,
            select: {
              status: true,
              recovered_amount: true,
              accepted_amount: true,
            },
          });

          let totalRecoveredBigInt = 0n;
          let pendingAcceptanceBigInt = 0n;
          for (const c of claims) {
            if (c.status === 'ACCEPTED' || c.status === 'CLOSED') {
              const rec = c.recovered_amount ? BigInt(c.recovered_amount) : 0n;
              const acc = c.accepted_amount ? BigInt(c.accepted_amount) : 0n;
              if (rec > 0n) {
                totalRecoveredBigInt += rec;
              } else if (acc > 0n) {
                pendingAcceptanceBigInt += acc;
              }
            }
          }

          // Sổ 2: Đơn cứu được (Rescued Orders) using BigInt lossless arithmetic (Finding 7, Finding 11)
          const caseWhere: Prisma.ExceptionCaseWhereInput = {
            merchant_id: merchantId,
            status: 'RESCUED',
            ...(scopedWarehouseFilter ? { warehouse_id: scopedWarehouseFilter } : {}),
            ...(effectiveBranchFilter ? { branch_id: effectiveBranchFilter } : {}),
            ...(dateFilter ? { created_at: dateFilter } : {}),
            ...(shipmentRelationFilter ? { shipment: shipmentRelationFilter } : {}),
          };

          const rescuedCases = await this.prisma.exceptionCase.findMany({
            where: caseWhere,
            include: {
              shipment: {
                select: { cod_amount: true },
              },
            },
          });

          const rescuedCount = rescuedCases.length;
          const returnFeeSavedBigInt = BigInt(rescuedCount) * 15000n; // BR-50: 15.000 VND / đơn
          let rescuedGmvBigInt = 0n;
          for (const rc of rescuedCases) {
            if (rc.shipment?.cod_amount) {
              rescuedGmvBigInt += BigInt(rc.shipment.cod_amount);
            }
          }

          // Sổ 3: Độ phủ kiểm soát (Control Metrics) (Finding 3, Finding 7, Finding 10)
          const shipmentWhere: Prisma.ShipmentWhereInput = {
            merchant_id: merchantId,
            ...(scopedWarehouseFilter ? { warehouse_id: scopedWarehouseFilter } : {}),
            ...(effectiveBranchFilter ? { branch_id: effectiveBranchFilter } : {}),
            ...(carrierCodeFilter ? { carrier_code: carrierCodeFilter } : {}),
            ...(effectiveCarrierAccountFilter
              ? { carrier_account_id: effectiveCarrierAccountFilter }
              : {}),
            ...(dateFilter ? { created_at: dateFilter } : {}),
          };

          const discrepancyWhere: Prisma.DiscrepancyWhereInput = {
            merchant_id: merchantId,
            ...(scopedWarehouseFilter ? { warehouse_id: scopedWarehouseFilter } : {}),
            ...(effectiveBranchFilter ? { branch_id: effectiveBranchFilter } : {}),
            ...(dateFilter ? { created_at: dateFilter } : {}),
            ...(shipmentRelationFilter ? { shipment: shipmentRelationFilter } : {}),
          };

          const [totalShipments, discrepanciesCount] = await Promise.all([
            this.prisma.shipment.count({ where: shipmentWhere }),
            this.prisma.discrepancy.count({ where: discrepancyWhere }),
          ]);

          let trackingCoveragePct = 'UNAVAILABLE';
          let trackingCoverageRuleNote = 'Chưa có vận đơn trong kỳ (chỉ số không khả dụng)';

          if (totalShipments > 0) {
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const updatedWithin24hCount = await this.prisma.shipment.count({
              where: {
                ...shipmentWhere,
                events: {
                  some: {
                    occurred_at: { gte: twentyFourHoursAgo },
                  },
                },
              },
            });

            const pct = Math.round((updatedWithin24hCount / totalShipments) * 1000) / 10;
            trackingCoveragePct = `${pct}%`;
            trackingCoverageRuleNote = `Tỷ lệ vận đơn có sự kiện cập nhật trong 24h (${updatedWithin24hCount}/${totalShipments} đơn)`;
          }

          const ledgerMetrics: Array<{
            ledger_group: string;
            metric_code: string;
            metric_name: string;
            value: string | number;
            unit: string;
            rule_note: string;
          }> = [
            {
              ledger_group: 'Sổ 1 (Tiền thực nhận)',
              metric_code: 'LEDGER1_RECOVERED_AMOUNT',
              metric_name: 'Tổng tiền bồi thường đã về tài khoản',
              value: totalRecoveredBigInt.toString(),
              unit: 'VND',
              rule_note: 'Tiền thực nhận qua ngân hàng hoặc cấn trừ kỳ sau conclusive audit',
            },
            {
              ledger_group: 'Sổ 1 (Tiền thực nhận)',
              metric_code: 'LEDGER1_PENDING_ACCEPTANCE',
              metric_name: 'Tiền hãng đã chấp thuận (chờ đối soát)',
              value: pendingAcceptanceBigInt.toString(),
              unit: 'VND',
              rule_note: 'Cột riêng không cộng dồn theo BR-MONEY-01',
            },
            {
              ledger_group: 'Sổ 2 (Đơn cứu được)',
              metric_code: 'LEDGER2_RESCUED_ORDERS_COUNT',
              metric_name: 'Số đơn cứu thành công',
              value: rescuedCount,
              unit: 'Đơn hàng',
              rule_note: 'Đơn giao lại thành công sau can thiệp xử lý sự cố',
            },
            {
              ledger_group: 'Sổ 2 (Đơn cứu được)',
              metric_code: 'LEDGER2_RETURN_FEE_SAVED',
              metric_name: 'Phí chiều hoàn tránh được',
              value: returnFeeSavedBigInt.toString(),
              unit: 'VND',
              rule_note: 'BR-50: 15.000 VND / đơn không cộng cước đi',
            },
            {
              ledger_group: 'Sổ 2 (Đơn cứu được)',
              metric_code: 'LEDGER2_RESCUED_GMV',
              metric_name: 'Giá trị hàng hóa cứu được (GMV)',
              value: rescuedGmvBigInt.toString(),
              unit: 'VND',
              rule_note: 'Chỉ số theo dõi riêng, không tính vào tiền mặt thu hồi',
            },
            {
              ledger_group: 'Sổ 3 (Độ phủ kiểm soát)',
              metric_code: 'LEDGER3_TRACKING_COVERAGE_PCT',
              metric_name: 'Tỷ lệ đơn cập nhật trong 24h',
              value: trackingCoveragePct,
              unit: '%',
              rule_note: trackingCoverageRuleNote,
            },
            {
              ledger_group: 'Sổ 3 (Độ phủ kiểm soát)',
              metric_code: 'LEDGER3_DISCREPANCIES_DETECTED_COUNT',
              metric_name: 'Số lượng sai lệch phát hiện',
              value: discrepanciesCount,
              unit: 'Sai lệch',
              rule_note: 'Số sai lệch cước và COD phát hiện qua đối soát tự động',
            },
          ];

          for (let i = 0; i < ledgerMetrics.length; i++) {
            const m = ledgerMetrics[i];
            exportedRows.push(m);
            rowResults.push({
              row_index: i + 1,
              entity_id: m.metric_code,
              status: 'succeeded',
            });
          }
          break;
        }
      }

      const totalRows = rowResults.length;
      const succeededRows = rowResults.filter((r) => r.status === 'succeeded').length;
      const failedRows = rowResults.filter(
        (r) => r.status === 'failed' || r.status === 'skipped'
      ).length;

      // Compute cryptographic SHA-256 of the exported data payload (Finding 6, Finding 12)
      const dataPayload = JSON.stringify(exportedRows);
      const dataChecksumSha256 = createHash('sha256').update(dataPayload).digest('hex');

      const cleanFilters = this.sanitizeMetadataFilters(dto.filters, hasPiiUnmask);

      // Build Generation Metadata embedding authentic data checksum (Finding 6, Finding 12)
      const generatedAt = new Date().toISOString();
      const metadata: ExportGenerationMetadata = {
        export_id: jobId,
        generated_at: generatedAt,
        merchant_id: merchantId,
        requested_by: actor.userId,
        user_role: actor.role || 'MEMBER',
        resource: dto.resource,
        format: dto.format,
        filters: cleanFilters,
        rule_version: ruleVersion,
        total_rows: totalRows,
        succeeded_rows: succeededRows,
        failed_rows: failedRows,
        checksum_sha256: dataChecksumSha256,
        ...(truncationNote ? { truncation_note: truncationNote } : {}),
      };

      // Generate file buffer with complete authentic metadata
      let fileBuffer: Buffer;
      switch (dto.format) {
        case ExportFormat.CSV:
          fileBuffer = generateCsv(metadata, headers, exportedRows);
          break;
        case ExportFormat.XLSX:
          fileBuffer = generateXlsx(metadata, headers, exportedRows);
          break;
        case ExportFormat.PDF:
          fileBuffer = generatePdf(metadata, headers, exportedRows);
          break;
      }

      // Compute cryptographic SHA-256 integrity checksum of the final binary file
      const fileChecksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');

      const fileExtension = dto.format === ExportFormat.XLSX ? 'xml' : dto.format;
      const fileName = `shipde_${dto.resource}_${jobId.substring(0, 8)}.${fileExtension}`;

      // Persist completed job with tenant-scoped update and actual generation metadata (Finding 12)
      await this.prisma.exportJob.updateMany({
        where: { id: jobId, merchant_id: merchantId },
        data: {
          status: ExportJobStatus.COMPLETED,
          total_rows: totalRows,
          processed_rows: totalRows,
          succeeded_rows: succeededRows,
          failed_rows: failedRows,
          row_results: rowResults as unknown as Prisma.InputJsonValue,
          generation_metadata: metadata as unknown as Prisma.InputJsonValue,
          file_name: fileName,
          file_size_bytes: fileBuffer.byteLength,
          checksum_sha256: fileChecksumSha256,
          file_data: new Uint8Array(fileBuffer),
          completed_at: new Date(),
        },
      });

      const updatedJob = await this.prisma.exportJob.findFirst({
        where: { id: jobId, merchant_id: merchantId },
      });

      return this.formatExportJobItem(updatedJob, metadata, hasPiiUnmask);
    } catch (err: any) {
      // Map failure to safe canonical export errors (Finding 13)
      const isCanonical = err instanceof CanonicalApiException;
      const safeErrorCode = isCanonical ? err.code : ExportErrorCode.EXPORT_FAILED;
      const safeErrorMessage = isCanonical
        ? err.message
        : 'Lỗi xử lý tạo tệp xuất dữ liệu. Vui lòng thử lại sau.';

      await this.prisma.exportJob.updateMany({
        where: { id: jobId, merchant_id: merchantId },
        data: {
          status: ExportJobStatus.FAILED,
          error_code: safeErrorCode,
          error_message: safeErrorMessage,
          completed_at: new Date(),
        },
      });
      throw isCanonical
        ? err
        : new CanonicalApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            ExportErrorCode.EXPORT_FAILED,
            safeErrorMessage
          );
    }
  }

  /**
   * Retrieves an export job by ID with strict tenant isolation and resource RBAC authorization (Finding 4, Finding 10, Finding 12).
   */
  async getExportJob(
    merchantId: string,
    actor: ActorContext,
    jobId: string,
    correlationId: string
  ): Promise<ExportJobResponse> {
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id: jobId,
        merchant_id: merchantId,
      },
    });

    if (!job) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        ExportErrorCode.EXPORT_NOT_FOUND,
        'Tác vụ xuất dữ liệu không tồn tại hoặc không thuộc cửa hàng của bạn'
      );
    }

    // Enforce resource capability RBAC (Finding 4)
    await this.assertResourcePermission(actor, job.resource as ExportResource);
    const hasPiiUnmask = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);

    return {
      data: this.formatExportJobItem(job, undefined, hasPiiUnmask),
      meta: {
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Lists export jobs for a merchant with pagination and resource-level RBAC filtering (Finding 4, Finding 10).
   */
  async listExportJobs(
    merchantId: string,
    actor: ActorContext,
    query: ListExportJobsQueryDto,
    correlationId: string
  ): Promise<ListExportJobsResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // Check actor permissions across all export resources
    const authorizedResources: string[] = [];
    if (await this.rbacService.actorHasPermissions(actor, ['iam:manage_users'])) {
      authorizedResources.push(ExportResource.USERS);
    }
    if (await this.rbacService.actorHasPermissions(actor, ['iam:shop_config'])) {
      authorizedResources.push(ExportResource.WAREHOUSES);
    }
    if (await this.rbacService.actorHasPermissions(actor, ['audit:view'])) {
      authorizedResources.push(ExportResource.AUDIT_LOGS);
    }
    const hasViewRates = await this.rbacService.actorHasPermissions(actor, [
      'reconciliation:view_contract_rates',
    ]);
    const hasRunAudit = await this.rbacService.actorHasPermissions(actor, [
      'reconciliation:run_review_audit',
    ]);
    if (hasViewRates || hasRunAudit) {
      authorizedResources.push(ExportResource.LEDGERS);
    }

    const where: Prisma.ExportJobWhereInput = {
      merchant_id: merchantId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.resource) {
      await this.assertResourcePermission(actor, query.resource);
      where.resource = query.resource;
    } else {
      if (authorizedResources.length === 0) {
        return {
          data: [],
          meta: {
            total: 0,
            page,
            limit,
            total_pages: 1,
            correlation_id: correlationId,
            timestamp: new Date().toISOString(),
          },
        };
      }
      where.resource = { in: authorizedResources };
    }

    const [total, items] = await Promise.all([
      this.prisma.exportJob.count({ where }),
      this.prisma.exportJob.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasPiiUnmask = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);

    return {
      data: items.map((item) => this.formatExportJobItem(item, undefined, hasPiiUnmask)),
      meta: {
        total,
        page,
        limit,
        total_pages: totalPages,
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Streams and audits the download of an export file with strict resource RBAC, scope, and PII checks (Finding 3, Finding 4, Finding 7).
   */
  async downloadExport(
    merchantId: string,
    actor: ActorContext,
    jobId: string,
    clientIp: string,
    correlationId: string
  ): Promise<DownloadResult> {
    const job = await this.prisma.exportJob.findFirst({
      where: {
        id: jobId,
        merchant_id: merchantId,
      },
    });

    if (!job) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        ExportErrorCode.EXPORT_NOT_FOUND,
        'Tác vụ xuất dữ liệu không tồn tại hoặc không thuộc cửa hàng của bạn'
      );
    }

    // 1. Enforce TTL expiration (Finding 14)
    if (job.expires_at && new Date() > new Date(job.expires_at)) {
      throw new CanonicalApiException(
        HttpStatus.GONE,
        ExportErrorCode.EXPORT_EXPIRED,
        'Tệp xuất dữ liệu đã hết hạn lưu trữ và không còn khả dụng để tải xuống'
      );
    }

    // 2. Enforce resource capability RBAC (Finding 4)
    await this.assertResourcePermission(actor, job.resource as ExportResource);

    const jobFilters = (job.filters as Record<string, unknown>) || {};

    // 3. Enforce warehouse scope authorization on download (Finding 4)
    if (job.resource === ExportResource.WAREHOUSES) {
      const actorWarehouseScopes = await this.getActorWarehouseScopes(actor);
      const hasUniversalWarehouseScope = actorWarehouseScopes.includes('*');

      if (!hasUniversalWarehouseScope) {
        const rowResults = (job.row_results as unknown as ExportRowResult[]) || [];
        const hasOutOfScopeRows = rowResults.some(
          (r) =>
            r.status === 'succeeded' && r.entity_id && !actorWarehouseScopes.includes(r.entity_id)
        );
        if (hasOutOfScopeRows) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            ExportErrorCode.SCOPE_FORBIDDEN,
            'Tệp xuất dữ liệu chứa bản ghi kho hàng nằm ngoài phạm vi phân quyền của tài khoản'
          );
        }
      }
    }

    // 4. Enforce branch & carrier account scope authorization on download for ledgers (Finding 7)
    if (job.resource === ExportResource.LEDGERS) {
      const actorWarehouseScopes = await this.getActorWarehouseScopes(actor);
      const hasUniversalWarehouseScope = actorWarehouseScopes.includes('*');
      if (!hasUniversalWarehouseScope && jobFilters.warehouse_id) {
        if (!actorWarehouseScopes.includes(jobFilters.warehouse_id as string)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            ExportErrorCode.SCOPE_FORBIDDEN,
            'Tệp xuất dữ liệu chứa bản ghi kho hàng nằm ngoài phạm vi phân quyền của tài khoản'
          );
        }
      }

      const actorStoreScopes = await this.getActorStoreScopes(actor);
      const hasUniversalStoreScope = actorStoreScopes.includes('*');
      if (!hasUniversalStoreScope && jobFilters.branch_id) {
        if (!actorStoreScopes.includes(jobFilters.branch_id as string)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            ExportErrorCode.SCOPE_FORBIDDEN,
            'Tệp xuất dữ liệu chứa bản ghi chi nhánh nằm ngoài phạm vi phân quyền của tài khoản'
          );
        }
      }

      const actorCarrierScopes = await this.getActorCarrierAccountScopes(actor);
      const hasUniversalCarrierScope = actorCarrierScopes.includes('*');
      if (!hasUniversalCarrierScope && jobFilters.carrier_account_id) {
        if (!actorCarrierScopes.includes(jobFilters.carrier_account_id as string)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            ExportErrorCode.SCOPE_FORBIDDEN,
            'Tệp xuất dữ liệu chứa bản ghi tài khoản vận chuyển nằm ngoài phạm vi phân quyền của tài khoản'
          );
        }
      }
    }

    // 5. Enforce PII protection on download (Finding 3 / Prior #4)
    // If resource is USERS or WAREHOUSES (contain PII identifiers like phone/email):
    // If explicitly marked as masked (false), safe for any authorized user.
    // If marked as unmasked (true) OR if __unmasked_pii is undefined/null (historical unmarked file),
    // fail closed: require downloader to possess pii:unmask capability!
    const resourceHasPii =
      job.resource === ExportResource.USERS || job.resource === ExportResource.WAREHOUSES;
    const isExplicitlyMasked = jobFilters.__unmasked_pii === false;
    if (resourceHasPii && !isExplicitlyMasked) {
      const hasPiiUnmask = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);
      if (!hasPiiUnmask) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          ExportErrorCode.FORBIDDEN,
          'Tài khoản của bạn không có quyền xem dữ liệu định danh PII (yêu cầu quyền pii:unmask)'
        );
      }
    }

    // 6. Verify job execution status
    if (job.status === ExportJobStatus.PENDING || job.status === ExportJobStatus.PROCESSING) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        ExportErrorCode.EXPORT_NOT_READY,
        'Tác vụ xuất dữ liệu đang được xử lý, vui lòng thử lại sau giây lát'
      );
    }
    if (job.status === ExportJobStatus.FAILED) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        ExportErrorCode.EXPORT_FAILED,
        job.error_message || 'Tác vụ xuất dữ liệu đã thất bại, vui lòng tạo yêu cầu xuất mới'
      );
    }

    if (!job.file_data) {
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ExportErrorCode.EXPORT_FAILED,
        'Không tìm thấy nội dung tệp xuất dữ liệu'
      );
    }

    const fileBuffer = Buffer.from(job.file_data);

    let mimeType = 'text/csv; charset=utf-8';
    if (job.format === ExportFormat.XLSX) {
      mimeType = 'application/vnd.ms-excel';
    } else if (job.format === ExportFormat.PDF) {
      mimeType = 'application/pdf';
    }

    // Write immutable EXPORT_DOWNLOADED audit log with client IP hash and sanitized filters (Finding 13)
    const sanitizedFilters = this.sanitizeMetadataFilters(jobFilters, isExplicitlyMasked === false);
    await this.prisma.auditLog.create({
      data: {
        merchant_id: merchantId,
        user_id: actor.userId,
        actor: actor.role || actor.userId || null,
        action: ExportAuditEvent.EXPORT_DOWNLOADED,
        entity_type: 'export_job',
        entity_id: job.id,
        old_value: Prisma.JsonNull,
        new_value: {
          job_id: job.id,
          resource: job.resource,
          format: job.format,
          filters: sanitizedFilters,
          file_name: job.file_name,
          file_size_bytes: job.file_size_bytes,
          checksum_sha256: job.checksum_sha256,
        } as unknown as Prisma.InputJsonValue,
        reason: correlationId ? `correlation_id:${correlationId}` : null,
        ip_address: this.hashIp(clientIp),
      },
    });

    return {
      fileBuffer,
      fileName: job.file_name || `export_${job.id.substring(0, 8)}.${job.format}`,
      mimeType,
      checksum: job.checksum_sha256 || '',
      fileSize: job.file_size_bytes || fileBuffer.byteLength,
    };
  }

  /**
   * Helper to format ExportJob database model into API contract shape.
   * Loads persisted generation_metadata or reconstructs it, respecting PII masking (Finding 10, Finding 12).
   */
  private formatExportJobItem(
    job: any,
    explicitMetadata?: ExportGenerationMetadata,
    viewerHasPiiUnmask = false
  ): ExportJobItem {
    const rawFilters = (job.filters as Record<string, unknown>) || {};
    const { __unmasked_pii, ...cleanFilters } = rawFilters;
    const sanitizedCleanFilters = viewerHasPiiUnmask
      ? cleanFilters
      : this.sanitizeMetadataFilters(cleanFilters, false);

    let metadata = explicitMetadata;
    if (!metadata && job.generation_metadata) {
      metadata = job.generation_metadata as unknown as ExportGenerationMetadata;
      if (!viewerHasPiiUnmask && metadata.filters) {
        metadata = {
          ...metadata,
          filters: this.sanitizeMetadataFilters(metadata.filters, false),
        };
      }
    } else if (!metadata && job.status === ExportJobStatus.COMPLETED) {
      metadata = {
        export_id: job.id,
        generated_at: job.completed_at
          ? new Date(job.completed_at).toISOString()
          : new Date(job.created_at).toISOString(),
        merchant_id: job.merchant_id,
        requested_by: job.user_id,
        user_role: job.user?.role || 'MEMBER',
        resource: job.resource as ExportResource,
        format: job.format as ExportFormat,
        filters: sanitizedCleanFilters,
        rule_version: job.rule_version || resolveExportRuleVersion(),
        total_rows: job.total_rows || 0,
        succeeded_rows: job.succeeded_rows || 0,
        failed_rows: job.failed_rows || 0,
        checksum_sha256: job.checksum_sha256 || '',
      };
    }

    return {
      id: job.id,
      merchant_id: job.merchant_id,
      user_id: job.user_id,
      resource: job.resource as ExportResource,
      format: job.format as ExportFormat,
      status: job.status as ExportJobStatus,
      filters: Object.keys(sanitizedCleanFilters).length > 0 ? sanitizedCleanFilters : undefined,
      total_rows: job.total_rows || 0,
      processed_rows: job.processed_rows || 0,
      succeeded_rows: job.succeeded_rows || 0,
      failed_rows: job.failed_rows || 0,
      file_name: job.file_name || undefined,
      file_size_bytes: job.file_size_bytes || undefined,
      checksum_sha256: job.checksum_sha256 || undefined,
      error_code: job.error_code || undefined,
      error_message: job.error_message || undefined,
      download_url:
        job.status === ExportJobStatus.COMPLETED ? `/api/v1/exports/${job.id}/download` : undefined,
      metadata,
      row_results: (job.row_results as unknown as ExportRowResult[]) || undefined,
      rule_version: job.rule_version || undefined,
      created_at: job.created_at
        ? new Date(job.created_at).toISOString()
        : new Date().toISOString(),
      completed_at: job.completed_at ? new Date(job.completed_at).toISOString() : undefined,
    };
  }
}
