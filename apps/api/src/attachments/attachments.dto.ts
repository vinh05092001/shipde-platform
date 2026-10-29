import { ATTACHMENT_ALLOWED_MIME_TYPES, ATTACHMENT_DISALLOWED_EXTENSIONS } from '@shipde/config';
import { maskIdentifier } from '../invitations/invitations.service';

export const ALLOWED_ENTITY_TYPES = new Set([
  'RETURN',
  'CLAIM',
  'DISCREPANCY',
  'STATEMENT',
  'ORDER',
  'SHIPMENT',
  'GENERAL',
]);

export interface UploadAttachmentDto {
  file_name: string;
  mime_type: string;
  content_base64: string;
  checksum_sha256?: string;
  entity_type?: string;
  entity_id?: string;
  branch_id?: string;
  warehouse_id?: string;
  retention_days?: number;
  metadata?: Record<string, unknown>;
}

export interface ListAttachmentsQueryDto {
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  entity_type?: string;
  entity_id?: string;
  warehouse_id?: string;
  branch_id?: string;
  status?: string;
}

export interface DeleteAttachmentDto {
  confirm?: boolean;
}

export interface RetentionPurgeDto {
  dry_run?: boolean;
  entity_type?: string;
}

export interface BulkDeleteAttachmentsDto {
  ids: string[];
  confirm?: boolean;
}

export interface CanonicalFieldError {
  field: string;
  code: string;
  message: string;
}

export interface DtoValidationResult {
  valid: boolean;
  errorCode?: string;
  message?: string;
  fields?: CanonicalFieldError[];
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REGEX = /^[0-9a-f]{64}$/i;

export function isValidUuid(val: unknown): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export function sanitizeFileName(name: string): string {
  if (!name || typeof name !== 'string') return 'attachment';
  // Strip path traversal characters and non-printable chars
  const base = name.replace(/^.*[\\/]/, '').replace(/[^\w\.\-\s]/gi, '_');
  return base.trim().substring(0, 255) || 'attachment';
}

export function getFileExtension(name: string): string {
  const sanitized = sanitizeFileName(name);
  const dotIndex = sanitized.lastIndexOf('.');
  return dotIndex !== -1 ? sanitized.substring(dotIndex).toLowerCase() : '';
}

export function validateUploadAttachmentDto(
  body: any,
  maxSizeBytes: number
): {
  valid: boolean;
  buffer?: Buffer;
  errorCode?: string;
  message?: string;
  fields?: CanonicalFieldError[];
} {
  const fields: CanonicalFieldError[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Yêu cầu không hợp lệ: body phải là đối tượng JSON.',
      fields: [{ field: 'body', code: 'INVALID_TYPE', message: 'Body must be an object' }],
    };
  }

  // 1. file_name
  if (typeof body.file_name !== 'string' || body.file_name.trim().length === 0) {
    fields.push({ field: 'file_name', code: 'REQUIRED', message: 'Tên tệp không được để trống.' });
  } else if (body.file_name.length > 255) {
    fields.push({
      field: 'file_name',
      code: 'MAX_LENGTH',
      message: 'Tên tệp không được vượt quá 255 ký tự.',
    });
  } else {
    const ext = getFileExtension(body.file_name);
    if (ATTACHMENT_DISALLOWED_EXTENSIONS.has(ext)) {
      return {
        valid: false,
        errorCode: 'INVALID_FILE_TYPE',
        message: `Định dạng tệp ${ext} bị cấm vì lý do an toàn bảo mật.`,
        fields: [
          {
            field: 'file_name',
            code: 'DISALLOWED_EXTENSION',
            message: `Extension ${ext} is disallowed.`,
          },
        ],
      };
    }
  }

  // 2. mime_type
  if (typeof body.mime_type !== 'string' || body.mime_type.trim().length === 0) {
    fields.push({
      field: 'mime_type',
      code: 'REQUIRED',
      message: 'MIME type không được để trống.',
    });
  } else {
    const mime = body.mime_type.trim().toLowerCase();
    const isAllowed = (ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
    if (!isAllowed) {
      return {
        valid: false,
        errorCode: 'INVALID_FILE_TYPE',
        message: `Loại tệp MIME '${body.mime_type}' không được hỗ trợ. Chỉ chấp nhận ảnh (JPEG, PNG, WebP), PDF, CSV, Excel.`,
        fields: [
          {
            field: 'mime_type',
            code: 'INVALID_MIME_TYPE',
            message: `MIME type '${body.mime_type}' is not allowed.`,
          },
        ],
      };
    }
  }

  // 3. content_base64
  if (typeof body.content_base64 !== 'string' || body.content_base64.trim().length === 0) {
    return {
      valid: false,
      errorCode: 'EMPTY_FILE',
      message: 'Nội dung tệp rỗng hoặc không được truyền đúng định dạng base64.',
      fields: [
        {
          field: 'content_base64',
          code: 'EMPTY_CONTENT',
          message: 'File content cannot be empty.',
        },
      ],
    };
  }

  let buffer: Buffer;
  try {
    const cleanBase64 = body.content_base64.replace(/^data:[^;]+;base64,/, '');
    buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length === 0) {
      return {
        valid: false,
        errorCode: 'EMPTY_FILE',
        message: 'Nội dung tệp rỗng (0 bytes).',
        fields: [
          { field: 'content_base64', code: 'EMPTY_BUFFER', message: 'Decoded buffer has 0 bytes.' },
        ],
      };
    }
  } catch {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Không thể giải mã nội dung base64 của tệp.',
      fields: [
        { field: 'content_base64', code: 'INVALID_BASE64', message: 'Invalid base64 encoding.' },
      ],
    };
  }

  if (buffer.length > maxSizeBytes) {
    return {
      valid: false,
      errorCode: 'FILE_TOO_LARGE',
      message: `Dung lượng tệp (${buffer.length} bytes) vượt quá giới hạn cho phép (${maxSizeBytes} bytes).`,
      fields: [
        {
          field: 'content_base64',
          code: 'MAX_SIZE_EXCEEDED',
          message: `File size exceeds ${maxSizeBytes} bytes limit.`,
        },
      ],
    };
  }

  // 4. checksum_sha256 (optional)
  if (body.checksum_sha256 !== undefined && body.checksum_sha256 !== null) {
    if (
      typeof body.checksum_sha256 !== 'string' ||
      !SHA256_REGEX.test(body.checksum_sha256.trim())
    ) {
      fields.push({
        field: 'checksum_sha256',
        code: 'INVALID_HASH_FORMAT',
        message: 'Mã kiểm tra checksum_sha256 phải là chuỗi 64 ký tự hex.',
      });
    }
  }

  // 5. entity_type (optional)
  if (body.entity_type !== undefined && body.entity_type !== null) {
    if (
      typeof body.entity_type !== 'string' ||
      !ALLOWED_ENTITY_TYPES.has(body.entity_type.trim().toUpperCase())
    ) {
      fields.push({
        field: 'entity_type',
        code: 'INVALID_ENTITY_TYPE',
        message: `Loại thực thể '${body.entity_type}' không hợp lệ. Cho phép: ${Array.from(ALLOWED_ENTITY_TYPES).join(', ')}.`,
      });
    }
  }

  // 6. retention_days (optional)
  if (body.retention_days !== undefined && body.retention_days !== null) {
    const rDays = Number(body.retention_days);
    if (!Number.isSafeInteger(rDays) || rDays < 1 || rDays > 3650) {
      fields.push({
        field: 'retention_days',
        code: 'INVALID_RETENTION_RANGE',
        message: 'Thời gian lưu trữ (retention_days) phải là số nguyên từ 1 đến 3650 ngày.',
      });
    }
  }

  if (fields.length > 0) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Dữ liệu tải tệp không hợp lệ.',
      fields,
    };
  }

  return { valid: true, buffer };
}

export function validateDeleteAttachmentDto(body: any): DtoValidationResult {
  if (!body || typeof body !== 'object' || body.confirm !== true) {
    return {
      valid: false,
      errorCode: 'CONFIRMATION_REQUIRED',
      message: 'Hành động xóa tệp đính kèm yêu cầu xác nhận rõ ràng (confirm: true).',
      fields: [
        {
          field: 'confirm',
          code: 'REQUIRED_CONFIRMATION',
          message: 'Field confirm must be explicitly true.',
        },
      ],
    };
  }
  return { valid: true };
}

export function validateBulkDeleteDto(body: any): DtoValidationResult {
  const fields: CanonicalFieldError[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Body phải là đối tượng JSON.',
      fields: [{ field: 'body', code: 'INVALID_TYPE', message: 'Body must be an object' }],
    };
  }

  if (body.confirm !== true) {
    return {
      valid: false,
      errorCode: 'CONFIRMATION_REQUIRED',
      message: 'Hành động xóa hàng loạt yêu cầu xác nhận rõ ràng (confirm: true).',
      fields: [
        {
          field: 'confirm',
          code: 'REQUIRED_CONFIRMATION',
          message: 'Field confirm must be explicitly true.',
        },
      ],
    };
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Danh sách mã tệp cần xóa (ids) không được để trống.',
      fields: [
        {
          field: 'ids',
          code: 'EMPTY_LIST',
          message: 'Array of ids is required and cannot be empty.',
        },
      ],
    };
  }

  if (body.ids.length > 100) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Số lượng tệp cần xóa vượt quá giới hạn 100 tệp trong một lần xử lý.',
      fields: [
        {
          field: 'ids',
          code: 'MAX_LIMIT_EXCEEDED',
          message: 'Cannot exceed 100 ids per bulk operation.',
        },
      ],
    };
  }

  for (let i = 0; i < body.ids.length; i++) {
    const id = body.ids[i];
    if (!isValidUuid(id)) {
      fields.push({
        field: `ids[${i}]`,
        code: 'INVALID_UUID',
        message: `Mã tệp '${id}' không phải định dạng UUID hợp lệ.`,
      });
    }
  }

  if (fields.length > 0) {
    return {
      valid: false,
      errorCode: 'VALIDATION_ERROR',
      message: 'Danh sách mã tệp chứa giá trị không hợp lệ.',
      fields,
    };
  }

  return { valid: true };
}

export const SENSITIVE_ATTACHMENT_AUDIT_FIELDS = new Set([
  'phone',
  'email',
  'contact_phone',
  'contact_email',
  'recipient_phone',
  'customer_phone',
]);

export function maskAttachmentAuditValue(field: string, val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' && SENSITIVE_ATTACHMENT_AUDIT_FIELDS.has(field)) {
    return maskIdentifier(val);
  }
  if (Array.isArray(val)) {
    return val.map((item) =>
      typeof item === 'object' && item !== null
        ? maskAttachmentAuditObject(item as Record<string, unknown>)
        : item
    );
  }
  if (typeof val === 'object') {
    return maskAttachmentAuditObject(val as Record<string, unknown>);
  }
  return val;
}

export function maskAttachmentAuditObject(obj: Record<string, unknown>): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return obj;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = maskAttachmentAuditValue(k, v);
  }
  return result;
}
