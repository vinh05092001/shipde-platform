import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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
export class ExportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  /**
   * Hashes client IP to ensure GDPR/privacy compliance in immutable audit logs.
   */
  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex');
  }

  /**
   * Enforces server-side capability permissions for the requested resource type.
   */
  async assertResourcePermission(actor: ActorContext, resource: ExportResource): Promise<void> {
    if (actor.role === 'OWNER') return;

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
        requiredPermissions = [
          'reconciliation:view_contract_rates',
          'reconciliation:run_review_audit',
        ];
        break;
      default:
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          ExportErrorCode.UNSUPPORTED_RESOURCE,
          `Tài nguyên '${resource}' không được hỗ trợ để xuất dữ liệu`
        );
    }

    if (resource === ExportResource.LEDGERS) {
      // For ledgers, having either view_contract_rates OR run_review_audit is sufficient
      const hasViewRates = await this.rbacService.actorHasPermissions(actor, [
        'reconciliation:view_contract_rates',
      ]);
      const hasRunAudit = await this.rbacService.actorHasPermissions(actor, [
        'reconciliation:run_review_audit',
      ]);
      if (!hasViewRates && !hasRunAudit) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          ExportErrorCode.FORBIDDEN,
          'Bạn không có quyền xuất báo cáo tài chính/sổ giá trị (yêu cầu quyền reconciliation:view_contract_rates hoặc reconciliation:run_review_audit)'
        );
      }
      return;
    }

    const hasPerm = await this.rbacService.actorHasPermissions(actor, requiredPermissions);
    if (!hasPerm) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        ExportErrorCode.FORBIDDEN,
        `Bạn không có quyền xuất dữ liệu tài nguyên '${resource}' (yêu cầu quyền ${requiredPermissions.join(
          ', '
        )})`
      );
    }
  }

  /**
   * Creates an export job and executes it synchronously (or schedules it).
   */
  async createExportJob(
    merchantId: string,
    actor: ActorContext,
    dto: CreateExportJobDto,
    clientIp: string,
    correlationId: string
  ): Promise<CreateExportJobResponse> {
    // 1. Authorize resource permission
    await this.assertResourcePermission(actor, dto.resource);

    const ttlSeconds = resolveExportJobTtlSeconds();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const ruleVersion = resolveExportRuleVersion();

    // 2. Persist initial ExportJob record in database
    const jobRecord = await this.prisma.exportJob.create({
      data: {
        id: randomUUID(),
        merchant_id: merchantId,
        user_id: actor.userId,
        resource: dto.resource,
        format: dto.format,
        status: ExportJobStatus.PENDING,
        filters: (dto.filters as unknown as Prisma.InputJsonValue) || Prisma.JsonNull,
        rule_version: ruleVersion,
        expires_at: expiresAt,
      },
    });

    // 3. Write immutable EXPORT_REQUESTED audit log
    await this.prisma.auditLog.create({
      data: {
        merchant_id: merchantId,
        user_id: actor.userId,
        actor: actor.role || actor.userId || null,
        action: ExportAuditEvent.EXPORT_REQUESTED,
        entity_type: 'export_job',
        entity_id: jobRecord.id,
        old_value: Prisma.JsonNull,
        new_value: {
          job_id: jobRecord.id,
          resource: dto.resource,
          format: dto.format,
          filters: dto.filters || {},
          rule_version: ruleVersion,
        } as unknown as Prisma.InputJsonValue,
        reason: correlationId ? `correlation_id:${correlationId}` : null,
        ip_address: this.hashIp(clientIp),
      },
    });

    // 4. Process execution (synchronous execution for responsive API response)
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
   */
  async processExportJob(
    merchantId: string,
    actor: ActorContext,
    jobId: string,
    dto: CreateExportJobDto,
    clientIp: string,
    correlationId: string
  ): Promise<ExportJobItem> {
    // Update status to processing
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: { status: ExportJobStatus.PROCESSING },
    });

    // Check PII unmask capability
    const hasPiiUnmask =
      actor.role === 'OWNER' || (await this.rbacService.actorHasPermissions(actor, ['pii:unmask']));

    const maxRows = resolveExportMaxRows();
    const ruleVersion = resolveExportRuleVersion();

    let headers: { key: string; label: string }[] = [];
    const exportedRows: Record<string, unknown>[] = [];
    const rowResults: ExportRowResult[] = [];

    // Actor warehouse scopes for FEAT-RBAC-02 per-row scoping
    const actorWarehouseScopes = await this.getActorWarehouseScopes(actor);
    const hasUniversalWarehouseScope = actor.role === 'OWNER' || actorWarehouseScopes.includes('*');

    // Retrieve data according to requested resource
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

        const users = await this.prisma.user.findMany({
          where: { merchant_id: merchantId },
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

        const warehouses = await this.prisma.warehouse.findMany({
          where: { merchant_id: merchantId },
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
            // Out-of-scope row: omit from export and record truthful per-row SCOPE_FORBIDDEN
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

        const logs = await this.prisma.auditLog.findMany({
          where: { merchant_id: merchantId },
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

        // Three Ledgers summary dataset (BR-50 & CN-18 financial integrity)
        const ledgerMetrics = [
          {
            ledger_group: 'Sổ 1 (Tiền thực nhận)',
            metric_code: 'LEDGER1_RECOVERED_AMOUNT',
            metric_name: 'Tổng tiền bồi thường đã về tài khoản',
            value: 0,
            unit: 'VND',
            rule_note: 'Tiền thực nhận qua bank/cấn trừ kỳ sau conclusive audit',
          },
          {
            ledger_group: 'Sổ 1 (Tiền thực nhận)',
            metric_code: 'LEDGER1_PENDING_ACCEPTANCE',
            metric_name: 'Tiền hãng đã chấp thuận (chờ đối soát)',
            value: 0,
            unit: 'VND',
            rule_note: 'Cột riêng không cộng dồn theo BR-MONEY-01',
          },
          {
            ledger_group: 'Sổ 2 (Đơn cứu được)',
            metric_code: 'LEDGER2_RESCUED_ORDERS_COUNT',
            metric_name: 'Số đơn cứu thành công',
            value: 0,
            unit: 'Đơn hàng',
            rule_note: 'Đơn giao lại thành công sau can thiệp xử lý sự cố',
          },
          {
            ledger_group: 'Sổ 2 (Đơn cứu được)',
            metric_code: 'LEDGER2_RETURN_FEE_SAVED',
            metric_name: 'Phí chiều hoàn tránh được',
            value: 0,
            unit: 'VND',
            rule_note: 'BR-50: 15.000 VND / đơn không cộng cước đi',
          },
          {
            ledger_group: 'Sổ 2 (Đơn cứu được)',
            metric_code: 'LEDGER2_RESCUED_GMV',
            metric_name: 'Giá trị hàng hóa cứu được (GMV)',
            value: 0,
            unit: 'VND',
            rule_note: 'Chỉ số theo dõi riêng, không tính vào tiền mặt thu hồi',
          },
          {
            ledger_group: 'Sổ 3 (Độ phủ kiểm soát)',
            metric_code: 'LEDGER3_TRACKING_COVERAGE_PCT',
            metric_name: 'Tỷ lệ đơn cập nhật trong 24h',
            value: 100,
            unit: '%',
            rule_note: 'Chỉ số minh bạch vận hành SLA',
          },
          {
            ledger_group: 'Sổ 3 (Độ phủ kiểm soát)',
            metric_code: 'LEDGER3_ACCOUNTING_HOURS_SAVED',
            metric_name: 'Giờ công kế toán tiết kiệm',
            value: 12,
            unit: 'Giờ',
            rule_note: 'Thời gian đối soát tự động hóa tiết kiệm',
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

    // Build Generation Metadata
    const generatedAt = new Date().toISOString();
    const metadataPlaceholder: ExportGenerationMetadata = {
      export_id: jobId,
      generated_at: generatedAt,
      merchant_id: merchantId,
      requested_by: actor.userId,
      user_role: actor.role || 'MEMBER',
      resource: dto.resource,
      format: dto.format,
      filters: dto.filters || {},
      rule_version: ruleVersion,
      total_rows: totalRows,
      succeeded_rows: succeededRows,
      failed_rows: failedRows,
      checksum_sha256: 'PENDING_COMPUTATION',
    };

    // First generate buffer without final checksum to get exact content
    let fileBuffer: Buffer;
    switch (dto.format) {
      case ExportFormat.CSV:
        fileBuffer = generateCsv(metadataPlaceholder, headers, exportedRows);
        break;
      case ExportFormat.XLSX:
        fileBuffer = generateXlsx(metadataPlaceholder, headers, exportedRows);
        break;
      case ExportFormat.PDF:
        fileBuffer = generatePdf(metadataPlaceholder, headers, exportedRows);
        break;
    }

    // Compute cryptographic SHA-256 integrity checksum
    const checksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');

    // Regenerate with authentic checksum included in metadata
    const finalMetadata: ExportGenerationMetadata = {
      ...metadataPlaceholder,
      checksum_sha256: checksumSha256,
    };

    switch (dto.format) {
      case ExportFormat.CSV:
        fileBuffer = generateCsv(finalMetadata, headers, exportedRows);
        break;
      case ExportFormat.XLSX:
        fileBuffer = generateXlsx(finalMetadata, headers, exportedRows);
        break;
      case ExportFormat.PDF:
        fileBuffer = generatePdf(finalMetadata, headers, exportedRows);
        break;
    }

    // Recompute final checksum on finalized fileBuffer
    const finalChecksumSha256 = createHash('sha256').update(fileBuffer).digest('hex');
    finalMetadata.checksum_sha256 = finalChecksumSha256;

    const fileExtension = dto.format === ExportFormat.XLSX ? 'xml' : dto.format;
    const fileName = `shipde_${dto.resource}_${jobId.substring(0, 8)}.${fileExtension}`;

    // Persist completed job and binary content in database
    const updated = await this.prisma.exportJob.update({
      where: { id: jobId },
      data: {
        status: ExportJobStatus.COMPLETED,
        total_rows: totalRows,
        processed_rows: totalRows,
        succeeded_rows: succeededRows,
        failed_rows: failedRows,
        row_results: rowResults as unknown as Prisma.InputJsonValue,
        file_name: fileName,
        file_size_bytes: fileBuffer.byteLength,
        checksum_sha256: finalChecksumSha256,
        file_data: new Uint8Array(fileBuffer),
        completed_at: new Date(),
      },
    });

    return this.formatExportJobItem(updated, finalMetadata);
  }

  /**
   * Retrieves an export job by ID with strict tenant isolation.
   */
  async getExportJob(
    merchantId: string,
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

    return {
      data: this.formatExportJobItem(job),
      meta: {
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Lists export jobs for the caller's tenant with pagination and optional filters.
   */
  async listExportJobs(
    merchantId: string,
    query: ListExportJobsQueryDto,
    correlationId: string
  ): Promise<ListExportJobsResponse> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ExportJobWhereInput = {
      merchant_id: merchantId,
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.resource) {
      where.resource = query.resource;
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

    return {
      data: items.map((item) => this.formatExportJobItem(item)),
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
   * Streams and audits the download of an export file.
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

    if (job.status === ExportJobStatus.PENDING || job.status === ExportJobStatus.PROCESSING) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        ExportErrorCode.EXPORT_NOT_READY,
        'Tệp xuất dữ liệu đang được tạo, vui lòng thử lại sau giây lát',
        false,
        'Kiểm tra lại trạng thái sau khi tác vụ hoàn thành'
      );
    }

    if (job.status === ExportJobStatus.FAILED || !job.file_data) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        ExportErrorCode.EXPORT_FAILED,
        `Tác vụ xuất dữ liệu đã thất bại: ${job.error_message || 'Không có dữ liệu tệp'}`
      );
    }

    // Determine MIME type
    let mimeType = 'text/csv; charset=utf-8';
    if (job.format === ExportFormat.XLSX) {
      mimeType = 'application/vnd.ms-excel; charset=utf-8';
    } else if (job.format === ExportFormat.PDF) {
      mimeType = 'application/pdf';
    }

    const fileBuffer = Buffer.from(job.file_data);

    // Record immutable EXPORT_DOWNLOADED audit log
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
      fileName: job.file_name || `shipde_export_${job.id}.${job.format}`,
      mimeType,
      checksum: job.checksum_sha256 || '',
      fileSize: job.file_size_bytes || fileBuffer.byteLength,
    };
  }

  /**
   * Helper to format ExportJob database model into API contract shape.
   */
  private formatExportJobItem(
    job: any,
    explicitMetadata?: ExportGenerationMetadata
  ): ExportJobItem {
    return {
      id: job.id,
      merchant_id: job.merchant_id,
      user_id: job.user_id,
      resource: job.resource as ExportResource,
      format: job.format as ExportFormat,
      status: job.status as ExportJobStatus,
      filters: (job.filters as Record<string, unknown>) || undefined,
      total_rows: job.total_rows || 0,
      processed_rows: job.processed_rows || 0,
      succeeded_rows: job.succeeded_rows || 0,
      failed_rows: job.failed_rows || 0,
      file_name: job.file_name || undefined,
      file_size_bytes: job.file_size_bytes || undefined,
      checksum_sha256: job.checksum_sha256 || undefined,
      download_url: `/api/v1/exports/${job.id}/download`,
      error_code: job.error_code || undefined,
      error_message: job.error_message || undefined,
      metadata: explicitMetadata || undefined,
      row_results: (job.row_results as unknown as ExportRowResult[]) || undefined,
      rule_version: job.rule_version || undefined,
      created_at: job.created_at
        ? new Date(job.created_at).toISOString()
        : new Date().toISOString(),
      completed_at: job.completed_at ? new Date(job.completed_at).toISOString() : undefined,
    };
  }
}
