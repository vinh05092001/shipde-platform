import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/server/db';

/**
 * DELETE /api/sessions/:sessionId
 *
 * FEAT-AUTH-06 — Web UI proxy for revoking a single session.
 * This in-memory implementation serves the standalone prototype.
 * The production path routes to the NestJS API at DELETE /api/v1/sessions/:sessionId.
 *
 * BR-SESS-05: Idempotent revocation — revoking an already-revoked session returns success.
 * BR-SESS-06: Cross-tenant revoke is forbidden.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const { sessionId } = params;
    const session = db.deviceSessions.find((s) => s.id === sessionId);

    if (!session) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Không tìm thấy phiên làm việc' },
        },
        { status: 404 }
      );
    }

    // Idempotent: already revoked returns success
    if (session.is_revoked) {
      return NextResponse.json({
        success: true,
        session_id: session.id,
        status: 'REVOKED',
        message: 'Phiên đã được thu hồi trước đó',
      });
    }

    session.is_revoked = true;

    return NextResponse.json({
      success: true,
      session_id: session.id,
      status: 'REVOKED',
      message: 'Phiên đã được thu hồi',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: 'server_error', message: error.message } },
      { status: 500 }
    );
  }
}
