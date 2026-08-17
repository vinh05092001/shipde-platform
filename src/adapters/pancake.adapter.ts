// ============================================================================
// Ship Dễ — Pancake POS Source Adapter (Tập 1 Mục 2.2, Tập 2 CN-01..03)
// ============================================================================

import { Order, WeightGram, CurrencyAmount } from '../types/domain';
import { ERROR_CATALOG, ShipDeAppError } from '../types/error-codes';

export interface PancakeRawOrder {
  id: string | number;
  order_number: string;
  inserted_at: string;
  total_price: number;
  cod: number;
  weight?: number; // gram
  partner?: {
    partner_id?: string;
    partner_name?: string;
    tracking_number?: string;
    status?: string;
  };
  bill_phone_number?: string;
  bill_full_name?: string;
  shipping_address?: {
    province?: string;
    district?: string;
    full_address?: string;
  };
}

export class PancakePosAdapter {
  /**
   * Chuẩn hóa đơn hàng thô từ Pancake POS sang Order Entity chuẩn của Ship Dễ
   */
  public normalizeOrder(raw: PancakeRawOrder, merchantId: string): { order: Order; rawTrackingCode?: string } {
    if (!raw.order_number && !raw.id) {
      throw new ShipDeAppError(ERROR_CATALOG.VALIDATION_ERROR, {
        reason: 'Pancake payload missing order_number or id',
      });
    }

    const orderCode = String(raw.order_number || raw.id).trim();
    const createdAt = raw.inserted_at ? new Date(raw.inserted_at) : new Date();
    const codAmount = Math.max(0, Math.round(raw.cod || 0));
    const declaredWeight = Math.max(0, Math.round(raw.weight || 300));
    const rawTracking = raw.partner?.tracking_number?.trim();

    const order: Order = {
      id: `ord_${merchantId.slice(0, 8)}_${orderCode}`,
      merchant_id: merchantId,
      order_code: orderCode,
      created_at: createdAt,
      cod_amount: codAmount,
      declared_weight_g: declaredWeight,
      recipient_name: raw.bill_full_name || 'Khách hàng',
      recipient_phone: raw.bill_phone_number || '',
      recipient_province: raw.shipping_address?.province || 'Hà Nội',
      recipient_address: raw.shipping_address?.full_address || '',
      item_value: Math.max(0, Math.round(raw.total_price || codAmount)),
    };

    return {
      order,
      rawTrackingCode: rawTracking,
    };
  }

  /**
   * Giả lập nạp lịch sử đơn hàng phân trang (CN-01)
   */
  public async backfillOrders(
    merchantId: string,
    apiKey: string,
    fromDate: Date,
    pageSize: number = 100,
    cursor?: string
  ): Promise<{ orders: Array<{ order: Order; rawTrackingCode?: string }>; nextCursor?: string; hasMore: boolean }> {
    if (!apiKey) {
      throw new ShipDeAppError(ERROR_CATALOG.AUTHENTICATION_REQUIRED, {
        source: 'Pancake POS',
        reason: 'Missing API Key',
      });
    }

    // Giả lập trả về danh sách đơn nạp theo lô
    return {
      orders: [],
      hasMore: false,
    };
  }
}
