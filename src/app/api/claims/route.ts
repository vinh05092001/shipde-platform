import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { Claim } from '@/types/domain';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.toLowerCase();
    const status = searchParams.get('status');

    let list = db.claims.map((clm) => {
      const ship = db.shipments.find(
        (s) => s.id === clm.shipment_id || s.tracking_code.includes(clm.carrier_ticket || '')
      );
      const order = ship ? db.orders.find((o) => o.id === ship.order_id) : undefined;
      const now = Date.now();
      const hoursRemaining = Math.max(
        0,
        Math.round((new Date(clm.deadline_at).getTime() - now) / (3600 * 1000))
      );

      return {
        ...clm,
        tracking_code: ship?.tracking_code || 'GHN88290500',
        order_code: ship?.order_code || 'ORD_ANAN_103',
        carrier: ship?.carrier_code || (clm.carrier_ticket?.startsWith('GHN') ? 'GHN' : 'GHTK'),
        hours_remaining: hoursRemaining,
        is_urgent: hoursRemaining <= 48 && hoursRemaining > 0 && clm.status !== 'CLOSED',
      };
    });

    if (search) {
      list = list.filter(
        (c) =>
          c.tracking_code.toLowerCase().includes(search) ||
          c.order_code.toLowerCase().includes(search) ||
          (c.carrier_ticket && c.carrier_ticket.toLowerCase().includes(search))
      );
    }
    if (status) {
      list = list.filter((c) => c.status === status);
    }

    return NextResponse.json({ success: true, total: list.length, data: list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, tracking_code, claim_type, requested_amount, evidence_pack_url } = body;

    if (action === 'CREATE_CLAIM' || !action) {
      if (!tracking_code || !claim_type || !requested_amount) {
        return NextResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Vui lòng điền đầy đủ mã vận đơn, loại khiếu nại và số tiền yêu cầu',
            },
          },
          { status: 400 }
        );
      }

      const normCode = tracking_code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const ship = db.shipments.find((s) => s.tracking_code === normCode);

      const newClaim: Claim = {
        id: `clm_${Date.now()}`,
        merchant_id: db.merchant.id,
        shipment_id: ship?.id || `ship_${normCode}`,
        claim_type,
        carrier_ticket: `${normCode.startsWith('GHN') ? 'GHN' : 'GHTK'}_TCK_${Math.floor(Math.random() * 89999) + 10000}`,
        requested_amount: Number(requested_amount),
        accepted_amount: 0,
        recovered_amount: 0,
        status: 'SUBMITTED',
        deadline_at: new Date(Date.now() + 48 * 3600 * 1000), // 48h SLA
        evidence_pack_url:
          evidence_pack_url || `https://storage.shipde.net/evidence/${normCode}.zip`,
        created_at: new Date(),
        updated_at: new Date(),
      };

      db.claims.unshift(newClaim);

      return NextResponse.json({
        success: true,
        message: `Đã mở hồ sơ khiếu nại mã ${newClaim.carrier_ticket} thành công (CN-16)`,
        data: newClaim,
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
