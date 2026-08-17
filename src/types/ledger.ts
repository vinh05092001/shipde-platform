// ============================================================================
// Ship Dễ — Ba Sổ Giá Trị Độc Lập (Tập 1 Mục 7.2, BR-45, BR-50, CN-18)
// Cấm tuyệt đối cộng dồn ba sổ lại với nhau
// ============================================================================

import { CurrencyAmount } from './domain';

/**
 * Sổ 1: Tiền Thực Nhận (Recovered Cash)
 * Bằng chứng ROI thực tế từ các khoản đòi bồi thường / hoàn phí thành công đã về tài khoản ngân hàng.
 */
export interface Ledger1_RealCash {
  total_recovered_amount: CurrencyAmount;  // Tổng tiền thực nhận (VNĐ)
  claim_count: number;                    // Số lượng hồ sơ khiếu nại đã nhận tiền
  pending_acceptance_amount: CurrencyAmount; // Tiền hãng đã chấp thuận nhưng chưa về (cột riêng)
  records: Array<{
    claim_id: string;
    tracking_code: string;
    carrier_code: string;
    accepted_amount: CurrencyAmount;
    recovered_amount: CurrencyAmount;
    bank_reference?: string;
    paid_at: Date;
  }>;
}

/**
 * Sổ 2: Đơn Cứu Được (Rescued Orders)
 * Chỉ số hiệu quả vận hành: Số đơn gặp sự cố giao thất bại được CSKH can thiệp cứu thành công.
 * Tiết kiệm phí hoàn đơn cho shop (BR-50: Không cộng phí chiều đi vì đơn đã giao shop vẫn trả phí đó).
 */
export interface Ledger2_RescuedOrders {
  rescued_orders_count: number;           // Số lượng đơn cứu thành công
  total_return_fee_saved: CurrencyAmount; // Tổng phí hoàn tránh được (VNĐ)
  rescued_gmv: CurrencyAmount;            // Tổng giá trị hàng hóa (GMV) cứu được (ghi riêng, không quy thành tiền mặt)
  records: Array<{
    case_id: string;
    tracking_code: string;
    order_code: string;
    delivery_attempts: number;
    intervention_channel: string;
    return_fee_saved: CurrencyAmount;
    gmv: CurrencyAmount;
    rescued_at: Date;
  }>;
}

/**
 * Sổ 3: Khả Năng Kiểm Soát (Operational Control)
 * Đo lường độ phủ dữ liệu, thời gian phản hồi và giờ công kế toán tiết kiệm được.
 * Đây là cơ sở thuyết phục shop trả thuê bao SaaS cố định (BR-46).
 */
export interface Ledger3_ControlMetrics {
  total_active_shipments: number;         // Tổng số vận đơn trong kỳ
  realtime_tracking_coverage_pct: number; // % đơn cập nhật trạng thái trong 24h
  reconciled_cod_coverage_pct: number;    // % COD đã được đối soát chính xác
  discrepancies_detected_count: number;   // Số lượng sai lệch cước/COD phát hiện & ngăn chặn
  accounting_hours_saved: number;         // Số giờ công đối soát thủ công tiết kiệm được (ước tính: 500 đơn = 1h kế toán)
  carrier_health_score: Record<string, { uptime_pct: number; on_time_delivery_pct: number }>;
}

/**
 * Báo cáo Ba Sổ Tổng Hợp Chuẩn (CN-18)
 * Tuyệt đối KHÔNG có trường `total_combined_value` (BR-45).
 */
export interface ThreeValueLedgersReport {
  merchant_id: string;
  period_start: Date;
  period_end: Date;
  generated_at: Date;
  
  // Ba sổ độc lập
  ledger1_real_cash: Ledger1_RealCash;
  ledger2_rescued_orders: Ledger2_RescuedOrders;
  ledger3_control_metrics: Ledger3_ControlMetrics;
}

/**
 * Kiểm tra ràng buộc BR-45: Đảm bảo không tồn tại trường tính tổng ba sổ
 */
export function validateThreeLedgersSeparation(report: ThreeValueLedgersReport): boolean {
  const keys = Object.keys(report);
  const forbiddenKeywords = ['total_value', 'combined_amount', 'grand_total', 'roi_total'];
  for (const key of keys) {
    if (forbiddenKeywords.some((forbidden) => key.toLowerCase().includes(forbidden))) {
      throw new Error(`BR-45 VIOLATION: Forbidden combined field detected: "${key}"`);
    }
  }
  return true;
}
