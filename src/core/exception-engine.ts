// ============================================================================
// Ship Dễ — Exception Detection, Workbox & Rescuing Engine
// (Tập 1 Mục 6, Tập 2 CN-08, CN-09, CN-10; BR-31, BR-32, BR-33)
// ============================================================================

import {
  ExceptionCase,
  ExceptionType,
  ExceptionCaseStatus,
  Shipment,
  ShipmentStatus,
  CarrierCapabilityTier,
} from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';
import { BaseCarrierAdapter, ReattemptRequestPayload, ReattemptResponse } from '../adapters/base.carrier';

export interface ReattemptDispatchResult {
  case_id: string;
  shipment_id: string;
  tracking_code: string;
  tier_executed: CarrierCapabilityTier;
  success: boolean;
  reference_id?: string;
  instruction_note?: string;
}

export class ExceptionEngine {
  // Bộ nhớ đệm mô phỏng các yêu cầu giao lại đang xử lý (BR-33, E2E-03)
  private activeReattemptTrackingCodes = new Set<string>();

  /**
   * Tính hạn xử lý SLA tính từ occurred_at của sự kiện hãng (BR-32, CN-08)
   * Không tính từ lúc nhận webhook hay lúc nhân viên mở màn hình.
   */
  public calculateDeadline(occurredAt: Date, exceptionType: ExceptionType): Date {
    let slaHours = 24;
    switch (exceptionType) {
      case ExceptionType.DELIVERY_FAIL:
        slaHours = 12; // Giao thất bại cần cứu gấp trong 12h
        break;
      case ExceptionType.PICKUP_DELAY:
        slaHours = 6;
        break;
      case ExceptionType.STUCK_IN_TRANSIT:
        slaHours = 48;
        break;
      case ExceptionType.STATUS_MISMATCH:
        slaHours = 24;
        break;
    }
    return new Date(occurredAt.getTime() + slaHours * 3600 * 1000);
  }

  /**
   * Tính điểm ưu tiên sắp xếp hộp việc (CN-08, CN-09)
   * Xếp theo giá trị COD, tuổi sự cố, hạn hoàn và khả năng cứu.
   */
  public calculatePriorityScore(
    codAmount: number,
    occurredAt: Date,
    deadlineAt: Date
  ): number {
    const codWeight = Math.min(50, Math.round(codAmount / 100000)); // Tối đa 50 điểm
    const remainingHours = Math.max(0, (deadlineAt.getTime() - Date.now()) / (3600 * 1000));
    const urgencyWeight = remainingHours <= 4 ? 40 : remainingHours <= 12 ? 20 : 5; // Tối đa 40 điểm
    return codWeight + urgencyWeight;
  }

  /**
   * Phát hiện và mở hồ sơ ngoại lệ (CN-08, BR-31)
   */
  public createOrUpdateExceptionCase(
    shipment: Shipment,
    exceptionType: ExceptionType,
    carrierOccurredAt: Date,
    carrierRawReason?: string,
    existingCase?: ExceptionCase
  ): ExceptionCase {
    // BR-31: Một hồ sơ ngoại lệ mở duy nhất cho mỗi cặp (vận đơn, loại sự cố)
    if (existingCase && existingCase.status !== ExceptionCaseStatus.RESCUED && existingCase.status !== ExceptionCaseStatus.RETURNED) {
      // Nối thông tin vào hồ sơ đang mở
      existingCase.carrier_raw_reason = carrierRawReason || existingCase.carrier_raw_reason;
      return existingCase;
    }

    const deadline = this.calculateDeadline(carrierOccurredAt, exceptionType);
    const priority = this.calculatePriorityScore(shipment.cod_amount, carrierOccurredAt, deadline);

    return {
      id: `exc_${shipment.merchant_id.slice(0, 8)}_${shipment.tracking_code}_${exceptionType}`,
      merchant_id: shipment.merchant_id,
      shipment_id: shipment.id,
      tracking_code: shipment.tracking_code,
      exception_type: exceptionType,
      status: ExceptionCaseStatus.OPEN,
      deadline_at: deadline,
      priority_score: priority,
      carrier_raw_reason: carrierRawReason,
      standard_reason: 'Giao hàng không thành công / Khách hẹn lại',
      version: 1,
      can_reattempt: true,
      created_at: new Date(),
    };
  }

  /**
   * Gửi yêu cầu giao lại (Reattempt) chống gửi trùng (BR-33, E2E-03)
   */
  public async dispatchReattempt(
    exceptionCase: ExceptionCase,
    shipment: Shipment,
    adapter: BaseCarrierAdapter,
    credentials: Record<string, string>,
    payload: {
      userId: string;
      userName: string;
      note: string;
      scheduledDate?: Date;
      newPhone?: string;
      overrideTier?: CarrierCapabilityTier;
    }
  ): Promise<ReattemptDispatchResult> {
    const tracking = shipment.tracking_code;

    // 1. Kiểm tra khóa giao lại đang xử lý (BR-33, E2E-03)
    if (this.activeReattemptTrackingCodes.has(tracking)) {
      throw new ShipDeAppError(ERROR_CATALOG.REATTEMPT_IN_PROGRESS, {
        tracking_code: tracking,
        message: 'Đã có yêu cầu giao lại đang được xử lý cho vận đơn này.',
      });
    }

    // Đặt khóa thao tác
    this.activeReattemptTrackingCodes.add(tracking);

    try {
      // Cập nhật người sửa cuối trên vận đơn (để Maker-Checker engine ghi nhận BR-12)
      shipment.last_modified_by = payload.userId;

      const reattemptPayload: ReattemptRequestPayload = {
        tracking_code: tracking,
        scheduled_date: payload.scheduledDate,
        new_recipient_phone: payload.newPhone,
        note: payload.note,
        idempotency_key: `reattempt_${tracking}_${Date.now()}`,
      };

      const resp = await adapter.requestReattempt(reattemptPayload, credentials, payload.overrideTier);

      exceptionCase.status = ExceptionCaseStatus.REATTEMPT_REQUESTED;
      exceptionCase.version += 1;

      return {
        case_id: exceptionCase.id,
        shipment_id: shipment.id,
        tracking_code: tracking,
        tier_executed: resp.tier_executed,
        success: resp.success,
        reference_id: resp.reference_id,
        instruction_note: resp.instruction_note,
      };
    } finally {
      // Nhả khóa sau khi hoàn tất
      this.activeReattemptTrackingCodes.delete(tracking);
    }
  }
}
