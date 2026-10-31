import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { BulkService, parseCsvRecords } from './bulk.service';
import { validateBulkActionDto } from './bulk.dto';
import { BulkEntityType, BulkActionType, BulkItemStatus } from '@shipde/contracts';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';

function createMockPrismaService() {
  const users: any[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      merchant_id: 'm-tenant-1',
      full_name: 'Owner User',
      email: 'owner@gumac.vn',
      phone: '0901234567',
      role: 'OWNER',
      status: 'active',
      store_scopes: ['*'],
      warehouse_scopes: ['*'],
      carrier_account_scopes: ['*'],
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      merchant_id: 'm-tenant-1',
      full_name: 'Staff Alpha',
      email: 'staff.alpha@gumac.vn',
      phone: '0902222222',
      role: 'OPS_CSKH',
      status: 'active',
      store_scopes: ['branch-north'],
      warehouse_scopes: ['wh-north'],
      carrier_account_scopes: [],
      created_at: new Date('2026-01-02T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      merchant_id: 'm-tenant-1',
      full_name: 'Staff Beta Suspended',
      email: 'staff.beta@gumac.vn',
      phone: '0903333333',
      role: 'OPS_CSKH',
      status: 'suspended',
      store_scopes: ['branch-south'],
      warehouse_scopes: ['wh-south'],
      carrier_account_scopes: [],
      created_at: new Date('2026-01-03T00:00:00Z'),
      updated_at: new Date('2026-01-03T00:00:00Z'),
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      merchant_id: 'm-tenant-2', // Other tenant
      full_name: 'Other Tenant User',
      email: 'other@other.vn',
      phone: '0904444444',
      role: 'OWNER',
      status: 'active',
      store_scopes: ['*'],
      warehouse_scopes: ['*'],
      carrier_account_scopes: [],
      created_at: new Date('2026-01-04T00:00:00Z'),
      updated_at: new Date('2026-01-04T00:00:00Z'),
    },
  ];

  const branches: any[] = [
    {
      id: '55555555-5555-4555-8555-555555555555',
      merchant_id: 'm-tenant-1',
      name: 'Chi nhánh Quận 1',
      code: 'CN_Q1',
      phone: '0905555555',
      address: '100 Lê Lợi, Q1, HCM',
      is_default: true,
      status: 'ACTIVE',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      merchant_id: 'm-tenant-1',
      name: 'Chi nhánh Quận 5',
      code: 'CN_Q5',
      phone: '0906666666',
      address: '200 An Dương Vương, Q5, HCM',
      is_default: false,
      status: 'ACTIVE',
      created_at: new Date('2026-01-02T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    },
  ];

  const warehouses: any[] = [
    {
      id: '77777777-7777-4777-8777-777777777777',
      merchant_id: 'm-tenant-1',
      name: 'Kho Tổng Tân Bình',
      code: 'KHO_TB',
      status: 'active',
      is_default: true,
      contact_name: 'Nguyễn Văn Kho',
      contact_phone: '0907777777',
      contact_email: 'kho.tb@gumac.vn',
      address_line: '123 Trường Chinh',
      city: 'Hồ Chí Minh',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      merchant_id: 'm-tenant-1',
      name: 'Kho Phụ Bình Thạnh',
      code: 'KHO_BT',
      status: 'active',
      is_default: false,
      contact_name: 'Trần Kho Phụ',
      contact_phone: '0908888888',
      contact_email: 'kho.bt@gumac.vn',
      address_line: '456 Nơ Trang Long',
      city: 'Hồ Chí Minh',
      created_at: new Date('2026-01-02T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    },
  ];

  const batches: any[] = [];
  const auditLogs: any[] = [];
  const deviceSessions: any[] = [
    { id: 'sess-1', user_id: '22222222-2222-4222-8222-222222222222', token: 'tok-1' },
    { id: 'sess-2', user_id: '33333333-3333-4333-8333-333333333333', token: 'tok-2' },
  ];

  const userModel = {
    findFirst: async ({ where }: any) => {
      return (
        users.find((u) => {
          if (where.id && u.id !== where.id) return false;
          if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
          return true;
        }) || null
      );
    },
    count: async ({ where }: any) => {
      return users.filter((u) => {
        if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
        if (where.role && u.role !== where.role) return false;
        if (where.status && u.status !== where.status) return false;
        if (where.id?.not && u.id === where.id.not) return false;
        return true;
      }).length;
    },
    update: async ({ where, data }: any) => {
      const idx = users.findIndex((u) => u.id === where.id);
      if (idx === -1) throw new Error('User not found');
      users[idx] = { ...users[idx], ...data, updated_at: new Date() };
      return users[idx];
    },
  };

  const branchModel = {
    findFirst: async ({ where }: any) => {
      return (
        branches.find((b) => {
          if (where.id && b.id !== where.id) return false;
          if (where.merchant_id && b.merchant_id !== where.merchant_id) return false;
          return true;
        }) || null
      );
    },
    update: async ({ where, data }: any) => {
      const idx = branches.findIndex((b) => b.id === where.id);
      if (idx === -1) throw new Error('Branch not found');
      branches[idx] = { ...branches[idx], ...data, updated_at: new Date() };
      return branches[idx];
    },
  };

  const warehouseModel = {
    findFirst: async ({ where }: any) => {
      return (
        warehouses.find((w) => {
          if (where.id && w.id !== where.id) return false;
          if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
          return true;
        }) || null
      );
    },
    update: async ({ where, data }: any) => {
      const idx = warehouses.findIndex((w) => w.id === where.id);
      if (idx === -1) throw new Error('Warehouse not found');
      warehouses[idx] = { ...warehouses[idx], ...data, updated_at: new Date() };
      return warehouses[idx];
    },
  };

  const bulkActionBatchModel = {
    findUnique: async ({ where }: any) => {
      const key = where.merchant_id_idempotency_key;
      return (
        batches.find(
          (b) => b.merchant_id === key.merchant_id && b.idempotency_key === key.idempotency_key
        ) || null
      );
    },
    create: async ({ data }: any) => {
      const batch = { ...data, created_at: new Date(), updated_at: new Date() };
      batches.push(batch);
      return batch;
    },
    update: async ({ where, data }: any) => {
      const idx = batches.findIndex((b) => b.id === where.id);
      if (idx !== -1) {
        batches[idx] = { ...batches[idx], ...data, updated_at: new Date() };
        return batches[idx];
      }
      return null;
    },
  };

  const deviceSessionModel = {
    deleteMany: async ({ where }: any) => {
      const initial = deviceSessions.length;
      const remaining = deviceSessions.filter((s) => s.user_id !== where.user_id);
      const deleted = initial - remaining.length;
      deviceSessions.length = 0;
      deviceSessions.push(...remaining);
      return { count: deleted };
    },
  };

  const auditLogModel = {
    create: async ({ data }: any) => {
      const log = { id: `audit-${Date.now()}-${Math.random()}`, ...data, created_at: new Date() };
      auditLogs.push(log);
      return log;
    },
  };

  const rawSqlLog: string[] = [];

  const mockTx = {
    $queryRaw: async () => [],
    $executeRaw: async (rawSql: any) => {
      const sqlStr =
        typeof rawSql === 'string'
          ? rawSql
          : rawSql?.sql || rawSql?.text || rawSql?.strings?.[0] || String(rawSql);
      rawSqlLog.push(sqlStr);
      return 1;
    },
    user: userModel,
    branch: branchModel,
    warehouse: warehouseModel,
    bulkActionBatch: bulkActionBatchModel,
    deviceSession: deviceSessionModel,
    auditLog: auditLogModel,
  };

  return {
    users,
    branches,
    warehouses,
    batches,
    auditLogs,
    deviceSessions,
    rawSqlLog,
    user: userModel,
    branch: branchModel,
    warehouse: warehouseModel,
    bulkActionBatch: bulkActionBatchModel,
    deviceSession: deviceSessionModel,
    auditLog: auditLogModel,
    $transaction: async (cb: any) => {
      return cb(mockTx);
    },
  };
}

function createMockRbacService(allowPermissions: boolean = true) {
  return {
    actorHasPermissions: async (_actor: ActorContext, _perms: string[]) => {
      return allowPermissions;
    },
  };
}

describe('FEAT-COM-03: Bulk Actions Unit Tests', () => {
  const callerOwner: ActorContext = {
    userId: '11111111-1111-4111-8111-111111111111',
    merchantId: 'm-tenant-1',
    role: 'OWNER',
  };

  const callerOpsStaff: ActorContext = {
    userId: '22222222-2222-4222-8222-222222222222',
    merchantId: 'm-tenant-1',
    role: 'OPS_CSKH',
  };

  describe('DTO Validation: validateBulkActionDto', () => {
    it('accepts valid bulk action DTO', () => {
      const dto = validateBulkActionDto(
        {
          entity_type: 'users',
          action: 'activate',
          ids: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
        },
        100
      );
      assert.strictEqual(dto.entity_type, BulkEntityType.USERS);
      assert.strictEqual(dto.action, BulkActionType.ACTIVATE);
      assert.strictEqual(dto.ids.length, 2);
    });

    it('rejects non-object body with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => validateBulkActionDto('string-body', 100),
        (err: any) => err instanceof CanonicalApiException && err.getStatus() === 400
      );
    });

    it('rejects unsupported entity types like orders with 400 UNSUPPORTED_BULK_ENTITY', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'orders',
              action: 'activate',
              ids: ['11111111-1111-4111-8111-111111111111'],
            },
            100
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 400 &&
          err.code === 'UNSUPPORTED_BULK_ENTITY'
      );
    });

    it('rejects empty id list with 400 EMPTY_ID_LIST', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'users',
              action: 'activate',
              ids: [],
            },
            100
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 400 &&
          err.code === 'VALIDATION_ERROR' &&
          err.fields?.some((f: any) => f.code === 'EMPTY_ID_LIST')
      );
    });

    it('rejects id list exceeding configured max cap with 400 MAX_ITEMS_EXCEEDED', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'users',
              action: 'activate',
              ids: [
                '11111111-1111-4111-8111-111111111111',
                '22222222-2222-4222-8222-222222222222',
                '33333333-3333-4333-8333-333333333333',
              ],
            },
            2 // configured max cap = 2
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 400 &&
          err.code === 'VALIDATION_ERROR' &&
          err.fields?.some((f: any) => f.code === 'MAX_ITEMS_EXCEEDED')
      );
    });

    it('rejects invalid UUID string with 400 INVALID_UUID', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'users',
              action: 'activate',
              ids: ['not-a-valid-uuid'],
            },
            100
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 400 &&
          err.code === 'VALIDATION_ERROR' &&
          err.fields?.some((f: any) => f.code === 'INVALID_UUID')
      );
    });

    it('rejects destructive action deactivate without confirm: true (AC-COM-03-09)', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'users',
              action: 'deactivate',
              ids: ['22222222-2222-4222-8222-222222222222'],
              confirm: false,
            },
            100
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 400 &&
          err.code === 'CONFIRMATION_REQUIRED'
      );
    });

    it('accepts destructive action deactivate when confirm: true is provided', () => {
      const dto = validateBulkActionDto(
        {
          entity_type: 'users',
          action: 'deactivate',
          ids: ['22222222-2222-4222-8222-222222222222'],
          confirm: true,
          params: { reason: 'Scheduled rotation' },
        },
        100
      );
      assert.strictEqual(dto.confirm, true);
      assert.strictEqual(dto.params?.reason, 'Scheduled rotation');
    });

    it('rejects assign_scopes on non-users entities', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'branches',
              action: 'assign_scopes',
              ids: ['55555555-5555-4555-8555-555555555555'],
              params: { store_scopes: ['store-1'] },
            },
            100
          ),
        (err: any) => err instanceof CanonicalApiException && err.getStatus() === 400
      );
    });

    it('rejects assign_scopes without any scope array in params', () => {
      assert.throws(
        () =>
          validateBulkActionDto(
            {
              entity_type: 'users',
              action: 'assign_scopes',
              ids: ['22222222-2222-4222-8222-222222222222'],
              params: {},
            },
            100
          ),
        (err: any) => err instanceof CanonicalApiException && err.getStatus() === 400
      );
    });
  });

  describe('BulkService Operations', () => {
    it('AC-COM-03-01: activates valid suspended user and records truthful outcome & audit log', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const targetId = '33333333-3333-4333-8333-333333333333';
      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetId],
        },
        '127.0.0.1',
        'corr-01'
      );

      assert.strictEqual(res.data.total_count, 1);
      assert.strictEqual(res.data.success_count, 1);
      assert.strictEqual(res.data.failure_count, 0);
      assert.strictEqual(res.data.is_partial_failure, false);
      assert.strictEqual(res.data.results[0].status, BulkItemStatus.SUCCEEDED);

      // Verify DB mutation
      const userInDb = mockPrisma.users.find((u) => u.id === targetId);
      assert.strictEqual(userInDb?.status, 'active');

      // Verify audit log created with masked PII
      assert.strictEqual(mockPrisma.auditLogs.length, 1);
      assert.strictEqual(mockPrisma.auditLogs[0].action, 'USER_ACTIVATED');
      assert.strictEqual(mockPrisma.auditLogs[0].entity_id, targetId);
      assert.strictEqual(mockPrisma.auditLogs[0].new_value.status, 'active');
      assert.ok(mockPrisma.auditLogs[0].new_value.email.includes('*'));
    });

    it('AC-COM-03-02: handles partial failure truthfully (valid + non-existent item)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const validId = '33333333-3333-4333-8333-333333333333';
      const nonExistentId = '99999999-9999-4999-8999-999999999999';

      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [validId, nonExistentId],
        },
        '127.0.0.1',
        'corr-02'
      );

      assert.strictEqual(res.data.total_count, 2);
      assert.strictEqual(res.data.success_count, 1);
      assert.strictEqual(res.data.failure_count, 1);
      assert.strictEqual(res.data.is_partial_failure, true);
      assert.deepStrictEqual(res.data.succeeded_ids, [validId]);
      assert.deepStrictEqual(res.data.failed_ids, [nonExistentId]);

      // Assert error detail on failed item
      const failedItem = res.data.results.find((r) => r.id === nonExistentId);
      assert.ok(failedItem);
      assert.strictEqual(failedItem.status, BulkItemStatus.FAILED);
      assert.strictEqual(failedItem.error?.code, 'ITEM_NOT_FOUND');
    });

    it('AC-COM-03-03: enforces tenant isolation (cross-tenant item fails with ITEM_NOT_FOUND)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService();
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const crossTenantId = '44444444-4444-4444-8444-444444444444'; // Belongs to m-tenant-2

      const res = await service.executeBulkAction(
        'm-tenant-1', // Caller is m-tenant-1
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [crossTenantId],
        },
        '127.0.0.1',
        'corr-03'
      );

      assert.strictEqual(res.data.total_count, 1);
      assert.strictEqual(res.data.success_count, 0);
      assert.strictEqual(res.data.failure_count, 1);
      assert.strictEqual(res.data.results[0].status, BulkItemStatus.FAILED);
      assert.strictEqual(res.data.results[0].error?.code, 'ITEM_NOT_FOUND');

      // Assert other tenant user was NOT mutated
      const userInDb = mockPrisma.users.find((u) => u.id === crossTenantId);
      assert.strictEqual(userInDb?.merchant_id, 'm-tenant-2');
    });

    it('AC-COM-03-04: rejects request with 403 FORBIDDEN when actor lacks entity permission', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(false); // Permission denied
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      await assert.rejects(
        () =>
          service.executeBulkAction(
            'm-tenant-1',
            callerOpsStaff,
            {
              entity_type: BulkEntityType.USERS,
              action: BulkActionType.ACTIVATE,
              ids: ['33333333-3333-4333-8333-333333333333'],
            },
            '127.0.0.1',
            'corr-04'
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 403 &&
          err.code === 'FORBIDDEN'
      );
    });

    it('AC-COM-03-05: enforces FEAT-RBAC-02 scope per item (SCOPE_FORBIDDEN for out-of-scope targets)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      // callerOpsStaff has store_scopes = ['branch-north']
      // Target user 3 has store_scopes = ['branch-south'] (no overlap)
      const targetOutOfScopeId = '33333333-3333-4333-8333-333333333333';

      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetOutOfScopeId],
        },
        '127.0.0.1',
        'corr-05'
      );

      assert.strictEqual(res.data.results[0].status, BulkItemStatus.FAILED);
      assert.strictEqual(res.data.results[0].error?.code, 'SCOPE_FORBIDDEN');

      // Target user with empty scopes (must also return SCOPE_FORBIDDEN for non-owner)
      const userEmptyScopes = {
        id: '99999999-0000-4000-8000-000000000000',
        merchant_id: 'm-tenant-1',
        full_name: 'No Scope User',
        email: 'noscope@gumac.vn',
        phone: '0909999999',
        role: 'OPS_CSKH',
        status: 'suspended',
        store_scopes: [],
        warehouse_scopes: [],
        carrier_account_scopes: [],
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPrisma.users.push(userEmptyScopes);

      const resEmpty = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [userEmptyScopes.id],
        },
        '127.0.0.1',
        'corr-05-empty'
      );
      assert.strictEqual(resEmpty.data.results[0].status, BulkItemStatus.FAILED);
      assert.strictEqual(resEmpty.data.results[0].error?.code, 'SCOPE_FORBIDDEN');
    });

    it('AC-COM-03-06 & 07: enforces idempotency replay and detects conflict on altered payload', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const targetId = '33333333-3333-4333-8333-333333333333';
      const replayBatchIdempotency = 'req-replay-batch-id-01';

      // First call
      const res1 = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetId],
          idempotency_key: replayBatchIdempotency,
        },
        '127.0.0.1',
        'corr-06'
      );

      assert.strictEqual(res1.data.success_count, 1);
      assert.strictEqual(mockPrisma.batches.length, 1);

      // Replay identical call: returns cached batch results
      const res2 = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetId],
          idempotency_key: replayBatchIdempotency,
        },
        '127.0.0.1',
        'corr-06-replay'
      );

      assert.strictEqual(res2.data.batch_id, res1.data.batch_id);

      // Replay with altered payload: throws 409 IDEMPOTENCY_CONFLICT
      await assert.rejects(
        () =>
          service.executeBulkAction(
            'm-tenant-1',
            callerOwner,
            {
              entity_type: BulkEntityType.USERS,
              action: BulkActionType.ACTIVATE,
              ids: [targetId, '22222222-2222-4222-8222-222222222222'], // Altered ids
              idempotency_key: replayBatchIdempotency,
            },
            '127.0.0.1',
            'corr-07-conflict'
          ),
        (err: any) =>
          err instanceof CanonicalApiException &&
          err.getStatus() === 409 &&
          err.code === 'IDEMPOTENCY_CONFLICT'
      );
    });

    it('Finding 2: cached replay revalidates current per-item resource authorization before disclosing cached item data / export CSV', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const targetNorth = '22222222-2222-4222-8222-222222222222'; // branch-north, wh-north
      const targetSouth = '33333333-3333-4333-8333-333333333333'; // branch-south, wh-south
      const testScopeReplayId = 'test-not-a-secret-scope-replay';

      // 1. Owner executes export CSV for both north and south users -> cached batch includes both
      const ownerRes = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          ids: [targetNorth, targetSouth],
          idempotency_key: testScopeReplayId,
        },
        '127.0.0.1',
        'corr-export-owner'
      );
      assert.strictEqual(ownerRes.data.success_count, 2);
      assert.ok(ownerRes.data.export_payload?.includes(targetNorth));
      assert.ok(ownerRes.data.export_payload?.includes(targetSouth));

      // 2. Restricted staff (callerOpsStaff: only has branch-north) replays the cached request
      const replayRes = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          ids: [targetNorth, targetSouth],
          idempotency_key: testScopeReplayId,
        },
        '127.0.0.1',
        'corr-export-replay'
      );

      // Replay must revalidate per-item scope:
      // targetNorth remains SUCCEEDED, targetSouth must be masked to SCOPE_FORBIDDEN
      assert.strictEqual(replayRes.data.success_count, 1);
      assert.strictEqual(replayRes.data.failure_count, 1);

      const northItem = replayRes.data.results.find((r) => r.id === targetNorth);
      assert.strictEqual(northItem?.status, BulkItemStatus.SUCCEEDED);

      const southItem = replayRes.data.results.find((r) => r.id === targetSouth);
      assert.strictEqual(southItem?.status, BulkItemStatus.FAILED);
      assert.strictEqual(southItem?.error?.code, 'SCOPE_FORBIDDEN');

      // Export CSV payload must strip the out-of-scope targetSouth row
      assert.ok(replayRes.data.export_payload?.includes(targetNorth));
      assert.ok(!replayRes.data.export_payload?.includes(targetSouth));
    });

    it('Finding 1 (round 4): cached replay CSV with quoted multiline field discards the whole forbidden record, no continuation fragments', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const northId = '22222222-2222-4222-8222-222222222222'; // branch-north scope -> allowed
      const southId = '33333333-3333-4333-8333-333333333333'; // branch-south scope -> forbidden
      const replayKey = 'test-not-a-secret-multiline-csv';
      const secretFragment = 'CONFIDENTIAL-SOUTH-FRAGMENT';

      // Cached export whose forbidden row carries a quoted multiline field:
      // the second physical line of that row does NOT start with the UUID,
      // which is exactly the fragment-leak shape of the old line-based filter.
      const cachedExportPayload = [
        'id,full_name,email,phone,role,status',
        `${northId},Staff Alpha,st***a@gumac.vn,090****222,OPS_CSKH,active`,
        `${southId},"Multi\n${secretFragment} Name",st***b@gumac.vn,090****333,OPS_CSKH,active`,
      ].join('\r\n');

      mockPrisma.batches.push({
        id: 'batch-multiline-01',
        merchant_id: 'm-tenant-1',
        entity_type: BulkEntityType.USERS,
        action: BulkActionType.EXPORT_CSV,
        idempotency_key: replayKey,
        request_hash: (service as any).computeRequestHash({
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          ids: [northId, southId],
          idempotency_key: replayKey,
        }),
        status: 'COMPLETED',
        total_count: 2,
        success_count: 2,
        failure_count: 0,
        results: {
          batch_id: 'batch-multiline-01',
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          total_count: 2,
          success_count: 2,
          failure_count: 0,
          is_partial_failure: false,
          results: [
            {
              id: northId,
              status: BulkItemStatus.SUCCEEDED,
              data: { id: northId, full_name: 'Staff Alpha' },
            },
            {
              id: southId,
              status: BulkItemStatus.SUCCEEDED,
              data: { id: southId, full_name: 'Multi Name' },
            },
          ],
          succeeded_ids: [northId, southId],
          failed_ids: [],
          export_payload: cachedExportPayload,
        },
        created_by: callerOwner.userId,
      });

      const replayRes = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          ids: [northId, southId],
          idempotency_key: replayKey,
        },
        '127.0.0.1',
        'corr-multiline-replay'
      );

      const payload = replayRes.data.export_payload;
      assert.ok(typeof payload === 'string', 'export_payload must be returned on replay');
      // Authorized row survives...
      assert.ok(payload.includes(northId));
      // ...and the entire forbidden record is gone: UUID, multiline field and
      // every other column of that row must not leak.
      assert.ok(!payload.includes(southId), 'forbidden row UUID must not leak');
      assert.ok(!payload.includes(secretFragment), 'multiline field fragment must not leak');
      assert.ok(!payload.includes('090****333'), 'forbidden row columns must not leak');

      // Filtered payload must still be well-formed RFC 4180: header + 1 record
      const records = parseCsvRecords(payload as string);
      assert.strictEqual(records.length, 2, 'filtered CSV must keep header and one row only');
      assert.deepStrictEqual(records[1].cells[0], northId);
    });

    it('Finding 3 (round 4): per-item savepoints isolate a failed item so remaining items and batch persistence succeed', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const failingId = '33333333-3333-4333-8333-333333333333'; // suspended -> activate mutates + audits
      const healthyId = '22222222-2222-4222-8222-222222222222'; // active -> ALREADY_ACTIVE success
      const isolationKey = 'test-not-a-secret-batch-isolation';

      // Simulate a PostgreSQL statement failure inside the first item's audit
      // insert: without a savepoint this would abort the whole transaction.
      const realAuditCreate = mockPrisma.auditLog.create.bind(mockPrisma.auditLog);
      mockPrisma.auditLog.create = async ({ data }: any) => {
        if (data.entity_id === failingId) {
          throw new Error('simulated per-item database failure');
        }
        return realAuditCreate({ data });
      };

      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [failingId, healthyId],
          idempotency_key: isolationKey,
        },
        '127.0.0.1',
        'corr-savepoint-isolation'
      );

      // Truthful partial outcome: the failed item does not drag down the batch
      assert.strictEqual(res.data.total_count, 2);
      assert.strictEqual(res.data.success_count, 1);
      assert.strictEqual(res.data.failure_count, 1);
      assert.strictEqual(res.data.is_partial_failure, true);
      assert.deepStrictEqual(res.data.succeeded_ids, [healthyId]);
      assert.deepStrictEqual(res.data.failed_ids, [failingId]);
      const failedItem = res.data.results.find((r) => r.id === failingId);
      assert.strictEqual(failedItem?.status, BulkItemStatus.FAILED);
      assert.ok(failedItem?.error?.message?.includes('simulated per-item database failure'));

      // Savepoint protocol: open per item, roll back + release on failure
      const sql = (mockPrisma as any).rawSqlLog as string[];
      const savepointIdx = sql.indexOf('SAVEPOINT bulk_item_sp_0');
      const rollbackIdx = sql.indexOf('ROLLBACK TO SAVEPOINT bulk_item_sp_0');
      const releaseIdx = sql.indexOf('RELEASE SAVEPOINT bulk_item_sp_0');
      const nextSavepointIdx = sql.indexOf('SAVEPOINT bulk_item_sp_1');
      assert.ok(savepointIdx !== -1, 'item 0 must open its own savepoint');
      assert.ok(rollbackIdx > savepointIdx, 'failed item 0 must roll back to its savepoint');
      assert.ok(releaseIdx > rollbackIdx, 'rolled-back savepoint must be released');
      assert.ok(
        nextSavepointIdx > releaseIdx,
        'item 1 must run in the shared transaction after item 0 recovered'
      );

      // Durable batch record with the partial outcome was persisted
      const batch = mockPrisma.batches.find((b) => b.idempotency_key === isolationKey);
      assert.ok(batch, 'batch record must be persisted despite the item failure');
      assert.strictEqual(batch.status, 'PARTIAL_FAILURE');
      assert.strictEqual(batch.success_count, 1);
      assert.strictEqual(batch.failure_count, 1);
    });

    it('Finding 4: safely resumes an interrupted IN_PROGRESS batch under tenant lock without permanent conflict', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const targetId = '33333333-3333-4333-8333-333333333333';
      const recoveryKey = 'test-not-a-secret-recovery-batch';

      // Simulate a prior crashed run that left batch in IN_PROGRESS state
      mockPrisma.batches.push({
        id: 'batch-crashed-01',
        merchant_id: 'm-tenant-1',
        entity_type: BulkEntityType.USERS,
        action: BulkActionType.ACTIVATE,
        idempotency_key: recoveryKey,
        request_hash: (service as any).computeRequestHash({
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetId],
          idempotency_key: recoveryKey,
        }),
        status: 'IN_PROGRESS',
        total_count: 1,
        success_count: 0,
        failure_count: 0,
        results: {},
        created_by: callerOwner.userId,
      });

      // Retrying with the same idempotency key safely recovers and completes the batch under lock
      const recoveredRes = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ACTIVATE,
          ids: [targetId],
          idempotency_key: recoveryKey,
        },
        '127.0.0.1',
        'corr-recovery'
      );

      assert.strictEqual(recoveredRes.data.success_count, 1);
      assert.strictEqual(recoveredRes.data.batch_id, 'batch-crashed-01');

      const batchInDb = mockPrisma.batches.find((b) => b.id === 'batch-crashed-01');
      assert.strictEqual(batchInDb?.status, 'COMPLETED');
    });

    it('AC-COM-03-10: protects sole active owner and prevents self-deactivation during bulk deactivation', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const ownerId = '11111111-1111-4111-8111-111111111111';
      const staffId = '22222222-2222-4222-8222-222222222222';

      // Caller attempts to self-deactivate (ownerId === callerOwner.userId) and deactivate staffId
      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.DEACTIVATE,
          ids: [ownerId, staffId],
          confirm: true,
          params: { reason: 'Company restructuring' },
        },
        '127.0.0.1',
        'corr-10'
      );

      assert.strictEqual(res.data.total_count, 2);
      assert.strictEqual(res.data.success_count, 1);
      assert.strictEqual(res.data.failure_count, 1);

      // Owner failed with SELF_SUSPENSION_PROHIBITED
      const ownerResult = res.data.results.find((r) => r.id === ownerId);
      assert.strictEqual(ownerResult?.status, BulkItemStatus.FAILED);
      assert.strictEqual(ownerResult?.error?.code, 'SELF_SUSPENSION_PROHIBITED');

      // Staff succeeded and is now suspended
      const staffResult = res.data.results.find((r) => r.id === staffId);
      assert.strictEqual(staffResult?.status, BulkItemStatus.SUCCEEDED);

      const staffInDb = mockPrisma.users.find((u) => u.id === staffId);
      assert.strictEqual(staffInDb?.status, 'suspended');

      // Device sessions for staff revoked
      const remainingSessions = mockPrisma.deviceSessions.filter((s) => s.user_id === staffId);
      assert.strictEqual(remainingSessions.length, 0);

      // Non-self actor with scope (e.g. secondary owner session) attempts to deactivate sole active owner (ownerId)
      // Must reach transaction and fail with CANNOT_REMOVE_LAST_OWNER
      const callerOtherOwner: ActorContext = {
        userId: '99999999-9999-4999-8999-999999999999',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const resNonSelfOwnerDeact = await service.executeBulkAction(
        'm-tenant-1',
        callerOtherOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.DEACTIVATE,
          ids: [ownerId],
          confirm: true,
          params: { reason: 'Attempting to deactivate sole active owner' },
        },
        '127.0.0.1',
        'corr-10-sole-owner'
      );

      assert.strictEqual(resNonSelfOwnerDeact.data.failure_count, 1);
      const soleOwnerResult = resNonSelfOwnerDeact.data.results.find((r) => r.id === ownerId);
      assert.strictEqual(soleOwnerResult?.status, BulkItemStatus.FAILED);
      assert.strictEqual(soleOwnerResult?.error?.code, 'CANNOT_REMOVE_LAST_OWNER');
    });

    it('AC-COM-03-11: enforces privilege ceiling when bulk assigning scopes', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      // callerOpsStaff has store_scopes: ['branch-north']
      // Attempting to assign 'branch-south' (unheld) must fail
      const targetStaffId = '22222222-2222-4222-8222-222222222222';

      const resDenied = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ASSIGN_SCOPES,
          ids: [targetStaffId],
          params: { store_scopes: ['branch-south'] },
        },
        '127.0.0.1',
        'corr-11-denied'
      );

      assert.strictEqual(resDenied.data.results[0].status, BulkItemStatus.FAILED);
      assert.strictEqual(resDenied.data.results[0].error?.code, 'PRIVILEGE_CEILING_EXCEEDED');

      // Attempting to assign unheld carrier_account_scopes must fail
      const resCarrierDenied = await service.executeBulkAction(
        'm-tenant-1',
        callerOpsStaff,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ASSIGN_SCOPES,
          ids: [targetStaffId],
          params: { carrier_account_scopes: ['carrier-unheld-account'] },
        },
        '127.0.0.1',
        'corr-11-carrier'
      );
      assert.strictEqual(resCarrierDenied.data.results[0].status, BulkItemStatus.FAILED);
      assert.strictEqual(
        resCarrierDenied.data.results[0].error?.code,
        'PRIVILEGE_CEILING_EXCEEDED'
      );

      // Owner (has wildcard *) assigns scopes successfully
      const resAllowed = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.ASSIGN_SCOPES,
          ids: [targetStaffId],
          params: {
            store_scopes: ['branch-north', 'branch-south'],
            warehouse_scopes: ['wh-all'],
          },
        },
        '127.0.0.1',
        'corr-11-allowed'
      );

      assert.strictEqual(resAllowed.data.results[0].status, BulkItemStatus.SUCCEEDED);
      const updatedUser = mockPrisma.users.find((u) => u.id === targetStaffId);
      assert.deepStrictEqual(updatedUser?.store_scopes, ['branch-north', 'branch-south']);
      assert.deepStrictEqual(updatedUser?.warehouse_scopes, ['wh-all']);
    });

    it('AC-COM-03-12: bulk exports selected users to valid RFC 4180 CSV with masked PII', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

      const res = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.USERS,
          action: BulkActionType.EXPORT_CSV,
          ids,
        },
        '127.0.0.1',
        'corr-12'
      );

      assert.strictEqual(res.data.success_count, 2);
      assert.ok(res.data.export_payload);
      assert.ok(res.data.export_payload.includes('id,full_name,email,phone,role,status'));
      assert.ok(res.data.export_payload.includes('Owner User'));
      assert.ok(res.data.export_payload.includes('Staff Alpha'));
      // Verify PII is masked in exported CSV
      assert.ok(res.data.export_payload.includes('o***r@gumac.vn'));
      assert.ok(res.data.export_payload.includes('090****567'));
    });

    it('executes bulk actions on branches (activate, deactivate, default branch protection, export)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const defaultBranchId = '55555555-5555-4555-8555-555555555555';
      const regularBranchId = '66666666-6666-4666-8666-666666666666';

      // 1. Deactivate branches: default branch must fail with CANNOT_DEACTIVATE_DEFAULT_BRANCH
      const resDeact = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.BRANCHES,
          action: BulkActionType.DEACTIVATE,
          ids: [defaultBranchId, regularBranchId],
          confirm: true,
        },
        '127.0.0.1',
        'corr-branch-deact'
      );

      assert.strictEqual(resDeact.data.total_count, 2);
      assert.strictEqual(resDeact.data.success_count, 1);
      assert.strictEqual(resDeact.data.failure_count, 1);

      const defaultResult = resDeact.data.results.find((r) => r.id === defaultBranchId);
      assert.strictEqual(defaultResult?.error?.code, 'CANNOT_DEACTIVATE_DEFAULT_BRANCH');

      const regResult = resDeact.data.results.find((r) => r.id === regularBranchId);
      assert.strictEqual(regResult?.status, BulkItemStatus.SUCCEEDED);

      // Verify DB status
      const branchInDb = mockPrisma.branches.find((b) => b.id === regularBranchId);
      assert.strictEqual(branchInDb?.status, 'INACTIVE');

      // 2. Activate branch
      const resAct = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.BRANCHES,
          action: BulkActionType.ACTIVATE,
          ids: [regularBranchId],
        },
        '127.0.0.1',
        'corr-branch-act'
      );

      assert.strictEqual(resAct.data.success_count, 1);
      const activatedBranch = mockPrisma.branches.find((b) => b.id === regularBranchId);
      assert.strictEqual(activatedBranch?.status, 'ACTIVE');

      // 3. Export branches CSV
      const resCsv = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.BRANCHES,
          action: BulkActionType.EXPORT_CSV,
          ids: [defaultBranchId, regularBranchId],
        },
        '127.0.0.1',
        'corr-branch-csv'
      );

      assert.ok(resCsv.data.export_payload?.includes('id,name,code,phone,address'));
      assert.ok(resCsv.data.export_payload?.includes('CN_Q1'));
      assert.ok(resCsv.data.export_payload?.includes('CN_Q5'));
    });

    it('executes bulk actions on warehouses (activate, deactivate, default warehouse protection, export)', async () => {
      const mockPrisma = createMockPrismaService();
      const mockRbac = createMockRbacService(true);
      const service = new BulkService(mockPrisma as any, mockRbac as any);

      const defaultWhId = '77777777-7777-4777-8777-777777777777';
      const regularWhId = '88888888-8888-4888-8888-888888888888';

      // 1. Deactivate warehouses: default warehouse must fail with CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE
      const resDeact = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.WAREHOUSES,
          action: BulkActionType.DEACTIVATE,
          ids: [defaultWhId, regularWhId],
          confirm: true,
        },
        '127.0.0.1',
        'corr-wh-deact'
      );

      assert.strictEqual(resDeact.data.total_count, 2);
      assert.strictEqual(resDeact.data.success_count, 1);
      assert.strictEqual(resDeact.data.failure_count, 1);

      const defaultResult = resDeact.data.results.find((r) => r.id === defaultWhId);
      assert.strictEqual(defaultResult?.error?.code, 'CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE');

      const regResult = resDeact.data.results.find((r) => r.id === regularWhId);
      assert.strictEqual(regResult?.status, BulkItemStatus.SUCCEEDED);

      const whInDb = mockPrisma.warehouses.find((w) => w.id === regularWhId);
      assert.strictEqual(whInDb?.status, 'inactive');

      // 2. Activate warehouse
      const resAct = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.WAREHOUSES,
          action: BulkActionType.ACTIVATE,
          ids: [regularWhId],
        },
        '127.0.0.1',
        'corr-wh-act'
      );

      assert.strictEqual(resAct.data.success_count, 1);
      const activatedWh = mockPrisma.warehouses.find((w) => w.id === regularWhId);
      assert.strictEqual(activatedWh?.status, 'active');

      // 3. Export warehouses CSV
      const resCsv = await service.executeBulkAction(
        'm-tenant-1',
        callerOwner,
        {
          entity_type: BulkEntityType.WAREHOUSES,
          action: BulkActionType.EXPORT_CSV,
          ids: [defaultWhId, regularWhId],
        },
        '127.0.0.1',
        'corr-wh-csv'
      );

      assert.ok(resCsv.data.export_payload?.includes('id,name,code,status,is_default'));
      assert.ok(resCsv.data.export_payload?.includes('KHO_TB'));
      assert.ok(resCsv.data.export_payload?.includes('KHO_BT'));
    });
  });
});
