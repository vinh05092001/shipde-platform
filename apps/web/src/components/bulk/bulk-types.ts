import {
  BulkEntityType,
  BulkActionType,
  BulkItemStatus,
  BulkBatchStatus,
  BulkErrorCode,
  BulkActionItemResult,
  BulkActionRequest,
  BulkActionResponseData,
  BulkActionResponse,
  isDestructiveBulkAction,
} from '@shipde/contracts';

export {
  BulkEntityType,
  BulkActionType,
  BulkItemStatus,
  BulkBatchStatus,
  BulkErrorCode,
  isDestructiveBulkAction,
};
export type { BulkActionItemResult, BulkActionRequest, BulkActionResponseData, BulkActionResponse };

/**
 * Resolves required permission code for bulk operations on an entity type.
 * Server-side RBAC requires 'iam:manage_users' for users and 'iam:shop_config' for branches/warehouses.
 */
export function resolveRequiredBulkPermission(entityType: string): string {
  if (entityType === BulkEntityType.USERS) {
    return 'iam:manage_users';
  }
  if (entityType === BulkEntityType.BRANCHES || entityType === BulkEntityType.WAREHOUSES) {
    return 'iam:shop_config';
  }
  return 'iam:manage_users';
}

/**
 * Evaluates whether an actor possesses the required permission.
 * UI edit rights come strictly from permissions, never hardcoded role names.
 * Unknown user (undefined or null) means no edit rights (BR-RBAC-01 / Rule 9).
 */
export function hasBulkActionPermission(
  userPermissions: string[] | undefined | null,
  entityType: string,
  isUserKnown: boolean
): boolean {
  if (!isUserKnown || !userPermissions) {
    return false;
  }
  // Wildcard grant
  if (userPermissions.includes('*') || userPermissions.includes('iam:*')) {
    return true;
  }
  const required = resolveRequiredBulkPermission(entityType);
  return userPermissions.includes(required);
}

/**
 * Vietnamese human-readable explanation for canonical bulk error codes.
 */
export function formatBulkErrorMessage(errorCode?: string, fallbackMessage?: string): string {
  switch (errorCode) {
    case BulkErrorCode.CANNOT_REMOVE_LAST_OWNER:
      return 'Không thể tạm ngưng hoặc gỡ bỏ Chủ Shop (OWNER) duy nhất của cửa hàng.';
    case BulkErrorCode.SELF_SUSPENSION_PROHIBITED:
      return 'Không thể tự tạm ngưng hoặc tự vô hiệu hóa tài khoản của chính bạn.';
    case BulkErrorCode.CANNOT_DEACTIVATE_DEFAULT_BRANCH:
      return 'Không thể tạm ngưng chi nhánh mặc định của cửa hàng. Vui lòng đặt chi nhánh khác làm mặc định trước.';
    case BulkErrorCode.CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE:
      return 'Không thể tạm ngưng kho hàng mặc định của cửa hàng. Vui lòng đặt kho khác làm mặc định trước.';
    case BulkErrorCode.SCOPE_FORBIDDEN:
      return 'Bạn không có quyền quản lý đối với phạm vi chi nhánh hoặc kho hàng của mục này.';
    case BulkErrorCode.FORBIDDEN:
      return 'Không có quyền thực hiện thao tác trên mục này.';
    case BulkErrorCode.ITEM_NOT_FOUND:
      return 'Không tìm thấy mục trong phạm vi cửa hàng của bạn.';
    case BulkErrorCode.PRIVILEGE_CEILING_EXCEEDED:
      return 'Không thể gán phạm vi vượt quá trần quyền hạn mà bạn đang nắm giữ.';
    case BulkErrorCode.CONFIRMATION_REQUIRED:
      return 'Thao tác có tính chất phá hủy bắt buộc phải có bước xác nhận rõ ràng.';
    case BulkErrorCode.MAX_ITEMS_EXCEEDED:
      return 'Vượt quá số lượng mục tối đa cho phép trong một lần xử lý.';
    case BulkErrorCode.EMPTY_ID_LIST:
      return 'Danh sách mục xử lý không được để trống.';
    default:
      return fallbackMessage || 'Đã xảy ra lỗi khi thực thi mục này.';
  }
}

export interface WarehouseItem {
  id: string;
  code: string;
  name: string;
  contact_name: string;
  contact_phone: string;
  address_line: string;
  district: string;
  city: string;
  is_default: boolean;
  status: 'active' | 'suspended';
}

export const DEFAULT_WAREHOUSES: WarehouseItem[] = [
  {
    id: 'wh-main-01',
    code: 'WH-HCM-01',
    name: 'Kho Tổng TP.HCM (Tân Bình)',
    contact_name: 'Phạm Văn Kho',
    contact_phone: '0909876543',
    address_line: '123 Cộng Hòa, Phường 12',
    district: 'Quận Tân Bình',
    city: 'Hồ Chí Minh',
    is_default: true,
    status: 'active',
  },
  {
    id: 'wh-north-02',
    code: 'WH-HN-02',
    name: 'Kho Phân Phối Hà Nội (Cầu Giấy)',
    contact_name: 'Trần Văn Bắc',
    contact_phone: '0912345678',
    address_line: '45 Duy Tân, Dịch Vọng Hậu',
    district: 'Quận Cầu Giấy',
    city: 'Hà Nội',
    is_default: false,
    status: 'active',
  },
  {
    id: 'wh-danang-03',
    code: 'WH-DN-03',
    name: 'Kho Trung Chuyển Đà Nẵng',
    contact_name: 'Lê Văn Trung',
    contact_phone: '0934567890',
    address_line: '78 Nguyễn Tri Phương',
    district: 'Quận Thanh Khê',
    city: 'Đà Nẵng',
    is_default: false,
    status: 'active',
  },
  {
    id: 'wh-cantho-04',
    code: 'WH-CT-04',
    name: 'Kho Miền Tây Cần Thơ',
    contact_name: 'Nguyễn Văn Tây',
    contact_phone: '0945678901',
    address_line: '12 30 Tháng 4, An Lạc',
    district: 'Quận Ninh Kiều',
    city: 'Cần Thơ',
    is_default: false,
    status: 'suspended',
  },
];
