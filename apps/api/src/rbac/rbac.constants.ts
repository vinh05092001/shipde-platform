/**
 * Canonical Platform Capability Permissions & System Roles (FEAT-RBAC-01)
 * Source of truth: docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md
 */

export interface CanonicalPermissionDefinition {
  code: string;
  name: string;
  description: string;
  category: 'IAM' | 'ORDERS' | 'SHIPMENTS' | 'RECONCILIATION' | 'CLAIMS' | 'AUDIT';
}

export const PLATFORM_PERMISSIONS: CanonicalPermissionDefinition[] = [
  // 1. IAM Domain
  {
    code: 'iam:shop_config',
    name: 'Cấu hình cửa hàng',
    description: 'Thiết lập thông tin cửa hàng, kho lấy hàng và kết nối kỹ thuật',
    category: 'IAM',
  },
  {
    code: 'iam:manage_users',
    name: 'Quản lý người dùng và vai trò',
    description: 'Mời thành viên, phân quyền vai trò và quản lý phiên đăng nhập',
    category: 'IAM',
  },
  {
    code: 'iam:connect_observe_token',
    name: 'Kết nối token hãng vận chuyển',
    description: 'Thêm và cập nhật API token L0 Observe của các hãng vận chuyển',
    category: 'IAM',
  },
  {
    code: 'iam:grant_action_permission',
    name: 'Cấp quyền hành động hãng',
    description: 'Ủy quyền cho nhân viên gửi lệnh L2 Execute trực tiếp tới hãng',
    category: 'IAM',
  },

  // 2. Orders Domain
  {
    code: 'order:view_create',
    name: 'Xem và tạo đơn hàng gốc',
    description: 'Xem danh sách, chi tiết và tạo mới đơn hàng từ các kênh bán',
    category: 'ORDERS',
  },

  // 3. Shipments Domain
  {
    code: 'shipment:quote_carrier',
    name: 'Tra cứu giá và chọn hãng',
    description: 'Tính phí vận chuyển dự kiến và lựa chọn hãng giao tối ưu',
    category: 'SHIPMENTS',
  },
  {
    code: 'shipment:create_update',
    name: 'Tạo và cập nhật vận đơn',
    description: 'Tạo mã vận đơn hãng, đổi thông tin kiện hàng và địa chỉ giao',
    category: 'SHIPMENTS',
  },
  {
    code: 'shipment:cancel_redeliver',
    name: 'Hủy đơn và yêu cầu giao lại',
    description: 'Gửi yêu cầu hủy vận đơn hoặc kích hoạt giao lại (cứu đơn)',
    category: 'SHIPMENTS',
  },
  {
    code: 'shipment:print_handover',
    name: 'In phiếu và bàn giao hàng',
    description: 'In tem nhãn kiện hàng và xác nhận biên bản bàn giao tài xế',
    category: 'SHIPMENTS',
  },
  {
    code: 'shipment:track_exceptions',
    name: 'Theo dõi hành trình và ngoại lệ',
    description: 'Xem timeline vận chuyển và tiếp nhận ca xử lý sự cố giao hàng',
    category: 'SHIPMENTS',
  },
  {
    code: 'shipment:receive_return',
    name: 'Nhận hàng hoàn và quét bằng chứng',
    description: 'Kiểm đếm kiện hàng hoàn, ghi nhận hư hỏng và đối soát kiện trả',
    category: 'SHIPMENTS',
  },

  // 4. Reconciliation Domain
  {
    code: 'reconciliation:view_contract_rates',
    name: 'Xem bảng giá hợp đồng',
    description: 'Tra cứu bảng giá cước đã ký kết và các mốc chiết khấu hãng',
    category: 'RECONCILIATION',
  },
  {
    code: 'reconciliation:author_rate_policy',
    name: 'Soạn thảo bảng giá và chính sách',
    description: 'Soạn biểu phí vận chuyển nội bộ và ngưỡng phát hiện sai lệch (Maker)',
    category: 'RECONCILIATION',
  },
  {
    code: 'reconciliation:approve_rate_policy',
    name: 'Phê duyệt chính sách đối soát',
    description: 'Phê duyệt bảng giá và quy tắc đối soát do nhân viên soạn (Checker)',
    category: 'RECONCILIATION',
  },
  {
    code: 'reconciliation:import_settlement_bank',
    name: 'Nhập bảng kê và sao kê ngân hàng',
    description: 'Tải lên bảng kê COD/cước hãng và file sao kê tài khoản ngân hàng',
    category: 'RECONCILIATION',
  },
  {
    code: 'reconciliation:run_review_audit',
    name: 'Chạy và đối chiếu kiểm toán',
    description: 'Kích hoạt khớp 6 quy tắc đối soát và rà soát các ca lệch cước/COD',
    category: 'RECONCILIATION',
  },
  {
    code: 'reconciliation:allocate_bank_receipt',
    name: 'Phân bổ dòng tiền thực nhận',
    description: 'Khớp số tiền tiền về từ ngân hàng vào kỳ đối soát tương ứng',
    category: 'RECONCILIATION',
  },

  // 5. Claims Domain
  {
    code: 'claim:verify_submit',
    name: 'Xác minh và nộp hồ sơ khiếu nại',
    description: 'Tập hợp chứng từ, ảnh đóng gói và nộp khiếu nại đền bù lên hãng',
    category: 'CLAIMS',
  },

  // 6. Audit & Sensitive Access Domain
  {
    code: 'pii:unmask',
    name: 'Mở che thông tin khách hàng (PII)',
    description: 'Xem đầy đủ số điện thoại và địa chỉ người nhận (có ghi nhật ký kiểm toán)',
    category: 'AUDIT',
  },
  {
    code: 'audit:view',
    name: 'Xem nhật ký kiểm toán bất biến',
    description: 'Tra cứu lịch sử thao tác hệ thống, thay đổi vai trò và hành động nhân viên',
    category: 'AUDIT',
  },
];

export interface SystemRoleDefinition {
  code: 'OWNER' | 'OPS_CSKH' | 'WAREHOUSE' | 'ACCOUNTANT' | 'FINANCE';
  name: string;
  description: string;
  permissions: string[];
}

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    code: 'OWNER',
    name: 'Chủ Shop (Owner)',
    description: 'Toàn quyền điều hành, phân quyền nhân sự và cấu hình tổ chức',
    // Owner possesses all 20 canonical capability permissions
    permissions: PLATFORM_PERMISSIONS.map((p) => p.code),
  },
  {
    code: 'OPS_CSKH',
    name: 'Vận Hành & CSKH (Ops/CSKH)',
    description: 'Tiếp nhận đơn hàng, tra cứu giá, cứu đơn và mở che SĐT khách khi xử lý sự cố',
    permissions: [
      'order:view_create',
      'shipment:quote_carrier',
      'shipment:create_update',
      'shipment:cancel_redeliver',
      'shipment:track_exceptions',
      'pii:unmask',
    ],
  },
  {
    code: 'WAREHOUSE',
    name: 'Thủ Kho (Warehouse)',
    description: 'In phiếu giao hàng, bàn giao hàng cho bưu tá và quét nhận hàng hoàn về kho',
    permissions: [
      'order:view_create',
      'shipment:print_handover',
      'shipment:receive_return',
      'shipment:track_exceptions',
    ],
  },
  {
    code: 'ACCOUNTANT',
    name: 'Kế Toán Đối Soát (Accountant)',
    description: 'Nhập bảng kê hãng, chạy kiểm toán đối soát, lập hồ sơ khiếu nại (Maker)',
    permissions: [
      'order:view_create',
      'shipment:quote_carrier',
      'reconciliation:view_contract_rates',
      'reconciliation:import_settlement_bank',
      'reconciliation:run_review_audit',
      'reconciliation:allocate_bank_receipt',
      'claim:verify_submit',
      'pii:unmask',
      'audit:view',
    ],
  },
  {
    code: 'FINANCE',
    name: 'Tài Chính Phê Duyệt (Finance)',
    description:
      'Phê duyệt chính sách bảng giá, duyệt giải tỏa sai lệch tài chính và kiểm tra dòng tiền (Checker)',
    permissions: [
      'reconciliation:view_contract_rates',
      'reconciliation:approve_rate_policy',
      'reconciliation:import_settlement_bank',
      'reconciliation:run_review_audit',
      'reconciliation:allocate_bank_receipt',
      'claim:verify_submit',
      'audit:view',
    ],
  },
];
