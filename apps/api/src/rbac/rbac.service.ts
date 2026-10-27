import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum } from '@prisma/client';
import { CanonicalApiException as BaseCanonicalApiException } from '../auth/auth.service';

export class CanonicalApiException extends BaseCanonicalApiException {
  constructor(
    statusCode: HttpStatus,
    code: string,
    message: string,
    retryable: boolean = false,
    nextAction?: string,
    fields?: any[],
    retryAfterSeconds?: number,
    extra?: Record<string, any>
  ) {
    super(statusCode, code, message, retryable, nextAction, fields, retryAfterSeconds, extra);
    this.message = message;
  }
}
import {
  PLATFORM_PERMISSIONS,
  SYSTEM_ROLES,
  CanonicalPermissionDefinition,
} from './rbac.constants';
import { CreateRoleDto, UpdateRoleDto, ActorContext } from './rbac.dto';

const isRoleEnumValue = (code: string | null): code is RoleEnum => {
  return Boolean(code && Object.values(RoleEnum).includes(code as any));
};

export const ACTIVE_USER_STATUS_FILTER = {
  equals: 'active',
  mode: 'insensitive' as const,
};

export function isUserActiveStatus(status?: string | null): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'active';
}

export function isRoleNameUniqueViolation(err: any): boolean {
  if (err?.code !== 'P2002') return false;
  const target = err?.meta?.target;
  if (Array.isArray(target)) {
    return (
      target.includes('name_lower') || (target.includes('merchant_id') && target.includes('name'))
    );
  }
  if (typeof target === 'string') {
    return target.includes('name_lower') || target.includes('roles_merchant_id_name_lower_key');
  }
  const message = String(err?.message || '');
  return (
    message.includes('roles_merchant_id_name_lower_key') ||
    (message.includes('name_lower') && message.includes('merchant_id'))
  );
}

// Deterministic UUID generator for canonical platform permissions & system roles
function deterministicUuid(prefix: string, index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return `${prefix}-0000-0000-0000-${hex}`;
}

const PERMISSION_UUID_PREFIX = '11111111';
const SYSTEM_ROLE_UUID_PREFIX = '22222222';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildPermissionFilter(permissions: string[]) {
  const uuidIds = permissions.filter((p) => UUID_REGEX.test(p));
  const orConditions: any[] = [{ code: { in: permissions } }];
  if (uuidIds.length > 0) {
    orConditions.push({ id: { in: uuidIds } });
  }
  return { OR: orConditions };
}

export const SYSTEM_ROLE_IDS: Record<string, string> = {
  OWNER: deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, 1),
  OPS_CSKH: deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, 2),
  WAREHOUSE: deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, 3),
  ACCOUNTANT: deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, 4),
  FINANCE: deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, 5),
};

@Injectable()
export class RbacService {
  private isSeeded = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Ensures platform permissions and system roles are populated in the database.
   * Runs as a single atomic transaction reconciling system roles and permissions (Finding 8 / BR-RBAC-01).
   */
  async ensurePlatformSeed(): Promise<void> {
    if (this.isSeeded) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Upsert all canonical platform permissions
        for (let i = 0; i < PLATFORM_PERMISSIONS.length; i++) {
          const p = PLATFORM_PERMISSIONS[i];
          const permId = deterministicUuid(PERMISSION_UUID_PREFIX, i + 1);
          await tx.permission.upsert({
            where: { code: p.code },
            update: {
              name: p.name,
              description: p.description,
              category: p.category,
            },
            create: {
              id: permId,
              code: p.code,
              name: p.name,
              description: p.description,
              category: p.category,
            },
          });
        }

        // Fetch all permission mappings by code within the transaction
        const allPerms = await tx.permission.findMany();
        const permMap = new Map<string, string>(allPerms.map((p) => [p.code, p.id]));

        // 2. Reconcile all built-in system roles transactionally
        for (let i = 0; i < SYSTEM_ROLES.length; i++) {
          const sr = SYSTEM_ROLES[i];
          const roleId =
            SYSTEM_ROLE_IDS[sr.code] || deterministicUuid(SYSTEM_ROLE_UUID_PREFIX, i + 1);

          const role = await tx.role.upsert({
            where: { code: sr.code },
            update: {
              name: sr.name,
              name_lower: sr.name.toLowerCase(),
              description: sr.description,
              is_system: true,
            },
            create: {
              id: roleId,
              code: sr.code,
              name: sr.name,
              name_lower: sr.name.toLowerCase(),
              description: sr.description,
              is_system: true,
              merchant_id: null,
            },
          });

          // Reconcile role_permissions: add missing, delete obsolete
          const desiredPermIds = new Set(
            sr.permissions.map((code) => permMap.get(code)).filter(Boolean) as string[]
          );
          const existingRolePerms = await tx.rolePermission.findMany({
            where: { role_id: role.id },
          });

          // Delete permissions no longer in SYSTEM_ROLES
          const toDelete = existingRolePerms.filter((rp) => !desiredPermIds.has(rp.permission_id));
          if (toDelete.length > 0) {
            await tx.rolePermission.deleteMany({
              where: {
                role_id: role.id,
                permission_id: { in: toDelete.map((rp) => rp.permission_id) },
              },
            });
          }

          // Insert missing permissions
          const existingPermIdSet = new Set(existingRolePerms.map((rp) => rp.permission_id));
          const toInsert = Array.from(desiredPermIds).filter((pid) => !existingPermIdSet.has(pid));
          for (const pId of toInsert) {
            await tx.rolePermission.create({
              data: {
                role_id: role.id,
                permission_id: pId,
              },
            });
          }
        }
      });

      this.isSeeded = true;
    } catch (err: any) {
      this.isSeeded = false;
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Không thể khởi tạo danh mục quyền hệ thống',
        true,
        'Vui lòng thử lại sau'
      );
    }
  }

  /**
   * GET /api/v1/permissions (AC-RBAC-01-01)
   */
  async getPermissions(correlationId: string) {
    await this.ensurePlatformSeed();

    try {
      const dbPermissions = await this.prisma.permission.findMany({
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
      });

      const categories = Array.from(new Set(dbPermissions.map((p) => p.category)));

      return {
        data: {
          permissions: dbPermissions.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          categories,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Không thể tải danh mục quyền hạn',
        true,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }
  }

  /**
   * Resolves the authoritative actor context from the server session userId.
   * Discards client/JWT-supplied roles to prevent privilege escalation via stale claims.
   */
  async resolveActorFromSession(req: {
    userId?: string;
    merchantId?: string;
    authAssurance?: string;
    mfaVerifiedAt?: any;
    jwtClaims?: any;
    userRole?: string;
    customRoleId?: string;
  }): Promise<ActorContext> {
    if (!req.userId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Phiên làm việc không có định danh người dùng hợp lệ',
        false,
        'Vui lòng đăng nhập lại'
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        role: true,
        custom_role_id: true,
        merchant_id: true,
        status: true,
      },
    });

    if (!user) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không tồn tại hoặc đã bị thu hồi quyền',
        false,
        'Vui lòng liên hệ quản trị viên'
      );
    }

    if (!isUserActiveStatus(user.status)) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản người dùng đã bị vô hiệu hóa hoặc chưa kích hoạt',
        false,
        'Vui lòng liên hệ quản trị viên'
      );
    }

    if (!user.merchant_id) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không thuộc tổ chức hợp lệ',
        false,
        'Vui lòng liên hệ quản trị viên'
      );
    }

    if (req.merchantId && user.merchant_id !== req.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không thuộc tổ chức hiện tại',
        false,
        'Vui lòng kiểm tra lại quyền truy cập'
      );
    }

    return {
      userId: user.id,
      merchantId: user.merchant_id,
      role: user.role,
      customRoleId: user.custom_role_id ?? undefined,
      authAssurance: req.authAssurance || req.jwtClaims?.auth_assurance,
      mfaVerifiedAt: req.mfaVerifiedAt || req.jwtClaims?.mfa_verified_at,
    };
  }

  /**
   * Resolves effective permission codes held by the given actor.
   */
  async getActorPermissions(actor: ActorContext, txClient?: any): Promise<string[]> {
    await this.ensurePlatformSeed();
    const db = txClient || this.prisma;

    let customRoleId = actor.customRoleId;
    let role = actor.role;
    let merchantId = actor.merchantId;

    if (actor.userId && (!role || customRoleId === undefined)) {
      try {
        const user = await db.user.findUnique({
          where: { id: actor.userId },
          select: { role: true, custom_role_id: true, merchant_id: true },
        });
        if (user) {
          role = user.role;
          customRoleId = user.custom_role_id ?? undefined;
          merchantId = user.merchant_id || merchantId;
        }
      } catch (err) {
        if (err instanceof CanonicalApiException) throw err;
        throw new CanonicalApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'SERVICE_UNAVAILABLE',
          'Không thể tải thông tin người dùng lúc này',
          true
        );
      }
    }

    // Custom role ceiling takes precedence over enum role
    if (customRoleId) {
      let customRole: any = null;
      try {
        customRole = await db.role.findFirst({
          where: { id: customRoleId, merchant_id: merchantId },
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        });
      } catch (err) {
        if (err instanceof CanonicalApiException) throw err;
        throw new CanonicalApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'SERVICE_UNAVAILABLE',
          'Không thể tải thông tin vai trò tùy chỉnh lúc này',
          true
        );
      }
      if (!customRole) {
        return [];
      }
      return customRole.permissions.map((rp: any) => rp.permission.code);
    }

    // System role resolution directly from reconciled DB rows (Finding 8 / BR-RBAC-01)
    if (role) {
      let sysRole: any = null;
      try {
        sysRole = await db.role.findFirst({
          where: { code: role, is_system: true },
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        });
      } catch (err) {
        if (err instanceof CanonicalApiException) throw err;
        throw new CanonicalApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'SERVICE_UNAVAILABLE',
          'Không thể tải thông tin vai trò hệ thống lúc này',
          true
        );
      }
      if (sysRole) {
        return sysRole.permissions.map((rp: any) => rp.permission.code);
      }
    }

    return [];
  }

  /**
   * Checks whether the actor possesses all required permissions.
   */
  async actorHasPermissions(actor: ActorContext, requiredPermissions: string[]): Promise<boolean> {
    const actorPerms = await this.getActorPermissions(actor);
    const actorPermSet = new Set(actorPerms);
    return requiredPermissions.every((p) => actorPermSet.has(p));
  }

  /**
   * GET /api/v1/roles (AC-RBAC-01-02)
   */
  async getRoles(merchantId: string, correlationId: string, actor?: ActorContext) {
    await this.ensurePlatformSeed();
    const canManageRoles = actor
      ? await this.actorHasPermissions(actor, ['iam:manage_users'])
      : false;

    try {
      // Fetch system roles and merchant custom roles from database
      const roles = await this.prisma.role.findMany({
        where: {
          OR: [{ is_system: true }, { merchant_id: merchantId }],
        },
        include: {
          permissions: {
            include: { permission: true },
          },
        },
        orderBy: [{ is_system: 'desc' }, { created_at: 'asc' }],
      });

      // Get active user counts for each role in this merchant
      const roleItems = await Promise.all(
        roles.map(async (role) => {
          let userCount = 0;
          if (role.is_system) {
            if (isRoleEnumValue(role.code)) {
              userCount = await this.prisma.user.count({
                where: {
                  merchant_id: merchantId,
                  role: role.code,
                  custom_role_id: null,
                  status: ACTIVE_USER_STATUS_FILTER,
                },
              });
            }
          } else {
            userCount = await this.prisma.user.count({
              where: {
                merchant_id: merchantId,
                custom_role_id: role.id,
                status: ACTIVE_USER_STATUS_FILTER,
              },
            });
          }

          const perms = (role.permissions || []).map((rp: any) => ({
            id: rp.permission.id,
            code: rp.permission.code,
            name: rp.permission.name,
            description: rp.permission.description,
            category: rp.permission.category,
          }));

          return {
            id: role.id,
            code: role.code || null,
            name: role.name,
            description: role.description || null,
            is_system: Boolean(role.is_system),
            merchant_id: role.merchant_id || null,
            permissions_count: perms.length,
            permissions: perms,
            user_count: userCount,
            created_at: role.created_at
              ? new Date(role.created_at).toISOString()
              : new Date().toISOString(),
            updated_at: role.updated_at
              ? new Date(role.updated_at).toISOString()
              : new Date().toISOString(),
          };
        })
      );

      return {
        data: {
          roles: roleItems,
          can_manage_roles: canManageRoles,
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Không thể tải danh sách vai trò phân quyền',
        true,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }
  }

  /**
   * GET /api/v1/roles/:id
   */
  async getRoleById(roleId: string, actor: ActorContext, correlationId: string) {
    await this.ensurePlatformSeed();

    try {
      const role = await this.prisma.role.findUnique({
        where: { id: roleId },
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      });

      if (!role) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'ROLE_NOT_FOUND',
          'Không tìm thấy vai trò phân quyền'
        );
      }

      // BR-RBAC-04 / AC-RBAC-01-11: Tenant Isolation (Finding 9)
      if (!role.is_system && (!actor.merchantId || role.merchant_id !== actor.merchantId)) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Không có quyền truy cập vai trò của đơn vị khác'
        );
      }

      let userCount = 0;
      if (role.is_system) {
        if (isRoleEnumValue(role.code)) {
          userCount = await this.prisma.user.count({
            where: {
              merchant_id: actor.merchantId,
              role: role.code,
              custom_role_id: null,
              status: ACTIVE_USER_STATUS_FILTER,
            },
          });
        }
      } else {
        userCount = await this.prisma.user.count({
          where: {
            merchant_id: actor.merchantId,
            custom_role_id: role.id,
            status: ACTIVE_USER_STATUS_FILTER,
          },
        });
      }

      const perms = (role.permissions || []).map((rp: any) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        name: rp.permission.name,
        description: rp.permission.description,
        category: rp.permission.category,
      }));

      return {
        data: {
          role: {
            id: role.id,
            code: role.code || null,
            name: role.name,
            description: role.description || null,
            is_system: Boolean(role.is_system),
            merchant_id: role.merchant_id || null,
            permissions_count: perms.length,
            permissions: perms,
            user_count: userCount,
            created_at: role.created_at
              ? new Date(role.created_at).toISOString()
              : new Date().toISOString(),
            updated_at: role.updated_at
              ? new Date(role.updated_at).toISOString()
              : new Date().toISOString(),
          },
        },
        meta: {
          correlation_id: correlationId,
        },
      };
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Không thể tải thông tin vai trò phân quyền',
        true,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }
  }

  /**
   * POST /api/v1/roles (AC-RBAC-01-03, 04, 05, 12, 13, 14, 15)
   */
  async createRole(
    dto: CreateRoleDto,
    actor: ActorContext,
    clientIp: string,
    correlationId: string
  ) {
    await this.ensurePlatformSeed();

    // 1. Authorization: Actor must hold 'iam:manage_users' (AC-RBAC-01-14)
    const canManageUsers = await this.actorHasPermissions(actor, ['iam:manage_users']);
    if (!canManageUsers) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý vai trò và phân quyền'
      );
    }

    // 2. Validation: missing role name (AC-RBAC-01-12)
    if (!dto.name || dto.name.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò là bắt buộc',
        false,
        'Vui lòng nhập tên vai trò hợp lệ',
        [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
      );
    }

    // 3. Validation: empty permissions array (AC-RBAC-01-13)
    if (!dto.permissions || !Array.isArray(dto.permissions) || dto.permissions.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Cần chọn ít nhất một quyền hạn',
        false,
        'Vui lòng chọn ít nhất một quyền hạn từ danh mục',
        [{ field: 'permissions', code: 'REQUIRED', message: 'Danh sách quyền không được để trống' }]
      );
    }

    const trimmedName = dto.name.trim();

    // 4. Duplicate name check within tenant (BR-RBAC-05, AC-RBAC-01-04)
    const existing = await this.prisma.role.findFirst({
      where: {
        merchant_id: actor.merchantId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });

    if (existing) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'ROLE_NAME_EXISTS',
        'Tên vai trò đã tồn tại trong cửa hàng',
        false,
        'Vui lòng chọn tên vai trò khác',
        [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
      );
    }

    // 5. Resolve permissions from DB (by code or id) first and verify exact match
    const permissionsInDb = await this.prisma.permission.findMany({
      where: buildPermissionFilter(dto.permissions),
    });

    const resolvedCodeSet = new Set(permissionsInDb.map((p) => p.code));
    const resolvedIdSet = new Set(permissionsInDb.map((p) => p.id));

    const missingOrInvalid = dto.permissions.filter(
      (requested) => !resolvedCodeSet.has(requested) && !resolvedIdSet.has(requested)
    );

    if (missingOrInvalid.length > 0 || permissionsInDb.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Các quyền hạn đã chọn không hợp lệ',
        false,
        `Quyền hạn sau không tồn tại trên hệ thống: ${missingOrInvalid.join(', ')}`,
        [
          {
            field: 'permissions',
            code: 'INVALID',
            message: `Quyền hạn không tồn tại trên hệ thống: ${missingOrInvalid.join(', ')}`,
          },
        ]
      );
    }

    // 6. Privilege Ceiling: Actor cannot grant permissions they do not possess (BR-RBAC-02, AC-RBAC-01-05)
    const actorPerms = await this.getActorPermissions(actor);
    const actorPermSet = new Set(actorPerms);

    const unauthorizedResolvedCodes = permissionsInDb
      .map((p) => p.code)
      .filter((code) => !actorPermSet.has(code));

    if (unauthorizedResolvedCodes.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'PRIVILEGE_ESCALATION_DENIED',
        'Không thể cấp quyền vượt quá thẩm quyền của bạn',
        false,
        `Bạn không có các quyền sau: ${unauthorizedResolvedCodes.join(', ')}`
      );
    }

    // 6. Execute in transaction with Audit Log (AC-RBAC-01-03, AC-RBAC-01-15)
    let createdRole: any;
    try {
      createdRole = await this.prisma.$transaction(async (tx) => {
        const existingInTx = await tx.role.findFirst({
          where: {
            merchant_id: actor.merchantId,
            name: { equals: trimmedName, mode: 'insensitive' },
          },
        });

        if (existingInTx) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'ROLE_NAME_EXISTS',
            'Tên vai trò đã tồn tại trong cửa hàng',
            false,
            'Vui lòng chọn tên vai trò khác',
            [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
          );
        }

        const role = await tx.role.create({
          data: {
            merchant_id: actor.merchantId,
            name: trimmedName,
            name_lower: trimmedName.toLowerCase(),
            description: dto.description?.trim() || null,
            is_system: false,
          },
        });

        // Insert role_permissions
        for (const perm of permissionsInDb) {
          await tx.rolePermission.create({
            data: {
              role_id: role.id,
              permission_id: perm.id,
            },
          });
        }

        // Write immutable audit log
        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'ROLE_CREATED',
            entity_type: 'Role',
            entity_id: role.id,
            new_value: {
              id: role.id,
              name: role.name,
              description: role.description,
              permissions: permissionsInDb.map((p) => p.code),
              correlation_id: correlationId,
            },
            ip_address: clientIp,
          },
        });

        return role;
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      if (isRoleNameUniqueViolation(err)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'ROLE_NAME_EXISTS',
          'Tên vai trò đã tồn tại trong cửa hàng',
          false,
          'Vui lòng chọn tên vai trò khác',
          [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
        );
      }
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Lỗi hệ thống khi tạo vai trò',
        false,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }

    return {
      data: {
        role: {
          id: createdRole.id,
          code: null,
          name: createdRole.name,
          description: createdRole.description,
          is_system: false,
          merchant_id: actor.merchantId,
          permissions_count: permissionsInDb.length,
          permissions: permissionsInDb.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          user_count: 0,
          created_at: createdRole.created_at.toISOString(),
          updated_at: createdRole.updated_at.toISOString(),
        },
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * PATCH /api/v1/roles/:id (AC-RBAC-01-06, 08, 11)
   */
  async updateRole(
    roleId: string,
    dto: UpdateRoleDto,
    actor: ActorContext,
    clientIp: string,
    correlationId: string
  ) {
    await this.ensurePlatformSeed();

    // 1. Authorization: Actor must hold 'iam:manage_users'
    const canManageUsers = await this.actorHasPermissions(actor, ['iam:manage_users']);
    if (!canManageUsers) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý vai trò và phân quyền'
      );
    }

    // 2. Find target role
    const existingRole = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    if (!existingRole) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
        'Không tìm thấy vai trò cần cập nhật'
      );
    }

    // BR-RBAC-01 / AC-RBAC-01-06: System Role Immutability
    if (existingRole.is_system) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SYSTEM_ROLE_IMMUTABLE',
        'Vai trò mặc định của hệ thống không thể chỉnh sửa hoặc xóa'
      );
    }

    // BR-RBAC-04 / AC-RBAC-01-11: Tenant Isolation
    if (!existingRole.merchant_id || existingRole.merchant_id !== actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không có quyền truy cập vai trò của đơn vị khác'
      );
    }

    // 3. Name validation & uniqueness check
    let updatedName = existingRole.name;
    if (dto.name !== undefined) {
      if (dto.name.trim().length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được để trống',
          false,
          undefined,
          [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
        );
      }
      updatedName = dto.name.trim();

      const duplicate = await this.prisma.role.findFirst({
        where: {
          merchant_id: actor.merchantId,
          id: { not: roleId },
          name: { equals: updatedName, mode: 'insensitive' },
        },
      });

      if (duplicate) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'ROLE_NAME_EXISTS',
          'Tên vai trò đã tồn tại trong cửa hàng',
          false,
          undefined,
          [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
        );
      }
    }

    // 4. Permissions validation & privilege ceiling check (BR-RBAC-02, AC-RBAC-01-05)
    let permissionsInDb = existingRole.permissions.map((rp) => rp.permission);
    if (dto.permissions !== undefined) {
      if (!Array.isArray(dto.permissions) || dto.permissions.length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Cần chọn ít nhất một quyền hạn',
          false,
          undefined,
          [
            {
              field: 'permissions',
              code: 'REQUIRED',
              message: 'Danh sách quyền không được để trống',
            },
          ]
        );
      }

      permissionsInDb = await this.prisma.permission.findMany({
        where: buildPermissionFilter(dto.permissions),
      });

      const resolvedCodeSet = new Set(permissionsInDb.map((p) => p.code));
      const resolvedIdSet = new Set(permissionsInDb.map((p) => p.id));

      const missingOrInvalid = dto.permissions.filter(
        (requested) => !resolvedCodeSet.has(requested) && !resolvedIdSet.has(requested)
      );

      if (missingOrInvalid.length > 0 || permissionsInDb.length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Các quyền hạn đã chọn không hợp lệ',
          false,
          `Quyền hạn sau không tồn tại trên hệ thống: ${missingOrInvalid.join(', ')}`,
          [
            {
              field: 'permissions',
              code: 'INVALID',
              message: `Quyền hạn không tồn tại trên hệ thống: ${missingOrInvalid.join(', ')}`,
            },
          ]
        );
      }
    }

    // Privilege Ceiling (BR-RBAC-02 / in-scope item 7):
    // 1. Actor must hold EVERY permission currently assigned to the role before modifying it.
    // 2. Resulting permission set must also strictly be a subset of the actor's permissions.
    const actorPerms = await this.getActorPermissions(actor);
    const actorPermSet = new Set(actorPerms);

    const unauthorizedCurrentCodes = existingRole.permissions
      .map((rp) => rp.permission.code)
      .filter((code) => !actorPermSet.has(code));

    if (unauthorizedCurrentCodes.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'PRIVILEGE_ESCALATION_DENIED',
        'Không thể sửa vai trò có quyền hạn vượt quá thẩm quyền của bạn',
        false,
        `Bạn không có các quyền hiện tại của vai trò: ${unauthorizedCurrentCodes.join(', ')}`
      );
    }

    const unauthorizedResolvedCodes = permissionsInDb
      .map((p) => p.code)
      .filter((code) => !actorPermSet.has(code));

    if (unauthorizedResolvedCodes.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'PRIVILEGE_ESCALATION_DENIED',
        'Không thể cấp quyền vượt quá thẩm quyền của bạn',
        false,
        `Bạn không có các quyền sau: ${unauthorizedResolvedCodes.join(', ')}`
      );
    }

    const beforePermissions = existingRole.permissions.map((rp) => rp.permission.code);
    const newPermissions = permissionsInDb.map((p) => p.code);

    // 5. Transaction: Update Role, Permissions & Audit Log (AC-RBAC-01-08, BR-RBAC-02)
    let updatedRole: any;
    try {
      updatedRole = await this.prisma.$transaction(async (tx) => {
        // Lock role row to serialize concurrent modifications (Finding 1 / Round 6)
        const lockedRoles = await tx.$queryRaw<
          Array<{ id: string; merchant_id: string; is_system: boolean }>
        >`SELECT id, merchant_id, is_system FROM roles WHERE id = ${roleId}::uuid AND merchant_id = ${actor.merchantId}::uuid FOR UPDATE`;

        if (!lockedRoles || lockedRoles.length === 0) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'ROLE_NOT_FOUND',
            'Không tìm thấy vai trò phân quyền'
          );
        }

        if (lockedRoles[0].is_system) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'SYSTEM_ROLE_IMMUTABLE',
            'Không thể chỉnh sửa vai trò mặc định của hệ thống',
            false,
            'Chỉ có thể chỉnh sửa các vai trò tùy chỉnh do cửa hàng tạo'
          );
        }

        // Re-read current role permissions under row lock to prevent stripping concurrent grants
        const currentRolePermsInTx = await tx.rolePermission.findMany({
          where: { role_id: roleId },
          include: { permission: true },
        });

        // Re-read actor permissions under transaction to prevent stale checks
        const actorPermsInTx = await this.getActorPermissions(actor, tx);
        const actorPermSetInTx = new Set(actorPermsInTx);

        // Privilege ceiling check 1: Actor must hold EVERY permission currently assigned to the role
        const unauthorizedCurrentCodes = currentRolePermsInTx
          .map((rp) => rp.permission.code)
          .filter((code) => !actorPermSetInTx.has(code));

        if (unauthorizedCurrentCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể sửa vai trò có quyền hạn vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền hiện tại của vai trò: ${unauthorizedCurrentCodes.join(', ')}`
          );
        }

        // If permissions were not explicitly passed in dto, keep current permissions
        const targetPermissions =
          dto.permissions !== undefined
            ? permissionsInDb
            : currentRolePermsInTx.map((rp) => rp.permission);

        // Privilege ceiling check 2: Target permission set must be a subset of actor's permissions
        const unauthorizedTargetCodes = targetPermissions
          .map((p) => p.code)
          .filter((code) => !actorPermSetInTx.has(code));

        if (unauthorizedTargetCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể cấp quyền vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền sau: ${unauthorizedTargetCodes.join(', ')}`
          );
        }

        const beforePermissions = currentRolePermsInTx.map((rp) => rp.permission.code);
        const newPermissions = targetPermissions.map((p) => p.code);

        if (dto.name !== undefined) {
          const duplicateInTx = await tx.role.findFirst({
            where: {
              merchant_id: actor.merchantId,
              id: { not: roleId },
              name: { equals: updatedName, mode: 'insensitive' },
            },
          });

          if (duplicateInTx) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'ROLE_NAME_EXISTS',
              'Tên vai trò đã tồn tại trong cửa hàng',
              false,
              undefined,
              [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
            );
          }
        }

        const updated = await tx.role.update({
          where: { id: roleId },
          data: {
            name: updatedName,
            name_lower: updatedName.toLowerCase(),
            description:
              dto.description !== undefined
                ? dto.description?.trim() || null
                : existingRole.description,
          },
        });

        if (dto.permissions !== undefined) {
          // Clear old mappings
          await tx.rolePermission.deleteMany({
            where: { role_id: roleId },
          });

          // Insert new mappings
          for (const p of targetPermissions) {
            await tx.rolePermission.create({
              data: {
                role_id: roleId,
                permission_id: p.id,
              },
            });
          }
        }

        // Write immutable audit log
        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'ROLE_UPDATED',
            entity_type: 'Role',
            entity_id: roleId,
            old_value: {
              name: existingRole.name,
              description: existingRole.description,
              permissions: beforePermissions,
            },
            new_value: {
              name: updated.name,
              description: updated.description,
              permissions: newPermissions,
              correlation_id: correlationId,
            },
            ip_address: clientIp,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      if (isRoleNameUniqueViolation(err)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'ROLE_NAME_EXISTS',
          'Tên vai trò đã tồn tại trong cửa hàng',
          false,
          'Vui lòng chọn tên vai trò khác',
          [{ field: 'name', code: 'DUPLICATE', message: 'Tên vai trò đã tồn tại' }]
        );
      }
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Lỗi hệ thống khi cập nhật vai trò',
        false,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }

    const activeUserCount = await this.prisma.user.count({
      where: {
        merchant_id: actor.merchantId,
        custom_role_id: roleId,
        status: ACTIVE_USER_STATUS_FILTER,
      },
    });

    return {
      data: {
        role: {
          id: updatedRole.id,
          code: null,
          name: updatedRole.name,
          description: updatedRole.description,
          is_system: false,
          merchant_id: actor.merchantId,
          permissions_count: permissionsInDb.length,
          permissions: permissionsInDb.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          user_count: activeUserCount,
          created_at: updatedRole.created_at.toISOString(),
          updated_at: updatedRole.updated_at.toISOString(),
        },
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }

  /**
   * DELETE /api/v1/roles/:id (AC-RBAC-01-07, 09, 10, 11)
   */
  async deleteRole(roleId: string, actor: ActorContext, clientIp: string, correlationId: string) {
    await this.ensurePlatformSeed();

    // 1. Authorization: Actor must hold 'iam:manage_users'
    const canManageUsers = await this.actorHasPermissions(actor, ['iam:manage_users']);
    if (!canManageUsers) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền quản lý vai trò và phân quyền'
      );
    }

    // 2. Find target role
    const existingRole = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true },
        },
      },
    });

    if (!existingRole) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'ROLE_NOT_FOUND',
        'Không tìm thấy vai trò cần xóa'
      );
    }

    // BR-RBAC-01 / AC-RBAC-01-07: System Role Immutability
    if (existingRole.is_system) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'SYSTEM_ROLE_IMMUTABLE',
        'Vai trò mặc định của hệ thống không thể chỉnh sửa hoặc xóa'
      );
    }

    // BR-RBAC-04 / AC-RBAC-01-11: Tenant Isolation
    if (!existingRole.merchant_id || existingRole.merchant_id !== actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Không có quyền truy cập vai trò của đơn vị khác'
      );
    }

    // Privilege Ceiling (BR-RBAC-02 / in-scope item 7):
    // Actor must hold EVERY permission currently assigned to the role before deleting it.
    const actorPerms = await this.getActorPermissions(actor);
    const actorPermSet = new Set(actorPerms);

    const unauthorizedRoleCodes = existingRole.permissions
      .map((rp) => rp.permission.code)
      .filter((code) => !actorPermSet.has(code));

    if (unauthorizedRoleCodes.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'PRIVILEGE_ESCALATION_DENIED',
        'Không thể xóa vai trò có quyền hạn vượt quá thẩm quyền của bạn',
        false,
        `Bạn không có các quyền hiện tại của vai trò: ${unauthorizedRoleCodes.join(', ')}`
      );
    }

    // 3. Transaction: Guard active assignments inside transaction with row locks, Delete Role & Write Audit Log (BR-RBAC-03, BR-RBAC-02, BR-RBAC-07)
    try {
      await this.prisma.$transaction(async (tx) => {
        // Lock the role row to serialize concurrent delete / assignment operations (Finding 1 / Round 5 & 6)
        const lockedRoles = await tx.$queryRaw<
          Array<{ id: string; merchant_id: string; is_system: boolean }>
        >`SELECT id, merchant_id, is_system FROM roles WHERE id = ${roleId}::uuid AND merchant_id = ${actor.merchantId}::uuid FOR UPDATE`;

        if (!lockedRoles || lockedRoles.length === 0) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'ROLE_NOT_FOUND',
            'Không tìm thấy vai trò phân quyền'
          );
        }

        if (lockedRoles[0].is_system) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'SYSTEM_ROLE_IMMUTABLE',
            'Không thể xóa vai trò mặc định của hệ thống',
            false,
            'Chỉ có thể xóa các vai trò tùy chỉnh do cửa hàng tạo'
          );
        }

        // Re-read current role permissions under lock (Finding 1 / Round 6)
        const currentRolePermsInTx = await tx.rolePermission.findMany({
          where: { role_id: roleId },
          include: { permission: true },
        });
        const currentRolePermCodes = currentRolePermsInTx.map((rp) => rp.permission.code);
        const customPermCodes = new Set(currentRolePermCodes);

        // Re-read actor permissions under transaction to avoid stale authorization
        const actorPermsInTx = await this.getActorPermissions(actor, tx);
        const actorPermSetInTx = new Set(actorPermsInTx);

        // Verify actor holds all current permissions of the role under the lock
        const unauthorizedRoleCodes = currentRolePermCodes.filter(
          (code) => !actorPermSetInTx.has(code)
        );
        if (unauthorizedRoleCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể xóa vai trò có quyền hạn vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền hiện tại của vai trò: ${unauthorizedRoleCodes.join(', ')}`
          );
        }

        // Lock all current assignees for this role in the merchant
        const assignees = await tx.$queryRaw<
          Array<{ id: string; status: string; role: string; custom_role_id: string }>
        >`SELECT id, status, role, custom_role_id FROM users WHERE custom_role_id = ${roleId}::uuid AND merchant_id = ${actor.merchantId}::uuid FOR UPDATE`;

        const activeAssignees = assignees.filter((u) => isUserActiveStatus(u.status));
        if (activeAssignees.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'ROLE_IN_USE',
            `Không thể xóa vai trò đang được gán cho ${activeAssignees.length} người dùng đang hoạt động`,
            false,
            'Vui lòng chuyển vai trò của các người dùng sang vai trò khác trước khi xóa',
            [
              {
                field: 'role_id',
                code: 'IN_USE',
                message: `Vai trò đang được gán cho ${activeAssignees.length} người dùng`,
              },
            ]
          );
        }

        // Inactive assignees handling:
        // Under lock, resolve enum fallback permissions directly from DB and check:
        // 1. Enum fallback must not expand beyond custom role permissions (!hasBroaderPerms)
        // 2. Enum fallback must be a subset of actor's DB permissions (Finding 1 / Round 6)
        const inactiveAssignees = assignees.filter((u) => !isUserActiveStatus(u.status));
        if (inactiveAssignees.length > 0) {
          const broaderUsers: string[] = [];

          for (const u of inactiveAssignees) {
            let enumPerms: string[] = [];
            const sysRole = await tx.role.findFirst({
              where: { code: u.role, is_system: true },
              include: { permissions: { include: { permission: true } } },
            });
            if (sysRole) {
              enumPerms = sysRole.permissions.map((rp: any) => rp.permission.code);
            } else {
              const enumDef = SYSTEM_ROLES.find((sr) => sr.code === u.role);
              enumPerms = enumDef ? enumDef.permissions : [];
            }

            const hasBroaderPerms = enumPerms.some((code: string) => !customPermCodes.has(code));
            const exceedsActorPerms = enumPerms.some((code: string) => !actorPermSetInTx.has(code));

            if (hasBroaderPerms || exceedsActorPerms) {
              broaderUsers.push(u.id);
            }
          }

          if (broaderUsers.length > 0) {
            throw new CanonicalApiException(
              HttpStatus.BAD_REQUEST,
              'ROLE_IN_USE',
              `Không thể xóa vai trò đang được gán cho ${broaderUsers.length} người dùng không hoạt động vì việc gỡ vai trò sẽ mở rộng quyền hạn hoặc vượt quá thẩm quyền của bạn`,
              false,
              'Vui lòng chuyển vai trò của người dùng sang vai trò thích hợp trước khi xóa',
              [
                {
                  field: 'role_id',
                  code: 'IN_USE',
                  message: `Gỡ vai trò sẽ mở rộng quyền hạn cho người dùng không hoạt động: ${broaderUsers.join(', ')}`,
                },
              ]
            );
          }

          // If not broader, safely detach each inactive user and audit each membership change (BR-RBAC-07)
          for (const u of inactiveAssignees) {
            await tx.user.update({
              where: { id: u.id },
              data: { custom_role_id: null },
            });

            await tx.auditLog.create({
              data: {
                merchant_id: actor.merchantId,
                user_id: actor.userId,
                action: 'USER_ROLE_DETACHED',
                entity_type: 'User',
                entity_id: u.id,
                old_value: {
                  custom_role_id: roleId,
                  role: u.role,
                },
                new_value: {
                  custom_role_id: null,
                  role: u.role,
                },
                ip_address: clientIp,
              },
            });
          }
        }

        // Remove role_permissions
        await tx.rolePermission.deleteMany({
          where: { role_id: roleId },
        });

        // Remove role
        await tx.role.delete({
          where: { id: roleId },
        });

        // Write immutable audit log
        await tx.auditLog.create({
          data: {
            merchant_id: actor.merchantId,
            user_id: actor.userId,
            action: 'ROLE_DELETED',
            entity_type: 'Role',
            entity_id: roleId,
            old_value: {
              id: existingRole.id,
              name: existingRole.name,
              description: existingRole.description,
              permissions: currentRolePermCodes,
              correlation_id: correlationId,
            },
            ip_address: clientIp,
          },
        });
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) throw err;
      if (err?.code === 'P2003' || /foreign key/i.test(err?.message || '')) {
        const fallbackCount = await this.prisma.user
          .count({
            where: {
              merchant_id: actor.merchantId,
              custom_role_id: roleId,
              status: ACTIVE_USER_STATUS_FILTER,
            },
          })
          .catch(() => 0);
        if (fallbackCount > 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'ROLE_IN_USE',
            `Không thể xóa vai trò đang được gán cho ${fallbackCount} người dùng đang hoạt động`,
            false,
            'Vui lòng chuyển vai trò của các người dùng sang vai trò khác trước khi xóa',
            [
              {
                field: 'role_id',
                code: 'IN_USE',
                message: `Vai trò đang được gán cho ${fallbackCount} người dùng`,
              },
            ]
          );
        }
      }
      throw new CanonicalApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'INTERNAL_SERVER_ERROR',
        'Lỗi hệ thống khi xóa vai trò',
        false,
        'Vui lòng thử lại sau hoặc liên hệ hỗ trợ'
      );
    }

    return {
      data: {
        id: roleId,
        deleted: true,
        message: 'Đã xóa vai trò tùy chỉnh thành công',
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
