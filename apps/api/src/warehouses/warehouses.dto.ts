import type { CanonicalFieldError } from '../auth/auth.service';

export interface CreateWarehouseDto {
  name: string;
  code?: string;
  is_default?: boolean;
  contact_name: string;
  contact_phone: string;
  contact_email?: string | null;
  address_line: string;
  ward?: string | null;
  district: string;
  city: string;
  postal_code?: string | null;
  use_different_return_address?: boolean;
  return_contact_name?: string | null;
  return_contact_phone?: string | null;
  return_address_line?: string | null;
  return_ward?: string | null;
  return_district?: string | null;
  return_city?: string | null;
  operating_hours?: Record<string, unknown> | null;
  cutoff_time?: string | null;
  schedule_notes?: string | null;
  contacts_json?: Record<string, unknown> | unknown[] | null;
  printer_paper_size?: 'A6' | 'A5' | 'A4' | 'K80';
  printer_dpi?: 203 | 300;
  printer_name?: string | null;
  printer_auto_print?: boolean;
  printer_config?: Record<string, unknown> | null;
}

export interface UpdateWarehouseDto {
  name?: string;
  code?: string;
  status?: 'active' | 'inactive';
  is_default?: boolean;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string | null;
  address_line?: string;
  ward?: string | null;
  district?: string;
  city?: string;
  postal_code?: string | null;
  use_different_return_address?: boolean;
  return_contact_name?: string | null;
  return_contact_phone?: string | null;
  return_address_line?: string | null;
  return_ward?: string | null;
  return_district?: string | null;
  return_city?: string | null;
  operating_hours?: Record<string, unknown> | null;
  cutoff_time?: string | null;
  schedule_notes?: string | null;
  contacts_json?: Record<string, unknown> | unknown[] | null;
  printer_paper_size?: 'A6' | 'A5' | 'A4' | 'K80';
  printer_dpi?: 203 | 300;
  printer_name?: string | null;
  printer_auto_print?: boolean;
  printer_config?: Record<string, unknown> | null;
}

export interface FormattedWarehouse {
  id: string;
  merchant_id: string;
  name: string;
  code: string;
  status: string;
  is_default: boolean;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  address_line: string;
  ward: string | null;
  district: string;
  city: string;
  postal_code: string | null;
  address_json: Record<string, unknown>;
  use_different_return_address: boolean;
  return_contact_name: string | null;
  return_contact_phone: string | null;
  return_address_line: string | null;
  return_ward: string | null;
  return_district: string | null;
  return_city: string | null;
  return_address_json: Record<string, unknown> | null;
  operating_hours: Record<string, unknown> | null;
  cutoff_time: string | null;
  schedule_notes: string | null;
  contacts_json: Record<string, unknown> | unknown[] | null;
  printer_paper_size: string;
  printer_dpi: number;
  printer_name: string | null;
  printer_auto_print: boolean;
  printer_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Vietnamese phone: 10 digits starting with 03, 05, 07, 08, 09 or +84
export const PHONE_REGEX = /^(0|\+84)[35789][0-9]{8}$/;
// HH:mm cutoff time 00:00 to 23:59
export const CUTOFF_TIME_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const ALLOWED_PAPER_SIZES = ['A6', 'A5', 'A4', 'K80'] as const;
export const ALLOWED_DPIS = [203, 300] as const;

export function validateCreateWarehouseDto(dto: CreateWarehouseDto): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];

  // Name
  if (dto.name === undefined || dto.name === null) {
    fields.push({
      field: 'name',
      code: 'REQUIRED',
      message: 'Tên kho hàng là bắt buộc',
    });
  } else if (typeof dto.name !== 'string') {
    fields.push({
      field: 'name',
      code: 'INVALID_TYPE',
      message: 'Tên kho hàng phải là chuỗi ký tự',
    });
  } else if (dto.name.trim().length === 0) {
    fields.push({
      field: 'name',
      code: 'REQUIRED',
      message: 'Tên kho hàng là bắt buộc',
    });
  } else {
    const trimmed = dto.name.trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      fields.push({
        field: 'name',
        code: 'INVALID_LENGTH',
        message: 'Tên kho hàng phải từ 2 đến 255 ký tự',
      });
    }
  }

  // Code (optional on create, but if provided must be valid)
  if (dto.code !== undefined && dto.code !== null) {
    if (typeof dto.code !== 'string') {
      fields.push({
        field: 'code',
        code: 'INVALID_TYPE',
        message: 'Mã kho hàng phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.code.trim();
      if (trimmed.length < 2 || trimmed.length > 64) {
        fields.push({
          field: 'code',
          code: 'INVALID_LENGTH',
          message: 'Mã kho hàng phải từ 2 đến 64 ký tự',
        });
      } else if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
        fields.push({
          field: 'code',
          code: 'INVALID_FORMAT',
          message: 'Mã kho hàng chỉ được chứa chữ cái, số, dấu gạch nối và gạch dưới',
        });
      }
    }
  }

  // Contact name
  if (dto.contact_name === undefined || dto.contact_name === null) {
    fields.push({
      field: 'contact_name',
      code: 'REQUIRED',
      message: 'Tên người liên hệ kho là bắt buộc',
    });
  } else if (typeof dto.contact_name !== 'string') {
    fields.push({
      field: 'contact_name',
      code: 'INVALID_TYPE',
      message: 'Tên người liên hệ kho phải là chuỗi ký tự',
    });
  } else if (dto.contact_name.trim().length === 0) {
    fields.push({
      field: 'contact_name',
      code: 'REQUIRED',
      message: 'Tên người liên hệ kho là bắt buộc',
    });
  } else {
    const trimmed = dto.contact_name.trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      fields.push({
        field: 'contact_name',
        code: 'INVALID_LENGTH',
        message: 'Tên người liên hệ kho phải từ 2 đến 255 ký tự',
      });
    }
  }

  // Contact phone
  if (dto.contact_phone === undefined || dto.contact_phone === null) {
    fields.push({
      field: 'contact_phone',
      code: 'REQUIRED',
      message: 'Số điện thoại liên hệ kho là bắt buộc',
    });
  } else if (typeof dto.contact_phone !== 'string') {
    fields.push({
      field: 'contact_phone',
      code: 'INVALID_TYPE',
      message: 'Số điện thoại liên hệ kho phải là chuỗi ký tự',
    });
  } else if (dto.contact_phone.trim().length === 0) {
    fields.push({
      field: 'contact_phone',
      code: 'REQUIRED',
      message: 'Số điện thoại liên hệ kho là bắt buộc',
    });
  } else {
    const trimmed = dto.contact_phone.trim();
    if (!PHONE_REGEX.test(trimmed)) {
      fields.push({
        field: 'contact_phone',
        code: 'INVALID_FORMAT',
        message:
          'Số điện thoại không hợp lệ theo định dạng Việt Nam (10 số, bắt đầu bằng 03, 05, 07, 08, 09)',
      });
    }
  }

  // Contact email
  if (dto.contact_email !== undefined && dto.contact_email !== null) {
    if (typeof dto.contact_email !== 'string') {
      fields.push({
        field: 'contact_email',
        code: 'INVALID_TYPE',
        message: 'Email liên hệ phải là chuỗi ký tự',
      });
    } else if (dto.contact_email.trim() !== '') {
      const trimmed = dto.contact_email.trim();
      if (!EMAIL_REGEX.test(trimmed) || trimmed.length > 255) {
        fields.push({
          field: 'contact_email',
          code: 'INVALID_FORMAT',
          message: 'Email liên hệ không đúng định dạng',
        });
      }
    }
  }

  // Address line
  if (dto.address_line === undefined || dto.address_line === null) {
    fields.push({
      field: 'address_line',
      code: 'REQUIRED',
      message: 'Địa chỉ lấy hàng chi tiết là bắt buộc',
    });
  } else if (typeof dto.address_line !== 'string') {
    fields.push({
      field: 'address_line',
      code: 'INVALID_TYPE',
      message: 'Địa chỉ lấy hàng chi tiết phải là chuỗi ký tự',
    });
  } else if (dto.address_line.trim().length === 0) {
    fields.push({
      field: 'address_line',
      code: 'REQUIRED',
      message: 'Địa chỉ lấy hàng chi tiết là bắt buộc',
    });
  } else {
    const trimmed = dto.address_line.trim();
    if (trimmed.length < 3 || trimmed.length > 500) {
      fields.push({
        field: 'address_line',
        code: 'INVALID_LENGTH',
        message: 'Địa chỉ lấy hàng phải từ 3 đến 500 ký tự',
      });
    }
  }

  // Ward
  if (dto.ward !== undefined && dto.ward !== null && typeof dto.ward !== 'string') {
    fields.push({
      field: 'ward',
      code: 'INVALID_TYPE',
      message: 'Phường/Xã phải là chuỗi ký tự',
    });
  }

  // District
  if (dto.district === undefined || dto.district === null) {
    fields.push({
      field: 'district',
      code: 'REQUIRED',
      message: 'Quận/Huyện lấy hàng là bắt buộc',
    });
  } else if (typeof dto.district !== 'string') {
    fields.push({
      field: 'district',
      code: 'INVALID_TYPE',
      message: 'Quận/Huyện lấy hàng phải là chuỗi ký tự',
    });
  } else if (dto.district.trim().length === 0) {
    fields.push({
      field: 'district',
      code: 'REQUIRED',
      message: 'Quận/Huyện lấy hàng là bắt buộc',
    });
  }

  // City / Province
  if (dto.city === undefined || dto.city === null) {
    fields.push({
      field: 'city',
      code: 'REQUIRED',
      message: 'Tỉnh/Thành phố lấy hàng là bắt buộc',
    });
  } else if (typeof dto.city !== 'string') {
    fields.push({
      field: 'city',
      code: 'INVALID_TYPE',
      message: 'Tỉnh/Thành phố lấy hàng phải là chuỗi ký tự',
    });
  } else if (dto.city.trim().length === 0) {
    fields.push({
      field: 'city',
      code: 'REQUIRED',
      message: 'Tỉnh/Thành phố lấy hàng là bắt buộc',
    });
  }

  // Postal code
  if (
    dto.postal_code !== undefined &&
    dto.postal_code !== null &&
    typeof dto.postal_code !== 'string'
  ) {
    fields.push({
      field: 'postal_code',
      code: 'INVALID_TYPE',
      message: 'Mã bưu cục phải là chuỗi ký tự',
    });
  }

  // Return address validation if different
  if (dto.use_different_return_address) {
    if (
      !dto.return_contact_name ||
      typeof dto.return_contact_name !== 'string' ||
      dto.return_contact_name.trim().length === 0
    ) {
      fields.push({
        field: 'return_contact_name',
        code: 'REQUIRED',
        message: 'Tên người nhận hoàn hàng là bắt buộc khi chọn địa chỉ hoàn khác',
      });
    }
    if (
      !dto.return_contact_phone ||
      typeof dto.return_contact_phone !== 'string' ||
      !PHONE_REGEX.test(dto.return_contact_phone.trim())
    ) {
      fields.push({
        field: 'return_contact_phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại nhận hoàn không hợp lệ theo định dạng Việt Nam',
      });
    }
    if (
      !dto.return_address_line ||
      typeof dto.return_address_line !== 'string' ||
      dto.return_address_line.trim().length < 3
    ) {
      fields.push({
        field: 'return_address_line',
        code: 'REQUIRED',
        message: 'Địa chỉ hoàn hàng chi tiết là bắt buộc',
      });
    }
    if (
      !dto.return_district ||
      typeof dto.return_district !== 'string' ||
      dto.return_district.trim().length === 0
    ) {
      fields.push({
        field: 'return_district',
        code: 'REQUIRED',
        message: 'Quận/Huyện hoàn hàng là bắt buộc',
      });
    }
    if (
      !dto.return_city ||
      typeof dto.return_city !== 'string' ||
      dto.return_city.trim().length === 0
    ) {
      fields.push({
        field: 'return_city',
        code: 'REQUIRED',
        message: 'Tỉnh/Thành phố hoàn hàng là bắt buộc',
      });
    }
    if (
      dto.return_ward !== undefined &&
      dto.return_ward !== null &&
      typeof dto.return_ward !== 'string'
    ) {
      fields.push({
        field: 'return_ward',
        code: 'INVALID_TYPE',
        message: 'Phường/Xã nhận hoàn phải là chuỗi ký tự',
      });
    }
  }

  // Cutoff time
  if (dto.cutoff_time !== undefined && dto.cutoff_time !== null) {
    if (typeof dto.cutoff_time !== 'string') {
      fields.push({
        field: 'cutoff_time',
        code: 'INVALID_TYPE',
        message: 'Giờ cắt ca phải là chuỗi ký tự',
      });
    } else if (dto.cutoff_time.trim() !== '') {
      const trimmed = dto.cutoff_time.trim();
      if (!CUTOFF_TIME_REGEX.test(trimmed)) {
        fields.push({
          field: 'cutoff_time',
          code: 'INVALID_FORMAT',
          message: 'Giờ cắt ca lấy hàng phải có định dạng HH:mm (ví dụ: 16:00)',
        });
      }
    }
  }

  // Printer paper size
  if (dto.printer_paper_size !== undefined && dto.printer_paper_size !== null) {
    if (!ALLOWED_PAPER_SIZES.includes(dto.printer_paper_size as any)) {
      fields.push({
        field: 'printer_paper_size',
        code: 'INVALID_ENUM',
        message: `Khổ giấy in không hợp lệ. Cho phép: ${ALLOWED_PAPER_SIZES.join(', ')}`,
      });
    }
  }

  // Printer DPI
  if (dto.printer_dpi !== undefined && dto.printer_dpi !== null) {
    if (!ALLOWED_DPIS.includes(dto.printer_dpi as any)) {
      fields.push({
        field: 'printer_dpi',
        code: 'INVALID_ENUM',
        message: `Độ phân giải máy in không hợp lệ. Cho phép: ${ALLOWED_DPIS.join(', ')}`,
      });
    }
  }

  if (
    dto.printer_name !== undefined &&
    dto.printer_name !== null &&
    typeof dto.printer_name !== 'string'
  ) {
    fields.push({
      field: 'printer_name',
      code: 'INVALID_TYPE',
      message: 'Tên máy in phải là chuỗi ký tự',
    });
  }

  if (dto.printer_auto_print !== undefined && typeof dto.printer_auto_print !== 'boolean') {
    fields.push({
      field: 'printer_auto_print',
      code: 'INVALID_TYPE',
      message: 'Tự động in phải là giá trị boolean',
    });
  }

  if (
    dto.schedule_notes !== undefined &&
    dto.schedule_notes !== null &&
    typeof dto.schedule_notes !== 'string'
  ) {
    fields.push({
      field: 'schedule_notes',
      code: 'INVALID_TYPE',
      message: 'Ghi chú lịch hoạt động phải là chuỗi ký tự',
    });
  }

  return fields;
}

export function validateUpdateWarehouseDto(dto: UpdateWarehouseDto): CanonicalFieldError[] {
  const fields: CanonicalFieldError[] = [];

  if (dto.name !== undefined && dto.name !== null) {
    if (typeof dto.name !== 'string') {
      fields.push({
        field: 'name',
        code: 'INVALID_TYPE',
        message: 'Tên kho hàng phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.name.trim();
      if (trimmed.length < 2 || trimmed.length > 255) {
        fields.push({
          field: 'name',
          code: 'INVALID_LENGTH',
          message: 'Tên kho hàng phải từ 2 đến 255 ký tự',
        });
      }
    }
  }

  if (dto.code !== undefined && dto.code !== null) {
    if (typeof dto.code !== 'string') {
      fields.push({
        field: 'code',
        code: 'INVALID_TYPE',
        message: 'Mã kho hàng phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.code.trim();
      if (trimmed.length < 2 || trimmed.length > 64) {
        fields.push({
          field: 'code',
          code: 'INVALID_LENGTH',
          message: 'Mã kho hàng phải từ 2 đến 64 ký tự',
        });
      } else if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
        fields.push({
          field: 'code',
          code: 'INVALID_FORMAT',
          message: 'Mã kho hàng chỉ được chứa chữ cái, số, dấu gạch nối và gạch dưới',
        });
      }
    }
  }

  if (dto.status !== undefined && dto.status !== null) {
    if (dto.status !== 'active' && dto.status !== 'inactive') {
      fields.push({
        field: 'status',
        code: 'INVALID_ENUM',
        message: 'Trạng thái kho chỉ chấp nhận active hoặc inactive',
      });
    }
  }

  if (dto.contact_name !== undefined && dto.contact_name !== null) {
    if (typeof dto.contact_name !== 'string') {
      fields.push({
        field: 'contact_name',
        code: 'INVALID_TYPE',
        message: 'Tên người liên hệ kho phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.contact_name.trim();
      if (trimmed.length < 2 || trimmed.length > 255) {
        fields.push({
          field: 'contact_name',
          code: 'INVALID_LENGTH',
          message: 'Tên người liên hệ kho phải từ 2 đến 255 ký tự',
        });
      }
    }
  }

  if (dto.contact_phone !== undefined && dto.contact_phone !== null) {
    if (typeof dto.contact_phone !== 'string') {
      fields.push({
        field: 'contact_phone',
        code: 'INVALID_TYPE',
        message: 'Số điện thoại liên hệ kho phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.contact_phone.trim();
      if (!PHONE_REGEX.test(trimmed)) {
        fields.push({
          field: 'contact_phone',
          code: 'INVALID_FORMAT',
          message: 'Số điện thoại không hợp lệ theo định dạng Việt Nam',
        });
      }
    }
  }

  if (dto.contact_email !== undefined && dto.contact_email !== null) {
    if (typeof dto.contact_email !== 'string') {
      fields.push({
        field: 'contact_email',
        code: 'INVALID_TYPE',
        message: 'Email liên hệ phải là chuỗi ký tự',
      });
    } else if (dto.contact_email.trim() !== '') {
      const trimmed = dto.contact_email.trim();
      if (!EMAIL_REGEX.test(trimmed) || trimmed.length > 255) {
        fields.push({
          field: 'contact_email',
          code: 'INVALID_FORMAT',
          message: 'Email liên hệ không đúng định dạng',
        });
      }
    }
  }

  if (dto.address_line !== undefined && dto.address_line !== null) {
    if (typeof dto.address_line !== 'string') {
      fields.push({
        field: 'address_line',
        code: 'INVALID_TYPE',
        message: 'Địa chỉ lấy hàng phải là chuỗi ký tự',
      });
    } else {
      const trimmed = dto.address_line.trim();
      if (trimmed.length < 3 || trimmed.length > 500) {
        fields.push({
          field: 'address_line',
          code: 'INVALID_LENGTH',
          message: 'Địa chỉ lấy hàng phải từ 3 đến 500 ký tự',
        });
      }
    }
  }

  if (dto.ward !== undefined && dto.ward !== null && typeof dto.ward !== 'string') {
    fields.push({
      field: 'ward',
      code: 'INVALID_TYPE',
      message: 'Phường/Xã phải là chuỗi ký tự',
    });
  }

  if (dto.district !== undefined && dto.district !== null) {
    if (typeof dto.district !== 'string') {
      fields.push({
        field: 'district',
        code: 'INVALID_TYPE',
        message: 'Quận/Huyện lấy hàng phải là chuỗi ký tự',
      });
    } else if (dto.district.trim().length === 0) {
      fields.push({
        field: 'district',
        code: 'REQUIRED',
        message: 'Quận/Huyện lấy hàng không được để trống',
      });
    }
  }

  if (dto.city !== undefined && dto.city !== null) {
    if (typeof dto.city !== 'string') {
      fields.push({
        field: 'city',
        code: 'INVALID_TYPE',
        message: 'Tỉnh/Thành phố lấy hàng phải là chuỗi ký tự',
      });
    } else if (dto.city.trim().length === 0) {
      fields.push({
        field: 'city',
        code: 'REQUIRED',
        message: 'Tỉnh/Thành phố lấy hàng không được để trống',
      });
    }
  }

  if (
    dto.postal_code !== undefined &&
    dto.postal_code !== null &&
    typeof dto.postal_code !== 'string'
  ) {
    fields.push({
      field: 'postal_code',
      code: 'INVALID_TYPE',
      message: 'Mã bưu cục phải là chuỗi ký tự',
    });
  }

  if (dto.is_default !== undefined && typeof dto.is_default !== 'boolean') {
    fields.push({
      field: 'is_default',
      code: 'INVALID_TYPE',
      message: 'Cấu hình mặc định phải là giá trị boolean',
    });
  }

  if (
    dto.use_different_return_address !== undefined &&
    typeof dto.use_different_return_address !== 'boolean'
  ) {
    fields.push({
      field: 'use_different_return_address',
      code: 'INVALID_TYPE',
      message: 'Cấu hình hoàn hàng phải là giá trị boolean',
    });
  }

  if (dto.use_different_return_address === true) {
    if (
      !dto.return_contact_name ||
      typeof dto.return_contact_name !== 'string' ||
      dto.return_contact_name.trim().length === 0
    ) {
      fields.push({
        field: 'return_contact_name',
        code: 'REQUIRED',
        message: 'Tên người nhận hoàn hàng là bắt buộc khi chọn địa chỉ hoàn khác',
      });
    } else {
      const trimmed = dto.return_contact_name.trim();
      if (trimmed.length < 2 || trimmed.length > 255) {
        fields.push({
          field: 'return_contact_name',
          code: 'INVALID_LENGTH',
          message: 'Tên người nhận hoàn phải từ 2 đến 255 ký tự',
        });
      }
    }

    if (!dto.return_contact_phone || typeof dto.return_contact_phone !== 'string') {
      fields.push({
        field: 'return_contact_phone',
        code: 'REQUIRED',
        message: 'Số điện thoại nhận hoàn là bắt buộc khi chọn địa chỉ hoàn khác',
      });
    } else if (!PHONE_REGEX.test(dto.return_contact_phone.trim())) {
      fields.push({
        field: 'return_contact_phone',
        code: 'INVALID_FORMAT',
        message: 'Số điện thoại nhận hoàn không hợp lệ theo định dạng Việt Nam',
      });
    }

    if (
      !dto.return_address_line ||
      typeof dto.return_address_line !== 'string' ||
      dto.return_address_line.trim().length < 3
    ) {
      fields.push({
        field: 'return_address_line',
        code: 'REQUIRED',
        message: 'Địa chỉ hoàn hàng chi tiết là bắt buộc',
      });
    }

    if (
      !dto.return_district ||
      typeof dto.return_district !== 'string' ||
      dto.return_district.trim().length === 0
    ) {
      fields.push({
        field: 'return_district',
        code: 'REQUIRED',
        message: 'Quận/Huyện hoàn hàng là bắt buộc',
      });
    }

    if (
      !dto.return_city ||
      typeof dto.return_city !== 'string' ||
      dto.return_city.trim().length === 0
    ) {
      fields.push({
        field: 'return_city',
        code: 'REQUIRED',
        message: 'Tỉnh/Thành phố hoàn hàng là bắt buộc',
      });
    }

    if (
      dto.return_ward !== undefined &&
      dto.return_ward !== null &&
      typeof dto.return_ward !== 'string'
    ) {
      fields.push({
        field: 'return_ward',
        code: 'INVALID_TYPE',
        message: 'Phường/Xã nhận hoàn phải là chuỗi ký tự',
      });
    }
  }

  if (dto.cutoff_time !== undefined && dto.cutoff_time !== null) {
    if (typeof dto.cutoff_time !== 'string') {
      fields.push({
        field: 'cutoff_time',
        code: 'INVALID_TYPE',
        message: 'Giờ cắt ca phải là chuỗi ký tự',
      });
    } else if (dto.cutoff_time.trim() !== '') {
      const trimmed = dto.cutoff_time.trim();
      if (!CUTOFF_TIME_REGEX.test(trimmed)) {
        fields.push({
          field: 'cutoff_time',
          code: 'INVALID_FORMAT',
          message: 'Giờ cắt ca lấy hàng phải có định dạng HH:mm (ví dụ: 16:00)',
        });
      }
    }
  }

  if (dto.printer_paper_size !== undefined && dto.printer_paper_size !== null) {
    if (!ALLOWED_PAPER_SIZES.includes(dto.printer_paper_size as any)) {
      fields.push({
        field: 'printer_paper_size',
        code: 'INVALID_ENUM',
        message: `Khổ giấy in không hợp lệ. Cho phép: ${ALLOWED_PAPER_SIZES.join(', ')}`,
      });
    }
  }

  if (dto.printer_dpi !== undefined && dto.printer_dpi !== null) {
    if (!ALLOWED_DPIS.includes(dto.printer_dpi as any)) {
      fields.push({
        field: 'printer_dpi',
        code: 'INVALID_ENUM',
        message: `Độ phân giải máy in không hợp lệ. Cho phép: ${ALLOWED_DPIS.join(', ')}`,
      });
    }
  }

  if (
    dto.printer_name !== undefined &&
    dto.printer_name !== null &&
    typeof dto.printer_name !== 'string'
  ) {
    fields.push({
      field: 'printer_name',
      code: 'INVALID_TYPE',
      message: 'Tên máy in phải là chuỗi ký tự',
    });
  }

  if (dto.printer_auto_print !== undefined && typeof dto.printer_auto_print !== 'boolean') {
    fields.push({
      field: 'printer_auto_print',
      code: 'INVALID_TYPE',
      message: 'Tự động in phải là giá trị boolean',
    });
  }

  if (
    dto.schedule_notes !== undefined &&
    dto.schedule_notes !== null &&
    typeof dto.schedule_notes !== 'string'
  ) {
    fields.push({
      field: 'schedule_notes',
      code: 'INVALID_TYPE',
      message: 'Ghi chú lịch hoạt động phải là chuỗi ký tự',
    });
  }

  return fields;
}
