import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * POST /api/admin/shops/owner
 *
 * Server-side proxy to the platform backend's admin shop creation endpoint.
 * The X-Platform-Admin-Key header is read from process.env, never exposed to the client.
 *
 * Forwards the JSON request body (AdminCreateShopRequest) to backend POST /admin/shops.
 * Returns the backend's JSON response verbatim (status code + body).
 * Returns a 502 on network/proxy failure so the client can render a graceful error.
 */
export async function POST(req: NextRequest) {
  const adminKey = process.env.PLATFORM_ADMIN_KEY;

  if (!adminKey) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Chìa khóa quản trị nền tảng chưa được cấu hình trên máy chủ.',
        },
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Yêu cầu không chứa JSON hợp lệ.',
        },
      },
      { status: 400 }
    );
  }

  try {
    const backendRes = await fetch(`${BACKEND_BASE}/admin/shops`, {
      method: 'POST',
      headers: {
        'X-Platform-Admin-Key': adminKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const responseBody = await backendRes.json().catch(() => ({}));
    return NextResponse.json(responseBody, { status: backendRes.status });
  } catch (_error) {
    return NextResponse.json(
      {
        error: {
          code: 'NETWORK_ERROR',
          message: 'Không thể kết nối đến máy chủ nền tảng. Vui lòng thử lại sau.',
        },
      },
      { status: 502 }
    );
  }
}
