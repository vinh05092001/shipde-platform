import type { components } from './openapi';

export type Meta = components['schemas']['Meta'];

export interface UploadImportInput {
  template_type: 'branches' | 'warehouses';
  file_name?: string;
  content?: string;
  file_base64?: string;
}

export interface ImportControlTotals {
  total_rows?: number;
  valid_rows?: number;
  error_rows?: number;
  warning_rows?: number;
  error_code?: string | null;
  error_message?: string | null;
}

export interface ImportColumnMapping {
  source_header?: string | null;
  field: string;
  header?: string | null;
  recognized?: boolean;
  required?: boolean;
  rule?: string;
  description?: string;
}

export interface ImportRowIssue {
  field?: string | null;
  code: string;
  message: string;
  severity: 'BLOCKING' | 'WARNING';
}

export interface ImportSummary {
  id: string;
  merchant_id: string;
  template_type: string;
  file_name: string;
  file_size: number;
  file_hash: string;
  mime_type: string;
  storage_path?: string | null;
  status: 'UPLOADED' | 'VALIDATING' | 'STAGED' | 'BLOCKED' | 'PROMOTED' | 'SUPERSEDED' | 'FAILED';
  revision: number;
  idempotency_key?: string | null;
  total_rows: number;
  valid_rows: number;
  error_rows: number;
  warning_rows: number;
  control_totals?: ImportControlTotals;
  header_mapping?: ImportColumnMapping[] | null;
  created_by_user_id?: string | null;
  promoted_by_user_id?: string | null;
  promoted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRow {
  id: string;
  import_id: string;
  row_number: number;
  raw_data: {
    [key: string]: unknown;
  };
  normalized_data?: {
    [key: string]: unknown;
  } | null;
  status: 'VALID' | 'ERROR' | 'WARNING';
  scope_identifier?: string | null;
  issues?: ImportRowIssue[];
  issues_json?: ImportRowIssue[];
  created_at: string;
}

export interface ImportDetailResponse {
  success: boolean;
  data: {
    import: ImportSummary;
    preview_rows: ImportRow[];
    revisions?: ImportSummary[];
  };
  meta: Meta;
}

export interface ListImportsResponse {
  success: boolean;
  data: ImportSummary[];
  meta: {
    correlation_id: string;
    total: number;
  };
}

export interface ListImportRowsResponse {
  success: boolean;
  data: ImportRow[];
  meta: {
    correlation_id: string;
    total: number;
    page: number;
    limit: number;
  };
}

export interface PromoteImportResponse {
  success: boolean;
  data: {
    id: string;
    status: string;
    promoted_rows_count: number;
    promoted_at: string;
    superseded_revisions_count?: number;
  };
  meta: Meta;
}
