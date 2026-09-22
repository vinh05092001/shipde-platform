import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');

    let list = db.deviceSessions;

    if (status) {
      if (status === 'active') {
        list = list.filter((s) => !s.is_revoked);
      } else if (status === 'revoked') {
        list = list.filter((s) => s.is_revoked);
      }
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
    const url = new URL(req.url);
    const path = url.pathname;

    // POST /api/sessions/revoke-all
    if (path.endsWith('/revoke-all')) {
      const body = await req.json();
      const { include_current = true } = body;
      const revokedCount = db.deviceSessions.filter((s) => include_current || s.id !== 'dev_current').length;
      db.deviceSessions.forEach((s) => {
        if (include_current || s.id !== 'dev_current') {
          s.is_revoked = true;
        }
      });
      return NextResponse.json({
        success: true,
        message: `Đã thu hồi ${revokedCount} phiên`,
        revoked_count: revokedCount,
      });
    }

    const { device_id, user_id } = await req.json();

    if (!device_id || !user_id) {
      return NextResponse.json(
        { success: false, error: { code: 'validation_error', message: 'Thiếu device_id hoặc user_id' } },
        { status: 400 }
      );
    }

    const newSession = {
      id: `dev_${Date.now()}`,
      user_id,
      user_name: 'Người dùng mới',
      device: device_id,
      last_active: 'Vừa tạo',
      is_revoked: false,
    };

    db.deviceSessions.unshift(newSession);

    return NextResponse.json({
      success: true,
      message: 'Đã tạo phiên làm việc mới',
      data: newSession,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
