import {
  Injectable,
  Inject,
  ForbiddenException,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
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
export class SessionService implements OnApplicationBootstrap {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    this.wrapPrismaTransactionForAudit(prisma);
  }

  private wrapPrismaTransactionForAudit(prisma: any) {
    if (!prisma || prisma.__auditWrapped) return;
    const origTransaction = prisma.$transaction?.bind(prisma);
    if (!origTransaction) return;

    prisma.$transaction = async (...args: any[]) => {
      const [arg1, arg2] = args;
      if (typeof arg1 === 'function') {
        const onCommitHooks: Array<() => void> = [];
        const result = await origTransaction(async (tx: any) => {
          if (tx && !tx.__onCommitHooks) {
            tx.__onCommitHooks = onCommitHooks;
          }
          return arg1(tx);
        }, arg2);

        for (const hook of onCommitHooks) {
          try {
            hook();
          } catch (e) {
            console.error('Audit onCommit hook error:', e);
          }
        }
        return result;
      }
      return origTransaction(...args);
    };
    prisma.__auditWrapped = true;
  }

  onApplicationBootstrap() {
    this.wrapPrismaTransactionForAudit(this.prisma);
    const key = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
    if (process.env.NODE_ENV === 'production' && (!key || key.trim().length === 0)) {
      throw new Error(
        'AUDIT_IDENTIFIER_HMAC_KEY is required in production for IP pseudonymization; refusing to start application'
      );
    }
  }

  /**
   * Internal creation of session records during successful login (AC-SESS-01).
   * Persists device session with SHA-256 token hash, 90-day absolute expiry,
   * current last_active_at timestamp, and ACTIVE status.
   */
  async create(data: {
    sessionId?: string;
    userId: string;
    merchantId: string;
    token: string;
    deviceId?: string;
    deviceModel?: string;
    userAgent?: string;
    ipAddress?: string;
    authAssurance?: string;
    mfaVerifiedAt?: Date | null;
  }) {
    const tokenHash = createHash('sha256').update(data.token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ABSOLUTE_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    return this.prisma.deviceSession.create({
      data: {
        id: data.sessionId,
        user_id: data.userId,
        merchant_id: data.merchantId,
        session_token_hash: tokenHash,
        device_id: data.deviceId ?? 'web-session',
        device_model: data.deviceModel,
        user_agent: data.userAgent,
        ip_address: data.ipAddress ? this.hashIp(data.ipAddress) : null,
        status: SessionStatusEnum.ACTIVE,
        last_active_at: now,
        expires_at: expiresAt,
        auth_assurance: data.authAssurance ?? 'PASSWORD',
        mfa_verified_at: data.mfaVerifiedAt,
      },
    });
  }

  async list(
    userId: string,
    merchantId: string | null,
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
      const isExpiredByInactivity = s.last_active_at <= inactivityThreshold;
      const isExpiredByAbsolute = s.expires_at <= now;
      const isExpired = isExpiredByInactivity || isExpiredByAbsolute;
      const effectiveStatus = isExpired ? SessionStatusEnum.EXPIRED : s.status;

      return {
        session_id: s.id,
        device_id: s.device_id,
        device_model: s.device_model,
        user_agent: s.user_agent,
        ip_address: this.resolveSafeIpForDisplay(s.ip_address),
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

  /**
   * Validates an active device session by its SHA-256 token hash strictly scoped
   * by user and merchant tenant (BR-SESS-01).
   * Unscoped session lookups are strictly prohibited to prevent cross-tenant token exploitation.
   */
  async validateSession(
    tokenHash: string,
    scope: { userId: string; merchantId?: string | null }
  ): Promise<{
    userId: string;
    merchantId: string | null;
    sessionId: string;
    authAssurance: string;
    mfaVerifiedAt: Date | null;
  } | null> {
    if (!scope || !scope.userId) {
      return null;
    }

    const now = new Date();
    const inactivityThreshold = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);

    const where: {
      session_token_hash: string;
      user_id: string;
      merchant_id?: string | null;
    } = {
      session_token_hash: tokenHash,
      user_id: scope.userId,
    };

    if (scope.merchantId !== undefined) {
      where.merchant_id = scope.merchantId;
    }

    const session = await this.prisma.deviceSession.findFirst({
      where,
    });

    if (!session || session.status !== SessionStatusEnum.ACTIVE) {
      return null;
    }

    const isExpired = session.expires_at <= now || session.last_active_at <= inactivityThreshold;
    if (isExpired) {
      // BR-SESS-03 / BR-SESS-04: Persist EXPIRED status to DB at guard time (Finding 6)
      await this.prisma.deviceSession.updateMany({
        where: { id: session.id, status: SessionStatusEnum.ACTIVE },
        data: { status: SessionStatusEnum.EXPIRED },
      });
      return null;
    }

    return {
      userId: session.user_id,
      merchantId: session.merchant_id,
      sessionId: session.id,
      authAssurance: session.auth_assurance,
      mfaVerifiedAt: session.mfa_verified_at,
    };
  }

  async revoke(
    sessionId: string,
    userId: string,
    merchantId: string | null,
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
      return {
        session_id: session.id,
        status: session.status,
        message:
          session.status === SessionStatusEnum.REVOKED
            ? 'Phiên đã được thu hồi trước đó'
            : 'Phiên đã hết hạn',
      };
    }

    let auditLogAction: (() => void) | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Concurrency-safe exclusive write lock (BR-SESS-07 / AC-SESS-07):
        // SELECT ... FOR UPDATE locks the row against concurrent modifications.
        if (typeof (tx as any).$queryRaw === 'function') {
          try {
            await (tx as any)
              .$queryRaw`SELECT id, status FROM "device_sessions" WHERE id = ${sessionId}::uuid FOR UPDATE`;
          } catch (lockErr: any) {
            // Rethrow on Postgres; only skip where documented unsupported (e.g. SQLite or mock drivers lacking Postgres syntax support)
            const dbUrl = process.env.DATABASE_URL || '';
            const isPostgres =
              dbUrl.startsWith('postgresql:') ||
              dbUrl.startsWith('postgres:') ||
              (!dbUrl && process.env.NODE_ENV === 'production');
            const errorMessage = String(lockErr?.message || lockErr || '');
            const isDocumentedUnsupported =
              errorMessage.includes('NOT_IMPLEMENTED_FOR_UPDATE') ||
              errorMessage.includes('sqlite') ||
              errorMessage.includes('near "FOR": syntax error') ||
              errorMessage.includes('near "::": syntax error');

            if (isPostgres && !isDocumentedUnsupported) {
              console.error(
                formatStructuredLog({
                  level: 'error',
                  service: 'api',
                  message: `ROW_LOCK_FAILED: Failed to acquire exclusive lock on session ${sessionId}`,
                  metadata: { sessionId, error: this.sanitizeError(lockErr) },
                })
              );
              throw lockErr;
            }
          }
        }

        // Concurrency-safe atomic transition: only update if currently ACTIVE
        const updateResult = await tx.deviceSession.updateMany({
          where: {
            id: sessionId,
            user_id: userId,
            merchant_id: merchantId,
            status: SessionStatusEnum.ACTIVE,
          },
          data: {
            status: SessionStatusEnum.REVOKED,
            is_revoked: true,
            revoked_at: new Date(),
            revoked_by: userId,
            revoke_reason: reason,
          },
        });

        if (updateResult.count > 0) {
          auditLogAction = await this.logAudit(
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

          return {
            session_id: sessionId,
            status: SessionStatusEnum.REVOKED,
            message: 'Phiên đã được thu hồi',
          };
        }

        // If count is 0, a concurrent request already transitioned the session.
        // Fetch latest status to respond idempotently without duplicate audit logs or timestamp mutations.
        const latest =
          typeof tx.deviceSession.findUnique === 'function'
            ? await tx.deviceSession.findUnique({ where: { id: sessionId } })
            : await this.prisma.deviceSession.findUnique({ where: { id: sessionId } });

        return {
          session_id: sessionId,
          status: latest?.status ?? SessionStatusEnum.REVOKED,
          message:
            latest?.status === SessionStatusEnum.REVOKED
              ? 'Phiên đã được thu hồi trước đó'
              : 'Phiên đã hết hạn',
        };
      });

      // Emitted only after transaction successfully commits
      const emitAction = auditLogAction as (() => void) | null;
      if (emitAction) {
        emitAction();
      }
      return result;
    } catch (err) {
      const isAuditFailure =
        (err as any)?.message?.includes('AUDIT_IDENTIFIER_HMAC_KEY') ||
        (err as any)?.message?.toLowerCase().includes('audit');
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'api',
          message: isAuditFailure
            ? `AUDIT_ROLLBACK: Transaction rolled back during revocation of Session:${sessionId}`
            : `SESSION_REVOCATION_ROLLBACK: Transaction rolled back during revocation of Session:${sessionId}`,
          metadata: {
            sessionId,
            merchantId,
            userId,
            correlationId,
            error: this.sanitizeError(err),
          },
        })
      );
      throw err;
    }
  }

  async revokeAll(
    userId: string,
    merchantId: string | null,
    currentSessionId: string | undefined,
    dto: RevokeAllDto,
    correlationId: string,
    ipAddress?: string
  ) {
    const includeCurrent = dto.include_current === true;
    const now = new Date();

    let auditLogAction: (() => void) | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const where: Record<string, unknown> = {
          merchant_id: merchantId,
          user_id: userId,
          status: SessionStatusEnum.ACTIVE,
        };

        if (!includeCurrent && currentSessionId) {
          where.id = { not: currentSessionId };
        }

        const updateResult = await tx.deviceSession.updateMany({
          where,
          data: {
            status: SessionStatusEnum.REVOKED,
            is_revoked: true,
            revoked_at: now,
            revoked_by: userId,
            revoke_reason: 'Revoke all sessions',
          },
        });

        if (updateResult.count === 0) {
          return { revoked_count: 0, message: 'Không có phiên nào cần thu hồi' };
        }

        auditLogAction = await this.logAudit(
          {
            merchantId,
            userId,
            actor: userId,
            action: 'SESSIONS_REVOKED_ALL',
            resource: `User:${userId}`,
            details: { revoked_count: updateResult.count, include_current: includeCurrent },
            correlationId,
            ipAddress,
          },
          tx
        );

        return {
          revoked_count: updateResult.count,
          message: `Đã thu hồi ${updateResult.count} phiên`,
        };
      });

      // Emitted only after transaction successfully commits
      const emitAction = auditLogAction as (() => void) | null;
      if (emitAction) {
        emitAction();
      }
      return result;
    } catch (err) {
      const isAuditFailure =
        (err as any)?.message?.includes('AUDIT_IDENTIFIER_HMAC_KEY') ||
        (err as any)?.message?.toLowerCase().includes('audit');
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'api',
          message: isAuditFailure
            ? `AUDIT_ROLLBACK: Transaction rolled back during revoke-all for User:${userId}`
            : `SESSION_REVOCATION_ROLLBACK: Transaction rolled back during revoke-all for User:${userId}`,
          metadata: {
            merchantId,
            userId,
            correlationId,
            error: this.sanitizeError(err),
          },
        })
      );
      throw err;
    }
  }

  /**
   * Revoke all sessions for a specific target user in the tenant (FEAT-AUTH-05 Admin MFA Reset).
   * Ensures atomic revocation and audit log creation inside a Prisma transaction (BR-SESS-07).
   */
  async revokeTargetUserSessions(
    targetUserId: string,
    merchantId: string,
    actorUserId: string,
    reason: string,
    correlationId: string,
    ipAddress?: string,
    tx?: any
  ): Promise<number> {
    const executeInTransaction = async (prismaTx: any) => {
      const now = new Date();
      const updateResult = await prismaTx.deviceSession.updateMany({
        where: {
          merchant_id: merchantId,
          user_id: targetUserId,
          status: SessionStatusEnum.ACTIVE,
        },
        data: {
          status: SessionStatusEnum.REVOKED,
          is_revoked: true,
          revoked_at: now,
          revoked_by: actorUserId,
          revoke_reason: reason,
        },
      });

      if (updateResult.count === 0) {
        return { count: 0, emitLog: null };
      }

      const emitLog = await this.logAudit(
        {
          merchantId,
          userId: targetUserId,
          actor: actorUserId,
          action: 'SESSIONS_REVOKED_ALL',
          resource: `User:${targetUserId}`,
          details: { revoked_count: updateResult.count, reason },
          correlationId,
          ipAddress,
        },
        prismaTx
      );

      return { count: updateResult.count, emitLog };
    };

    if (tx) {
      const result = await executeInTransaction(tx);
      // BR-SESS-07: Never emit audit log before outer transaction commits.
      if (Array.isArray((tx as any).__onCommitHooks) && typeof result.emitLog === 'function') {
        (tx as any).__onCommitHooks.push(result.emitLog);
      } else if (
        typeof (tx as any).onCommit === 'function' &&
        typeof result.emitLog === 'function'
      ) {
        (tx as any).onCommit(result.emitLog);
      }
      return result.count;
    }

    let auditAction: (() => void) | null = null;
    const count = await this.prisma.$transaction(async (prismaTx) => {
      const result = await executeInTransaction(prismaTx);
      auditAction = result.emitLog;
      return result.count;
    });

    if (typeof auditAction === 'function') {
      (auditAction as () => void)();
    }

    return count;
  }
  async heartbeat(
    sessionId: string,
    userId: string,
    merchantId: string | null,
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

    const now = new Date();
    const inactivityThreshold = new Date(now.getTime() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000);
    const isExpired = session.expires_at <= now || session.last_active_at <= inactivityThreshold;

    if (session.status !== SessionStatusEnum.ACTIVE || isExpired) {
      if (session.status === SessionStatusEnum.ACTIVE && isExpired) {
        // BR-SESS-03: an expired row is stored as EXPIRED in DB
        await this.prisma.deviceSession.updateMany({
          where: {
            id: sessionId,
            merchant_id: merchantId,
            user_id: userId,
            status: SessionStatusEnum.ACTIVE,
          },
          data: { status: SessionStatusEnum.EXPIRED },
        });
      }
      throw new ForbiddenException({
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Phiên không còn hoạt động',
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

    // Atomic update scoped to merchant_id, user_id, ACTIVE status, and validity thresholds (BR-SESS-01, BR-SESS-05)
    const updateResult = await this.prisma.deviceSession.updateMany({
      where: {
        id: sessionId,
        merchant_id: merchantId,
        user_id: userId,
        status: SessionStatusEnum.ACTIVE,
        expires_at: { gt: now },
        last_active_at: { gt: inactivityThreshold },
      },
      data: { last_active_at: now },
    });

    if (updateResult.count === 0) {
      // Concurrently revoked or expired between read and update
      throw new ForbiddenException({
        error: {
          code: 'SESSION_NOT_ACTIVE',
          message: 'Phiên không còn hoạt động',
          retryable: false,
        },
      });
    }

    return {
      session_id: sessionId,
      last_active_at: now.toISOString(),
    };
  }

  /**
   * BR-SESS-09 / AC-SESS-21: Zero Secret / PII Disclosure.
   * Client-facing list responses must never return IP data derived from raw values (no masking of raw IPs).
   * Device sessions store HMAC-SHA256 hashed IPs in the database.
   * Per zero disclosure, raw IPs are never echoed or masked; returns null for all client-facing responses.
   */
  private resolveSafeIpForDisplay(_ip: string | null | undefined): string | null {
    return null;
  }

  private hashIp(ip: string): string {
    const key = process.env.AUDIT_IDENTIFIER_HMAC_KEY;
    if (!key || key.trim().length === 0) {
      throw new Error(
        'AUDIT_IDENTIFIER_HMAC_KEY is required for IP pseudonymization; refusing to fallback to predictable key'
      );
    }
    return createHmac('sha256', key.trim()).update(ip).digest('hex');
  }

  private async logAudit(
    meta: {
      merchantId?: string | null;
      userId?: string;
      actor: string;
      action: string;
      resource: string;
      details?: Record<string, unknown>;
      correlationId?: string;
      ipAddress?: string;
    },
    tx: any = this.prisma
  ): Promise<() => void> {
    const hashedIp = meta.ipAddress ? this.hashIp(meta.ipAddress) : null;
    const { ipAddress: _rawIp, ...safeMeta } = meta;

    const emitLog = () => {
      console.log(
        formatStructuredLog({
          level: 'info',
          service: 'api',
          message: `AUDIT: ${meta.action} on ${meta.resource} by ${meta.actor}`,
          metadata: { ...safeMeta, ipAddress: hashedIp, timestamp: new Date().toISOString() },
        })
      );
    };

    try {
      await tx.auditLog.create({
        data: {
          merchant_id: meta.merchantId || null,
          user_id: meta.userId || null,
          action: meta.action,
          entity_type: meta.resource.split(':')[0] || 'Session',
          entity_id: meta.resource.split(':')[1] || meta.userId || 'system',
          new_value: meta.details ? JSON.parse(JSON.stringify(meta.details)) : null,
          ip_address: hashedIp,
        },
      });
    } catch (err) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'api',
          message: `AUDIT_FAILED: Failed to persist audit log for ${meta.action} on ${meta.resource}`,
          metadata: { ...safeMeta, ipAddress: hashedIp, error: this.sanitizeError(err) },
        })
      );
      throw err;
    }

    return emitLog;
  }

  private sanitizeError(err: unknown): string {
    if (!err) return 'UNKNOWN_ERROR';
    const anyErr = err as any;
    if (anyErr?.code && typeof anyErr.code === 'string' && anyErr.code.startsWith('P')) {
      return `PRISMA_${anyErr.code}`;
    }
    if (anyErr?.name && typeof anyErr.name === 'string') {
      if (anyErr.name.includes('Prisma')) {
        return anyErr.code ? `PRISMA_${anyErr.code}` : 'PRISMA_DATABASE_ERROR';
      }
      return anyErr.name;
    }
    if (typeof anyErr?.message === 'string') {
      if (anyErr.message.includes('AUDIT_IDENTIFIER_HMAC_KEY')) {
        return 'AUDIT_IDENTIFIER_HMAC_KEY_MISSING';
      }
      if (anyErr.message.toLowerCase().includes('audit')) {
        return 'AUDIT_PERSISTENCE_FAILED';
      }
      if (
        anyErr.message.toLowerCase().includes('pool') ||
        anyErr.message.toLowerCase().includes('connection')
      ) {
        return 'DATABASE_CONNECTION_ERROR';
      }
    }
    return 'INTERNAL_ERROR';
  }
}
