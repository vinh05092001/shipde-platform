// ============================================================================
// Ship Dễ — GHTK Carrier Adapter (Giao Hàng Tiết Kiệm - Tier L1 Assist)
// Tập 1 Mục 5, Tập 2 CN-04, CN-06, CN-10, CN-17
// ============================================================================

import {
  BaseCarrierAdapter,
  CarrierTrackingResult,
  ReattemptRequestPayload,
  ReattemptResponse,
  CreateTicketRequestPayload,
  CreateTicketResponse,
} from './base.carrier';
import { CarrierCapabilityTier, CarrierCode, ShipmentStatus } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export class GhtkCarrierAdapter extends BaseCarrierAdapter {
  public readonly carrierCode = CarrierCode.GHTK;
  public readonly defaultTier = CarrierCapabilityTier.L1_ASSIST;

  public normalizeStatus(rawStatus: string): ShipmentStatus {
    const code = rawStatus.toString().trim();
    switch (code) {
      case '1': // Chưa tiếp nhận
      case '2': // Đã tiếp nhận
        return ShipmentStatus.PICKING;

      case '3': // Đã lấy hàng / Đang lưu kho
      case '12': // Đang luân chuyển
        return ShipmentStatus.IN_TRANSIT;

      case '4': // Đang giao hàng
      case '7': // Không liên lạc được
      case '8': // Delay giao hàng
        return ShipmentStatus.OUT_FOR_DELIVERY;

      case '5': // Đã giao hàng
      case '6': // Đã đối soát
        return ShipmentStatus.DELIVERED;

      case '9': // Không giao được / Chờ duyệt hoàn
      case '10': // Delay trả hàng
      case '11': // Đang trả hàng
        return ShipmentStatus.RETURNING;

      case '21': // Đã trả hàng
        return ShipmentStatus.RETURNED;

      case '-1': // Hủy đơn
        return ShipmentStatus.CANCELLED;

      case '20': // Thất lạc
        return ShipmentStatus.LOST;

      case '13': // Hư hỏng
        return ShipmentStatus.DAMAGED;

      default:
        return ShipmentStatus.IN_TRANSIT;
    }
  }

  public async trackShipment(
    trackingCode: string,
    credentials: Record<string, string>
  ): Promise<CarrierTrackingResult> {
    if (!credentials.token) {
      throw new ShipDeAppError(ERROR_CATALOG.CARRIER_AUTH_FAILED, {
        carrier: 'GHTK',
        reason: 'Missing GHTK API Token',
      });
    }

    const occurredAt = new Date();
    return {
      tracking_code: trackingCode,
      raw_status: '4',
      normalized_status: ShipmentStatus.OUT_FOR_DELIVERY,
      occurred_at: occurredAt,
      location: 'Kho GHTK Cầu Giấy, Hà Nội',
      raw_payload: {
        order: {
          label_id: trackingCode,
          status: '4',
          status_text: 'Đang giao hàng',
          created: occurredAt.toISOString(),
        },
      },
    };
  }

  public async requestReattempt(
    payload: ReattemptRequestPayload,
    credentials: Record<string, string>,
    activeTier: CarrierCapabilityTier = this.defaultTier
  ): Promise<ReattemptResponse> {
    // GHTK ở R1 là L1 Assist: Không gọi API reattempt vì API công khai không có endpoint này.
    // Trả về gói hồ sơ hỗ trợ và hướng dẫn cho shop thực hiện tại portal khachhang.giaohangtietkiem.vn (BR-44)
    return {
      success: true,
      tier_executed: CarrierCapabilityTier.L1_ASSIST,
      instruction_note: `[GHTK L1 Assist] Đã chuẩn bị hồ sơ hẹn giao lại cho đơn ${payload.tracking_code} (Lý do: ${payload.note}). Vui lòng bấm gửi tại khachhang.giaohangtietkiem.vn`,
    };
  }

  public async createTicket(
    payload: CreateTicketRequestPayload,
    credentials: Record<string, string>,
    activeTier: CarrierCapabilityTier = this.defaultTier
  ): Promise<CreateTicketResponse> {
    // GHTK L1: Xuất gói chứng từ hồ sơ chuẩn bị sẵn
    return {
      status: 'ASSIST_PACKAGE_GENERATED',
      tier_executed: CarrierCapabilityTier.L1_ASSIST,
      portal_export_package_url: `https://storage.shipde.net/evidence/ghtk_claim_${payload.tracking_code}.zip`,
    };
  }
}
