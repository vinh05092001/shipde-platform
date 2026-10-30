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

export interface DetectedContentTypeResult {
  detectedMime: string | null;
  isExecutable: boolean;
  isSuspicious: boolean;
  reason?: string;
}

/**
 * Inspects a ZIP archive to ensure it is a valid Office OpenXML document and does not contain executables/macros.
 */
function scanZipArchiveEntries(buffer: Buffer): {
  isExecutable: boolean;
  isSuspicious: boolean;
  hasOpenXmlParts: boolean;
  reason?: string;
} {
  const FORBIDDEN_EXTENSIONS = [
    '.exe',
    '.dll',
    '.bat',
    '.cmd',
    '.vbs',
    '.sh',
    '.bin',
    '.js',
    '.scr',
    '.pif',
    '.com',
    '.jar',
    '.vbe',
    '.jse',
    '.wsf',
    '.wsh',
    '.ps1',
  ];
  let hasOpenXmlParts = false;

  // Scan local file headers: signature 0x50, 0x4B, 0x03, 0x04
  for (let i = 0; i <= buffer.length - 30; i++) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x03 &&
      buffer[i + 3] === 0x04
    ) {
      const fileNameLen = buffer.readUInt16LE(i + 26);
      if (fileNameLen > 0 && i + 30 + fileNameLen <= buffer.length) {
        const fileName = buffer
          .slice(i + 30, i + 30 + fileNameLen)
          .toString('utf8')
          .toLowerCase();
        if (
          fileName === '[content_types].xml' ||
          fileName.startsWith('xl/') ||
          fileName.startsWith('docprops/')
        ) {
          hasOpenXmlParts = true;
        }
        if (fileName.includes('vbaproject.bin')) {
          return {
            isExecutable: true,
            isSuspicious: true,
            hasOpenXmlParts: true,
            reason: 'Archive contains macro executable (vbaProject.bin).',
          };
        }
        for (const ext of FORBIDDEN_EXTENSIONS) {
          if (fileName.endsWith(ext)) {
            return {
              isExecutable: true,
              isSuspicious: true,
              hasOpenXmlParts: false,
              reason: `Archive contains forbidden executable entry '${fileName}'.`,
            };
          }
        }
      }
    }
  }

  // Scan central directory headers: signature 0x50, 0x4B, 0x01, 0x02
  for (let i = 0; i <= buffer.length - 46; i++) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x01 &&
      buffer[i + 3] === 0x02
    ) {
      const fileNameLen = buffer.readUInt16LE(i + 28);
      if (fileNameLen > 0 && i + 46 + fileNameLen <= buffer.length) {
        const fileName = buffer
          .slice(i + 46, i + 46 + fileNameLen)
          .toString('utf8')
          .toLowerCase();
        if (
          fileName === '[content_types].xml' ||
          fileName.startsWith('xl/') ||
          fileName.startsWith('docprops/')
        ) {
          hasOpenXmlParts = true;
        }
        if (fileName.includes('vbaproject.bin')) {
          return {
            isExecutable: true,
            isSuspicious: true,
            hasOpenXmlParts: true,
            reason: 'Archive contains macro executable (vbaProject.bin).',
          };
        }
        for (const ext of FORBIDDEN_EXTENSIONS) {
          if (fileName.endsWith(ext)) {
            return {
              isExecutable: true,
              isSuspicious: true,
              hasOpenXmlParts: false,
              reason: `Archive contains forbidden executable entry '${fileName}'.`,
            };
          }
        }
      }
    }
  }

  return { isExecutable: false, isSuspicious: false, hasOpenXmlParts };
}

/**
 * Scans buffer for polyglot malware signatures or script injections appended after headers.
 */
function scanPolyglotMalware(buffer: Buffer): { isSuspicious: boolean; reason?: string } {
  const scanLen = Math.min(buffer.length, 65536);
  const contentStr = buffer.slice(0, scanLen).toString('latin1').toLowerCase();

  const DANGEROUS_PATTERNS = [
    { pattern: '<?php', reason: 'Embedded PHP script tag detected.' },
    { pattern: '<script', reason: 'Embedded HTML script tag detected.' },
    { pattern: 'javascript:', reason: 'Embedded JavaScript protocol detected.' },
    { pattern: '<iframe', reason: 'Embedded iframe element detected.' },
    { pattern: '/bin/sh', reason: 'Embedded shell interpreter command detected.' },
    { pattern: '/bin/bash', reason: 'Embedded bash interpreter command detected.' },
    { pattern: 'powershell.exe', reason: 'Embedded PowerShell command detected.' },
  ];

  for (const item of DANGEROUS_PATTERNS) {
    if (contentStr.includes(item.pattern)) {
      return { isSuspicious: true, reason: item.reason };
    }
  }

  // Check for true embedded PE header (MZ with valid PE pointer)
  for (let i = 1; i <= Math.min(buffer.length - 64, 4096); i++) {
    if (buffer[i] === 0x4d && buffer[i + 1] === 0x5a) {
      const peOffset = buffer.readUInt32LE(i + 0x3c);
      if (
        peOffset > 0 &&
        i + peOffset + 4 <= buffer.length &&
        buffer[i + peOffset] === 0x50 &&
        buffer[i + peOffset + 1] === 0x45 &&
        buffer[i + peOffset + 2] === 0x00 &&
        buffer[i + peOffset + 3] === 0x00
      ) {
        return {
          isSuspicious: true,
          reason: 'Embedded DOS/PE executable binary detected inside file.',
        };
      }
    }
  }

  return { isSuspicious: false };
}

export function detectBufferContentType(buffer: Buffer): DetectedContentTypeResult {
  if (!buffer || buffer.length === 0) {
    return { detectedMime: null, isExecutable: false, isSuspicious: false };
  }

  // 1. DOS/PE executable header ("MZ" = 0x4D, 0x5A)
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      detectedMime: 'application/x-msdownload',
      isExecutable: true,
      isSuspicious: true,
      reason: 'DOS/PE executable signature detected.',
    };
  }

  // 2. Linux ELF binary ("\x7fELF" = 0x7F, 0x45, 0x4C, 0x46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      detectedMime: 'application/x-elf',
      isExecutable: true,
      isSuspicious: true,
      reason: 'Linux ELF binary signature detected.',
    };
  }

  // 3. Shell script shebang ("#!" = 0x23, 0x21)
  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
    return {
      detectedMime: 'application/x-sh',
      isExecutable: true,
      isSuspicious: true,
      reason: 'Shell script shebang detected.',
    };
  }

  // 4. Java Class file (0xCA, 0xFE, 0xBA, 0xBE)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0xca &&
    buffer[1] === 0xfe &&
    buffer[2] === 0xba &&
    buffer[3] === 0xbe
  ) {
    return {
      detectedMime: 'application/java-vm',
      isExecutable: true,
      isSuspicious: true,
      reason: 'Java bytecode signature detected.',
    };
  }

  // Deep inspection for polyglot malware inside any file payload
  const polyglotCheck = scanPolyglotMalware(buffer);
  if (polyglotCheck.isSuspicious) {
    return {
      detectedMime: null,
      isExecutable: true,
      isSuspicious: true,
      reason: polyglotCheck.reason || 'Polyglot malicious signature detected.',
    };
  }

  // 5. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { detectedMime: 'image/png', isExecutable: false, isSuspicious: false };
  }

  // 6. JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { detectedMime: 'image/jpeg', isExecutable: false, isSuspicious: false };
  }

  // 7. PDF: %PDF- (0x25, 0x50, 0x44, 0x46, 0x2D)
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    return { detectedMime: 'application/pdf', isExecutable: false, isSuspicious: false };
  }

  // 8. WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return { detectedMime: 'image/webp', isExecutable: false, isSuspicious: false };
  }

  // 9. XLSX / Zip: PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04
  ) {
    // Finding 1: Archive inspection - check entries for forbidden executables and OpenXML parts
    const archiveScan = scanZipArchiveEntries(buffer);
    if (archiveScan.isExecutable || archiveScan.isSuspicious) {
      return {
        detectedMime: 'application/zip',
        isExecutable: true,
        isSuspicious: true,
        reason: archiveScan.reason || 'Archive contains unsafe or forbidden file entries.',
      };
    }
    return {
      detectedMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      isExecutable: false,
      isSuspicious: false,
    };
  }

  // 10. Text / CSV inspection: check if buffer is plain text without binary null bytes
  const previewLen = Math.min(buffer.length, 1024);
  let hasNull = false;
  for (let i = 0; i < previewLen; i++) {
    if (buffer[i] === 0x00) {
      hasNull = true;
      break;
    }
  }

  if (!hasNull) {
    const textPreview = buffer.slice(0, previewLen).toString('utf8').toLowerCase();
    // Check for suspicious script or HTML tags disguised as text/csv
    if (
      textPreview.includes('<script') ||
      textPreview.includes('<?php') ||
      textPreview.includes('<html') ||
      textPreview.includes('<svg')
    ) {
      return {
        detectedMime: 'text/html',
        isExecutable: true,
        isSuspicious: true,
        reason: 'Embedded script or HTML tag detected in text payload.',
      };
    }
    return { detectedMime: 'text/csv', isExecutable: false, isSuspicious: false };
  }

  return { detectedMime: null, isExecutable: false, isSuspicious: false };
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

  // Content inspection & malware verification (Finding 1)
  const detection = detectBufferContentType(buffer);
  if (detection.isExecutable || detection.isSuspicious) {
    return {
      valid: false,
      errorCode: 'INVALID_FILE_TYPE',
      message: 'Nội dung tệp chứa mã độc hoặc tệp thực thi bị cấm.',
      fields: [
        {
          field: 'content_base64',
          code: 'MALWARE_SIGNATURE_DETECTED',
          message: detection.reason || 'Dangerous executable or script signature detected.',
        },
      ],
    };
  }

  const requestedMime = body.mime_type.trim().toLowerCase();
  if (detection.detectedMime && detection.detectedMime !== requestedMime) {
    return {
      valid: false,
      errorCode: 'INVALID_FILE_TYPE',
      message: `Nội dung tệp thực tế (${detection.detectedMime}) không khớp với loại MIME '${body.mime_type}' được khai báo.`,
      fields: [
        {
          field: 'mime_type',
          code: 'MIME_CONTENT_MISMATCH',
          message: `Detected content type '${detection.detectedMime}' does not match claimed '${body.mime_type}'.`,
        },
      ],
    };
  }

  if (requestedMime !== 'text/csv' && !detection.detectedMime) {
    return {
      valid: false,
      errorCode: 'INVALID_FILE_TYPE',
      message: `Nội dung tệp không hợp lệ đối với định dạng '${body.mime_type}'.`,
      fields: [
        {
          field: 'content_base64',
          code: 'CORRUPTED_OR_INVALID_CONTENT',
          message: `File content does not conform to valid '${body.mime_type}' binary format.`,
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
