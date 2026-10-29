import type { CanonicalFieldError } from '../auth/auth.service';

export interface CreateBranchDto {
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  is_default?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateBranchDto {
  name?: string;
  code?: string;
  address?: string | null;
  phone?: string | null;
  is_default?: boolean;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface FormattedBranch {
  id: string;
  merchant_id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_default: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  created_at: string;
  updated_at: string;
}

const BRANCH_CODE_REGEX = /^[A-Za-z0-9_-]{2,64}$/;
const PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;

export function validateCreateBranchDto(dto: CreateBranchDto): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];

  if (!dto.name || typeof dto.name !== 'string' || dto.name.trim().length < 2) {
    fields.push({
      field: 'name',
      code: 'REQUIRED',
      message: 'Tên chi nhánh là bắt buộc và phải có ít nhất 2 ký tự',
    });
  } else if (dto.name.trim().length > 255) {
    fields.push({
      field: 'name',
      code: 'MAX_LENGTH',
      message: 'Tên chi nhánh không được vượt quá 255 ký tự',
    });
  }

  if (!dto.code || typeof dto.code !== 'string' || !BRANCH_CODE_REGEX.test(dto.code.trim())) {
    fields.push({
      field: 'code',
      code: 'INVALID_FORMAT',
      message:
        'Mã chi nhánh là bắt buộc, từ 2 đến 64 ký tự chữ, số, gạch ngang (-) hoặc gạch dưới (_)',
    });
  }

  if (dto.address !== undefined && dto.address !== null) {
    const trimmed = dto.address.trim();
    if (trimmed.length > 1000) {
      fields.push({
        field: 'address',
        code: 'MAX_LENGTH',
        message: 'Địa chỉ không được vượt quá 1000 ký tự',
      });
    }
  }

  if (dto.phone !== undefined && dto.phone !== null) {
    const rawPhone = dto.phone.trim().replace(/[\s.-]/g, '');
    if (rawPhone.length > 0 && !PHONE_REGEX.test(rawPhone)) {
      fields.push({
        field: 'phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại chi nhánh không hợp lệ theo định dạng Việt Nam',
      });
    }
  }

  if (dto.status !== undefined && dto.status !== null) {
    if (dto.status !== 'ACTIVE' && dto.status !== 'INACTIVE') {
      fields.push({
        field: 'status',
        code: 'INVALID_VALUE',
        message: 'Trạng thái chi nhánh chỉ có thể là ACTIVE hoặc INACTIVE',
      });
    }
  }

  return fields;
}

export function validateUpdateBranchDto(dto: UpdateBranchDto): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];

  if (dto.name !== undefined) {
    const trimmed = dto.name.trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      fields.push({
        field: 'name',
        code: 'INVALID_LENGTH',
        message: 'Tên chi nhánh phải từ 2 đến 255 ký tự',
      });
    }
  }

  if (dto.code !== undefined) {
    const trimmed = dto.code.trim();
    if (!BRANCH_CODE_REGEX.test(trimmed)) {
      fields.push({
        field: 'code',
        code: 'INVALID_FORMAT',
        message: 'Mã chi nhánh phải từ 2 đến 64 ký tự chữ, số, gạch ngang (-) hoặc gạch dưới (_)',
      });
    }
  }

  if (dto.address !== undefined && dto.address !== null) {
    const trimmed = dto.address.trim();
    if (trimmed.length > 1000) {
      fields.push({
        field: 'address',
        code: 'MAX_LENGTH',
        message: 'Địa chỉ không được vượt quá 1000 ký tự',
      });
    }
  }

  if (dto.phone !== undefined && dto.phone !== null) {
    const rawPhone = dto.phone.trim().replace(/[\s.-]/g, '');
    if (rawPhone.length > 0 && !PHONE_REGEX.test(rawPhone)) {
      fields.push({
        field: 'phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại chi nhánh không hợp lệ theo định dạng Việt Nam',
      });
    }
  }

  if (dto.status !== undefined && dto.status !== null) {
    if (dto.status !== 'ACTIVE' && dto.status !== 'INACTIVE') {
      fields.push({
        field: 'status',
        code: 'INVALID_VALUE',
        message: 'Trạng thái chi nhánh chỉ có thể là ACTIVE hoặc INACTIVE',
      });
    }
  }

  return fields;
}
