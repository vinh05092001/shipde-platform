import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  CreateBranchDto,
  UpdateBranchDto,
  FormattedBranch,
  validateCreateBranchDto,
  validateUpdateBranchDto,
} from './branches.dto';
import { maskIdentifier } from '../invitations/invitations.service';
import { BRANCHES_LIST_POLICY } from '@shipde/config';
import { parseCanonicalListQuery } from '../users/list-scope';
import type { ListQuery } from '@shipde/contracts';

export const SENSITIVE_AUDIT_FIELDS = ['phone'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(val: string): boolean {
  return typeof val === 'string' && UUID_REGEX.test(val.trim());
}

export function maskAuditValue(field: string, val: unknown): any {
  if (val === null || val === undefined) return val;
  if (typeof val !== 'string') return val;
  if (field === 'phone') {
    return maskIdentifier(val);
  }
  return val;
}

@Injectable()
export class BranchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  private hashIp(ip: string): string {
    if (!ip) return 'unknown';
    return createHash('sha256').update(ip).digest('hex').substring(0, 16);
  }

  private async lockMerchantBranches(
    tx: Prisma.TransactionClient,
    merchantId: string
  ): Promise<void> {
    // A stable tenant row also serializes first-branch creation, where no branch
    // exists to lock yet. Every create/update must acquire it before reading defaults.
    const merchants = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE
    `;
    if (merchants.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false
      );
    }
  }

  private formatBranch(branch: any): FormattedBranch {
    return {
      id: branch.id,
      merchant_id: branch.merchant_id,
      name: branch.name,
      code: branch.code,
      address: branch.address ?? null,
      phone: branch.phone ?? null,
      is_default: Boolean(branch.is_default),
      status: (branch.status as 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
      created_at: branch.created_at
        ? new Date(branch.created_at).toISOString()
        : new Date().toISOString(),
      updated_at: branch.updated_at
        ? new Date(branch.updated_at).toISOString()
        : new Date().toISOString(),
    };
  }

  /**
   * Helper to verify if an actor has scope access to a specific branch.
   * If actor is OWNER or has '*', access is unrestricted.
   */
  async checkActorBranchScope(
    actor: ActorContext,
    branch: { id: string; code: string }
  ): Promise<boolean> {
    if (actor.role === 'OWNER') return true;

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { store_scopes: true, role: true },
    });

    if (!user) return false;
    if (user.role === 'OWNER') return true;

    const scopes = user.store_scopes || [];
    if (scopes.includes('*')) return true;

    return scopes.includes(branch.id) || scopes.includes(branch.code);
  }

  /**
   * Helper to get allowed branch identifiers for an actor.
   * Returns null if actor has full wildcard access.
   */
  private async getActorStoreScopes(actor: ActorContext): Promise<string[] | null> {
    if (actor.role === 'OWNER') return null;

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { store_scopes: true, role: true },
    });

    if (!user || user.role === 'OWNER') return null;

    const scopes = user.store_scopes || [];
    if (scopes.includes('*')) return null;

    return scopes;
  }

  /**
   * Server-authoritative capability flag for the web UI (mirrors can_manage_roles
   * in FEAT-RBAC-01). True only when the actor holds iam:shop_config; never derived
   * from hardcoded role names on the client.
   */
  private async canActorEditBranches(actor: ActorContext): Promise<boolean> {
    if (!this.rbacService) {
      return actor.role === 'OWNER';
    }
    return this.rbacService.actorHasPermissions(actor, ['iam:shop_config']);
  }

  /**
   * GET /api/v1/branches (AC-ORG-02-01, AC-ORG-02-02)
   * Lists branches for the caller's merchant tenant, filtered by store_scopes if scoped.
   */
  async listBranches(
    merchantId: string,
    actor: ActorContext,
    query: ListQuery = {},
    correlationId: string
  ): Promise<{
    success: boolean;
    data: {
      branches: FormattedBranch[];
      can_edit: boolean;
      meta?: {
        page: number;
        limit: number;
        total: number;
        total_pages: number;
        correlation_id: string;
      };
    };
    meta: {
      correlation_id: string;
      page: number;
      limit: number;
      total: number;
      total_pages: number;
    };
  }> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false
      );
    }

    const { page, limit, skip, filters, orderBy } = parseCanonicalListQuery(
      query,
      BRANCHES_LIST_POLICY
    );

    const scopedIdentifiers = await this.getActorStoreScopes(actor);

    const whereClause: any = {
      merchant_id: merchantId,
    };

    if (filters.status) {
      whereClause.status = filters.status;
    }

    if (filters.search && filters.search.trim().length > 0) {
      const search = filters.search.trim();
      whereClause.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (scopedIdentifiers !== null) {
      const isUuid = (val: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const uuidScopes = scopedIdentifiers.filter(isUuid);
      const codeScopes = scopedIdentifiers.filter((s) => !isUuid(s));

      const orConditions: any[] = [];
      if (uuidScopes.length > 0) {
        orConditions.push({ id: { in: uuidScopes } });
      }
      if (codeScopes.length > 0) {
        orConditions.push({ code: { in: codeScopes } });
      }

      if (orConditions.length > 0) {
        if (whereClause.OR) {
          // Combine active search conditions with the scope restriction so
          // filters and counts keep describing the same tenant-scoped set.
          whereClause.AND = [{ OR: whereClause.OR }, { OR: orConditions }];
          delete whereClause.OR;
        } else {
          whereClause.OR = orConditions;
        }
      } else {
        whereClause.id = '00000000-0000-0000-0000-000000000000';
      }
    }

    const [total, branches] = await Promise.all([
      this.prisma.branch.count({ where: whereClause }),
      this.prisma.branch.findMany({
        where: whereClause,
        skip,
        take: limit,
        orderBy,
      }),
    ]);

    const canEdit = await this.canActorEditBranches(actor);

    const meta = {
      correlation_id: correlationId,
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit) || 1,
    };

    return {
      success: true,
      data: {
        branches: branches.map((b) => this.formatBranch(b)),
        can_edit: canEdit,
        meta,
      },
      meta,
    };
  }

  /**
   * GET /api/v1/branches/:id (AC-ORG-02-11, AC-ORG-02-12)
   * Retrieves branch details by ID with strict tenant and store scope enforcement.
   */
  async getBranchById(
    branchId: string,
    actor: ActorContext,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedBranch;
    meta: { correlation_id: string };
  }> {
    if (!actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false
      );
    }

    if (!isUuid(branchId)) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false,
        'Chi nhánh không tồn tại hoặc đã bị xóa'
      );
    }

    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        merchant_id: actor.merchantId,
      },
    });

    if (!branch) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false,
        'Chi nhánh không tồn tại hoặc đã bị xóa'
      );
    }

    const hasScope = await this.checkActorBranchScope(actor, branch);
    if (!hasScope) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không có quyền truy cập chi nhánh được yêu cầu',
        false,
        'Vui lòng liên hệ quản trị viên để được phân quyền chi nhánh'
      );
    }

    return {
      success: true,
      data: this.formatBranch(branch),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/branches (AC-ORG-02-03, AC-ORG-02-04, AC-ORG-02-05)
   * Creates a new branch for the caller's merchant tenant.
   */
  async createBranch(
    merchantId: string,
    actor: ActorContext,
    dto: CreateBranchDto,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedBranch;
    meta: { correlation_id: string };
  }> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false
      );
    }

    const validationErrors = validateCreateBranchDto(dto);
    if (validationErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu chi nhánh không hợp lệ',
        false,
        'Vui lòng kiểm tra lại các trường thông tin bị lỗi',
        validationErrors
      );
    }

    const normalizedCode = dto.code.trim().toUpperCase();

    // BR-BRANCH-05: A scoped actor may only create a branch inside their assigned
    // store_scopes. Creating a branch outside that scope is a privilege escalation
    // and must fail closed with 403 even though the actor holds iam:shop_config.
    const scopedIdentifiers = await this.getActorStoreScopes(actor);
    if (scopedIdentifiers !== null) {
      const scopedSet = new Set(scopedIdentifiers);
      if (!scopedSet.has(normalizedCode)) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền tạo chi nhánh ngoài phạm vi được phân quyền',
          false,
          'Vui lòng liên hệ quản trị viên để được phân quyền chi nhánh'
        );
      }
    }

    // Check duplicate code in same merchant
    const existingWithCode = await this.prisma.branch.findFirst({
      where: {
        merchant_id: merchantId,
        code: normalizedCode,
      },
    });

    if (existingWithCode) {
      throw new CanonicalApiException(
        HttpStatus.CONFLICT,
        'BRANCH_CODE_EXISTS',
        `Mã chi nhánh "${normalizedCode}" đã tồn tại trong cửa hàng`,
        false,
        'Vui lòng chọn một mã chi nhánh khác'
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.lockMerchantBranches(tx, merchantId);

        // Count and authorize affected defaults only after the tenant lock is held.
        const existingCount = await tx.branch.count({
          where: { merchant_id: merchantId },
        });

        const isDefault = existingCount === 0 ? true : Boolean(dto.is_default);

        // If making this branch default when other branches exist, any existing default
        // branch will have its default status unset. A scoped actor must not modify an
        // out-of-scope default branch. Keep authorization and mutation under the same lock.
        if (isDefault && existingCount > 0) {
          const existingDefaults = await tx.branch.findMany({
            where: {
              merchant_id: merchantId,
              is_default: true,
            },
          });
          for (const defBranch of existingDefaults) {
            const canModify = await this.checkActorBranchScope(actor, defBranch);
            if (!canModify) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                'FORBIDDEN',
                'Người dùng không có quyền thay đổi chi nhánh mặc định ngoài phạm vi được phân quyền',
                false,
                'Vui lòng liên hệ quản trị viên để được phân quyền chi nhánh'
              );
            }
          }
        }

        if (isDefault && existingCount > 0) {
          await tx.branch.updateMany({
            where: {
              merchant_id: merchantId,
              is_default: true,
            },
            data: { is_default: false },
          });
        }

        const newBranch = await tx.branch.create({
          data: {
            merchant_id: merchantId,
            name: dto.name.trim(),
            code: normalizedCode,
            address: dto.address ? dto.address.trim() : null,
            phone: dto.phone ? dto.phone.trim().replace(/[\s.-]/g, '') : null,
            is_default: isDefault,
            status: dto.status || 'ACTIVE',
          },
        });

        await tx.auditLog.create({
          data: {
            merchant_id: merchantId,
            user_id: actor.userId,
            actor: actor.role || 'OWNER',
            action: 'BRANCH_CREATED',
            entity_type: 'branch',
            entity_id: newBranch.id,
            old_value: Prisma.DbNull,
            new_value: {
              id: newBranch.id,
              name: newBranch.name,
              code: newBranch.code,
              address: newBranch.address,
              phone: maskAuditValue('phone', newBranch.phone),
              is_default: newBranch.is_default,
              status: newBranch.status,
            },
            reason: correlationId ? `correlation_id:${correlationId}` : null,
            ip_address: this.hashIp(clientIp),
          },
        });

        return newBranch;
      });

      return {
        success: true,
        data: this.formatBranch(created),
        meta: { correlation_id: correlationId },
      };
    } catch (err: any) {
      if (err instanceof CanonicalApiException) {
        throw err;
      }
      if (err?.code === 'P2002') {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'BRANCH_CODE_EXISTS',
          `Mã chi nhánh "${normalizedCode}" đã tồn tại trong cửa hàng`,
          false,
          'Vui lòng chọn một mã chi nhánh khác'
        );
      }
      throw err;
    }
  }

  /**
   * PATCH /api/v1/branches/:id (AC-ORG-02-06, AC-ORG-02-07, AC-ORG-02-10)
   * Updates branch details with validation, uniqueness checks, and default branch invariants.
   */
  async updateBranch(
    branchId: string,
    merchantId: string,
    actor: ActorContext,
    dto: UpdateBranchDto,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedBranch;
    meta: { correlation_id: string };
  }> {
    if (!merchantId) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Yêu cầu không xác định được danh tính cửa hàng',
        false
      );
    }

    const validationErrors = validateUpdateBranchDto(dto);
    if (validationErrors.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu cập nhật chi nhánh không hợp lệ',
        false,
        'Vui lòng kiểm tra lại các trường thông tin bị lỗi',
        validationErrors
      );
    }

    if (!isUuid(branchId)) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false,
        'Chi nhánh không tồn tại hoặc đã bị xóa'
      );
    }

    let normalizedCode: string | undefined;
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await this.lockMerchantBranches(tx, merchantId);

        const existing = await tx.branch.findFirst({
          where: {
            id: branchId,
            merchant_id: merchantId,
          },
        });

        if (!existing) {
          throw new CanonicalApiException(
            HttpStatus.NOT_FOUND,
            'BRANCH_NOT_FOUND',
            'Không tìm thấy thông tin chi nhánh',
            false,
            'Chi nhánh không tồn tại hoặc đã bị xóa'
          );
        }

        const hasScope = await this.checkActorBranchScope(actor, existing);
        if (!hasScope) {
          throw new CanonicalApiException(
            HttpStatus.FORBIDDEN,
            'FORBIDDEN',
            'Người dùng không có quyền chỉnh sửa chi nhánh được yêu cầu',
            false
          );
        }

        // Code uniqueness check if code is being updated
        if (dto.code !== undefined) {
          normalizedCode = dto.code.trim().toUpperCase();
          if (normalizedCode !== existing.code) {
            const duplicate = await tx.branch.findFirst({
              where: {
                merchant_id: merchantId,
                code: normalizedCode,
                id: { not: branchId },
              },
            });

            if (duplicate) {
              throw new CanonicalApiException(
                HttpStatus.CONFLICT,
                'BRANCH_CODE_EXISTS',
                `Mã chi nhánh "${normalizedCode}" đã tồn tại trong cửa hàng`,
                false
              );
            }
          }
        }

        // Default branch invariant checks (BR-BRANCH-04)
        if (existing.is_default && dto.status === 'INACTIVE') {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'CANNOT_DEACTIVATE_DEFAULT_BRANCH',
            'Không thể vô hiệu hóa chi nhánh mặc định',
            false,
            'Vui lòng chỉ định một chi nhánh khác làm mặc định trước khi vô hiệu hóa chi nhánh này'
          );
        }

        if (existing.is_default && dto.is_default === false) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'CANNOT_REMOVE_DEFAULT_STATUS',
            'Không thể hủy trạng thái mặc định của chi nhánh trực tiếp',
            false,
            'Vui lòng chỉ định một chi nhánh khác làm mặc định'
          );
        }

        // If setting is_default to true,
        // any existing default branch will have its default status unset.
        // Authorize every affected default branch while holding the tenant lock.
        if (dto.is_default === true) {
          const existingDefaults = await tx.branch.findMany({
            where: {
              merchant_id: merchantId,
              is_default: true,
              id: { not: branchId },
            },
          });
          for (const defBranch of existingDefaults) {
            const canModify = await this.checkActorBranchScope(actor, defBranch);
            if (!canModify) {
              throw new CanonicalApiException(
                HttpStatus.FORBIDDEN,
                'FORBIDDEN',
                'Người dùng không có quyền thay đổi chi nhánh mặc định ngoài phạm vi được phân quyền',
                false,
                'Vui lòng liên hệ quản trị viên để được phân quyền chi nhánh'
              );
            }
          }
        }

        const dataToUpdate: any = {};
        if (dto.name !== undefined) dataToUpdate.name = dto.name.trim();
        if (normalizedCode !== undefined) dataToUpdate.code = normalizedCode;
        if (dto.address !== undefined)
          dataToUpdate.address = dto.address ? dto.address.trim() : null;
        if (dto.phone !== undefined)
          dataToUpdate.phone = dto.phone ? dto.phone.trim().replace(/[\s.-]/g, '') : null;
        if (dto.is_default !== undefined) dataToUpdate.is_default = dto.is_default;
        if (dto.status !== undefined) dataToUpdate.status = dto.status;

        if (dto.is_default === true) {
          await tx.branch.updateMany({
            where: {
              merchant_id: merchantId,
              is_default: true,
              id: { not: branchId },
            },
            data: { is_default: false },
          });
        }

        const result = await tx.branch.update({
          where: { id: branchId, merchant_id: merchantId },
          data: dataToUpdate,
        });

        const updatedFields = Object.keys(dataToUpdate);
        const beforeDiff: Record<string, any> = {};
        const afterDiff: Record<string, any> = {};

        for (const field of updatedFields) {
          beforeDiff[field] = maskAuditValue(field, (existing as any)[field]);
          afterDiff[field] = maskAuditValue(field, (result as any)[field]);
        }

        await tx.auditLog.create({
          data: {
            merchant_id: merchantId,
            user_id: actor.userId,
            actor: actor.role || 'OWNER',
            action: 'BRANCH_UPDATED',
            entity_type: 'branch',
            entity_id: branchId,
            old_value: beforeDiff,
            new_value: afterDiff,
            reason: correlationId ? `correlation_id:${correlationId}` : null,
            ip_address: this.hashIp(clientIp),
          },
        });

        return result;
      });

      return {
        success: true,
        data: this.formatBranch(updated),
        meta: { correlation_id: correlationId },
      };
    } catch (err: any) {
      if (err instanceof CanonicalApiException) {
        throw err;
      }
      if (err?.code === 'P2002') {
        throw new CanonicalApiException(
          HttpStatus.CONFLICT,
          'BRANCH_CODE_EXISTS',
          `Mã chi nhánh "${normalizedCode || dto.code}" đã tồn tại trong cửa hàng`,
          false,
          'Vui lòng chọn một mã chi nhánh khác'
        );
      }
      throw err;
    }
  }

  /**
   * POST /api/v1/branches/:id/activate (AC-ORG-02-08)
   */
  async activateBranch(
    branchId: string,
    merchantId: string,
    actor: ActorContext,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedBranch;
    meta: { correlation_id: string };
  }> {
    if (!isUuid(branchId)) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false
      );
    }

    const existing = await this.prisma.branch.findFirst({
      where: { id: branchId, merchant_id: merchantId },
    });

    if (!existing) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false
      );
    }

    const hasScope = await this.checkActorBranchScope(actor, existing);
    if (!hasScope) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Người dùng không có quyền kích hoạt chi nhánh được yêu cầu',
        false
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.branch.update({
        where: { id: branchId },
        data: { status: 'ACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'BRANCH_ACTIVATED',
          entity_type: 'branch',
          entity_id: branchId,
          old_value: { status: existing.status },
          new_value: { status: 'ACTIVE' },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return result;
    });

    return {
      success: true,
      data: this.formatBranch(updated),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * POST /api/v1/branches/:id/deactivate (AC-ORG-02-09, AC-ORG-02-10)
   */
  async deactivateBranch(
    branchId: string,
    merchantId: string,
    actor: ActorContext,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    data: FormattedBranch;
    meta: { correlation_id: string };
  }> {
    if (!isUuid(branchId)) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockMerchantBranches(tx, merchantId);

      const existing = await tx.branch.findFirst({
        where: { id: branchId, merchant_id: merchantId },
      });

      if (!existing) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'BRANCH_NOT_FOUND',
          'Không tìm thấy thông tin chi nhánh',
          false
        );
      }

      if (existing.is_default) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CANNOT_DEACTIVATE_DEFAULT_BRANCH',
          'Không thể vô hiệu hóa chi nhánh mặc định',
          false,
          'Vui lòng chỉ định một chi nhánh khác làm mặc định trước khi vô hiệu hóa chi nhánh này'
        );
      }

      const hasScope = await this.checkActorBranchScope(actor, existing);
      if (!hasScope) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền vô hiệu hóa chi nhánh được yêu cầu',
          false
        );
      }

      const result = await tx.branch.update({
        where: { id: branchId },
        data: { status: 'INACTIVE' },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'BRANCH_DEACTIVATED',
          entity_type: 'branch',
          entity_id: branchId,
          old_value: { status: existing.status },
          new_value: { status: 'INACTIVE' },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });

      return result;
    });

    return {
      success: true,
      data: this.formatBranch(updated),
      meta: { correlation_id: correlationId },
    };
  }

  /**
   * DELETE /api/v1/branches/:id
   */
  async deleteBranch(
    branchId: string,
    merchantId: string,
    actor: ActorContext,
    clientIp: string,
    correlationId: string
  ): Promise<{
    success: boolean;
    message: string;
    meta: { correlation_id: string };
  }> {
    if (!isUuid(branchId)) {
      throw new CanonicalApiException(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Không tìm thấy thông tin chi nhánh',
        false
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockMerchantBranches(tx, merchantId);

      const existing = await tx.branch.findFirst({
        where: { id: branchId, merchant_id: merchantId },
      });

      if (!existing) {
        throw new CanonicalApiException(
          HttpStatus.NOT_FOUND,
          'BRANCH_NOT_FOUND',
          'Không tìm thấy thông tin chi nhánh',
          false
        );
      }

      if (existing.is_default) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'CANNOT_DELETE_DEFAULT_BRANCH',
          'Không thể xóa chi nhánh mặc định',
          false,
          'Vui lòng chỉ định một chi nhánh khác làm mặc định trước khi xóa chi nhánh này'
        );
      }

      const hasScope = await this.checkActorBranchScope(actor, existing);
      if (!hasScope) {
        throw new CanonicalApiException(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN',
          'Người dùng không có quyền xóa chi nhánh được yêu cầu',
          false
        );
      }

      await tx.branch.delete({
        where: { id: branchId },
      });

      await tx.auditLog.create({
        data: {
          merchant_id: merchantId,
          user_id: actor.userId,
          actor: actor.role || 'OWNER',
          action: 'BRANCH_DELETED',
          entity_type: 'branch',
          entity_id: branchId,
          old_value: {
            id: existing.id,
            name: existing.name,
            code: existing.code,
            address: existing.address,
            phone: maskAuditValue('phone', existing.phone),
            is_default: existing.is_default,
            status: existing.status,
          },
          new_value: Prisma.DbNull,
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });
    });

    return {
      success: true,
      message: 'Đã xóa chi nhánh thành công',
      meta: { correlation_id: correlationId },
    };
  }
}
