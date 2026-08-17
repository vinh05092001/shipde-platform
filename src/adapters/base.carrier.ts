// ============================================================================
// Ship Dễ — Base Carrier Adapter Contract (Tập 1 Mục 5, Tập 2 CN-04..06)
// Phân tầng năng lực L0/L1/L2 & Xử lý mã lỗi chuẩn
// ============================================================================

import { CarrierCapabilityTier, CarrierCode, ShipmentStatus, CurrencyAmount, WeightGram } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export interface CarrierTrackingResult {
  tracking_code: string;
  raw_status: string;
  normalized_status: ShipmentStatus;
  occurred_at: Date;
  location?: string;
  raw_reason?: string;
  charged_weight_g?: WeightGram;
  charged_fee?: CurrencyAmount;
  cod_amount?: CurrencyAmount;
  cod_collected?: CurrencyAmount;
  raw_payload: Record<string, unknown>;
}

export interface ReattemptRequestPayload {
  tracking_code: string;
  scheduled_date?: Date;
  new_recipient_phone?: string;
  note: string;
  idempotency_key: string;
}

export interface ReattemptResponse {
  success: boolean;
  reference_id?: string;
  scheduled_at?: Date;
  tier_executed: CarrierCapabilityTier;
  instruction_note?: string; // Dành cho L1 khi xuất hồ sơ hỗ trợ
}

export interface CreateTicketRequestPayload {
  tracking_code: string;
  claim_type: string;
  requested_amount: CurrencyAmount;
  description: string;
  evidence_urls: string[];
}

export interface CreateTicketResponse {
  ticket_id?: string;
  status: string;
  tier_executed: CarrierCapabilityTier;
  portal_export_package_url?: string;
}

export abstract class BaseCarrierAdapter {
  public abstract readonly carrierCode: CarrierCode;
  public abstract readonly defaultTier: CarrierCapabilityTier;

  /**
   * Tra cứu trạng thái chi tiết theo mã vận đơn
   */
  public abstract trackShipment(
    trackingCode: string,
    credentials: Record<string, string>
  ): Promise<CarrierTrackingResult>;

  /**
   * Yêu cầu giao lại đơn hàng (Reattempt)
   * Với L2 (GHN): Gọi API trực tiếp
   * Với L1 (GHTK): Trả về hồ sơ chuẩn bị kèm 501 / hướng dẫn xuất cổng hãng (BR-26, BR-44)
   */
  public abstract requestReattempt(
    payload: ReattemptRequestPayload,
    credentials: Record<string, string>,
    overrideTier?: CarrierCapabilityTier
  ): Promise<ReattemptResponse>;

  /**
   * Tạo khiếu nại / ticket
   */
  public abstract createTicket(
    payload: CreateTicketRequestPayload,
    credentials: Record<string, string>,
    overrideTier?: CarrierCapabilityTier
  ): Promise<CreateTicketResponse>;

  /**
   * Chuẩn hóa mã trạng thái hãng sang trạng thái chuẩn Ship Dễ (BR-03, BR-04)
   */
  public abstract normalizeStatus(rawStatus: string): ShipmentStatus;
}
