import {
  Injectable,
  Inject,
  Optional,
  HttpStatus,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoleEnum } from '@prisma/client';
import { CanonicalApiException as BaseCanonicalApiException } from '../auth/auth.service';
import {
  formatStructuredLog,
  sanitizeErrorMessage,
  AppConfig,
  WORKSPACE_ENV,
} from '@shipde/config';
import { APP_CONFIG } from '../config.token';

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
export type { ActorContext } from './rbac.dto';

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

// Validation helper rejecting angle brackets (<, >) and ASCII control characters (Finding / P2-01)
// Defense-in-depth: backend rejects dangerous characters with VALIDATION_ERROR; React handles standard output escaping.
export const FORBIDDEN_CHARACTERS_REGEX = /[<>\u0000-\u001F\u007F]/;

export function hasForbiddenRoleTextCharacters(text?: string | null): boolean {
  if (typeof text !== 'string') return false;
  return FORBIDDEN_CHARACTERS_REGEX.test(text);
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

export const SENSITIVE_CAPABILITY_PERMISSIONS = new Set([
  'pii:unmask',
  'iam:grant_action_permission',
  'reconciliation:approve_rate_policy',
]);

export const MFA_FRESH_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function isMfaAssuranceFresh(
  authAssurance?: string,
  mfaVerifiedAt?: Date | string | null
): boolean {
  if (authAssurance !== 'MFA' || !mfaVerifiedAt) {
    return false;
  }
  const verifiedTime = new Date(mfaVerifiedAt).getTime();
  if (Number.isNaN(verifiedTime)) {
    return false;
  }
  const ageMs = Date.now() - verifiedTime;
  return ageMs >= -60000 && ageMs <= MFA_FRESH_WINDOW_MS;
}

export const NODE_MAX_TIMER_MS = 2_147_483_647;
export const MAX_RETRY_BACKOFF_MS = 30_000;

@Injectable()
export class RbacService implements OnModuleInit, OnModuleDestroy {
  private isSeeded = false;
  private isDestroyed = false;
  private retryTimeoutHandle: NodeJS.Timeout | null = null;
  private retryResolve: (() => void) | null = null;
  public inFlightSeedPromise: Promise<void> | null = null;
  public seedPromise: Promise<void> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(APP_CONFIG) private readonly config?: AppConfig
  ) {}

  isReady(): boolean {
    return this.isSeeded;
  }

  assertPlatformSeedReady(): void {
    if (!this.isReady()) {
      throw new CanonicalApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'Danh mục phân quyền hệ thống đang được khởi tạo, vui lòng thử lại sau',
        true,
        'Vui lòng thử lại sau'
      );
    }
  }

  private resolveRetryIntervalMs(): number {
    const val =
      this.config?.RBAC_SEED_RETRY_INTERVAL_MS ?? WORKSPACE_ENV.DEFAULT_RBAC_SEED_RETRY_INTERVAL_MS;
    return Math.min(Math.max(1, val), NODE_MAX_TIMER_MS);
  }

  private resolveMaxAttempts(): number {
    return this.config?.RBAC_SEED_MAX_ATTEMPTS ?? WORKSPACE_ENV.DEFAULT_RBAC_SEED_MAX_ATTEMPTS;
  }

  private resolveBackoffFactor(): number {
    return this.config?.RBAC_SEED_BACKOFF_FACTOR ?? WORKSPACE_ENV.DEFAULT_RBAC_SEED_BACKOFF_FACTOR;
  }

  async onModuleInit(): Promise<void> {
    if (typeof this.prisma?.$transaction !== 'function') {
      this.isSeeded = false;
      return;
    }
    // Startup is non-blocking (AC-FOUND-03-04, AC-FOUND-03-06).
    // Bounded retry loop runs in background until platform seed succeeds.
    this.seedPromise = this.executePlatformSeedWithRetry();
    void this.seedPromise.catch(() => {
      // Unhandled rejection safety
    });
  }

  async executePlatformSeedWithRetry(): Promise<void> {
    if (this.isSeeded) return;

    const retryIntervalMs = this.resolveRetryIntervalMs();
    const maxAttempts = this.resolveMaxAttempts();
    const backoffFactor = this.resolveBackoffFactor();

    let currentDelayMs = retryIntervalMs;

    for (
      let attempt = 1;
      attempt <= maxAttempts && !this.isSeeded && !this.isDestroyed;
      attempt++
    ) {
      try {
        await this.ensurePlatformSeed();
        console.info(
          formatStructuredLog({
            level: 'info',
            service: 'api',
            message: 'RBAC platform permissions and system roles seeded successfully',
            metadata: { attempt },
          })
        );
        return;
      } catch (err: unknown) {
        // A failed attempt never clears a newer success (Finding 2)
        const isLastAttempt = attempt >= maxAttempts;
        const originalError = (err as any)?.originalError ?? err;
        const sanitizedCause = sanitizeErrorMessage(originalError);

        console.error(
          formatStructuredLog({
            level: 'error',
            service: 'api',
            message: `RBAC platform seed attempt ${attempt}/${maxAttempts} failed: ${sanitizedCause}`,
            metadata: {
              attempt,
              maxAttempts,
              retryable: !isLastAttempt,
              nextRetryDelayMs: isLastAttempt ? null : currentDelayMs,
            },
          })
        );

        if (!isLastAttempt && !this.isDestroyed && !this.isSeeded) {
          await this.delay(currentDelayMs);
          currentDelayMs = Math.min(
            Math.round(currentDelayMs * backoffFactor),
            MAX_RETRY_BACKOFF_MS
          );
        }
      }
    }

    if (!this.isSeeded && !this.isDestroyed) {
      console.error(
        formatStructuredLog({
          level: 'error',
          service: 'api',
          message:
            'RBAC platform seed exhausted initial retry attempts; continuing background retries with capped backoff',
          metadata: { maxAttempts },
        })
      );

      // Keep retrying in background with capped backoff instead of giving up permanently (Residual risk recovery)
      void this.continueIndefiniteBackgroundRetry(currentDelayMs, backoffFactor, maxAttempts).catch(
        () => {}
      );
    }
  }

  private async continueIndefiniteBackgroundRetry(
    initialDelayMs: number,
    backoffFactor: number,
    initialAttempts: number
  ): Promise<void> {
    let currentDelayMs = Math.min(Math.round(initialDelayMs * backoffFactor), MAX_RETRY_BACKOFF_MS);
    let attempt = initialAttempts + 1;

    while (!this.isSeeded && !this.isDestroyed) {
      await this.delay(currentDelayMs);
      if (this.isSeeded || this.isDestroyed) break;

      try {
        await this.ensurePlatformSeed();
        console.info(
          formatStructuredLog({
            level: 'info',
            service: 'api',
            message: 'RBAC platform permissions and system roles seeded successfully',
            metadata: { attempt },
          })
        );
        return;
      } catch (err: unknown) {
        const originalError = (err as any)?.originalError ?? err;
        const sanitizedCause = sanitizeErrorMessage(originalError);
        console.error(
          formatStructuredLog({
            level: 'error',
            service: 'api',
            message: `RBAC platform seed background retry attempt ${attempt} failed: ${sanitizedCause}`,
            metadata: {
              attempt,
              retryable: true,
              nextRetryDelayMs: currentDelayMs,
            },
          })
        );
        currentDelayMs = Math.min(Math.round(currentDelayMs * backoffFactor), MAX_RETRY_BACKOFF_MS);
        attempt++;
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    const clampedMs = Math.min(Math.max(0, ms), NODE_MAX_TIMER_MS);
    return new Promise<void>((resolve) => {
      this.retryResolve = resolve;
      this.retryTimeoutHandle = setTimeout(() => {
        this.retryTimeoutHandle = null;
        this.retryResolve = null;
        resolve();
      }, clampedMs);
    });
  }

  onModuleDestroy(): void {
    this.isDestroyed = true;
    if (this.retryTimeoutHandle) {
      clearTimeout(this.retryTimeoutHandle);
      this.retryTimeoutHandle = null;
    }
    if (this.retryResolve) {
      const resolve = this.retryResolve;
      this.retryResolve = null;
      resolve();
    }
  }

  /**
   * Ensures platform permissions and system roles are populated in the database.
   * Runs as a single atomic transaction reconciling system roles and permissions (Finding 8 / BR-RBAC-01).
   * Shares a single in-flight promise to prevent concurrent duplicate execution (Finding 2).
   */
  async ensurePlatformSeed(): Promise<void> {
    if (this.isSeeded) return;

    if (this.inFlightSeedPromise) {
      return this.inFlightSeedPromise;
    }

    const runSeed = async (): Promise<void> => {
      try {
        if (typeof this.prisma?.$transaction !== 'function') {
          throw new Error('Prisma $transaction is not available');
        }

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
            const toDelete = existingRolePerms.filter(
              (rp) => !desiredPermIds.has(rp.permission_id)
            );
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
            const toInsert = Array.from(desiredPermIds).filter(
              (pid) => !existingPermIdSet.has(pid)
            );
            for (const pId of toInsert) {
              await tx.rolePermission.create({
                data: {
                  role_id: role.id,
                  permission_id: pId,
                },
              });
            }

            // Append audit record for every system-role permission change (Finding 1 / Round 12 / BR-RBAC-07 / BR-RBAC-04)
            // Platform seed audit must not depend on a customer merchant; uses nullable platform actor matching audit schema
            if (toDelete.length > 0 || toInsert.length > 0) {
              await tx.auditLog.create({
                data: {
                  merchant_id: null,
                  user_id: null,
                  action: 'SYSTEM_ROLE_PERMISSIONS_RECONCILED',
                  entity_type: 'Role',
                  entity_id: role.id,
                  old_value: {
                    code: sr.code,
                    permissions: existingRolePerms.map((rp) => rp.permission_id),
                  },
                  new_value: {
                    code: sr.code,
                    permissions: Array.from(desiredPermIds),
                  },
                  reason: 'System role seed reconciliation',
                },
              });
            }
          }
        });

        this.isSeeded = true;
      } catch (err: any) {
        // Finding 2 & Finding 5:
        // A failed attempt NEVER clears an existing success (e.g. if another caller committed)!
        // Preserve original error cause sanitized for observability.
        const originalError = err;
        const sanitizedCause = sanitizeErrorMessage(originalError);
        const canonicalEx = new CanonicalApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'SERVICE_UNAVAILABLE',
          'Không thể khởi tạo danh mục quyền hệ thống',
          true,
          'Vui lòng thử lại sau',
          undefined,
          undefined,
          { originalCause: sanitizedCause }
        );
        (canonicalEx as any).originalError = originalError;
        throw canonicalEx;
      } finally {
        this.inFlightSeedPromise = null;
      }
    };

    const promise = runSeed();
    this.inFlightSeedPromise = promise;
    return promise;
  }

  /**
   * GET /api/v1/permissions (AC-RBAC-01-01)
   */
  async getPermissions(correlationId: string) {
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
    sessionId?: string;
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

    // Finding 1 / Round 13 / Finding 3 / Round 14 (P1-03): Only accept server-resolved sessionId; populate authAssurance and mfaVerifiedAt from active device_session
    const sessionId = req.sessionId ? req.sessionId : undefined;
    let authAssurance: string | undefined = undefined;
    let mfaVerifiedAt: Date | string | null | undefined = undefined;

    if (sessionId) {
      try {
        const sessionRow = await (this.prisma as any).deviceSession?.findUnique?.({
          where: { id: sessionId },
          select: {
            id: true,
            user_id: true,
            status: true,
            expires_at: true,
            auth_assurance: true,
            mfa_verified_at: true,
          },
        });
        if (
          sessionRow &&
          sessionRow.user_id === user.id &&
          sessionRow.status === 'ACTIVE' &&
          new Date(sessionRow.expires_at) > new Date()
        ) {
          authAssurance = sessionRow.auth_assurance;
          mfaVerifiedAt = sessionRow.mfa_verified_at;
        }
      } catch {
        // Fall back to undefined; in-transaction lockAndAuthorizeActor will query device_sessions under FOR UPDATE
      }
    }

    return {
      userId: user.id,
      merchantId: user.merchant_id,
      role: user.role,
      customRoleId: user.custom_role_id ?? undefined,
      sessionId,
      authAssurance,
      mfaVerifiedAt,
    };
  }

  /**
   * Resolves effective permission codes held by the given actor.
   */
  async getActorPermissions(actor: ActorContext, txClient?: any): Promise<string[]> {
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
        if (!user) {
          return [];
        }
        if (!isUserActiveStatus(user.status)) {
          return [];
        }
        role = user.role;
        customRoleId = user.custom_role_id ?? undefined;
        merchantId = user.merchant_id || merchantId;
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

    // Assurance is only loaded from active, unexpired device_sessions under FOR UPDATE (Finding 2 / Round 12)
    let authAssurance: string | undefined = undefined;
    let mfaVerifiedAt: Date | null = null;

    if (actor.sessionId) {
      const sessions = await tx.$queryRaw<
        Array<{
          id: string;
          auth_assurance: string;
          mfa_verified_at: Date | null;
          status: string;
          expires_at: Date;
        }>
      >`SELECT id, auth_assurance, mfa_verified_at, status, expires_at FROM device_sessions WHERE id = ${actor.sessionId}::uuid AND user_id = ${actor.userId}::uuid FOR UPDATE`;

      if (sessions && sessions.length > 0) {
        const s = sessions[0];
        // Finding 1 / Round 13: If session is missing, not active, or expired, abort with 401 SESSION_INVALID before any role or audit write
        if (s.status !== 'ACTIVE' || new Date(s.expires_at) <= new Date()) {
          throw new CanonicalApiException(
            HttpStatus.UNAUTHORIZED,
            'SESSION_INVALID',
            'Phiên làm việc đã hết hạn hoặc bị thu hồi'
          );
        }
        authAssurance = s.auth_assurance;
        mfaVerifiedAt = s.mfa_verified_at;
      } else {
        throw new CanonicalApiException(
          HttpStatus.UNAUTHORIZED,
          'SESSION_INVALID',
          'Phiên làm việc không tồn tại hoặc đã bị thu hồi'
        );
      }
    }

    const actorSnapshot: ActorContext = {
      ...actor,
      merchantId: actorRow.merchant_id,
      role: actorRow.role,
      customRoleId: actorRow.custom_role_id ?? undefined,
      authAssurance,
      mfaVerifiedAt,
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

      // Single grouped query fetching active user counts across all roles for this merchant (P2-04)
      const userCounts = await this.prisma.user.groupBy({
        by: ['role', 'custom_role_id'],
        where: {
          merchant_id: merchantId,
          status: ACTIVE_USER_STATUS_FILTER,
        },
        _count: {
          _all: true,
        },
      });

      const systemUserCounts = new Map<string, number>();
      const customUserCounts = new Map<string, number>();

      for (const entry of userCounts) {
        const count = entry._count?._all || 0;
        if (entry.custom_role_id) {
          customUserCounts.set(
            entry.custom_role_id,
            (customUserCounts.get(entry.custom_role_id) || 0) + count
          );
        } else if (entry.role) {
          systemUserCounts.set(entry.role, (systemUserCounts.get(entry.role) || 0) + count);
        }
      }

      const roleItems = roles.map((role) => {
        let userCount = 0;
        if (role.is_system) {
          if (role.code) {
            userCount = systemUserCounts.get(role.code) || 0;
          }
        } else {
          userCount = customUserCounts.get(role.id) || 0;
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
      });

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
    // Synchronous format/type validation
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

    // 2b. Validation: description type and max length (Finding 5 / Round 10)
    if (dto.description !== undefined && dto.description !== null) {
      if (typeof dto.description !== 'string') {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò phải là chuỗi ký tự',
          false,
          'Vui lòng nhập mô tả hợp lệ',
          [
            {
              field: 'description',
              code: 'INVALID_TYPE',
              message: 'Mô tả vai trò phải là chuỗi ký tự',
            },
          ]
        );
      }
      if (dto.description.length > 1000) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được vượt quá 1000 ký tự',
          false,
          'Vui lòng nhập mô tả ngắn hơn 1000 ký tự',
          [
            {
              field: 'description',
              code: 'MAX_LENGTH',
              message: 'Mô tả vai trò không được vượt quá 1000 ký tự',
            },
          ]
        );
      }
    }

    // 3. Validation: empty permissions array and max count (AC-RBAC-01-13, Finding 5 / Round 10)
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
    if (dto.permissions.length > 50) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Danh sách quyền hạn không được vượt quá 50 mục',
        false,
        'Vui lòng chọn tối đa 50 quyền hạn',
        [
          {
            field: 'permissions',
            code: 'MAX_ITEMS',
            message: 'Danh sách quyền hạn không được vượt quá 50 mục',
          },
        ]
      );
    }

    if (hasForbiddenRoleTextCharacters(dto.name)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
        false,
        'Vui lòng nhập tên vai trò hợp lệ không chứa ký tự đặc biệt',
        [
          {
            field: 'name',
            code: 'INVALID_CHARACTERS',
            message: 'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          },
        ]
      );
    }
    const trimmedName = dto.name.trim();

    if (
      dto.description !== undefined &&
      dto.description !== null &&
      hasForbiddenRoleTextCharacters(dto.description)
    ) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
        false,
        'Vui lòng nhập mô tả hợp lệ không chứa ký tự đặc biệt',
        [
          {
            field: 'description',
            code: 'INVALID_CHARACTERS',
            message: 'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          },
        ]
      );
    }
    const sanitizedDescription =
      dto.description !== undefined && dto.description !== null
        ? dto.description.trim() || null
        : null;

    // 5. Execute in transaction with authoritative locks, privilege ceiling, duplicate check, and Audit Log (AC-RBAC-01-03, AC-RBAC-01-15, P1-02, P1-03, P1-04)
    let createdRole: any;
    try {
      createdRole = await this.prisma.$transaction(async (tx) => {
        // Lock and reload actor row in transaction to ensure actor is active and holds iam:manage_users (Finding 1 / Round 7, P1-02)
        const { actorSnapshot, permSet } = await this.lockAndAuthorizeActor(tx, actor);

        // Resolve permissions from DB under transaction (P1-03)
        const permissionsInDb = await tx.permission.findMany({
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

        // In-transaction fresh MFA assurance check for sensitive capabilities (Finding 2 / Round 12)
        // Sensitive grants must load auth_assurance and mfa_verified_at only from caller's active, unexpired device_sessions row under FOR UPDATE, and reject when that row is missing
        const hasSensitiveGrants = permissionsInDb.some((p) =>
          SENSITIVE_CAPABILITY_PERMISSIONS.has(p.code)
        );
        if (hasSensitiveGrants) {
          if (
            !actorSnapshot.sessionId ||
            !actorSnapshot.authAssurance ||
            !isMfaAssuranceFresh(actorSnapshot.authAssurance, actorSnapshot.mfaVerifiedAt)
          ) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'MFA_FRESH_AUTH_REQUIRED',
              'Thao tác gán quyền hạn nhạy cảm yêu cầu phiên làm việc đã xác thực MFA',
              false,
              'Vui lòng xác thực hai yếu tố trước khi gán các quyền hạn nhạy cảm'
            );
          }
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
            description: sanitizedDescription,
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

        return { role, permissionsInDb, actorSnapshot };
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
          permissions_count: createdRole.permissionsInDb.length,
          permissions: createdRole.permissionsInDb.map((p: any) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            category: p.category,
          })),
          user_count: 0,
          created_at:
            createdRole.role.created_at instanceof Date
              ? createdRole.role.created_at.toISOString()
              : typeof createdRole.role.created_at === 'string'
                ? createdRole.role.created_at
                : new Date().toISOString(),
          updated_at:
            createdRole.role.updated_at instanceof Date
              ? createdRole.role.updated_at.toISOString()
              : typeof createdRole.role.updated_at === 'string'
                ? createdRole.role.updated_at
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
    // Synchronous format/type validation
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
      if (hasForbiddenRoleTextCharacters(dto.name)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          false,
          'Vui lòng nhập tên vai trò hợp lệ không chứa ký tự đặc biệt',
          [
            {
              field: 'name',
              code: 'INVALID_CHARACTERS',
              message: 'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
            },
          ]
        );
      }
    }

    // Validation: description type and max length (Finding 5 / Round 10)
    if (dto.description !== undefined && dto.description !== null) {
      if (typeof dto.description !== 'string') {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò phải là chuỗi ký tự',
          false,
          'Vui lòng nhập mô tả hợp lệ',
          [
            {
              field: 'description',
              code: 'INVALID_TYPE',
              message: 'Mô tả vai trò phải là chuỗi ký tự',
            },
          ]
        );
      }
      if (dto.description.length > 1000) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được vượt quá 1000 ký tự',
          false,
          'Vui lòng nhập mô tả ngắn hơn 1000 ký tự',
          [
            {
              field: 'description',
              code: 'MAX_LENGTH',
              message: 'Mô tả vai trò không được vượt quá 1000 ký tự',
            },
          ]
        );
      }
      if (hasForbiddenRoleTextCharacters(dto.description)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          false,
          'Vui lòng nhập mô tả hợp lệ không chứa ký tự đặc biệt',
          [
            {
              field: 'description',
              code: 'INVALID_CHARACTERS',
              message: 'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
            },
          ]
        );
      }
    }

    // Permissions validation: array bounds check
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
      if (dto.permissions.length > 50) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Danh sách quyền hạn không được vượt quá 50 mục',
          false,
          'Vui lòng chọn tối đa 50 quyền hạn',
          [
            {
              field: 'permissions',
              code: 'MAX_ITEMS',
              message: 'Danh sách quyền hạn không được vượt quá 50 mục',
            },
          ]
        );
      }
    }

    // All database reads, decisions, privilege checks, and duplicate checks are inside the transaction after row locks (P1-02, P1-03, P1-04)
    let updatedRole: any;
    try {
      updatedRole = await this.prisma.$transaction(async (tx) => {
        // Lock in ONE global order: actor user -> actor role -> role_permissions -> target role (Finding 2 / Round 9, P1-02)
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
            ? dto.description
              ? dto.description.trim() || null
              : null
            : lockedTargetRole.description;

        // Resolve permissions from DB under transaction (P1-03)
        let targetPermissions: any[];
        if (dto.permissions !== undefined) {
          const permissionsInDb = await tx.permission.findMany({
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
          targetPermissions = permissionsInDb;
        } else {
          targetPermissions = currentRolePermsInTx.map((rp: any) => rp.permission);
        }

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

        // In-transaction fresh MFA assurance check for sensitive capabilities (Finding 1 / Round 11 / Finding 2 / Round 12 / P1-02)
        // Enforce MFA for any mutation touching a role that contains or will contain sensitive permissions
        const touchesSensitiveGrantsInTx =
          newPermissions.some((code: string) => SENSITIVE_CAPABILITY_PERMISSIONS.has(code)) ||
          beforePermissions.some((code: string) => SENSITIVE_CAPABILITY_PERMISSIONS.has(code));

        if (touchesSensitiveGrantsInTx) {
          if (
            !actorSnapshot.sessionId ||
            !actorSnapshot.authAssurance ||
            !isMfaAssuranceFresh(actorSnapshot.authAssurance, actorSnapshot.mfaVerifiedAt)
          ) {
            throw new CanonicalApiException(
              HttpStatus.FORBIDDEN,
              'MFA_FRESH_AUTH_REQUIRED',
              'Thao tác thay đổi vai trò có quyền hạn nhạy cảm yêu cầu phiên làm việc đã xác thực MFA',
              false,
              'Vui lòng xác thực hai yếu tố trước khi thao tác trên các vai trò có quyền hạn nhạy cảm'
            );
          }
        }

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
          created_at:
            updatedRole.updated.created_at instanceof Date
              ? updatedRole.updated.created_at.toISOString()
              : typeof updatedRole.updated.created_at === 'string'
                ? updatedRole.updated.created_at
                : new Date().toISOString(),
          updated_at:
            updatedRole.updated.updated_at instanceof Date
              ? updatedRole.updated.updated_at.toISOString()
              : typeof updatedRole.updated.updated_at === 'string'
                ? updatedRole.updated.updated_at
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
    // All database reads, decisions, privilege checks, and assignment checks are inside the transaction after row locks (P1-02)
    let validatedActorSnapshot: ActorContext | undefined;
    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Lock in ONE global order: actor user -> actor role -> role_permissions -> target role (Finding 2 / Round 9)
        const { actorSnapshot, permSet: actorPermSetInTx } = await this.lockAndAuthorizeActor(
          tx,
          actor,
          ['iam:manage_users'],
          roleId
        );
        validatedActorSnapshot = actorSnapshot;

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

        const crossTenantAssignees = assignees.filter(
          (u) => u.merchant_id !== actorSnapshot.merchantId
        );
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
              {
                broaderUsers,
                actorMerchantId: actorSnapshot.merchantId,
              }
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
          const auditMerchantId =
            (typeof err.extra.actorMerchantId === 'string' && err.extra.actorMerchantId.trim()) ||
            (validatedActorSnapshot?.merchantId && validatedActorSnapshot.merchantId.trim()) ||
            (actor.merchantId && actor.merchantId.trim());

          if (!auditMerchantId) {
            throw new CanonicalApiException(
              HttpStatus.INTERNAL_SERVER_ERROR,
              'INTERNAL_SERVER_ERROR',
              'Không thể xác định đơn vị hợp lệ cho vết kiểm toán bảo mật',
              true
            );
          }

          try {
            await this.prisma.$transaction(async (auditTx: any) => {
              await auditTx.auditLog.create({
                data: {
                  merchant_id: auditMerchantId,
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
              merchant_id: validatedActorSnapshot?.merchantId || actor.merchantId,
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
