// ============================================================================
// Ship Dễ — Discrepancy Detection & Reconciliation Engine (Tập 1 Mục 7.1, Tập 2 CN-14)
// Chạy 6 phép dò chuẩn R1: D1, D2, D4, D5, D6, D7 (D3 dời R2)
// Tuân thủ: BR-16, BR-28, BR-51 (Thiếu biểu giá thì không kết luận)
// ============================================================================

import {
  Shipment,
  StatementRow,
  RateCard,
  RateTier,
  Discrepancy,
  DiscrepancyType,
  DiscrepancyResolution,
  MatchingStatus,
  ShipmentStatus,
  WeightGram,
  CurrencyAmount,
} from '../types/domain';
import { MatchingEngine } from './matching-engine';

export interface ReconciliationOptions {
  weight_tolerance_g?: number; // Dung sai cân nặng (mặc định 20g)
  fee_tolerance_vnd?: number;   // Dung sai tiền cước (mặc định 0 VNĐ)
}

export interface ReconciliationResult {
  statement_id: string;
  reconciled_at: Date;
  total_statement_rows: number;
  matched_rows_count: number;
  discrepancies: Discrepancy[];
  missing_rate_card_warning: boolean; // Cờ thiếu biểu giá hợp đồng (BR-51)
  summary: {
    d1_weight_count: number;
    d1_weight_amount: CurrencyAmount;
    d2_freight_count: number;
    d2_freight_amount: CurrencyAmount;
    d4_duplicate_count: number;
    d4_duplicate_amount: CurrencyAmount;
    d5_cod_mismatch_count: number;
    d5_cod_mismatch_amount: CurrencyAmount;
    d6_overdue_cod_count: number;
    d6_overdue_cod_amount: CurrencyAmount;
    d7_missing_rows_count: number;
  };
}

export class ReconciliationEngine {
  /**
   * Tính cân nặng quy đổi thể tích: (Dài x Rộng x Cao) / Hệ số quy đổi (5000 hoặc 6000) * 1000 ra gram
   */
  public static calculateVolumetricWeight(
    dimensions?: { length: number; width: number; height: number },
    divisor: number = 5000
  ): WeightGram {
    if (!dimensions || !dimensions.length || !dimensions.width || !dimensions.height) {
      return 0;
    }
    // (L x W x H cm) / divisor = kg -> * 1000 = gram
    const kg = (dimensions.length * dimensions.width * dimensions.height) / divisor;
    return Math.round(kg * 1000);
  }

  /**
   * Tra cứu cước phí dự kiến từ biểu giá hợp đồng (CN-25, FR-RATE-003)
   */
  public static calculateExpectedFreight(
    billableWeightG: WeightGram,
    routeType: 'INTRA_PROVINCE' | 'INTER_PROVINCE' | 'SPECIAL',
    rateCard?: RateCard
  ): CurrencyAmount | null {
    if (!rateCard || !rateCard.tiers || rateCard.tiers.length === 0) {
      return null; // Không có biểu giá (BR-51)
    }

    const matchingTier = rateCard.tiers.find(
      (t) =>
        t.route_type === routeType &&
        billableWeightG >= t.weight_from_g &&
        billableWeightG <= t.weight_to_g
    );

    if (!matchingTier) {
      // Nếu vượt khung cao nhất, tính theo bậc cước lũy tiến
      const baseTier = rateCard.tiers
        .filter((t) => t.route_type === routeType)
        .sort((a, b) => b.weight_to_g - a.weight_to_g)[0];

      if (!baseTier || baseTier.step_weight_g <= 0) return null;

      const extraWeight = billableWeightG - baseTier.weight_to_g;
      const steps = Math.ceil(extraWeight / baseTier.step_weight_g);
      return Number(baseTier.base_fee) + steps * Number(baseTier.step_fee);
    }

    return Number(matchingTier.base_fee);
  }

  /**
   * Thực thi toàn bộ 6 phép dò đối soát
   */
  public runReconciliation(
    statementId: string,
    merchantId: string,
    statementRows: StatementRow[],
    shipments: Shipment[],
    rateCard?: RateCard,
    options: ReconciliationOptions = {}
  ): ReconciliationResult {
    const weightTolerance = options.weight_tolerance_g ?? 20;
    const feeTolerance = options.fee_tolerance_vnd ?? 0;
    const discrepancies: Discrepancy[] = [];
    const missingRateCard = !rateCard;

    // Index shipments by ID & Normalized Tracking
    const shipmentById = new Map<string, Shipment>();
    const shipmentByTracking = new Map<string, Shipment>();
    for (const s of shipments) {
      shipmentById.set(s.id, s);
      const norm = MatchingEngine.normalizeTrackingCode(s.tracking_code);
      if (norm) shipmentByTracking.set(norm, s);
    }

    // --- PHÉP DÒ D4: Khấu trừ trùng (Cùng tracking_code & fee_type xuất hiện >= 2 lần) ---
    const feeTypeOccurrences = new Map<string, StatementRow[]>();
    for (const row of statementRows) {
      const key = `${row.tracking_code}__${row.fee_type}`;
      const list = feeTypeOccurrences.get(key) || [];
      list.push(row);
      feeTypeOccurrences.set(key, list);
    }

    for (const [key, duplicateRows] of feeTypeOccurrences.entries()) {
      if (duplicateRows.length >= 2) {
        // Dòng đầu tiên là hợp lệ, từ dòng thứ 2 trở đi là trùng lặp
        for (let i = 1; i < duplicateRows.length; i++) {
          const dupRow = duplicateRows[i];
          discrepancies.push({
            id: `disc_D4_${dupRow.id}`,
            merchant_id: merchantId,
            statement_row_id: dupRow.id,
            shipment_id: dupRow.matched_shipment_id || '',
            tracking_code: dupRow.tracking_code,
            type: DiscrepancyType.D4_DUPLICATE_DEDUCTION,
            amount: dupRow.charged_fee,
            status: DiscrepancyResolution.OPEN,
            reason: `Phát hiện dòng khấu trừ cước phí trùng lặp lần thứ ${i + 1} cho cùng mã vận đơn và loại phí ${dupRow.fee_type}.`,
            version: 1,
            created_at: new Date(),
          });
        }
      }
    }

    // --- XỬ LÝ TỪNG DÒNG SAO KÊ CHO D1, D2, D5 ---
    let matchedCount = 0;
    const matchedShipmentIdsInStatement = new Set<string>();

    for (const row of statementRows) {
      if (
        row.match_status !== MatchingStatus.MATCHED_EXACT &&
        row.match_status !== MatchingStatus.MATCHED_FUZZY
      ) {
        continue;
      }

      const shipment = row.matched_shipment_id ? shipmentById.get(row.matched_shipment_id) : undefined;
      if (!shipment) continue;

      matchedCount++;
      matchedShipmentIdsInStatement.add(shipment.id);

      const divisor = rateCard?.volumetric_divisor || 5000;
      const volWeight = ReconciliationEngine.calculateVolumetricWeight(shipment.dimensions_cm, divisor);
      const expectedBillableWeight = Math.max(shipment.declared_weight_g, volWeight);

      // --- PHÉP DÒ D1: Lệch cân tính phí ---
      if (row.charged_weight_g > expectedBillableWeight + weightTolerance) {
        const weightDiffG = row.charged_weight_g - expectedBillableWeight;
        discrepancies.push({
          id: `disc_D1_${row.id}`,
          merchant_id: merchantId,
          statement_row_id: row.id,
          shipment_id: shipment.id,
          tracking_code: row.tracking_code,
          type: DiscrepancyType.D1_WEIGHT,
          amount: 0, // Cân lệch tạo cơ sở tính lệch tiền cước ở D2
          status: DiscrepancyResolution.OPEN,
          reason: `Cân hãng tính phí (${row.charged_weight_g}g) vượt quá cân khai báo & quy đổi (${expectedBillableWeight}g) là +${weightDiffG}g (Dung sai: ${weightTolerance}g).`,
          version: 1,
          created_at: new Date(),
        });
      }

      // --- PHÉP DÒ D2: Lệch cước vận chuyển (BR-51: Chỉ chạy khi có biểu giá) ---
      if (rateCard) {
        const expectedFee = ReconciliationEngine.calculateExpectedFreight(
          expectedBillableWeight,
          'INTRA_PROVINCE', // Giả lập tuyến
          rateCard
        );

        if (expectedFee !== null && Math.abs(row.charged_fee - expectedFee) > feeTolerance) {
          const diffFee = row.charged_fee - expectedFee;
          discrepancies.push({
            id: `disc_D2_${row.id}`,
            merchant_id: merchantId,
            statement_row_id: row.id,
            shipment_id: shipment.id,
            tracking_code: row.tracking_code,
            type: DiscrepancyType.D2_FREIGHT,
            amount: diffFee > 0 ? diffFee : 0,
            status: DiscrepancyResolution.OPEN,
            reason: `Cước thực thu (${row.charged_fee.toLocaleString()} đ) sai lệch so với biểu giá hợp đồng (${expectedFee.toLocaleString()} đ). Chênh lệch: ${diffFee.toLocaleString()} đ.`,
            version: 1,
            created_at: new Date(),
          });
        }
      }

      // --- PHÉP DÒ D5: Lệch COD thu hộ ---
      if (row.cod_collected > 0 || shipment.cod_amount > 0) {
        if (row.cod_collected !== shipment.cod_amount) {
          const codDiff = shipment.cod_amount - row.cod_collected;
          discrepancies.push({
            id: `disc_D5_${row.id}`,
            merchant_id: merchantId,
            statement_row_id: row.id,
            shipment_id: shipment.id,
            tracking_code: row.tracking_code,
            type: DiscrepancyType.D5_COD_MISMATCH,
            amount: Math.abs(codDiff),
            status: DiscrepancyResolution.OPEN,
            reason: `Tiền COD hãng ghi nhận (${row.cod_collected.toLocaleString()} đ) lệch so với đơn khai báo (${shipment.cod_amount.toLocaleString()} đ).`,
            version: 1,
            created_at: new Date(),
          });
        }
      }
    }

    // --- PHÉP DÒ D6 & D7: Kiểm tra ngược từ Sổ cái Vận đơn sang Sao kê ---
    const now = new Date();
    const codSlaDays = rateCard?.cod_payout_sla_days || 3;

    for (const shipment of shipments) {
      // D6: COD quá hạn thanh toán
      if (
        shipment.current_status === ShipmentStatus.DELIVERED &&
        shipment.cod_amount > 0 &&
        !shipment.cod_paid_at &&
        shipment.delivered_at
      ) {
        const daysSinceDelivered = Math.floor(
          (now.getTime() - shipment.delivered_at.getTime()) / (24 * 3600 * 1000)
        );
        if (daysSinceDelivered > codSlaDays) {
          discrepancies.push({
            id: `disc_D6_${shipment.id}`,
            merchant_id: merchantId,
            shipment_id: shipment.id,
            tracking_code: shipment.tracking_code,
            type: DiscrepancyType.D6_OVERDUE_COD,
            amount: shipment.cod_amount,
            status: DiscrepancyResolution.OPEN,
            reason: `Đơn đã giao thành công ${daysSinceDelivered} ngày trước (vượt SLA ${codSlaDays} ngày) nhưng chưa nhận được dòng thanh toán COD từ hãng.`,
            version: 1,
            created_at: new Date(),
          });
        }
      }

      // D7: Đơn đã giao nhưng thiếu dòng sao kê trong kỳ
      if (
        shipment.current_status === ShipmentStatus.DELIVERED &&
        !matchedShipmentIdsInStatement.has(shipment.id)
      ) {
        discrepancies.push({
          id: `disc_D7_${shipment.id}`,
          merchant_id: merchantId,
          shipment_id: shipment.id,
          tracking_code: shipment.tracking_code,
          type: DiscrepancyType.D7_MISSING_STATEMENT_ROW,
          amount: shipment.quoted_fee || 0,
          status: DiscrepancyResolution.OPEN,
          reason: `Vận đơn đã giao thành công trong kỳ nhưng không có dòng đối soát nào trong file sao kê.`,
          version: 1,
          created_at: new Date(),
        });
      }
    }

    // Tổng hợp thống kê 6 phép dò
    const summary = {
      d1_weight_count: discrepancies.filter((d) => d.type === DiscrepancyType.D1_WEIGHT).length,
      d1_weight_amount: 0,
      d2_freight_count: discrepancies.filter((d) => d.type === DiscrepancyType.D2_FREIGHT).length,
      d2_freight_amount: discrepancies
        .filter((d) => d.type === DiscrepancyType.D2_FREIGHT)
        .reduce((sum, d) => sum + d.amount, 0),
      d4_duplicate_count: discrepancies.filter((d) => d.type === DiscrepancyType.D4_DUPLICATE_DEDUCTION).length,
      d4_duplicate_amount: discrepancies
        .filter((d) => d.type === DiscrepancyType.D4_DUPLICATE_DEDUCTION)
        .reduce((sum, d) => sum + d.amount, 0),
      d5_cod_mismatch_count: discrepancies.filter((d) => d.type === DiscrepancyType.D5_COD_MISMATCH).length,
      d5_cod_mismatch_amount: discrepancies
        .filter((d) => d.type === DiscrepancyType.D5_COD_MISMATCH)
        .reduce((sum, d) => sum + d.amount, 0),
      d6_overdue_cod_count: discrepancies.filter((d) => d.type === DiscrepancyType.D6_OVERDUE_COD).length,
      d6_overdue_cod_amount: discrepancies
        .filter((d) => d.type === DiscrepancyType.D6_OVERDUE_COD)
        .reduce((sum, d) => sum + d.amount, 0),
      d7_missing_rows_count: discrepancies.filter((d) => d.type === DiscrepancyType.D7_MISSING_STATEMENT_ROW).length,
    };

    return {
      statement_id: statementId,
      reconciled_at: new Date(),
      total_statement_rows: statementRows.length,
      matched_rows_count: matchedCount,
      discrepancies,
      missing_rate_card_warning: missingRateCard,
      summary,
    };
  }
}
