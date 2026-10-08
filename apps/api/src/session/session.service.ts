import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatusEnum } from '@prisma/client';
import { formatStructuredLog } from '@shipde/config';

export interface RevokeAllDto {
  include_current?: boolean;
}

const ABSOLUTE_LIFETIME_DAYS = 90;
const INACTIVITY_DAYS = 30;

@Injectable()
export class SessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    merchantId: string,
    currentSessionTokenHash?: string,
    correlationId?: string
  ) {
    const now = new Date();
    const sessions = await this.prisma.deviceSession.findMany({
      where: {
        merchant_id: merchantId,
        user_id: userId,
        status: { in: [SessionStatusEnum.ACTIVE, SessionStatusEnum.EXPIRED] },
      },
      orderBy: { last_active_at: 'desc' },
    });

    const inactivityThreshold = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const results = sessions.map((s) => {
      const isExpiredByInactivity = s.last_active_at < inactivityThreshold;
      const isExpiredByAbsolute = s.expires_at < now;
      const isExpired = isExpiredByInactivity || isExpiredByAbsolute;
      const effectiveStatus = isExpired ? SessionStatusEnum.EXPIRED : s.status;

      return {
        session_id: s.id,
        device_id: s.device_id,
        device_model: s.device_model,
        user_agent: s.user_agent,
        ip_address: s.ip_address,
        status: effectiveStatus,
        last_active_at: s.last_active_at.toISOString(),
        expires_at: s.expires_at.toISOString(),
        created_at: s.created_at.toISOString(),
        is_current:
          currentSessionTokenHash != null && s.session_token_hash === currentSessionTokenHash,
      };
    });

    return {
      data: results,
      meta: { total: results.length, correlation_id: correlationId || 'system' },
    };
  }

  async validateSession(tokenHash: string): Promise<{
    userId: string;
    merchantId: string;
    sessionId: string;
  } | null> {
    const now = new Date();
    const inactivityThreshold = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.deviceSession.findFirst({
      where: {
        session_token_hash: tokenHash,
        status: SessionStatusEnum.ACTIVE,
        expires_at: { gt: now },
        last_active_at: { gt: inactivityThreshold },
      },
    });

    if (!session) {
      return null;
    }

    return {
      userId: session.user_id,
      merchantId: session.merchant_id,
      sessionId: session.id,
    };
  }

  async revoke(
    sessionId: string,
    userId: string,
    merchantId: string,
    correlationId: string,
    reason = 'User requested revocation',
    ipAddress?: string
  ) {
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Không tìm thấy phiên làm việc',
          retryable: false,
        },
      });
    }

    if (session.merchant_id !== merchantId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền truy cập phiên của cửa hàng khác',
          retryable: false,
        },
      });
    }

    if (session.user_id !== userId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền cập nhật phiên của người dùng khác',
          retryable: false,
        },
      });
    }

    if (
      session.status === SessionStatusEnum.REVOKED ||
      session.status === SessionStatusEnum.EXPIRED
    ) {
      if (session.status === SessionStatusEnum.REVOKED) {
        await this.logAudit({
          merchantId,
          userId,
          actor: userId,
          action: 'SESSION_REVOKED',
          resource: `Session:${sessionId}`,
          details: { reason: 'Idempotent call', device_id: session.device_id },
          correlationId,
          ipAddress,
        });
      }

      return {
        session_id: session.id,
        status: session.status,
        message:
          session.status === SessionStatusEnum.REVOKED
            ? 'Phiên đã được thu hồi trước đó'
            : 'Phiên đã hết hạn',
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedSession = await tx.deviceSession.update({
        where: { id: sessionId },
        data: {
          status: SessionStatusEnum.REVOKED,
          is_revoked: true,
          revoked_at: new Date(),
          revoked_by: userId,
          revoke_reason: reason,
        },
      });

      await this.logAudit(
        {
          merchantId,
          userId,
          actor: userId,
          action: 'SESSION_REVOKED',
          resource: `Session:${sessionId}`,
          details: { reason, device_id: session.device_id },
          correlationId,
          ipAddress,
        },
        tx
      );

      return updatedSession;
    });

    return {
      session_id: updated.id,
      status: updated.status,
      message: 'Phiên đã được thu hồi',
    };
  }

  async revokeAll(
    userId: string,
    merchantId: string,
    currentSessionId: string | undefined,
    dto: RevokeAllDto,
    correlationId: string,
    ipAddress?: string
  ) {
    const includeCurrent = dto.include_current === true;
    const where: Record<string, unknown> = {
      merchant_id: merchantId,
      user_id: userId,
      status: SessionStatusEnum.ACTIVE,
    };

    if (!includeCurrent && currentSessionId) {
      where.id = { not: currentSessionId };
    }

    const activeSessions = await this.prisma.deviceSession.findMany({ where });

    if (activeSessions.length === 0) {
      return { revoked_count: 0, message: 'Không có phiên nào cần thu hồi' };
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.deviceSession.updateMany({
        where: { id: { in: activeSessions.map((s) => s.id) } },
        data: {
          status: SessionStatusEnum.REVOKED,
          is_revoked: true,
          revoked_at: now,
          revoked_by: userId,
          revoke_reason: 'Revoke all sessions',
        },
      });

      await this.logAudit(
        {
          merchantId,
          userId,
          actor: userId,
          action: 'SESSIONS_REVOKED_ALL',
          resource: `User:${userId}`,
          details: { revoked_count: activeSessions.length, include_current: includeCurrent },
          correlationId,
          ipAddress,
        },
        tx
      );
    });

    return {
      revoked_count: activeSessions.length,
      message: `Đã thu hồi ${activeSessions.length} phiên`,
    };
  }

  async heartbeat(
    sessionId: string,
    userId: string,
    merchantId: string,
    currentSessionId?: string
  ) {
    const session = await this.prisma.deviceSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Không tìm thấy phiên làm việc',
          retryable: false,
        },
      });
    }

    if (session.merchant_id !== merchantId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền truy cập phiên của cửa hàng khác',
          retryable: false,
        },
      });
    }

    if (session.user_id !== userId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền cập nhật phiên của người dùng khác',
          retryable: false,
        },
      });
    }

    if (currentSessionId && sessionId !== currentSessionId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Chỉ có thể cập nhật trạng thái hoạt động cho phiên hiện tại',
          retryable: false,
        },
      });
    }

    if (session.status !== SessionStatusEnum.ACTIVE) {
      throw new ForbiddenException({
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Phiên không còn hoạt động',
          retryable: false,
        },
      });
    }

    const updated = await this.prisma.deviceSession.update({
      where: { id: sessionId },
      data: { last_active_at: new Date() },
    });

    return {
      session_id: updated.id,
      last_active_at: updated.last_active_at.toISOString(),
    };
  }

  private hashIp(ip: string): string {
    return createHmac(
      'sha256',
      process.env.AUDIT_IDENTIFIER_HMAC_KEY || 'default-dev-audit-hmac-key-override-32-chars'
    )
      .update(ip)
      .digest('hex');
  }

  private async logAudit(
    meta: {
      merchantId: string;
      userId?: string;
      actor: string;
      action: string;
      resource: string;
      details?: Record<string, unknown>;
      correlationId?: string;
      ipAddress?: string;
    },
    tx: any = this.prisma
  ): Promise<void> {
    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'api',
        message: `AUDIT: ${meta.action} on ${meta.resource} by ${meta.actor}`,
        metadata: { ...meta, timestamp: new Date().toISOString() },
      })
    );

    try {
      await tx.auditLog.create({
        data: {
          merchant_id: meta.merchantId,
          user_id: meta.userId || null,
          action: meta.action,
          entity_type: meta.resource.split(':')[0] || 'Session',
          entity_id: meta.resource.split(':')[1] || meta.userId || 'system',
          new_value: meta.details ? JSON.parse(JSON.stringify(meta.details)) : null,
          ip_address: meta.ipAddress ? this.hashIp(meta.ipAddress) : null,
        },
      });
    } catch (err) {
      console.error('Failed to persist audit log:', err);
      throw err;
    }
  }
}
