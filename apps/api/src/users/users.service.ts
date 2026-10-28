import { Injectable, Inject, Optional, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { RbacService } from '../rbac/rbac.service';
import { CanonicalApiException } from '../auth/auth.service';
import { RoleEnum } from '@prisma/client';
import { isActiveStatus } from '@shipde/contracts';
import {
  ListUsersQueryDto,
  UpdateUserDto,
  SuspendUserDto,
  ActivateUserDto,
  DeactivateUserDto,
} from './users.dto';

export { isActiveStatus };

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
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Optional() @Inject(RbacService) private readonly rbacService?: RbacService
  ) {}

  /**
   * Helper verifying the actor holds `iam:manage_users` permission.
   * Server-authoritative DB read guarantees defense-in-depth against stale claims.
   */
  public async checkActorManageUsersPermission(actor: {
    userId: string;
    merchantId: string;
    role?: string;
  }): Promise<void> {
    if (actor.role === RoleEnum.OWNER || actor.role === 'OWNER') {
      return;
    }

    const dbActor = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
    });
    if (!dbActor) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }
    if (dbActor.role === RoleEnum.OWNER) {
      return;
    }

    if (this.rbacService) {
      const actorContext = await this.rbacService.resolveActorFromSession({
        userId: actor.userId,
        merchantId: actor.merchantId,
        userRole: dbActor.role,
        customRoleId: dbActor.custom_role_id || undefined,
      });
      const hasPermission = await this.rbacService.actorHasPermissions(actorContext, [
        'iam:manage_users',
      ]);
      if (hasPermission) {
        return;
      }
    }

    throw new CanonicalApiException(
      HttpStatus.FORBIDDEN,
      'FORBIDDEN',
      'Bạn không có quyền quản lý người dùng và vai trò',
      false,
      'Vui lòng liên hệ Chủ Shop để được cấp quyền'
    );
  }

  /**
   * GET /api/v1/users — List merchant users with pagination and filters (AC-USR-02-01).
   * Strictly scopes by caller merchant_id; passwords and tokens are never returned.
   */
  async listUsers(merchantId: string, query: ListUsersQueryDto, correlationId: string) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: any = {
      merchant_id: merchantId,
    };

    if (query.role) {
      where.role = query.role as RoleEnum;
    }

    if (query.status) {
      where.status = {
        equals: query.status.trim(),
        mode: 'insensitive',
      };
    }

    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      where.OR = [
        { full_name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          full_name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          store_scopes: true,
          warehouse_scopes: true,
          created_at: true,
          device_sessions: {
            take: 1,
            orderBy: { last_active_at: 'desc' },
            select: { last_active_at: true },
          },
        },
      }),
    ]);

    const formattedUsers = users.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: (u.status || 'ACTIVE').toUpperCase(),
      store_scopes: u.store_scopes || [],
      warehouse_scopes: u.warehouse_scopes || [],
      created_at: u.created_at.toISOString(),
      last_active_at: u.device_sessions[0]?.last_active_at?.toISOString() || null,
    }));

    return {
      data: formattedUsers,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit) || 1,
        correlation_id: correlationId,
      },
    };
  }

  /**
   * GET /api/v1/users/:id — Get user details within caller tenant (AC-USR-02-02, AC-USR-02-15).
   */
  async getUser(targetUserId: string, merchantId: string, correlationId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: targetUserId,
        merchant_id: merchantId,
      },
      select: {
        id: true,
        merchant_id: true,
        full_name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        store_scopes: true,
        warehouse_scopes: true,
        created_at: true,
        updated_at: true,
        device_sessions: {
          take: 1,
          orderBy: { last_active_at: 'desc' },
          select: { last_active_at: true },
        },
      },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    return {
      data: {
        id: user.id,
        merchant_id: user.merchant_id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: (user.status || 'ACTIVE').toUpperCase(),
        store_scopes: user.store_scopes || [],
        warehouse_scopes: user.warehouse_scopes || [],
        created_at: user.created_at.toISOString(),
        updated_at: user.updated_at.toISOString(),
        last_active_at: user.device_sessions?.[0]?.last_active_at?.toISOString() || null,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * PATCH /api/v1/users/:id — Update user profile and scopes (AC-USR-02-03, AC-USR-02-14).
   */
  async updateUser(
    targetUserId: string,
    dto: UpdateUserDto,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string
  ) {
    await this.checkActorManageUsersPermission(actor);

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
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
    });
    const isActorOwner = String(actorUser?.role) === 'OWNER';

    if (String(targetUser.role) === 'OWNER' && !isActorOwner) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không có quyền sửa đổi thông tin của Chủ cửa hàng',
        false
      );
    }

    const dataToUpdate: any = {};

    if (dto.full_name !== undefined) {
      if (
        typeof dto.full_name !== 'string' ||
        dto.full_name.trim().length === 0 ||
        dto.full_name.length > 255
      ) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Họ và tên người dùng không hợp lệ',
          false,
          'Vui lòng nhập họ và tên từ 1 đến 255 ký tự',
          [{ field: 'full_name', code: 'INVALID', message: 'Họ và tên không được để trống' }]
        );
      }
      dataToUpdate.full_name = dto.full_name.trim();
    }

    if (dto.role !== undefined) {
      const validRoles = Object.values(RoleEnum);
      if (!validRoles.includes(dto.role as RoleEnum)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Vai trò không hợp lệ',
          false,
          `Vai trò phải thuộc danh sách: ${validRoles.join(', ')}`,
          [{ field: 'role', code: 'INVALID', message: 'Vai trò người dùng không hợp lệ' }]
        );
      }

      // Privilege ceiling: Non-owner cannot assign OWNER role (BR-USR-05, AC-USR-02-14)
      if (!isActorOwner) {
        if (String(dto.role) === 'OWNER') {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Vượt quá hạn mức phân quyền: Bạn không có quyền chỉ định vai trò Chủ cửa hàng (OWNER)',
            false
          );
        }
        if (dto.role !== actorUser?.role) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            `Vượt quá hạn mức phân quyền: Bạn không thể phân quyền vai trò ${dto.role} vượt quá quyền hạn của mình`,
            false
          );
        }
      }

      // Last Owner Invariant (BR-USR-01): Demoting sole remaining active owner is prohibited
      if (
        String(targetUser.role) === 'OWNER' &&
        dto.role !== RoleEnum.OWNER &&
        isActiveStatus(targetUser.status)
      ) {
        const activeOwnersCount = await this.prisma.user.count({
          where: {
            merchant_id: actor.merchantId,
            role: RoleEnum.OWNER,
            status: { in: ['active', 'ACTIVE'] },
          },
        });
        if (activeOwnersCount <= 1) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'CANNOT_REMOVE_LAST_OWNER',
            'Không thể hạ quyền chủ sở hữu duy nhất còn hoạt động của cửa hàng',
            false,
            'Vui lòng chỉ định một chủ sở hữu (Owner) khác trước khi thực hiện thao tác này'
          );
        }
      }

      dataToUpdate.role = dto.role as RoleEnum;
    }

    if (dto.store_scopes !== undefined) {
      if (!Array.isArray(dto.store_scopes)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'store_scopes phải là một danh sách chuỗi'
        );
      }
      if (!isActorOwner) {
        const actorStores = new Set(actorUser?.store_scopes || []);
        if (!actorStores.has('*')) {
          const unauthorized = dto.store_scopes.filter((s) => !actorStores.has(s));
          if (unauthorized.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              `Vượt quá hạn mức phân quyền: Bạn không thể gán phạm vi chi nhánh [${unauthorized.join(', ')}] vượt quá quyền hạn của mình`,
              false
            );
          }
        }
      }
      dataToUpdate.store_scopes = dto.store_scopes;
    }

    if (dto.warehouse_scopes !== undefined) {
      if (!Array.isArray(dto.warehouse_scopes)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'warehouse_scopes phải là một danh sách chuỗi'
        );
      }
      if (!isActorOwner) {
        const actorWarehouses = new Set(actorUser?.warehouse_scopes || []);
        if (!actorWarehouses.has('*')) {
          const unauthorized = dto.warehouse_scopes.filter((w) => !actorWarehouses.has(w));
          if (unauthorized.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              `Vượt quá hạn mức phân quyền: Bạn không thể gán phạm vi kho hàng [${unauthorized.join(', ')}] vượt quá quyền hạn của mình`,
              false
            );
          }
        }
      }
      dataToUpdate.warehouse_scopes = dto.warehouse_scopes;
    }

    let updatedUser: any;
    try {
      updatedUser = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: targetUserId },
          data: dataToUpdate,
        });

        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'USER_UPDATED',
            entity_type: 'User',
            entity_id: targetUserId,
            reason: 'Cập nhật thông tin và phân quyền người dùng',
            ip_address: clientIp,
            old_value: {
              full_name: targetUser.full_name,
              role: targetUser.role,
              store_scopes: targetUser.store_scopes,
              warehouse_scopes: targetUser.warehouse_scopes,
            },
            new_value: {
              full_name: updated.full_name,
              role: updated.role,
              store_scopes: updated.store_scopes,
              warehouse_scopes: updated.warehouse_scopes,
              correlation_id: correlationId,
            },
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Cập nhật người dùng thất bại do lỗi hệ thống',
        false
      );
    }

    return {
      data: {
        id: updatedUser.id,
        merchant_id: updatedUser.merchant_id,
        full_name: updatedUser.full_name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        role: updatedUser.role,
        status: (updatedUser.status || 'ACTIVE').toUpperCase(),
        store_scopes: updatedUser.store_scopes || [],
        warehouse_scopes: updatedUser.warehouse_scopes || [],
        created_at: updatedUser.created_at.toISOString(),
        updated_at: updatedUser.updated_at.toISOString(),
        last_active_at: null,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * POST /api/v1/users/:id/suspend — Suspend active user and atomically revoke device sessions (AC-USR-02-04).
   */
  async suspendUser(
    targetUserId: string,
    dto: SuspendUserDto,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string
  ) {
    // 1. Mandatory Suspension Reason (BR-USR-07, AC-USR-02-12)
    if (!dto?.reason || typeof dto.reason !== 'string' || dto.reason.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Lý do tạm dừng người dùng là bắt buộc',
        false,
        'Vui lòng nhập lý do tạm dừng hợp lệ',
        [{ field: 'reason', code: 'REQUIRED', message: 'Lý do tạm dừng không được để trống' }]
      );
    }

    // 2. Self-Disruption Prohibition (BR-USR-02, AC-USR-02-10)
    if (targetUserId === actor.userId) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'SELF_SUSPENSION_PROHIBITED',
        'Bạn không thể tự tạm dừng tài khoản của chính mình',
        false,
        'Vui lòng yêu cầu một quản trị viên khác thực hiện thao tác này'
      );
    }

    // 3. Actor Permission Check (AC-USR-02-16)
    await this.checkActorManageUsersPermission(actor);

    // 4. Strict Tenant Scoping (BR-USR-06, AC-USR-02-15)
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
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
    });
    const isActorOwner = String(actorUser?.role) === 'OWNER';

    if (String(targetUser.role) === 'OWNER' && !isActorOwner) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không có quyền tạm dừng tài khoản của Chủ cửa hàng',
        false
      );
    }

    // 5. Status Transition Safety: only ACTIVE -> SUSPENDED (BR-USR-04, AC-USR-02-13)
    if (!isActiveStatus(targetUser.status)) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'INVALID_STATUS_TRANSITION',
        `Không thể tạm dừng người dùng có trạng thái hiện tại là ${targetUser.status.toUpperCase()}`,
        false,
        'Chỉ có thể tạm dừng tài khoản đang ở trạng thái ACTIVE'
      );
    }

    // 6. Sole Owner Protection (BR-USR-01, AC-USR-02-11)
    if (String(targetUser.role) === 'OWNER') {
      const activeOwnersCount = await this.prisma.user.count({
        where: {
          merchant_id: actor.merchantId,
          role: RoleEnum.OWNER,
          status: { in: ['active', 'ACTIVE'] },
        },
      });
      if (activeOwnersCount <= 1) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CANNOT_REMOVE_LAST_OWNER',
          'Không thể tạm dừng chủ sở hữu duy nhất còn hoạt động của cửa hàng',
          false,
          'Vui lòng chỉ định một chủ sở hữu (Owner) khác trước khi thực hiện thao tác này'
        );
      }
    }

    // 7. Atomic Execution in Database Transaction (BR-USR-03, BR-USR-08, AC-USR-02-04, AC-USR-02-17)
    let result: any;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetUserId },
          data: { status: 'suspended' },
        });

        const revokedCount = await this.sessionService.revokeTargetUserSessions(
          targetUserId,
          actor.merchantId,
          actor.userId,
          `Admin suspended: ${dto.reason.trim()}`,
          correlationId,
          clientIp,
          tx
        );

        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'USER_SUSPENDED',
            entity_type: 'User',
            entity_id: targetUserId,
            reason: dto.reason.trim(),
            ip_address: clientIp,
            old_value: { status: targetUser.status.toUpperCase() },
            new_value: {
              status: 'SUSPENDED',
              target_user_id: targetUserId,
              actor_user_id: actor.userId,
              revoked_sessions_count: revokedCount,
              correlation_id: correlationId,
            },
          },
        });

        return {
          id: targetUserId,
          status: 'SUSPENDED',
          revoked_sessions_count: revokedCount,
          message: 'Đã tạm dừng người dùng thành công',
        };
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Thao tác tạm dừng người dùng thất bại do lỗi hệ thống',
        false
      );
    }

    return {
      data: result,
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * POST /api/v1/users/:id/activate — Reinstate suspended user to active status (AC-USR-02-07).
   */
  async activateUser(
    targetUserId: string,
    dto: ActivateUserDto,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string
  ) {
    await this.checkActorManageUsersPermission(actor);

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
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
    });
    const isActorOwner = String(actorUser?.role) === 'OWNER';

    if (String(targetUser.role) === 'OWNER' && !isActorOwner) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không có quyền kích hoạt lại tài khoản của Chủ cửa hàng',
        false
      );
    }

    // Status Transition Safety: only SUSPENDED -> ACTIVE (BR-USR-04, AC-USR-02-13)
    const normalizedStatus = (targetUser.status || '').toLowerCase();
    if (normalizedStatus !== 'suspended') {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'INVALID_STATUS_TRANSITION',
        `Không thể kích hoạt lại người dùng có trạng thái hiện tại là ${targetUser.status.toUpperCase()}`,
        false,
        'Chỉ có thể kích hoạt lại tài khoản đang ở trạng thái SUSPENDED'
      );
    }

    let result: any;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetUserId },
          data: { status: 'active' },
        });

        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'USER_ACTIVATED',
            entity_type: 'User',
            entity_id: targetUserId,
            reason: dto?.reason?.trim() || 'Kích hoạt lại người dùng',
            ip_address: clientIp,
            old_value: { status: 'SUSPENDED' },
            new_value: {
              status: 'ACTIVE',
              target_user_id: targetUserId,
              actor_user_id: actor.userId,
              correlation_id: correlationId,
            },
          },
        });

        return {
          id: targetUserId,
          status: 'ACTIVE',
          message: 'Đã kích hoạt lại người dùng thành công',
        };
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Thao tác kích hoạt lại người dùng thất bại do lỗi hệ thống',
        false
      );
    }

    return {
      data: result,
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * POST /api/v1/users/:id/deactivate — Deactivate user account and revoke sessions (AC-USR-02-08, AC-USR-02-09).
   */
  async deactivateUser(
    targetUserId: string,
    dto: DeactivateUserDto,
    actor: { userId: string; merchantId: string; role?: string },
    clientIp: string,
    correlationId: string
  ) {
    // Self-Disruption Prohibition (BR-USR-02, AC-USR-02-10)
    if (targetUserId === actor.userId) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'SELF_SUSPENSION_PROHIBITED',
        'Bạn không thể tự vô hiệu hóa tài khoản của chính mình',
        false,
        'Vui lòng yêu cầu một quản trị viên khác thực hiện thao tác này'
      );
    }

    await this.checkActorManageUsersPermission(actor);

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
        'Người dùng không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: actor.merchantId },
    });
    const isActorOwner = String(actorUser?.role) === 'OWNER';

    if (String(targetUser.role) === 'OWNER' && !isActorOwner) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Vượt quá hạn mức phân quyền: Bạn không có quyền vô hiệu hóa tài khoản của Chủ cửa hàng',
        false
      );
    }

    // Status Transition Safety: ACTIVE or SUSPENDED -> DISABLED (BR-USR-04, AC-USR-02-13)
    const normalizedStatus = (targetUser.status || '').toLowerCase();
    if (normalizedStatus !== 'active' && normalizedStatus !== 'suspended') {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'INVALID_STATUS_TRANSITION',
        normalizedStatus === 'disabled'
          ? 'Tài khoản người dùng đã bị vô hiệu hóa trước đó'
          : `Không thể vô hiệu hóa tài khoản có trạng thái là ${targetUser.status.toUpperCase()}`,
        false,
        'Chỉ có thể vô hiệu hóa tài khoản đang ở trạng thái ACTIVE hoặc SUSPENDED'
      );
    }

    // Sole Owner Protection (BR-USR-01, AC-USR-02-11)
    if (String(targetUser.role) === 'OWNER' && isActiveStatus(targetUser.status)) {
      const activeOwnersCount = await this.prisma.user.count({
        where: {
          merchant_id: actor.merchantId,
          role: RoleEnum.OWNER,
          status: { in: ['active', 'ACTIVE'] },
        },
      });
      if (activeOwnersCount <= 1) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CANNOT_REMOVE_LAST_OWNER',
          'Không thể vô hiệu hóa chủ sở hữu duy nhất còn hoạt động của cửa hàng',
          false,
          'Vui lòng chỉ định một chủ sở hữu (Owner) khác trước khi thực hiện thao tác này'
        );
      }
    }

    let result: any;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: targetUserId },
          data: { status: 'disabled' },
        });

        const revokedCount = await this.sessionService.revokeTargetUserSessions(
          targetUserId,
          actor.merchantId,
          actor.userId,
          `Admin deactivated: ${dto?.reason?.trim() || 'Admin deactivation'}`,
          correlationId,
          clientIp,
          tx
        );

        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'USER_DEACTIVATED',
            entity_type: 'User',
            entity_id: targetUserId,
            reason: dto?.reason?.trim() || 'Vô hiệu hóa tài khoản',
            ip_address: clientIp,
            old_value: { status: targetUser.status.toUpperCase() },
            new_value: {
              status: 'DISABLED',
              target_user_id: targetUserId,
              actor_user_id: actor.userId,
              revoked_sessions_count: revokedCount,
              correlation_id: correlationId,
            },
          },
        });

        return {
          id: targetUserId,
          status: 'DISABLED',
          revoked_sessions_count: revokedCount,
          message: 'Đã vô hiệu hóa tài khoản người dùng thành công',
        };
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Thao tác vô hiệu hóa tài khoản thất bại do lỗi hệ thống',
        false
      );
    }

    return {
      data: result,
      meta: {
        correlation_id: correlationId,
      },
    };
  }

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
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Lý do đặt lại MFA là bắt buộc',
        false,
        'Vui lòng nhập lý do hợp lệ'
      );
    }

    if (actor.userId === targetUserId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không thể tự đặt lại MFA cho chính mình qua tính năng quản trị',
        false,
        'Vui lòng liên hệ quản trị viên khác của cửa hàng'
      );
    }

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

    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Header Idempotency-Key là bắt buộc đối với thao tác này'
      );
    }

    const replay = await this.findIdempotentReplay(
      actor.merchantId,
      idempotencyKey.trim(),
      targetUserId,
      dto.reason.trim()
    );
    if (replay) {
      return replay;
    }

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

    const now = new Date();
    const factorIds = targetFactors.map((f) => f.id);

    let response: any;
    try {
      response = await this.prisma.$transaction(async (tx) => {
        await tx.mfaFactor.updateMany({
          where: { id: { in: factorIds } },
          data: {
            status: 'RESET',
            reset_at: now,
            updated_by: actor.userId,
          },
        });

        await tx.mfaRecoveryCode.deleteMany({
          where: { factor_id: { in: factorIds } },
        });

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

        const revokedCount = await this.sessionService.revokeTargetUserSessions(
          targetUserId,
          actor.merchantId,
          actor.userId,
          `Admin MFA Reset: ${dto.reason.trim()}`,
          correlationId,
          clientIp,
          tx
        );

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

    if (!isActiveStatus(user.status)) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản người dùng chưa kích hoạt hoặc đã bị khóa',
        false
      );
    }

    if (!requestedScope.warehouse_id && !requestedScope.store_id) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Yêu cầu phải chỉ định ít nhất store_id hoặc warehouse_id để kiểm tra phạm vi quyền hạn',
        false
      );
    }

    const userWarehouseScopes = user.warehouse_scopes || [];
    const userStoreScopes = user.store_scopes || [];

    if (user.role === RoleEnum.OWNER) {
      return {
        data: {
          authorized: true,
          user_id: user.id,
          role: user.role,
          store_scopes: userStoreScopes,
          warehouse_scopes: userWarehouseScopes,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    }

    if (requestedScope.warehouse_id) {
      const allowed =
        userWarehouseScopes.includes('*') ||
        userWarehouseScopes.includes(requestedScope.warehouse_id);
      if (!allowed) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền truy cập kho hàng được yêu cầu',
          false
        );
      }
    }

    if (requestedScope.store_id) {
      const allowed =
        userStoreScopes.includes('*') || userStoreScopes.includes(requestedScope.store_id);
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
        store_scopes: userStoreScopes,
        warehouse_scopes: userWarehouseScopes,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
