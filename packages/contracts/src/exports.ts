/**
 * @shipde/contracts - Exports (FEAT-COM-05)
 * Shared TypeScript data contracts for permission-aware CSV/XLSX/PDF exports with generation metadata.
 */

export const ExportFormat = {
  CSV: 'csv',
  XLSX: 'xlsx',
  PDF: 'pdf',
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const ExportResource = {
  USERS: 'users',
  WAREHOUSES: 'warehouses',
  AUDIT_LOGS: 'audit_logs',
  LEDGERS: 'ledgers',
} as const;

export type ExportResource = (typeof ExportResource)[keyof typeof ExportResource];

export const ExportJobStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type ExportJobStatus = (typeof ExportJobStatus)[keyof typeof ExportJobStatus];

export const ExportErrorCode = {
  EXPORT_NOT_FOUND: 'EXPORT_NOT_FOUND',
  EXPORT_NOT_READY: 'EXPORT_NOT_READY',
  EXPORT_FAILED: 'EXPORT_FAILED',
  UNSUPPORTED_RESOURCE: 'UNSUPPORTED_RESOURCE',
  UNSUPPORTED_FORMAT: 'UNSUPPORTED_FORMAT',
  EXPORT_LIMIT_EXCEEDED: 'EXPORT_LIMIT_EXCEEDED',
  SCOPE_FORBIDDEN: 'SCOPE_FORBIDDEN',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
} as const;

export type ExportErrorCode = (typeof ExportErrorCode)[keyof typeof ExportErrorCode];

export const ExportAuditEvent = {
  EXPORT_REQUESTED: 'EXPORT_REQUESTED',
  EXPORT_COMPLETED: 'EXPORT_COMPLETED',
  EXPORT_FAILED: 'EXPORT_FAILED',
  EXPORT_DOWNLOADED: 'EXPORT_DOWNLOADED',
} as const;

export type ExportAuditEvent = (typeof ExportAuditEvent)[keyof typeof ExportAuditEvent];

export interface ExportGenerationMetadata {
  export_id: string;
  generated_at: string;
  merchant_id: string;
  requested_by: string;
  user_role: string;
  resource: ExportResource;
  format: ExportFormat;
  filters: Record<string, unknown>;
  rule_version: string;
  total_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  checksum_sha256: string;
}

export interface ExportRowResult {
  row_index: number;
  entity_id?: string;
  status: 'succeeded' | 'failed' | 'skipped';
  error_code?: string;
  error_message?: string;
}

export interface ExportJobItem {
  id: string;
  merchant_id: string;
  user_id: string;
  resource: ExportResource;
  format: ExportFormat;
  status: ExportJobStatus;
  filters?: Record<string, unknown>;
  total_rows: number;
  processed_rows: number;
  succeeded_rows: number;
  failed_rows: number;
  file_name?: string;
  file_size_bytes?: number;
  checksum_sha256?: string;
  download_url?: string;
  error_code?: string;
  error_message?: string;
  metadata?: ExportGenerationMetadata;
  row_results?: ExportRowResult[];
  rule_version?: string;
  created_at: string;
  completed_at?: string;
}

export interface CreateExportJobRequest {
  resource: ExportResource;
  format: ExportFormat;
  filters?: Record<string, unknown>;
  sync?: boolean;
}

export interface CreateExportJobResponse {
  data: ExportJobItem;
  meta: {
    correlation_id: string;
    timestamp: string;
  };
}

export interface ExportJobResponse {
  data: ExportJobItem;
  meta: {
    correlation_id: string;
    timestamp: string;
  };
}

export interface ListExportJobsResponse {
  data: ExportJobItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    correlation_id: string;
    timestamp: string;
  };
}
