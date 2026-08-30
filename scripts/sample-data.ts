// ============================================================================
// Ship Dễ — Dữ liệu Giả lập Độc lập cho Thí nghiệm Concierge (Tập 0 Mục 3, 5)
// ============================================================================

import {
  Order,
  Shipment,
  StatementRow,
  RateCard,
  CarrierCode,
  ShipmentStatus,
  MatchingStatus,
} from '../apps/web/src/types/domain';

export function generateShopData(
  shopName: string,
  merchantId: string,
  totalOrders: number = 3000
): {
  orders: Order[];
  shipments: Shipment[];
  statementRows: StatementRow[];
  rateCard: RateCard;
} {
  const rateCard: RateCard = {
    id: `rc_${merchantId}`,
    merchant_id: merchantId,
    carrier_account_id: `acc_ghn_${merchantId}`,
    version: 1,
    effective_from: new Date('2026-06-01'),
    effective_to: null,
    volumetric_divisor: 5000,
    cod_payout_sla_days: 3,
    checksum: 'sha256_mock_rate_card',
    tiers: [
      {
        id: 'tier_intra_1',
        rate_card_id: `rc_${merchantId}`,
        route_type: 'INTRA_PROVINCE',
        weight_from_g: 0,
        weight_to_g: 500,
        base_fee: 22000,
        step_fee: 3500,
        step_weight_g: 500,
      },
      {
        id: 'tier_inter_1',
        rate_card_id: `rc_${merchantId}`,
        route_type: 'INTER_PROVINCE',
        weight_from_g: 0,
        weight_to_g: 500,
        base_fee: 32000,
        step_fee: 5000,
        step_weight_g: 500,
      },
    ],
  };

  const orders: Order[] = [];
  const shipments: Shipment[] = [];
  const statementRows: StatementRow[] = [];

  const now = Date.now();

  for (let i = 1; i <= totalOrders; i++) {
    const orderCode = `ORD_${shopName.slice(0, 3).toUpperCase()}_${i.toString().padStart(5, '0')}`;
    const trackingCode = `GHN${i.toString().padStart(8, '0')}`;
    const codAmount = (Math.floor(Math.random() * 5) + 1) * 150000; // 150k, 300k, 450k, 600k, 750k
    const declaredWeight = 350; // 350g
    const isDelivered = i <= totalOrders * 0.92; // 92% giao thành công

    const order: Order = {
      id: `ord_${merchantId}_${i}`,
      merchant_id: merchantId,
      order_code: orderCode,
      created_at: new Date(now - (90 - Math.floor(i / 35)) * 24 * 3600 * 1000),
      cod_amount: codAmount,
      declared_weight_g: declaredWeight,
      dimensions_cm: { length: 15, width: 10, height: 10 }, // vol = (15*10*10)/5000*1000 = 300g < 350g
      recipient_name: `Khách Hàng ${i}`,
      recipient_phone: `0987${i.toString().padStart(6, '0')}`,
      recipient_province: i % 2 === 0 ? 'TP. Hồ Chí Minh' : 'Hà Nội',
      recipient_address: `${i} Đường Số 1, Phường Tân Định`,
      item_value: codAmount,
    };
    orders.push(order);

    const deliveredDate = isDelivered
      ? new Date(now - Math.floor(Math.random() * 20) * 24 * 3600 * 1000)
      : null;

    const shipment: Shipment = {
      id: `ship_${merchantId}_${i}`,
      merchant_id: merchantId,
      order_id: order.id,
      order_code: orderCode,
      carrier_code: CarrierCode.GHN,
      carrier_account_id: rateCard.carrier_account_id,
      tracking_code: trackingCode,
      current_status: isDelivered ? ShipmentStatus.DELIVERED : ShipmentStatus.RETURNING,
      declared_weight_g: declaredWeight,
      dimensions_cm: order.dimensions_cm,
      quoted_fee: 22000,
      cod_amount: codAmount,
      delivered_at: deliveredDate,
      cod_paid_at: isDelivered ? deliveredDate : null,
      created_at: order.created_at,
      version: 1,
    };
    shipments.push(shipment);

    // Tạo dòng sao kê tương ứng (với một số sai lệch cố ý để kiểm thử)
    if (isDelivered) {
      let chargedWeight = declaredWeight;
      let chargedFee = 22000;
      let codCollected = codAmount;

      // Cài đặt một số trường hợp sai lệch thực tế:
      if (i % 150 === 0) {
        // Sai lệch D1: Hãng tính cân 850g thay vì 350g
        chargedWeight = 850;
        chargedFee = 29000;
      } else if (i % 200 === 0) {
        // Sai lệch D2: Cước thu 27.000đ thay vì 22.000đ
        chargedFee = 27000;
      } else if (i % 300 === 0) {
        // Sai lệch D5: COD bị lệch (hãng ghi nhận 280k thay vì 300k)
        codCollected = codAmount - 20000;
      }

      statementRows.push({
        id: `row_${merchantId}_${i}`,
        statement_id: `stmt_${merchantId}`,
        line_number: i,
        tracking_code: trackingCode,
        order_code: orderCode,
        fee_type: 'MAIN_FREIGHT',
        charged_weight_g: chargedWeight,
        charged_fee: chargedFee,
        cod_collected: codCollected,
        cod_paid_at: deliveredDate || undefined,
        match_status: MatchingStatus.UNMATCHED,
      });

      // Thêm một số dòng D4 (Khấu trừ trùng)
      if (i === 100 || i === 500 || i === 1200) {
        statementRows.push({
          id: `row_${merchantId}_dup_${i}`,
          statement_id: `stmt_${merchantId}`,
          line_number: totalOrders + i,
          tracking_code: trackingCode,
          order_code: orderCode,
          fee_type: 'MAIN_FREIGHT',
          charged_weight_g: chargedWeight,
          charged_fee: chargedFee,
          cod_collected: codCollected,
          match_status: MatchingStatus.UNMATCHED,
        });
      }
    }
  }

  return { orders, shipments, statementRows, rateCard };
}
