import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';

/**
 * POST /api/sessions/revoke-all
 *
 * FEAT-AUTH-06 — Web UI proxy for revoke-all sessions.
 * This in-memory implementation serves the standalone prototype.
 * The production path routes to the NestJS API at /api/v1/sessions/revoke-all.
 *
 * BR-SESS-08: Revoke all sessions (logout everywhere).
 * BR-SESS-10: Optionally keeps the current session alive.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { include_current = false } = body;

    const toRevoke = db.deviceSessions.filter(
      (s) => !s.is_revoked && (include_current || s.id !== 'dev_current')
    );
    const revokedCount = toRevoke.length;

    toRevoke.forEach((s) => {
      s.is_revoked = true;
    });

    return NextResponse.json({
      success: true,
      message: `Đã thu hồi ${revokedCount} phiên`,
      revoked_count: revokedCount,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
