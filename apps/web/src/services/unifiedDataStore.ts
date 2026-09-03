// ============================================================================
// Ship Dễ — Unified Data Store (Single Source of Truth)
// Bảm bảo 100% tính nhất quán dữ liệu giữa Dashboard, Vận Đơn, Cứu Đơn, Đối Soát & Ba Sổ
// ============================================================================

import {
  UIExceptionItem,
  UIDiscrepancyItem,
  UIClaimItem,
  UIReturnScanItem,
  UITimelineEvent,
} from '@/components/types';
import { ShipmentStatus, CarrierCode } from '@/types/domain';

export interface UnifiedShipment {
  id: string;
  tracking_code: string;
  order_code: string;
  carrier_code: 'GHN' | 'GHTK';
  carrier_account: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  destination_province: string;
  cod_amount: number;
  quoted_fee: number;
  declared_weight_g: number;
  charged_weight_g?: number;
  status:
    | 'picking'
    | 'in_transit'
    | 'out_for_delivery'
    | 'delivered'
    | 'delivery_fail'
    | 'stuck_in_transit'
    | 'returning'
    | 'returned';
  match_status: 'matched_exact' | 'matched_fuzzy' | 'unmatched';
  warehouse_id: string;
  created_at: string;
  updated_at: string;
  has_open_exception: boolean;
  has_open_discrepancy: boolean;
  has_open_claim: boolean;
  timeline: {
    title: string;
    description: string;
    occurred_at: string;
    source_label: string;
  }[];
}

export const MASTER_SHIPMENTS: UnifiedShipment[] = [
  {
    id: 'shp_001',
    tracking_code: 'GHN88291042',
    order_code: 'ORD_ANAN_1042',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Nguyễn Văn Hùng',
    recipient_phone: '0912345678',
    recipient_address: '142 Hai Bà Trưng, P. Tân Định, Quận 1',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 450000,
    quoted_fee: 22000,
    declared_weight_g: 350,
    charged_weight_g: 850,
    status: 'delivery_fail',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-16T08:30:00Z',
    updated_at: '2026-08-17T08:30:00Z',
    has_open_exception: true,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Tạo đơn và gửi thông tin lấy hàng',
        description: 'Đơn hàng được đồng bộ tự động từ Pancake POS',
        occurred_at: '16/08/2026 08:30',
        source_label: 'Pancake POS',
      },
      {
        title: 'Bưu tá đã nhận hàng tại kho Tân Bình',
        description: 'Bưu tá Nguyễn Văn Cường (0938112233) tiếp nhận kiện',
        occurred_at: '16/08/2026 10:15',
        source_label: 'GHN Express',
      },
      {
        title: 'Giao hàng không thành công lần 1',
        description: 'Khách không nghe máy, bưu tá lưu kho chuẩn bị giao lại',
        occurred_at: '17/08/2026 08:30',
        source_label: 'Hãng GHN',
      },
    ],
  },
  {
    id: 'shp_002',
    tracking_code: 'GHTK77129031',
    order_code: 'ORD_ANAN_1088',
    carrier_code: 'GHTK',
    carrier_account: 'GHTK Trụ Sở Q3',
    recipient_name: 'Trần Thị Mai',
    recipient_phone: '0988776655',
    recipient_address: 'Số 45 Ngõ 12 Đội Cấn, Ba Đình',
    destination_province: 'Hà Nội',
    cod_amount: 720000,
    quoted_fee: 34000,
    declared_weight_g: 500,
    status: 'delivery_fail',
    match_status: 'matched_exact',
    warehouse_id: 'store_01',
    created_at: '2026-08-16T09:15:00Z',
    updated_at: '2026-08-17T09:15:00Z',
    has_open_exception: true,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'Đã nhận đơn từ hệ thống bán lẻ',
        description: 'Đơn hàng sẵn sàng lấy',
        occurred_at: '16/08/2026 09:15',
        source_label: 'Ship Dễ System',
      },
      {
        title: 'Giao hàng thất bại lần 1',
        description: 'Sai số nhà, khách hẹn chiều giao lại',
        occurred_at: '17/08/2026 09:15',
        source_label: 'GHTK Partner',
      },
    ],
  },
  {
    id: 'shp_003',
    tracking_code: 'GHN88291190',
    order_code: 'ORD_ANAN_1120',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Lê Hoàng Long',
    recipient_phone: '0903332211',
    recipient_address: '88 Nguyễn Thị Minh Khai, Quận 3',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 300000,
    quoted_fee: 22000,
    declared_weight_g: 250,
    status: 'stuck_in_transit',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-15T14:00:00Z',
    updated_at: '2026-08-17T10:00:00Z',
    has_open_exception: true,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'Đang trung chuyển qua bưu cục trung tâm',
        description: 'Kiện hàng lưu kho quá 24h chưa xuất bưu cục phát',
        occurred_at: '16/08/2026 14:00',
        source_label: 'GHN Hub',
      },
    ],
  },
  {
    id: 'shp_004',
    tracking_code: 'GHTK77129555',
    order_code: 'ORD_ANAN_1204',
    carrier_code: 'GHTK',
    carrier_account: 'GHTK Trụ Sở Q3',
    recipient_name: 'Hoàng Minh Quân',
    recipient_phone: '0938114477',
    recipient_address: '15 Lê Duẩn, Bến Nghé, Quận 1',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 520000,
    quoted_fee: 24000,
    declared_weight_g: 400,
    status: 'picking',
    match_status: 'matched_exact',
    warehouse_id: 'store_01',
    created_at: '2026-08-17T07:00:00Z',
    updated_at: '2026-08-17T11:00:00Z',
    has_open_exception: true,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'Chờ bưu tá lấy hàng',
        description: 'Đã báo lấy hàng quá 12h chưa có bưu tá nhận',
        occurred_at: '17/08/2026 07:00',
        source_label: 'GHTK System',
      },
    ],
  },
  {
    id: 'shp_005',
    tracking_code: 'GHN88291255',
    order_code: 'ORD_ANAN_1199',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Phạm Quỳnh Nga',
    recipient_phone: '0977112233',
    recipient_address: '320 Cầu Giấy, P. Quan Hoa, Cầu Giấy',
    destination_province: 'Hà Nội',
    cod_amount: 600000,
    quoted_fee: 32000,
    declared_weight_g: 450,
    status: 'delivered',
    match_status: 'matched_exact',
    warehouse_id: 'store_03',
    created_at: '2026-08-14T10:15:00Z',
    updated_at: '2026-08-16T16:20:00Z',
    has_open_exception: false,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'CSKH can thiệp hẹn lại giờ giao',
        description: 'Đã gọi khách và điều hướng bưu tá giao ca chiều',
        occurred_at: '15/08/2026 14:00',
        source_label: 'Ship Dễ CSKH',
      },
      {
        title: 'Giao hàng thành công',
        description: 'Người nhận đã thanh toán COD 600.000 đ',
        occurred_at: '16/08/2026 16:20',
        source_label: 'GHN Shipper',
      },
    ],
  },
  {
    id: 'shp_006',
    tracking_code: 'GHN88291002',
    order_code: 'ORD_ANAN_0902',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Lê Văn Nam',
    recipient_phone: '0918882211',
    recipient_address: '22 Pasteur, Bến Nghé, Quận 1',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 420000,
    quoted_fee: 22000,
    declared_weight_g: 300,
    status: 'delivered',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-12T09:00:00Z',
    updated_at: '2026-08-14T14:30:00Z',
    has_open_exception: false,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Giao thành công',
        description: 'Đã thu tiền COD',
        occurred_at: '14/08/2026 14:30',
        source_label: 'GHN',
      },
    ],
  },
  {
    id: 'shp_007',
    tracking_code: 'GHTK77129003',
    order_code: 'ORD_ANAN_0903',
    carrier_code: 'GHTK',
    carrier_account: 'GHTK Trụ Sở Q3',
    recipient_name: 'Vũ Thu Trang',
    recipient_phone: '0933445566',
    recipient_address: '102 Hoàng Văn Thụ, Hải Châu',
    destination_province: 'Đà Nẵng',
    cod_amount: 850000,
    quoted_fee: 34000,
    declared_weight_g: 600,
    status: 'delivered',
    match_status: 'matched_exact',
    warehouse_id: 'store_04',
    created_at: '2026-08-10T10:00:00Z',
    updated_at: '2026-08-12T15:00:00Z',
    has_open_exception: false,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Giao thành công',
        description: 'Đã hoàn tất phát hàng',
        occurred_at: '12/08/2026 15:00',
        source_label: 'GHTK',
      },
    ],
  },
  {
    id: 'shp_008',
    tracking_code: 'GHN88291004',
    order_code: 'ORD_ANAN_0904',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Đặng Quốc Bảo',
    recipient_phone: '0909998877',
    recipient_address: '45 Phan Xích Long, Phú Nhuận',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 550000,
    quoted_fee: 22000,
    declared_weight_g: 350,
    status: 'delivered',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-11T11:00:00Z',
    updated_at: '2026-08-13T16:00:00Z',
    has_open_exception: false,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Giao thành công',
        description: 'Shipper thu tiền COD 500k thay vì 550k',
        occurred_at: '13/08/2026 16:00',
        source_label: 'GHN',
      },
    ],
  },
  {
    id: 'shp_009',
    tracking_code: 'GHN88291005',
    order_code: 'ORD_ANAN_0905',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Ngô Thanh Vân',
    recipient_phone: '0944112233',
    recipient_address: '18 Lý Tự Trọng, Bến Nghé, Quận 1',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 1200000,
    quoted_fee: 22000,
    declared_weight_g: 400,
    status: 'delivered',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-01T09:00:00Z',
    updated_at: '2026-08-03T14:00:00Z',
    has_open_exception: false,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Giao thành công',
        description: 'Đơn giao 14 ngày trước nhưng chưa chuyển tiền COD',
        occurred_at: '03/08/2026 14:00',
        source_label: 'GHN',
      },
    ],
  },
  {
    id: 'shp_010',
    tracking_code: 'GHTK77129006',
    order_code: 'ORD_ANAN_0906',
    carrier_code: 'GHTK',
    carrier_account: 'GHTK Trụ Sở Q3',
    recipient_name: 'Phan Anh Đức',
    recipient_phone: '0966554433',
    recipient_address: '77 Trần Phú, Ba Đình',
    destination_province: 'Hà Nội',
    cod_amount: 680000,
    quoted_fee: 34000,
    declared_weight_g: 500,
    status: 'delivered',
    match_status: 'matched_fuzzy',
    warehouse_id: 'store_01',
    created_at: '2026-08-05T08:30:00Z',
    updated_at: '2026-08-08T11:00:00Z',
    has_open_exception: false,
    has_open_discrepancy: true,
    has_open_claim: false,
    timeline: [
      {
        title: 'Giao thành công',
        description: 'Vắng mặt trong sao kê tuần của hãng',
        occurred_at: '08/08/2026 11:00',
        source_label: 'GHTK',
      },
    ],
  },
  {
    id: 'shp_011',
    tracking_code: 'GHN88290111',
    order_code: 'ORD_ANAN_0811',
    carrier_code: 'GHN',
    carrier_account: 'GHN Kho Tân Bình',
    recipient_name: 'Hoàng Văn Hậu',
    recipient_phone: '0977889900',
    recipient_address: '55 CMT8, Phường 5, Tân Bình',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 320000,
    quoted_fee: 22000,
    declared_weight_g: 300,
    status: 'returned',
    match_status: 'matched_exact',
    warehouse_id: 'store_02',
    created_at: '2026-08-08T09:00:00Z',
    updated_at: '2026-08-17T08:15:00Z',
    has_open_exception: false,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'Nhập hoàn kho Tân Bình',
        description: 'Thủ kho Phạm Văn Kho xác nhận kiện nguyên vẹn',
        occurred_at: '17/08/2026 08:15',
        source_label: 'Thủ kho Ship Dễ',
      },
    ],
  },
  {
    id: 'shp_012',
    tracking_code: 'GHTK77129002',
    order_code: 'ORD_ANAN_0812',
    carrier_code: 'GHTK',
    carrier_account: 'GHTK Trụ Sở Q3',
    recipient_name: 'Bùi Thị Dung',
    recipient_phone: '0911223344',
    recipient_address: '12 Nguyễn Trãi, Quận 5',
    destination_province: 'TP. Hồ Chí Minh',
    cod_amount: 480000,
    quoted_fee: 24000,
    declared_weight_g: 400,
    status: 'returned',
    match_status: 'matched_exact',
    warehouse_id: 'store_01',
    created_at: '2026-08-09T10:00:00Z',
    updated_at: '2026-08-17T08:30:00Z',
    has_open_exception: false,
    has_open_discrepancy: false,
    has_open_claim: true,
    timeline: [
      {
        title: 'Tiếp nhận hàng hoàn hư hỏng',
        description: 'Vỏ hộp rách, bể vỡ sản phẩm bên trong. Đã chụp ảnh bằng chứng',
        occurred_at: '17/08/2026 08:30',
        source_label: 'Thủ kho Ship Dễ',
      },
    ],
  },
];

// Generate 38 additional realistic active shipments to reach total of 50
for (let i = 13; i <= 50; i++) {
  const isGhn = i % 2 === 0;
  const isDelivered = i % 3 === 0;
  const isTransit = i % 3 === 1;
  const status: UnifiedShipment['status'] = isDelivered
    ? 'delivered'
    : isTransit
      ? 'in_transit'
      : 'out_for_delivery';

  MASTER_SHIPMENTS.push({
    id: `shp_${String(i).padStart(3, '0')}`,
    tracking_code: `${isGhn ? 'GHN8829' : 'GHTK7712'}${1000 + i}`,
    order_code: `ORD_ANAN_${1000 + i}`,
    carrier_code: isGhn ? 'GHN' : 'GHTK',
    carrier_account: isGhn ? 'GHN Kho Tân Bình' : 'GHTK Trụ Sở Q3',
    recipient_name: `Khách Hàng ${i}`,
    recipient_phone: `090${String(i).padStart(7, '0')}`,
    recipient_address: `${i * 3} Đường Số ${(i % 12) + 1}, Quận ${(i % 10) + 1}`,
    destination_province:
      i % 4 === 0
        ? 'Hà Nội'
        : i % 4 === 1
          ? 'TP. Hồ Chí Minh'
          : i % 4 === 2
            ? 'Đà Nẵng'
            : 'Cần Thơ',
    cod_amount: ((i % 5) + 1) * 150000,
    quoted_fee: isGhn ? 22000 : 24000,
    declared_weight_g: 300 + (i % 5) * 100,
    status,
    match_status: 'matched_exact',
    warehouse_id: i % 2 === 0 ? 'store_02' : 'store_01',
    created_at: `2026-08-${String(10 + (i % 7)).padStart(2, '0')}T08:00:00Z`,
    updated_at: `2026-08-${String(12 + (i % 5)).padStart(2, '0')}T14:00:00Z`,
    has_open_exception: false,
    has_open_discrepancy: false,
    has_open_claim: false,
    timeline: [
      {
        title: 'Tạo đơn thành công',
        description: 'Đã sẵn sàng lấy hàng',
        occurred_at: `12/08/2026 09:00`,
        source_label: 'Pancake POS',
      },
      {
        title: status === 'delivered' ? 'Giao thành công' : 'Đang vận chuyển',
        description: 'Cập nhật từ bưu cục phát',
        occurred_at: `14/08/2026 14:00`,
        source_label: isGhn ? 'GHN' : 'GHTK',
      },
    ],
  });
}

// ----------------------------------------------------------------------------
// UNIFIED EXCEPTIONS LIST (Linked 1-to-1 with Master Shipments)
// ----------------------------------------------------------------------------
export const MASTER_EXCEPTIONS: UIExceptionItem[] = [
  {
    id: 'exc_001',
    tracking_code: 'GHN88291042',
    order_code: 'ORD_ANAN_1042',
    carrier_code: 'GHN',
    recipient_name: 'Nguyễn Văn Hùng',
    recipient_phone: '0912345678',
    recipient_address: '142 Hai Bà Trưng, P. Tân Định, Quận 1, TP. Hồ Chí Minh',
    cod_amount: 450000,
    exception_type: 'DELIVERY_FAIL',
    status: 'OPEN',
    occurred_at: '17/08/2026 08:30',
    deadline_at: '17/08/2026 20:30',
    hours_remaining: 4,
    priority_score: 85,
    carrier_reason: 'Khách không nghe máy (Lần 1)',
    attempts: 1,
    version: 1,
  },
  {
    id: 'exc_002',
    tracking_code: 'GHTK77129031',
    order_code: 'ORD_ANAN_1088',
    carrier_code: 'GHTK',
    recipient_name: 'Trần Thị Mai',
    recipient_phone: '0988776655',
    recipient_address: 'Số 45 Ngõ 12 Đội Cấn, Ba Đình, Hà Nội',
    cod_amount: 720000,
    exception_type: 'DELIVERY_FAIL',
    status: 'OPEN',
    occurred_at: '17/08/2026 09:15',
    deadline_at: '17/08/2026 21:15',
    hours_remaining: 5,
    priority_score: 92,
    carrier_reason: 'Sai số nhà, khách hẹn chiều giao lại',
    attempts: 2,
    version: 1,
  },
  {
    id: 'exc_003',
    tracking_code: 'GHN88291190',
    order_code: 'ORD_ANAN_1120',
    carrier_code: 'GHN',
    recipient_name: 'Lê Hoàng Long',
    recipient_phone: '0903332211',
    recipient_address: '88 Nguyễn Thị Minh Khai, Quận 3, TP. Hồ Chí Minh',
    cod_amount: 300000,
    exception_type: 'STUCK_IN_TRANSIT',
    status: 'ASSIGNED',
    occurred_at: '16/08/2026 14:00',
    deadline_at: '18/08/2026 14:00',
    hours_remaining: 22,
    priority_score: 65,
    carrier_reason: 'Lưu kho quá 24h tại Kho Trung Chuyển Tân Bình',
    attempts: 0,
    assigned_to: 'Trần Thị Hoa (CSKH)',
    version: 1,
  },
  {
    id: 'exc_004',
    tracking_code: 'GHTK77129555',
    order_code: 'ORD_ANAN_1204',
    carrier_code: 'GHTK',
    recipient_name: 'Hoàng Minh Quân',
    recipient_phone: '0938114477',
    recipient_address: '15 Lê Duẩn, Bến Nghé, Quận 1, TP. Hồ Chí Minh',
    cod_amount: 520000,
    exception_type: 'PICKUP_DELAY',
    status: 'OPEN',
    occurred_at: '17/08/2026 07:00',
    deadline_at: '17/08/2026 19:00',
    hours_remaining: 3,
    priority_score: 78,
    carrier_reason: 'Quá 12h chưa có bưu tá tới lấy hàng',
    attempts: 0,
    version: 1,
  },
];

// ----------------------------------------------------------------------------
// UNIFIED DISCREPANCIES LIST (6 Phép Dò D1..D7)
// ----------------------------------------------------------------------------
export const MASTER_DISCREPANCIES: UIDiscrepancyItem[] = [
  {
    id: 'disc_001',
    tracking_code: 'GHN88291042',
    order_code: 'ORD_ANAN_1042',
    carrier_code: 'GHN',
    type: 'D1_WEIGHT',
    declared_value: 'Khai báo: 350g',
    charged_value: 'Hãng tính: 850g (+500g)',
    discrepancy_amount: 7000,
    status: 'OPEN',
    reason: 'Hãng tính vượt cân 500g dù kích thước kiện hàng chuẩn A6',
    created_by_user: 'usr_02', // Tạo bởi CSKH Hoa -> Test Maker-Checker
    version: 1,
  },
  {
    id: 'disc_002',
    tracking_code: 'GHN88291002',
    order_code: 'ORD_ANAN_0902',
    carrier_code: 'GHN',
    type: 'D2_FREIGHT',
    declared_value: 'Biểu giá: 22.000 đ',
    charged_value: 'Sao kê thu: 29.000 đ',
    discrepancy_amount: 7000,
    status: 'OPEN',
    reason: 'Thu cước vượt 7.000 đ so với biểu giá hợp đồng VIP 2026',
    created_by_user: 'usr_03',
    version: 1,
  },
  {
    id: 'disc_003',
    tracking_code: 'GHTK77129003',
    order_code: 'ORD_ANAN_0903',
    carrier_code: 'GHTK',
    type: 'D4_DUPLICATE_DEDUCTION',
    declared_value: 'Đã trừ cước ngày 12/08: 34.000 đ',
    charged_value: 'Sao kê trừ tiếp lần 2: 34.000 đ',
    discrepancy_amount: 34000,
    status: 'OPEN',
    reason: 'Khấu trừ phí vận chuyển 2 lần cho cùng một mã vận đơn',
    created_by_user: 'usr_03',
    version: 1,
  },
  {
    id: 'disc_004',
    tracking_code: 'GHN88291004',
    order_code: 'ORD_ANAN_0904',
    carrier_code: 'GHN',
    type: 'D5_COD_MISMATCH',
    declared_value: 'Tiền thu hộ đơn hàng: 550.000 đ',
    charged_value: 'Sao kê hãng trả: 500.000 đ',
    discrepancy_amount: 50000,
    status: 'OPEN',
    reason: 'Shipper bớt 50.000 đ tiền COD khi đối soát',
    created_by_user: 'usr_02',
    version: 1,
  },
  {
    id: 'disc_005',
    tracking_code: 'GHN88291005',
    order_code: 'ORD_ANAN_0905',
    carrier_code: 'GHN',
    type: 'D6_OVERDUE_COD',
    declared_value: 'Giao ngày 03/08/2026 (Quá hạn 11 ngày)',
    charged_value: 'Chưa có tiền COD trong sao kê: 1.200.000 đ',
    discrepancy_amount: 1200000,
    status: 'OPEN',
    reason: 'COD quá hạn thanh toán theo chu kỳ đối soát thứ Hai - thứ Năm',
    created_by_user: 'usr_03',
    version: 1,
  },
  {
    id: 'disc_006',
    tracking_code: 'GHTK77129006',
    order_code: 'ORD_ANAN_0906',
    carrier_code: 'GHTK',
    type: 'D7_MISSING_STATEMENT_ROW',
    declared_value: 'Đã giao thành công ngày 08/08',
    charged_value: 'Vắng mặt hoàn toàn trong file sao kê',
    discrepancy_amount: 680000,
    status: 'OPEN',
    reason: 'Thiếu dòng đối soát cho đơn đã giao thành công',
    created_by_user: 'usr_03',
    version: 1,
  },
];

// ----------------------------------------------------------------------------
// UNIFIED CLAIMS LIST
// ----------------------------------------------------------------------------
export const MASTER_CLAIMS: UIClaimItem[] = [
  {
    id: 'clm_001',
    tracking_code: 'GHTK77129002',
    claim_type: 'DAMAGED',
    requested_amount: 480000,
    accepted_amount: 0,
    recovered_amount: 0,
    status: 'SUBMITTED',
    deadline_at: '19/08/2026 08:35',
    hours_left: 48,
    carrier_ticket: 'TKT_GHTK_99182',
    evidence_count: 3,
  },
  {
    id: 'clm_002',
    tracking_code: 'GHN88290999',
    claim_type: 'LOST',
    requested_amount: 1500000,
    accepted_amount: 1500000,
    recovered_amount: 1500000,
    status: 'ACCEPTED',
    deadline_at: '10/08/2026 10:00',
    hours_left: 0,
    carrier_ticket: 'TKT_GHN_44812',
    evidence_count: 2,
  },
];

// ----------------------------------------------------------------------------
// SUMMARY METRICS HELPER (Always deterministic & unified)
// ----------------------------------------------------------------------------
export function getUnifiedMetrics() {
  const totalShipments = MASTER_SHIPMENTS.length; // 50
  const activeShipments = MASTER_SHIPMENTS.filter(
    (s) => s.status !== 'delivered' && s.status !== 'returned'
  ).length;
  const deliveredShipments = MASTER_SHIPMENTS.filter((s) => s.status === 'delivered').length;
  const failShipments = MASTER_SHIPMENTS.filter((s) => s.status === 'delivery_fail').length;
  const openExceptionsCount = MASTER_EXCEPTIONS.filter(
    (e) => e.status === 'OPEN' || e.status === 'ASSIGNED'
  ).length; // 4
  const openDiscrepanciesCount = MASTER_DISCREPANCIES.filter((d) => d.status === 'OPEN').length; // 6
  const totalDiscrepancyAmount = MASTER_DISCREPANCIES.filter((d) => d.status === 'OPEN').reduce(
    (sum, d) => sum + d.discrepancy_amount,
    0
  ); // 1,978,000 đ
  const urgentClaimsCount = MASTER_CLAIMS.filter(
    (c) => c.status === 'SUBMITTED' || c.status === 'IN_REVIEW'
  ).length; // 1

  return {
    totalShipments,
    activeShipments,
    deliveredShipments,
    failShipments,
    openExceptionsCount,
    openDiscrepanciesCount,
    totalDiscrepancyAmount,
    urgentClaimsCount,
  };
}
