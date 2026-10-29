import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import type { ActorContext } from '../rbac/rbac.dto';
import {
  BulkEntityType,
  BulkActionType,
  BulkItemStatus,
  BulkActionItemResult,
  BulkActionResponseData,
  BulkActionResponse,
} from '@shipde/contracts';
import { resolveBulkActionMaxItems } from '@shipde/config';
import { CanonicalApiException } from '../auth/auth.service';
import { maskIdentifier } from '../invitations/invitations.service';
import { ValidatedBulkActionDto } from './bulk.dto';

/**
 * Escapes a cell value for RFC 4180 CSV compliance.
 */
function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds RFC 4180 CSV string from headers and row objects.
 */
function buildCsvString(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

@Injectable()
export class BulkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  /**
   * Computes a deterministic SHA-256 hash of the request content for idempotency validation.
   */
  private computeRequestHash(dto: ValidatedBulkActionDto): string {
    const sortedIds = [...dto.ids].sort();
    const payload = JSON.stringify({
      entity_type: dto.entity_type,
      action: dto.action,
      ids: sortedIds,
      params: dto.params || {},
      confirm: dto.confirm || false,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Enforces server-side permissions for the requested entity type.
   */
  private async assertActorEntityPermission(
    actor: ActorContext,
    entityType: BulkEntityType
  ): Promise<void> {
    if (actor.role === 'OWNER') return;

    let requiredPermission: string;
    switch (entityType) {
      case BulkEntityType.USERS:
        requiredPermission = 'iam:manage_users';
        break;
      case BulkEntityType.BRANCHES:
      case BulkEntityType.WAREHOUSES:
        requiredPermission = 'iam:shop_config';
        break;
      default:
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'UNSUPPORTED_BULK_ENTITY',
          `Loại thực thể '${entityType}' không được hỗ trợ`
        );
    }

    const hasPerm = await this.rbacService.actorHasPermissions(actor, [requiredPermission]);
    if (!hasPerm) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        `Bạn không có quyền thực hiện tác vụ hàng loạt trên thực thể ${entityType} (yêu cầu quyền ${requiredPermission})`
      );
    }
  }

  /**
   * Main entrypoint for executing permission-aware bulk actions with per-item outcomes.
   */
  async executeBulkAction(
    merchantId: string,
    actor: ActorContext,
    dto: ValidatedBulkActionDto,
    clientIp: string,
    correlationId: string,
    idempotencyKeyHeader?: string
  ): Promise<BulkActionResponse> {
    // 1. Permission check
    await this.assertActorEntityPermission(actor, dto.entity_type);

    // 2. Idempotency evaluation
    const effectiveIdempotencyKey = (dto.idempotency_key || idempotencyKeyHeader || '').trim();
    const requestHash = this.computeRequestHash(dto);

    if (effectiveIdempotencyKey) {
      const existingBatch = await this.prisma.bulkActionBatch.findUnique({
        where: {
          merchant_id_idempotency_key: {
            merchant_id: merchantId,
            idempotency_key: effectiveIdempotencyKey,
          },
        },
      });

      if (existingBatch) {
        if (existingBatch.request_hash === requestHash) {
          // Idempotent replay: return cached results immediately without duplicate execution
          const cachedData = existingBatch.results as unknown as BulkActionResponseData;
          return {
            data: cachedData,
            meta: {
              correlation_id: correlationId,
              timestamp: new Date().toISOString(),
            },
          };
        } else {
          // Replay with different payload: 409 Conflict
          throw new CanonicalApiException(
            HttpStatus.CONFLICT,
            'IDEMPOTENCY_CONFLICT',
            'Khóa xử lý trùng lặp (Idempotency-Key) đã được sử dụng với nội dung yêu cầu khác',
            false,
            'Vui lòng tạo khóa idempotency mới cho mỗi yêu cầu thay đổi'
          );
        }
      }
    }

    // 3. Retrieve actor's granted resource scopes for privilege checks
    const actorUser = await this.prisma.user.findFirst({
      where: { id: actor.userId, merchant_id: merchantId },
      select: {
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
        role: true,
      },
    });
    const actorStoreScopes = actorUser?.store_scopes || [];
    const actorWarehouseScopes = actorUser?.warehouse_scopes || [];

    // 4. Process items independently
    const results: BulkActionItemResult[] = [];
    const exportRows: Record<string, unknown>[] = [];
    let exportCsvHeaders: string[] = [];

    // Deduplicate IDs preserving order
    const uniqueIds = Array.from(new Set(dto.ids));

    for (const targetId of uniqueIds) {
      try {
        switch (dto.entity_type) {
          case BulkEntityType.USERS: {
            const itemOutcome = await this.executeUserItem(
              merchantId,
              actor,
              actorStoreScopes,
              actorWarehouseScopes,
              targetId,
              dto.action,
              dto.params,
              clientIp
            );
            results.push(itemOutcome.result);
            if (itemOutcome.exportRow) {
              exportRows.push(itemOutcome.exportRow);
              if (exportCsvHeaders.length === 0) {
                exportCsvHeaders = Object.keys(itemOutcome.exportRow);
              }
            }
            break;
          }
          case BulkEntityType.BRANCHES: {
            const itemOutcome = await this.executeBranchItem(
              merchantId,
              actor,
              actorStoreScopes,
              targetId,
              dto.action,
              clientIp
            );
            results.push(itemOutcome.result);
            if (itemOutcome.exportRow) {
              exportRows.push(itemOutcome.exportRow);
              if (exportCsvHeaders.length === 0) {
                exportCsvHeaders = Object.keys(itemOutcome.exportRow);
              }
            }
            break;
          }
          case BulkEntityType.WAREHOUSES: {
            const itemOutcome = await this.executeWarehouseItem(
              merchantId,
              actor,
              actorWarehouseScopes,
              targetId,
              dto.action,
              clientIp
            );
            results.push(itemOutcome.result);
            if (itemOutcome.exportRow) {
              exportRows.push(itemOutcome.exportRow);
              if (exportCsvHeaders.length === 0) {
                exportCsvHeaders = Object.keys(itemOutcome.exportRow);
              }
            }
            break;
          }
        }
      } catch (err: any) {
        results.push({
          id: targetId,
          status: BulkItemStatus.FAILED,
          error: {
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'Lỗi không xác định khi xử lý mục này',
          },
        });
      }
    }

    // 4. Compute outcome partition
    const succeededIds = results
      .filter((r) => r.status === BulkItemStatus.SUCCEEDED)
      .map((r) => r.id);
    const failedIds = results.filter((r) => r.status === BulkItemStatus.FAILED).map((r) => r.id);

    const totalCount = uniqueIds.length;
    const successCount = succeededIds.length;
    const failureCount = failedIds.length;
    const isPartialFailure = successCount > 0 && failureCount > 0;

    let exportPayload: string | undefined = undefined;
    if (dto.action === BulkActionType.EXPORT_CSV) {
      exportPayload = buildCsvString(exportCsvHeaders, exportRows);
    }

    const batchId = randomUUID();
    const batchStatus =
      failureCount === 0 ? 'COMPLETED' : successCount === 0 ? 'FAILED' : 'PARTIAL_FAILURE';

    const responseData: BulkActionResponseData = {
      batch_id: batchId,
      entity_type: dto.entity_type,
      action: dto.action,
      total_count: totalCount,
      success_count: successCount,
      failure_count: failureCount,
      is_partial_failure: isPartialFailure,
      results,
      succeeded_ids: succeededIds,
      failed_ids: failedIds,
      ...(exportPayload !== undefined ? { export_payload: exportPayload } : {}),
    };

    // 5. Persist batch record if idempotency key or completed batch
    if (effectiveIdempotencyKey) {
      try {
        await this.prisma.bulkActionBatch.create({
          data: {
            id: batchId,
            merchant_id: merchantId,
            entity_type: dto.entity_type,
            action: dto.action,
            idempotency_key: effectiveIdempotencyKey,
            request_hash: requestHash,
            status: batchStatus,
            total_count: totalCount,
            success_count: successCount,
            failure_count: failureCount,
            results: responseData as any,
            created_by: actor.userId,
          },
        });
      } catch {
        // If concurrent insert occurred, ignore conflict since operations have completed
      }
    }

    return {
      data: responseData,
      meta: {
        correlation_id: correlationId,
        timestamp: new Date().toISOString(),
      },
    };
  }

  // --------------------------------------------------------------------------
  // USER ITEM EXECUTION
  // --------------------------------------------------------------------------
  private async executeUserItem(
    merchantId: string,
    actor: ActorContext,
    actorStoreScopes: string[],
    actorWarehouseScopes: string[],
    targetUserId: string,
    action: BulkActionType,
    params?: ValidatedBulkActionDto['params'],
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    // 1. Fetch user scoped strictly to merchant (no cross-tenant oracle)
    const targetUser = await this.prisma.user.findFirst({
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
        carrier_account_scopes: true,
        created_at: true,
      },
    });

    if (!targetUser) {
      return {
        result: {
          id: targetUserId,
          status: BulkItemStatus.FAILED,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: 'Người dùng không tồn tại hoặc không thuộc cửa hàng của bạn',
          },
        },
      };
    }

    // 2. Check actor store and warehouse scopes against target user scopes (FEAT-RBAC-02)
    if (actor.role !== 'OWNER') {
      const hasWildcardStore = actorStoreScopes.includes('*');
      if (!hasWildcardStore) {
        const targetStoreScopes = targetUser.store_scopes || [];
        if (targetStoreScopes.length > 0) {
          const overlaps = targetStoreScopes.some((s) => actorStoreScopes.includes(s));
          if (!overlaps) {
            return {
              result: {
                id: targetUserId,
                status: BulkItemStatus.FAILED,
                error: {
                  code: 'SCOPE_FORBIDDEN',
                  message:
                    'Bạn không có quyền quản lý người dùng ngoài phạm vi chi nhánh được phân công',
                },
              },
            };
          }
        }
      }

      const hasWildcardWarehouse = actorWarehouseScopes.includes('*');
      if (!hasWildcardWarehouse) {
        const targetWarehouseScopes = targetUser.warehouse_scopes || [];
        if (targetWarehouseScopes.length > 0) {
          const overlaps = targetWarehouseScopes.some((w) => actorWarehouseScopes.includes(w));
          if (!overlaps) {
            return {
              result: {
                id: targetUserId,
                status: BulkItemStatus.FAILED,
                error: {
                  code: 'SCOPE_FORBIDDEN',
                  message:
                    'Bạn không có quyền quản lý người dùng ngoài phạm vi kho hàng được phân công',
                },
              },
            };
          }
        }
      }
    }

    // 3. Execute requested action
    switch (action) {
      case BulkActionType.ACTIVATE: {
        if (targetUser.status === 'active') {
          return {
            result: {
              id: targetUserId,
              status: BulkItemStatus.SUCCEEDED,
              data: { id: targetUserId, status: 'active', note: 'ALREADY_ACTIVE' },
            },
          };
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: targetUserId },
            data: { status: 'active' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'USER_ACTIVATED',
              entity_type: 'User',
              entity_id: targetUserId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: targetUser.status },
              new_value: {
                status: 'active',
                email: maskIdentifier(targetUser.email),
                phone: maskIdentifier(targetUser.phone),
              },
            },
          });
        });

        return {
          result: {
            id: targetUserId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: targetUserId, status: 'active' },
          },
        };
      }

      case BulkActionType.DEACTIVATE: {
        // Invariant: Self-deactivation prohibited
        if (targetUser.id === actor.userId) {
          return {
            result: {
              id: targetUserId,
              status: BulkItemStatus.FAILED,
              error: {
                code: 'SELF_SUSPENSION_PROHIBITED',
                message: 'Bạn không thể tự vô hiệu hóa tài khoản của chính mình',
              },
            },
          };
        }

        // Invariant: Cannot deactivate sole active owner
        if (targetUser.role === 'OWNER') {
          const activeOwnerCount = await this.prisma.user.count({
            where: {
              merchant_id: merchantId,
              role: 'OWNER',
              status: 'active',
              id: { not: targetUserId },
            },
          });

          if (activeOwnerCount === 0) {
            return {
              result: {
                id: targetUserId,
                status: BulkItemStatus.FAILED,
                error: {
                  code: 'CANNOT_REMOVE_LAST_OWNER',
                  message: 'Không thể vô hiệu hóa chủ sở hữu duy nhất còn hoạt động của cửa hàng',
                },
              },
            };
          }
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: targetUserId },
            data: { status: 'suspended' },
          });

          // Revoke active device sessions
          await tx.deviceSession.deleteMany({
            where: { user_id: targetUserId },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'USER_SUSPENDED',
              entity_type: 'User',
              entity_id: targetUserId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: targetUser.status },
              new_value: {
                status: 'suspended',
                reason: params?.reason || 'Bulk deactivation',
                email: maskIdentifier(targetUser.email),
                phone: maskIdentifier(targetUser.phone),
              },
            },
          });
        });

        return {
          result: {
            id: targetUserId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: targetUserId, status: 'suspended' },
          },
        };
      }

      case BulkActionType.ASSIGN_SCOPES: {
        const targetStoreScopes = params?.store_scopes;
        const targetWarehouseScopes = params?.warehouse_scopes;
        const targetCarrierScopes = params?.carrier_account_scopes;

        // Enforce privilege ceiling
        if (actor.role !== 'OWNER') {
          if (targetStoreScopes && targetStoreScopes.length > 0) {
            const actorStores = new Set(actorStoreScopes || []);
            if (!actorStores.has('*')) {
              const unheldStores = targetStoreScopes.filter((s) => !actorStores.has(s));
              if (unheldStores.length > 0) {
                return {
                  result: {
                    id: targetUserId,
                    status: BulkItemStatus.FAILED,
                    error: {
                      code: 'PRIVILEGE_CEILING_EXCEEDED',
                      message: `Vượt quá hạn mức phân quyền: Chi nhánh không thuộc phạm vi quản lý (${unheldStores.join(', ')})`,
                    },
                  },
                };
              }
            }
          }

          if (targetWarehouseScopes && targetWarehouseScopes.length > 0) {
            const actorWarehouses = new Set(actorWarehouseScopes || []);
            if (!actorWarehouses.has('*')) {
              const unheldWarehouses = targetWarehouseScopes.filter((w) => !actorWarehouses.has(w));
              if (unheldWarehouses.length > 0) {
                return {
                  result: {
                    id: targetUserId,
                    status: BulkItemStatus.FAILED,
                    error: {
                      code: 'PRIVILEGE_CEILING_EXCEEDED',
                      message: `Vượt quá hạn mức phân quyền: Kho hàng không thuộc phạm vi quản lý (${unheldWarehouses.join(', ')})`,
                    },
                  },
                };
              }
            }
          }
        }

        const newStoreScopes =
          targetStoreScopes !== undefined
            ? Array.from(new Set(targetStoreScopes))
            : targetUser.store_scopes;
        const newWarehouseScopes =
          targetWarehouseScopes !== undefined
            ? Array.from(new Set(targetWarehouseScopes))
            : targetUser.warehouse_scopes;
        const newCarrierScopes =
          targetCarrierScopes !== undefined
            ? Array.from(new Set(targetCarrierScopes))
            : targetUser.carrier_account_scopes;

        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: targetUserId },
            data: {
              store_scopes: newStoreScopes,
              warehouse_scopes: newWarehouseScopes,
              carrier_account_scopes: newCarrierScopes,
            },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'USER_SCOPE_UPDATED',
              entity_type: 'User',
              entity_id: targetUserId,
              ip_address: clientIp || '127.0.0.1',
              old_value: {
                store_scopes: targetUser.store_scopes,
                warehouse_scopes: targetUser.warehouse_scopes,
                carrier_account_scopes: targetUser.carrier_account_scopes,
              },
              new_value: {
                store_scopes: newStoreScopes,
                warehouse_scopes: newWarehouseScopes,
                carrier_account_scopes: newCarrierScopes,
                email: maskIdentifier(targetUser.email),
              },
            },
          });
        });

        return {
          result: {
            id: targetUserId,
            status: BulkItemStatus.SUCCEEDED,
            data: {
              id: targetUserId,
              store_scopes: newStoreScopes,
              warehouse_scopes: newWarehouseScopes,
              carrier_account_scopes: newCarrierScopes,
            },
          },
        };
      }

      case BulkActionType.EXPORT_CSV: {
        return {
          result: {
            id: targetUserId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: targetUserId, full_name: targetUser.full_name },
          },
          exportRow: {
            id: targetUser.id,
            full_name: targetUser.full_name,
            email: maskIdentifier(targetUser.email),
            phone: maskIdentifier(targetUser.phone),
            role: targetUser.role,
            status: targetUser.status,
            store_scopes: (targetUser.store_scopes || []).join(';'),
            warehouse_scopes: (targetUser.warehouse_scopes || []).join(';'),
            created_at: targetUser.created_at.toISOString(),
          },
        };
      }

      default:
        return {
          result: {
            id: targetUserId,
            status: BulkItemStatus.FAILED,
            error: {
              code: 'UNSUPPORTED_BULK_ACTION',
              message: `Hành động '${action}' không được hỗ trợ cho người dùng`,
            },
          },
        };
    }
  }

  // --------------------------------------------------------------------------
  // BRANCH ITEM EXECUTION
  // --------------------------------------------------------------------------
  private async executeBranchItem(
    merchantId: string,
    actor: ActorContext,
    actorStoreScopes: string[],
    branchId: string,
    action: BulkActionType,
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    const branch = await this.prisma.branch.findFirst({
      where: {
        id: branchId,
        merchant_id: merchantId,
      },
    });

    if (!branch) {
      return {
        result: {
          id: branchId,
          status: BulkItemStatus.FAILED,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: 'Chi nhánh không tồn tại hoặc không thuộc cửa hàng của bạn',
          },
        },
      };
    }

    // FEAT-RBAC-02 Scope check for branch
    if (actor.role !== 'OWNER') {
      if (
        !actorStoreScopes.includes('*') &&
        !actorStoreScopes.includes(branch.id) &&
        !actorStoreScopes.includes(branch.code)
      ) {
        return {
          result: {
            id: branchId,
            status: BulkItemStatus.FAILED,
            error: {
              code: 'SCOPE_FORBIDDEN',
              message: 'Bạn không có quyền quản trị chi nhánh này',
            },
          },
        };
      }
    }

    switch (action) {
      case BulkActionType.ACTIVATE: {
        if (branch.status === 'ACTIVE') {
          return {
            result: {
              id: branchId,
              status: BulkItemStatus.SUCCEEDED,
              data: { id: branchId, status: 'ACTIVE', note: 'ALREADY_ACTIVE' },
            },
          };
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.branch.update({
            where: { id: branchId },
            data: { status: 'ACTIVE' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'BRANCH_ACTIVATED',
              entity_type: 'Branch',
              entity_id: branchId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: branch.status },
              new_value: {
                status: 'ACTIVE',
                name: branch.name,
                code: branch.code,
              },
            },
          });
        });

        return {
          result: {
            id: branchId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: branchId, status: 'ACTIVE' },
          },
        };
      }

      case BulkActionType.DEACTIVATE: {
        if (branch.is_default) {
          return {
            result: {
              id: branchId,
              status: BulkItemStatus.FAILED,
              error: {
                code: 'CANNOT_DEACTIVATE_DEFAULT_BRANCH',
                message: 'Không thể vô hiệu hóa chi nhánh mặc định',
              },
            },
          };
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.branch.update({
            where: { id: branchId },
            data: { status: 'INACTIVE' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'BRANCH_DEACTIVATED',
              entity_type: 'Branch',
              entity_id: branchId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: branch.status },
              new_value: {
                status: 'INACTIVE',
                name: branch.name,
                code: branch.code,
              },
            },
          });
        });

        return {
          result: {
            id: branchId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: branchId, status: 'INACTIVE' },
          },
        };
      }

      case BulkActionType.EXPORT_CSV: {
        return {
          result: {
            id: branchId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: branchId, name: branch.name, code: branch.code },
          },
          exportRow: {
            id: branch.id,
            name: branch.name,
            code: branch.code,
            phone: maskIdentifier(branch.phone),
            address: branch.address || '',
            is_default: branch.is_default ? 'true' : 'false',
            status: branch.status,
            created_at: branch.created_at.toISOString(),
          },
        };
      }

      default:
        return {
          result: {
            id: branchId,
            status: BulkItemStatus.FAILED,
            error: {
              code: 'UNSUPPORTED_BULK_ACTION',
              message: `Hành động '${action}' không được hỗ trợ cho chi nhánh`,
            },
          },
        };
    }
  }

  // --------------------------------------------------------------------------
  // WAREHOUSE ITEM EXECUTION
  // --------------------------------------------------------------------------
  private async executeWarehouseItem(
    merchantId: string,
    actor: ActorContext,
    actorWarehouseScopes: string[],
    warehouseId: string,
    action: BulkActionType,
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: warehouseId,
        merchant_id: merchantId,
      },
    });

    if (!warehouse) {
      return {
        result: {
          id: warehouseId,
          status: BulkItemStatus.FAILED,
          error: {
            code: 'ITEM_NOT_FOUND',
            message: 'Kho hàng không tồn tại hoặc không thuộc cửa hàng của bạn',
          },
        },
      };
    }

    // FEAT-RBAC-02 Scope check for warehouse
    if (actor.role !== 'OWNER') {
      if (
        !actorWarehouseScopes.includes('*') &&
        !actorWarehouseScopes.includes(warehouse.id) &&
        !actorWarehouseScopes.includes(warehouse.code)
      ) {
        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.FAILED,
            error: {
              code: 'SCOPE_FORBIDDEN',
              message: 'Bạn không có quyền quản trị kho hàng này',
            },
          },
        };
      }
    }

    switch (action) {
      case BulkActionType.ACTIVATE: {
        if (warehouse.status === 'active') {
          return {
            result: {
              id: warehouseId,
              status: BulkItemStatus.SUCCEEDED,
              data: { id: warehouseId, status: 'active', note: 'ALREADY_ACTIVE' },
            },
          };
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.warehouse.update({
            where: { id: warehouseId },
            data: { status: 'active' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'WAREHOUSE_ACTIVATED',
              entity_type: 'Warehouse',
              entity_id: warehouseId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: warehouse.status },
              new_value: {
                status: 'active',
                name: warehouse.name,
                code: warehouse.code,
              },
            },
          });
        });

        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: warehouseId, status: 'active' },
          },
        };
      }

      case BulkActionType.DEACTIVATE: {
        if (warehouse.is_default) {
          return {
            result: {
              id: warehouseId,
              status: BulkItemStatus.FAILED,
              error: {
                code: 'CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE',
                message: 'Không thể vô hiệu hóa kho hàng mặc định',
              },
            },
          };
        }

        await this.prisma.$transaction(async (tx) => {
          await tx.warehouse.update({
            where: { id: warehouseId },
            data: { status: 'inactive' },
          });

          await tx.auditLog.create({
            data: {
              merchant_id: merchantId,
              user_id: actor.userId,
              action: 'WAREHOUSE_DEACTIVATED',
              entity_type: 'Warehouse',
              entity_id: warehouseId,
              ip_address: clientIp || '127.0.0.1',
              old_value: { status: warehouse.status },
              new_value: {
                status: 'inactive',
                name: warehouse.name,
                code: warehouse.code,
              },
            },
          });
        });

        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: warehouseId, status: 'inactive' },
          },
        };
      }

      case BulkActionType.EXPORT_CSV: {
        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: warehouseId, name: warehouse.name, code: warehouse.code },
          },
          exportRow: {
            id: warehouse.id,
            name: warehouse.name,
            code: warehouse.code,
            status: warehouse.status,
            is_default: warehouse.is_default ? 'true' : 'false',
            contact_name: warehouse.contact_name,
            contact_phone: maskIdentifier(warehouse.contact_phone),
            contact_email: maskIdentifier(warehouse.contact_email),
            address_line: warehouse.address_line,
            city: warehouse.city,
            created_at: warehouse.created_at.toISOString(),
          },
        };
      }

      default:
        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.FAILED,
            error: {
              code: 'UNSUPPORTED_BULK_ACTION',
              message: `Hành động '${action}' không được hỗ trợ cho kho hàng`,
            },
          },
        };
    }
  }
}
