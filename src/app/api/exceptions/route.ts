import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { ExceptionEngine } from '@/core/exception-engine';
import { GhnCarrierAdapter } from '@/adapters/ghn.adapter';
import { GhtkCarrierAdapter } from '@/adapters/ghtk.adapter';
import { CarrierCapabilityTier, ExceptionCaseStatus, ShipmentStatus } from '@/types/domain';

const excEngine = new ExceptionEngine();
const ghnAdapter = new GhnCarrierAdapter();
const ghtkAdapter = new GhtkCarrierAdapter();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const search = searchParams.get('q')?.toLowerCase();

    let list = db.exceptionCases.map((exc) => {
      const shipment = db.shipments.find(
        (s) => s.id === exc.shipment_id || s.tracking_code === exc.tracking_code
      );
      const order = shipment
        ? db.orders.find((o) => o.id === shipment.order_id || o.order_code === shipment.order_code)
        : undefined;
      return {
        ...exc,
        order_code: shipment?.order_code || `ORD_${exc.tracking_code}`,
        carrier_code:
          shipment?.carrier_code || (exc.tracking_code.startsWith('GHN') ? 'GHN' : 'GHTK'),
        customer_name: order?.recipient_name || 'Khách hàng',
        customer_phone: order?.recipient_phone || '0912345678',
        customer_address: order?.recipient_address || 'Địa chỉ giao hàng',
        cod_amount: shipment?.cod_amount || order?.cod_amount || 450000,
      };
    });

    if (status) {
      list = list.filter((e) => e.status === status);
    }
    if (search) {
      list = list.filter(
        (e) =>
          e.tracking_code.toLowerCase().includes(search) ||
          e.order_code.toLowerCase().includes(search) ||
          e.customer_name.toLowerCase().includes(search)
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
      action,
      case_id,
      tracking_code,
      carrier_code,
      note,
      new_phone,
      scheduled_date,
      user_id,
      user_name,
      override_tier,
      call_result,
    } = body;

    const targetCase = db.exceptionCases.find(
      (e) => e.id === case_id || e.tracking_code === tracking_code
    );
    if (!targetCase) {
      return NextResponse.json(
        { error: { code: 'case_not_found', message: 'Không tìm thấy hồ sơ ngoại lệ' } },
        { status: 404 }
      );
    }

    const targetShipment = db.shipments.find(
      (s) => s.id === targetCase.shipment_id || s.tracking_code === targetCase.tracking_code
    );
    if (!targetShipment) {
      return NextResponse.json(
        { error: { code: 'shipment_not_found', message: 'Không tìm thấy vận đơn tương ứng' } },
        { status: 404 }
      );
    }

    // DISPATCH REATTEMPT (CN-10)
    if (action === 'DISPATCH_REATTEMPT' || !action) {
      const carrierAccount = db.carrierAccounts.find(
        (a) => a.carrier_code === targetShipment.carrier_code
      );
      const adapter = targetShipment.carrier_code === 'GHN' ? ghnAdapter : ghtkAdapter;
      const currentTier = override_tier || carrierAccount?.capability_tier || adapter.defaultTier;

      const result = await excEngine.dispatchReattempt(
        targetCase,
        targetShipment,
        adapter,
        { token: 'valid_carrier_token' },
        {
          userId: user_id || 'usr_02',
          userName: user_name || 'Trần Thị Hoa (CSKH)',
          note: note || 'Khách hẹn giao lại ca chiều',
          scheduledDate: scheduled_date ? new Date(scheduled_date) : undefined,
          newPhone: new_phone,
          overrideTier: currentTier as CarrierCapabilityTier,
        }
      );

      // Update Database State
      targetCase.status = ExceptionCaseStatus.REATTEMPT_REQUESTED;
      targetCase.version += 1;
      targetShipment.last_modified_by = user_id || 'usr_02';
      targetShipment.version += 1;

      // Add timeline event
      db.shipmentEvents.unshift({
        id: `evt_${Date.now()}`,
        shipment_id: targetShipment.id,
        raw_status: 'reattempt_scheduled',
        normalized_status: ShipmentStatus.OUT_FOR_DELIVERY,
        occurred_at: new Date(),
        received_at: new Date(),
        source: 'POLLING',
        raw_payload: {
          action: 'DISPATCH_REATTEMPT',
          executed_by: user_name || 'CSKH',
          tier: result.tier_executed,
          note: note || 'Khách hẹn giao lại',
          reference_id: result.reference_id,
        },
      });

      return NextResponse.json({
        success: true,
        message:
          result.tier_executed === CarrierCapabilityTier.L2_EXECUTE
            ? 'Đã gửi yêu cầu hẹn giao lại trực tiếp qua API hãng thành công (GHN L2)'
            : 'Đã tạo và xuất trọn gói hồ sơ hỗ trợ CSKH gửi cổng hãng (GHTK L1 Assist)',
        data: {
          case: targetCase,
          shipment: targetShipment,
          reattempt_result: result,
        },
      });
    }

    // RECORD CONTACT LOG (CN-09)
    if (action === 'RECORD_CONTACT') {
      db.shipmentEvents.unshift({
        id: `evt_${Date.now()}`,
        shipment_id: targetShipment.id,
        raw_status: 'cskh_contact_logged',
        normalized_status: targetShipment.current_status,
        occurred_at: new Date(),
        received_at: new Date(),
        source: 'POLLING',
        raw_payload: {
          call_result: call_result || 'CONNECTED',
          note: note || 'Đã liên hệ với khách hàng',
          staff: user_name || 'CSKH Staff',
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Ghi nhận nhật ký liên hệ khách hàng thành công (CN-09)',
        data: targetCase,
      });
    }

    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Hành động không hợp lệ' } },
      { status: 400 }
    );
  } catch (error: any) {
    const status = error.httpStatus || 500;
    return NextResponse.json(
      {
        error: {
          code: error.code || 'server_error',
          message: error.message,
          details: error.details,
        },
      },
      { status }
    );
  }
}
