import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * GET /api/admin/shops
 *
 * Server-side proxy to the platform backend's admin shop listing endpoint.
 * The X-Platform-Admin-Key header is read from process.env, never exposed to the client.
 *
 * Forwards `page` and `page_size` query parameters.
 * Returns the backend's JSON response verbatim (status code + body).
 * Returns a 502 on network/proxy failure so the client can render a graceful error.
 */
export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const page = searchParams.get('page') || '1';
  const pageSize = searchParams.get('page_size') || '20';

  const backendUrl = new URL(`${BACKEND_BASE}/admin/shops`);
  backendUrl.searchParams.set('page', page);
  backendUrl.searchParams.set('page_size', pageSize);

  try {
    const backendRes = await fetch(backendUrl.toString(), {
      method: 'GET',
      headers: {
        'X-Platform-Admin-Key': adminKey,
        'Content-Type': 'application/json',
      },
      // Do not store admin shop listing in cache
      cache: 'no-store',
    });

    const body = await backendRes.json().catch(() => ({}));
    return NextResponse.json(body, { status: backendRes.status });
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
