import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AppConfig } from '@shipde/config';
import { APP_CONFIG } from '../config.token';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { ImportTemplateType, ImportStatus, ImportAuditEvent } from '@shipde/contracts';
import {
  TEMPLATE_DEFINITIONS,
  TemplateDefinition,
  SENSITIVE_IMPORT_AUDIT_FIELDS,
} from './imports.constants';
import {
  parseCsv,
  generateCsv,
  generateXlsxTemplate,
  parseXlsx,
  normalizeRowsWithTemplate,
  calculateFileHash,
  scanBufferForMalware,
} from './imports.parser';
import {
  UploadImportDto,
  ListImportsDto,
  ListImportRowsDto,
  validateImportRow,
  ValidatedRowResult,
} from './imports.dto';
import { maskIdentifier } from '../invitations/invitations.service';

@Injectable()
export class ImportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Masks sensitive fields (phone, email) for audit log entries.
   */
  public maskAuditData(data: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      if (val === null || val === undefined) {
        masked[key] = val;
      } else if (typeof val === 'string' && SENSITIVE_IMPORT_AUDIT_FIELDS.has(key)) {
        masked[key] = maskIdentifier(val);
      } else if (typeof val === 'object' && !Array.isArray(val)) {
        masked[key] = this.maskAuditData(val);
      } else {
        masked[key] = val;
      }
    }
    return masked;
  }

  /**
   * Generates download template (CSV or XLSX) for supported entities (branches, warehouses).
   */
  public getTemplate(
    templateType: string,
    format: 'csv' | 'xlsx' = 'csv'
  ): { buffer: Buffer; mimeType: string; fileName: string } {
    const template = TEMPLATE_DEFINITIONS[templateType];
    if (!template) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TEMPLATE_TYPE',
        `Mẫu nhập khẩu không hợp lệ. Cho phép: ${Object.keys(TEMPLATE_DEFINITIONS).join(', ')}`,
        false
      );
    }

    if (format === 'xlsx') {
      const buffer = generateXlsxTemplate(template);
      return {
        buffer,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileName: `template_${templateType}.xlsx`,
      };
    } else {
      const headers = template.columns.map((c) => c.key);
      const csvStr = generateCsv(headers, template.sampleRows);
      return {
        buffer: Buffer.from(csvStr, 'utf8'),
        mimeType: 'text/csv',
        fileName: `template_${templateType}.csv`,
      };
    }
  }

  /**
   * Uploads, checks malware/size/types, parses, validates, and stages an import file.
   * Handles deduplication via file checksum and idempotency conflict verification (Decision 2).
   */
  public async uploadAndProcess(
    merchantId: string,
    actor: ActorContext,
    dto: UploadImportDto,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string,
    idempotencyKey?: string,
    correlationId?: string,
    clientIp?: string
  ): Promise<{ statusCode: number; data: any; meta: any }> {
    const template = TEMPLATE_DEFINITIONS[dto.template_type];
    if (!template) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_TEMPLATE_TYPE',
        `Mẫu nhập khẩu không hợp lệ. Cho phép: ${Object.keys(TEMPLATE_DEFINITIONS).join(', ')}`,
        false
      );
    }

    // 1. File size verification from config (fail closed)
    const maxSizeBytes = this.config.MAX_IMPORT_FILE_SIZE_BYTES || 10 * 1024 * 1024;
    if (fileBuffer.length > maxSizeBytes) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'FILE_TOO_LARGE',
        `Dung lượng tệp tin (${fileBuffer.length} bytes) vượt quá giới hạn tối đa cho phép (${maxSizeBytes} bytes)`,
        false,
        undefined,
        [
          {
            field: 'file_size',
            code: 'FILE_TOO_LARGE',
            message: `Tối đa ${maxSizeBytes} bytes`,
          },
        ]
      );
    }

    // 2. MIME type verification from config
    const allowedMimeTypes = this.config.ALLOWED_IMPORT_MIME_TYPES || [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
    ];

    const cleanMime = mimeType ? mimeType.toLowerCase().split(';')[0].trim() : '';
    const hasValidMime = allowedMimeTypes.some(
      (m) => cleanMime.includes(m.toLowerCase()) || m.toLowerCase().includes(cleanMime)
    );
    const hasValidExtension =
      fileName.toLowerCase().endsWith('.csv') || fileName.toLowerCase().endsWith('.xlsx');

    if (!hasValidMime && !hasValidExtension) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_FILE_TYPE',
        `Định dạng tệp tin (${mimeType}) không được hỗ trợ. Chỉ hỗ trợ định dạng CSV hoặc XLSX`,
        false,
        undefined,
        [
          {
            field: 'mime_type',
            code: 'INVALID_FILE_TYPE',
            message: `Cho phép: ${allowedMimeTypes.join(', ')}`,
          },
        ]
      );
    }

    // 3. Malware scanner verification from config
    if (this.config.MALWARE_SCANNER_ENABLED) {
      const malwareResult = scanBufferForMalware(fileBuffer);
      if (!malwareResult.safe) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'MALWARE_DETECTED',
          `Phát hiện tệp tin nghi ngờ độc hại hoặc chứa mã nguy hiểm: ${malwareResult.reason}`,
          false,
          undefined,
          [
            {
              field: 'file',
              code: 'MALWARE_DETECTED',
              message: malwareResult.reason || 'Malware detected',
            },
          ]
        );
      }
    }

    // 4. Calculate SHA-256 file checksum
    const fileHash = calculateFileHash(fileBuffer);

    // 5. Identity and Deduplication Check (Decision 2)
    // An import is identified by (tenant, template type, file checksum)
    const existingWithSameHash = await this.prisma.import.findFirst({
      where: {
        merchant_id: merchantId,
        template_type: dto.template_type,
        file_hash: fileHash,
      },
      include: {
        rows: {
          orderBy: { row_number: 'asc' },
          take: 20,
        },
      },
    });

    if (existingWithSameHash) {
      // Check idempotency conflict
      if (idempotencyKey) {
        const conflictingKey = await this.prisma.import.findFirst({
          where: {
            merchant_id: merchantId,
            idempotency_key: idempotencyKey,
            file_hash: { not: fileHash },
          },
        });
        if (conflictingKey) {
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'IDEMPOTENCY_CONFLICT',
            `Khóa bất biến (Idempotency-Key: ${idempotencyKey}) đã được sử dụng với nội dung tệp khác nhau`,
            false
          );
        }
      }

      const detail = await this.formatImportDetail(existingWithSameHash, correlationId);
      return {
        statusCode: HttpStatus.OK,
        data: detail.data,
        meta: detail.meta,
      };
    }

    // 6. Idempotency check for new hash with existing idempotency key
    if (idempotencyKey) {
      const existingWithKey = await this.prisma.import.findFirst({
        where: {
          merchant_id: merchantId,
          idempotency_key: idempotencyKey,
        },
      });
      if (existingWithKey) {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          `Khóa bất biến (Idempotency-Key: ${idempotencyKey}) đã được sử dụng cho một tệp khác`,
          false
        );
      }
    }

    // 7. Determine Next Immutable Revision
    const latestRevisionRecord = await this.prisma.import.findFirst({
      where: {
        merchant_id: merchantId,
        template_type: dto.template_type,
      },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });
    const nextRevision = (latestRevisionRecord?.revision ?? 0) + 1;

    // 8. Parse file lines (CSV or XLSX)
    let parsed: { headers: string[]; rows: Record<string, string>[] };
    const isXlsx =
      cleanMime.includes('openxmlformats') ||
      cleanMime.includes('excel') ||
      fileName.toLowerCase().endsWith('.xlsx');

    try {
      if (isXlsx) {
        parsed = parseXlsx(fileBuffer);
      } else {
        parsed = parseCsv(fileBuffer.toString('utf8'));
      }
    } catch (err: any) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'FILE_PARSE_ERROR',
        `Không thể đọc dữ liệu tệp tin: ${err.message || 'Lỗi định dạng'}`,
        false
      );
    }

    if (parsed.rows.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'EMPTY_FILE',
        'Tệp tải lên không chứa dòng dữ liệu nào',
        false
      );
    }

    // 9. Normalize & Validate Rows
    const { normalizedRows } = normalizeRowsWithTemplate(template, parsed.headers, parsed.rows);
    const seenScopeCodes = new Set<string>();
    const validatedRows: ValidatedRowResult[] = [];

    for (const nr of normalizedRows) {
      const result = validateImportRow(
        template,
        nr.rowNumber,
        nr.rawData,
        nr.mappedData,
        seenScopeCodes
      );
      validatedRows.push(result);
    }

    // Control totals
    const defaultRows = validatedRows.filter((r) => r.normalizedData?.is_default === true);
    if (defaultRows.length > 1) {
      for (const dr of defaultRows) {
        dr.status = 'ERROR';
        dr.issues.push({
          field: 'is_default',
          code: 'MULTIPLE_DEFAULTS',
          message: `Dòng ${dr.rowNumber}: Tệp chứa nhiều dòng được đánh dấu là mặc định. Chỉ được phép có tối đa một mặc định theo BR-BRANCH-03.`,
          severity: 'BLOCKING',
        });
      }
    }

    const totalRows = validatedRows.length;
    const validRows = validatedRows.filter((r) => r.status === 'VALID').length;
    const errorRows = validatedRows.filter((r) => r.status === 'ERROR').length;
    const warningRows = validatedRows.filter((r) => r.status === 'WARNING').length;

    // Determine status (Decision 1 & DATA-LIFECYCLE-IMPORTS.md)
    // Key/control error prevents promotion: if errorRows > 0 -> BLOCKED, else STAGED
    const importStatus = errorRows > 0 ? ImportStatus.BLOCKED : ImportStatus.STAGED;

    const controlTotals = {
      total_rows: totalRows,
      valid_rows: validRows,
      error_rows: errorRows,
      warning_rows: warningRows,
    };

    // 10. Private storage persistence (Finding 3: fails closed if persistence fails)
    const storageKey = `imports/${merchantId}/${dto.template_type}/rev${nextRevision}_${fileHash}.dat`;
    let storagePath: string;
    try {
      storagePath = await this.storageService.putObject(storageKey, fileBuffer, mimeType);
    } catch (storageErr: any) {
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'STORAGE_ERROR',
        `Không thể lưu trữ tệp tin tải lên: ${storageErr.message || 'Lỗi lưu trữ'}`,
        false
      );
    }

    // 11. Transactional Database Ingestion
    const createdImport = await this.prisma.$transaction(async (tx) => {
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
      }

      const imp = await tx.import.create({
        data: {
          merchant_id: merchantId,
          template_type: dto.template_type,
          file_name: fileName || `import_${dto.template_type}_rev${nextRevision}.csv`,
          file_size: fileBuffer.length,
          file_hash: fileHash,
          mime_type: mimeType || 'text/csv',
          storage_path: storagePath,
          status: importStatus,
          revision: nextRevision,
          idempotency_key: idempotencyKey || null,
          total_rows: totalRows,
          valid_rows: validRows,
          error_rows: errorRows,
          warning_rows: warningRows,
          control_totals: controlTotals,
          created_by_user_id: actor.userId || null,
        },
      });

      // Insert import rows
      const rowData = validatedRows.map((vr) => ({
        import_id: imp.id,
        row_number: vr.rowNumber,
        raw_data: vr.rawData,
        normalized_data: vr.normalizedData,
        status: vr.status,
        scope_identifier: vr.scopeIdentifier,
        issues_json: vr.issues.length > 0 ? (vr.issues as any) : Prisma.JsonNull,
      }));

      await tx.importRow.createMany({
        data: rowData,
      });

      // Audit upload (Finding 13)
      if (tx.auditLog?.create) {
        await tx.auditLog.create({
          data: {
            merchant_id: merchantId,
            user_id: actor.userId,
            actor: actor.role || 'OWNER',
            action: 'IMPORT_UPLOADED',
            entity_type: 'import',
            entity_id: imp.id,
            ip_address: clientIp ? this.hashIp(clientIp) : null,
            new_value: {
              template_type: imp.template_type,
              revision: imp.revision,
              file_name: imp.file_name,
              file_hash: imp.file_hash,
              total_rows: totalRows,
              status: importStatus,
            },
          },
        });
      }

      return imp;
    });

    const fullDetail = await this.getImportDetail(createdImport.id, merchantId, correlationId);
    return {
      statusCode: HttpStatus.CREATED,
      data: fullDetail.data,
      meta: fullDetail.meta,
    };
  }

  /**
   * Retrieves import details, control totals, preview rows, and revision history.
   */
  public async getImportDetail(
    importId: string,
    merchantId: string,
    correlationId?: string
  ): Promise<{ data: any; meta: any }> {
    const imp = await this.prisma.import.findFirst({
      where: {
        id: importId,
        merchant_id: merchantId,
      },
    });

    if (!imp) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'IMPORT_NOT_FOUND',
        'Không tìm thấy bản ghi nhập khẩu trong cửa hàng này',
        false
      );
    }

    return this.formatImportDetail(imp, correlationId);
  }

  private async formatImportDetail(
    imp: any,
    correlationId?: string
  ): Promise<{ data: any; meta: any }> {
    const previewRows = await this.prisma.importRow.findMany({
      where: { import_id: imp.id },
      orderBy: { row_number: 'asc' },
      take: 20,
    });

    const allRevisions = await this.prisma.import.findMany({
      where: {
        merchant_id: imp.merchant_id,
        template_type: imp.template_type,
      },
      orderBy: { revision: 'desc' },
      select: {
        id: true,
        merchant_id: true,
        template_type: true,
        file_name: true,
        file_size: true,
        file_hash: true,
        mime_type: true,
        status: true,
        revision: true,
        total_rows: true,
        valid_rows: true,
        error_rows: true,
        warning_rows: true,
        created_at: true,
        updated_at: true,
        promoted_at: true,
        promoted_by_user_id: true,
      },
    });

    return {
      data: {
        import: {
          id: imp.id,
          merchant_id: imp.merchant_id,
          template_type: imp.template_type,
          file_name: imp.file_name,
          file_size: imp.file_size,
          file_hash: imp.file_hash,
          mime_type: imp.mime_type,
          storage_path: imp.storage_path,
          status: imp.status,
          revision: imp.revision,
          idempotency_key: imp.idempotency_key,
          total_rows: imp.total_rows,
          valid_rows: imp.valid_rows,
          error_rows: imp.error_rows,
          warning_rows: imp.warning_rows,
          control_totals: imp.control_totals,
          created_by_user_id: imp.created_by_user_id,
          promoted_by_user_id: imp.promoted_by_user_id,
          promoted_at: imp.promoted_at ? imp.promoted_at.toISOString() : null,
          created_at: imp.created_at.toISOString(),
          updated_at: imp.updated_at.toISOString(),
        },
        preview_rows: previewRows.map((r) => ({
          id: r.id,
          import_id: r.import_id,
          row_number: r.row_number,
          raw_data: r.raw_data,
          normalized_data: r.normalized_data,
          status: r.status,
          scope_identifier: r.scope_identifier,
          issues: r.issues_json || [],
          created_at: r.created_at.toISOString(),
        })),
        revisions: allRevisions.map((rev) => ({
          ...rev,
          created_at: rev.created_at.toISOString(),
          updated_at: rev.updated_at.toISOString(),
          promoted_at: rev.promoted_at ? rev.promoted_at.toISOString() : null,
        })),
      },
      meta: {
        correlation_id: correlationId || '',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Lists imports for tenant with optional template_type and status filtering.
   */
  public async listImports(
    merchantId: string,
    filter: ListImportsDto,
    correlationId?: string
  ): Promise<{ data: any[]; meta: any }> {
    const where: any = { merchant_id: merchantId };
    if (filter.template_type) {
      where.template_type = filter.template_type;
    }
    if (filter.status) {
      where.status = filter.status;
    }

    const limit = Math.min(Math.max(filter.limit || 20, 1), 100);
    const offset = Math.max(filter.offset || 0, 0);

    const [items, total] = await Promise.all([
      this.prisma.import.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { revision: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.import.count({ where }),
    ]);

    return {
      data: items.map((imp) => ({
        id: imp.id,
        merchant_id: imp.merchant_id,
        template_type: imp.template_type,
        file_name: imp.file_name,
        file_size: imp.file_size,
        file_hash: imp.file_hash,
        mime_type: imp.mime_type,
        status: imp.status,
        revision: imp.revision,
        total_rows: imp.total_rows,
        valid_rows: imp.valid_rows,
        error_rows: imp.error_rows,
        warning_rows: imp.warning_rows,
        control_totals: imp.control_totals,
        created_at: imp.created_at.toISOString(),
        updated_at: imp.updated_at.toISOString(),
        promoted_at: imp.promoted_at ? imp.promoted_at.toISOString() : null,
      })),
      meta: {
        correlation_id: correlationId || '',
        total,
      },
    };
  }

  /**
   * Returns paginated rows for an import with optional status filter.
   */
  public async listImportRows(
    importId: string,
    merchantId: string,
    filter: ListImportRowsDto,
    correlationId?: string
  ): Promise<{ data: any[]; meta: any }> {
    const imp = await this.prisma.import.findFirst({
      where: { id: importId, merchant_id: merchantId },
    });
    if (!imp) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'IMPORT_NOT_FOUND',
        'Không tìm thấy bản ghi nhập khẩu trong cửa hàng này',
        false
      );
    }

    const where: any = { import_id: importId };
    if (filter.status) {
      where.status = filter.status;
    }

    const limit = Math.min(Math.max(filter.limit || 50, 1), 200);
    const page = Math.max(filter.page || 1, 1);
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      this.prisma.importRow.findMany({
        where,
        orderBy: { row_number: 'asc' },
        take: limit,
        skip,
      }),
      this.prisma.importRow.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        import_id: r.import_id,
        row_number: r.row_number,
        raw_data: r.raw_data,
        normalized_data: r.normalized_data,
        status: r.status,
        scope_identifier: r.scope_identifier,
        issues: r.issues_json || [],
        issues_json: r.issues_json || [],
        created_at: r.created_at.toISOString(),
      })),
      meta: {
        correlation_id: correlationId || '',
        total,
        page,
        limit,
      },
    };
  }

  /**
   * Generates CSV issue report for all invalid and warning rows.
   */
  public async exportIssuesCsv(
    importId: string,
    merchantId: string,
    correlationId?: string
  ): Promise<string> {
    const imp = await this.prisma.import.findFirst({
      where: { id: importId, merchant_id: merchantId },
    });
    if (!imp) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'IMPORT_NOT_FOUND',
        'Không tìm thấy bản ghi nhập khẩu trong cửa hàng này',
        false
      );
    }

    const issueRows = await this.prisma.importRow.findMany({
      where: {
        import_id: importId,
        status: { in: ['ERROR', 'WARNING'] },
      },
      orderBy: { row_number: 'asc' },
    });

    const exportRows: Record<string, string>[] = [];
    for (const r of issueRows) {
      const issues = (r.issues_json as any[]) || [];
      for (const issue of issues) {
        exportRows.push({
          Dòng: String(r.row_number),
          'Mã định danh': r.scope_identifier || '',
          'Trạng thái': r.status,
          Trường: issue.field || '',
          'Mã lỗi': issue.code || '',
          'Mức độ': issue.severity || '',
          'Mô tả chi tiết': issue.message || '',
        });
      }
    }

    const headers = [
      'Dòng',
      'Mã định danh',
      'Trạng thái',
      'Trường',
      'Mã lỗi',
      'Mức độ',
      'Mô tả chi tiết',
    ];
    return generateCsv(headers, exportRows);
  }

  /**
   * Fetches the actor's live scopes from the database for branches (store_scopes) and warehouses (warehouse_scopes).
   */
  public async getActorScopes(
    actor: ActorContext
  ): Promise<{ store_scopes: string[]; warehouse_scopes: string[] }> {
    if (!actor.userId) {
      return { store_scopes: [], warehouse_scopes: [] };
    }
    const user = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
      select: { role: true, store_scopes: true, warehouse_scopes: true },
    });
    return {
      store_scopes: user?.store_scopes || [],
      warehouse_scopes: user?.warehouse_scopes || [],
    };
  }

  /**
   * Promotes the latest STAGED revision into target domain entities (branches or warehouses).
   * Enforces server-side FEAT-RBAC-02 scope for every affected row (Decision 3).
   * Audited, explicit, all-or-nothing per revision.
   */
  public async promoteImport(
    importId: string,
    merchantId: string,
    actor: ActorContext,
    correlationId?: string,
    clientIp?: string
  ): Promise<{ data: any; meta: any }> {
    const imp = await this.prisma.import.findFirst({
      where: { id: importId, merchant_id: merchantId },
    });

    if (!imp) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'IMPORT_NOT_FOUND',
        'Không tìm thấy bản ghi nhập khẩu trong cửa hàng này',
        false
      );
    }

    // Status validation
    if (imp.status === ImportStatus.BLOCKED) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'IMPORT_BLOCKED',
        'Không thể áp dụng bản ghi nhập khẩu đang bị chặn do có lỗi dữ liệu hoặc thiếu định danh phạm vi',
        false
      );
    }

    if (imp.status === ImportStatus.PROMOTED) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'IMPORT_ALREADY_PROMOTED',
        'Bản ghi nhập khẩu này đã được áp dụng trước đó',
        false
      );
    }

    if (imp.status !== ImportStatus.STAGED) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'IMPORT_NOT_ELIGIBLE',
        `Chỉ có thể áp dụng bản ghi nhập khẩu ở trạng thái STAGED (hiện tại: ${imp.status})`,
        false
      );
    }

    // Verify revision is latest for this template type (Decision 2)
    const latestRevision = await this.prisma.import.findFirst({
      where: {
        merchant_id: merchantId,
        template_type: imp.template_type,
      },
      orderBy: { revision: 'desc' },
      select: { revision: true },
    });

    if (latestRevision && imp.revision < latestRevision.revision) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'REVISION_NOT_LATEST',
        `Chỉ có thể áp dụng phiên bản đã xác thực mới nhất (Phiên bản hiện tại: ${imp.revision}, mới nhất: ${latestRevision.revision})`,
        false
      );
    }

    // Retrieve all rows for this revision
    const allRows = await this.prisma.importRow.findMany({
      where: { import_id: imp.id },
      orderBy: { row_number: 'asc' },
    });

    // Check for any blocking errors that slipped through
    const hasErrorRows = allRows.some((r) => r.status === 'ERROR');
    if (hasErrorRows) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'IMPORT_BLOCKED',
        'Tệp chứa dòng dữ liệu lỗi chưa được xử lý, không thể áp dụng',
        false
      );
    }

    // Scope verification for every affected row (Decision 3 & FEAT-RBAC-02 - Finding 10: no OWNER hardcode)
    const liveScopes = await this.getActorScopes(actor);

    if (imp.template_type === ImportTemplateType.WAREHOUSES) {
      const actorWarehouseScopes = liveScopes.warehouse_scopes;
      const isWildcard = actorWarehouseScopes.includes('*');

      if (!isWildcard) {
        const unauthorizedCodes: string[] = [];
        for (const row of allRows) {
          const code = row.scope_identifier;
          if (!code || !actorWarehouseScopes.includes(code)) {
            unauthorizedCodes.push(code || `Dòng ${row.row_number}`);
          }
        }
        if (unauthorizedCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'WAREHOUSE_SCOPE_UNAUTHORIZED',
            `Bạn không có quyền phân quyền đối với mã kho: ${unauthorizedCodes.join(', ')}`,
            false,
            undefined,
            [
              {
                field: 'scope_identifier',
                code: 'WAREHOUSE_SCOPE_UNAUTHORIZED',
                message: `Mã ngoài phạm vi: ${unauthorizedCodes.join(', ')}`,
              },
            ]
          );
        }
      }
    } else if (imp.template_type === ImportTemplateType.BRANCHES) {
      const actorStoreScopes = liveScopes.store_scopes;
      const isWildcard = actorStoreScopes.includes('*');

      if (!isWildcard) {
        const unauthorizedCodes: string[] = [];
        for (const row of allRows) {
          const code = row.scope_identifier;
          if (!code || !actorStoreScopes.includes(code)) {
            unauthorizedCodes.push(code || `Dòng ${row.row_number}`);
          }
        }
        if (unauthorizedCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'SCOPE_UNAUTHORIZED',
            `Bạn không có quyền phân quyền đối với mã chi nhánh: ${unauthorizedCodes.join(', ')}`,
            false,
            undefined,
            [
              {
                field: 'scope_identifier',
                code: 'SCOPE_UNAUTHORIZED',
                message: `Mã ngoài phạm vi: ${unauthorizedCodes.join(', ')}`,
              },
            ]
          );
        }
      }
    }

    // Atomic promotion transaction (Finding 6, 11, 12, 13)
    const now = new Date();
    let promotedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      // Merchant lock to prevent concurrent promotes or collisions
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
      }

      // BR-BRANCH-03: Single default check across all rows being imported
      const defaultRows = allRows.filter((r) => (r.normalized_data as any)?.is_default === true);
      if (defaultRows.length > 1) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'MULTIPLE_DEFAULT_BRANCHES',
          'Không thể có nhiều hơn một chi nhánh hoặc kho mặc định trong cùng một lần nhập (BR-BRANCH-03)',
          false
        );
      }

      // 1. Promote to target entity tables
      if (imp.template_type === ImportTemplateType.WAREHOUSES) {
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingWarehouse = tx.warehouse?.findUnique
            ? await tx.warehouse.findUnique({
                where: { merchant_id_code: { merchant_id: merchantId, code } },
              })
            : null;

          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;
          const isDefault = hasExplicitDefault
            ? norm.is_default === true
            : existingWarehouse
              ? existingWarehouse.is_default
              : false;

          if (isDefault) {
            // Unset previous default
            await tx.warehouse.updateMany({
              where: { merchant_id: merchantId, is_default: true, code: { not: code } },
              data: { is_default: false },
            });
          }

          let savedWhId = existingWarehouse?.id;
          if (existingWarehouse) {
            // Non-destructive update: preserve existing values for omitted optional fields (Finding 6)
            const updateData: Record<string, any> = {};
            if (norm.name) updateData.name = norm.name;
            if (norm.status) updateData.status = norm.status.toLowerCase();
            if (hasExplicitDefault) updateData.is_default = isDefault;
            if (
              norm.contact_name !== undefined &&
              norm.contact_name !== null &&
              norm.contact_name !== ''
            ) {
              updateData.contact_name = norm.contact_name;
            }
            if (
              norm.contact_phone !== undefined &&
              norm.contact_phone !== null &&
              norm.contact_phone !== ''
            ) {
              updateData.contact_phone = norm.contact_phone;
            }
            if (
              norm.contact_email !== undefined &&
              norm.contact_email !== null &&
              norm.contact_email !== ''
            ) {
              updateData.contact_email = norm.contact_email;
            }
            if (
              norm.address_line !== undefined &&
              norm.address_line !== null &&
              norm.address_line !== ''
            ) {
              updateData.address_line = norm.address_line;
            }
            if (norm.ward !== undefined && norm.ward !== null && norm.ward !== '') {
              updateData.ward = norm.ward;
            }
            if (norm.district !== undefined && norm.district !== null && norm.district !== '') {
              updateData.district = norm.district;
            }
            if (norm.city !== undefined && norm.city !== null && norm.city !== '') {
              updateData.city = norm.city;
            }
            if (
              norm.postal_code !== undefined &&
              norm.postal_code !== null &&
              norm.postal_code !== ''
            ) {
              updateData.postal_code = norm.postal_code;
            }
            if (
              norm.cutoff_time !== undefined &&
              norm.cutoff_time !== null &&
              norm.cutoff_time !== ''
            ) {
              updateData.cutoff_time = norm.cutoff_time;
            }

            const addressJson = {
              line: updateData.address_line || existingWarehouse.address_line || '',
              ward: updateData.ward !== undefined ? updateData.ward : existingWarehouse.ward,
              district: updateData.district || existingWarehouse.district || '',
              city: updateData.city || existingWarehouse.city || '',
              postal_code:
                updateData.postal_code !== undefined
                  ? updateData.postal_code
                  : existingWarehouse.postal_code,
            };
            updateData.address_json = addressJson;

            const updatedWh = await tx.warehouse.update({
              where: { id: existingWarehouse.id },
              data: updateData,
            });
            savedWhId = updatedWh?.id || existingWarehouse.id;

            if (tx.auditLog?.create) {
              await tx.auditLog.create({
                data: {
                  merchant_id: merchantId,
                  user_id: actor.userId,
                  actor: actor.role || 'OWNER',
                  action: 'WAREHOUSE_UPDATED',
                  entity_type: 'warehouse',
                  entity_id: savedWhId,
                  ip_address: clientIp ? this.hashIp(clientIp) : null,
                  new_value: this.maskAuditData({
                    code,
                    name: updateData.name || existingWarehouse.name,
                    is_default:
                      updateData.is_default !== undefined
                        ? updateData.is_default
                        : existingWarehouse.is_default,
                    status: updateData.status || existingWarehouse.status,
                  }),
                },
              });
            }
          } else {
            const name = norm.name || code;
            const status = norm.status ? norm.status.toLowerCase() : 'active';
            const contactName = norm.contact_name || '';
            const contactPhone = norm.contact_phone || '';
            const contactEmail = norm.contact_email || null;
            const addressLine = norm.address_line || '';
            const ward = norm.ward || null;
            const district = norm.district || '';
            const city = norm.city || '';
            const postalCode = norm.postal_code || null;
            const cutoffTime = norm.cutoff_time || null;

            const addressJson = {
              line: addressLine,
              ward,
              district,
              city,
              postal_code: postalCode,
            };

            const createdWh = await (tx.warehouse?.upsert
              ? tx.warehouse.upsert({
                  where: {
                    merchant_id_code: {
                      merchant_id: merchantId,
                      code,
                    },
                  },
                  create: {
                    merchant_id: merchantId,
                    name,
                    code,
                    status,
                    is_default: isDefault,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    contact_email: contactEmail,
                    address_line: addressLine,
                    ward,
                    district,
                    city,
                    postal_code: postalCode,
                    address_json: addressJson,
                    cutoff_time: cutoffTime,
                  },
                  update: {
                    name,
                    status,
                    is_default: isDefault,
                  },
                })
              : tx.warehouse.create({
                  data: {
                    merchant_id: merchantId,
                    name,
                    code,
                    status,
                    is_default: isDefault,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    contact_email: contactEmail,
                    address_line: addressLine,
                    ward,
                    district,
                    city,
                    postal_code: postalCode,
                    address_json: addressJson,
                    cutoff_time: cutoffTime,
                  },
                }));
            savedWhId = createdWh?.id || code;

            if (tx.auditLog?.create) {
              await tx.auditLog.create({
                data: {
                  merchant_id: merchantId,
                  user_id: actor.userId,
                  actor: actor.role || 'OWNER',
                  action: 'WAREHOUSE_CREATED',
                  entity_type: 'warehouse',
                  entity_id: savedWhId,
                  ip_address: clientIp ? this.hashIp(clientIp) : null,
                  new_value: this.maskAuditData({
                    code,
                    name,
                    is_default: isDefault,
                    status,
                  }),
                },
              });
            }
          }
          promotedCount++;
        }
      } else if (imp.template_type === ImportTemplateType.BRANCHES) {
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingBranch = tx.branch?.findUnique
            ? await tx.branch.findUnique({
                where: { merchant_id_code: { merchant_id: merchantId, code } },
              })
            : null;

          const existingCount = tx.branch?.count
            ? await tx.branch.count({ where: { merchant_id: merchantId } })
            : 0;

          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;
          let isDefault: boolean;
          if (existingCount === 0 && !existingBranch) {
            // BR-BRANCH-03: First branch is automatically default
            isDefault = true;
          } else if (hasExplicitDefault) {
            isDefault = norm.is_default === true;
          } else {
            isDefault = existingBranch ? existingBranch.is_default : false;
          }

          if (isDefault) {
            await tx.branch.updateMany({
              where: { merchant_id: merchantId, is_default: true, code: { not: code } },
              data: { is_default: false },
            });
          }

          let savedBrId = existingBranch?.id;
          if (existingBranch) {
            // Non-destructive update: preserve existing values for omitted optional fields (Finding 6)
            const updateData: Record<string, any> = {};
            if (norm.name) updateData.name = norm.name;
            if (norm.status) {
              updateData.status =
                norm.status === 'inactive' || norm.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
            }
            if (hasExplicitDefault) updateData.is_default = isDefault;
            if (
              norm.contact_name !== undefined &&
              norm.contact_name !== null &&
              norm.contact_name !== ''
            ) {
              updateData.contact_name = norm.contact_name;
            }
            if (
              norm.contact_phone !== undefined &&
              norm.contact_phone !== null &&
              norm.contact_phone !== ''
            ) {
              updateData.contact_phone = norm.contact_phone;
              updateData.phone = norm.contact_phone;
            }
            if (
              norm.address_line !== undefined &&
              norm.address_line !== null &&
              norm.address_line !== ''
            ) {
              updateData.address_line = norm.address_line;
              updateData.address = norm.address_line;
            }
            if (norm.ward !== undefined && norm.ward !== null && norm.ward !== '') {
              updateData.ward = norm.ward;
            }
            if (norm.district !== undefined && norm.district !== null && norm.district !== '') {
              updateData.district = norm.district;
            }
            if (norm.city !== undefined && norm.city !== null && norm.city !== '') {
              updateData.city = norm.city;
            }

            const updatedBr = await tx.branch.update({
              where: { id: existingBranch.id },
              data: updateData,
            });
            savedBrId = updatedBr?.id || existingBranch.id;

            if (tx.auditLog?.create) {
              await tx.auditLog.create({
                data: {
                  merchant_id: merchantId,
                  user_id: actor.userId,
                  actor: actor.role || 'OWNER',
                  action: 'BRANCH_UPDATED',
                  entity_type: 'branch',
                  entity_id: savedBrId,
                  ip_address: clientIp ? this.hashIp(clientIp) : null,
                  new_value: this.maskAuditData({
                    code,
                    name: updateData.name || existingBranch.name,
                    is_default:
                      updateData.is_default !== undefined
                        ? updateData.is_default
                        : existingBranch.is_default,
                    status: updateData.status || existingBranch.status,
                  }),
                },
              });
            }
          } else {
            // Create branch with correct uppercase status & legacy address/phone fields (Finding 11)
            const name = norm.name || code;
            const status = norm.status
              ? norm.status === 'inactive' || norm.status === 'INACTIVE'
                ? 'INACTIVE'
                : 'ACTIVE'
              : 'ACTIVE';
            const contactName = norm.contact_name || null;
            const contactPhone = norm.contact_phone || null;
            const addressLine = norm.address_line || null;
            const ward = norm.ward || null;
            const district = norm.district || null;
            const city = norm.city || null;
            const legacyAddress =
              addressLine || [addressLine, ward, district, city].filter(Boolean).join(', ') || null;
            const legacyPhone = contactPhone || null;

            const createdBr = await (tx.branch?.upsert
              ? tx.branch.upsert({
                  where: {
                    merchant_id_code: {
                      merchant_id: merchantId,
                      code,
                    },
                  },
                  create: {
                    merchant_id: merchantId,
                    name,
                    code,
                    status,
                    is_default: isDefault,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    address_line: addressLine,
                    ward,
                    district,
                    city,
                    address: legacyAddress,
                    phone: legacyPhone,
                  },
                  update: {
                    name,
                    status,
                    is_default: isDefault,
                  },
                })
              : tx.branch.create({
                  data: {
                    merchant_id: merchantId,
                    name,
                    code,
                    status,
                    is_default: isDefault,
                    contact_name: contactName,
                    contact_phone: contactPhone,
                    address_line: addressLine,
                    ward,
                    district,
                    city,
                    address: legacyAddress,
                    phone: legacyPhone,
                  },
                }));
            savedBrId = createdBr?.id || code;

            if (tx.auditLog?.create) {
              await tx.auditLog.create({
                data: {
                  merchant_id: merchantId,
                  user_id: actor.userId,
                  actor: actor.role || 'OWNER',
                  action: 'BRANCH_CREATED',
                  entity_type: 'branch',
                  entity_id: savedBrId,
                  ip_address: clientIp ? this.hashIp(clientIp) : null,
                  new_value: this.maskAuditData({
                    code,
                    name,
                    is_default: isDefault,
                    status,
                  }),
                },
              });
            }
          }
          promotedCount++;
        }
      }

      // 2. Mark this revision as PROMOTED
      await tx.import.update({
        where: { id: imp.id },
        data: {
          status: ImportStatus.PROMOTED,
          promoted_at: now,
          promoted_by_user_id: actor.userId || null,
        },
      });

      // 3. Mark prior PROMOTED revisions for this tenant and template_type as SUPERSEDED (Decision 2)
      await tx.import.updateMany({
        where: {
          merchant_id: merchantId,
          template_type: imp.template_type,
          id: { not: imp.id },
          status: ImportStatus.PROMOTED,
        },
        data: {
          status: ImportStatus.SUPERSEDED,
        },
      });

      // 4. Create Audit Log entry with masked values (no plaintext PII)
      const auditPayload = {
        import_id: imp.id,
        template_type: imp.template_type,
        revision: imp.revision,
        file_name: imp.file_name,
        file_hash: imp.file_hash,
        promoted_rows_count: promotedCount,
        promoted_at: now.toISOString(),
      };

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId || null,
          action: ImportAuditEvent.IMPORT_PROMOTED,
          entity_type: 'import',
          entity_id: imp.id,
          ip_address: clientIp ? this.hashIp(clientIp) : null,
          new_value: this.maskAuditData(auditPayload),
        },
      });
    });

    const supersededCount = this.prisma.import?.count
      ? await this.prisma.import.count({
          where: {
            merchant_id: merchantId,
            template_type: imp.template_type,
            status: ImportStatus.SUPERSEDED,
          },
        })
      : 0;

    return {
      data: {
        id: imp.id,
        status: ImportStatus.PROMOTED,
        promoted_rows_count: promotedCount,
        promoted_at: now.toISOString(),
        superseded_revisions_count: supersededCount,
      },
      meta: {
        correlation_id: correlationId || '',
        timestamp: now.toISOString(),
      },
    };
  }
}
