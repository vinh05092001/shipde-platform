import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { OfflineScanQueueManager, OfflineScanCommand } from '@/core/offline-queue';
import { ReturnRecord, ShipmentStatus } from '@/types/domain';

const queueManager = new OfflineScanQueueManager();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('q')?.toLowerCase();

    let list = db.returnRecords.map((r) => {
      const ship = db.shipments.find((s) => s.tracking_code === r.tracking_code);
      const order = ship ? db.orders.find((o) => o.order_code === ship.order_code) : undefined;
      return {
        ...r,
        order_code: ship?.order_code || `ORD_${r.tracking_code}`,
        carrier: ship?.carrier_code || (r.tracking_code.startsWith('GHN') ? 'GHN' : 'GHTK'),
        customer_name: order?.recipient_name || 'Khách hàng',
        cod_amount: ship?.cod_amount || order?.cod_amount || 0,
      };
    });

    if (search) {
      list = list.filter(
        (r) =>
          r.tracking_code.toLowerCase().includes(search) ||
          r.order_code.toLowerCase().includes(search) ||
          r.customer_name.toLowerCase().includes(search)
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
      tracking_code,
      warehouse_id,
      condition,
      evidence_urls,
      scanned_by,
      commands,
      is_device_revoked,
    } = body;

    // BATCH SYNC OFFLINE COMMANDS (BR-40)
    if (action === 'SYNC_OFFLINE_BATCH' || commands) {
      const result = queueManager.syncOfflineBatch(
        (commands || []) as OfflineScanCommand[],
        Boolean(is_device_revoked)
      );

      // Persist newly scanned receipts into DB
      commands?.forEach((cmd: OfflineScanCommand) => {
        if (!db.returnRecords.some((r) => r.tracking_code === cmd.barcode)) {
          const newReturn: ReturnRecord = {
            id: `ret_${Date.now()}_${Math.floor(Math.random() * 999)}`,
            merchant_id: db.merchant.id,
            shipment_id: `ship_${cmd.barcode}`,
            tracking_code: cmd.barcode,
            warehouse_id: cmd.warehouse_id || 'wh_tanbinh',
            condition: (cmd.condition as any) || 'intact',
            scanned_at: new Date(cmd.captured_at),
            scanned_by: cmd.user_id || 'usr_04',
            evidence_urls: cmd.evidence_urls || [],
          };
          db.returnRecords.unshift(newReturn);

          const matchedShip = db.shipments.find((s) => s.tracking_code === cmd.barcode);
          if (matchedShip) {
            matchedShip.current_status = ShipmentStatus.RETURNED;
          }
        }
      });

      return NextResponse.json({
        success: true,
        message: `Đồng bộ hoàn tất: ${result.newly_created} kiện mới ghi nhận, ${result.duplicates_skipped} lệnh trùng đã bỏ qua an toàn.`,
        data: result,
      });
    }

    // SINGLE SCAN RECEIPT (CN-12)
    if (!tracking_code) {
      return NextResponse.json(
        { error: { code: 'validation_error', message: 'Vui lòng quét hoặc nhập mã vận đơn' } },
        { status: 400 }
      );
    }

    const normCode = tracking_code.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Mandatory Evidence Rule (BR-36)
    if (condition && condition !== 'intact' && (!evidence_urls || evidence_urls.length === 0)) {
      return NextResponse.json(
        {
          error: {
            code: 'evidence_required',
            message:
              'Hàng hoàn bị hư hỏng hoặc sai lệch bắt buộc phải đính kèm ảnh chụp chứng cứ (BR-36).',
          },
        },
        { status: 422 }
      );
    }

    const newRecord: ReturnRecord = {
      id: `ret_${Date.now()}`,
      merchant_id: db.merchant.id,
      shipment_id: `ship_${normCode}`,
      tracking_code: normCode,
      warehouse_id: warehouse_id || 'wh_tanbinh',
      condition: condition || 'intact',
      scanned_at: new Date(),
      scanned_by: scanned_by || 'usr_04',
      evidence_urls: evidence_urls || [],
    };

    db.returnRecords.unshift(newRecord);

    const matchedShipment = db.shipments.find((s) => s.tracking_code === normCode);
    if (matchedShipment) {
      matchedShipment.current_status = ShipmentStatus.RETURNED;
      matchedShipment.version += 1;
    }

    return NextResponse.json({
      success: true,
      message: `Đã quét nhận kiện hoàn ${normCode} vào kho thành công`,
      data: newRecord,
    });
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
