import { NextRequest, NextResponse } from 'next/server';

const API_BASE =
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ADMIN_API_KEY =
  process.env.ADMIN_API_KEY || process.env.ADMIN_KEY || 'shipde-admin-dev-secret-key-32-chars';

function isAuthorized(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const tokenCookie = req.cookies.get('token')?.value || req.cookies.get('session')?.value;
  const adminKeyHeader = req.headers.get('x-admin-key') || req.headers.get('x-api-key');

  // Check if admin key or session token is present
  if (adminKeyHeader) {
    return adminKeyHeader === ADMIN_API_KEY;
  }
  return Boolean(authHeader || tokenCookie);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Truy cập bị từ chối: Yêu cầu đăng nhập quản trị viên',
        },
      },
      { status: 403 }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '20';
  const offset = searchParams.get('offset') || '0';
  const search = searchParams.get('search') || '';

  try {
    const query = new URLSearchParams({ limit, offset, ...(search ? { search } : {}) });
    const res = await fetch(`${API_BASE}/admin/shops?${query.toString()}`, {
      headers: {
        'x-admin-key': ADMIN_API_KEY,
        Accept: 'application/json',
      },
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Graceful offline fallback in development/test
    return NextResponse.json(
      {
        success: true,
        data: {
          shops: [],
          total: 0,
        },
      },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Truy cập bị từ chối: Yêu cầu đăng nhập quản trị viên',
        },
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();

    const res = await fetch(`${API_BASE}/admin/shops`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_API_KEY,
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ quản trị',
        },
      },
      { status: 500 }
    );
  }
}
