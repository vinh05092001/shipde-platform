// ============================================================================
// Ship Dễ — Core Domain Entities & Types (Tập 1, 2, 3)
// ============================================================================

export type CurrencyAmount = number; // Số nguyên đơn vị VNĐ (Ví dụ: 30000 = 30,000 VND)
export type WeightGram = number; // Gram (Ví dụ: 500 = 0.5kg)

export enum UserRole {
  OWNER = 'OWNER', // Chủ shop
  OPS_CSKH = 'OPS_CSKH', // Vận hành / Chăm sóc khách hàng
  WAREHOUSE = 'WAREHOUSE', // Nhân viên kho
  ACCOUNTANT = 'ACCOUNTANT', // Kế toán
}

export enum CarrierCode {
  GHN = 'GHN',
  GHTK = 'GHTK',
  VIETTEL_POST = 'VIETTEL_POST',
  JT = 'JT',
}

export enum CarrierCapabilityTier {
  L0_OBSERVE = 'L0', // Chỉ quan sát: trạng thái, cước, COD (Không đủ làm hãng chính)
  L1_ASSIST = 'L1', // Ship Dễ chuẩn bị hồ sơ/checklist, shop bấm gửi trên portal (GHTK R1)
  L2_EXECUTE = 'L2', // Ship Dễ gọi API trực tiếp, webhook & callback (GHN R1)
}

export enum ShipmentStatus {
  DRAFT = 'draft',
  PICKING = 'picking',
  IN_TRANSIT = 'in_transit',
  OUT_FOR_DELIVERY = 'out_for_delivery',
  DELIVERED = 'delivered', // Trạng thái kết thúc
  RETURNING = 'returning',
  RETURNED = 'returned', // Trạng thái kết thúc
  CANCELLED = 'cancelled', // Trạng thái kết thúc
  LOST = 'lost', // Trạng thái kết thúc
  DAMAGED = 'damaged', // Trạng thái kết thúc
}

export enum ExceptionType {
  PICKUP_DELAY = 'pickup_delay', // Chậm lấy hàng
  STUCK_IN_TRANSIT = 'stuck_in_transit', // Đứng trạng thái quá lâu
  DELIVERY_FAIL = 'delivery_fail', // Giao hàng không thành công
  STATUS_MISMATCH = 'status_mismatch', // Sai lệch trạng thái
}

export enum ExceptionCaseStatus {
  OPEN = 'open',
  ASSIGNED = 'assigned',
  CONTACTING = 'contacting',
  WAITING_CUSTOMER = 'waiting_customer',
  REATTEMPT_REQUESTED = 'reattempt_requested',
  WAITING_REATTEMPT = 'waiting_reattempt',
  RESCUED = 'rescued', // Trạng thái kết thúc thành công (vào Sổ 2)
  RETURNING = 'returning',
  RETURNED = 'returned', // Trạng thái kết thúc thất bại
  UNRESOLVED = 'unresolved', // Trạng thái kết thúc
}

export enum DiscrepancyType {
  D1_WEIGHT = 'D1_WEIGHT', // Lệch cân tính phí
  D2_FREIGHT = 'D2_FREIGHT', // Lệch cước vận chuyển so với biểu giá
  D3_SURCHARGE = 'D3_SURCHARGE', // Phụ phí vùng xa (Hoãn sang R2)
  D4_DUPLICATE_DEDUCTION = 'D4_DUPLICATE', // Khấu trừ trùng cùng mã vận đơn & loại phí
  D5_COD_MISMATCH = 'D5_COD_MISMATCH', // Lệch tiền thu hộ COD
  D6_OVERDUE_COD = 'D6_OVERDUE_COD', // COD quá hạn thanh toán
  D7_MISSING_STATEMENT_ROW = 'D7_MISSING', // Đơn đã giao nhưng thiếu dòng sao kê
}

export enum DiscrepancyResolution {
  OPEN = 'open', // Mới phát hiện, đang chờ xử lý
  CONFIRMED = 'confirm', // Chấp nhận số liệu hãng
  DISPUTE = 'dispute', // Mở hồ sơ khiếu nại (Chuyển sang CLM)
  WAIVE = 'waive', // Bỏ qua (yêu cầu lý do bắt buộc BR-22)
  CARRY_FORWARD = 'carry_forward', // Chuyển sang kỳ sau
  RESOLVED = 'resolved', // Đã giải quyết xong
}

export enum MatchingStatus {
  MATCHED_EXACT = 'matched_exact', // Khóa 1 (tracking) hoặc Khóa 2 (order_code)
  MATCHED_FUZZY = 'matched_fuzzy', // Khóa 3 (COD + ngày +/- 3 ngày)
  UNMATCHED = 'unmatched', // Không khớp -> vào hàng đợi ghép tay
  AMBIGUOUS = 'ambiguous', // 1 mã khớp nhiều đơn
}

export type Role = UserRole;
export const Role = UserRole;

export interface Merchant {
  id: string;
  name: string;
  code?: string;
  business_code?: string;
  phone?: string;
  email?: string;
  address?: string;
  subscription_plan?: string;
  created_at: Date;
  status: 'active' | 'suspended' | 'ACTIVE';
}

export interface User {
  id: string;
  merchant_id: string;
  email: string;
  full_name: string;
  phone: string;
  role: UserRole;
  store_scopes?: string[];
  warehouse_scopes?: string[];
  status?: 'active' | 'suspended' | 'ACTIVE';
  created_at: Date;
}

export interface CarrierAccount {
  id: string;
  merchant_id: string;
  carrier_code: CarrierCode;
  label?: string;
  account_name?: string;
  credentials?: Record<string, string>; // Luôn mã hóa khi lưu trữ
  credentials_masked?: string;
  tier?: CarrierCapabilityTier;
  capability_tier?: CarrierCapabilityTier;
  is_active?: boolean;
  status?: 'active' | 'pending_verification' | 'suspended';
  created_at: Date;
  expires_at?: Date;
}

export interface ReturnRecord {
  id: string;
  merchant_id: string;
  shipment_id: string;
  tracking_code: string;
  warehouse_id: string;
  condition: 'intact' | 'damaged' | 'wrong_item' | 'missing_accessories';
  scanned_at: Date;
  scanned_by: string;
  evidence_urls?: string[];
}

export interface RateCard {
  id: string;
  merchant_id: string;
  carrier_account_id: string;
  version: number;
  effective_from: Date;
  effective_to?: Date | null;
  volumetric_divisor: number; // 5000 hoặc 6000
  cod_payout_sla_days: number; // SLA số ngày chuyển COD (Ví dụ: 3 ngày)
  checksum: string;
  tiers: RateTier[];
}

export interface RateTier {
  id: string;
  rate_card_id: string;
  route_type: 'INTRA_PROVINCE' | 'INTER_PROVINCE' | 'SPECIAL';
  weight_from_g: WeightGram;
  weight_to_g: WeightGram;
  base_fee: CurrencyAmount;
  step_fee: CurrencyAmount;
  step_weight_g: WeightGram;
}

export interface Order {
  id: string;
  merchant_id: string;
  order_code: string;
  created_at: Date;
  cod_amount: CurrencyAmount;
  declared_weight_g: WeightGram;
  dimensions_cm?: { length: number; width: number; height: number };
  recipient_name: string;
  recipient_phone: string;
  recipient_province: string;
  recipient_address: string;
  item_value?: CurrencyAmount;
}

export interface Shipment {
  id: string;
  merchant_id: string;
  order_id: string;
  order_code: string;
  carrier_code: CarrierCode;
  carrier_account_id: string;
  tracking_code: string;
  current_status: ShipmentStatus;
  declared_weight_g: WeightGram;
  charged_weight_g?: WeightGram;
  dimensions_cm?: { length: number; width: number; height: number };
  quoted_fee: CurrencyAmount;
  charged_fee?: CurrencyAmount;
  cod_amount: CurrencyAmount;
  cod_collected?: CurrencyAmount;
  cod_paid_at?: Date | null;
  delivered_at?: Date | null;
  created_at: Date;
  version: number;
  last_modified_by?: string;
}

export interface ShipmentEvent {
  id: string;
  shipment_id: string;
  raw_status: string;
  normalized_status: ShipmentStatus;
  occurred_at: Date; // Thời điểm xảy ra sự kiện phía hãng
  received_at: Date; // Thời điểm Ship Dễ nhận sự kiện
  source: 'WEBHOOK' | 'POLLING';
  raw_payload?: Record<string, unknown>;
}

export interface ExceptionCase {
  id: string;
  merchant_id: string;
  shipment_id: string;
  tracking_code: string;
  exception_type: ExceptionType;
  status: ExceptionCaseStatus;
  assigned_to?: string;
  locked_until?: Date;
  deadline_at: Date;
  priority_score: number;
  carrier_raw_reason?: string;
  standard_reason?: string;
  created_at: Date;
  version: number;
  can_reattempt: boolean;
}

export interface CarrierStatement {
  id: string;
  merchant_id: string;
  carrier_account_id: string;
  period_start: Date;
  period_end: Date;
  checksum: string;
  total_rows: number;
  total_cod_collected: CurrencyAmount;
  total_fees: CurrencyAmount;
  status: 'DRAFT' | 'RECONCILED' | 'CLOSED';
  closed_at?: Date;
  closed_by?: string;
}

export interface StatementRow {
  id: string;
  statement_id: string;
  line_number: number;
  tracking_code: string;
  order_code?: string;
  fee_type: string;
  charged_weight_g: WeightGram;
  charged_fee: CurrencyAmount;
  cod_collected: CurrencyAmount;
  cod_paid_at?: Date;
  match_status: MatchingStatus;
  matched_shipment_id?: string;
  raw_data?: Record<string, unknown>;
}

export interface Discrepancy {
  id: string;
  merchant_id: string;
  statement_row_id?: string;
  shipment_id: string;
  tracking_code: string;
  type: DiscrepancyType;
  amount: CurrencyAmount;
  status: DiscrepancyResolution;
  reason?: string;
  created_by_user?: string;
  resolved_by?: string;
  resolved_at?: Date;
  evidence_files?: string[];
  version: number;
  created_at: Date;
}

export interface Claim {
  id: string;
  merchant_id: string;
  shipment_id: string;
  discrepancy_id?: string;
  claim_type: string;
  carrier_ticket?: string;
  requested_amount: CurrencyAmount;
  accepted_amount: CurrencyAmount;
  recovered_amount: CurrencyAmount;
  status: 'DRAFT' | 'SUBMITTED' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
  deadline_at: Date;
  evidence_pack_url?: string;
  created_at: Date;
  updated_at?: Date;
}
