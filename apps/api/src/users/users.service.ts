import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { CanonicalApiException } from '../auth/auth.service';
import { RoleEnum } from '@prisma/client';

export interface AdminResetMfaDto {
  reason: string;
}

interface IdempotencyRecord {
  targetUserId: string;
  reason: string;
  response: any;
}

@Injectable()
export class UsersService {
  private readonly idempotencyStore = new Map<string, IdempotencyRecord>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessionService: SessionService
  ) {}

  /**
   * Tenant-scoped admin reset of another user's lost factor (BR-AUTH-19, AC-AUTH-05-14..15, AC-AUTH-05-21).
   */
  async adminResetMfa(
    targetUserId: string,
    dto: AdminResetMfaDto,
    actor: {
      userId: string;
      merchantId: string;
      role?: string;
      authAssurance?: string;
      mfaVerifiedAt?: Date | string | null;
    },
    idempotencyKey: string,
    clientIp: string,
    correlationId: string
  ) {
    // 1. Validate reason (BR-AUTH-19)
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Lý do đặt lại MFA là bắt buộc',
        false,
        'Vui lòng nhập lý do hợp lệ'
      );
    }

    // 2. Prohibit self-reset (AC-AUTH-05-15)
    if (actor.userId === targetUserId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không thể tự đặt lại MFA cho chính mình qua tính năng quản trị',
        false,
        'Vui lòng liên hệ quản trị viên khác của cửa hàng'
      );
    }

    // 3. Actor authorization: must be OWNER or OPS_CSKH
    const isOwner = actor.role === RoleEnum.OWNER || actor.role === 'OWNER';
    const isOps = actor.role === RoleEnum.OPS_CSKH || actor.role === 'OPS_CSKH';
    if (!isOwner && !isOps) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản trị để đặt lại MFA cho người dùng',
        false
      );
    }

    // 4. Actor MFA assurance: actor must have completed MFA in the current session (BR-AUTH-19)
    const hasMfa = actor.authAssurance === 'MFA' || Boolean(actor.mfaVerifiedAt);
    if (!hasMfa) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'MFA_FRESH_AUTH_REQUIRED',
        'Thao tác quản trị nhạy cảm yêu cầu phiên làm việc đã xác thực MFA',
        false,
        'Vui lòng đăng nhập lại với xác thực hai yếu tố'
      );
    }

    // 5. Idempotency Key validation and conflict check (AC-AUTH-05-21)
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Header Idempotency-Key là bắt buộc đối với thao tác này'
      );
    }

    const cached = this.idempotencyStore.get(idempotencyKey);
    if (cached) {
      if (cached.targetUserId === targetUserId && cached.reason === dto.reason.trim()) {
        return cached.response;
      }
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'IDEMPOTENCY_CONFLICT',
        'Khóa Idempotency-Key đã được sử dụng cho một yêu cầu khác'
      );
    }

    // 6. Target lookup with strict tenant scoping (AC-AUTH-05-15 non-leaking FORBIDDEN)
    const targetUser = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        merchant_id: actor.merchantId,
      },
    });

    if (!targetUser) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản trị để đặt lại MFA cho người dùng',
        false
      );
    }

    // 7. Target must have an active or pending factor (AC-AUTH-05-15)
    const targetFactors = await this.prisma.mfaFactor.findMany({
      where: {
        user_id: targetUserId,
        status: { in: ['ACTIVE', 'PENDING'] },
      },
    });

    if (targetFactors.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Người dùng không có yếu tố xác thực MFA nào đang hoạt động hoặc chờ kích hoạt'
      );
    }

    // 8. Atomic execution inside database transaction
    const now = new Date();
    const factorIds = targetFactors.map((f) => f.id);

    const revokedSessionsCount = await this.prisma.$transaction(async (tx) => {
      // A. Invalidate/Reset factors
      await tx.mfaFactor.updateMany({
        where: { id: { in: factorIds } },
        data: {
          status: 'RESET',
          reset_at: now,
          updated_by: actor.userId,
        },
      });

      // B. Delete/Invalidate recovery codes
      await tx.mfaRecoveryCode.deleteMany({
        where: { factor_id: { in: factorIds } },
      });

      // C. Invalidate outstanding MFA challenges
      await tx.mfaChallenge.updateMany({
        where: {
          user_id: targetUserId,
          consumed_at: null,
          invalidated_at: null,
        },
        data: {
          invalidated_at: now,
        },
      });

      // D. Revoke all target sessions using SessionService helper
      const revokedCount = await this.sessionService.revokeTargetUserSessions(
        targetUserId,
        actor.merchantId,
        actor.userId,
        `Admin MFA Reset: ${dto.reason.trim()}`,
        correlationId,
        clientIp,
        tx
      );

      // E. Write immutable audit log
      await tx.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          action: 'AUTH_MFA_ADMIN_RESET',
          entity_type: 'User',
          entity_id: targetUserId,
          reason: dto.reason.trim(),
          ip_address: clientIp,
          new_value: {
            target_user_id: targetUserId,
            actor_user_id: actor.userId,
            factors_reset_count: targetFactors.length,
            revoked_sessions_count: revokedCount,
            correlation_id: correlationId,
          },
        },
      });

      return revokedCount;
    });

    const response = {
      data: {
        target_user_id: targetUserId,
        reset: true,
        revoked_sessions_count: revokedSessionsCount,
        message: 'Đã đặt lại xác thực hai yếu tố cho người dùng thành công',
      },
      meta: {
        correlation_id: correlationId,
      },
    };

    // Store in idempotency cache
    this.idempotencyStore.set(idempotencyKey, {
      targetUserId,
      reason: dto.reason.trim(),
      response,
    });

    return response;
  }
}
