import type { CanonicalFieldError } from '../auth/auth.service';

export interface UpdateShopProfileDto {
  name?: string;
  legal_name?: string | null;
  tax_code?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  legal_address?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_account_name?: string | null;
  bank_branch?: string | null;
  timezone?: string;
  currency?: string;
  default_fee_payer?: 'SHOP' | 'RECIPIENT';
  default_weight_unit?: 'g' | 'kg';
  auto_routing_enabled?: boolean;
  operating_notes?: string | null;
}

export interface FormattedShopProfile {
  id: string;
  name: string;
  code: string;
  status: string;
  legal_name: string | null;
  tax_code: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  legal_address: string | null;
  billing_email: string | null;
  billing_address: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  bank_account_name: string | null;
  bank_branch: string | null;
  timezone: string;
  currency: string;
  default_fee_payer: 'SHOP' | 'RECIPIENT';
  default_weight_unit: 'g' | 'kg';
  auto_routing_enabled: boolean;
  operating_notes: string | null;
  created_at: string;
  updated_at: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Vietnamese tax code: 10 digits or 13 digits (10 digits + hyphen + 3 digits)
const TAX_CODE_REGEX = /^[0-9]{10}(-[0-9]{3})?$/;
// Vietnamese phone: 10 digits starting with 03, 05, 07, 08, 09 or +84
const PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;
// Bank account number: 6 to 30 alphanumeric characters
const BANK_ACCOUNT_REGEX = /^[0-9A-Za-z]{6,30}$/;

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function validateUpdateShopProfileDto(dto: UpdateShopProfileDto): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];

  if (dto.name !== undefined) {
    const trimmedName = dto.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 255) {
      fields.push({
        field: 'name',
        code: 'INVALID_LENGTH',
        message: 'Tên cửa hàng phải từ 2 đến 255 ký tự',
      });
    }
  }

  if (dto.legal_name !== undefined && dto.legal_name !== null) {
    const trimmed = dto.legal_name.trim();
    if (trimmed.length > 255) {
      fields.push({
        field: 'legal_name',
        code: 'MAX_LENGTH',
        message: 'Tên pháp lý không được vượt quá 255 ký tự',
      });
    }
  }

  if (dto.tax_code !== undefined && dto.tax_code !== null) {
    const trimmedTax = dto.tax_code.trim();
    if (trimmedTax.length > 0 && !TAX_CODE_REGEX.test(trimmedTax)) {
      fields.push({
        field: 'tax_code',
        code: 'INVALID_FORMAT',
        message:
          'Mã số thuế không hợp lệ theo chuẩn Việt Nam (10 số hoặc 13 số định dạng 0123456789-001)',
      });
    }
  }

  if (dto.contact_email !== undefined && dto.contact_email !== null) {
    const trimmed = dto.contact_email.trim();
    if (trimmed.length > 0 && !EMAIL_REGEX.test(trimmed)) {
      fields.push({
        field: 'contact_email',
        code: 'INVALID_FORMAT',
        message: 'Email liên hệ không hợp lệ',
      });
    }
  }

  if (dto.contact_phone !== undefined && dto.contact_phone !== null) {
    const rawPhone = dto.contact_phone.trim().replace(/[\s.-]/g, '');
    if (rawPhone.length > 0 && !PHONE_REGEX.test(rawPhone)) {
      fields.push({
        field: 'contact_phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại liên hệ không hợp lệ theo định dạng Việt Nam',
      });
    }
  }

  if (dto.billing_email !== undefined && dto.billing_email !== null) {
    const trimmed = dto.billing_email.trim();
    if (trimmed.length > 0 && !EMAIL_REGEX.test(trimmed)) {
      fields.push({
        field: 'billing_email',
        code: 'INVALID_FORMAT',
        message: 'Email nhận hóa đơn không hợp lệ',
      });
    }
  }

  if (dto.bank_account_number !== undefined && dto.bank_account_number !== null) {
    const rawAcc = dto.bank_account_number.trim().replace(/[\s-]/g, '');
    if (rawAcc.length > 0 && !BANK_ACCOUNT_REGEX.test(rawAcc)) {
      fields.push({
        field: 'bank_account_number',
        code: 'INVALID_FORMAT',
        message: 'Số tài khoản ngân hàng không hợp lệ (từ 6 đến 30 ký tự)',
      });
    }
  }

  if (dto.bank_account_name !== undefined && dto.bank_account_name !== null) {
    const trimmed = dto.bank_account_name.trim();
    if (trimmed.length > 255) {
      fields.push({
        field: 'bank_account_name',
        code: 'MAX_LENGTH',
        message: 'Tên chủ tài khoản ngân hàng không được vượt quá 255 ký tự',
      });
    }
  }

  if (dto.bank_name !== undefined && dto.bank_name !== null) {
    const trimmed = dto.bank_name.trim();
    if (trimmed.length > 128) {
      fields.push({
        field: 'bank_name',
        code: 'MAX_LENGTH',
        message: 'Tên ngân hàng không được vượt quá 128 ký tự',
      });
    }
  }

  if (dto.timezone !== undefined) {
    const trimmedTz = typeof dto.timezone === 'string' ? dto.timezone.trim() : '';
    if (!isValidTimeZone(trimmedTz)) {
      fields.push({
        field: 'timezone',
        code: 'INVALID_FORMAT',
        message: 'Múi giờ không hợp lệ theo chuẩn IANA (ví dụ: Asia/Ho_Chi_Minh hoặc UTC)',
      });
    }
  }

  if (dto.currency !== undefined) {
    if (dto.currency !== 'VND') {
      fields.push({
        field: 'currency',
        code: 'INVALID_ENUM',
        message: 'Đơn vị tiền tệ mặc định phải là VND',
      });
    }
  }

  if (dto.default_fee_payer !== undefined) {
    if (dto.default_fee_payer !== 'SHOP' && dto.default_fee_payer !== 'RECIPIENT') {
      fields.push({
        field: 'default_fee_payer',
        code: 'INVALID_ENUM',
        message: 'Bên trả phí vận chuyển mặc định phải là SHOP hoặc RECIPIENT',
      });
    }
  }

  if (dto.default_weight_unit !== undefined) {
    if (dto.default_weight_unit !== 'g' && dto.default_weight_unit !== 'kg') {
      fields.push({
        field: 'default_weight_unit',
        code: 'INVALID_ENUM',
        message: 'Đơn vị khối lượng mặc định phải là g hoặc kg',
      });
    }
  }

  if (dto.operating_notes !== undefined && dto.operating_notes !== null) {
    if (dto.operating_notes.length > 1000) {
      fields.push({
        field: 'operating_notes',
        code: 'MAX_LENGTH',
        message: 'Ghi chú vận hành không được vượt quá 1000 ký tự',
      });
    }
  }

  return fields;
}
