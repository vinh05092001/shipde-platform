import { Injectable, Inject, ForbiddenException, NotFoundException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SessionStatusEnum } from '@prisma/client';
import { formatStructuredLog } from '@shipde/config';

export interface CreateSessionDto {
  user_id: string;
  device_id: string;
  device_model?: string;
  user_agent?: string;
  ip_address?: string;
  fcm_token?: string;
}

export interface RevokeAllDto {
  include_current?: boolean;
}

const ABSOLUTE_LIFETIME_DAYS = 90;
const INACTIVITY_DAYS = 30;

@Injectable()
export class SessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateSessionDto, callerMerchantId: string, correlationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.user_id, merchant_id: callerMerchantId },
    });
    if (!user) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không thể tạo phiên cho người dùng ngoài cửa hàng',
          retryable: false,
        },
      });
    }

    const rawToken = randomBytes(48).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + ABSOLUTE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    const session = await this.prisma.deviceSession.create({
      data: {
        user_id: dto.user_id,
        merchant_id: callerMerchantId,
        session_token_hash: tokenHash,
        device_id: dto.device_id,
        device_model: dto.device_model || null,
        user_agent: dto.user_agent || null,
        ip_address: dto.ip_address ? this.hashIp(dto.ip_address) : null,
        fcm_token: dto.fcm_token || null,
        status: SessionStatusEnum.ACTIVE,
        expires_at: expiresAt,
      },
    });

    await this.logAudit({
      merchantId: callerMerchantId,
      userId: dto.user_id,
      actor: dto.user_id,
      action: 'SESSION_CREATED',
      resource: `Session:${session.id}`,
      details: { device_id: dto.device_id },
      correlationId,
    });

    return {
      session_id: session.id,
      session_token: rawToken,
      device_id: session.device_id,
      device_model: session.device_model,
      status: session.status,
      expires_at: session.expires_at.toISOString(),
      created_at: session.created_at.toISOString(),
    };
  }

  async list(userId: string, merchantId: string, currentSessionTokenHash?: string) {
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

    return { data: results, meta: { total: results.length } };
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
    reason = 'User requested revocation'
  ) {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: sessionId, merchant_id: merchantId },
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

    if (session.user_id !== userId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền thu hồi phiên của người dùng khác',
          retryable: false,
        },
      });
    }

    if (
      session.status === SessionStatusEnum.REVOKED ||
      session.status === SessionStatusEnum.EXPIRED
    ) {
      return {
        session_id: session.id,
        status: session.status,
        message: 'Phiên đã được thu hồi trước đó',
      };
    }

    const updated = await this.prisma.deviceSession.update({
      where: { id: sessionId },
      data: {
        status: SessionStatusEnum.REVOKED,
        revoked_at: new Date(),
        revoked_by: userId,
        revoke_reason: reason,
      },
    });

    await this.logAudit({
      merchantId,
      userId,
      actor: userId,
      action: 'SESSION_REVOKED',
      resource: `Session:${sessionId}`,
      details: { reason, device_id: session.device_id },
      correlationId,
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
    correlationId: string
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
    await this.prisma.deviceSession.updateMany({
      where: { id: { in: activeSessions.map((s) => s.id) } },
      data: {
        status: SessionStatusEnum.REVOKED,
        revoked_at: now,
        revoked_by: userId,
        revoke_reason: 'Revoke all sessions',
      },
    });

    await this.logAudit({
      merchantId,
      userId,
      actor: userId,
      action: 'SESSIONS_REVOKED_ALL',
      resource: `User:${userId}`,
      details: { revoked_count: activeSessions.length, include_current: includeCurrent },
      correlationId,
    });

    return {
      revoked_count: activeSessions.length,
      message: `Đã thu hồi ${activeSessions.length} phiên`,
    };
  }

  async heartbeat(sessionId: string, userId: string, merchantId: string) {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: sessionId, merchant_id: merchantId },
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

    if (session.user_id !== userId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Không có quyền cập nhật phiên của người dùng khác',
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
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
  }

  private async logAudit(meta: {
    merchantId: string;
    userId?: string;
    actor: string;
    action: string;
    resource: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  }): Promise<void> {
    console.log(
      formatStructuredLog({
        level: 'info',
        service: 'api',
        message: `AUDIT: ${meta.action} on ${meta.resource} by ${meta.actor}`,
        metadata: { ...meta, timestamp: new Date().toISOString() },
      })
    );

    try {
      await this.prisma.auditLog.create({
        data: {
          merchant_id: meta.merchantId,
          user_id: meta.userId || null,
          action: meta.action,
          entity_type: meta.resource.split(':')[0] || 'Session',
          entity_id: meta.resource.split(':')[1] || meta.userId || 'system',
          new_value: meta.details ? JSON.parse(JSON.stringify(meta.details)) : null,
          ip_address: null,
        },
      });
    } catch (err) {
      console.error('Failed to persist audit log:', err);
    }
  }
}
