import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';
import { User, Role } from '@/types/domain';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    data: {
      users: db.users,
      device_sessions: db.deviceSessions,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, full_name, email, phone, role, device_id } = body;

    // INVITE MEMBER (CN-24)
    if (action === 'INVITE_USER') {
      if (!full_name || !email || !role) {
        return NextResponse.json({ error: { code: 'validation_error', message: 'Vui lòng cung cấp họ tên, email và vai trò' } }, { status: 400 });
      }

      const newUser: User = {
        id: `usr_${Date.now()}`,
        merchant_id: db.merchant.id,
        full_name,
        email,
        phone: phone || 'Chờ cập nhật',
        role: role as Role,
        status: 'ACTIVE',
        created_at: new Date(),
      };

      db.users.push(newUser);

      return NextResponse.json({
        success: true,
        message: `Đã gửi mã mời 7 ngày tới ${email} với vai trò ${role} (CN-24)`,
        data: newUser,
      });
    }

    // REMOTE REVOKE DEVICE SESSION (FR-IAM-004, NFR-08, E2E-08)
    if (action === 'REVOKE_DEVICE') {
      const dev = db.deviceSessions.find((d) => d.id === device_id);
      if (!dev) {
        return NextResponse.json({ error: { code: 'device_not_found', message: 'Không tìm thấy thiết bị' } }, { status: 404 });
      }

      dev.is_revoked = true;

      return NextResponse.json({
        success: true,
        message: `Đã thu hồi phiên đăng nhập thiết bị ${dev.device} thành công. Lượt gọi API tiếp theo sẽ trả về mã 401 device_revoked và xóa dữ liệu cục bộ.`,
        data: dev,
      });
    }

    return NextResponse.json({ error: { code: 'bad_request', message: 'Hành động không hợp lệ' } }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: { code: 'server_error', message: error.message } }, { status: 500 });
  }
}
