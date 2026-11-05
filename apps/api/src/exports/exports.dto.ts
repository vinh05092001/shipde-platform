import { ExportFormat, ExportResource, ExportJobStatus } from '@shipde/contracts';
import { CanonicalFieldError } from '../auth/auth.service';

export interface CreateExportJobDto {
  resource: ExportResource;
  format: ExportFormat;
  filters?: Record<string, unknown>;
  sync?: boolean;
}

export interface ListExportJobsQueryDto {
  page?: number;
  limit?: number;
  status?: ExportJobStatus;
  resource?: ExportResource;
}

export const ALLOWED_EXPORT_FORMATS = new Set<string>([
  ExportFormat.CSV,
  ExportFormat.XLSX,
  ExportFormat.PDF,
]);

export const ALLOWED_EXPORT_RESOURCES = new Set<string>([
  ExportResource.USERS,
  ExportResource.WAREHOUSES,
  ExportResource.AUDIT_LOGS,
  ExportResource.LEDGERS,
]);

export const ALLOWED_RESOURCE_FILTERS: Record<string, Set<string>> = {
  [ExportResource.USERS]: new Set(['status', 'role', 'clamp']),
  [ExportResource.WAREHOUSES]: new Set(['status', 'city', 'clamp']),
  [ExportResource.AUDIT_LOGS]: new Set(['action', 'entity_type', 'from_date', 'to_date', 'clamp']),
  [ExportResource.LEDGERS]: new Set([
    'from_date',
    'to_date',
    'period_start',
    'period_end',
    'warehouse_id',
    'branch_id',
    'carrier_account_id',
    'carrier_code',
    'clamp',
  ]),
};

export const ALLOWED_EXPORT_STATUSES = new Set<string>([
  ExportJobStatus.PENDING,
  ExportJobStatus.PROCESSING,
  ExportJobStatus.COMPLETED,
  ExportJobStatus.FAILED,
]);

/**
 * Validates the DTO for creating an export job fail-closed with canonical field errors.
 */
export function validateCreateExportJobDto(body: unknown): {
  valid: boolean;
  dto?: CreateExportJobDto;
  errors: CanonicalFieldError[];
} {
  const errors: CanonicalFieldError[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errors: [
        {
          field: 'body',
          code: 'INVALID_BODY',
          message: 'Nội dung yêu cầu phải là một đối tượng JSON hợp lệ',
        },
      ],
    };
  }

  const raw = body as Record<string, unknown>;

  // 1. resource
  if (raw.resource === undefined || raw.resource === null || raw.resource === '') {
    errors.push({
      field: 'resource',
      code: 'REQUIRED',
      message: 'Loại tài nguyên xuất dữ liệu là bắt buộc',
    });
  } else if (typeof raw.resource !== 'string') {
    errors.push({
      field: 'resource',
      code: 'INVALID_TYPE',
      message: 'Loại tài nguyên phải là chuỗi ký tự',
    });
  } else if (!ALLOWED_EXPORT_RESOURCES.has(raw.resource)) {
    errors.push({
      field: 'resource',
      code: 'UNSUPPORTED_RESOURCE',
      message: `Tài nguyên '${raw.resource}' không được hỗ trợ để xuất dữ liệu (chỉ hỗ trợ: ${Array.from(
        ALLOWED_EXPORT_RESOURCES
      ).join(', ')})`,
    });
  }

  // 2. format
  if (raw.format === undefined || raw.format === null || raw.format === '') {
    errors.push({
      field: 'format',
      code: 'REQUIRED',
      message: 'Định dạng xuất dữ liệu là bắt buộc',
    });
  } else if (typeof raw.format !== 'string') {
    errors.push({
      field: 'format',
      code: 'INVALID_TYPE',
      message: 'Định dạng xuất phải là chuỗi ký tự',
    });
  } else if (!ALLOWED_EXPORT_FORMATS.has(raw.format)) {
    errors.push({
      field: 'format',
      code: 'UNSUPPORTED_FORMAT',
      message: `Định dạng '${raw.format}' không được hỗ trợ (chỉ hỗ trợ: csv, xlsx, pdf)`,
    });
  }

  // 3. filters
  let parsedFilters: Record<string, unknown> | undefined = undefined;
  if (raw.filters !== undefined && raw.filters !== null) {
    if (typeof raw.filters !== 'object' || Array.isArray(raw.filters)) {
      errors.push({
        field: 'filters',
        code: 'INVALID_TYPE',
        message: 'Bộ lọc filters phải là một đối tượng key-value hợp lệ',
      });
    } else {
      const filtersObj = raw.filters as Record<string, unknown>;
      const resourceStr = typeof raw.resource === 'string' ? raw.resource : '';
      const allowedKeys = ALLOWED_RESOURCE_FILTERS[resourceStr];

      for (const [key, val] of Object.entries(filtersObj)) {
        if (allowedKeys && !allowedKeys.has(key)) {
          errors.push({
            field: `filters.${key}`,
            code: 'UNSUPPORTED_FILTER',
            message: `Bộ lọc '${key}' không được hỗ trợ cho tài nguyên '${resourceStr}'`,
          });
          continue;
        }

        if (key === 'clamp') {
          if (typeof val !== 'boolean') {
            errors.push({
              field: 'filters.clamp',
              code: 'INVALID_TYPE',
              message: 'Bộ lọc clamp phải là kiểu boolean',
            });
          }
        } else if (
          key === 'from_date' ||
          key === 'to_date' ||
          key === 'period_start' ||
          key === 'period_end'
        ) {
          if (typeof val !== 'string' || isNaN(Date.parse(val))) {
            errors.push({
              field: `filters.${key}`,
              code: 'INVALID_DATE',
              message: `Bộ lọc ${key} phải là chuỗi thời gian hợp lệ (ISO 8601)`,
            });
          }
        } else {
          if (val !== undefined && val !== null && typeof val !== 'string') {
            errors.push({
              field: `filters.${key}`,
              code: 'INVALID_TYPE',
              message: `Bộ lọc ${key} phải là chuỗi ký tự`,
            });
          }
        }
      }

      parsedFilters = filtersObj;
    }
  }

  // 4. sync
  let parsedSync = true; // Default to synchronous execution for responsive user experience
  if (raw.sync !== undefined && raw.sync !== null) {
    if (typeof raw.sync !== 'boolean') {
      errors.push({
        field: 'sync',
        code: 'INVALID_TYPE',
        message: 'Trường sync phải có kiểu boolean',
      });
    } else {
      parsedSync = raw.sync;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    dto: {
      resource: raw.resource as ExportResource,
      format: raw.format as ExportFormat,
      filters: parsedFilters,
      sync: parsedSync,
    },
    errors: [],
  };
}

/**
 * Validates pagination query parameters for listing exports.
 */
export function validateListExportJobsQuery(query: Record<string, unknown>): {
  valid: boolean;
  page: number;
  limit: number;
  status?: ExportJobStatus;
  resource?: ExportResource;
  errors: CanonicalFieldError[];
} {
  const errors: CanonicalFieldError[] = [];

  let page = 1;
  if (query.page !== undefined && query.page !== '') {
    const parsed = Number(query.page);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      errors.push({
        field: 'page',
        code: 'INVALID_PAGE',
        message: 'Trang phải là số nguyên dương lớn hơn hoặc bằng 1',
      });
    } else {
      page = parsed;
    }
  }

  let limit = 20;
  if (query.limit !== undefined && query.limit !== '') {
    const parsed = Number(query.limit);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.push({
        field: 'limit',
        code: 'INVALID_LIMIT',
        message: 'Số lượng mục trên mỗi trang phải từ 1 đến 100',
      });
    } else {
      limit = parsed;
    }
  }

  let status: ExportJobStatus | undefined = undefined;
  if (query.status !== undefined && query.status !== '') {
    const s = String(query.status).trim().toLowerCase();
    if (!ALLOWED_EXPORT_STATUSES.has(s)) {
      errors.push({
        field: 'status',
        code: 'INVALID_STATUS',
        message: `Trạng thái xuất dữ liệu '${query.status}' không hợp lệ`,
      });
    } else {
      status = s as ExportJobStatus;
    }
  }

  let resource: ExportResource | undefined = undefined;
  if (query.resource !== undefined && query.resource !== '') {
    const r = String(query.resource).trim().toLowerCase();
    if (!ALLOWED_EXPORT_RESOURCES.has(r)) {
      errors.push({
        field: 'resource',
        code: 'INVALID_RESOURCE',
        message: `Tài nguyên '${query.resource}' không hợp lệ`,
      });
    } else {
      resource = r as ExportResource;
    }
  }

  if (errors.length > 0) {
    return { valid: false, page: 1, limit: 20, errors };
  }

  return { valid: true, page, limit, status, resource, errors: [] };
}
