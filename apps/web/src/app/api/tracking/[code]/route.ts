import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const normCode = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    return NextResponse.json({
      success: true,
      data: {
        tracking_code: normCode,
        carrier_name: normCode.startsWith('GHN') ? 'GHN Express' : 'Giao Hàng Tiết Kiệm (GHTK)',
        status: 'DELIVERING',
        status_text: 'Đang giao hàng (Hẹn lại ca chiều)',
        estimated_delivery: '17/08/2026',
        masked_recipient: {
          name: 'Nguyễn V*** H***',
          phone_masked: '0912***5678',
          address_masked: 'Phường Tân Định, Quận 1, TP. Hồ Chí Minh',
        },
        milestones: [
          {
            time: '16/08/2026 08:30',
            title: 'Hẹn giao lại',
            desc: 'Bưu tá đã liên hệ, khách hẹn dời sang chiều 17/08',
          },
          {
            time: '16/08/2026 07:15',
            title: 'Đang phát hàng',
            desc: 'Bưu tá Lê Hoàng Minh đang đi giao',
          },
          {
            time: '15/08/2026 21:00',
            title: 'Nhập kho phát Tân Bình',
            desc: 'Kiện hàng đã đến kho phát',
          },
          {
            time: '14/08/2026 14:20',
            title: 'Đã lấy hàng',
            desc: 'Lấy hàng thành công từ người gửi',
          },
        ],
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
