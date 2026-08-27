import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { MatchingEngine } from '@/core/matching-engine';
import { PancakePosAdapter } from '@/adapters/pancake.adapter';

const matchingEngine = new MatchingEngine();
const pancakeAdapter = new PancakePosAdapter();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.toLowerCase();
    const status = searchParams.get('status');
    const carrier = searchParams.get('carrier');

    let list = db.shipments;

    if (search) {
      list = list.filter(
        (s) =>
          s.tracking_code.toLowerCase().includes(search) ||
          s.order_code.toLowerCase().includes(search)
      );
    }
    if (status) {
      list = list.filter((s) => s.current_status === status);
    }
    if (carrier) {
      list = list.filter((s) => s.carrier_code === carrier);
    }

    return NextResponse.json({
      success: true,
      total: list.length,
      data: list,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // Simulate Pancake POS Sync
    if (action === 'SYNC_PANCAKE') {
      const trackingNum = `GHN8829${Math.floor(Math.random() * 8999) + 1000}`;
      const mockPancakePayload = {
        id: `pancake_${Date.now()}`,
        order_number: `ORD_PANCAKE_${Math.floor(Math.random() * 8999) + 1000}`,
        inserted_at: new Date().toISOString(),
        total_price: 550000,
        cod: 550000,
        weight: 400,
        bill_full_name: 'Khách hàng Pancake POS',
        bill_phone_number: '0909112233',
        shipping_address: {
          province: 'TP. Hồ Chí Minh',
          district: 'Quận 1',
          full_address: '55 Lê Lợi, Phường Bến Nghé, Quận 1',
        },
        partner: {
          partner_name: 'GHN',
          tracking_number: trackingNum,
        },
      };

      const normalized = pancakeAdapter.normalizeOrder(mockPancakePayload, db.merchant.id);
      db.orders.unshift(normalized.order);

      let createdShipment = undefined;
      if (normalized.rawTrackingCode) {
        createdShipment = {
          id: `ship_${Date.now()}`,
          merchant_id: db.merchant.id,
          order_id: normalized.order.id,
          order_code: normalized.order.order_code,
          carrier_code: 'GHN' as any,
          carrier_account_id: 'acc_ghn_01',
          tracking_code: normalized.rawTrackingCode,
          current_status: 'out_for_delivery' as any,
          declared_weight_g: normalized.order.declared_weight_g,
          quoted_fee: 22000,
          cod_amount: normalized.order.cod_amount,
          created_at: new Date(),
          version: 1,
        };
        db.shipments.unshift(createdShipment);
      }

      return NextResponse.json({
        success: true,
        message: 'Đồng bộ đơn hàng từ Pancake POS Open API thành công',
        data: {
          synced_orders: 1,
          order: normalized.order,
          shipment: createdShipment,
        },
      });
    }

    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Hành động không hợp lệ' } },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
