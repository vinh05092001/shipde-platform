import { HttpStatus } from '@nestjs/common';
import { CanonicalApiException } from '../auth/auth.service';
import {
  ImportTemplateType,
  ImportRowIssue,
  isValidWarehouseCode,
  isValidWarehousePhone,
  isValidCutoffTime,
} from '@shipde/contracts';
import { TEMPLATE_DEFINITIONS, TemplateDefinition } from './imports.constants';
import { columnIndexToLetters } from './imports.parser';

export class UploadImportDto {
  template_type!: string;
  file_name?: string;
  content?: string;
  file_base64?: string;
  mime_type?: string;
}

export class ListImportsDto {
  template_type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export class ListImportRowsDto {
  status?: string;
  page?: number;
  limit?: number;
}

export function validateUploadImportDto(body: any): UploadImportDto {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Dữ liệu yêu cầu tải lên tệp nhập khẩu không hợp lệ',
      false,
      undefined,
      [
        {
          field: 'body',
          code: 'INVALID_BODY',
          message: 'Yêu cầu phải là một đối tượng JSON',
        },
      ]
    );
  }

  const errors: Array<{ field: string; code: string; message: string }> = [];

  if (body.template_type === undefined || body.template_type === null) {
    errors.push({
      field: 'template_type',
      code: 'REQUIRED',
      message: 'Loại mẫu nhập khẩu là bắt buộc',
    });
  } else if (typeof body.template_type !== 'string') {
    errors.push({
      field: 'template_type',
      code: 'INVALID_TYPE',
      message: 'Loại mẫu nhập khẩu phải là chuỗi ký tự',
    });
  } else if (!Object.values(ImportTemplateType).includes(body.template_type as any)) {
    errors.push({
      field: 'template_type',
      code: 'INVALID_ENUM',
      message: `Loại mẫu không hợp lệ. Cho phép: ${Object.values(ImportTemplateType).join(', ')}`,
    });
  }

  if (body.file_name !== undefined && typeof body.file_name !== 'string') {
    errors.push({
      field: 'file_name',
      code: 'INVALID_TYPE',
      message: 'Tên tệp phải là chuỗi ký tự',
    });
  }

  if (body.content !== undefined && typeof body.content !== 'string') {
    errors.push({
      field: 'content',
      code: 'INVALID_TYPE',
      message: 'Nội dung tệp phải là chuỗi ký tự',
    });
  }

  if (body.file_base64 !== undefined && typeof body.file_base64 !== 'string') {
    errors.push({
      field: 'file_base64',
      code: 'INVALID_TYPE',
      message: 'Dữ liệu base64 phải là chuỗi ký tự',
    });
  }

  if (body.mime_type !== undefined && typeof body.mime_type !== 'string') {
    errors.push({
      field: 'mime_type',
      code: 'INVALID_TYPE',
      message: 'MIME type phải là chuỗi ký tự',
    });
  }

  if (errors.length > 0) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      'Dữ liệu tải lên tệp nhập khẩu không hợp lệ',
      false,
      undefined,
      errors
    );
  }

  return {
    template_type: body.template_type.trim(),
    file_name: body.file_name ? body.file_name.trim() : undefined,
    content: body.content,
    file_base64: body.file_base64,
    mime_type: body.mime_type ? body.mime_type.trim() : undefined,
  };
}

export interface ValidatedRowResult {
  rowNumber: number;
  rawData: Record<string, string>;
  normalizedData: Record<string, any>;
  scopeIdentifier: string | null;
  status: 'VALID' | 'ERROR' | 'WARNING';
  issues: ImportRowIssue[];
}

/**
 * Validates a single mapped row against the template definition.
 */
export function validateImportRow(
  template: TemplateDefinition,
  rowNumber: number,
  rawData: Record<string, string>,
  mappedData: Record<string, string>,
  seenScopeCodes: Set<string>
): ValidatedRowResult {
  const issues: ImportRowIssue[] = [];
  const normalized: Record<string, any> = {};

  // 1. Validate Scope Identifier (code)
  const rawCode = mappedData[template.scopeField];
  let scopeIdentifier: string | null = null;

  if (!rawCode || rawCode.trim().length === 0) {
    issues.push({
      field: template.scopeField,
      code: 'MISSING_SCOPE_IDENTIFIER',
      message: `Dòng ${rowNumber}: Thiếu mã định danh phạm vi (${template.scopeField}). Định danh phạm vi là bắt buộc và không bao giờ được suy đoán.`,
      severity: 'BLOCKING',
    });
  } else {
    const cleanCode = rawCode.trim();
    scopeIdentifier = cleanCode;
    if (!isValidWarehouseCode(cleanCode)) {
      issues.push({
        field: template.scopeField,
        code: 'INVALID_SCOPE_IDENTIFIER',
        message: `Dòng ${rowNumber}: Mã (${cleanCode}) không hợp lệ (phải từ 2-64 ký tự: chữ cái, số, '-' hoặc '_').`,
        severity: 'BLOCKING',
      });
    } else if (seenScopeCodes.has(cleanCode.toUpperCase())) {
      issues.push({
        field: template.scopeField,
        code: 'DUPLICATE_SCOPE_IDENTIFIER',
        message: `Dòng ${rowNumber}: Trùng lặp mã định danh (${cleanCode}) trong cùng tệp tải lên.`,
        severity: 'BLOCKING',
      });
    } else {
      seenScopeCodes.add(cleanCode.toUpperCase());
    }
    normalized[template.scopeField] = cleanCode;
  }

  // 1.5. Structural check: surplus cells beyond the header width are preserved by the
  // parsers as `__extra_<col>` markers. They must surface as a blocking structural error
  // instead of letting the row (or part of it) disappear from the import.
  const extraColumns = Object.keys(mappedData).filter((key) => key.startsWith('__extra_'));
  if (extraColumns.length > 0) {
    const columnLabels = extraColumns
      .filter((key) => key !== '__extra_overflow')
      .map((key) => key.slice('__extra_'.length))
      .filter((idx) => /^\d+$/.test(idx))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
      .map((idx) => columnIndexToLetters(parseInt(idx, 10)));
    const overflow = extraColumns.includes('__extra_overflow');
    issues.push({
      field: 'row_structure',
      code: 'EXTRA_COLUMNS',
      message: `Dòng ${rowNumber}: Fila chứa dữ liệu ở các cột vượt quá cấu trúc header${
        columnLabels.length > 0 ? ` (${columnLabels.join(', ')})` : ''
      }${overflow ? ' cùng với nhiều cột phụ khác' : ''}. Đây là lỗi cấu trúc tệp: dòng này bị loại khỏi nhập liệu.`,
      severity: 'BLOCKING',
    });
  }

  // 2. Validate Template Specific Fields
  for (const col of template.columns) {
    if (col.key === template.scopeField) continue; // Already validated above

    const rawVal = mappedData[col.key];
    const val = rawVal !== undefined ? rawVal.trim() : '';

    if (col.required) {
      if (!val || val.length === 0) {
        issues.push({
          field: col.key,
          code: 'REQUIRED_FIELD_MISSING',
          message: `Dòng ${rowNumber}: Trường bắt buộc '${col.header}' (${col.key}) không được để trống.`,
          severity: 'BLOCKING',
        });
      } else {
        validateFieldFormat(col.key, val, rowNumber, issues, normalized);
      }
    } else {
      // Optional field
      if (!val || val.length === 0) {
        if (col.warnIfEmpty) {
          // Nonblocking issue
          issues.push({
            field: col.key,
            code: 'DATA_INCOMPLETE',
            message: `Dòng ${rowNumber}: Dữ liệu tùy chọn '${col.header}' (${col.key}) để trống.`,
            severity: 'WARNING',
          });
        }
        normalized[col.key] = null;
      } else {
        validateFieldFormat(col.key, val, rowNumber, issues, normalized, template.type);
      }
    }
  }

  const hasBlocking = issues.some((i) => i.severity === 'BLOCKING');
  const hasWarning = issues.some((i) => i.severity === 'WARNING');
  const status: 'VALID' | 'ERROR' | 'WARNING' = hasBlocking
    ? 'ERROR'
    : hasWarning
      ? 'WARNING'
      : 'VALID';

  return {
    rowNumber,
    rawData,
    normalizedData: normalized,
    scopeIdentifier,
    status,
    issues,
  };
}

function validateFieldFormat(
  field: string,
  val: string,
  rowNumber: number,
  issues: ImportRowIssue[],
  normalized: Record<string, any>,
  templateType?: string
): void {
  switch (field) {
    case 'name':
      if (val.length < 2 || val.length > 255) {
        issues.push({
          field,
          code: 'INVALID_LENGTH',
          message: `Dòng ${rowNumber}: Tên phải từ 2 đến 255 ký tự.`,
          severity: 'BLOCKING',
        });
      }
      normalized[field] = val;
      break;

    case 'status':
      const s = val.toLowerCase();
      if (s !== 'active' && s !== 'inactive') {
        issues.push({
          field,
          code: 'INVALID_STATUS',
          message: `Dòng ${rowNumber}: Trạng thái '${val}' không hợp lệ (chỉ chấp nhận active hoặc inactive).`,
          severity: 'BLOCKING',
        });
      } else {
        normalized[field] =
          templateType === ImportTemplateType.BRANCHES
            ? s === 'active'
              ? 'ACTIVE'
              : 'INACTIVE'
            : s;
      }
      break;

    case 'is_default':
      const def = val.toLowerCase();
      if (['true', '1', 'có', 'yes'].includes(def)) {
        normalized[field] = true;
      } else if (['false', '0', 'không', 'no'].includes(def)) {
        normalized[field] = false;
      } else {
        issues.push({
          field,
          code: 'INVALID_BOOLEAN',
          message: `Dòng ${rowNumber}: Mặc định '${val}' không hợp lệ (phải là true hoặc false).`,
          severity: 'BLOCKING',
        });
      }
      break;

    case 'contact_phone':
      if (!isValidWarehousePhone(val)) {
        issues.push({
          field,
          code: 'INVALID_PHONE_FORMAT',
          message: `Dòng ${rowNumber}: Số điện thoại '${val}' không đúng định dạng Việt Nam.`,
          severity: 'BLOCKING',
        });
      }
      normalized[field] = val;
      break;

    case 'contact_email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) || val.length > 255) {
        issues.push({
          field,
          code: 'INVALID_EMAIL_FORMAT',
          message: `Dòng ${rowNumber}: Email '${val}' không đúng định dạng.`,
          severity: 'BLOCKING',
        });
      }
      normalized[field] = val;
      break;

    case 'address_line':
      if (val.length < 3 || val.length > 500) {
        issues.push({
          field,
          code: 'INVALID_ADDRESS_LENGTH',
          message: `Dòng ${rowNumber}: Địa chỉ phải từ 3 đến 500 ký tự.`,
          severity: 'BLOCKING',
        });
      }
      normalized[field] = val;
      break;

    case 'cutoff_time':
      if (!isValidCutoffTime(val)) {
        issues.push({
          field,
          code: 'INVALID_CUTOFF_TIME',
          message: `Dòng ${rowNumber}: Giờ cắt ca '${val}' phải có định dạng HH:mm (ví dụ: 16:00).`,
          severity: 'BLOCKING',
        });
      }
      normalized[field] = val;
      break;

    default:
      normalized[field] = val;
      break;
  }
}
