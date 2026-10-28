import { Injectable, Inject, Optional, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import {
  RbacService,
  isDeadlockOrSerializationError,
  createConcurrencyConflictException,
} from '../rbac/rbac.service';
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
  carrier_account_id?: string;
}

export interface UpdateUserScopesDto {
  store_scopes?: string[];
  warehouse_scopes?: string[];
  carrier_account_scopes?: string[];
}

export const FORBIDDEN_CHARACTERS_REGEX = /[<>\u0000-\u001F\u007F]/;

/**
 * Validates array bounds, element types, and rejects control characters/HTML tags.
 */
export function validateScopeArray(
  scopes: any,
  fieldName: 'store_scopes' | 'warehouse_scopes' | 'carrier_account_scopes',
  maxCount = 50,
  maxLength = 64
): void {
  if (scopes === undefined || scopes === null) return;
  if (!Array.isArray(scopes)) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      `${fieldName} phải là một mảng chuỗi`,
      false,
      undefined,
      [{ field: fieldName, code: 'INVALID_TYPE', message: `${fieldName} phải là một mảng chuỗi` }]
    );
  }
  if (scopes.length > maxCount) {
    throw new CanonicalApiException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      `Số lượng phần tử trong ${fieldName} không được vượt quá ${maxCount}`,
      false,
      undefined,
      [{ field: fieldName, code: 'ARRAY_TOO_LONG', message: `Tối đa ${maxCount} phần tử` }]
    );
  }
  for (let i = 0; i < scopes.length; i++) {
    const item = scopes[i];
    if (typeof item !== 'string') {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Phần tử thứ ${i + 1} trong ${fieldName} phải là chuỗi ký tự`,
        false,
        undefined,
        [{ field: `${fieldName}[${i}]`, code: 'INVALID_TYPE', message: 'Phải là chuỗi ký tự' }]
      );
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Phần tử trong ${fieldName} không được để trống`,
        false,
        undefined,
        [{ field: `${fieldName}[${i}]`, code: 'EMPTY_STRING', message: 'Không được để trống' }]
      );
    }
    if (trimmed.length > maxLength) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Phần tử trong ${fieldName} không được vượt quá ${maxLength} ký tự`,
        false,
        undefined,
        [
          {
            field: `${fieldName}[${i}]`,
            code: 'STRING_TOO_LONG',
            message: `Tối đa ${maxLength} ký tự`,
          },
        ]
      );
    }
    if (FORBIDDEN_CHARACTERS_REGEX.test(trimmed)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Phần tử trong ${fieldName} chứa ký tự không hợp lệ`,
        false,
        undefined,
        [
          {
            field: `${fieldName}[${i}]`,
            code: 'INVALID_CHARACTERS',
            message: 'Chứa ký tự không hợp lệ',
          },
        ]
      );
    }
  }
}

/**
 * Enforces scope privilege ceiling: an actor cannot grant scopes they do not possess.
 */
export function enforceScopePrivilegeCeiling(
  dto: UpdateUserScopesDto,
  actor: {
    role?: string;
    store_scopes: string[];
    warehouse_scopes: string[];
    carrier_account_scopes: string[];
  }
): void {
  // Owner has universal privilege ceiling
  if (actor.role === RoleEnum.OWNER || actor.role === 'OWNER') {
    return;
  }

  // 1. Branch / store scopes
  if (dto.store_scopes !== undefined) {
    const actorStores = new Set(actor.store_scopes || []);
    const actorHasWildcard = actorStores.has('*');
    if (!actorHasWildcard) {
      if (dto.store_scopes.includes('*')) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'PRIVILEGE_ESCALATION_DENIED',
          'Bạn không có quyền toàn bộ chi nhánh để cấp quyền wildcard (*)',
          false
        );
      }
      for (const store of dto.store_scopes) {
        if (!actorStores.has(store)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            `Bạn không thể cấp quyền truy cập chi nhánh [${store}] vì không thuộc phạm vi của bạn`,
            false
          );
        }
      }
    }
  }

  // 2. Warehouse scopes
  if (dto.warehouse_scopes !== undefined) {
    const actorWarehouses = new Set(actor.warehouse_scopes || []);
    const actorHasWildcard = actorWarehouses.has('*');
    if (!actorHasWildcard) {
      if (dto.warehouse_scopes.includes('*')) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'PRIVILEGE_ESCALATION_DENIED',
          'Bạn không có quyền toàn bộ kho hàng để cấp quyền wildcard (*)',
          false
        );
      }
      for (const wh of dto.warehouse_scopes) {
        if (!actorWarehouses.has(wh)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            `Bạn không thể cấp quyền truy cập kho hàng [${wh}] vì không thuộc phạm vi của bạn`,
            false
          );
        }
      }
    }
  }

  // 3. Carrier account scopes
  if (dto.carrier_account_scopes !== undefined) {
    const actorCarrierAccounts = new Set(actor.carrier_account_scopes || []);
    const actorHasWildcard = actorCarrierAccounts.has('*');
    if (!actorHasWildcard) {
      if (dto.carrier_account_scopes.includes('*')) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'PRIVILEGE_ESCALATION_DENIED',
          'Bạn không có quyền toàn bộ tài khoản vận chuyển để cấp quyền wildcard (*)',
          false
        );
      }
      for (const ca of dto.carrier_account_scopes) {
        if (!actorCarrierAccounts.has(ca)) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            `Bạn không thể cấp quyền truy cập tài khoản vận chuyển [${ca}] vì không thuộc phạm vi của bạn`,
            false
          );
        }
      }
    }
  }
}

@Injectable()
@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Optional() @Inject(RbacService) private readonly rbacService?: RbacService
  ) {}

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

  /**
   * Validate that all non-wildcard carrier account IDs exist and belong to the tenant.
   */
  async validateCarrierAccountScopes(
    carrierAccountScopes: string[] | undefined,
    merchantId: string,
    txClient?: any
  ): Promise<void> {
    if (!carrierAccountScopes || carrierAccountScopes.length === 0) return;
    const concreteIds = carrierAccountScopes.filter((id) => id !== '*');
    if (concreteIds.length === 0) return;

    const client = txClient || this.prisma;
    const existingAccounts = await client.carrierAccount.findMany({
      where: {
        merchant_id: merchantId,
        id: { in: concreteIds },
      },
      select: { id: true },
    });

    const existingSet = new Set(existingAccounts.map((a: { id: string }) => a.id));
    const invalidIds = concreteIds.filter((id) => !existingSet.has(id));
    if (invalidIds.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Tài khoản vận chuyển không tồn tại hoặc không thuộc cửa hàng này: ${invalidIds.join(', ')}`,
        false,
        undefined,
        [
          {
            field: 'carrier_account_scopes',
            code: 'INVALID_CARRIER_ACCOUNT',
            message: `Tài khoản ${invalidIds[0]} không hợp lệ`,
          },
        ]
      );
    }
  }

  /**
   * GET /api/v1/users — List merchant users with pagination and filters (AC-USR-02-01, FEAT-RBAC-02).
   * Strictly scopes by caller merchant_id; passwords and tokens are never returned.
   */
  async listUsers(
    merchantId: string,
    queryOrCorrelationId?: ListUsersQueryDto | string,
    maybeCorrelationId?: string
  ) {
    const isQuery = typeof queryOrCorrelationId === 'object' && queryOrCorrelationId !== null;
    const query: ListUsersQueryDto = isQuery ? queryOrCorrelationId : {};
    const correlationId = isQuery
      ? maybeCorrelationId || ''
      : typeof queryOrCorrelationId === 'string'
        ? queryOrCorrelationId
        : '';

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
          custom_role_id: true,
          status: true,
          store_scopes: true,
          warehouse_scopes: true,
          carrier_account_scopes: true,
          created_at: true,
          device_sessions: {
            take: 1,
            orderBy: { last_active_at: 'desc' },
            select: { last_active_at: true },
          },
        },
      }),
    ]);

    const customRoleIds = Array.from(
      new Set(users.map((u) => u.custom_role_id).filter((id): id is string => Boolean(id)))
    );

    const customRolesMap = new Map();
    if (
      customRoleIds.length > 0 &&
      this.prisma.role &&
      typeof this.prisma.role.findMany === 'function'
    ) {
      const roles = await this.prisma.role.findMany({
        where: { id: { in: customRoleIds } },
        select: { id: true, name: true },
      });
      for (const r of roles) {
        customRolesMap.set(r.id, r.name);
      }
    }

    const formattedUsers = users.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      custom_role_id: u.custom_role_id,
      custom_role: u.custom_role_id
        ? {
            id: u.custom_role_id,
            name: customRolesMap.get(u.custom_role_id) || 'Tùy chỉnh',
          }
        : null,
      status: (u.status || 'ACTIVE').toUpperCase(),
      store_scopes: u.store_scopes || [],
      warehouse_scopes: u.warehouse_scopes || [],
      carrier_account_scopes: u.carrier_account_scopes || [],
      created_at: u.created_at.toISOString(),
      last_active_at: u.device_sessions?.[0]?.last_active_at?.toISOString() || null,
    }));

    return {
      data: formattedUsers,
      meta: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        correlation_id: correlationId,
      },
    };
  }

  /**
   * GET /api/v1/users/:id — Get user details by ID (AC-USR-02-02, FEAT-RBAC-02).
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
        custom_role_id: true,
        status: true,
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
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

    let customRole = null;
    if (
      user.custom_role_id &&
      this.prisma.role &&
      typeof this.prisma.role.findUnique === 'function'
    ) {
      const role = await this.prisma.role.findUnique({
        where: { id: user.custom_role_id },
        select: { id: true, name: true },
      });
      if (role) {
        customRole = role;
      }
    }

    return {
      data: {
        id: user.id,
        merchant_id: user.merchant_id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        custom_role_id: user.custom_role_id,
        custom_role: customRole,
        status: (user.status || 'ACTIVE').toUpperCase(),
        store_scopes: user.store_scopes || [],
        warehouse_scopes: user.warehouse_scopes || [],
        carrier_account_scopes: user.carrier_account_scopes || [],
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
   * Get specific user's assigned scopes in current merchant (FEAT-RBAC-02).
   */
  async getUserScopes(userId: string, merchantId: string, correlationId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, merchant_id: merchantId },
      select: {
        id: true,
        role: true,
        custom_role_id: true,
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
      },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'USER_NOT_FOUND',
        'Không tìm thấy người dùng trong cửa hàng',
        false
      );
    }

    return {
      data: {
        id: user.id,
        role: user.role,
        custom_role_id: user.custom_role_id,
        store_scopes: user.store_scopes || [],
        warehouse_scopes: user.warehouse_scopes || [],
        carrier_account_scopes: user.carrier_account_scopes || [],
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

    if (dto.carrier_account_scopes !== undefined) {
      if (!Array.isArray(dto.carrier_account_scopes)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'carrier_account_scopes phải là một danh sách chuỗi'
        );
      }
      if (!isActorOwner) {
        const actorCarriers = new Set(actorUser?.carrier_account_scopes || []);
        if (!actorCarriers.has('*')) {
          const unauthorized = dto.carrier_account_scopes.filter((c) => !actorCarriers.has(c));
          if (unauthorized.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'FORBIDDEN',
              `Vượt quá hạn mức phân quyền: Bạn không thể gán phạm vi tài khoản vận chuyển [${unauthorized.join(', ')}] vượt quá quyền hạn của mình`,
              false
            );
          }
        }
      }
      await this.validateCarrierAccountScopes(dto.carrier_account_scopes, actor.merchantId);
      dataToUpdate.carrier_account_scopes = dto.carrier_account_scopes;
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
              carrier_account_scopes: targetUser.carrier_account_scopes,
            },
            new_value: {
              full_name: updated.full_name,
              role: updated.role,
              store_scopes: updated.store_scopes,
              warehouse_scopes: updated.warehouse_scopes,
              carrier_account_scopes: updated.carrier_account_scopes,
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
   * Update scope assignments for a tenant user with transaction locking and audit trail.
   */
  async updateUserScopes(
    targetUserId: string,
    merchantId: string,
    dto: UpdateUserScopesDto,
    actor: {
      userId: string;
      merchantId: string;
      role?: string;
    },
    correlationId: string,
    clientIp: string
  ) {
    // 1. Array validation
    validateScopeArray(dto.store_scopes, 'store_scopes');
    validateScopeArray(dto.warehouse_scopes, 'warehouse_scopes');
    validateScopeArray(dto.carrier_account_scopes, 'carrier_account_scopes');

    // 2. Fetch actor user scopes for privilege ceiling check
    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: merchantId },
      select: {
        id: true,
        role: true,
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
      },
    });

    if (!actorUser) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người thực hiện không tồn tại hoặc không thuộc cửa hàng này',
        false
      );
    }

    // 3. Enforce privilege ceiling
    enforceScopePrivilegeCeiling(dto, {
      role: actorUser.role,
      store_scopes: actorUser.store_scopes || [],
      warehouse_scopes: actorUser.warehouse_scopes || [],
      carrier_account_scopes: actorUser.carrier_account_scopes || [],
    });

    // 4. Validate carrier accounts belong to merchant
    await this.validateCarrierAccountScopes(dto.carrier_account_scopes, merchantId);

    // 5. Atomic transaction with row locking
    try {
      return await this.prisma.$transaction(async (tx) => {
        let targetUser: any;
        try {
          const lockedRows = await tx.$queryRaw<any[]>`
            SELECT id, merchant_id, role, custom_role_id, store_scopes, warehouse_scopes, carrier_account_scopes
            FROM users
            WHERE id = ${targetUserId}::uuid
            FOR UPDATE
          `;
          if (lockedRows && lockedRows.length > 0) {
            targetUser = lockedRows[0];
          }
        } catch {
          targetUser = await tx.user.findUnique({
            where: { id: targetUserId },
          });
        }

        if (!targetUser) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'USER_NOT_FOUND',
            'Không tìm thấy người dùng được chỉ định',
            false
          );
        }

        // Strict tenant boundary check
        if (targetUser.merchant_id !== merchantId) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Không có quyền chỉnh sửa người dùng của cửa hàng khác',
            false
          );
        }

        const beforeScopes = {
          store_scopes: targetUser.store_scopes || [],
          warehouse_scopes: targetUser.warehouse_scopes || [],
          carrier_account_scopes: targetUser.carrier_account_scopes || [],
        };

        const newStoreScopes =
          dto.store_scopes !== undefined
            ? Array.from(new Set(dto.store_scopes))
            : beforeScopes.store_scopes;
        const newWarehouseScopes =
          dto.warehouse_scopes !== undefined
            ? Array.from(new Set(dto.warehouse_scopes))
            : beforeScopes.warehouse_scopes;
        const newCarrierAccountScopes =
          dto.carrier_account_scopes !== undefined
            ? Array.from(new Set(dto.carrier_account_scopes))
            : beforeScopes.carrier_account_scopes;

        const updatedUser = await tx.user.update({
          where: { id: targetUserId },
          data: {
            store_scopes: newStoreScopes,
            warehouse_scopes: newWarehouseScopes,
            carrier_account_scopes: newCarrierAccountScopes,
          },
          select: {
            id: true,
            role: true,
            custom_role_id: true,
            store_scopes: true,
            warehouse_scopes: true,
            carrier_account_scopes: true,
          },
        });

        // Write immutable audit log
        await tx.auditLog.create({
          data: {
            merchant_id: merchantId,
            user_id: actor.userId,
            action: 'USER_SCOPE_UPDATED',
            entity_type: 'User',
            entity_id: targetUserId,
            ip_address: clientIp,
            old_value: beforeScopes,
            new_value: {
              store_scopes: newStoreScopes,
              warehouse_scopes: newWarehouseScopes,
              carrier_account_scopes: newCarrierAccountScopes,
              correlation_id: correlationId,
            },
          },
        });

        return {
          data: {
            id: updatedUser.id,
            role: updatedUser.role,
            custom_role_id: updatedUser.custom_role_id,
            store_scopes: updatedUser.store_scopes,
            warehouse_scopes: updatedUser.warehouse_scopes,
            carrier_account_scopes: updatedUser.carrier_account_scopes,
          },
          meta: {
            correlation_id: correlationId,
          },
        };
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) {
        throw err;
      }
      if (isDeadlockOrSerializationError(err)) {
        throw createConcurrencyConflictException();
      }
      throw err;
    }
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
   * Scope authorization enforcement (AC-USR-01, AC-USR-01-17, AC-RBAC-02-09..16, BR-RBAC)
   * Validates if the authenticated user has access to a specific warehouse, store, or carrier account scope.
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

    // Validate at least one scope target is requested
    if (
      !requestedScope.warehouse_id &&
      !requestedScope.store_id &&
      !requestedScope.carrier_account_id
    ) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Yêu cầu phải chỉ định ít nhất store_id, warehouse_id hoặc carrier_account_id để kiểm tra phạm vi quyền hạn',
        false
      );
    }

    const userWarehouseScopes = user.warehouse_scopes || [];
    const userStoreScopes = user.store_scopes || [];
    const userCarrierAccountScopes = user.carrier_account_scopes || [];

    // Owner role has full access across all stores, warehouses, and carrier accounts
    if (user.role === RoleEnum.OWNER) {
      return {
        data: {
          authorized: true,
          user_id: user.id,
          role: user.role,
          store_scopes: userStoreScopes,
          warehouse_scopes: userWarehouseScopes,
          carrier_account_scopes: userCarrierAccountScopes,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    }

    // Warehouse scope enforcement (* or explicit membership)
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

    // Store scope enforcement (* or explicit membership)
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

    // Carrier account scope enforcement (* or explicit membership)
    if (requestedScope.carrier_account_id) {
      const allowed =
        userCarrierAccountScopes.includes('*') ||
        userCarrierAccountScopes.includes(requestedScope.carrier_account_id);
      if (!allowed) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền truy cập tài khoản vận chuyển được yêu cầu',
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
        carrier_account_scopes: userCarrierAccountScopes,
      },
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
              reason: dto.reason.trim(),
              revoked_sessions_count: revokedCount,
              correlation_id: correlationId,
            },
          },
        });

        const resData = {
          data: {
            user_id: targetUserId,
            status: 'RESET',
            reset: true,
            revoked_sessions_count: revokedCount,
            reset_at: now.toISOString(),
            message: 'Đã đặt lại xác thực hai yếu tố cho người dùng thành công',
          },
          meta: {
            correlation_id: correlationId,
          },
        };

        // F. Save idempotent replay result
        await tx.mfaAdminResetIdempotency.create({
          data: {
            merchant_id: actor.merchantId,
            idempotency_key: idempotencyKey.trim(),
            target_user_id: targetUserId,
            actor_user_id: actor.userId,
            reason: dto.reason.trim(),
            response: resData,
          },
        });

        return resData;
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        const raceReplay = await this.findIdempotentReplay(
          actor.merchantId,
          idempotencyKey.trim(),
          targetUserId,
          dto.reason.trim()
        );
        if (raceReplay) {
          return raceReplay;
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
}
