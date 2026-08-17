// ============================================================================
// Ship Dễ — Offline Idempotent Scan Queue (Tập 1 Mục 12, Tập 2 CN-22; BR-40)
// Xử lý quét nhận hàng hoàn khi mất mạng: Client sinh client_command_id, Server chống trùng
// Thao tác quét nhận là lũy đẳng (Idempotent) -> Không sinh xung đột
// ============================================================================

import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';
import { MatchingEngine } from './matching-engine';

export interface OfflineScanCommand {
  client_command_id: string; // UUID sinh tại thiết bị
  command_type: 'scan_return_receipt' | 'upload_evidence';
  barcode: string;
  warehouse_id: string;
  condition: 'intact' | 'damaged' | 'missing_item' | 'wrong_item';
  evidence_urls?: string[];
  evidence_checksum?: string;
  captured_at: Date;
  user_id: string;
}

export interface ReturnReceiptRecord {
  id: string;
  client_command_id: string;
  tracking_code: string;
  warehouse_id: string;
  condition: string;
  evidence_urls: string[];
  received_by: string;
  received_at: Date;
}

export class OfflineScanQueueManager {
  // Bộ nhớ server lưu các biên nhận đã ghi
  private processedCommands = new Map<string, ReturnReceiptRecord>();
  private receivedBarcodes = new Map<string, ReturnReceiptRecord>();

  /**
   * Đồng bộ một lô lệnh quét nhận từ thiết bị di động (E2E-04)
   */
  public syncOfflineBatch(
    commands: OfflineScanCommand[],
    isDeviceRevoked: boolean = false
  ): {
    total_received: number;
    newly_created: number;
    duplicates_skipped: number;
    receipts: ReturnReceiptRecord[];
  } {
    // 1. Kiểm tra nếu thiết bị đã bị thu hồi quyền (BR-08, E2E-08)
    if (isDeviceRevoked) {
      throw new ShipDeAppError(ERROR_CATALOG.DEVICE_REVOKED, {
        reason: 'Thiết bị đã bị thu hồi từ xa. Từ chối đồng bộ hàng đợi offline.',
      });
    }

    let newlyCreated = 0;
    let duplicatesSkipped = 0;
    const receipts: ReturnReceiptRecord[] = [];

    for (const cmd of commands) {
      const normBarcode = MatchingEngine.normalizeTrackingCode(cmd.barcode);

      // A. Chống trùng theo client_command_id
      if (this.processedCommands.has(cmd.client_command_id)) {
        duplicatesSkipped++;
        receipts.push(this.processedCommands.get(cmd.client_command_id)!);
        continue;
      }

      // B. Chống trùng theo (barcode + warehouse_id) (BR-35)
      const barcodeKey = `${normBarcode}__${cmd.warehouse_id}`;
      if (this.receivedBarcodes.has(barcodeKey)) {
        duplicatesSkipped++;
        const existing = this.receivedBarcodes.get(barcodeKey)!;
        this.processedCommands.set(cmd.client_command_id, existing);
        receipts.push(existing);
        continue;
      }

      // C. Ràng buộc bắt buộc ảnh khi hàng bất thường (BR-36, CN-12 E3)
      if (cmd.condition !== 'intact' && (!cmd.evidence_urls || cmd.evidence_urls.length === 0)) {
        throw new ShipDeAppError(ERROR_CATALOG.EVIDENCE_REQUIRED, {
          barcode: cmd.barcode,
          condition: cmd.condition,
          message: 'Kiện hàng hỏng/thiếu bắt buộc phải có ảnh chứng cứ.',
        });
      }

      // D. Tạo mới biên nhận nhận hoàn
      const receipt: ReturnReceiptRecord = {
        id: `rec_${Date.now()}_${normBarcode}`,
        client_command_id: cmd.client_command_id,
        tracking_code: normBarcode,
        warehouse_id: cmd.warehouse_id,
        condition: cmd.condition,
        evidence_urls: cmd.evidence_urls || [],
        received_by: cmd.user_id,
        received_at: new Date(),
      };

      this.processedCommands.set(cmd.client_command_id, receipt);
      this.receivedBarcodes.set(barcodeKey, receipt);
      receipts.push(receipt);
      newlyCreated++;
    }

    return {
      total_received: commands.length,
      newly_created: newlyCreated,
      duplicates_skipped: duplicatesSkipped,
      receipts,
    };
  }

  public getReceiptCount(): number {
    return this.receivedBarcodes.size;
  }
}
