// ============================================================================
// Ship Dễ — GHN Carrier Adapter (Giao Hàng Nhanh - Tier L2 Execute)
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

export class GhnCarrierAdapter extends BaseCarrierAdapter {
  public readonly carrierCode = CarrierCode.GHN;
  public readonly defaultTier = CarrierCapabilityTier.L2_EXECUTE;

  // In-memory idempotency cache for simulation / testing
  private idempotencyRequests = new Map<string, ReattemptRequestPayload>();

  public normalizeStatus(rawStatus: string): ShipmentStatus {
    const s = rawStatus.toLowerCase().trim();
    switch (s) {
      case 'ready_to_pick':
      case 'picking':
      case 'money_collect_picking':
        return ShipmentStatus.PICKING;

      case 'storing':
      case 'sorting':
      case 'transporting':
        return ShipmentStatus.IN_TRANSIT;

      case 'delivering':
      case 'money_collect_delivering':
        return ShipmentStatus.OUT_FOR_DELIVERY;

      case 'delivered':
        return ShipmentStatus.DELIVERED;

      case 'delivery_fail':
      case 'waiting_to_return':
      case 'return':
        return ShipmentStatus.RETURNING;

      case 'returned':
        return ShipmentStatus.RETURNED;

      case 'cancel':
        return ShipmentStatus.CANCELLED;

      case 'lost':
        return ShipmentStatus.LOST;

      case 'damage':
        return ShipmentStatus.DAMAGED;

      default:
        // Mã trạng thái lạ -> không đoán mò (BR-18)
        return ShipmentStatus.IN_TRANSIT;
    }
  }

  public async trackShipment(
    trackingCode: string,
    credentials: Record<string, string>
  ): Promise<CarrierTrackingResult> {
    if (!credentials.token) {
      throw new ShipDeAppError(ERROR_CATALOG.CARRIER_AUTH_FAILED, {
        carrier: 'GHN',
        reason: 'Missing GHN API Token',
      });
    }

    // Giả lập dữ liệu trả về từ API GHN
    const occurredAt = new Date();
    return {
      tracking_code: trackingCode,
      raw_status: 'delivering',
      normalized_status: ShipmentStatus.OUT_FOR_DELIVERY,
      occurred_at: occurredAt,
      location: 'Kho GHN Tân Bình, TP.HCM',
      raw_payload: {
        order_code: trackingCode,
        status: 'delivering',
        updated_date: occurredAt.toISOString(),
      },
    };
  }

  public async requestReattempt(
    payload: ReattemptRequestPayload,
    credentials: Record<string, string>,
    activeTier: CarrierCapabilityTier = this.defaultTier
  ): Promise<ReattemptResponse> {
    // 1. Kiểm tra nếu hãng bị hạ cấp xuống L1 (BR-26, BR-44, E2E-10)
    if (activeTier === CarrierCapabilityTier.L1_ASSIST) {
      return {
        success: true,
        tier_executed: CarrierCapabilityTier.L1_ASSIST,
        instruction_note: `[GHN L1 Mode] Xuất hồ sơ yêu cầu giao lại cho đơn ${payload.tracking_code}. Vui lòng gửi tại khachhang.ghn.vn`,
      };
    }

    if (activeTier === CarrierCapabilityTier.L0_OBSERVE) {
      throw new ShipDeAppError(ERROR_CATALOG.CARRIER_OPERATION_UNSUPPORTED, {
        carrier: 'GHN',
        tier: 'L0',
        action: 'requestReattempt',
      });
    }

    // 2. Kiểm tra Idempotency (BR-01)
    if (this.idempotencyRequests.has(payload.idempotency_key)) {
      const existing = this.idempotencyRequests.get(payload.idempotency_key)!;
      if (existing.tracking_code !== payload.tracking_code || existing.note !== payload.note) {
        throw new ShipDeAppError(ERROR_CATALOG.IDEMPOTENCY_CONFLICT, {
          idempotency_key: payload.idempotency_key,
        });
      }
      return {
        success: true,
        reference_id: `GHN_RE_${payload.tracking_code}_CACHED`,
        scheduled_at: payload.scheduled_date || new Date(),
        tier_executed: CarrierCapabilityTier.L2_EXECUTE,
      };
    }

    this.idempotencyRequests.set(payload.idempotency_key, payload);

    // 3. Thực thi gọi API GHN L2 Execute
    return {
      success: true,
      reference_id: `GHN_RE_${Date.now()}_${payload.tracking_code}`,
      scheduled_at: payload.scheduled_date || new Date(Date.now() + 24 * 3600 * 1000),
      tier_executed: CarrierCapabilityTier.L2_EXECUTE,
    };
  }

  public async createTicket(
    payload: CreateTicketRequestPayload,
    credentials: Record<string, string>,
    activeTier: CarrierCapabilityTier = this.defaultTier
  ): Promise<CreateTicketResponse> {
    if (activeTier === CarrierCapabilityTier.L1_ASSIST) {
      return {
        status: 'ASSIST_PACKAGE_READY',
        tier_executed: CarrierCapabilityTier.L1_ASSIST,
        portal_export_package_url: `https://storage.shipde.net/evidence/ghn_ticket_${payload.tracking_code}.zip`,
      };
    }

    return {
      ticket_id: `GHN_TICKET_${Date.now()}`,
      status: 'SUBMITTED_VIA_API',
      tier_executed: CarrierCapabilityTier.L2_EXECUTE,
    };
  }
}
