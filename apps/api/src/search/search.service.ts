import { Injectable, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';
import { SearchQueryDto, validateSearchQueryDto, ParsedSearchQuery } from './search.dto';
import { SearchEntityType, SearchResultItem, SearchResponse } from '@shipde/contracts';
import { maskIdentifier } from '../invitations/invitations.service';

export function maskQueryPii(query: string): string {
  if (!query) return '';
  if (query.includes('@')) {
    return maskIdentifier(query);
  }
  // Vietnamese phone numbers: 03x, 05x, 07x, 08x, 09x or +84
  const phonePattern = /(?:\+84|0)[35789]\d{8}\b/g;
  return query.replace(phonePattern, (match) => maskIdentifier(match));
}

export function formatVnd(amount: bigint | number | null | undefined): string {
  if (amount === null || amount === undefined) return '0 ₫';
  const val = typeof amount === 'bigint' ? Number(amount) : amount;
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbacService: RbacService
  ) {}

  private hashIp(ip: string): string {
    return createHash('sha256')
      .update(ip || '127.0.0.1')
      .digest('hex');
  }

  async search(
    actor: ActorContext,
    queryDto: SearchQueryDto,
    clientIp: string,
    correlationId: string
  ): Promise<SearchResponse> {
    if (!actor || !actor.merchantId) {
      throw new CanonicalApiException(
        HttpStatus.UNAUTHORIZED,
        'UNAUTHORIZED',
        'Phiên đăng nhập không hợp lệ hoặc thiếu thông tin tổ chức'
      );
    }

    const { errors, parsed } = validateSearchQueryDto(queryDto);
    if (errors.length > 0 || !parsed) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Thông tin tìm kiếm không hợp lệ',
        false,
        'Vui lòng kiểm tra lại tham số tìm kiếm',
        errors
      );
    }

    const { q, type, limit } = parsed;

    // Check RBAC permissions for reconciliation & PII access
    const canAccessRecon =
      (await this.rbacService.actorHasPermissions(actor, ['reconciliation:view_contract_rates'])) ||
      (await this.rbacService.actorHasPermissions(actor, ['reconciliation:run_review_audit']));

    const canUnmaskPii = await this.rbacService.actorHasPermissions(actor, ['pii:unmask']);

    // Reject unauthorized explicit requests for reconciliation types
    if (
      (type === SearchEntityType.BATCH || type === SearchEntityType.TRANSACTION) &&
      !canAccessRecon
    ) {
      throw new CanonicalApiException(
        HttpStatus.FORBIDDEN,
        'FORBIDDEN',
        'Bạn không có quyền truy cập dữ liệu đối soát',
        false,
        'Vui lòng liên hệ Chủ Shop để được cấp quyền'
      );
    }

    const items: SearchResultItem[] = [];
    const matchedTypes = new Set<string>();

    const shouldQueryOrders = type === SearchEntityType.ALL || type === SearchEntityType.ORDER;
    const shouldQueryWaybills = type === SearchEntityType.ALL || type === SearchEntityType.WAYBILL;
    const shouldQueryBatches =
      (type === SearchEntityType.ALL && canAccessRecon) || type === SearchEntityType.BATCH;
    const shouldQueryCases = type === SearchEntityType.ALL || type === SearchEntityType.CASE;
    const shouldQueryTransactions =
      (type === SearchEntityType.ALL && canAccessRecon) || type === SearchEntityType.TRANSACTION;

    // 1. Orders Aggregate
    if (shouldQueryOrders) {
      const orders = await this.prisma.order.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [
            { order_code: { contains: q, mode: 'insensitive' } },
            { recipient_name: { contains: q, mode: 'insensitive' } },
            { recipient_phone: { contains: q } },
          ],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const ord of orders) {
        const phoneDisplay = canUnmaskPii
          ? ord.recipient_phone
          : maskIdentifier(ord.recipient_phone);

        items.push({
          id: ord.id,
          type: 'ORDER',
          title: `Đơn hàng ${ord.order_code}`,
          subtitle: `Khách hàng: ${ord.recipient_name} | SĐT: ${phoneDisplay}`,
          code: ord.order_code,
          status: ord.source_type.toUpperCase(),
          url: `/orders/${ord.id}`,
          metadata: {
            order_code: ord.order_code,
            recipient_name: ord.recipient_name,
            recipient_phone: phoneDisplay,
            source_type: ord.source_type,
            cod_amount: ord.cod_amount ? ord.cod_amount.toString() : '0',
          },
        });
        matchedTypes.add('ORDER');
      }
    }

    // 2. Waybills / Shipments Aggregate
    if (shouldQueryWaybills) {
      const shipments = await this.prisma.shipment.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [
            { tracking_code: { contains: q, mode: 'insensitive' } },
            { order_code: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const ship of shipments) {
        items.push({
          id: ship.id,
          type: 'WAYBILL',
          title: `Vận đơn ${ship.tracking_code} (${ship.carrier_code})`,
          subtitle: `Đơn gốc: ${ship.order_code} | Trạng thái: ${ship.current_status}`,
          code: ship.tracking_code,
          status: ship.current_status,
          url: `/shipments/${ship.id}`,
          metadata: {
            tracking_code: ship.tracking_code,
            order_code: ship.order_code,
            carrier_code: ship.carrier_code,
            current_status: ship.current_status,
          },
        });
        matchedTypes.add('WAYBILL');
      }
    }

    // 3. Batches / Carrier Statements Aggregate (Reconciliation)
    if (shouldQueryBatches) {
      const statements = await this.prisma.carrierStatement.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [
            { checksum: { contains: q, mode: 'insensitive' } },
            { status: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const stmt of statements) {
        const periodStr = `${stmt.period_start.toISOString().slice(0, 10)} - ${stmt.period_end.toISOString().slice(0, 10)}`;
        items.push({
          id: stmt.id,
          type: 'BATCH',
          title: `Bảng kê đối soát ${stmt.id.slice(0, 8)}...`,
          subtitle: `Kỳ: ${periodStr} | Trạng thái: ${stmt.status}`,
          code: stmt.checksum ? stmt.checksum.slice(0, 16) : stmt.id,
          status: stmt.status,
          url: `/reconciliation/statements/${stmt.id}`,
          metadata: {
            statement_id: stmt.id,
            status: stmt.status,
            total_rows: stmt.total_rows,
            checksum: stmt.checksum,
          },
        });
        matchedTypes.add('BATCH');
      }
    }

    // 4. Cases Aggregate (Exceptions and Claims)
    if (shouldQueryCases) {
      const exceptions = await this.prisma.exceptionCase.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [
            { tracking_code: { contains: q, mode: 'insensitive' } },
            { carrier_raw_reason: { contains: q, mode: 'insensitive' } },
            { standard_reason: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const exc of exceptions) {
        items.push({
          id: exc.id,
          type: 'CASE',
          title: `Ngoại lệ giao hàng (${exc.exception_type})`,
          subtitle: `Vận đơn: ${exc.tracking_code} | Trạng thái: ${exc.status}`,
          code: exc.tracking_code,
          status: exc.status,
          url: `/exceptions/${exc.id}`,
          metadata: {
            case_kind: 'EXCEPTION',
            tracking_code: exc.tracking_code,
            exception_type: exc.exception_type,
            status: exc.status,
          },
        });
        matchedTypes.add('CASE');
      }

      const claims = await this.prisma.claim.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [
            { carrier_ticket: { contains: q, mode: 'insensitive' } },
            { claim_type: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const clm of claims) {
        items.push({
          id: clm.id,
          type: 'CASE',
          title: `Hồ sơ khiếu nại (${clm.claim_type})`,
          subtitle: `Ticket: ${clm.carrier_ticket || 'Chưa có'} | Trạng thái: ${clm.status}`,
          code: clm.carrier_ticket || clm.id,
          status: clm.status,
          url: `/claims/${clm.id}`,
          metadata: {
            case_kind: 'CLAIM',
            claim_type: clm.claim_type,
            carrier_ticket: clm.carrier_ticket,
            status: clm.status,
          },
        });
        matchedTypes.add('CASE');
      }
    }

    // 5. Transactions / Discrepancies Aggregate (Reconciliation)
    if (shouldQueryTransactions) {
      const discrepancies = await this.prisma.discrepancy.findMany({
        where: {
          merchant_id: actor.merchantId,
          OR: [{ tracking_code: { contains: q, mode: 'insensitive' } }],
        },
        take: limit,
        orderBy: { created_at: 'desc' },
      });

      for (const disc of discrepancies) {
        items.push({
          id: disc.id,
          type: 'TRANSACTION',
          title: `Giao dịch lệch đối soát (${disc.type})`,
          subtitle: `Vận đơn: ${disc.tracking_code} | Số tiền lệch: ${formatVnd(disc.amount)} | Trạng thái: ${disc.status}`,
          code: disc.tracking_code,
          status: disc.status,
          url: `/discrepancies/${disc.id}`,
          metadata: {
            tracking_code: disc.tracking_code,
            discrepancy_type: disc.type,
            amount: disc.amount ? disc.amount.toString() : '0',
            status: disc.status,
          },
        });
        matchedTypes.add('TRANSACTION');
      }
    }

    // Truncate combined items to overall requested limit
    const finalItems = items.slice(0, limit);

    // Audit logging (BR-COM-05: query text masked for PII)
    try {
      await this.prisma.auditLog.create({
        data: {
          merchant_id: actor.merchantId,
          user_id: actor.userId,
          actor: actor.role || 'USER',
          action: 'GLOBAL_SEARCH_QUERY',
          entity_type: 'search',
          entity_id: actor.merchantId,
          new_value: {
            query: maskQueryPii(q),
            filter_type: type,
            limit,
            total_results: finalItems.length,
            matched_types: Array.from(matchedTypes),
          },
          reason: correlationId ? `correlation_id:${correlationId}` : null,
          ip_address: this.hashIp(clientIp),
        },
      });
    } catch {
      // Non-blocking fallback for audit write in read-heavy flows
    }

    return {
      success: true,
      data: {
        query: q,
        total: finalItems.length,
        items: finalItems,
      },
      meta: {
        correlation_id: correlationId,
      },
    };
  }
}
