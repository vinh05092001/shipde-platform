import * as assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { RbacService, SYSTEM_ROLE_IDS } from './rbac.service';
import { PLATFORM_PERMISSIONS, SYSTEM_ROLES } from './rbac.constants';
import { CanonicalApiException } from '../auth/auth.service';

/**
 * In-memory Mock Prisma Service for testing RBAC business rules,
 * invariants, privilege ceiling, system role immutability, and transactional rollbacks.
 */
class MockPrismaService {
  permissions: any[] = [];
  roles: any[] = [];
  rolePermissions: any[] = [];
  users: any[] = [];
  auditLogs: any[] = [];
  shouldFailAudit = false;
  shouldFailRoleFindFirst = false;
  shouldFailPermissionFindMany = false;

  constructor() {
    this.reset();
  }

  reset() {
    this.permissions = PLATFORM_PERMISSIONS.map((p, idx) => ({
      id: `p-${idx + 1}`,
      code: p.code,
      name: p.name,
      description: p.description,
      category: p.category,
      created_at: new Date('2026-01-01T00:00:00Z'),
    }));

    this.roles = SYSTEM_ROLES.map((sr) => ({
      id: SYSTEM_ROLE_IDS[sr.code],
      code: sr.code,
      name: sr.name,
      description: sr.description,
      is_system: true,
      merchant_id: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    }));

    this.rolePermissions = [];
    for (const sr of SYSTEM_ROLES) {
      const roleId = SYSTEM_ROLE_IDS[sr.code];
      for (const pCode of sr.permissions) {
        const p = this.permissions.find((x) => x.code === pCode);
        if (p) {
          this.rolePermissions.push({
            id: `rp-${roleId}-${p.id}`,
            role_id: roleId,
            permission_id: p.id,
          });
        }
      }
    }

    this.users = [
      {
        id: 'user-owner-1',
        merchant_id: 'merchant-aaa-111',
        role: 'OWNER',
        custom_role_id: null,
        status: 'ACTIVE',
      },
      {
        id: 'user-cskh-2',
        merchant_id: 'merchant-aaa-111',
        role: 'OPS_CSKH',
        custom_role_id: null,
        status: 'ACTIVE',
      },
      {
        id: 'user-warehouse-3',
        merchant_id: 'merchant-aaa-111',
        role: 'WAREHOUSE',
        custom_role_id: null,
        status: 'ACTIVE',
      },
    ];
    this.auditLogs = [];
    this.shouldFailAudit = false;
    this.shouldFailRoleFindFirst = false;
    this.shouldFailPermissionFindMany = false;
  }

  permission = {
    findMany: async (args?: any) => {
      if (this.shouldFailPermissionFindMany) {
        throw new Error('Database read failure for permissions');
      }
      let result = [...this.permissions];
      if (args?.where?.OR) {
        const codes = args.where.OR.find((o: any) => o.code?.in)?.code?.in || [];
        const ids = args.where.OR.find((o: any) => o.id?.in)?.id?.in || [];
        result = result.filter((p) => codes.includes(p.code) || ids.includes(p.id));
      }
      return result;
    },
    upsert: async (args: any) => {
      const existing = this.permissions.find((p) => p.code === args.where.code);
      if (existing) return existing;
      const created = { id: args.create.id, ...args.create, created_at: new Date() };
      this.permissions.push(created);
      return created;
    },
  };

  role = {
    findMany: async (args?: any) => {
      let filtered = [...this.roles];
      if (args?.where?.OR) {
        const merchantId = args.where.OR.find((o: any) => o.merchant_id)?.merchant_id;
        filtered = filtered.filter((r) => r.is_system || r.merchant_id === merchantId);
      }
      return filtered.map((r) => ({
        ...r,
        permissions: this.rolePermissions
          .filter((rp) => rp.role_id === r.id)
          .map((rp) => ({
            role_id: rp.role_id,
            permission_id: rp.permission_id,
            permission: this.permissions.find((p) => p.id === rp.permission_id),
          })),
      }));
    },
    findUnique: async (args: any) => {
      const r = this.roles.find((x) => x.id === args.where.id);
      if (!r) return null;
      return {
        ...r,
        permissions: this.rolePermissions
          .filter((rp) => rp.role_id === r.id)
          .map((rp) => ({
            role_id: rp.role_id,
            permission_id: rp.permission_id,
            permission: this.permissions.find((p) => p.id === rp.permission_id),
          })),
      };
    },
    findFirst: async (args: any) => {
      if (this.shouldFailRoleFindFirst) {
        throw new Error('Database connection failed during role lookup');
      }
      const r = this.roles.find((r) => {
        if (args?.where?.id && r.id !== args.where.id) return false;
        if (args?.where?.code && r.code !== args.where.code) return false;
        if (args?.where?.is_system !== undefined && r.is_system !== args.where.is_system)
          return false;
        if (args?.where?.merchant_id && r.merchant_id !== args.where.merchant_id) return false;
        if (args?.where?.id?.not && r.id === args.where.id.not) return false;
        if (args?.where?.name?.equals) {
          const matches =
            r.name.trim().toLowerCase() === args.where.name.equals.trim().toLowerCase();
          if (!matches) return false;
        }
        return true;
      });
      if (!r) return null;
      if (args?.include?.permissions) {
        return {
          ...r,
          permissions: this.rolePermissions
            .filter((rp) => rp.role_id === r.id)
            .map((rp) => ({
              role_id: rp.role_id,
              permission_id: rp.permission_id,
              permission: this.permissions.find((p) => p.id === rp.permission_id),
            })),
        };
      }
      return r;
    },
    create: async (args: any) => {
      const duplicate = this.roles.find(
        (r) =>
          r.merchant_id === args.data.merchant_id &&
          r.name.trim().toLowerCase() === args.data.name.trim().toLowerCase()
      );
      if (duplicate) {
        const error: any = new Error(
          'Unique constraint failed on the constraint: roles_merchant_id_lower_name_key'
        );
        error.code = 'P2002';
        throw error;
      }
      const created = {
        id: args.data.id || `custom-role-${this.roles.length + 1}`,
        ...args.data,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.roles.push(created);
      return created;
    },
    update: async (args: any) => {
      const idx = this.roles.findIndex((r) => r.id === args.where.id);
      if (idx === -1) throw new Error('Not found');
      this.roles[idx] = {
        ...this.roles[idx],
        ...args.data,
        updated_at: new Date(),
      };
      return this.roles[idx];
    },
    delete: async (args: any) => {
      const assignedUser = this.users.find((u) => u.custom_role_id === args.where.id);
      if (assignedUser) {
        const error: any = new Error(
          'Foreign key constraint failed on the field: users_custom_role_id_fkey'
        );
        error.code = 'P2003';
        throw error;
      }
      const idx = this.roles.findIndex((r) => r.id === args.where.id);
      if (idx === -1) throw new Error('Not found');
      const deleted = this.roles.splice(idx, 1)[0];
      return deleted;
    },
  };

  rolePermission = {
    findMany: async () => this.rolePermissions,
    create: async (args: any) => {
      const created = { id: `rp-${Date.now()}-${Math.random()}`, ...args.data };
      this.rolePermissions.push(created);
      return created;
    },
    deleteMany: async (args: any) => {
      if (args.where.role_id) {
        this.rolePermissions = this.rolePermissions.filter(
          (rp) => rp.role_id !== args.where.role_id
        );
      }
    },
    upsert: async (args: any) => {
      const existing = this.rolePermissions.find(
        (rp) =>
          rp.role_id === args.where.role_id_permission_id.role_id &&
          rp.permission_id === args.where.role_id_permission_id.permission_id
      );
      if (existing) return existing;
      const created = { id: `rp-${Date.now()}-${Math.random()}`, ...args.create };
      this.rolePermissions.push(created);
      return created;
    },
  };

  user = {
    count: async (args: any) => {
      let count = 0;
      for (const u of this.users) {
        if (args.where.merchant_id && u.merchant_id !== args.where.merchant_id) continue;
        if (args.where.status && u.status !== args.where.status) continue;
        if (
          args.where.custom_role_id !== undefined &&
          u.custom_role_id !== args.where.custom_role_id
        )
          continue;
        if (args.where.role && u.role !== args.where.role) continue;
        count++;
      }
      return count;
    },
    findUnique: async (args: any) => {
      return this.users.find((u) => u.id === args.where.id) || null;
    },
  };

  auditLog = {
    create: async (args: any) => {
      if (this.shouldFailAudit) {
        throw new Error('Simulated auditLog database storage failure');
      }
      const entry = { id: `audit-${Date.now()}`, ...args.data, created_at: new Date() };
      this.auditLogs.push(entry);
      return entry;
    },
  };

  $transaction = async (fn: (tx: any) => Promise<any>) => {
    // Snapshot state for atomic rollback simulation
    const snapshotRoles = JSON.parse(JSON.stringify(this.roles));
    const snapshotRolePerms = JSON.parse(JSON.stringify(this.rolePermissions));
    const snapshotAuditLogs = JSON.parse(JSON.stringify(this.auditLogs));

    try {
      return await fn(this);
    } catch (err) {
      // Rollback state on error
      this.roles = snapshotRoles;
      this.rolePermissions = snapshotRolePerms;
      this.auditLogs = snapshotAuditLogs;
      throw err;
    }
  };
}

describe('FEAT-RBAC-01 — Roles and Permissions Unit Test Suite', () => {
  let mockPrisma: MockPrismaService;
  let service: RbacService;

  const MERCHANT_A = 'merchant-aaa-111';
  const MERCHANT_B = 'merchant-bbb-222';
  const OWNER_ACTOR = {
    userId: 'user-owner-1',
    merchantId: MERCHANT_A,
    role: 'OWNER',
  };
  const CSKH_ACTOR = {
    userId: 'user-cskh-2',
    merchantId: MERCHANT_A,
    role: 'OPS_CSKH',
  };
  const WAREHOUSE_ACTOR = {
    userId: 'user-warehouse-3',
    merchantId: MERCHANT_A,
    role: 'WAREHOUSE',
  };

  beforeEach(() => {
    mockPrisma = new MockPrismaService();
    service = new RbacService(mockPrisma as any);
  });

  // AC-RBAC-01-01
  test('AC-RBAC-01-01: List canonical platform permissions catalog grouped by category', async () => {
    const res = await service.getPermissions('corr-01');
    assert.strictEqual(res.meta.correlation_id, 'corr-01');
    assert.strictEqual(res.data.permissions.length, 20);
    assert.deepStrictEqual(
      [...res.data.categories].sort(),
      ['AUDIT', 'CLAIMS', 'IAM', 'ORDERS', 'RECONCILIATION', 'SHIPMENTS'].sort()
    );

    const piiPerm = res.data.permissions.find((p: any) => p.code === 'pii:unmask');
    assert.ok(piiPerm);
    assert.strictEqual(piiPerm.category, 'AUDIT');
  });

  // AC-RBAC-01-02
  test('AC-RBAC-01-02: Owner lists merchant roles (system roles + custom roles)', async () => {
    // Add one custom role for MERCHANT_A
    mockPrisma.roles.push({
      id: 'custom-1',
      code: null,
      name: 'Nhân viên chốt đơn đêm',
      description: 'Chỉ tạo đơn và tra cứu giá',
      is_system: false,
      merchant_id: MERCHANT_A,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const res = await service.getRoles(MERCHANT_A, 'corr-02');
    assert.strictEqual(res.meta.correlation_id, 'corr-02');

    // Should include 5 system roles + 1 custom role = 6 roles
    assert.strictEqual(res.data.roles.length, 6);
    const systemRoles = res.data.roles.filter((r: any) => r.is_system);
    assert.strictEqual(systemRoles.length, 5);

    const custom = res.data.roles.find((r: any) => r.id === 'custom-1');
    assert.ok(custom);
    assert.strictEqual(custom.is_system, false);
    assert.strictEqual(custom.name, 'Nhân viên chốt đơn đêm');
  });

  // AC-RBAC-01-03
  test('AC-RBAC-01-03: Owner creates new custom role with valid permissions and audit log', async () => {
    const res = await service.createRole(
      {
        name: 'Trợ lý CSKH & Vận Đơn',
        description: 'Tạo đơn và tra cứu cước vận chuyển',
        permissions: ['order:view_create', 'shipment:quote_carrier'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-03'
    );

    assert.ok(res.data.role.id);
    assert.strictEqual(res.data.role.name, 'Trợ lý CSKH & Vận Đơn');
    assert.strictEqual(res.data.role.is_system, false);
    assert.strictEqual(res.data.role.permissions_count, 2);

    // Assert audit log ROLE_CREATED was recorded
    const audit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_CREATED' && a.entity_id === res.data.role.id
    );
    assert.ok(audit, 'ROLE_CREATED audit log must be written');
    assert.strictEqual(audit.merchant_id, MERCHANT_A);
    assert.strictEqual(audit.user_id, OWNER_ACTOR.userId);
  });

  // AC-RBAC-01-04
  test('AC-RBAC-01-04: Owner creates custom role with duplicate name in tenant -> 400 ROLE_NAME_EXISTS', async () => {
    await service.createRole(
      {
        name: 'Kiểm Soát Viên Kho',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-04'
    );

    // Attempt to create duplicate name (case-insensitive)
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'kiểm soát viên kho',
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-04-dup'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'ROLE_NAME_EXISTS');
        assert.strictEqual(err.getStatus(), 400);
        return true;
      }
    );
  });

  // AC-RBAC-01-05
  test('AC-RBAC-01-05: Non-owner actor attempts to create role with permissions they lack -> 403 PRIVILEGE_ESCALATION_DENIED', async () => {
    // CSKH has permissions: order:view_create, shipment:quote_carrier, shipment:create_update, shipment:cancel_redeliver, shipment:track_exceptions, pii:unmask.
    // If CSKH tries to grant 'reconciliation:approve_rate_policy', it must be rejected!
    // But first, does CSKH have iam:manage_users? If CSKH has custom role with iam:manage_users, test privilege ceiling:
    const cskhManagerActor = {
      userId: 'user-manager-cskh',
      merchantId: MERCHANT_A,
      role: 'CUSTOM',
      customRoleId: 'role-cskh-lead',
    };

    mockPrisma.roles.push({
      id: 'role-cskh-lead',
      name: 'Trưởng nhóm CSKH',
      is_system: false,
      merchant_id: MERCHANT_A,
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Give CSKH lead iam:manage_users and order:view_create
    mockPrisma.rolePermissions.push(
      {
        id: 'rp-1',
        role_id: 'role-cskh-lead',
        permission_id: mockPrisma.permissions.find((p) => p.code === 'iam:manage_users').id,
      },
      {
        id: 'rp-2',
        role_id: 'role-cskh-lead',
        permission_id: mockPrisma.permissions.find((p) => p.code === 'order:view_create').id,
      }
    );

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Super Accountant Role',
            // CSKH lead does not hold reconciliation:approve_rate_policy!
            permissions: ['order:view_create', 'reconciliation:approve_rate_policy'],
          },
          cskhManagerActor,
          '127.0.0.1',
          'corr-05'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // AC-RBAC-01-06
  test('AC-RBAC-01-06: User attempts to modify built-in system role -> 403 SYSTEM_ROLE_IMMUTABLE', async () => {
    const ownerRoleId = SYSTEM_ROLE_IDS.OWNER;

    await assert.rejects(
      async () => {
        await service.updateRole(
          ownerRoleId,
          { name: 'Mutated Owner' },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-06'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'SYSTEM_ROLE_IMMUTABLE');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // AC-RBAC-01-07
  test('AC-RBAC-01-07: User attempts to delete built-in system role -> 403 SYSTEM_ROLE_IMMUTABLE', async () => {
    const warehouseRoleId = SYSTEM_ROLE_IDS.WAREHOUSE;

    await assert.rejects(
      async () => {
        await service.deleteRole(warehouseRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-07');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'SYSTEM_ROLE_IMMUTABLE');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // AC-RBAC-01-08
  test('AC-RBAC-01-08: Owner updates permissions of a custom role -> 200 OK and audit ROLE_UPDATED logged', async () => {
    const createRes = await service.createRole(
      {
        name: 'Nhân viên đóng gói',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-08-c'
    );

    const updateRes = await service.updateRole(
      createRes.data.role.id,
      {
        name: 'Nhân viên đóng gói & in nhãn',
        permissions: ['order:view_create', 'shipment:print_handover'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-08-u'
    );

    assert.strictEqual(updateRes.data.role.name, 'Nhân viên đóng gói & in nhãn');
    assert.strictEqual(updateRes.data.role.permissions_count, 2);

    const audit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_UPDATED' && a.entity_id === createRes.data.role.id
    );
    assert.ok(audit, 'ROLE_UPDATED audit log must be written');
  });

  // AC-RBAC-01-09
  test('AC-RBAC-01-09: Owner attempts to delete custom role that is assigned to active user -> 400 ROLE_IN_USE', async () => {
    const createRes = await service.createRole(
      {
        name: 'Vai trò Đang Dùng',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-09-c'
    );

    const customRoleId = createRes.data.role.id;

    // Simulate active user assigned to this custom role
    mockPrisma.users.push({
      id: 'user-assigned-1',
      merchant_id: MERCHANT_A,
      custom_role_id: customRoleId,
      status: 'active',
    });

    await assert.rejects(
      async () => {
        await service.deleteRole(customRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-09-d');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        assert.strictEqual(err.getStatus(), 400);
        return true;
      }
    );
  });

  // AC-RBAC-01-10
  test('AC-RBAC-01-10: Owner deletes unassigned custom role -> 200 OK and audit ROLE_DELETED logged', async () => {
    const createRes = await service.createRole(
      {
        name: 'Vai trò Tạm Thời',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-10-c'
    );

    const deleteRes = await service.deleteRole(
      createRes.data.role.id,
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-10-d'
    );

    assert.strictEqual(deleteRes.data.deleted, true);

    const audit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_DELETED' && a.entity_id === createRes.data.role.id
    );
    assert.ok(audit, 'ROLE_DELETED audit log must be written');
  });

  // AC-RBAC-01-11
  test('AC-RBAC-01-11: Cross-tenant actor attempts to view or edit custom role -> 403 FORBIDDEN', async () => {
    const roleInA = await service.createRole(
      {
        name: 'Tenant A Secret Role',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-11-c'
    );

    const actorFromB = {
      userId: 'user-b-owner',
      merchantId: MERCHANT_B,
      role: 'OWNER',
    };

    // View attempt
    await assert.rejects(
      async () => {
        await service.getRoleById(roleInA.data.role.id, actorFromB, 'corr-11-v');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );

    // Edit attempt
    await assert.rejects(
      async () => {
        await service.updateRole(
          roleInA.data.role.id,
          { name: 'Hacked Name' },
          actorFromB,
          '127.0.0.1',
          'corr-11-e'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // AC-RBAC-01-12
  test('AC-RBAC-01-12: Missing required role name during creation -> 400 VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: '   ',
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-12'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.strictEqual(err.getStatus(), 400);
        assert.ok(err.fields?.some((f: any) => f.field === 'name'));
        return true;
      }
    );
  });

  // AC-RBAC-01-13
  test('AC-RBAC-01-13: Creation request with empty permission array -> 400 VALIDATION_ERROR', async () => {
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Không Có Quyền Gì',
            permissions: [],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-13'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.strictEqual(err.getStatus(), 400);
        assert.ok(err.fields?.some((f: any) => f.field === 'permissions'));
        return true;
      }
    );
  });

  // AC-RBAC-01-14
  test('AC-RBAC-01-14: User lacking Manage users/roles permission attempts role mutation -> 403 FORBIDDEN', async () => {
    // Warehouse actor only has order:view_create, shipment:print_handover, receive_return, track_exceptions
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Vai Trò Trái Phép',
            permissions: ['order:view_create'],
          },
          WAREHOUSE_ACTOR,
          '127.0.0.1',
          'corr-14'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // AC-RBAC-01-15
  test('AC-RBAC-01-15: Audit logging failure during role mutation -> Transaction rolls back and role state unmodified', async () => {
    mockPrisma.shouldFailAudit = true;
    const initialRoleCount = mockPrisma.roles.length;

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Vai Trò Phải Bị Rollback',
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-15'
        );
      },
      (err: any) => {
        assert.strictEqual(err.message, 'Simulated auditLog database storage failure');
        return true;
      }
    );

    // Assert role was not saved
    assert.strictEqual(mockPrisma.roles.length, initialRoleCount);
    const saved = mockPrisma.roles.find((r) => r.name === 'Vai Trò Phải Bị Rollback');
    assert.strictEqual(saved, undefined, 'Role creation must roll back on audit failure');
  });

  // AC-RBAC-01-16
  test('AC-RBAC-01-16: Security inspection of role endpoints and audit logs -> No sensitive secrets or tokens exposed', async () => {
    const res = await service.getRoles(MERCHANT_A, 'corr-16');
    const jsonStr = JSON.stringify(res);

    assert.ok(!jsonStr.includes('password_hash'), 'No password hashes exposed');
    assert.ok(!jsonStr.includes('secret_ciphertext'), 'No MFA secrets exposed');
    assert.ok(!jsonStr.includes('token_hash'), 'No session token hashes exposed');
  });

  // Finding 1 (P0): Server-authoritative actor resolution and custom role ceiling
  test('Finding 1 / BR-RBAC-02: resolveActorFromSession discards client/JWT claims, evaluates DB role and custom_role_id, and enforces ceiling', async () => {
    // 1. Demoted owner with stale JWT claim
    mockPrisma.users.push({
      id: 'user-demoted-owner',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: null,
      status: 'ACTIVE',
    });

    const fakeClientReq = {
      userId: 'user-demoted-owner',
      merchantId: MERCHANT_A,
      userRole: 'OWNER', // Stale claim
      jwtClaims: { role: 'OWNER', sub: 'user-demoted-owner', mid: MERCHANT_A },
    };

    const resolved = await service.resolveActorFromSession(fakeClientReq as any);
    assert.strictEqual(
      resolved.role,
      'OPS_CSKH',
      'Must ignore client/JWT claim and load authoritative DB role'
    );
    assert.strictEqual(resolved.customRoleId, undefined);

    // 2. User with custom role assigned in DB
    mockPrisma.roles.push({
      id: 'role-limited-custom',
      name: 'Custom Limited',
      is_system: false,
      merchant_id: MERCHANT_A,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockPrisma.rolePermissions.push({
      id: 'rp-lim-1',
      role_id: 'role-limited-custom',
      permission_id: mockPrisma.permissions.find((p) => p.code === 'order:view_create').id,
    });
    mockPrisma.users.push({
      id: 'user-custom-delegated',
      merchant_id: MERCHANT_A,
      role: 'OWNER', // DB enum might say OWNER, but custom_role_id is assigned
      custom_role_id: 'role-limited-custom',
      status: 'ACTIVE',
    });

    const customReq = {
      userId: 'user-custom-delegated',
      merchantId: MERCHANT_A,
    };
    const resolvedCustom = await service.resolveActorFromSession(customReq as any);
    assert.strictEqual(resolvedCustom.customRoleId, 'role-limited-custom');

    const perms = await service.getActorPermissions(resolvedCustom);
    assert.deepStrictEqual(
      perms,
      ['order:view_create'],
      'Must enforce custom role ceiling even if role enum is OWNER'
    );

    // 3. Fail closed if user does not exist in DB
    await assert.rejects(
      async () => {
        await service.resolveActorFromSession({
          userId: 'user-non-existent',
          merchantId: MERCHANT_A,
        } as any);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );

    // 4. Fail closed on cross-tenant mismatch
    await assert.rejects(
      async () => {
        await service.resolveActorFromSession({
          userId: 'user-demoted-owner',
          merchantId: MERCHANT_B,
        } as any);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'FORBIDDEN');
        assert.strictEqual(err.getStatus(), 403);
        return true;
      }
    );
  });

  // Finding 2 (P1): Custom role read error fails closed and never falls through to broader permissions
  test('Finding 2 / BR-RBAC-02: Thrown custom-role read fails closed (503) and does not widen privileges to enum role', async () => {
    const actorWithCustomRole = {
      userId: 'user-cskh-custom',
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH', // OPS_CSKH has pii:unmask statically
      customRoleId: 'role-restricted',
    };

    // Simulate DB read failure on role.findFirst
    mockPrisma.shouldFailRoleFindFirst = true;

    await assert.rejects(
      async () => {
        await service.getActorPermissions(actorWithCustomRole);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 503);
        assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
        return true;
      }
    );
  });

  // Finding 3 (P1): Platform seed and queries do not substitute fake static rows on DB failure
  test('Finding 3 / AC-RBAC-01-01/02: Database failure throws instead of returning fake in-memory catalog', async () => {
    mockPrisma.shouldFailPermissionFindMany = true;

    await assert.rejects(
      async () => {
        await service.getPermissions('corr-fail-db');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 503);
        assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
        return true;
      }
    );
  });

  // Finding 4 (P1): Case-insensitive uniqueness inside transaction & P2002 mapping
  test('Finding 4 / BR-RBAC-05: Case-insensitive unique role name inside transaction maps to 400 ROLE_NAME_EXISTS', async () => {
    // 1. Create initial role "Admin Support"
    await service.createRole(
      {
        name: 'Admin Support',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-admin-1'
    );

    // 2. Attempt to create concurrent "admin support" (different casing)
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'admin support',
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-admin-2'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_NAME_EXISTS');
        return true;
      }
    );
  });

  // Finding 5 (P1): Role in-use safeguard inside transaction with restrict constraint
  test('Finding 5 / BR-RBAC-03: Deleting role assigned to active user fails closed inside transaction with 400 ROLE_IN_USE', async () => {
    // 1. Create a custom role
    const created = await service.createRole(
      {
        name: 'Vai Trò Nhân Viên Kho Đêm',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-role-del-1'
    );
    const roleId = created.data.role.id;

    // 2. Assign active user to this role
    mockPrisma.users.push({
      id: 'user-assigned-to-night-role',
      merchant_id: MERCHANT_A,
      role: 'CUSTOM',
      custom_role_id: roleId,
      status: 'active',
    });

    // 3. Attempt to delete role
    await assert.rejects(
      async () => {
        await service.deleteRole(roleId, OWNER_ACTOR, '127.0.0.1', 'corr-role-del-2');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        return true;
      }
    );

    // 4. Verify role is still preserved in DB
    const preserved = mockPrisma.roles.find((r) => r.id === roleId);
    assert.ok(preserved, 'Role must not be deleted when active users are assigned');
  });

  // Finding 6 (P1): Exact permission set match and resolved code ceiling check
  test('Finding 6 / AC-RBAC-01-03/08/13: Partially matching permissions reject with 400 VALIDATION_ERROR instead of dropping missing codes', async () => {
    // 1. Partial match: 1 valid code, 1 bogus code -> rejected, role NOT created
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Role With Bogus Code',
            permissions: ['order:view_create', 'invalid_bogus_code_123'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-perm-exact'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );

    // Assert role was not created
    const found = mockPrisma.roles.find((r) => r.name === 'Role With Bogus Code');
    assert.strictEqual(found, undefined, 'Must not partially save role with dropped codes');
  });
});
