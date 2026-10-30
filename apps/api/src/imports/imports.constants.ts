import {
  WAREHOUSE_CODE_REGEX,
  WAREHOUSE_PHONE_REGEX,
  WAREHOUSE_CUTOFF_TIME_REGEX,
} from '@shipde/contracts';

export interface TemplateColumnDef {
  key: string;
  header: string;
  required: boolean;
  warnIfEmpty?: boolean;
  isScopeIdentifier?: boolean;
  description: string;
}

export interface TemplateDefinition {
  type: string;
  name: string;
  scopeField: string;
  columns: TemplateColumnDef[];
  sampleRows: Record<string, string>[];
}

export const TEMPLATE_DEFINITIONS: Record<string, TemplateDefinition> = {
  branches: {
    type: 'branches',
    name: 'Chi Nhánh (Branches)',
    scopeField: 'code',
    columns: [
      {
        key: 'code',
        header: 'Mã chi nhánh',
        required: true,
        isScopeIdentifier: true,
        description: 'Mã định danh chi nhánh (2-64 ký tự, chữ cái, số, -, _)',
      },
      {
        key: 'name',
        header: 'Tên chi nhánh',
        required: true,
        description: 'Tên chi nhánh cửa hàng (2-255 ký tự)',
      },
      {
        key: 'status',
        header: 'Trạng thái',
        required: false,
        description: 'active hoặc inactive (mặc định: active)',
      },
      {
        key: 'is_default',
        header: 'Mặc định',
        required: false,
        description: 'true hoặc false (mặc định: false)',
      },
      {
        key: 'contact_name',
        header: 'Người liên hệ',
        required: false,
        description: 'Họ tên người liên hệ chi nhánh',
      },
      {
        key: 'contact_phone',
        header: 'Số điện thoại',
        required: false,
        warnIfEmpty: true,
        description: 'Số điện thoại liên hệ hợp lệ theo định dạng VN',
      },
      {
        key: 'address_line',
        header: 'Địa chỉ',
        required: true,
        description: 'Số nhà, tên đường (3-500 ký tự)',
      },
      {
        key: 'ward',
        header: 'Phường/Xã',
        required: false,
        warnIfEmpty: true,
        description: 'Phường hoặc xã',
      },
      { key: 'district', header: 'Quận/Huyện', required: true, description: 'Quận hoặc huyện' },
      {
        key: 'city',
        header: 'Tỉnh/Thành phố',
        required: true,
        description: 'Tỉnh hoặc thành phố trực thuộc trung ương',
      },
    ],
    sampleRows: [
      {
        code: 'BR-HCM-01',
        name: 'Chi Nhánh Quận 1',
        status: 'active',
        is_default: 'true',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0901234567',
        address_line: '123 Lê Lợi',
        ward: 'Phường Bến Thành',
        district: 'Quận 1',
        city: 'TP. Hồ Chí Minh',
      },
      {
        code: 'BR-HN-01',
        name: 'Chi Nhánh Hoàn Kiếm',
        status: 'active',
        is_default: 'false',
        contact_name: 'Trần Thị B',
        contact_phone: '0912345678',
        address_line: '45 Tràng Tiền',
        ward: 'Phường Tràng Tiền',
        district: 'Quận Hoàn Kiếm',
        city: 'Hà Nội',
      },
    ],
  },
  warehouses: {
    type: 'warehouses',
    name: 'Kho Hàng (Warehouses)',
    scopeField: 'code',
    columns: [
      {
        key: 'code',
        header: 'Mã kho',
        required: true,
        isScopeIdentifier: true,
        description: 'Mã định danh kho hàng (2-64 ký tự, chữ cái, số, -, _)',
      },
      {
        key: 'name',
        header: 'Tên kho hàng',
        required: true,
        description: 'Tên kho hàng (2-255 ký tự)',
      },
      {
        key: 'status',
        header: 'Trạng thái',
        required: false,
        description: 'active hoặc inactive (mặc định: active)',
      },
      {
        key: 'is_default',
        header: 'Mặc định',
        required: false,
        description: 'true hoặc false (mặc định: false)',
      },
      {
        key: 'contact_name',
        header: 'Người liên hệ',
        required: true,
        description: 'Họ tên người phụ trách kho',
      },
      {
        key: 'contact_phone',
        header: 'Số điện thoại',
        required: true,
        description: 'Số điện thoại người phụ trách hợp lệ theo định dạng VN',
      },
      {
        key: 'contact_email',
        header: 'Email liên hệ',
        required: false,
        warnIfEmpty: true,
        description: 'Email thông báo nhận đơn kho',
      },
      {
        key: 'address_line',
        header: 'Địa chỉ lấy hàng',
        required: true,
        description: 'Địa chỉ chi tiết kho (3-500 ký tự)',
      },
      {
        key: 'ward',
        header: 'Phường/Xã',
        required: false,
        warnIfEmpty: true,
        description: 'Phường hoặc xã',
      },
      {
        key: 'district',
        header: 'Quận/Huyện',
        required: true,
        description: 'Quận hoặc huyện lấy hàng',
      },
      {
        key: 'city',
        header: 'Tỉnh/Thành phố',
        required: true,
        description: 'Tỉnh hoặc thành phố lấy hàng',
      },
      {
        key: 'postal_code',
        header: 'Mã bưu chính',
        required: false,
        description: 'Mã zip/postal code (tùy chọn)',
      },
      {
        key: 'cutoff_time',
        header: 'Giờ cắt ca',
        required: false,
        description: 'Giờ đóng ca lấy hàng định dạng HH:mm (ví dụ: 16:00)',
      },
    ],
    sampleRows: [
      {
        code: 'WH-TB-01',
        name: 'Kho Tân Bình',
        status: 'active',
        is_default: 'true',
        contact_name: 'Lê Văn Kho',
        contact_phone: '0987654321',
        contact_email: 'kho.tanbinh@example.com',
        address_line: '55 Cộng Hòa',
        ward: 'Phường 13',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        postal_code: '700000',
        cutoff_time: '17:00',
      },
      {
        code: 'WH-LB-01',
        name: 'Kho Long Biên',
        status: 'active',
        is_default: 'false',
        contact_name: 'Phạm Văn Vận',
        contact_phone: '0934567890',
        contact_email: 'kho.longbien@example.com',
        address_line: '10 Ngô Gia Tự',
        ward: 'Phường Đức Giang',
        district: 'Quận Long Biên',
        city: 'Hà Nội',
        postal_code: '100000',
        cutoff_time: '16:30',
      },
    ],
  },
};

export const SENSITIVE_IMPORT_AUDIT_FIELDS = new Set([
  'contact_phone',
  'contact_email',
  'phone',
  'email',
]);
