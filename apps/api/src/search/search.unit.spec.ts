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

      return {
        auditLogs,
        queriesRecorded,
        prisma: {
          order: {
            findMany: async (args: any) => {
              queriesRecorded.order.push(args);
              return (fixtures.orders || []).filter(
                (o) => o.merchant_id === args.where.merchant_id
              );
            },
          },
          shipment: {
            findMany: async (args: any) => {
              queriesRecorded.shipment.push(args);
              return (fixtures.shipments || []).filter(
                (s) => s.merchant_id === args.where.merchant_id
              );
            },
          },
          carrierStatement: {
            findMany: async (args: any) => {
              queriesRecorded.carrierStatement.push(args);
              return (fixtures.carrierStatements || []).filter(
                (b) => b.merchant_id === args.where.merchant_id
              );
            },
          },
          exceptionCase: {
            findMany: async (args: any) => {
              queriesRecorded.exceptionCase.push(args);
              return (fixtures.exceptionCases || []).filter(
                (e) => e.merchant_id === args.where.merchant_id
              );
            },
          },
          claim: {
            findMany: async (args: any) => {
              queriesRecorded.claim.push(args);
              return (fixtures.claims || []).filter(
                (c) => c.merchant_id === args.where.merchant_id
              );
            },
          },
          discrepancy: {
            findMany: async (args: any) => {
              queriesRecorded.discrepancy.push(args);
              return (fixtures.discrepancies || []).filter(
                (d) => d.merchant_id === args.where.merchant_id
              );
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
      const rbac = createMockRbacService(['order:view_create', 'pii:unmask']);
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
      const rbac = createMockRbacService(['shipment:track_exceptions']);
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
      const rbac = createMockRbacService(['reconciliation:run_review_audit']);
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
      const rbac = createMockRbacService(['shipment:track_exceptions']);
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
      const rbac = createMockRbacService(['reconciliation:view_contract_rates']);
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
      const rbac = createMockRbacService(['order:view_create']);
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
      const rbac = createMockRbacService(['order:view_create', 'shipment:track_exceptions']);
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
      const rbac = createMockRbacService(['order:view_create']);
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
      const rbac = createMockRbacService(['order:view_create']);
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
  });
});
