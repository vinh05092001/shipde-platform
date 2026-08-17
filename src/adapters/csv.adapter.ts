// ============================================================================
// Ship Dễ — CSV/Excel Statement Parser (Tập 2 CN-13, BR-02, BR-36)
// Bất biến, tính Checksum SHA-256, chuẩn hóa dòng vào buffer đối soát
// ============================================================================

import * as crypto from 'crypto';
import { StatementRow, MatchingStatus } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export interface RawStatementRowInput {
  tracking_code: string;
  order_code?: string;
  fee_type: string;
  charged_weight_g: number;
  charged_fee: number;
  cod_collected: number;
  cod_paid_at?: string | Date;
  extra?: Record<string, unknown>;
}

export interface StatementParseResult {
  checksum: string;
  total_rows: number;
  total_fees: number;
  total_cod: number;
  rows: StatementRow[];
}

export function calculateSHA256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class StatementCsvAdapter {
  private registeredChecksums = new Set<string>();

  /**
   * Tính mã SHA-256 checksum của file sao kê
   */
  public calculateChecksum(fileContent: string | Buffer): string {
    return calculateSHA256(fileContent);
  }

  /**
   * Phân tích và chuẩn hóa danh sách dòng sao kê thô
   */
  public parseStatement(
    statementId: string,
    merchantId: string,
    fileContent: string | Buffer,
    rawRows: RawStatementRowInput[]
  ): StatementParseResult {
    const checksum = this.calculateChecksum(fileContent);

    // Kiểm tra trùng lặp checksum file sao kê (CN-13 E2)
    if (this.registeredChecksums.has(checksum)) {
      throw new ShipDeAppError(ERROR_CATALOG.STATEMENT_DUPLICATE, {
        checksum,
        reason: 'File sao kê này đã được tải lên trước đó trong cùng nguồn.',
      });
    }

    if (!rawRows || rawRows.length === 0) {
      throw new ShipDeAppError(ERROR_CATALOG.VALIDATION_ERROR, {
        reason: 'File sao kê rỗng hoặc không đọc được dòng dữ liệu nào.',
      });
    }

    this.registeredChecksums.add(checksum);

    let totalFees = 0;
    let totalCod = 0;
    const rows: StatementRow[] = [];

    rawRows.forEach((raw, index) => {
      const lineNum = index + 1;
      const normalizedTracking = (raw.tracking_code || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .trim();

      const fee = Math.max(0, Math.round(Number(raw.charged_fee) || 0));
      const cod = Math.max(0, Math.round(Number(raw.cod_collected) || 0));
      const weight = Math.max(0, Math.round(Number(raw.charged_weight_g) || 0));

      totalFees += fee;
      totalCod += cod;

      let paidAtDate: Date | undefined;
      if (raw.cod_paid_at) {
        paidAtDate = new Date(raw.cod_paid_at);
        if (isNaN(paidAtDate.getTime())) paidAtDate = undefined;
      }

      rows.push({
        id: `row_${statementId}_${lineNum}`,
        statement_id: statementId,
        line_number: lineNum,
        tracking_code: normalizedTracking,
        order_code: raw.order_code ? String(raw.order_code).trim() : undefined,
        fee_type: raw.fee_type ? String(raw.fee_type).trim().toUpperCase() : 'MAIN_FREIGHT',
        charged_weight_g: weight,
        charged_fee: fee,
        cod_collected: cod,
        cod_paid_at: paidAtDate,
        match_status: MatchingStatus.UNMATCHED,
        raw_data: { ...raw },
      });
    });

    return {
      checksum,
      total_rows: rows.length,
      total_fees: totalFees,
      total_cod: totalCod,
      rows,
    };
  }
}

export const CsvStatementParser = StatementCsvAdapter;
