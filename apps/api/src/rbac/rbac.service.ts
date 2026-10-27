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

export function isDeadlockOrSerializationError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || err.statusCode || '');
  const msg = String(err.message || '');
  return (
    code === '40P01' || // PostgreSQL deadlock_detected
    code === '40001' || // PostgreSQL serialization_failure
    code === 'P2034' || // Prisma transaction conflict / deadlock
    /deadlock detected/i.test(msg) ||
    /could not serialize access/i.test(msg) ||
    /concurrent update/i.test(msg) ||
    /deadlock/i.test(msg)
  );
}

export function createConcurrencyConflictException(): CanonicalApiException {
  return new CanonicalApiException(
    HttpStatus.CONFLICT,
    'CONFLICT',
    'Xung đột giao dịch đồng thời khi xử lý vai trò phân quyền',
    true,
    'Vui lòng thử lại thao tác'
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

    if (actor.userId) {
      try {
        const user = await db.user.findUnique({
          where: { id: actor.userId },
          select: { role: true, custom_role_id: true, merchant_id: true, status: true },
        });
        if (user) {
          if (!isUserActiveStatus(user.status)) {
            return [];
          }
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
   * Locks and reloads the actor row in transaction, locks actor's role and role_permissions
   * in consistent order with targetRoleId, and re-reads permissions under the locked snapshot (Finding 2 / Round 8).
   */
  async lockAndAuthorizeActor(
    tx: any,
    actor: ActorContext,
    requiredPermissions: string[] = ['iam:manage_users'],
    targetRoleId?: string
  ): Promise<{
    actorSnapshot: ActorContext;
    effectivePerms: string[];
    permSet: Set<string>;
  }> {
    if (!actor.userId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Thiếu thông tin người thực hiện'
      );
    }

    const lockedActors = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        role: RoleEnum;
        custom_role_id: string | null;
        merchant_id: string;
      }>
    >`SELECT id, status, role, custom_role_id, merchant_id FROM users WHERE id = ${actor.userId}::uuid FOR UPDATE`;

    if (!lockedActors || lockedActors.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không tồn tại hoặc đã bị xóa'
      );
    }

    const actorRow = lockedActors[0];
    if (!isUserActiveStatus(actorRow.status)) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Tài khoản người dùng đã bị khóa hoặc không hoạt động'
      );
    }

    if (actor.merchantId && actorRow.merchant_id !== actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không thuộc tổ chức hiện tại'
      );
    }

    const actorSnapshot: ActorContext = {
      ...actor,
      merchantId: actorRow.merchant_id,
      role: actorRow.role,
      customRoleId: actorRow.custom_role_id ?? undefined,
    };

    // Determine actor's role ID (custom role or system role)
    let actorRoleId = actorRow.custom_role_id;
    if (!actorRoleId && actorRow.role) {
      const sysRole = await tx.role.findFirst({
        where: { code: actorRow.role, is_system: true },
        select: { id: true },
      });
      actorRoleId = sysRole?.id;
    }

    // Lock in ONE global order: actor user -> actor role -> role_permissions -> target role (Finding 2 / Round 9)
    if (actorRoleId) {
      await tx.$queryRaw`SELECT id, merchant_id, is_system, name, description, code FROM roles WHERE id = ${actorRoleId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id, role_id, permission_id FROM role_permissions WHERE role_id = ${actorRoleId}::uuid FOR UPDATE`;
    }

    if (targetRoleId && targetRoleId !== actorRoleId) {
      await tx.$queryRaw`SELECT id, merchant_id, is_system, name, description, code FROM roles WHERE id = ${targetRoleId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id, role_id, permission_id FROM role_permissions WHERE role_id = ${targetRoleId}::uuid FOR UPDATE`;
    }

    // Re-read actor permissions under locked snapshot
    const effectivePerms = await this.getActorPermissions(actorSnapshot, tx);
    const permSet = new Set(effectivePerms);

    for (const required of requiredPermissions) {
      if (!permSet.has(required)) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Bạn không có quyền quản lý vai trò và phân quyền'
        );
      }
    }

    return { actorSnapshot, effectivePerms, permSet };
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

    // 2. Validation: role name type, empty, and max length (AC-RBAC-01-12, Finding 5 / Round 8)
    if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò là bắt buộc',
        false,
        'Vui lòng nhập tên vai trò hợp lệ',
        [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
      );
    }

    if (dto.name.trim().length > 255) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò không được vượt quá 255 ký tự',
        false,
        'Vui lòng nhập tên vai trò ngắn hơn 255 ký tự',
        [
          {
            field: 'name',
            code: 'MAX_LENGTH',
            message: 'Tên vai trò không được vượt quá 255 ký tự',
          },
        ]
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
        // Lock and reload actor row in transaction to ensure actor is active and holds iam:manage_users (Finding 1 / Round 7)
        const { actorSnapshot, permSet } = await this.lockAndAuthorizeActor(tx, actor);

        // In-transaction privilege ceiling re-check (Finding 1 / Round 7)
        const unauthorizedInTx = permissionsInDb
          .map((p) => p.code)
          .filter((code) => !permSet.has(code));
        if (unauthorizedInTx.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể cấp quyền vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền sau: ${unauthorizedInTx.join(', ')}`
          );
        }

        const existingInTx = await tx.role.findFirst({
          where: {
            merchant_id: actorSnapshot.merchantId,
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
            merchant_id: actorSnapshot.merchantId,
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
            merchant_id: actorSnapshot.merchantId,
            user_id: actorSnapshot.userId,
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

        return { role, actorSnapshot };
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
      if (isDeadlockOrSerializationError(err)) {
        throw createConcurrencyConflictException();
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
          id: createdRole.role.id,
          code: null,
          name: createdRole.role.name,
          description: createdRole.role.description,
          is_system: false,
          merchant_id: createdRole.actorSnapshot.merchantId,
          permissions_count: permissionsInDb.length,
          permissions: permissionsInDb.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          user_count: 0,
          created_at: createdRole.role.created_at
            ? createdRole.role.created_at.toISOString()
            : new Date().toISOString(),
          updated_at: createdRole.role.updated_at
            ? createdRole.role.updated_at.toISOString()
            : new Date().toISOString(),
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
      if (typeof dto.name !== 'string' || dto.name.trim().length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được để trống',
          false,
          undefined,
          [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
        );
      }
      if (dto.name.trim().length > 255) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được vượt quá 255 ký tự',
          false,
          undefined,
          [
            {
              field: 'name',
              code: 'MAX_LENGTH',
              message: 'Tên vai trò không được vượt quá 255 ký tự',
            },
          ]
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
        // Lock in ONE global order: actor user -> actor role -> role_permissions -> target role (Finding 2 / Round 9)
        const { actorSnapshot, permSet: actorPermSetInTx } = await this.lockAndAuthorizeActor(
          tx,
          actor,
          ['iam:manage_users'],
          roleId
        );

        // Re-read target role and permissions under row lock (Finding 3 / Round 8)
        const lockedTargetRole = await tx.role.findUnique({
          where: { id: roleId },
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        });

        if (!lockedTargetRole) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'ROLE_NOT_FOUND',
            'Không tìm thấy vai trò cần cập nhật'
          );
        }

        if (lockedTargetRole.is_system) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'SYSTEM_ROLE_IMMUTABLE',
            'Không thể chỉnh sửa vai trò mặc định của hệ thống',
            false,
            'Chỉ có thể chỉnh sửa các vai trò tùy chỉnh do cửa hàng tạo'
          );
        }

        if (
          !lockedTargetRole.merchant_id ||
          lockedTargetRole.merchant_id !== actorSnapshot.merchantId
        ) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Không có quyền truy cập vai trò của đơn vị khác'
          );
        }

        const currentRolePermsInTx = lockedTargetRole.permissions || [];
        const currentRolePermCodes = currentRolePermsInTx.map((rp: any) => rp.permission.code);

        // Privilege ceiling check 1: Actor must hold EVERY permission currently assigned to the locked role
        const unauthorizedCurrentCodes = currentRolePermCodes.filter(
          (code: string) => !actorPermSetInTx.has(code)
        );

        if (unauthorizedCurrentCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể sửa vai trò có quyền hạn vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền hiện tại của vai trò: ${unauthorizedCurrentCodes.join(', ')}`
          );
        }

        // Compute writes from lockedTargetRole snapshot (Finding 3 / Round 8)
        const effectiveName = dto.name !== undefined ? dto.name.trim() : lockedTargetRole.name;
        const effectiveDescription =
          dto.description !== undefined
            ? dto.description?.trim() || null
            : lockedTargetRole.description;

        // If permissions were not explicitly passed in dto, keep current locked permissions
        const targetPermissions =
          dto.permissions !== undefined
            ? permissionsInDb
            : currentRolePermsInTx.map((rp: any) => rp.permission);

        // Privilege ceiling check 2: Target permission set must be a subset of actor's permissions
        const unauthorizedTargetCodes = targetPermissions
          .map((p: any) => p.code)
          .filter((code: string) => !actorPermSetInTx.has(code));

        if (unauthorizedTargetCodes.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'PRIVILEGE_ESCALATION_DENIED',
            'Không thể cấp quyền vượt quá thẩm quyền của bạn',
            false,
            `Bạn không có các quyền sau: ${unauthorizedTargetCodes.join(', ')}`
          );
        }

        const beforePermissions = currentRolePermCodes;
        const newPermissions = targetPermissions.map((p: any) => p.code);

        if (dto.name !== undefined) {
          const duplicateInTx = await tx.role.findFirst({
            where: {
              merchant_id: actorSnapshot.merchantId,
              id: { not: roleId },
              name: { equals: effectiveName, mode: 'insensitive' },
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
            name: effectiveName,
            name_lower: effectiveName.toLowerCase(),
            description: effectiveDescription,
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

        // Write immutable audit log with locked before-image (Finding 3 / Round 8)
        await tx.auditLog.create({
          data: {
            merchant_id: actorSnapshot.merchantId,
            user_id: actorSnapshot.userId,
            action: 'ROLE_UPDATED',
            entity_type: 'Role',
            entity_id: roleId,
            old_value: {
              id: lockedTargetRole.id,
              name: lockedTargetRole.name,
              description: lockedTargetRole.description,
              permissions: beforePermissions,
              correlation_id: correlationId,
            },
            new_value: {
              id: updated.id,
              name: updated.name,
              description: updated.description,
              permissions: newPermissions,
              correlation_id: correlationId,
            },
            ip_address: clientIp,
          },
        });

        return { updated, targetPermissions, actorSnapshot };
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
      if (isDeadlockOrSerializationError(err)) {
        throw createConcurrencyConflictException();
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
        merchant_id: updatedRole.actorSnapshot.merchantId,
        custom_role_id: roleId,
        status: ACTIVE_USER_STATUS_FILTER,
      },
    });

    return {
      data: {
        role: {
          id: updatedRole.updated.id,
          code: null,
          name: updatedRole.updated.name,
          description: updatedRole.updated.description,
          is_system: false,
          merchant_id: updatedRole.actorSnapshot.merchantId,
          permissions_count: updatedRole.targetPermissions.length,
          permissions: updatedRole.targetPermissions.map((p: any) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          user_count: activeUserCount,
          created_at: updatedRole.updated.created_at
            ? updatedRole.updated.created_at.toISOString()
            : new Date().toISOString(),
          updated_at: updatedRole.updated.updated_at
            ? updatedRole.updated.updated_at.toISOString()
            : new Date().toISOString(),
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
        // 1. Lock in ONE global order: actor user -> actor role -> role_permissions -> target role (Finding 2 / Round 9)
        const { actorSnapshot, permSet: actorPermSetInTx } = await this.lockAndAuthorizeActor(
          tx,
          actor,
          ['iam:manage_users'],
          roleId
        );

        // 2. Re-read current role under lock (Finding 1 / Round 9)
        const lockedTargetRole = await tx.role.findUnique({
          where: { id: roleId },
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        });

        if (!lockedTargetRole) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'ROLE_NOT_FOUND',
            'Không tìm thấy vai trò phân quyền'
          );
        }

        if (lockedTargetRole.is_system) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'SYSTEM_ROLE_IMMUTABLE',
            'Không thể xóa vai trò mặc định của hệ thống',
            false,
            'Chỉ có thể xóa các vai trò tùy chỉnh do cửa hàng tạo'
          );
        }

        if (
          !lockedTargetRole.merchant_id ||
          lockedTargetRole.merchant_id !== actorSnapshot.merchantId
        ) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Không có quyền truy cập vai trò của đơn vị khác'
          );
        }

        const currentRolePermsInTx = lockedTargetRole.permissions || [];
        const currentRolePermCodes = currentRolePermsInTx.map((rp: any) => rp.permission.code);
        const customPermCodes = new Set(currentRolePermCodes);

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

        // Lock all current assignees for this role across the database (Finding 2 / Round 7)
        const assignees = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            role: string;
            custom_role_id: string;
            merchant_id: string;
          }>
        >`SELECT id, status, role, custom_role_id, merchant_id FROM users WHERE custom_role_id = ${roleId}::uuid FOR UPDATE`;

        const crossTenantAssignees = assignees.filter((u) => u.merchant_id !== actor.merchantId);
        if (crossTenantAssignees.length > 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'ROLE_IN_USE',
            `Không thể xóa vai trò đang được gán cho ${crossTenantAssignees.length} người dùng thuộc đơn vị khác`,
            false,
            'Vui lòng gỡ vai trò của tất cả người dùng trước khi xóa',
            [
              {
                field: 'role_id',
                code: 'IN_USE',
                message: `Vai trò đang được gán cho ${crossTenantAssignees.length} người dùng thuộc đơn vị khác`,
              },
            ]
          );
        }

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
                  message: `Vai trò đang được gán cho ${broaderUsers.length} người dùng không hoạt động`,
                },
              ],
              undefined,
              { broaderUsers }
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
                merchant_id: actorSnapshot.merchantId,
                user_id: actorSnapshot.userId,
                action: 'USER_ROLE_DETACHED',
                entity_type: 'User',
                entity_id: u.id,
                old_value: {
                  custom_role_id: roleId,
                  role: u.role,
                  correlation_id: correlationId,
                },
                new_value: {
                  custom_role_id: null,
                  role: u.role,
                  correlation_id: correlationId,
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

        // Write immutable audit log with locked before-image (Finding 1 / Round 9)
        await tx.auditLog.create({
          data: {
            merchant_id: actorSnapshot.merchantId,
            user_id: actorSnapshot.userId,
            action: 'ROLE_DELETED',
            entity_type: 'Role',
            entity_id: roleId,
            old_value: {
              id: lockedTargetRole.id,
              name: lockedTargetRole.name,
              description: lockedTargetRole.description,
              permissions: currentRolePermCodes,
              correlation_id: correlationId,
            },
            ip_address: clientIp,
          },
        });
      });
    } catch (err: any) {
      if (err instanceof CanonicalApiException) {
        if (err.code === 'ROLE_IN_USE' && err.extra?.broaderUsers) {
          const broaderUsers = err.extra.broaderUsers as string[];
          try {
            await this.prisma.$transaction(async (auditTx: any) => {
              await auditTx.auditLog.create({
                data: {
                  merchant_id: actor.merchantId || '',
                  user_id: actor.userId,
                  action: 'ROLE_DELETE_BLOCKED_INACTIVE_WIDENING',
                  entity_type: 'Role',
                  entity_id: roleId,
                  reason: 'DETACH_WOULD_WIDEN_PRIVILEGES',
                  old_value: {
                    role_id: roleId,
                    broader_user_count: broaderUsers.length,
                    broader_user_ids: broaderUsers,
                    correlation_id: correlationId,
                  },
                  ip_address: clientIp,
                },
              });
            });
          } catch (auditErr: any) {
            if (auditErr instanceof CanonicalApiException) throw auditErr;
            throw new CanonicalApiException(
              HttpStatus.INTERNAL_SERVER_ERROR,
              'INTERNAL_SERVER_ERROR',
              'Không thể lưu vết kiểm toán bảo mật khi chặn xóa vai trò',
              true
            );
          }
        }
        throw err;
      }
      if (isDeadlockOrSerializationError(err)) {
        throw createConcurrencyConflictException();
      }
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
