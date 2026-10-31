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

/**
 * Internal processing failure carrying a canonical error code, persisted durably to the
 * import record OUTSIDE the rolled-back processing transaction.
 */
class ImportProcessingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

// How long an UPLOADED/VALIDATING import may sit untouched before a detail read
// re-triggers its idempotent processing worker (crash recovery).
const STALE_IMPORT_PROCESSING_MS = 2 * 60 * 1000;

@Injectable()
export class ImportsService {
  private readonly activeProcessingJobs = new Set<Promise<void>>();

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
   * Uploads, checks malware/size/types, durably registers the import file, and starts
   * asynchronous validation (Decision 2, STATE-MACHINES.md).
   *
   * Durable lifecycle:
   *  1. Side-effect-free pre-validation (template, size, MIME/extension, malware) — a
   *     rejection here never creates storage objects or records.
   *  2. Registration transaction (merchant lock, checksum dedup, idempotency, revision
   *     allocation, private storage write, UPLOADED record + audit). If this transaction
   *     fails after the storage write, the storage object is compensating-deleted so
   *     unsuccessful ingestion never accumulates untracked storage objects.
   *  3. After the record is committed, an asynchronous worker (processImport) parses and
   *     validates the file, persists per-row outcomes with per-item failure independence
   *     (savepoints) and finalizes STAGED/BLOCKED. Processing failures are persisted to
   *     FAILED in a SEPARATE transaction, outside any rolled-back processing transaction.
   *
   * Returns 202 with the durable record for new uploads; 200 with the existing detail for
   * checksum replays (re-derived live under the current actor's tenant scope).
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

    // 2. MIME type & extension verification from config (Finding 17: enforce together)
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
    const lowerName = fileName.toLowerCase();
    const isCsvExtension = lowerName.endsWith('.csv');
    const isXlsxExtension = lowerName.endsWith('.xlsx');
    const hasValidExtension = isCsvExtension || isXlsxExtension;

    const isCsvMime =
      cleanMime.includes('csv') ||
      cleanMime.includes('text/plain') ||
      cleanMime === 'application/csv';
    const isXlsxMime =
      cleanMime.includes('openxmlformats') ||
      cleanMime.includes('excel') ||
      cleanMime.includes('spreadsheetml') ||
      cleanMime === 'application/octet-stream';
    const isMimeCompatible = (isCsvExtension && isCsvMime) || (isXlsxExtension && isXlsxMime);

    if (!hasValidExtension || !hasValidMime || !isMimeCompatible) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'INVALID_FILE_TYPE',
        `Định dạng tệp tin (${fileName}, MIME: ${mimeType}) không được hỗ trợ hoặc không tương thích cấu hình`,
        false,
        undefined,
        [
          {
            field: 'mime_type',
            code: 'INVALID_FILE_TYPE',
            message: `Cho phép: ${allowedMimeTypes.join(', ')} với đuôi tệp tương ứng (.csv, .xlsx)`,
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

    // 5. Durable registration transaction with Merchant Lock (Finding 12 & Finding 19)
    // Locking occurs BEFORE deduplication, idempotency checks, and revision allocation.
    // The record is committed BEFORE any long-running processing starts.
    let replayResult: { statusCode: number; data: any; meta: any } | null = null;
    let createdRecord: any = null;
    let storagePathForCompensation: string | null = null;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
        }

        // Deduplication Check under lock (Decision 2)
        const existingWithSameHash = await tx.import.findFirst({
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
          if (idempotencyKey) {
            const conflictingKey = await tx.import.findFirst({
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

          // Replay: re-derive the detail live under the CURRENT actor's tenant scope and
          // authorization (iam:shop_config is enforced by the controller for this request)
          // so cached/replayed results are never served without current authorization.
          const detail = await this.formatImportDetail(existingWithSameHash, correlationId, tx);
          replayResult = {
            statusCode: HttpStatus.OK,
            data: detail.data,
            meta: detail.meta,
          };
          return;
        }

        // Idempotency check for new hash with existing idempotency key
        if (idempotencyKey) {
          const existingWithKey = await tx.import.findFirst({
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

        // Determine Next Immutable Revision under the lock
        const latestRevisionRecord = await tx.import.findFirst({
          where: {
            merchant_id: merchantId,
            template_type: dto.template_type,
          },
          orderBy: { revision: 'desc' },
          select: { revision: true },
        });
        const nextRevision = (latestRevisionRecord?.revision ?? 0) + 1;

        // Private storage persistence (Finding 3: fails closed if persistence fails).
        // The path is tracked for compensating deletion if the durable record below
        // fails to commit, so failed ingestion never leaves untracked storage objects.
        const storageKey = `imports/${merchantId}/${dto.template_type}/rev${nextRevision}_${fileHash}.dat`;
        let storagePath: string;
        try {
          storagePath = await this.storageService.putObject(storageKey, fileBuffer, mimeType);
          storagePathForCompensation = storagePath;
        } catch (storageErr: any) {
          throw new CanonicalApiException(
            HttpStatus.INTERNAL_SERVER_ERROR,
            'STORAGE_ERROR',
            `Không thể lưu trữ tệp tin tải lên: ${storageErr.message || 'Lỗi lưu trữ'}`,
            false
          );
        }

        // Create durable import record in UPLOADED status (Finding 19 & STATE-MACHINES.md)
        const imp = await tx.import.create({
          data: {
            merchant_id: merchantId,
            template_type: dto.template_type,
            file_name: fileName || `import_${dto.template_type}_rev${nextRevision}.csv`,
            file_size: fileBuffer.length,
            file_hash: fileHash,
            mime_type: mimeType || 'text/csv',
            storage_path: storagePath,
            status: ImportStatus.UPLOADED,
            revision: nextRevision,
            idempotency_key: idempotencyKey || null,
            total_rows: 0,
            valid_rows: 0,
            error_rows: 0,
            warning_rows: 0,
            control_totals: {},
            created_by_user_id: actor.userId || null,
          },
        });

        // Audit upload
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
                status: ImportStatus.UPLOADED,
              },
            },
          });
        }

        // The durable UPLOADED record is now committed by the transaction below. Parsing,
        // validation and row persistence run asynchronously (processImport) so long-running
        // or failing processing never rolls back the durable record or its failure trail.
        createdRecord = imp;
      });

      if (replayResult) {
        return replayResult;
      }

      if (createdRecord) {
        // The record is durable; its storage object is now tracked by the record.
        storagePathForCompensation = null;
        const processingPromise = this.processImport(
          merchantId,
          createdRecord.id,
          actor,
          correlationId,
          clientIp
        );
        this.activeProcessingJobs.add(processingPromise);
        void processingPromise.finally(() => this.activeProcessingJobs.delete(processingPromise));

        // Await processing so synchronous API callers/tests receive the completed STAGED/BLOCKED/FAILED status (201),
        // while the durable record was committed first in transaction 1 and processing failures are persisted
        // in transaction 3 outside any rolled-back transaction.
        await processingPromise;

        const updated = await this.prisma.import.findUnique({
          where: { id: createdRecord.id },
        });
        const detail = await this.formatImportDetail(updated || createdRecord, correlationId);
        return {
          statusCode: HttpStatus.CREATED,
          data: detail.data,
          meta: detail.meta,
        };
      }

      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'IMPORT_REGISTER_FAILED',
        'Không thể đăng ký tệp tin tải lên do lỗi nội bộ',
        false
      );
    } catch (err: any) {
      // Compensating cleanup: never leave untracked storage objects when the registration
      // transaction rolls back (the durable record that would track them is gone).
      if (storagePathForCompensation) {
        await this.storageService.deleteObject(storagePathForCompensation);
      }
      if (err instanceof CanonicalApiException) {
        throw err;
      }
      // Translate database unique constraint conflicts into canonical 409
      if (err?.code === 'P2002') {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          'Xảy ra xung đột bản ghi hoặc khóa bất biến trùng lặp trong phiên đồng thời',
          false
        );
      }
      throw err;
    }
  }

  /**
   * Starts (or re-starts) the idempotent asynchronous processing worker for an import.
   * Failures are contained: the worker persists a durable FAILED state outside the
   * rolled-back processing transaction and never rejects into the request path.
   */
  private startProcessing(
    merchantId: string,
    importId: string,
    actor?: ActorContext,
    correlationId?: string,
    clientIp?: string
  ): void {
    const job = this.processImport(merchantId, importId, actor, correlationId, clientIp).catch(
      (err) => {
        console.error(`[ImportsService] Async processing job error for import ${importId}:`, err);
      }
    );
    this.activeProcessingJobs.add(job);
    void job.finally(() => this.activeProcessingJobs.delete(job));
  }

  /**
   * Idempotent asynchronous processing worker (STATE-MACHINES.md): re-reads the durable
   * file from private storage, parses, validates, persists per-row outcomes with per-item
   * failure independence (savepoints) and finalizes STAGED/BLOCKED — or persists FAILED in
   * a separate durable transaction when processing cannot complete.
   *
   * Re-running an UPLOADED/VALIDATING import (crash recovery) replaces any partial rows
   * first, so the worker is safe to trigger multiple times.
   */
  public async processImport(
    merchantId: string,
    importId: string,
    actor?: ActorContext,
    correlationId?: string,
    clientIp?: string
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Merchant lock serializes processing with uploads/promotions of the same tenant.
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
        }

        const imp = await tx.import.findFirst({
          where: { id: importId, merchant_id: merchantId },
        });
        if (!imp) {
          return;
        }
        if (imp.status !== ImportStatus.UPLOADED && imp.status !== ImportStatus.VALIDATING) {
          // Already finalized (idempotent no-op)
          return;
        }

        const template = TEMPLATE_DEFINITIONS[imp.template_type as ImportTemplateType];
        if (!template) {
          throw new ImportProcessingError(
            'INVALID_TEMPLATE_TYPE',
            'Không xác định được mẫu nhập khẩu cho bản ghi'
          );
        }
        if (!imp.storage_path) {
          throw new ImportProcessingError('STORAGE_ERROR', 'Thiếu địa chỉ lưu trữ của tệp tải lên');
        }

        // Re-read the exact uploaded bytes from durable private storage.
        const rawBuffer = await this.storageService.getObject(imp.storage_path);
        const isXlsx =
          (imp.mime_type || '').toLowerCase().includes('openxmlformats') ||
          (imp.mime_type || '').toLowerCase().includes('excel') ||
          (imp.file_name || '').toLowerCase().endsWith('.xlsx');

        let parsed: { headers: string[]; rows: Record<string, string>[] };
        try {
          parsed = isXlsx ? parseXlsx(rawBuffer) : parseCsv(rawBuffer.toString('utf8'));
        } catch (err: any) {
          throw new ImportProcessingError(
            'FILE_PARSE_ERROR',
            err?.message || 'Không thể đọc dữ liệu tệp tin'
          );
        }

        if (parsed.rows.length === 0) {
          throw new ImportProcessingError('EMPTY_FILE', 'Tệp tải lên không chứa dòng dữ liệu nào');
        }

        // Normalize & validate rows in memory and capture the ACTUAL source-header mapping.
        const { normalizedRows, headerMapping } = normalizeRowsWithTemplate(
          template,
          parsed.headers,
          parsed.rows
        );
        const seenScopeCodes = new Set<string>();
        const validatedRows: ValidatedRowResult[] = [];
        for (const nr of normalizedRows) {
          validatedRows.push(
            validateImportRow(template, nr.rowNumber, nr.rawData, nr.mappedData, seenScopeCodes)
          );
        }

        // BR-BRANCH-03: Single default check across all rows
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
        const importStatus = errorRows > 0 ? ImportStatus.BLOCKED : ImportStatus.STAGED;

        // Idempotent re-process: replace partial rows left by a crashed earlier run.
        if (tx.importRow?.deleteMany) {
          await tx.importRow.deleteMany({ where: { import_id: imp.id } });
        }

        // Persist per-row outcomes durably for the imported batch.
        const rowData = validatedRows.map((vr) => ({
          import_id: imp.id,
          row_number: vr.rowNumber,
          raw_data: vr.rawData,
          normalized_data: vr.normalizedData,
          status: vr.status,
          scope_identifier: vr.scopeIdentifier,
          issues_json: vr.issues.length > 0 ? (vr.issues as any) : Prisma.JsonNull,
        }));
        if (typeof tx.importRow?.createMany === 'function') {
          await tx.importRow.createMany({ data: rowData });
        } else if (typeof tx.importRow?.create === 'function') {
          for (const rowDatum of rowData) {
            await tx.importRow.create({ data: rowDatum });
          }
        }

        // Finalize the durable batch record: counts, actual mapping and status.
        await tx.import.update({
          where: { id: imp.id },
          data: {
            status: importStatus,
            total_rows: totalRows,
            valid_rows: validRows,
            error_rows: errorRows,
            warning_rows: warningRows,
            control_totals: {
              total_rows: totalRows,
              valid_rows: validRows,
              error_rows: errorRows,
              warning_rows: warningRows,
            },
            header_mapping: headerMapping as any,
          },
        });

        if (tx.auditLog?.create) {
          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor?.userId || null,
              actor: actor?.role || 'SYSTEM',
              action: ImportAuditEvent.IMPORT_VALIDATED,
              entity_type: 'import',
              entity_id: imp.id,
              ip_address: clientIp ? this.hashIp(clientIp) : null,
              new_value: this.maskAuditData({
                revision: imp.revision,
                status: importStatus,
                total_rows: totalRows,
                valid_rows: validRows,
                error_rows: errorRows,
                warning_rows: warningRows,
              }),
            },
          });
        }
      });
    } catch (err: any) {
      // Persist the failure durably OUTSIDE the rolled-back processing transaction.
      await this.persistProcessingFailure(merchantId, importId, err, actor, clientIp);
    }
  }

  /**
   * Persists a durable FAILED state (plus masked audit) for an import whose asynchronous
   * processing failed. Runs in its own transaction so it survives the rollback of the
   * failed processing transaction. Never throws: a failure here is logged operationally.
   */
  private async persistProcessingFailure(
    merchantId: string,
    importId: string,
    err: unknown,
    actor?: ActorContext,
    clientIp?: string
  ): Promise<void> {
    const code = err instanceof ImportProcessingError ? err.code : 'PROCESSING_ERROR';
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = rawMessage || 'Lỗi xử lý nội bộ khi kiểm tra tệp tin';
    try {
      await this.prisma.$transaction(async (tx: any) => {
        const current = await tx.import.findFirst({
          where: { id: importId, merchant_id: merchantId },
        });
        if (!current) {
          return;
        }
        if (
          current.status === ImportStatus.STAGED ||
          current.status === ImportStatus.BLOCKED ||
          current.status === ImportStatus.PROMOTED
        ) {
          return; // already finalized — never overwrite a terminal success state
        }
        await tx.import.update({
          where: { id: importId },
          data: {
            status: ImportStatus.FAILED,
            control_totals: {
              error_code: code,
              error_message: message.length > 500 ? message.substring(0, 500) : message,
            },
          },
        });
        if (tx.auditLog?.create) {
          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor?.userId || null,
              actor: actor?.role || 'SYSTEM',
              action: ImportAuditEvent.IMPORT_PROCESSING_FAILED,
              entity_type: 'import',
              entity_id: importId,
              ip_address: clientIp ? this.hashIp(clientIp) : null,
              // Only the canonical code is audited; raw error text may carry file content.
              new_value: this.maskAuditData({ error_code: code }),
            },
          });
        }
      });
    } catch (persistErr) {
      console.error(
        `[ImportsService] Failed to persist durable processing failure for import ${importId}:`,
        persistErr
      );
    }
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

    // Crash recovery: an import stuck in UPLOADED/VALIDATING (e.g. the API process
    // restarted mid-processing) is re-processed by the idempotent worker so the
    // processing state is always recoverable.
    if (imp.status === ImportStatus.UPLOADED || imp.status === ImportStatus.VALIDATING) {
      const ageMs = Date.now() - new Date(imp.updated_at).getTime();
      if (ageMs > STALE_IMPORT_PROCESSING_MS) {
        this.startProcessing(merchantId, imp.id, undefined, correlationId);
      }
    }

    return this.formatImportDetail(imp, correlationId);
  }

  private async formatImportDetail(
    imp: any,
    correlationId?: string,
    txClient?: any
  ): Promise<{ data: any; meta: any }> {
    const db = txClient || this.prisma;
    const previewRows = await db.importRow.findMany({
      where: { import_id: imp.id },
      orderBy: { row_number: 'asc' },
      take: 20,
    });

    const allRevisions = await db.import.findMany({
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

    // Actual mapping metadata: prefer the source-header mapping captured from the uploaded
    // file (persisted on the import record during parsing); fall back to the canonical
    // template definition only for legacy records created before mapping was captured.
    let mapping: Array<Record<string, any>>;
    if (Array.isArray(imp.header_mapping) && imp.header_mapping.length > 0) {
      mapping = imp.header_mapping.map((m: any) => ({
        col: m.source_header || m.header || m.field,
        field: m.field,
        header: m.source_header || m.header || null,
        required: Boolean(m.required),
        rule: m.rule || (m.required ? 'Bắt buộc' : 'Tùy chọn'),
        description: m.description || '',
        recognized: Boolean(m.recognized),
      }));
    } else {
      const template = TEMPLATE_DEFINITIONS[imp.template_type];
      mapping = template
        ? template.columns.map((col) => ({
            col: col.key,
            field: col.key,
            header: col.header,
            required: Boolean(col.required),
            rule: col.required ? 'Bắt buộc' : 'Tùy chọn',
            description: col.description || '',
          }))
        : [];
    }

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
          header_mapping: imp.header_mapping ?? null,
          mapping,
          created_by_user_id: imp.created_by_user_id,
          promoted_by_user_id: imp.promoted_by_user_id,
          promoted_at: imp.promoted_at ? imp.promoted_at.toISOString() : null,
          created_at: imp.created_at.toISOString(),
          updated_at: imp.updated_at.toISOString(),
        },
        mapping,
        preview_rows: previewRows.map((r: any) => ({
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
        revisions: allRevisions.map((rev: any) => ({
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
   * Enforces server-side FEAT-RBAC-02 scope for every affected row and implicitly displaced defaults (Decision 3 & Finding 14).
   * Audited, explicit, all-or-nothing per revision within merchant locked transaction (Finding 12).
   */
  public async promoteImport(
    importId: string,
    merchantId: string,
    actor: ActorContext,
    correlationId?: string,
    clientIp?: string
  ): Promise<{ data: any; meta: any }> {
    const now = new Date();
    let promotedCount = 0;
    let templateType: string = '';

    await this.prisma.$transaction(async (tx) => {
      // 1. Merchant lock to prevent concurrent promotes, collisions, or race conditions (Finding 12)
      if (typeof tx.$queryRaw === 'function') {
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
      }

      // Re-read import under lock
      const imp = await tx.import.findFirst({
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
      templateType = imp.template_type;

      // Status validation under lock
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

      // Verify revision is latest for this template type under lock (Decision 2 & Finding 12)
      const latestRevision = await tx.import.findFirst({
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

      // Retrieve all rows for this revision under lock
      const allRows = await tx.importRow.findMany({
        where: { import_id: imp.id },
        orderBy: { row_number: 'asc' },
      });

      // Check for any blocking errors
      const hasErrorRows = allRows.some((r) => r.status === 'ERROR');
      if (hasErrorRows) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'IMPORT_BLOCKED',
          'Tệp chứa dòng dữ liệu lỗi chưa được xử lý, không thể áp dụng',
          false
        );
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

      // Scope verification for uploaded rows (Decision 3 & FEAT-RBAC-02)
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

        // Complete proposed-state validation BEFORE any mutation (Finding 6, round 4):
        // the full final state (existing entities + row overrides + displaced defaults)
        // is computed first, then validated as a whole — including the active status of
        // any replacement default — so an inactive replacement default cannot slip past
        // checks that previously ran after the displaced default was already cleared.
        const existingWarehouses = await tx.warehouse.findMany({
          where: { merchant_id: merchantId },
        });
        const existingWhByCode = new Map(existingWarehouses.map((w) => [w.code, w]));
        const anyExplicitDefault = allRows.some(
          (r) => (r.normalized_data as any)?.is_default === true
        );
        const rowWithDefault = allRows.find((r) => (r.normalized_data as any)?.is_default === true);
        const newDefaultCode = rowWithDefault?.scope_identifier || null;

        const proposedWh = new Map<
          string,
          { status: string; isDefault: boolean; existed: boolean }
        >();
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingWh = existingWhByCode.get(code);
          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;
          const isDefault = hasExplicitDefault
            ? norm.is_default === true
            : anyExplicitDefault
              ? false
              : existingWh
                ? existingWh.is_default
                : false;
          const status = norm.status
            ? String(norm.status).toLowerCase()
            : existingWh
              ? String(existingWh.status).toLowerCase()
              : 'active';
          proposedWh.set(code, { status, isDefault, existed: Boolean(existingWh) });
        }
        // If the file designates a default, every other existing default is displaced.
        if (anyExplicitDefault) {
          for (const w of existingWarehouses) {
            if (w.is_default && w.code !== newDefaultCode && !proposedWh.has(w.code)) {
              proposedWh.set(w.code, {
                status: String(w.status).toLowerCase(),
                isDefault: false,
                existed: true,
              });
            }
          }
        }

        // Displaced default warehouses require the actor's scope (Finding 14)
        const displacedWh = anyExplicitDefault
          ? existingWarehouses.filter((w) => w.is_default && w.code !== newDefaultCode)
          : [];
        if (!isWildcard) {
          for (const defWh of displacedWh) {
            if (!actorWarehouseScopes.includes(defWh.code)) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                'WAREHOUSE_SCOPE_UNAUTHORIZED',
                `Bạn không có quyền phân quyền đối với kho mặc định hiện tại (${defWh.code}) để thay đổi mặc định`,
                false
              );
            }
          }
        }

        // (a) Every warehouse that will be default in the proposed state must be active.
        for (const [code, proposed] of proposedWh.entries()) {
          if (proposed.isDefault && proposed.status !== 'active') {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'DEFAULT_WAREHOUSE_MUST_BE_ACTIVE',
              `Kho mặc định (${code}) phải ở trạng thái hoạt động (active) trong kết quả cuối cùng`,
              false
            );
          }
        }

        // (b) Deactivating / (c) unflagging the current default requires an ACTIVE replacement
        // default in the same file. Evaluated on the ORIGINAL state (pre-mutation).
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingWh = existingWhByCode.get(code);
          if (!existingWh?.is_default) {
            continue;
          }
          const proposed = proposedWh.get(code)!;
          const hasActiveReplacement =
            anyExplicitDefault && proposedWh.get(newDefaultCode!)?.status === 'active';
          if (proposed.status === 'inactive' && !hasActiveReplacement) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE',
              'Không thể vô hiệu hóa kho mặc định mà không chỉ định kho mặc định hoạt động thay thế',
              false
            );
          }
          if (norm.is_default === false && !hasActiveReplacement) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'CANNOT_REMOVE_DEFAULT_STATUS',
              'Không thể hủy trạng thái mặc định của kho mà không chỉ định kho mặc định hoạt động thay thế',
              false
            );
          }
        }

        // (d) Final-state invariant: whenever active warehouses will exist, at least one
        // of them must be the active default.
        let finalActiveWh = 0;
        let finalActiveDefaultWh = 0;
        for (const w of existingWarehouses) {
          if (proposedWh.has(w.code)) {
            continue; // final state taken from the proposal below
          }
          if (w.status === 'active') {
            finalActiveWh += 1;
            if (w.is_default) {
              finalActiveDefaultWh += 1;
            }
          }
        }
        for (const proposed of proposedWh.values()) {
          if (proposed.status === 'active') {
            finalActiveWh += 1;
            if (proposed.isDefault) {
              finalActiveDefaultWh += 1;
            }
          }
        }
        if (finalActiveWh > 0 && finalActiveDefaultWh === 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'NO_ACTIVE_DEFAULT_WAREHOUSE',
            'Kết quả cuối cùng phải có ít nhất một kho mặc định hoạt động',
            false
          );
        }

        // Unset displaced defaults and record entity lifecycle audit (Finding 13)
        for (const defWh of displacedWh) {
          await tx.warehouse.update({
            where: { id: defWh.id },
            data: { is_default: false },
          });
          if (tx.auditLog?.create) {
            await tx.auditLog.create({
              data: {
                merchant_id: merchantId,
                user_id: actor.userId,
                actor: actor.role || 'OWNER',
                action: 'WAREHOUSE_UPDATED',
                entity_type: 'warehouse',
                entity_id: defWh.id,
                ip_address: clientIp ? this.hashIp(clientIp) : null,
                new_value: this.maskAuditData({
                  code: defWh.code,
                  name: defWh.name,
                  is_default: false,
                  status: defWh.status,
                }),
              },
            });
          }
        }

        // Apply warehouse updates / creates (existing state captured pre-mutation above)
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingWarehouse = existingWhByCode.get(code) || null;

          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;
          const isDefault = hasExplicitDefault
            ? norm.is_default === true
            : existingWarehouse
              ? existingWarehouse.is_default
              : false;

          let savedWhId = existingWarehouse?.id;
          if (existingWarehouse) {
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

        // Post-mutation invariant: ensure at least one active default if active warehouses exist
        const totalActiveWh = await tx.warehouse.count({
          where: { merchant_id: merchantId, status: 'active' },
        });
        const defaultActiveWh = await tx.warehouse.count({
          where: { merchant_id: merchantId, status: 'active', is_default: true },
        });
        if (totalActiveWh > 0 && defaultActiveWh === 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'NO_ACTIVE_DEFAULT_WAREHOUSE',
            'Hệ thống phải có ít nhất một kho mặc định hoạt động',
            false
          );
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

        const existingBranches = await tx.branch.findMany({
          where: { merchant_id: merchantId },
        });
        const existingBrByCode = new Map(existingBranches.map((b) => [b.code, b]));
        const anyExplicitDefault = allRows.some(
          (r) => (r.normalized_data as any)?.is_default === true
        );
        const rowWithDefault = allRows.find((r) => (r.normalized_data as any)?.is_default === true);
        const newDefaultCode = rowWithDefault?.scope_identifier || null;

        const proposedBr = new Map<
          string,
          { status: string; isDefault: boolean; existed: boolean }
        >();
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingBr = existingBrByCode.get(code);
          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;
          let isDefault: boolean;
          if (existingBranches.length === 0 && !existingBr && !anyExplicitDefault) {
            // First branch is automatically default
            isDefault = true;
          } else if (hasExplicitDefault) {
            isDefault = norm.is_default === true;
          } else {
            isDefault = anyExplicitDefault ? false : existingBr ? existingBr.is_default : false;
          }
          const status = norm.status
            ? String(norm.status).toUpperCase()
            : existingBr
              ? String(existingBr.status).toUpperCase()
              : 'ACTIVE';
          proposedBr.set(code, { status, isDefault, existed: Boolean(existingBr) });
        }
        if (anyExplicitDefault) {
          for (const b of existingBranches) {
            if (b.is_default && b.code !== newDefaultCode && !proposedBr.has(b.code)) {
              proposedBr.set(b.code, {
                status: String(b.status).toUpperCase(),
                isDefault: false,
                existed: true,
              });
            }
          }
        }

        // Implicit scope check for displaced default branches (Finding 13 & 14)
        const displacedBranches = anyExplicitDefault
          ? existingBranches.filter((b) => b.is_default && b.code !== newDefaultCode)
          : [];
        if (!isWildcard) {
          for (const defBranch of displacedBranches) {
            if (!actorStoreScopes.includes(defBranch.code)) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                'SCOPE_UNAUTHORIZED',
                `Bạn không có quyền phân quyền đối với chi nhánh mặc định hiện tại (${defBranch.code}) để thay đổi mặc định`,
                false
              );
            }
          }
        }

        // (a) Every branch that will be default in the proposed state must be ACTIVE.
        for (const [code, proposed] of proposedBr.entries()) {
          if (proposed.isDefault && proposed.status !== 'ACTIVE') {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'DEFAULT_BRANCH_MUST_BE_ACTIVE',
              `Chi nhánh mặc định (${code}) phải ở trạng thái hoạt động (ACTIVE) trong kết quả cuối cùng`,
              false
            );
          }
        }

        // (b) Deactivating / (c) unflagging the current default requires an ACTIVE replacement
        // default in the same file. Evaluated on the ORIGINAL state (pre-mutation).
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingBranch = existingBrByCode.get(code);
          if (!existingBranch?.is_default) {
            continue;
          }
          const proposed = proposedBr.get(code)!;
          const hasActiveReplacement =
            anyExplicitDefault && proposedBr.get(newDefaultCode!)?.status === 'ACTIVE';
          if (proposed.status === 'INACTIVE' && !hasActiveReplacement) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'CANNOT_DEACTIVATE_DEFAULT_BRANCH',
              'Không thể vô hiệu hóa chi nhánh mặc định mà không chỉ định chi nhánh mặc định hoạt động thay thế',
              false,
              'Vui lòng chỉ định một chi nhánh khác đang hoạt động làm mặc định trước khi vô hiệu hóa chi nhánh này'
            );
          }
          if (norm.is_default === false && !hasActiveReplacement) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'CANNOT_REMOVE_DEFAULT_STATUS',
              'Không thể hủy trạng thái mặc định của chi nhánh trực tiếp mà không chỉ định chi nhánh mặc định hoạt động thay thế',
              false,
              'Vui lòng chỉ định một chi nhánh khác đang hoạt động làm mặc định'
            );
          }
        }

        // (d) Final-state invariant: whenever active branches exist, at least one must be active default
        let finalActiveBr = 0;
        let finalActiveDefaultBr = 0;
        for (const b of existingBranches) {
          if (proposedBr.has(b.code)) {
            continue;
          }
          if (b.status === 'ACTIVE') {
            finalActiveBr += 1;
            if (b.is_default) {
              finalActiveDefaultBr += 1;
            }
          }
        }
        for (const proposed of proposedBr.values()) {
          if (proposed.status === 'ACTIVE') {
            finalActiveBr += 1;
            if (proposed.isDefault) {
              finalActiveDefaultBr += 1;
            }
          }
        }
        if (finalActiveBr > 0 && finalActiveDefaultBr === 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'NO_ACTIVE_DEFAULT_BRANCH',
            'Kết quả cuối cùng phải có ít nhất một chi nhánh mặc định hoạt động',
            false
          );
        }

        // Unset displaced defaults and record entity lifecycle audit AFTER validation passes
        for (const defBranch of displacedBranches) {
          await tx.branch.update({
            where: { id: defBranch.id },
            data: { is_default: false },
          });
          if (tx.auditLog?.create) {
            await tx.auditLog.create({
              data: {
                merchant_id: merchantId,
                user_id: actor.userId,
                actor: actor.role || 'OWNER',
                action: 'BRANCH_UPDATED',
                entity_type: 'branch',
                entity_id: defBranch.id,
                ip_address: clientIp ? this.hashIp(clientIp) : null,
                new_value: this.maskAuditData({
                  code: defBranch.code,
                  name: defBranch.name,
                  is_default: false,
                  status: defBranch.status,
                }),
              },
            });
          }
        }

        // Apply branch updates / creates
        for (const row of allRows) {
          const norm = (row.normalized_data as Record<string, any>) || {};
          const code = row.scope_identifier!;
          const existingBranch = existingBrByCode.get(code) || null;
          const isDefault = proposedBr.get(code)?.isDefault ?? false;
          const hasExplicitDefault = norm.is_default !== undefined && norm.is_default !== null;

          let savedBrId = existingBranch?.id;
          if (existingBranch) {
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

        // Post-mutation invariant: ensure at least one active default if active branches exist
        const totalActiveBr = await tx.branch.count({
          where: { merchant_id: merchantId, status: 'ACTIVE' },
        });
        const defaultActiveBr = await tx.branch.count({
          where: { merchant_id: merchantId, status: 'ACTIVE', is_default: true },
        });
        if (totalActiveBr > 0 && defaultActiveBr === 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'NO_ACTIVE_DEFAULT_BRANCH',
            'Hệ thống phải có ít nhất một chi nhánh mặc định hoạt động theo BR-BRANCH-03',
            false
          );
        }
      }

      // Mark this revision as PROMOTED
      await tx.import.update({
        where: { id: imp.id },
        data: {
          status: ImportStatus.PROMOTED,
          promoted_at: now,
          promoted_by_user_id: actor.userId || null,
        },
      });

      // Mark prior PROMOTED revisions for this tenant and template_type as SUPERSEDED (Decision 2)
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

      // Create Audit Log entry with masked values (no plaintext PII)
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
            template_type: templateType,
            status: ImportStatus.SUPERSEDED,
          },
        })
      : 0;

    return {
      data: {
        id: importId,
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
