import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { Order, Shipment, ShipmentStatus, CarrierCode } from '@/types/domain';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.toLowerCase();

    let list = db.orders;
    if (search) {
      list = list.filter(
        (o) =>
          o.order_code.toLowerCase().includes(search) ||
          o.recipient_name.toLowerCase().includes(search) ||
          o.recipient_phone.includes(search)
      );
    }

    return NextResponse.json({ success: true, total: list.length, data: list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      order_code,
      cod_amount,
      declared_weight_g,
      recipient_name,
      recipient_phone,
      recipient_province,
      recipient_address,
      carrier_code,
      tracking_code,
    } = body;

    if (!order_code || !recipient_name || !recipient_phone) {
      return NextResponse.json(
        {
          error: {
            code: 'validation_error',
            message: 'Vui lòng điền đầy đủ mã đơn, tên và SĐT người nhận',
          },
        },
        { status: 400 }
      );
    }

    // Check duplicate
    if (db.orders.some((o) => o.order_code.toUpperCase() === order_code.toUpperCase())) {
      return NextResponse.json(
        {
          error: {
            code: 'order_duplicate',
            message: `Mã đơn hàng ${order_code} đã tồn tại trên hệ thống`,
          },
        },
        { status: 409 }
      );
    }

    const newOrder: Order = {
      id: `ord_${Date.now()}`,
      merchant_id: db.merchant.id,
      order_code: order_code.toUpperCase(),
      created_at: new Date(),
      cod_amount: Number(cod_amount) || 0,
      declared_weight_g: Number(declared_weight_g) || 500,
      recipient_name,
      recipient_phone,
      recipient_province: recipient_province || 'TP. Hồ Chí Minh',
      recipient_address: recipient_address || 'Chưa cập nhật địa chỉ',
      item_value: Number(cod_amount) || 0,
    };

    db.orders.unshift(newOrder);

    // Auto-create shipment if tracking code provided
    if (tracking_code) {
      const newShipment: Shipment = {
        id: `ship_${Date.now()}`,
        merchant_id: db.merchant.id,
        order_id: newOrder.id,
        order_code: newOrder.order_code,
        carrier_code: (carrier_code as CarrierCode) || CarrierCode.GHN,
        carrier_account_id: carrier_code === 'GHTK' ? 'acc_ghtk_01' : 'acc_ghn_01',
        tracking_code: tracking_code.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        current_status: ShipmentStatus.DRAFT,
        declared_weight_g: newOrder.declared_weight_g,
        quoted_fee: 22000,
        cod_amount: newOrder.cod_amount,
        created_at: new Date(),
        version: 1,
      };
      db.shipments.unshift(newShipment);
    }

    return NextResponse.json({ success: true, message: 'Tạo đơn hàng thành công', data: newOrder });
  } catch (error: any) {
    return NextResponse.json(
      { error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
