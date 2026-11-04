import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { validateSearchQueryDto, MIN_QUERY_LENGTH, MAX_QUERY_LENGTH } from './search.dto';
import { SearchService, maskQueryPii, formatVnd } from './search.service';
import { SearchEntityType } from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';

describe('FEAT-COM-01: Global Search Unit Test Suite', () => {
  describe('DTO Validation: validateSearchQueryDto', () => {
    it('should validate valid query with default type and limit', () => {
      const res = validateSearchQueryDto({ q: 'GHN882910' });
      assert.strictEqual(res.errors.length, 0);
      assert.ok(res.parsed);
      assert.strictEqual(res.parsed.q, 'GHN882910');
      assert.strictEqual(res.parsed.type, SearchEntityType.ALL);
      assert.strictEqual(res.parsed.limit, 20);
    });

    it('should trim query whitespace correctly', () => {
      const res = validateSearchQueryDto({ q: '   ORD-9988   ' });
      assert.strictEqual(res.errors.length, 0);
      assert.ok(res.parsed);
      assert.strictEqual(res.parsed.q, 'ORD-9988');
    });

    it('should accept valid explicit entity types and normalize case', () => {
      for (const t of ['order', 'WAYBILL', 'batch', 'CASE', 'transaction', 'all']) {
        const res = validateSearchQueryDto({ q: 'test query', type: t });
        assert.strictEqual(res.errors.length, 0);
        assert.strictEqual(res.parsed?.type, t.toUpperCase());
      }
    });

    it('should accept custom valid limit within 1 to 50', () => {
      const res1 = validateSearchQueryDto({ q: 'test query', limit: 1 });
      assert.strictEqual(res1.parsed?.limit, 1);

      const res50 = validateSearchQueryDto({ q: 'test query', limit: '50' });
      assert.strictEqual(res50.parsed?.limit, 50);
    });

    it('should reject missing or empty query with VALIDATION_ERROR', () => {
      const resMissing = validateSearchQueryDto({});
      assert.strictEqual(resMissing.errors.length, 1);
      assert.strictEqual(resMissing.errors[0].field, 'q');

      const resEmpty = validateSearchQueryDto({ q: '   ' });
      assert.strictEqual(resEmpty.errors.length, 1);
      assert.strictEqual(resEmpty.errors[0].field, 'q');
    });

    it('should reject query shorter than 2 characters', () => {
      const res = validateSearchQueryDto({ q: 'a' });
      assert.strictEqual(res.errors.length, 1);
      assert.strictEqual(res.errors[0].field, 'q');
      assert.ok(res.errors[0].message.includes('ít nhất 2 ký tự'));
    });

    it('should reject query longer than 100 characters', () => {
      const longQuery = 'x'.repeat(101);
      const res = validateSearchQueryDto({ q: longQuery });
      assert.strictEqual(res.errors.length, 1);
      assert.strictEqual(res.errors[0].field, 'q');
      assert.ok(res.errors[0].message.includes('100 ký tự'));
    });

    it('should reject invalid entity type', () => {
      const res = validateSearchQueryDto({ q: 'test query', type: 'UNKNOWN_TYPE' });
      assert.strictEqual(res.errors.length, 1);
      assert.strictEqual(res.errors[0].field, 'type');
    });

    it('should reject invalid limits (less than 1, greater than 50, not integer)', () => {
      const resZero = validateSearchQueryDto({ q: 'test query', limit: 0 });
      assert.strictEqual(resZero.errors.length, 1);
      assert.strictEqual(resZero.errors[0].field, 'limit');

      const resHigh = validateSearchQueryDto({ q: 'test query', limit: 51 });
      assert.strictEqual(resHigh.errors.length, 1);
      assert.strictEqual(resHigh.errors[0].field, 'limit');

      const resFloat = validateSearchQueryDto({ q: 'test query', limit: 12.5 });
      assert.strictEqual(resFloat.errors.length, 1);
      assert.strictEqual(resFloat.errors[0].field, 'limit');
    });
  });

  describe('PII Masking & Formatting Helpers', () => {
    it('should mask phone numbers in search query for audit logs', () => {
      assert.strictEqual(maskQueryPii('0901234567'), '090****567');
      assert.strictEqual(maskQueryPii('+84901234567'), '+84****567');
      assert.strictEqual(maskQueryPii('tìm SĐT 0912345678 ngay'), 'tìm SĐT 091****678 ngay');
      assert.strictEqual(maskQueryPii('090 123 4567'), '090****567');
      assert.strictEqual(maskQueryPii('090-123-4567'), '090****567');
      assert.strictEqual(
        maskQueryPii('user@example.com call 090 123 4567'),
        'u**r@example.com call 090****567'
      );
    });

    it('should mask email addresses in search query for audit logs', () => {
      const masked = maskQueryPii('customer@example.com');
      assert.ok(masked.includes('@example.com'));
      assert.ok(masked.includes('*'));
      assert.ok(!masked.includes('customer@'));
    });

    it('should preserve non-PII tracking and order codes unmasked', () => {
      assert.strictEqual(maskQueryPii('GHN88291042'), 'GHN88291042');
      assert.strictEqual(maskQueryPii('ORD-2026-001'), 'ORD-2026-001');
    });

    it('should format VND currency values properly', () => {
      const formatted = formatVnd(150000);
      assert.ok(formatted.includes('150.000'));
      assert.ok(formatted.includes('₫'));
      assert.strictEqual(formatVnd(null), '0 ₫');
    });
  });

  describe('SearchService Operations', () => {
    function createMockPrismaService(fixtures: {
      orders?: any[];
      shipments?: any[];
      carrierStatements?: any[];
      exceptionCases?: any[];
      claims?: any[];
      discrepancies?: any[];
      users?: any[];
    }) {
      const auditLogs: any[] = [];
      const queriesRecorded: Record<string, any[]> = {
        order: [],
        shipment: [],
        carrierStatement: [],
        exceptionCase: [],
        claim: [],
        discrepancy: [],
      };

      const matchesScope = (row: any, predicate: any): boolean => {
        if (predicate.AND) return predicate.AND.every((part: any) => matchesScope(row, part));
        if (predicate.OR) return predicate.OR.some((part: any) => matchesScope(row, part));
        return Object.entries(predicate).every(([key, value]: [string, any]) => {
          const actual = row[key] ?? null;
          if (value === null) return actual === null;
          if ('not' in value) return actual !== value.not;
          return value.in.includes(actual);
        });
      };
      const visible = (row: any, where: any) =>
        row.merchant_id === where.merchant_id &&
        (!where.AND || where.AND.every((part: any) => matchesScope(row, part)));

      return {
        auditLogs,
        queriesRecorded,
        prisma: {
          user: {
            findFirst: async ({ where }: any) => {
              if (fixtures.users) {
                const found = fixtures.users.find((u) => u.id === where.id);
                if (found) return { status: 'active', ...found };
                return null;
              }
              return {
                id: where.id,
                role: 'OWNER',
                status: 'active',
                store_scopes: ['*'],
                warehouse_scopes: ['*'],
              };
            },
          },
          order: {
            findMany: async (args: any) => {
              queriesRecorded.order.push(args);
              return (fixtures.orders || []).filter((o) => visible(o, args.where));
            },
          },
          shipment: {
            findMany: async (args: any) => {
              queriesRecorded.shipment.push(args);
              return (fixtures.shipments || []).filter((s) => visible(s, args.where));
            },
          },
          carrierStatement: {
            findMany: async (args: any) => {
              queriesRecorded.carrierStatement.push(args);
              return (fixtures.carrierStatements || []).filter((b) => visible(b, args.where));
            },
          },
          exceptionCase: {
            findMany: async (args: any) => {
              queriesRecorded.exceptionCase.push(args);
              return (fixtures.exceptionCases || []).filter((e) => visible(e, args.where));
            },
          },
          claim: {
            findMany: async (args: any) => {
              queriesRecorded.claim.push(args);
              return (fixtures.claims || []).filter((c) => visible(c, args.where));
            },
          },
          discrepancy: {
            findMany: async (args: any) => {
              queriesRecorded.discrepancy.push(args);
              return (fixtures.discrepancies || []).filter((d) => visible(d, args.where));
            },
          },
          auditLog: {
            create: async ({ data }: any) => {
              auditLogs.push(data);
              return { id: 'audit-id-1', ...data };
            },
          },
        } as any,
      };
    }

    function createMockRbacService(permissions: string[] = []) {
      const permSet = new Set(permissions);
      return {
        actorHasPermissions: async (actor: ActorContext, perms: string[]) => {
          return perms.every((p) => permSet.has(p));
        },
      } as any;
    }

    const TENANT_A = '11111111-1111-1111-1111-111111111111';
    const TENANT_B = '22222222-2222-2222-2222-222222222222';

    const ACTOR_OWNER_A: ActorContext = {
      userId: 'usr-1',
      merchantId: TENANT_A,
      role: 'OWNER',
    };

    const ACTOR_WAREHOUSE_A: ActorContext = {
      userId: 'usr-2',
      merchantId: TENANT_A,
      role: 'WAREHOUSE',
    };

    it('AC-COM-01-01: should search orders and return ORDER results', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-1',
            merchant_id: TENANT_A,
            order_code: 'ORD-001',
            recipient_name: 'Nguyễn Văn A',
            recipient_phone: '0901234567',
            source_type: 'pancake',
            cod_amount: 250000n,
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'order:view_create', 'pii:unmask']);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_OWNER_A,
        { q: 'ORD-001', type: 'ORDER' },
        '127.0.0.1',
        'corr-1'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 1);
      assert.strictEqual(res.data.items[0].type, 'ORDER');
      assert.strictEqual(res.data.items[0].code, 'ORD-001');
      assert.strictEqual(res.data.items[0].metadata.recipient_phone, '0901234567');
      assert.strictEqual(mock.queriesRecorded.order[0].where.merchant_id, TENANT_A);
    });

    it('AC-COM-01-02: should search shipments and return WAYBILL results', async () => {
      const mock = createMockPrismaService({
        shipments: [
          {
            id: 'ship-1',
            merchant_id: TENANT_A,
            tracking_code: 'GHN88291042',
            order_code: 'ORD-001',
            carrier_code: 'GHN',
            current_status: 'IN_TRANSIT',
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'shipment:track_exceptions']);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_OWNER_A,
        { q: 'GHN8829', type: 'WAYBILL' },
        '127.0.0.1',
        'corr-2'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 1);
      assert.strictEqual(res.data.items[0].type, 'WAYBILL');
      assert.strictEqual(res.data.items[0].code, 'GHN88291042');
      assert.strictEqual(res.data.items[0].status, 'IN_TRANSIT');
    });

    it('AC-COM-01-03: should search batches for actors with reconciliation capability', async () => {
      const mock = createMockPrismaService({
        carrierStatements: [
          {
            id: 'stmt-1',
            merchant_id: TENANT_A,
            checksum: 'a1b2c3d4e5f6',
            status: 'RECONCILED',
            period_start: new Date('2026-09-01'),
            period_end: new Date('2026-09-15'),
            total_rows: 150,
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'reconciliation:run_review_audit']);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_OWNER_A,
        { q: 'a1b2c3', type: 'BATCH' },
        '127.0.0.1',
        'corr-3'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 1);
      assert.strictEqual(res.data.items[0].type, 'BATCH');
      assert.strictEqual(res.data.items[0].status, 'RECONCILED');
    });

    it('AC-COM-01-04: should search cases (ExceptionCase & Claim)', async () => {
      const mock = createMockPrismaService({
        exceptionCases: [
          {
            id: 'exc-1',
            merchant_id: TENANT_A,
            tracking_code: 'GHTK77129031',
            exception_type: 'DELIVERY_FAIL',
            status: 'OPEN',
          },
        ],
        claims: [
          {
            id: 'clm-1',
            merchant_id: TENANT_A,
            claim_type: 'DAMAGED',
            carrier_ticket: 'TICKET-999',
            status: 'SUBMITTED',
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'shipment:track_exceptions']);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_OWNER_A,
        { q: '77129031', type: 'CASE' },
        '127.0.0.1',
        'corr-4'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 2);
      assert.ok(res.data.items.some((i) => i.code === 'GHTK77129031'));
      assert.ok(res.data.items.some((i) => i.code === 'TICKET-999'));
    });

    it('AC-COM-01-05: should search transactions (Discrepancy) for authorized users', async () => {
      const mock = createMockPrismaService({
        discrepancies: [
          {
            id: 'disc-1',
            merchant_id: TENANT_A,
            tracking_code: 'GHN88291042',
            type: 'D1_WEIGHT',
            amount: 15000n,
            status: 'OPEN',
          },
        ],
      });
      const rbac = createMockRbacService([
        'search:tenant_wide',
        'reconciliation:view_contract_rates',
      ]);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_OWNER_A,
        { q: 'GHN88291042', type: 'TRANSACTION' },
        '127.0.0.1',
        'corr-5'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 1);
      assert.strictEqual(res.data.items[0].type, 'TRANSACTION');
      assert.strictEqual(res.data.items[0].code, 'GHN88291042');
    });

    it('AC-COM-01-06: should throw 400 VALIDATION_ERROR on query < 2 chars', async () => {
      const mock = createMockPrismaService({});
      const rbac = createMockRbacService();
      const service = new SearchService(mock.prisma, rbac);

      await assert.rejects(
        async () => {
          await service.search(ACTOR_OWNER_A, { q: 'x' }, '127.0.0.1', 'corr-6');
        },
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    it('AC-COM-01-09: should strictly isolate data to caller merchant_id (Tenant Isolation)', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-a',
            merchant_id: TENANT_A,
            order_code: 'MATCH-SECRET',
            recipient_name: 'Khách A',
            recipient_phone: '0901111111',
            source_type: 'pancake',
          },
          {
            id: 'ord-b',
            merchant_id: TENANT_B,
            order_code: 'MATCH-SECRET',
            recipient_name: 'Khách B',
            recipient_phone: '0902222222',
            source_type: 'pancake',
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      // Caller from Tenant A searches for exact order code
      const resA = await service.search(
        ACTOR_OWNER_A,
        { q: 'MATCH-SECRET', type: 'ORDER' },
        '127.0.0.1',
        'corr-7'
      );

      assert.strictEqual(resA.data.total, 1);
      assert.strictEqual(resA.data.items[0].id, 'ord-a');
      assert.strictEqual(mock.queriesRecorded.order[0].where.merchant_id, TENANT_A);
    });

    it('AC-COM-01-10: should exclude BATCH and TRANSACTION when actor lacks reconciliation capability on type=ALL', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-1',
            merchant_id: TENANT_A,
            order_code: 'KEYWORD-123',
            recipient_name: 'Khách A',
            recipient_phone: '0901234567',
            source_type: 'pancake',
          },
        ],
        carrierStatements: [
          {
            id: 'stmt-1',
            merchant_id: TENANT_A,
            checksum: 'KEYWORD-123-SUM',
            status: 'RECONCILED',
            period_start: new Date('2026-09-01'),
            period_end: new Date('2026-09-15'),
            total_rows: 10,
          },
        ],
      });
      // WAREHOUSE actor without reconciliation capabilities
      const rbac = createMockRbacService([
        'search:tenant_wide',
        'order:view_create',
        'shipment:track_exceptions',
      ]);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_WAREHOUSE_A,
        { q: 'KEYWORD-123', type: 'ALL' },
        '127.0.0.1',
        'corr-8'
      );

      // Orders queried, CarrierStatements NEVER queried
      assert.strictEqual(mock.queriesRecorded.carrierStatement.length, 0);
      assert.strictEqual(mock.queriesRecorded.discrepancy.length, 0);
      assert.strictEqual(res.data.total, 1);
      assert.strictEqual(res.data.items[0].type, 'ORDER');
    });

    it('AC-COM-01-11: should reject explicit type=BATCH with 403 FORBIDDEN when actor lacks reconciliation capability', async () => {
      const mock = createMockPrismaService({});
      const rbac = createMockRbacService(['order:view_create']); // Missing reconciliation capability
      const service = new SearchService(mock.prisma, rbac);

      await assert.rejects(
        async () => {
          await service.search(
            ACTOR_WAREHOUSE_A,
            { q: 'statement', type: 'BATCH' },
            '127.0.0.1',
            'corr-9'
          );
        },
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('AC-COM-01-12: should mask recipient phone number when actor lacks pii:unmask capability', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-1',
            merchant_id: TENANT_A,
            order_code: 'ORD-PII',
            recipient_name: 'Trần Thị B',
            recipient_phone: '0987654321',
            source_type: 'pancake',
          },
        ],
      });
      // Actor lacks pii:unmask
      const rbac = createMockRbacService(['search:tenant_wide', 'order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      const res = await service.search(
        ACTOR_WAREHOUSE_A,
        { q: 'ORD-PII', type: 'ORDER' },
        '127.0.0.1',
        'corr-10'
      );

      assert.strictEqual(res.data.total, 1);
      const phoneDisplay = res.data.items[0].metadata.recipient_phone;
      assert.strictEqual(phoneDisplay, '098****321');
      assert.ok(res.data.items[0].subtitle.includes('098****321'));
      assert.ok(!res.data.items[0].subtitle.includes('0987654321'));
    });

    it('AC-COM-01-13: should record GLOBAL_SEARCH_QUERY audit log with masked query string', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-1',
            merchant_id: TENANT_A,
            order_code: 'ORD-PHONE',
            recipient_name: 'Khách C',
            recipient_phone: '0901234567',
            source_type: 'pancake',
          },
        ],
      });
      const rbac = createMockRbacService(['search:tenant_wide', 'order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      // Search with phone number
      await service.search(
        ACTOR_OWNER_A,
        { q: '0901234567', type: 'ORDER' },
        '192.168.1.1',
        'corr-11'
      );

      assert.strictEqual(mock.auditLogs.length, 1);
      const log = mock.auditLogs[0];
      assert.strictEqual(log.action, 'GLOBAL_SEARCH_QUERY');
      assert.strictEqual(log.merchant_id, TENANT_A);
      assert.strictEqual(log.user_id, 'usr-1');
      assert.strictEqual(log.entity_type, 'search');
      // Plaintext phone number must be masked in audit log
      assert.strictEqual(log.new_value.query, '090****567');
      assert.strictEqual(log.new_value.total_results, 1);
    });

    it('AC-COM-01-13 / Finding 1: should fail closed with canonical 500 when audit write fails', async () => {
      const mock = createMockPrismaService({
        orders: [
          {
            id: 'ord-audit-fail',
            merchant_id: TENANT_A,
            order_code: 'ORD-AUDIT-FAIL',
            recipient_name: 'Khách Test',
            recipient_phone: '0901234567',
            source_type: 'pancake',
          },
        ],
      });
      mock.prisma.auditLog.create = async () => {
        throw new Error('Database disk full or constraint violation');
      };

      const rbac = createMockRbacService(['search:tenant_wide', 'order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      await assert.rejects(
        async () => {
          await service.search(
            ACTOR_OWNER_A,
            { q: 'ORD-AUDIT', type: 'ORDER' },
            '192.168.1.1',
            'corr-fail'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException, 'Must throw CanonicalApiException');
          assert.strictEqual(err.getStatus(), 500, 'Must return HTTP 500');
          assert.strictEqual(
            err.code,
            'INTERNAL_SERVER_ERROR',
            'Must return canonical error code INTERNAL_SERVER_ERROR'
          );
          assert.strictEqual(err.retryable, true, 'Must indicate retryable');
          assert.doesNotMatch(
            err.message || '',
            /disk|constraint|database/i,
            'Must not leak raw driver errors'
          );
          return true;
        }
      );
    });

    it('AC-COM-01-27: should apply branch scope predicate when user has store_scopes', async () => {
      const mock = createMockPrismaService({
        users: [
          {
            id: 'usr-branch-north',
            role: 'OPS_CSKH',
            store_scopes: ['branch-north-1'],
            warehouse_scopes: [],
          },
        ],
        orders: [
          {
            id: 'ord-1',
            merchant_id: TENANT_A,
            branch_id: 'branch-north-1',
            order_code: 'ORD-NORTH',
            recipient_name: 'Khách Bắc',
            recipient_phone: '0901234567',
            source_type: 'pancake',
          },
          {
            id: 'ord-2',
            merchant_id: TENANT_A,
            branch_id: 'branch-south-2',
            order_code: 'ORD-SOUTH',
            recipient_name: 'Khách Nam',
            recipient_phone: '0909876543',
            source_type: 'pancake',
          },
        ],
      });
      const rbac = createMockRbacService(['order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      const actorBranchScoped: ActorContext = {
        userId: 'usr-branch-north',
        merchantId: TENANT_A,
        role: 'OPS_CSKH',
      };

      await service.search(
        actorBranchScoped,
        { q: 'ORD', type: 'ORDER' },
        '127.0.0.1',
        'corr-branch'
      );

      const queryArg = mock.queriesRecorded.order[0];
      assert.ok(queryArg.where.AND, 'Query where clause must include AND predicate for scope');
      assert.deepStrictEqual(queryArg.where.AND[0].AND[1], {
        OR: [{ branch_id: null }, { branch_id: { in: ['branch-north-1'] } }],
      });
    });

    it('AC-COM-01-28: should apply warehouse scope predicate when user has warehouse_scopes', async () => {
      const mock = createMockPrismaService({
        users: [
          {
            id: 'usr-wh-north',
            role: 'WAREHOUSE',
            store_scopes: [],
            warehouse_scopes: ['wh-north-1'],
          },
        ],
        shipments: [
          {
            id: 'ship-1',
            merchant_id: TENANT_A,
            warehouse_id: 'wh-north-1',
            tracking_code: 'GHNNORTH',
            order_code: 'ORD-1',
            carrier_code: 'GHN',
            current_status: 'IN_TRANSIT',
          },
        ],
      });
      const rbac = createMockRbacService(['shipment:track_exceptions']);
      const service = new SearchService(mock.prisma, rbac);

      const actorWhScoped: ActorContext = {
        userId: 'usr-wh-north',
        merchantId: TENANT_A,
        role: 'WAREHOUSE',
      };

      await service.search(actorWhScoped, { q: 'GHN', type: 'WAYBILL' }, '127.0.0.1', 'corr-wh');

      const queryArg = mock.queriesRecorded.shipment[0];
      assert.ok(
        queryArg.where.AND,
        'Query where clause must include AND predicate for warehouse scope'
      );
      assert.deepStrictEqual(queryArg.where.AND[0].AND[2], {
        OR: [{ warehouse_id: null }, { warehouse_id: { in: ['wh-north-1'] } }],
      });
    });

    it('AC-COM-01-29: should return empty scope predicate when non-owner has empty scopes', async () => {
      const mock = createMockPrismaService({
        users: [
          {
            id: 'usr-empty-scopes',
            role: 'OPS_CSKH',
            store_scopes: [],
            warehouse_scopes: [],
          },
        ],
        orders: [],
      });
      const rbac = createMockRbacService(['order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      const actorEmptyScoped: ActorContext = {
        userId: 'usr-empty-scopes',
        merchantId: TENANT_A,
        role: 'OPS_CSKH',
      };

      await service.search(
        actorEmptyScoped,
        { q: 'ORD', type: 'ORDER' },
        '127.0.0.1',
        'corr-empty'
      );

      const queryArg = mock.queriesRecorded.order[0];
      assert.ok(
        queryArg.where.AND,
        'Query where clause must block access when user has empty scopes'
      );
      assert.deepStrictEqual(queryArg.where.AND[0].AND[1], {
        OR: [{ branch_id: null }, { branch_id: { in: [] } }],
      });
    });

    it('filters every entity and requires both assigned dimensions to match', async () => {
      const makeRows = (extra: any) => [
        {
          ...extra,
          id: 'allowed',
          merchant_id: TENANT_A,
          branch_id: 'north',
          warehouse_id: 'wh-a',
        },
        {
          ...extra,
          id: 'wrong-warehouse',
          merchant_id: TENANT_A,
          branch_id: 'north',
          warehouse_id: 'wh-b',
        },
        {
          ...extra,
          id: 'wrong-branch',
          merchant_id: TENANT_A,
          branch_id: 'south',
          warehouse_id: 'wh-a',
        },
        { ...extra, id: 'unknown', merchant_id: TENANT_A },
        {
          ...extra,
          id: 'other-tenant',
          merchant_id: TENANT_B,
          branch_id: 'north',
          warehouse_id: 'wh-a',
        },
      ];
      const mock = createMockPrismaService({
        users: [
          { id: 'scoped', role: 'OPS_CSKH', store_scopes: ['north'], warehouse_scopes: ['wh-a'] },
        ],
        orders: makeRows({
          order_code: 'ORD',
          recipient_name: 'Name',
          recipient_phone: '0901234567',
        }),
        shipments: makeRows({
          tracking_code: 'TRACK',
          order_code: 'ORD',
          carrier_code: 'GHN',
          current_status: 'IN_TRANSIT',
        }),
        carrierStatements: makeRows({
          checksum: 'CHECK',
          status: 'OPEN',
          period_start: new Date(),
          period_end: new Date(),
        }),
        exceptionCases: makeRows({
          tracking_code: 'TRACK',
          exception_type: 'OTHER',
          status: 'OPEN',
        }),
        claims: makeRows({ carrier_ticket: 'TICKET', claim_type: 'LOST', status: 'OPEN' }),
        discrepancies: makeRows({
          tracking_code: 'TRACK',
          discrepancy_type: 'OTHER',
          status: 'OPEN',
          amount: 0n,
        }),
      });
      const service = new SearchService(
        mock.prisma,
        createMockRbacService([
          'order:view_create',
          'shipment:track_exceptions',
          'reconciliation:view_contract_rates',
          'reconciliation:run_review_audit',
          'claim:verify_submit',
          'audit:view',
        ])
      );
      const result = await service.search(
        { userId: 'scoped', merchantId: TENANT_A, role: 'OPS_CSKH' },
        { q: 'TR', type: 'ALL' },
        '127.0.0.1',
        'scope'
      );
      assert.equal(result.data.items.length, 6);
      assert.ok(result.data.items.every((item: any) => item.id === 'allowed'));
    });

    it('tenant-wide registry grant reveals unscoped records within the tenant', async () => {
      const mock = createMockPrismaService({
        users: [{ id: 'usr-1', role: 'OPS_CSKH', store_scopes: [], warehouse_scopes: [] }],
        orders: [
          {
            id: 'legacy',
            merchant_id: TENANT_A,
            order_code: 'ORD',
            branch_id: null,
            warehouse_id: null,
          },
          {
            id: 'foreign',
            merchant_id: TENANT_B,
            order_code: 'ORD',
            branch_id: null,
            warehouse_id: null,
          },
        ],
      });
      const rbac = createMockRbacService(['order:view_create', 'search:tenant_wide']);
      const service = new SearchService(mock.prisma, rbac);

      const result = await service.search(
        { ...ACTOR_OWNER_A, role: 'OPS_CSKH' },
        { q: 'ORD', type: 'ORDER' },
        '127.0.0.1',
        'corr-permission'
      );
      assert.deepStrictEqual(
        result.data.items.map((item) => item.id),
        ['legacy']
      );

      const queryArg = mock.queriesRecorded.order[0];
      assert.strictEqual(
        queryArg.where.AND,
        undefined,
        'Registry permission must grant tenant-wide search'
      );
    });

    it('wildcard scopes without tenant-wide permission exclude unassigned records', async () => {
      const mock = createMockPrismaService({
        users: [
          {
            id: 'usr-wildcard-ops',
            role: 'OPS_CSKH',
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
          },
        ],
        orders: [
          {
            id: 'ord-unassigned',
            merchant_id: TENANT_A,
            branch_id: null,
            warehouse_id: null,
            order_code: 'ORD-UNASSIGNED',
            recipient_name: 'Khách Tự Do',
            recipient_phone: '0901234567',
            source_type: 'pancake',
          },
        ],
      });
      const rbac = createMockRbacService(['order:view_create']);
      const service = new SearchService(mock.prisma, rbac);

      const actorWildcard: ActorContext = {
        userId: 'usr-wildcard-ops',
        merchantId: TENANT_A,
        role: 'OPS_CSKH',
      };

      const scopes = await service.resolveActorScopes(actorWildcard);
      assert.strictEqual(scopes.hasUniversalAccess, false);
      assert.notStrictEqual(service.buildScopePredicate(scopes), null);

      const res = await service.search(
        actorWildcard,
        { q: 'ORD', type: 'ORDER' },
        '127.0.0.1',
        'corr-wildcard'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.total, 0);
      assert.deepStrictEqual(res.data.items, []);
    });

    it('OWNER alone cannot bypass scopes or reveal unscoped records', async () => {
      const mock = createMockPrismaService({
        users: [
          {
            id: 'usr-1',
            role: 'OWNER',
            store_scopes: ['default'],
            warehouse_scopes: ['default'],
          },
        ],
        orders: [
          {
            id: 'legacy',
            merchant_id: TENANT_A,
            order_code: 'ORD',
            branch_id: null,
            warehouse_id: null,
          },
          {
            id: 'outside',
            merchant_id: TENANT_A,
            order_code: 'ORD',
            branch_id: 'other',
            warehouse_id: 'other',
          },
          {
            id: 'allowed',
            merchant_id: TENANT_A,
            order_code: 'ORD',
            branch_id: 'default',
            warehouse_id: 'default',
          },
        ],
      });
      const service = new SearchService(mock.prisma, createMockRbacService(['order:view_create']));
      const result = await service.search(
        ACTOR_OWNER_A,
        { q: 'ORD', type: 'ORDER' },
        '127.0.0.1',
        'corr-no-grant'
      );
      assert.deepStrictEqual(
        result.data.items.map((item) => item.id),
        ['allowed']
      );
    });
  });
});
