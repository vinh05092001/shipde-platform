import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE =
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface AuthResult {
  authorized: boolean;
  statusCode: number;
  token?: string;
  message: string;
}

export function verifyAdminAuthorization(req: NextRequest, isMutation = false): AuthResult {
  // State-changing requests must not be authorized by cookies alone (CSRF/origin protection)
  if (isMutation) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return {
            authorized: false,
            statusCode: 403,
            message: 'Truy cập bị từ chối do vi phạm bảo vệ Cross-Origin (CSRF)',
          };
        }
      } catch {
        return {
          authorized: false,
          statusCode: 403,
          message: 'Origin không hợp lệ',
        };
      }
    }
  }

  // Validate signed session token (Bearer token only for mutations; cookies disallowed for mutations)
  let rawToken: string | undefined;
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawToken = authHeader.slice(7).trim();
  } else if (!isMutation) {
    rawToken = req.cookies.get('token')?.value?.trim() || req.cookies.get('session')?.value?.trim();
  } else {
    return {
      authorized: false,
      statusCode: 403,
      message:
        'Yêu cầu thay đổi trạng thái quản trị viên không được phép xác thực chỉ bằng cookie (CSRF)',
    };
  }

  if (!rawToken) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Truy cập bị từ chối: Yêu cầu đăng nhập quản trị viên',
    };
  }

  const tokenSecret = process.env.AUTH_TOKEN_SECRET?.trim();
  if (!tokenSecret) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Khóa ký phiên chưa được cấu hình trên máy chủ (fail-closed)',
    };
  }

  const parts = rawToken.split('.');
  if (parts.length !== 3) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Phiên đăng nhập không hợp lệ',
    };
  }

  const [version, payload, signature] = parts;
  if (version !== 'v1') {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Phiên bản phiên đăng nhập không được hỗ trợ',
    };
  }

  const expectedSig = createHmac('sha256', tokenSecret).update(`${version}.${payload}`).digest();
  const providedSig = Buffer.from(signature, 'base64url');

  if (providedSig.length !== expectedSig.length || !timingSafeEqual(providedSig, expectedSig)) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Chữ ký phiên đăng nhập không hợp lệ',
    };
  }

  let claims: any;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Dữ liệu phiên đăng nhập không hợp lệ',
    };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Phiên đăng nhập đã hết hạn',
    };
  }

  const PLATFORM_ADMIN_ROLES = ['BACKOFFICE', 'PLATFORM_ADMIN', 'ADMIN'];
  if (!claims.role || !PLATFORM_ADMIN_ROLES.includes(claims.role)) {
    return {
      authorized: false,
      statusCode: 403,
      message: 'Truy cập bị từ chối: Yêu cầu quyền quản trị viên nền tảng (PLATFORM_ADMIN)',
    };
  }

  return { authorized: true, statusCode: 200, token: rawToken, message: 'OK' };
}

export async function GET(req: NextRequest) {
  const auth = verifyAdminAuthorization(req);
  if (!auth.authorized) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: auth.message,
        },
      },
      { status: auth.statusCode }
    );
  }

  const searchParams = req.nextUrl.searchParams;
  const limit = searchParams.get('limit') || '20';
  const offset = searchParams.get('offset') || '0';
  const search = searchParams.get('search') || '';

  try {
    const query = new URLSearchParams({ limit, offset, ...(search ? { search } : {}) });
    const forwardHeaders: Record<string, string> = {
      Accept: 'application/json',
    };
    if (auth.token) {
      forwardHeaders['Authorization'] = `Bearer ${auth.token}`;
    }

    const res = await fetch(`${API_BASE}/admin/shops?${query.toString()}`, {
      headers: forwardHeaders,
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'UPSTREAM_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ quản trị',
        },
      },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyAdminAuthorization(req, true);
  if (!auth.authorized) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: auth.message,
        },
      },
      { status: auth.statusCode }
    );
  }

  try {
    const body = await req.json();
    const forwardHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (auth.token) {
      forwardHeaders['Authorization'] = `Bearer ${auth.token}`;
    }

    const res = await fetch(`${API_BASE}/admin/shops`, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      {
        error: {
          code: 'UPSTREAM_ERROR',
          message: err?.message || 'Không thể kết nối đến máy chủ quản trị',
        },
      },
      { status: 502 }
    );
  }
}
