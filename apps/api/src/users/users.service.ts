import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { CanonicalApiException } from '../auth/auth.service';
import { RoleEnum } from '@prisma/client';

export interface AdminResetMfaDto {
  reason: string;
}

export interface CheckScopeDto {
  store_id?: string;
  warehouse_id?: string;
}

@Injectable()
export class UsersService {
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

    // Durable, tenant-scoped idempotency record (BR-AUTH-19): survives restarts and is shared
    // across API instances. The unique (merchant_id, idempotency_key) index arbitrates races.
    const replay = await this.findIdempotentReplay(
      actor.merchantId,
      idempotencyKey.trim(),
      targetUserId,
      dto.reason.trim()
    );
    if (replay) {
      return replay;
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

    let response: any;
    try {
      response = await this.prisma.$transaction(async (tx) => {
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

        const result = {
          data: {
            target_user_id: targetUserId,
            reset: true,
            revoked_sessions_count: revokedCount,
            message: 'Đã đặt lại xác thực hai yếu tố cho người dùng thành công',
          },
          meta: {
            correlation_id: correlationId,
          },
        };

        // F. Persist the idempotency record in the same transaction as the effect.
        await tx.mfaAdminResetIdempotency.create({
          data: {
            merchant_id: actor.merchantId,
            idempotency_key: idempotencyKey.trim(),
            actor_user_id: actor.userId,
            target_user_id: targetUserId,
            reason: dto.reason.trim(),
            response: result,
          },
        });

        return result;
      });
    } catch (err: any) {
      // A concurrent request with the same key won the unique (merchant_id, idempotency_key) race.
      if (err?.code === 'P2002') {
        const replay = await this.findIdempotentReplay(
          actor.merchantId,
          idempotencyKey.trim(),
          targetUserId,
          dto.reason.trim()
        );
        if (replay) {
          return replay;
        }
      }
      throw err;
    }

    return response;
  }

  private async findIdempotentReplay(
    merchantId: string,
    idempotencyKey: string,
    targetUserId: string,
    reason: string
  ) {
    const record = await this.prisma.mfaAdminResetIdempotency.findUnique({
      where: {
        merchant_id_idempotency_key: { merchant_id: merchantId, idempotency_key: idempotencyKey },
      },
    });
    if (!record) {
      return null;
    }
    if (record.target_user_id === targetUserId && record.reason === reason) {
      return record.response;
    }
    throw new CanonicalApiException(
      HttpStatus.CONFLICT,
      'IDEMPOTENCY_CONFLICT',
      'Khóa Idempotency-Key đã được sử dụng cho một yêu cầu khác'
    );
  }

  /**
   * Scope authorization enforcement (AC-USR-01, AC-USR-01-17, BR-RBAC)
   * Validates if the authenticated user has access to a specific warehouse or store scope.
   */
  async checkScopeAccess(
    userId: string,
    merchantId: string,
    requestedScope: CheckScopeDto,
    correlationId: string
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, merchant_id: merchantId },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    if (user.status !== 'active') {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản người dùng chưa kích hoạt hoặc đã bị khóa',
        false
      );
    }

    // Validate at least one scope target is requested (Finding 6 / AC-USR-01-17)
    if (!requestedScope.warehouse_id && !requestedScope.store_id) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Yêu cầu phải chỉ định ít nhất store_id hoặc warehouse_id để kiểm tra phạm vi quyền hạn',
        false
      );
    }

    // Owner role has full access across all stores and warehouses
    if (user.role === RoleEnum.OWNER) {
      return {
        data: {
          authorized: true,
          user_id: user.id,
          role: user.role,
          store_scopes: user.store_scopes,
          warehouse_scopes: user.warehouse_scopes,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    }

    // Warehouse scope enforcement (* or explicit membership)
    if (requestedScope.warehouse_id) {
      const allowed =
        user.warehouse_scopes.includes('*') ||
        user.warehouse_scopes.includes(requestedScope.warehouse_id);
      if (!allowed) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền truy cập kho hàng được yêu cầu',
          false
        );
      }
    }

    // Store scope enforcement (* or explicit membership)
    if (requestedScope.store_id) {
      const allowed =
        user.store_scopes.includes('*') ||
        user.store_scopes.includes(requestedScope.store_id);
      if (!allowed) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền truy cập chi nhánh cửa hàng được yêu cầu',
          false
        );
      }
    }

    return {
      data: {
        authorized: true,
        user_id: user.id,
        role: user.role,
        store_scopes: user.store_scopes,
        warehouse_scopes: user.warehouse_scopes,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
