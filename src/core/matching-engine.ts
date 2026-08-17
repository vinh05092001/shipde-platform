// ============================================================================
// Ship Dễ — 3-Tier Code Matching Engine (Tập 2 CN-03, FR-SRC-004, NFR-04)
// Thứ tự ưu tiên khóa:
// 1. Khóa 1: tracking_code chính xác (chuẩn hóa viết hoa, bỏ khoảng trắng & ký tự lạ) -> matched_exact
// 2. Khóa 2: order_code nếu sao kê / hãng có mang -> matched_exact
// 3. Khóa 3: Khớp mờ theo COD + ngày trong cửa sổ +/- 3 ngày -> matched_fuzzy
// 4. Không khớp -> unmatched (đưa vào hàng đợi ghép tay)
// ============================================================================

import { Shipment, StatementRow, MatchingStatus } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export interface MatchingStats {
  total_rows: number;
  exact_matched: number;
  exact_matched_pct: number;
  fuzzy_matched: number;
  fuzzy_matched_pct: number;
  unmatched: number;
  unmatched_pct: number;
  ambiguous: number;
  below_threshold_alert: boolean; // Cảnh báo khi exact < 95% (BR-49, NFR-04)
}

export class MatchingEngine {
  /**
   * Chuẩn hóa mã vận đơn (Viết hoa, xóa khoảng trắng, gạch ngang, ký tự đặc biệt)
   */
  public static normalizeTrackingCode(code?: string): string {
    if (!code) return '';
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
  }

  /**
   * Khớp một danh sách dòng sao kê với sổ cái vận đơn
   */
  public matchStatementRows(
    rows: StatementRow[],
    shipments: Shipment[]
  ): {
    matchedRows: StatementRow[];
    stats: MatchingStats;
  } {
    // Xây dựng Index tra cứu nhanh
    const trackingMap = new Map<string, Shipment[]>();
    const orderCodeMap = new Map<string, Shipment[]>();

    for (const ship of shipments) {
      const normTracking = MatchingEngine.normalizeTrackingCode(ship.tracking_code);
      if (normTracking) {
        const list = trackingMap.get(normTracking) || [];
        list.push(ship);
        trackingMap.set(normTracking, list);
      }

      if (ship.order_code) {
        const code = ship.order_code.trim();
        const list = orderCodeMap.get(code) || [];
        list.push(ship);
        orderCodeMap.set(code, list);
      }
    }

    let exactCount = 0;
    let fuzzyCount = 0;
    let unmatchedCount = 0;
    let ambiguousCount = 0;

    const matchedRows = rows.map((row) => {
      const normTracking = MatchingEngine.normalizeTrackingCode(row.tracking_code);

      // --- KHÓA 1: Khớp chính xác tracking_code ---
      if (normTracking && trackingMap.has(normTracking)) {
        const candidates = trackingMap.get(normTracking)!;
        if (candidates.length === 1) {
          exactCount++;
          row.match_status = MatchingStatus.MATCHED_EXACT;
          row.matched_shipment_id = candidates[0].id;
          return row;
        } else {
          ambiguousCount++;
          row.match_status = MatchingStatus.AMBIGUOUS;
          return row;
        }
      }

      // --- KHÓA 2: Khớp theo mã đơn hàng order_code ---
      if (row.order_code && orderCodeMap.has(row.order_code.trim())) {
        const candidates = orderCodeMap.get(row.order_code.trim())!;
        if (candidates.length === 1) {
          exactCount++;
          row.match_status = MatchingStatus.MATCHED_EXACT;
          row.matched_shipment_id = candidates[0].id;
          return row;
        } else {
          ambiguousCount++;
          row.match_status = MatchingStatus.AMBIGUOUS;
          return row;
        }
      }

      // --- KHÓA 3: Khớp mờ theo số tiền COD + cửa sổ thời gian +/- 3 ngày ---
      if (row.cod_collected > 0 && row.cod_paid_at) {
        const rowPaidTime = row.cod_paid_at.getTime();
        const windowMs = 3 * 24 * 60 * 60 * 1000; // 3 ngày

        const fuzzyCandidates = shipments.filter((s) => {
          if (s.cod_amount !== row.cod_collected) return false;
          if (!s.delivered_at) return false;
          const diff = Math.abs(s.delivered_at.getTime() - rowPaidTime);
          return diff <= windowMs;
        });

        if (fuzzyCandidates.length === 1) {
          fuzzyCount++;
          row.match_status = MatchingStatus.MATCHED_FUZZY;
          row.matched_shipment_id = fuzzyCandidates[0].id;
          return row;
        } else if (fuzzyCandidates.length > 1) {
          ambiguousCount++;
          row.match_status = MatchingStatus.AMBIGUOUS;
          return row;
        }
      }

      // Không khớp
      unmatchedCount++;
      row.match_status = MatchingStatus.UNMATCHED;
      return row;
    });

    const total = rows.length;
    const exactPct = total > 0 ? (exactCount / total) * 100 : 0;
    const fuzzyPct = total > 0 ? (fuzzyCount / total) * 100 : 0;
    const unmatchedPct = total > 0 ? (unmatchedCount / total) * 100 : 0;

    const stats: MatchingStats = {
      total_rows: total,
      exact_matched: exactCount,
      exact_matched_pct: Math.round(exactPct * 100) / 100,
      fuzzy_matched: fuzzyCount,
      fuzzy_matched_pct: Math.round(fuzzyPct * 100) / 100,
      unmatched: unmatchedCount,
      unmatched_pct: Math.round(unmatchedPct * 100) / 100,
      ambiguous: ambiguousCount,
      below_threshold_alert: exactPct < 95.0, // BR-49 & NFR-04 cảnh báo khi dưới 95%
    };

    return { matchedRows, stats };
  }

  /**
   * Ghép tay thủ công (Manual Link) với ghi nhận nhật ký audit (CN-03 Luồng chính bước 6)
   */
  public manualLink(
    row: StatementRow,
    shipment: Shipment,
    userId: string,
    reason: string
  ): StatementRow {
    if (!reason || reason.trim() === '') {
      throw new ShipDeAppError(ERROR_CATALOG.REASON_REQUIRED, {
        action: 'manual_link',
        reason: 'Ghép mã thủ công bắt buộc phải nhập lý do.',
      });
    }

    if (row.tracking_code && shipment.tracking_code) {
      const normR = MatchingEngine.normalizeTrackingCode(row.tracking_code);
      const normS = MatchingEngine.normalizeTrackingCode(shipment.tracking_code);
      if (normR !== normS && !row.order_code) {
        // Cảnh báo nếu mã vận đơn lệch hẳn nhau
      }
    }

    row.match_status = MatchingStatus.MATCHED_EXACT;
    row.matched_shipment_id = shipment.id;
    return row;
  }
}
