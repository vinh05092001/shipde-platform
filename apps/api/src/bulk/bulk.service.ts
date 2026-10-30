import { Injectable, Inject, HttpStatus } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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

/**
 * Parses RFC 4180 CSV text into complete records. Each record retains its raw
 * source span (excluding the record terminator) so authorization filtering can
 * re-emit kept records verbatim. Quoted fields containing commas, doubled
 * quotes and embedded line breaks stay inside a single record.
 */
export function parseCsvRecords(csv: string): { cells: string[]; raw: string }[] {
  const records: { cells: string[]; raw: string }[] = [];
  const length = csv.length;
  let i = 0;
  while (i < length) {
    const recordStart = i;
    const cells: string[] = [];
    for (;;) {
      let cell = '';
      if (i < length && csv[i] === '"') {
        i += 1;
        while (i < length) {
          if (csv[i] === '"') {
            if (i + 1 < length && csv[i + 1] === '"') {
              cell += '"';
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          cell += csv[i];
          i += 1;
        }
      } else {
        while (i < length && csv[i] !== ',' && csv[i] !== '\r' && csv[i] !== '\n') {
          cell += csv[i];
          i += 1;
        }
      }
      cells.push(cell);
      if (i < length && csv[i] === ',') {
        i += 1;
        continue;
      }
      const recordEnd = i;
      if (i + 1 < length && csv[i] === '\r' && csv[i + 1] === '\n') {
        i += 2;
      } else if (i < length && (csv[i] === '\n' || csv[i] === '\r')) {
        i += 1;
      }
      records.push({ cells, raw: csv.slice(recordStart, recordEnd) });
      break;
    }
  }
  return records;
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
   * Revalidates caller's current resource authorization before disclosing cached/replayed results.
   * Prevents unauthorized data disclosure when an actor replays a previously executed batch (Finding 2).
   */
  private async revalidateCachedReplay(
    tx: any,
    merchantId: string,
    actor: ActorContext,
    dto: ValidatedBulkActionDto,
    cachedData: BulkActionResponseData
  ): Promise<BulkActionResponseData> {
    if (actor.role === 'OWNER') {
      return cachedData;
    }

    const actorUser = await tx.user.findFirst({
      where: { id: actor.userId, merchant_id: merchantId },
      select: {
        store_scopes: true,
        warehouse_scopes: true,
        carrier_account_scopes: true,
        role: true,
      },
    });

    const actorStoreScopes: string[] = actorUser?.store_scopes || [];
    const actorWarehouseScopes: string[] = actorUser?.warehouse_scopes || [];
    const hasWildcardStore = actorStoreScopes.includes('*');
    const hasWildcardWarehouse = actorWarehouseScopes.includes('*');

    const authorizedResults: BulkActionItemResult[] = [];
    const forbiddenIds = new Set<string>();

    for (const item of cachedData.results) {
      let isAllowed = false;
      let forbiddenMsg = 'Bạn không có quyền truy cập thực thể này';

      switch (dto.entity_type) {
        case BulkEntityType.USERS: {
          const targetUser = await tx.user.findFirst({
            where: { id: item.id, merchant_id: merchantId },
            select: { store_scopes: true, warehouse_scopes: true },
          });

          if (!targetUser) {
            isAllowed = false;
            forbiddenMsg = 'Người dùng không tồn tại hoặc không thuộc cửa hàng của bạn';
          } else {
            const targetStoreScopes: string[] = targetUser.store_scopes || [];
            const targetWarehouseScopes: string[] = targetUser.warehouse_scopes || [];

            const storeOk =
              hasWildcardStore ||
              (targetStoreScopes.length > 0 &&
                targetStoreScopes.some((s) => actorStoreScopes.includes(s)));
            const warehouseOk =
              hasWildcardWarehouse ||
              (targetWarehouseScopes.length > 0 &&
                targetWarehouseScopes.some((w) => actorWarehouseScopes.includes(w)));

            if (!storeOk) {
              forbiddenMsg =
                'Bạn không có quyền quản lý người dùng ngoài phạm vi chi nhánh được phân công';
            } else if (!warehouseOk) {
              forbiddenMsg =
                'Bạn không có quyền quản lý người dùng ngoài phạm vi kho hàng được phân công';
            } else {
              isAllowed = true;
            }
          }
          break;
        }

        case BulkEntityType.BRANCHES: {
          const branch = await tx.branch.findFirst({
            where: { id: item.id, merchant_id: merchantId },
            select: { id: true, code: true },
          });
          if (
            branch &&
            (hasWildcardStore ||
              actorStoreScopes.includes(branch.id) ||
              actorStoreScopes.includes(branch.code))
          ) {
            isAllowed = true;
          } else {
            forbiddenMsg = 'Bạn không có quyền quản trị chi nhánh này';
          }
          break;
        }

        case BulkEntityType.WAREHOUSES: {
          const warehouse = await tx.warehouse.findFirst({
            where: { id: item.id, merchant_id: merchantId },
            select: { id: true, code: true },
          });
          if (
            warehouse &&
            (hasWildcardWarehouse ||
              actorWarehouseScopes.includes(warehouse.id) ||
              actorWarehouseScopes.includes(warehouse.code))
          ) {
            isAllowed = true;
          } else {
            forbiddenMsg = 'Bạn không có quyền quản trị kho hàng này';
          }
          break;
        }

        default:
          isAllowed = true;
          break;
      }

      if (isAllowed) {
        authorizedResults.push(item);
      } else {
        forbiddenIds.add(item.id);
        authorizedResults.push({
          id: item.id,
          status: BulkItemStatus.FAILED,
          error: {
            code: 'SCOPE_FORBIDDEN',
            message: forbiddenMsg,
          },
        });
      }
    }

    if (forbiddenIds.size === 0) {
      return cachedData;
    }

    const succeededIds = authorizedResults
      .filter((r) => r.status === BulkItemStatus.SUCCEEDED)
      .map((r) => r.id);
    const failedIds = authorizedResults
      .filter((r) => r.status === BulkItemStatus.FAILED)
      .map((r) => r.id);
    const successCount = succeededIds.length;
    const failureCount = failedIds.length;
    const isPartialFailure = successCount > 0 && failureCount > 0;

    let sanitizedExportPayload = cachedData.export_payload;
    if (sanitizedExportPayload && typeof sanitizedExportPayload === 'string') {
      // Filter at complete CSV record level (not physical lines) so a forbidden
      // row with a quoted multiline field cannot leak continuation fragments.
      const records = parseCsvRecords(sanitizedExportPayload);
      if (records.length > 0) {
        const filteredRecords = [records[0]];
        for (let i = 1; i < records.length; i++) {
          const record = records[i];
          if (record.cells.length === 1 && record.cells[0].trim() === '') continue;
          const firstCol = (record.cells[0] || '').trim();
          if (firstCol && !forbiddenIds.has(firstCol)) {
            filteredRecords.push(record);
          }
        }
        sanitizedExportPayload = filteredRecords.map((record) => record.raw).join('\r\n');
      }
    }

    return {
      ...cachedData,
      success_count: successCount,
      failure_count: failureCount,
      is_partial_failure: isPartialFailure,
      results: authorizedResults,
      succeeded_ids: succeededIds,
      failed_ids: failedIds,
      ...(sanitizedExportPayload !== undefined ? { export_payload: sanitizedExportPayload } : {}),
    };
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

    // 2. Transaction with tenant serialization lock (PostgreSQL FOR NO KEY UPDATE)
    const effectiveIdempotencyKey = (dto.idempotency_key || idempotencyKeyHeader || '').trim();
    const requestHash = this.computeRequestHash(dto);
    const batchId = randomUUID();
    const uniqueIds = Array.from(new Set(dto.ids));

    return await this.prisma.$transaction(async (tx: any) => {
      try {
        if (typeof tx.$queryRaw === 'function') {
          await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${merchantId}::uuid FOR NO KEY UPDATE`;
        }
      } catch {
        // ignore for mock/unit tests
      }

      let existingBatch: any = null;
      let isResumingCrashedBatch = false;

      if (effectiveIdempotencyKey) {
        existingBatch = await tx.bulkActionBatch.findUnique({
          where: {
            merchant_id_idempotency_key: {
              merchant_id: merchantId,
              idempotency_key: effectiveIdempotencyKey,
            },
          },
        });

        if (existingBatch) {
          if (existingBatch.request_hash !== requestHash) {
            throw new CanonicalApiException(
              HttpStatus.CONFLICT,
              'IDEMPOTENCY_CONFLICT',
              'Khóa xử lý trùng lặp (Idempotency-Key) đã được sử dụng với nội dung yêu cầu khác',
              false,
              'Vui lòng tạo khóa idempotency mới cho mỗi yêu cầu thay đổi'
            );
          }

          if (existingBatch.status !== 'IN_PROGRESS') {
            const cachedData = existingBatch.results as unknown as BulkActionResponseData;
            const authorizedData = await this.revalidateCachedReplay(
              tx,
              merchantId,
              actor,
              dto,
              cachedData
            );
            return {
              data: authorizedData,
              meta: {
                correlation_id: correlationId,
                timestamp: new Date().toISOString(),
              },
            };
          }

          // Safe recovery under tenant exclusive lock (Finding 4)
          isResumingCrashedBatch = true;
        }
      }

      // 3. Retrieve actor's granted resource scopes for privilege checks
      const actorUser = await tx.user.findFirst({
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
      const actorCarrierScopes = actorUser?.carrier_account_scopes || [];

      // 4. Process items independently. Each item runs under its own PostgreSQL
      //    savepoint so a statement failure (constraint, audit insert, ...) aborts
      //    only that item's mutations and the shared transaction — including batch
      //    persistence — survives for the remaining items (BR-COM03-03).
      const results: BulkActionItemResult[] = [];
      const exportRows: Record<string, unknown>[] = [];
      let exportCsvHeaders: string[] = [];
      const supportsSavepoints = typeof tx.$executeRaw === 'function';

      for (let itemIndex = 0; itemIndex < uniqueIds.length; itemIndex++) {
        const targetId = uniqueIds[itemIndex];
        const savepointName = `bulk_item_sp_${itemIndex}`;
        const savepointActive = supportsSavepoints && /^bulk_item_sp_\d+$/.test(savepointName);
        try {
          if (savepointActive) {
            await tx.$executeRaw(Prisma.raw(`SAVEPOINT ${savepointName}`));
          }
          switch (dto.entity_type) {
            case BulkEntityType.USERS: {
              const itemOutcome = await this.executeUserItem(
                tx,
                merchantId,
                actor,
                actorStoreScopes,
                actorWarehouseScopes,
                actorCarrierScopes,
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
                tx,
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
                tx,
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
          if (savepointActive) {
            try {
              await tx.$executeRaw(Prisma.raw(`ROLLBACK TO SAVEPOINT ${savepointName}`));
              await tx.$executeRaw(Prisma.raw(`RELEASE SAVEPOINT ${savepointName}`));
            } catch (recoveryErr: any) {
              // Savepoint recovery failed: the shared transaction is aborted
              // beyond recovery. Fail closed so the outer transaction rolls
              // back everything instead of reporting a false partial outcome.
              throw err instanceof Error ? err : recoveryErr;
            }
          }
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

      const batchStatus =
        failureCount === 0 ? 'COMPLETED' : successCount === 0 ? 'FAILED' : 'PARTIAL_FAILURE';

      const responseData: BulkActionResponseData = {
        batch_id: existingBatch ? existingBatch.id : batchId,
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

      // 5. Persist batch record inside transaction (interruption-safe)
      if (isResumingCrashedBatch && existingBatch) {
        await tx.bulkActionBatch.update({
          where: { id: existingBatch.id },
          data: {
            status: batchStatus,
            total_count: totalCount,
            success_count: successCount,
            failure_count: failureCount,
            results: responseData as any,
          },
        });
      } else if (effectiveIdempotencyKey) {
        await tx.bulkActionBatch.create({
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
      }

      return {
        data: responseData,
        meta: {
          correlation_id: correlationId,
          timestamp: new Date().toISOString(),
        },
      };
    });
  }

  // --------------------------------------------------------------------------
  // USER ITEM EXECUTION
  // --------------------------------------------------------------------------
  private async executeUserItem(
    tx: any,
    merchantId: string,
    actor: ActorContext,
    actorStoreScopes: string[],
    actorWarehouseScopes: string[],
    actorCarrierScopes: string[],
    targetUserId: string,
    action: BulkActionType,
    params?: ValidatedBulkActionDto['params'],
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    // 1. Fetch user scoped strictly to merchant (no cross-tenant oracle)
    const targetUser = await tx.user.findFirst({
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
        const targetStoreScopes: string[] = targetUser.store_scopes || [];
        const overlaps =
          targetStoreScopes.length > 0 &&
          targetStoreScopes.some((s: string) => actorStoreScopes.includes(s));
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

      const hasWildcardWarehouse = actorWarehouseScopes.includes('*');
      if (!hasWildcardWarehouse) {
        const targetWarehouseScopes: string[] = targetUser.warehouse_scopes || [];
        const overlaps =
          targetWarehouseScopes.length > 0 &&
          targetWarehouseScopes.some((w: string) => actorWarehouseScopes.includes(w));
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
          const activeOwnerCount = await tx.user.count({
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

          if (targetCarrierScopes && targetCarrierScopes.length > 0) {
            const actorCarriers = new Set(actorCarrierScopes || []);
            if (!actorCarriers.has('*')) {
              const unheldCarriers = targetCarrierScopes.filter((c) => !actorCarriers.has(c));
              if (unheldCarriers.length > 0) {
                return {
                  result: {
                    id: targetUserId,
                    status: BulkItemStatus.FAILED,
                    error: {
                      code: 'PRIVILEGE_CEILING_EXCEEDED',
                      message: `Vượt quá hạn mức phân quyền: Tài khoản vận chuyển không thuộc phạm vi quản lý (${unheldCarriers.join(', ')})`,
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
    tx: any,
    merchantId: string,
    actor: ActorContext,
    actorStoreScopes: string[],
    branchId: string,
    action: BulkActionType,
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    const branch = await tx.branch.findFirst({
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

        return {
          result: {
            id: branchId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: branchId, status: 'ACTIVE' },
          },
        };
      }

      case BulkActionType.DEACTIVATE: {
        const freshBranch =
          (await tx.branch.findFirst?.({
            where: { id: branchId, merchant_id: merchantId },
          })) || branch;
        if (freshBranch.is_default) {
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
    tx: any,
    merchantId: string,
    actor: ActorContext,
    actorWarehouseScopes: string[],
    warehouseId: string,
    action: BulkActionType,
    clientIp?: string
  ): Promise<{ result: BulkActionItemResult; exportRow?: Record<string, unknown> }> {
    const warehouse = await tx.warehouse.findFirst({
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

        return {
          result: {
            id: warehouseId,
            status: BulkItemStatus.SUCCEEDED,
            data: { id: warehouseId, status: 'active' },
          },
        };
      }

      case BulkActionType.DEACTIVATE: {
        const freshWh =
          (await tx.warehouse.findFirst?.({
            where: { id: warehouseId, merchant_id: merchantId },
          })) || warehouse;
        if (freshWh.is_default) {
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
