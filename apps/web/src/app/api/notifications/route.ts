import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    data: {
      matrix: db.notificationMatrix,
      digest_window_minutes: db.digestWindowMinutes,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { matrix, digest_window_minutes } = body;

    if (matrix && Array.isArray(matrix)) {
      db.notificationMatrix = matrix;
    }
    if (digest_window_minutes !== undefined) {
      db.digestWindowMinutes = Number(digest_window_minutes);
    }

    return NextResponse.json({
      success: true,
      message: 'Cập nhật ma trận thông báo & ngưỡng gộp tin thành công (CN-19, BR-23)',
      data: {
        matrix: db.notificationMatrix,
        digest_window_minutes: db.digestWindowMinutes,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
