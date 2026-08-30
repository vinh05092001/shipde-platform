// ============================================================================
// Ship Dễ — Core Domain Entities & Types (Tập 1, 2, 3)
// ============================================================================

export type CurrencyAmount = number; // Số nguyên đơn vị VNĐ (Ví dụ: 30000 = 30,000 VND)
export type WeightGram = number; // Gram (Ví dụ: 500 = 0.5kg)

import {
  UserRole,
  Role,
  CarrierCode,
  CarrierCapabilityTier,
  ShipmentStatus,
  ExceptionType,
  ExceptionCaseStatus,
  DiscrepancyType,
  DiscrepancyResolution,
  MatchingStatus,
} from '@shipde/contracts';

export {
  UserRole,
  Role,
  CarrierCode,
  CarrierCapabilityTier,
  ShipmentStatus,
  ExceptionType,
  ExceptionCaseStatus,
  DiscrepancyType,
  DiscrepancyResolution,
  MatchingStatus,
};

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
