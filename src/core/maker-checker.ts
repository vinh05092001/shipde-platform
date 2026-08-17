// ============================================================================
// Ship Dễ — Maker-Checker & Financial Segregation Engine (Tập 1 Mục 1.3, Tập 2 CN-15, BR-12)
// Quy tắc tách quyền tài chính ở cấp bản ghi:
// Người tạo hoặc xử lý vận đơn tuyệt đối không được tự duyệt chênh lệch của chính đơn đó.
// ============================================================================

import { Discrepancy, DiscrepancyResolution, Shipment } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export interface DiscrepancyResolutionPayload {
  discrepancy_id: string;
  resolution: DiscrepancyResolution;
  reason: string;
  user_id: string;
  user_name: string;
  expected_version: number;
}

export class MakerCheckerEngine {
  /**
   * Xử lý giải quyết chênh lệch có kiểm tra tách quyền tài chính (BR-12, E2E-06)
   */
  public resolveDiscrepancy(
    discrepancy: Discrepancy,
    shipment: Shipment,
    payload: DiscrepancyResolutionPayload,
    isPeriodClosed: boolean = false
  ): Discrepancy {
    // 1. Kiểm tra kỳ đã chốt là bất biến (BR-11, CN-15 E4)
    if (isPeriodClosed) {
      throw new ShipDeAppError(ERROR_CATALOG.PERIOD_CLOSED, {
        discrepancy_id: discrepancy.id,
        reason: 'Kỳ đối soát đã chốt, không thể thay đổi bất kỳ khoản chênh lệch nào.',
      });
    }

    // 2. Kiểm tra xung đột khóa lạc quan (BR-27)
    if (discrepancy.version !== payload.expected_version) {
      throw new ShipDeAppError(ERROR_CATALOG.VERSION_CONFLICT, {
        current_version: discrepancy.version,
        sent_version: payload.expected_version,
      });
    }

    // 3. Kiểm tra lý do bắt buộc khi duyệt/bỏ qua (BR-22)
    if (!payload.reason || payload.reason.trim() === '') {
      throw new ShipDeAppError(ERROR_CATALOG.REASON_REQUIRED, {
        field: 'reason',
        message: 'Bỏ qua hoặc xử lý chênh lệch bắt buộc phải có lý do cụ thể.',
      });
    }

    // 4. KIỂM TRA TÁCH QUYỀN TÀI CHÍNH CẤP BẢN GHI (BR-12, E2E-06)
    // Người đã thao tác trên vận đơn hoặc tạo yêu cầu không được tự duyệt chênh lệch
    if (
      (shipment.last_modified_by && shipment.last_modified_by === payload.user_id) ||
      (discrepancy.created_by_user && discrepancy.created_by_user === payload.user_id)
    ) {
      throw new ShipDeAppError(ERROR_CATALOG.SELF_APPROVAL_FORBIDDEN, {
        user_id: payload.user_id,
        user_name: payload.user_name,
        shipment_last_modified_by: shipment.last_modified_by || discrepancy.created_by_user,
        action: 'approve_discrepancy',
        message: `Người dùng ${payload.user_name} đã thao tác hoặc tạo bản ghi trên đơn ${shipment.tracking_code} nên không thể tự duyệt chênh lệch (BR-12).`,
      });
    }

    // 5. Cập nhật trạng thái
    discrepancy.status = payload.resolution;
    discrepancy.reason = payload.reason;
    discrepancy.resolved_by = payload.user_id;
    discrepancy.resolved_at = new Date();
    discrepancy.version += 1;

    return discrepancy;
  }

  /**
   * Kiểm tra điều kiện chốt kỳ đối soát (BR-11, CN-15 E2)
   */
  public validatePeriodClosure(discrepancies: Discrepancy[]): { canClose: boolean; openCount: number } {
    const openList = discrepancies.filter(
      (d) =>
        d.status !== DiscrepancyResolution.CONFIRMED &&
        d.status !== DiscrepancyResolution.DISPUTE &&
        d.status !== DiscrepancyResolution.WAIVE &&
        d.status !== DiscrepancyResolution.RESOLVED &&
        d.status !== DiscrepancyResolution.CARRY_FORWARD
    );

    if (openList.length > 0) {
      throw new ShipDeAppError(ERROR_CATALOG.UNRESOLVED_DISCREPANCIES, {
        open_discrepancies_count: openList.length,
        message: `Kỳ đối soát vẫn còn ${openList.length} dòng chênh lệch chưa được xử lý. Không thể chốt kỳ.`,
      });
    }

    return { canClose: true, openCount: 0 };
  }
}
