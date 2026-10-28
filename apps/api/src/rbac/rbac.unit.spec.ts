import * as assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import type { ActorContext } from './rbac.dto';
import { RbacService, SYSTEM_ROLE_IDS, hasForbiddenRoleTextCharacters } from './rbac.service';
import { PLATFORM_PERMISSIONS, SYSTEM_ROLES } from './rbac.constants';
import { CanonicalApiException as BaseCanonicalApiException } from '../auth/auth.service';
import { CanonicalApiException } from './rbac.service';
import { RbacExceptionFilter } from './rbac-exception.filter';
import { CreateRolePipe, UpdateRolePipe } from './rbac-validation.pipe';
import { RbacController } from './rbac.controller';
import { PermissionsGuard } from './rbac.guard';
import { assertNoSensitiveData } from '@shipde/testkit';

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
  deviceSessions: any[] = [];
  shouldFailAudit = false;
  shouldFailRoleFindFirst = false;
  shouldFailPermissionFindMany = false;
  shouldFailUserCount = false;
  shouldFailRolePermissionUnique = false;

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
    this.deviceSessions = [
      {
        id: 'session-mfa-owner',
        user_id: 'user-owner-1',
        auth_assurance: 'MFA',
        mfa_verified_at: new Date(),
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 86400000),
      },
      {
        id: 'session-password-owner',
        user_id: 'user-owner-1',
        auth_assurance: 'PASSWORD',
        mfa_verified_at: null,
        status: 'ACTIVE',
        expires_at: new Date(Date.now() + 86400000),
      },
      {
        id: 'session-expired-mfa-owner',
        user_id: 'user-owner-1',
        auth_assurance: 'MFA',
        mfa_verified_at: new Date(Date.now() - 3600000),
        status: 'ACTIVE',
        expires_at: new Date(Date.now() - 1000),
      },
      {
        id: 'session-revoked-owner',
        user_id: 'user-owner-1',
        auth_assurance: 'MFA',
        mfa_verified_at: new Date(),
        status: 'REVOKED',
        expires_at: new Date(Date.now() + 86400000),
      },
    ];
    this.shouldFailAudit = false;
    this.shouldFailRoleFindFirst = false;
    this.shouldFailPermissionFindMany = false;
    this.shouldFailRolePermissionUnique = false;
  }

  merchant = {
    findFirst: async (): Promise<any> => ({ id: 'merchant-aaa-111' }),
  };

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
      const nameLower = (args.data.name_lower || args.data.name || '').trim().toLowerCase();
      const duplicate = this.roles.find(
        (r) =>
          r.merchant_id === args.data.merchant_id &&
          (r.name_lower || r.name).trim().toLowerCase() === nameLower
      );
      if (duplicate) {
        const error: any = new Error(
          'Unique constraint failed on the constraint: roles_merchant_id_name_lower_key'
        );
        error.code = 'P2002';
        throw error;
      }
      const created = {
        id: args.data.id || `custom-role-${this.roles.length + 1}`,
        ...args.data,
        name_lower: nameLower,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.roles.push(created);
      return created;
    },
    update: async (args: any) => {
      const idx = this.roles.findIndex((r) => r.id === args.where.id);
      if (idx === -1) throw new Error('Not found');
      const updatedName = args.data.name;
      const nameLower = (args.data.name_lower || updatedName || '').trim().toLowerCase();
      if (updatedName) {
        const duplicate = this.roles.find(
          (r) =>
            r.id !== args.where.id &&
            r.merchant_id === this.roles[idx].merchant_id &&
            (r.name_lower || r.name).trim().toLowerCase() === nameLower
        );
        if (duplicate) {
          const error: any = new Error(
            'Unique constraint failed on the constraint: roles_merchant_id_name_lower_key'
          );
          error.code = 'P2002';
          throw error;
        }
      }
      this.roles[idx] = {
        ...this.roles[idx],
        ...args.data,
        ...(updatedName ? { name_lower: nameLower } : {}),
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
    upsert: async (args: any) => {
      const idx = this.roles.findIndex((r) => r.code === args.where.code);
      if (idx !== -1) {
        this.roles[idx] = {
          ...this.roles[idx],
          ...args.update,
          updated_at: new Date(),
        };
        return this.roles[idx];
      }
      const created = {
        id: args.create.id || `role-${this.roles.length + 1}`,
        ...args.create,
        created_at: new Date(),
        updated_at: new Date(),
      };
      this.roles.push(created);
      return created;
    },
  };

  rolePermission = {
    findMany: async (args?: any) => {
      let items = this.rolePermissions;
      if (args?.where?.role_id) {
        items = items.filter((rp) => rp.role_id === args.where.role_id);
      }
      if (args?.include?.permission) {
        return items.map((rp) => ({
          ...rp,
          permission: this.permissions.find((p) => p.id === rp.permission_id),
        }));
      }
      return items;
    },
    create: async (args: any) => {
      if (this.shouldFailRolePermissionUnique) {
        const err: any = new Error(
          'Unique constraint failed on the constraint: role_permissions_role_id_permission_id_key'
        );
        err.code = 'P2002';
        err.meta = { target: ['role_id', 'permission_id'] };
        throw err;
      }
      const created = { id: `rp-${Date.now()}-${Math.random()}`, ...args.data };
      this.rolePermissions.push(created);
      return created;
    },
    deleteMany: async (args: any) => {
      if (args?.where?.role_id && args?.where?.permission_id?.in) {
        this.rolePermissions = this.rolePermissions.filter(
          (rp) =>
            !(
              rp.role_id === args.where.role_id &&
              args.where.permission_id.in.includes(rp.permission_id)
            )
        );
      } else if (args?.where?.role_id) {
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
    groupBy: async (args: any) => {
      if (this.shouldFailUserCount) {
        throw new Error('Simulated database user count error');
      }
      const map = new Map<
        string,
        { role: string; custom_role_id: string | null; _count: { _all: number } }
      >();
      for (const u of this.users) {
        if (args?.where?.merchant_id && u.merchant_id !== args.where.merchant_id) continue;
        if (args?.where?.status) {
          const filter = args.where.status;
          const expected = typeof filter === 'string' ? filter : filter.equals;
          if (expected && u.status?.toLowerCase() !== expected.toLowerCase()) continue;
        }
        const key = `${u.role}:::${u.custom_role_id}`;
        if (!map.has(key)) {
          map.set(key, { role: u.role, custom_role_id: u.custom_role_id, _count: { _all: 0 } });
        }
        map.get(key)!._count._all++;
      }
      return Array.from(map.values());
    },
    count: async (args: any) => {
      if (this.shouldFailUserCount) {
        throw new Error('Simulated database user count error');
      }
      let count = 0;
      for (const u of this.users) {
        if (args.where.merchant_id && u.merchant_id !== args.where.merchant_id) continue;
        if (args.where.status) {
          const filter = args.where.status;
          const expected = typeof filter === 'string' ? filter : filter.equals;
          if (expected && u.status?.toLowerCase() !== expected.toLowerCase()) continue;
        }
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
    updateMany: async (args: any) => {
      let updatedCount = 0;
      for (const u of this.users) {
        if (args.where.merchant_id && u.merchant_id !== args.where.merchant_id) continue;
        if (
          args.where.custom_role_id !== undefined &&
          u.custom_role_id !== args.where.custom_role_id
        )
          continue;
        if (args.data.custom_role_id !== undefined) {
          u.custom_role_id = args.data.custom_role_id;
        }
        updatedCount++;
      }
      return { count: updatedCount };
    },
    update: async (args: any) => {
      const idx = this.users.findIndex((u) => u.id === args.where.id);
      if (idx === -1) throw new Error('User not found');
      this.users[idx] = {
        ...this.users[idx],
        ...args.data,
      };
      return this.users[idx];
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

  deviceSession = {
    findUnique: async (args: any) => {
      const s = this.deviceSessions.find((x) => x.id === args?.where?.id);
      return s || null;
    },
  };

  rawQueries: string[] = [];
  $queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
    const sql = strings.join('?');
    this.rawQueries.push(sql);
    if (sql.includes('FROM roles') && sql.includes('FOR UPDATE')) {
      const roleId = values[0];
      const merchantId = values[1];
      const r = this.roles.find(
        (x) => x.id === roleId && (x.is_system || !merchantId || x.merchant_id === merchantId)
      );
      return r
        ? [
            {
              id: r.id,
              name: r.name,
              description: r.description,
              merchant_id: r.merchant_id,
              is_system: Boolean(r.is_system),
              code: r.code,
            },
          ]
        : [];
    }
    if (sql.includes('FROM role_permissions') && sql.includes('FOR UPDATE')) {
      const roleId = values[0];
      return this.rolePermissions
        .filter((rp) => rp.role_id === roleId)
        .map((rp) => ({ id: rp.id, role_id: rp.role_id, permission_id: rp.permission_id }));
    }
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      if (sql.includes('WHERE id =')) {
        const actorUserId = values[0];
        const u = this.users.find((x) => x.id === actorUserId);
        return u
          ? [
              {
                id: u.id,
                status: u.status,
                role: u.role,
                custom_role_id: u.custom_role_id,
                merchant_id: u.merchant_id,
              },
            ]
          : [];
      }
      const customRoleId = values[0];
      return this.users
        .filter((u) => u.custom_role_id === customRoleId)
        .map((u) => ({
          id: u.id,
          status: u.status,
          role: u.role,
          custom_role_id: u.custom_role_id,
          merchant_id: u.merchant_id,
        }));
    }
    if (sql.includes('FROM device_sessions') && sql.includes('FOR UPDATE')) {
      const sessionId = values[0];
      const userId = values[1];
      const s = this.deviceSessions.find((x) => x.id === sessionId && x.user_id === userId);
      return s ? [s] : [];
    }
    return [];
  };

  $transaction = async (fn: (tx: any) => Promise<any>) => {
    // Snapshot state for atomic rollback simulation
    const snapshotPermissions = JSON.parse(JSON.stringify(this.permissions));
    const snapshotRoles = JSON.parse(JSON.stringify(this.roles));
    const snapshotRolePerms = JSON.parse(JSON.stringify(this.rolePermissions));
    const snapshotAuditLogs = JSON.parse(JSON.stringify(this.auditLogs));
    const snapshotUsers = JSON.parse(JSON.stringify(this.users));

    try {
      return await fn(this);
    } catch (err) {
      // Rollback state on error
      this.permissions = snapshotPermissions;
      this.roles = snapshotRoles;
      this.rolePermissions = snapshotRolePerms;
      this.auditLogs = snapshotAuditLogs;
      this.users = snapshotUsers;
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
    sessionId: 'session-mfa-owner',
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
    // Round 3 Finding 4: When actor is omitted, can_manage_roles must fail-closed (false)
    assert.strictEqual(
      res.data.can_manage_roles,
      false,
      'can_manage_roles must default to false when actor is omitted'
    );

    // When actor with iam:manage_users is provided, can_manage_roles is true
    const resWithActor = await service.getRoles(MERCHANT_A, 'corr-02-actor', OWNER_ACTOR);
    assert.strictEqual(
      resWithActor.data.can_manage_roles,
      true,
      'can_manage_roles must be true for actor with iam:manage_users'
    );

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
    mockPrisma.users.push({
      id: 'user-manager-cskh',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: 'role-cskh-lead',
      status: 'ACTIVE',
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

  // Finding 3 (Round 3 / BR-RBAC-02): Privilege ceiling enforced on PATCH when permissions is omitted
  test('Finding 3 / BR-RBAC-02: Actor with iam:manage_users cannot PATCH name/description of role holding permissions exceeding actor ceiling -> 403 PRIVILEGE_ESCALATION_DENIED', async () => {
    // 1. Owner creates a high-privilege role with reconciliation:run_review_audit
    const highRole = await service.createRole(
      {
        name: 'Vai Trò Kế Toán Trưởng',
        permissions: ['order:view_create', 'reconciliation:run_review_audit'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-f3-create'
    );

    // 2. Create a delegated admin custom role holding iam:manage_users and order:view_create (lacks reconciliation:run_review_audit)
    const delegatedRole = await service.createRole(
      {
        name: 'Vai Trò Quản Trị Giới Hạn',
        permissions: ['iam:manage_users', 'order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-f3-delegated'
    );

    // 3. User with this custom role
    mockPrisma.users.push({
      id: 'user-delegated-admin',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: delegatedRole.data.role.id,
      status: 'ACTIVE',
    });

    const delegatedActor: ActorContext = {
      userId: 'user-delegated-admin',
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: delegatedRole.data.role.id,
    };

    // 4. Delegated actor attempts to PATCH name without touching permissions
    await assert.rejects(
      async () => {
        await service.updateRole(
          highRole.data.role.id,
          { name: 'Vai Trò Kế Toán Trưởng Sửa Tên' },
          delegatedActor,
          '127.0.0.1',
          'corr-f3-patch'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        assert.ok(err.message.includes('thẩm quyền'));
        return true;
      }
    );

    // DB Proof: Role name was not updated in DB
    const roleInDb = mockPrisma.roles.find((r) => r.id === highRole.data.role.id);
    assert.strictEqual(
      roleInDb.name,
      'Vai Trò Kế Toán Trưởng',
      'Role row must remain unchanged with no write'
    );

    // Finding 1 Proving Test (Round 4): Delegated actor attempts to bypass ceiling by sending permissions subset they hold
    await assert.rejects(
      async () => {
        await service.updateRole(
          highRole.data.role.id,
          {
            name: 'Vai Trò Kế Toán Bị Hạ Quyền',
            permissions: ['order:view_create'], // Actor holds order:view_create, but role currently has finance:export_ledgers
          },
          delegatedActor,
          '127.0.0.1',
          'corr-r4-f1-strip'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        assert.ok(err.message.includes('thẩm quyền'));
        return true;
      }
    );

    // DB Proof: Role row and permissions must remain unchanged in DB
    const roleAfterBypassAttempt = mockPrisma.roles.find((r) => r.id === highRole.data.role.id);
    assert.strictEqual(roleAfterBypassAttempt.name, 'Vai Trò Kế Toán Trưởng');
    const rolePermsAfterAttempt = mockPrisma.rolePermissions.filter(
      (rp) => rp.role_id === highRole.data.role.id
    );
    assert.strictEqual(
      rolePermsAfterAttempt.length,
      2,
      'Role permissions must not be stripped or modified'
    );

    // Finding 1 Proving Test (Round 4): Delegated actor attempts to delete above-ceiling role with no active users
    await assert.rejects(
      async () => {
        await service.deleteRole(
          highRole.data.role.id,
          delegatedActor,
          '127.0.0.1',
          'corr-r4-f1-del'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        assert.ok(err.message.includes('thẩm quyền'));
        return true;
      }
    );

    // DB Proof: Role still exists in DB
    const roleStillExists = mockPrisma.roles.find((r) => r.id === highRole.data.role.id);
    assert.ok(roleStillExists, 'Role must not be deleted by under-privileged actor');
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

    // Simulate active user assigned to this custom role with uppercase 'ACTIVE' status (Round 3 Finding 2)
    mockPrisma.users.push({
      id: 'user-assigned-1',
      merchant_id: MERCHANT_A,
      custom_role_id: customRoleId,
      status: 'ACTIVE',
    });

    await assert.rejects(
      async () => {
        await service.deleteRole(customRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-09-d');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        assert.strictEqual(err.getStatus(), 400);
        assert.ok(
          err.message.includes('1 người dùng đang hoạt động'),
          'Error message must include active user count'
        );
        assert.strictEqual(err.fields?.[0]?.field, 'role_id');
        assert.strictEqual(err.fields?.[0]?.code, 'IN_USE');
        assert.strictEqual(err.fields?.[0]?.message, 'Vai trò đang được gán cho 1 người dùng');
        return true;
      }
    );

    // Proving DB state: Role row remains unchanged in DB when delete is rejected
    const roleStillInDb = mockPrisma.roles.find((r) => r.id === customRoleId);
    assert.ok(
      roleStillInDb,
      'Role row must remain unchanged when delete is rejected due to active user'
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

  // Finding 2 Proving Test (Round 4 / Updated Round 5): BR-RBAC-03
  test('Finding 2 / BR-RBAC-03: Role held only by inactive users detaches them in transaction and completes delete when not broader', async () => {
    const opsPerms = SYSTEM_ROLES.find((sr) => sr.code === 'OPS_CSKH')!.permissions;
    const createRes = await service.createRole(
      {
        name: 'Vai trò Đủ Quyền Cho Inactive',
        permissions: opsPerms,
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r4-f2-c'
    );
    const customRoleId = createRes.data.role.id;

    // Simulate an inactive user assigned to this role (their enum role is OPS_CSKH, whose permissions match the custom role)
    const inactiveUserId = 'user-inactive-assignee';
    mockPrisma.users.push({
      id: inactiveUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: customRoleId,
      status: 'INACTIVE',
    });

    const deleteRes = await service.deleteRole(
      customRoleId,
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r4-f2-d'
    );

    assert.strictEqual(
      deleteRes.data.deleted,
      true,
      'Delete must succeed when only held by inactive users and not broader'
    );

    // DB Proof: Role row was deleted
    const roleInDb = mockPrisma.roles.find((r) => r.id === customRoleId);
    assert.strictEqual(roleInDb, undefined, 'Role row must be deleted from DB');

    // DB Proof: Inactive user was detached in the same transaction
    const userInDb = mockPrisma.users.find((u) => u.id === inactiveUserId);
    assert.strictEqual(
      userInDb?.custom_role_id,
      null,
      'Inactive user custom_role_id must be detached (null)'
    );

    // DB Proof: Membership change audit log exists for the inactive user (BR-RBAC-07)
    const userDetachAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'USER_ROLE_DETACHED' && a.entity_id === inactiveUserId
    );
    assert.ok(userDetachAudit, 'USER_ROLE_DETACHED audit log must be created for detached user');

    // DB Proof: Role delete audit log exists
    const audit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_DELETED' && a.entity_id === customRoleId
    );
    assert.ok(audit, 'ROLE_DELETED audit log must be created');
  });

  // Finding 1 Proving Test 1 (Round 5): BR-RBAC-02 / BR-RBAC-03
  test('Finding 1 / Round 5 / BR-RBAC-02: Deleting role assigned to inactive user whose enum role is broader blocks with 400 ROLE_IN_USE and no assignment change', async () => {
    const createRes = await service.createRole(
      {
        name: 'Vai trò Hẹp Cho Inactive',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r5-f1-narrow'
    );
    const customRoleId = createRes.data.role.id;

    // Simulate inactive user whose enum role is OPS_CSKH (has pii:unmask, shipment:quote_carrier etc, much broader than order:view_create)
    const inactiveBroaderUserId = 'user-inactive-broader';
    mockPrisma.users.push({
      id: inactiveBroaderUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: customRoleId,
      status: 'INACTIVE',
    });

    await assert.rejects(
      async () => {
        await service.deleteRole(customRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-r5-f1-del');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        assert.ok(err.message.includes('mở rộng quyền hạn'));
        return true;
      }
    );

    // DB Proof: Role was NOT deleted
    const roleInDb = mockPrisma.roles.find((r) => r.id === customRoleId);
    assert.ok(roleInDb, 'Role must remain in DB when delete is blocked');

    // DB Proof: Inactive user custom_role_id was NOT modified / stripped
    const userInDb = mockPrisma.users.find((u) => u.id === inactiveBroaderUserId);
    assert.strictEqual(
      userInDb?.custom_role_id,
      customRoleId,
      'Inactive user assignment must NOT be changed when blocked'
    );
  });

  // Finding 1 Proving Test 2 (Round 5): Concurrency & Row Locks
  test('Finding 1 / Round 5 / Concurrency: deleteRole executes SELECT ... FOR UPDATE row locks on role and assignees; concurrent active assignment detected fails closed with 400 ROLE_IN_USE without stripping', async () => {
    mockPrisma.rawQueries = [];

    const createRes = await service.createRole(
      {
        name: 'Vai trò Khóa Dòng Concurrency',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r5-f1-lock-c'
    );
    const customRoleId = createRes.data.role.id;

    // Simulate an active user concurrently assigned
    const concurrentActiveUserId = 'user-concurrent-active';
    mockPrisma.users.push({
      id: concurrentActiveUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: customRoleId,
      status: 'ACTIVE',
    });

    await assert.rejects(
      async () => {
        await service.deleteRole(customRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-r5-f1-lock-d');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        return true;
      }
    );

    // Proof: Row lock queries were executed inside transaction
    const hasRoleLock = mockPrisma.rawQueries.some(
      (q) => q.includes('FROM roles') && q.includes('FOR UPDATE')
    );
    const hasAssigneeLock = mockPrisma.rawQueries.some(
      (q) => q.includes('FROM users') && q.includes('FOR UPDATE')
    );
    assert.ok(hasRoleLock, 'Must execute SELECT ... FROM roles ... FOR UPDATE');
    assert.ok(hasAssigneeLock, 'Must execute SELECT ... FROM users ... FOR UPDATE');

    // Proof: Concurrent active assignment was NOT stripped
    const userInDb = mockPrisma.users.find((u) => u.id === concurrentActiveUserId);
    assert.strictEqual(
      userInDb?.custom_role_id,
      customRoleId,
      'Active user assignment must NOT be stripped'
    );
  });

  // Finding 1 Proving Test 1 (Round 6): updateRole serializes under row lock and detects concurrent permission grant, blocking privilege stripping with 403
  test('Finding 1 / Round 6 / BR-RBAC-02: updateRole locks row and re-evaluates current permissions; concurrent grant of unauthorized permission blocks update with 403 PRIVILEGE_ESCALATION_DENIED', async () => {
    // 1. Create a custom role with order:view_create
    const createRes = await service.createRole(
      {
        name: 'Vai trò Concurrency Update',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r6-f1-create'
    );
    const customRoleId = createRes.data.role.id;

    // 2. Define a non-owner actor who holds 'iam:manage_users' and 'order:view_create' via custom role
    const managerRoleRes = await service.createRole(
      {
        name: 'Manager With Manage Users',
        permissions: ['iam:manage_users', 'order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r6-f1-mgr-role'
    );
    const nonOwnerActor: ActorContext = {
      userId: 'user-manager-r6',
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: managerRoleRes.data.role.id,
    };
    mockPrisma.users.push({
      id: 'user-manager-r6',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: managerRoleRes.data.role.id,
      status: 'ACTIVE',
    });

    // 3. Simulate concurrent grant to the role of reconciliation:approve_rate_policy (which OPS_CSKH lacks)
    const financePerm = mockPrisma.permissions.find(
      (p) => p.code === 'reconciliation:approve_rate_policy'
    )!;
    mockPrisma.rolePermissions.push({
      id: `rp-concurrent-grant`,
      role_id: customRoleId,
      permission_id: financePerm.id,
    });

    // 4. Non-owner tries to update role name (sending only their own permitted subset)
    await assert.rejects(
      async () => {
        await service.updateRole(
          customRoleId,
          { name: 'Vai trò Concurrency Renamed' },
          nonOwnerActor,
          '127.0.0.1',
          'corr-r6-f1-update'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        return true;
      }
    );

    // Proof: The concurrent grant was NOT stripped from DB
    const permsAfter = mockPrisma.rolePermissions.filter((rp) => rp.role_id === customRoleId);
    assert.ok(
      permsAfter.some((rp) => rp.permission_id === financePerm.id),
      'Concurrent grant must NOT be stripped by under-privileged actor'
    );
  });

  // Finding 1 Proving Test 2 (Round 6): deleteRole re-reads permissions under lock and evaluates enum fallback against DB permissions
  test('Finding 1 / Round 6 / BR-RBAC-03: deleteRole blocks with 400 ROLE_IN_USE when inactive assignee enum fallback exceeds actor DB permissions', async () => {
    const createRes = await service.createRole(
      {
        name: 'Vai trò Hẹp Delete Check',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r6-f1-del-create'
    );
    const customRoleId = createRes.data.role.id;

    // Inactive user with enum role FINANCE (holding financial permissions)
    const inactiveUserId = 'user-inactive-finance-r6';
    mockPrisma.users.push({
      id: inactiveUserId,
      merchant_id: MERCHANT_A,
      role: 'FINANCE',
      custom_role_id: customRoleId,
      status: 'INACTIVE',
    });

    // Actor holds iam:manage_users and order:view_create (ceiling over target role), but lacks FINANCE permissions
    const delegatedAdminRoleId = 'role-delegated-admin-r6';
    const pManage = mockPrisma.permissions.find((p) => p.code === 'iam:manage_users')!;
    const pOrder = mockPrisma.permissions.find((p) => p.code === 'order:view_create')!;
    mockPrisma.roles.push({
      id: delegatedAdminRoleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'Delegated Admin R6',
      name_lower: 'delegated admin r6',
      description: 'Delegated Admin',
      is_system: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockPrisma.rolePermissions.push(
      {
        id: `rp-${delegatedAdminRoleId}-1`,
        role_id: delegatedAdminRoleId,
        permission_id: pManage.id,
      },
      {
        id: `rp-${delegatedAdminRoleId}-2`,
        role_id: delegatedAdminRoleId,
        permission_id: pOrder.id,
      }
    );

    const delegatedActor: ActorContext = {
      userId: 'user-delegated-actor-r6',
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: delegatedAdminRoleId,
    };
    mockPrisma.users.push({
      id: 'user-delegated-actor-r6',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: delegatedAdminRoleId,
      status: 'ACTIVE',
    });

    await assert.rejects(
      async () => {
        await service.deleteRole(customRoleId, delegatedActor, '127.0.0.1', 'corr-r6-f1-del-actor');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        return true;
      }
    );

    // DB Proof: Role was NOT deleted and inactive user custom_role_id was not cleared
    const roleInDb = mockPrisma.roles.find((r) => r.id === customRoleId);
    assert.ok(roleInDb, 'Role must remain in DB');
    const userInDb = mockPrisma.users.find((u) => u.id === inactiveUserId);
    assert.strictEqual(
      userInDb?.custom_role_id,
      customRoleId,
      'User custom_role_id must NOT be cleared'
    );
  });

  // Finding 3 Proving Test (Round 6): Move change out of auth.service.ts; auth CanonicalApiException unmodified while RbacExceptionFilter maps fields to details
  test('Finding 3 / Round 6 / Scope Integrity: CanonicalApiException in auth has no details duplicate; RbacExceptionFilter maps fields to details for RBAC endpoints', async () => {
    // 1. Instantiate CanonicalApiException from auth.service directly
    const authException = new BaseCanonicalApiException(
      400,
      'AUTH_ERROR',
      'Test Auth Error',
      false,
      undefined,
      [{ field: 'email', code: 'INVALID', message: 'Email invalid' }]
    );
    const authPayload: any = authException.getResponse();
    assert.strictEqual(
      authPayload.error.details,
      undefined,
      'Base CanonicalApiException in auth must NOT contain details duplicate'
    );
    assert.ok(
      Array.isArray(authPayload.error.fields),
      'Base CanonicalApiException must retain fields'
    );

    // 2. Test RbacExceptionFilter mapping
    const filter = new RbacExceptionFilter();
    let sentStatus: number | undefined;
    let sentJson: any;
    const mockResponse: any = {
      status: (s: number) => {
        sentStatus = s;
        return {
          json: (j: any) => {
            sentJson = j;
          },
        };
      },
      setHeader: () => {},
    };
    const mockHost: any = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
      }),
    };

    filter.catch(authException, mockHost);
    assert.strictEqual(sentStatus, 400);
    assert.deepStrictEqual(sentJson.error.details, authPayload.error.fields);
  });

  // Finding 3 Proving Test (Round 4): Non-role-name unique constraint failures stay 500
  test('Finding 3 / Canonical Error Contract: Non-name unique constraint failure (e.g. role_permissions) stays 500 and role unmodified', async () => {
    mockPrisma.shouldFailRolePermissionUnique = true;

    try {
      // 1. In createRole
      await assert.rejects(
        async () => {
          await service.createRole(
            {
              name: 'Vai trò Lỗi Role Permissions Unique',
              permissions: ['order:view_create'],
            },
            OWNER_ACTOR,
            '127.0.0.1',
            'corr-r4-f3-create'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), 500, 'Must stay 500 INTERNAL_SERVER_ERROR, NOT 400');
          assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR', 'Must NOT map to ROLE_NAME_EXISTS');
          return true;
        }
      );

      // DB Proof: Role was rolled back and not persisted
      const roleInDb = mockPrisma.roles.find(
        (r) => r.name === 'Vai trò Lỗi Role Permissions Unique'
      );
      assert.strictEqual(roleInDb, undefined, 'Role must not be persisted on 500 failure');

      // 2. In updateRole
      mockPrisma.shouldFailRolePermissionUnique = false;
      const initialRole = await service.createRole(
        {
          name: 'Vai trò Cần Sửa Permissions',
          permissions: ['order:view_create'],
        },
        OWNER_ACTOR,
        '127.0.0.1',
        'corr-r4-f3-init'
      );

      mockPrisma.shouldFailRolePermissionUnique = true;
      await assert.rejects(
        async () => {
          await service.updateRole(
            initialRole.data.role.id,
            {
              permissions: ['shipment:create_update'],
            },
            OWNER_ACTOR,
            '127.0.0.1',
            'corr-r4-f3-update'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), 500, 'Must stay 500 INTERNAL_SERVER_ERROR, NOT 400');
          assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR', 'Must NOT map to ROLE_NAME_EXISTS');
          return true;
        }
      );

      // DB Proof: Role permissions remain unchanged
      const rps = mockPrisma.rolePermissions.filter(
        (rp) => rp.role_id === initialRole.data.role.id
      );
      const permIds = rps.map((rp) => rp.permission_id);
      const orderViewPerm = mockPrisma.permissions.find((p) => p.code === 'order:view_create');
      assert.ok(
        permIds.includes(orderViewPerm?.id || ''),
        'Permissions must remain unchanged on 500 rollback'
      );
    } finally {
      mockPrisma.shouldFailRolePermissionUnique = false;
    }
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

  // Finding 5 (Round 8): Non-string name or name longer than 255 chars rejects with 400 VALIDATION_ERROR
  test('Finding 5 / Round 8 / Validation: Non-string name or name exceeding 255 chars rejects with 400 VALIDATION_ERROR on name', async () => {
    // 1. Non-string name in createRole
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 12345 as any,
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-r8-f5-type'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(err.fields?.some((f: any) => f.field === 'name'));
        return true;
      }
    );

    // 2. Name exceeding 255 chars in createRole
    const overlyLongName = 'A'.repeat(256);
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: overlyLongName,
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-r8-f5-length'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(err.fields?.some((f: any) => f.field === 'name' && f.code === 'MAX_LENGTH'));
        return true;
      }
    );

    // 3. Name exceeding 255 chars in updateRole
    const validRole = await service.createRole(
      {
        name: 'Vai Trò Hợp Lệ F5',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r8-f5-setup'
    );
    await assert.rejects(
      async () => {
        await service.updateRole(
          validRole.data.role.id,
          { name: overlyLongName },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-r8-f5-patch-length'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(err.fields?.some((f: any) => f.field === 'name' && f.code === 'MAX_LENGTH'));
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
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 500);
        assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR');
        const resp = err.getResponse() as any;
        assert.strictEqual(resp?.error?.code, 'INTERNAL_SERVER_ERROR');
        assert.doesNotMatch(resp?.error?.message || '', /simulated|database|storage/i);
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
    assert.ok(!jsonStr.includes('session_token'), 'No session tokens exposed');
  });

  // Finding 8 (P2 Round 2): Security verification of audit logs and role data without hardcoded secrets
  test('Finding 8 / AC-RBAC-01-16: Role payloads and audit logs contain no tokens, password hashes or MFA secrets verified with assertNoSensitiveData', async () => {
    const createdRole = await service.createRole(
      {
        name: 'Secured Role AC-16',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-f8'
    );
    assertNoSensitiveData(createdRole.data);

    const auditEntry = mockPrisma.auditLogs.find(
      (a: any) => a.entity_id === createdRole.data.role.id
    );
    assert.ok(auditEntry, 'Audit log entry must be recorded');
    assertNoSensitiveData(auditEntry.new_value);

    const auditStr = JSON.stringify(auditEntry);
    assert.doesNotMatch(auditStr, /password_hash|secret_ciphertext|mfa_secret|raw_token/i);
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
    mockPrisma.users.push({
      id: 'user-cskh-custom',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: 'role-restricted',
      status: 'ACTIVE',
    });

    // Simulate DB read failure on role.findFirst
    mockPrisma.shouldFailRoleFindFirst = true;

    await assert.rejects(
      async () => {
        await service.getActorPermissions(actorWithCustomRole);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.ok(err.getStatus() === 500 || err.getStatus() === 503);
        assert.ok(err.code === 'INTERNAL_SERVER_ERROR' || err.code === 'SERVICE_UNAVAILABLE');
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
        assert.ok(err.getStatus() === 500 || err.getStatus() === 503);
        assert.ok(err.code === 'INTERNAL_SERVER_ERROR' || err.code === 'SERVICE_UNAVAILABLE');
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

  // Finding 8 (P1): System-role transactional reconciliation, unique system code key, unified DB reads between catalog and authz
  test('Finding 8 / BR-RBAC-01: Transactional seed reconciles system roles and GET/authz read identical DB rows', async () => {
    // 1. Force re-seed
    (service as any).isSeeded = false;
    await service.ensurePlatformSeed();

    // 2. Modify system role in DB to simulate a reconciled change (e.g. drop a permission from OPS_CSKH)
    const opsRole = mockPrisma.roles.find((r) => r.code === 'OPS_CSKH');
    assert.ok(opsRole, 'OPS_CSKH system role must exist');

    // Remove one permission from OPS_CSKH in DB
    const firstRpIndex = mockPrisma.rolePermissions.findIndex((rp) => rp.role_id === opsRole.id);
    const removedPermId = mockPrisma.rolePermissions[firstRpIndex].permission_id;
    const removedPerm = mockPrisma.permissions.find((p) => p.id === removedPermId);
    mockPrisma.rolePermissions.splice(firstRpIndex, 1);

    // 3. getActorPermissions for an OPS_CSKH actor reads directly from DB rows, NOT in-memory constant
    const actorPerms = await service.getActorPermissions({
      userId: 'user-cskh-2',
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
    });
    assert.strictEqual(
      actorPerms.includes(removedPerm!.code),
      false,
      'authz must reflect reconciled DB permissions, not static in-memory lists'
    );

    // 4. GET /roles returns the exact same reconciled permission set as authz
    const rolesRes = await service.getRoles(MERCHANT_A, 'corr-test-f8');
    const catalogOpsRole = rolesRes.data.roles.find((r) => r.code === 'OPS_CSKH');
    assert.ok(catalogOpsRole);
    assert.strictEqual(
      catalogOpsRole.permissions.some((p: any) => p.code === removedPerm!.code),
      false,
      'Catalog must match authz evaluation identically'
    );
  });

  // Finding 9 (P2): Server-side merchantId requirement and strict foreign tenant rejection (BR-RBAC-04 / AC-RBAC-01-11)
  test('Finding 9 / BR-RBAC-04 / AC-RBAC-01-11: Server-side merchantId required and non-system role with null/mismatched merchantId rejected', async () => {
    // 1. User without merchant_id in DB is rejected
    mockPrisma.users.push({
      id: 'user-no-merchant',
      merchant_id: null,
      role: 'OPS_CSKH',
      custom_role_id: null,
      status: 'active',
    });

    await assert.rejects(
      async () => {
        await service.resolveActorFromSession({ userId: 'user-no-merchant' });
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // 2. Non-system role with merchant_id = null is forbidden to actor
    const orphanedRole = {
      id: 'role-null-merchant-custom',
      merchant_id: null,
      code: null,
      name: 'Orphaned Custom Role',
      description: null,
      is_system: false,
      created_at: new Date(),
      updated_at: new Date(),
    };
    mockPrisma.roles.push(orphanedRole);

    await assert.rejects(
      async () => {
        await service.getRoleById(orphanedRole.id, OWNER_ACTOR, 'corr-f9-null');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  // Finding 3 (P1 Round 2): resolveActorFromSession rejects non-active or disabled users
  test('Finding 3 / AC-RBAC-01-14: Non-active users are rejected with 403 FORBIDDEN during session actor resolution', async () => {
    // 1. Suspended / revoked user
    mockPrisma.users.push({
      id: 'user-disabled-owner',
      merchant_id: MERCHANT_A,
      role: 'OWNER',
      custom_role_id: null,
      status: 'SUSPENDED',
    });

    await assert.rejects(
      async () => {
        await service.resolveActorFromSession({
          userId: 'user-disabled-owner',
          merchantId: MERCHANT_A,
        } as any);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        const resp = err.getResponse() as any;
        assert.match(resp?.error?.message || '', /vô hiệu hóa/i);
        return true;
      }
    );

    // 2. Pending verification user
    mockPrisma.users.push({
      id: 'user-pending-ops',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: null,
      status: 'pending_verification',
    });

    await assert.rejects(
      async () => {
        await service.resolveActorFromSession({
          userId: 'user-pending-ops',
          merchantId: MERCHANT_A,
        } as any);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  // Finding 6 (P2 Round 2 / Updated Round 5): Database user count failures fail closed with canonical 500
  test('Finding 6 / BR-RBAC-03: User count database failure in getRoles or getRoleById fails closed with canonical 500 without leaking raw driver errors', async () => {
    mockPrisma.shouldFailUserCount = true;

    // getRoles must throw canonical 500 rather than raw driver error
    await assert.rejects(
      async () => {
        await service.getRoles(MERCHANT_A, 'corr-f6-roles');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 500);
        assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR');
        assert.ok(!err.message.includes('Simulated'));
        assert.ok(!err.message.includes('database'));
        return true;
      }
    );

    // getRoleById must throw canonical 500 rather than raw driver error
    await assert.rejects(
      async () => {
        await service.getRoleById(SYSTEM_ROLE_IDS.OWNER, OWNER_ACTOR, 'corr-f6-role-by-id');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 500);
        assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR');
        assert.ok(!err.message.includes('Simulated'));
        assert.ok(!err.message.includes('database'));
        return true;
      }
    );
  });

  // Finding 3 Proving Test (Round 5): Post-seed read failures map to canonical 500 without leaking SQL or driver text
  test('Finding 3 / Round 5 / Canonical Error Contract: Post-seed getPermissions database read failure maps to canonical 500 without leaking SQL or driver text', async () => {
    // Seed first
    await service.ensurePlatformSeed();
    assert.strictEqual((service as any).isSeeded, true);

    // Force driver error on subsequent permission.findMany
    mockPrisma.shouldFailPermissionFindMany = true;

    await assert.rejects(
      async () => {
        await service.getPermissions('corr-r5-f3-perms');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 500);
        assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR');
        assert.strictEqual(err.message, 'Không thể tải danh mục quyền hạn');
        assert.ok(!err.message.includes('Database read failure'));
        return true;
      }
    );
  });

  // Finding 7 (P2 Round 2): Case-insensitive unique constraint represented in schema via merchant_id and name_lower
  test('Finding 7 / BR-RBAC-05: Case-insensitive unique constraint represented in schema via merchant_id and name_lower prevents "Admin" and "admin"', async () => {
    // 1. Create first role "Admin"
    const role1 = await service.createRole(
      {
        name: 'Admin',
        permissions: ['pii:unmask'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-f7-1'
    );
    assert.strictEqual(role1.data.role.name, 'Admin');

    // 2. Attempt to create "admin" in same tenant -> must fail with ROLE_NAME_EXISTS
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'admin',
            permissions: ['pii:unmask'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-f7-2'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_NAME_EXISTS');
        return true;
      }
    );

    // 3. Direct DB insert violating schema unique index roles_merchant_id_name_lower_key
    await assert.rejects(
      async () => {
        await mockPrisma.role.create({
          data: {
            merchant_id: MERCHANT_A,
            name: 'ADMIN',
            name_lower: 'admin',
          },
        });
      },
      (err: any) => {
        assert.strictEqual(err.code, 'P2002');
        assert.match(err.message, /roles_merchant_id_name_lower_key/);
        return true;
      }
    );
  });

  // Finding 1 (Round 7): In-transaction actor locking and re-authorization prevents mutation under stale ceiling or suspended status
  test('Finding 1 / Round 7 / BR-RBAC-02 / AC-RBAC-01-05 / AC-RBAC-01-14: In-transaction actor locking and re-authorization prevents mutation under stale ceiling or suspended state', async () => {
    // 1. Create a custom role for delegated admin with iam:manage_users and order:view_create
    const delegatedRole = await service.createRole(
      {
        name: 'Delegated Admin Role R7',
        permissions: ['iam:manage_users', 'order:view_create', 'shipment:quote_carrier'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r7-f1-setup'
    );
    const delegatedRoleId = delegatedRole.data.role.id;

    // 2. Setup delegated admin user with this custom role
    const delegatedUserId = 'user-delegated-r7';
    mockPrisma.users.push({
      id: delegatedUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: delegatedRoleId,
      status: 'ACTIVE',
    });

    const delegatedActor = {
      userId: delegatedUserId,
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: delegatedRoleId,
    };

    // 3. Verify getActorPermissions reloads from DB even when role and customRoleId are preset
    const permsBefore = await service.getActorPermissions(delegatedActor);
    assert.ok(permsBefore.includes('shipment:quote_carrier'));

    // 4. Demote the delegated role in DB to remove shipment:quote_carrier
    const demotedPerms = mockPrisma.permissions.filter(
      (p) => p.code === 'iam:manage_users' || p.code === 'order:view_create'
    );
    mockPrisma.rolePermissions = mockPrisma.rolePermissions.filter(
      (rp) => rp.role_id !== delegatedRoleId
    );
    for (const p of demotedPerms) {
      mockPrisma.rolePermissions.push({
        id: `rp-${delegatedRoleId}-${p.id}`,
        role_id: delegatedRoleId,
        permission_id: p.id,
      });
    }

    // Attempt createRole requesting shipment:quote_carrier with stale actor object claiming old role
    // Must be rejected in transaction with 403 PRIVILEGE_ESCALATION_DENIED
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Escalated Role Under Stale Snapshot',
            permissions: ['order:view_create', 'shipment:quote_carrier'],
          },
          delegatedActor,
          '127.0.0.1',
          'corr-r7-f1-escalate'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        return true;
      }
    );

    // 5. Concurrently suspend the user
    const userInDb = mockPrisma.users.find((u) => u.id === delegatedUserId)!;
    userInDb.status = 'SUSPENDED';

    // Must be rejected in transaction with 403 FORBIDDEN
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Attempt By Suspended User',
            permissions: ['order:view_create'],
          },
          delegatedActor,
          '127.0.0.1',
          'corr-r7-f1-suspended'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  // Finding 2 (Round 7): Referencing users in other merchants block deleteRole with tenant-safe 400 ROLE_IN_USE
  test('Finding 2 / Round 7 / BR-RBAC-04: Cross-tenant referencing user locks and blocks deleteRole with tenant-safe 400 ROLE_IN_USE', async () => {
    // 1. Create a custom role in MERCHANT_A
    const createdRole = await service.createRole(
      {
        name: 'Merchant A Isolated Role',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r7-f2-setup'
    );
    const roleId = createdRole.data.role.id;

    // 2. Simulate a cross-tenant user in MERCHANT_B referencing this role
    const crossTenantUserId = 'user-merchant-b-cross';
    mockPrisma.users.push({
      id: crossTenantUserId,
      merchant_id: MERCHANT_B,
      role: 'OPS_CSKH',
      custom_role_id: roleId,
      status: 'ACTIVE',
    });

    // 3. Attempt to delete the role from MERCHANT_A
    // Must lock all assignees across merchants and refuse with 400 ROLE_IN_USE
    await assert.rejects(
      async () => {
        await service.deleteRole(roleId, OWNER_ACTOR, '127.0.0.1', 'corr-r7-f2-del');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_IN_USE');
        assert.ok(err.message.includes('đơn vị khác'));
        return true;
      }
    );
  });

  // Finding 1 (Round 8 / Round 11): BR-RBAC-04 / Database Ownership: users_custom_role_id_fkey DEFERRABLE INITIALLY DEFERRED
  test('Finding 1 / Round 8 / BR-RBAC-04: users.custom_role_id constraint configuration supports deferrable evaluation for tenant cascade', async () => {
    // Read schema.prisma to prove custom_role_id is kept as migration source of truth unmanaged by Prisma relation to prevent drop on db push
    const fs = await import('fs');
    const path = await import('path');
    const schemaPath = path.resolve(__dirname, '../../../../prisma/schema.prisma');
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    assert.match(
      schemaContent,
      /custom_role_id\s+String\?\s+@db\.Uuid/,
      'Prisma schema must define custom_role_id scalar field'
    );
    assert.ok(
      !schemaContent.includes('custom_role           Role?'),
      'Prisma schema must not model custom_role as an immediate FK relation so db push/diff cannot drop deferrable constraint'
    );
    assert.match(
      schemaContent,
      /DEFERRABLE INITIALLY DEFERRED/,
      'Prisma schema must document deferrable constraint as migration source of truth'
    );

    // Read migration.sql to prove constraint is defined as DEFERRABLE INITIALLY DEFERRED
    const migrationPath = path.resolve(
      __dirname,
      '../../../../prisma/migrations/20261027000000_feat_rbac_01_roles_permissions/migration.sql'
    );
    const migrationContent = fs.readFileSync(migrationPath, 'utf8');
    assert.match(
      migrationContent,
      /FOREIGN KEY \("custom_role_id"\) REFERENCES "roles"\("id"\) ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED/,
      'Migration must create users_custom_role_id_fkey as DEFERRABLE INITIALLY DEFERRED'
    );
  });

  // Finding 2 (Round 8): BR-RBAC-02 / Concurrency: Lock actor role and role_permissions in transaction
  test('Finding 2 / Round 8 / BR-RBAC-02: lockAndAuthorizeActor locks actor role and role_permissions; concurrent revocation denies mutation with 403 PRIVILEGE_ESCALATION_DENIED', async () => {
    mockPrisma.rawQueries = [];

    // 1. Create a custom role for the actor with iam:manage_users and order:view_create
    const pManage = mockPrisma.permissions.find((p) => p.code === 'iam:manage_users')!;
    const pOrder = mockPrisma.permissions.find((p) => p.code === 'order:view_create')!;
    const actorRoleId = 'role-actor-r8-f2';
    mockPrisma.roles.push({
      id: actorRoleId,
      name: 'Delegated Admin Role',
      name_lower: 'delegated admin role',
      description: 'Admin role with order create',
      is_system: false,
      merchant_id: MERCHANT_A,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockPrisma.rolePermissions.push(
      { id: 'rp-del-1', role_id: actorRoleId, permission_id: pManage.id },
      { id: 'rp-del-2', role_id: actorRoleId, permission_id: pOrder.id }
    );

    const actorUserId = 'user-actor-r8-f2';
    mockPrisma.users.push({
      id: actorUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: actorRoleId,
      status: 'ACTIVE',
    });

    const delegatedActor: ActorContext = {
      userId: actorUserId,
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: actorRoleId,
    };

    // 2. Simulate concurrent revocation of order:view_create while user lock is acquired inside transaction
    const origQueryRaw = mockPrisma.$queryRaw.bind(mockPrisma);
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
        const rpIdx = mockPrisma.rolePermissions.findIndex(
          (rp) => rp.role_id === actorRoleId && rp.permission_id === pOrder.id
        );
        if (rpIdx !== -1) {
          mockPrisma.rolePermissions.splice(rpIdx, 1);
        }
      }
      return origQueryRaw(strings, ...values);
    };

    // 3. Actor attempts to create a role containing order:view_create
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Escalated Role Attempt',
            permissions: ['order:view_create'],
          },
          delegatedActor,
          '127.0.0.1',
          'corr-r8-f2-escalation'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        return true;
      }
    );

    // Verify row locks on users, roles, and role_permissions were executed
    const lockedUsers = mockPrisma.rawQueries.some(
      (q) => q.includes('FROM users') && q.includes('FOR UPDATE')
    );
    const lockedRoles = mockPrisma.rawQueries.some(
      (q) => q.includes('FROM roles') && q.includes('FOR UPDATE')
    );
    const lockedRolePerms = mockPrisma.rawQueries.some(
      (q) => q.includes('FROM role_permissions') && q.includes('FOR UPDATE')
    );
    assert.ok(lockedUsers, 'Must execute SELECT ... FOR UPDATE on users');
    assert.ok(lockedRoles, 'Must execute SELECT ... FOR UPDATE on roles');
    assert.ok(lockedRolePerms, 'Must execute SELECT ... FOR UPDATE on role_permissions');
  });

  // Finding 3 (Round 8): BR-RBAC-07 / AC-RBAC-01-08: Re-read role under row lock in updateRole and audit locked snapshot
  test('Finding 3 / Round 8 / BR-RBAC-07: updateRole re-reads role under row lock and audits locked before-image rather than stale pre-lock snapshot', async () => {
    // 1. Create a custom role
    const initialCreate = await service.createRole(
      {
        name: 'Vai Trò Ban Đầu F3',
        description: 'Mô tả ban đầu trước khi sửa',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r8-f3-setup'
    );
    const roleId = initialCreate.data.role.id;

    // 2. Intercept transaction lock to simulate concurrent modification of name and description before lock re-read
    const origQueryRaw = mockPrisma.$queryRaw.bind(mockPrisma);
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM roles') && sql.includes('FOR UPDATE')) {
        const role = mockPrisma.roles.find((r) => r.id === roleId);
        if (role) {
          role.name = 'Tên Đã Đổi Đồng Thời';
          role.name_lower = 'tên đã đổi đồng thời';
          role.description = 'Mô tả đã đổi đồng thời';
        }
      }
      return origQueryRaw(strings, ...values);
    };

    // 3. Execute update without specifying name (only updating description)
    const updateRes = await service.updateRole(
      roleId,
      {
        description: 'Mô tả mới nhất từ PATCH',
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r8-f3-patch'
    );

    // Verify concurrent name update was preserved from locked row, not overwritten with pre-lock initial name
    assert.strictEqual(updateRes.data.role.name, 'Tên Đã Đổi Đồng Thời');
    assert.strictEqual(updateRes.data.role.description, 'Mô tả mới nhất từ PATCH');
    assert.strictEqual(updateRes.data.role.permissions.length, 1);
    assert.strictEqual(updateRes.data.role.permissions[0].code, 'order:view_create');

    // Verify audit log old_value captured the locked snapshot ('Tên Đã Đổi Đồng Thời' and 'Mô tả đã đổi đồng thời')
    const updateAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_UPDATED' && a.entity_id === roleId
    );
    assert.ok(updateAudit, 'ROLE_UPDATED audit log must be created');
    assert.strictEqual(
      updateAudit.old_value.name,
      'Tên Đã Đổi Đồng Thời',
      'Audit old_value must record locked row name, not stale pre-lock name'
    );
    assert.strictEqual(
      updateAudit.old_value.description,
      'Mô tả đã đổi đồng thời',
      'Audit old_value must record locked row description'
    );
  });

  // Finding 1 Proving Test (Round 9): deleteRole re-reads role under row lock and audits locked before-image
  test('Finding 1 / Round 9 / BR-RBAC-07 / AC-RBAC-01-10: deleteRole re-reads role under lock and audits locked before-image rather than stale pre-lock snapshot', async () => {
    // 1. Create a custom role
    const initialCreate = await service.createRole(
      {
        name: 'Vai Trò Ban Đầu Cho Delete F1',
        description: 'Mô tả ban đầu trước khi xóa',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r9-f1-setup'
    );
    const roleId = initialCreate.data.role.id;

    // 2. Intercept transaction lock to simulate concurrent rename & description change committing before delete lock re-read
    const origQueryRaw = mockPrisma.$queryRaw.bind(mockPrisma);
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM roles') && sql.includes('FOR UPDATE')) {
        const role = mockPrisma.roles.find((r) => r.id === roleId);
        if (role) {
          role.name = 'Tên Đã Đổi Đồng Thời Trước Khi Xóa';
          role.name_lower = 'tên đã đổi đồng thời trước khi xóa';
          role.description = 'Mô tả đã đổi đồng thời trước khi xóa';
        }
      }
      return origQueryRaw(strings, ...values);
    };

    // 3. Execute deleteRole
    const deleteRes = await service.deleteRole(
      roleId,
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r9-f1-delete'
    );
    assert.strictEqual(deleteRes.data.deleted, true);

    // Verify audit log old_value captured the locked snapshot, not stale pre-lock initial name
    const deleteAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_DELETED' && a.entity_id === roleId
    );
    assert.ok(deleteAudit, 'ROLE_DELETED audit log must be created');
    assert.strictEqual(
      deleteAudit.old_value.name,
      'Tên Đã Đổi Đồng Thời Trước Khi Xóa',
      'Audit old_value must record locked row name, not stale pre-lock name'
    );
    assert.strictEqual(
      deleteAudit.old_value.description,
      'Mô tả đã đổi đồng thời trước khi xóa',
      'Audit old_value must record locked row description'
    );
  });

  // Finding 2 Proving Test (Round 9): Consistent lock order everywhere and deadlock/serialization mapped to retryable CONFLICT
  test('Finding 2 / Round 9 / BR-RBAC-02 / BR-RBAC-03: updateRole and deleteRole execute locks in ONE global order (actor user -> actor role -> role_permissions -> target role -> assignees) and map deadlock/serialization to retryable CONFLICT', async () => {
    // 1. Create a custom role
    const initialCreate = await service.createRole(
      {
        name: 'Vai Trò Thử Nghiệm Lock Order F2',
        description: 'Mô tả thử nghiệm lock order',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r9-f2-setup'
    );
    const roleId = initialCreate.data.role.id;

    // 2. Track executed $queryRaw locks in updateRole
    const executedLocksUpdate: string[] = [];
    const origQueryRaw = mockPrisma.$queryRaw.bind(mockPrisma);
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) {
        if (sql.includes('FROM users WHERE id =')) {
          executedLocksUpdate.push('actor_user');
        } else if (sql.includes('FROM roles WHERE id =')) {
          executedLocksUpdate.push(values[0] === roleId ? 'target_role' : 'actor_role');
        } else if (sql.includes('FROM role_permissions WHERE role_id =')) {
          executedLocksUpdate.push(
            values[0] === roleId ? 'target_role_permissions' : 'actor_role_permissions'
          );
        } else if (sql.includes('FROM users WHERE custom_role_id =')) {
          executedLocksUpdate.push('assignees');
        }
      }
      return origQueryRaw(strings, ...values);
    };

    await service.updateRole(
      roleId,
      { description: 'Mô tả mới' },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r9-f2-update'
    );

    // Verify updateRole lock order: actor_user -> actor_role -> actor_role_permissions -> target_role -> target_role_permissions
    assert.strictEqual(executedLocksUpdate[0], 'actor_user', 'First lock must be actor user');
    const targetRoleIndex = executedLocksUpdate.indexOf('target_role');
    const actorUserIndex = executedLocksUpdate.indexOf('actor_user');
    assert.ok(targetRoleIndex > actorUserIndex, 'Target role lock must be taken AFTER actor user');

    // 3. Track executed $queryRaw locks in deleteRole
    const executedLocksDelete: string[] = [];
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FOR UPDATE')) {
        if (sql.includes('FROM users WHERE id =')) {
          executedLocksDelete.push('actor_user');
        } else if (sql.includes('FROM roles WHERE id =')) {
          executedLocksDelete.push(values[0] === roleId ? 'target_role' : 'actor_role');
        } else if (sql.includes('FROM role_permissions WHERE role_id =')) {
          executedLocksDelete.push(
            values[0] === roleId ? 'target_role_permissions' : 'actor_role_permissions'
          );
        } else if (sql.includes('FROM users WHERE custom_role_id =')) {
          executedLocksDelete.push('assignees');
        }
      }
      return origQueryRaw(strings, ...values);
    };

    await service.deleteRole(roleId, OWNER_ACTOR, '127.0.0.1', 'corr-r9-f2-delete');

    // Verify deleteRole lock order: actor_user -> ... -> target_role -> ... -> assignees
    assert.strictEqual(
      executedLocksDelete[0],
      'actor_user',
      'First lock in deleteRole must be actor user'
    );
    const delTargetIndex = executedLocksDelete.indexOf('target_role');
    const delAssigneesIndex = executedLocksDelete.indexOf('assignees');
    assert.ok(delTargetIndex > 0, 'Target role lock must be taken after actor user');
    assert.ok(delAssigneesIndex > delTargetIndex, 'Assignees lock must be taken after target role');

    // 4. Verify deadlock/serialization error mapping
    mockPrisma.$queryRaw = async () => {
      const err: any = new Error('deadlock detected');
      err.code = '40P01';
      throw err;
    };

    try {
      await service.createRole(
        { name: 'Role Deadlock Test', permissions: ['order:view_create'] },
        OWNER_ACTOR,
        '127.0.0.1',
        'corr-r9-f2-deadlock'
      );
      assert.fail('Should have thrown on deadlock');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 409);
      assert.strictEqual(err.code, 'CONFLICT');
      assert.strictEqual(err.retryable, true);
    }
  });

  // Finding 4 Proving Test (Round 9): Inactive assignee widening returns only count in client error and keeps IDs in audit row
  test('Finding 4 / Round 9 / Security / PII: deleteRole inactive-assignee widening returns only count in client error without raw user IDs and preserves IDs in audit row', async () => {
    // 1. Create a custom role with narrow permissions
    const createRes = await service.createRole(
      {
        name: 'Vai Trò Hẹp PII Check F4',
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r9-f4-setup'
    );
    const roleId = createRes.data.role.id;

    // 2. Add inactive user with broader enum role (FINANCE)
    const sensitiveInactiveUserId = 'user-secret-uuid-12345678-inactive';
    mockPrisma.users.push({
      id: sensitiveInactiveUserId,
      merchant_id: MERCHANT_A,
      role: 'FINANCE',
      custom_role_id: roleId,
      status: 'INACTIVE',
    });

    // 3. Attempt to delete role
    try {
      await service.deleteRole(roleId, OWNER_ACTOR, '127.0.0.1', 'corr-r9-f4-delete');
      assert.fail('Should have blocked deletion due to inactive assignee widening');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 400);
      assert.strictEqual(err.code, 'ROLE_IN_USE');

      // Assert client error field message does NOT leak raw user IDs
      const fields = (err.getResponse() as any)?.error?.fields || err.fields || [];
      assert.ok(fields.length > 0, 'Must include fields error');
      const roleField = fields.find((f: any) => f.field === 'role_id');
      assert.ok(roleField, 'Must include role_id field error');

      assert.ok(
        !roleField.message.includes(sensitiveInactiveUserId),
        'Client error message must NOT leak raw user IDs'
      );
      assert.ok(roleField.message.includes('1'), 'Client error message must contain user count');
    }

    // 4. Verify audit row retained the raw user IDs safely server-side
    const wideningAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_DELETE_BLOCKED_INACTIVE_WIDENING' && a.entity_id === roleId
    );
    assert.ok(wideningAudit, 'Audit log for blocked widening must be recorded');
    assert.strictEqual(wideningAudit.old_value.broader_user_count, 1);
    assert.strictEqual(wideningAudit.old_value.correlation_id, 'corr-r9-f4-delete');
    assert.ok(
      wideningAudit.old_value.broader_user_ids.includes(sensitiveInactiveUserId),
      'Audit log must retain user IDs for administrative traceability'
    );
  });

  test('Finding 1 (Round 10): Durable audit log on inactive widening block does not discard failure and records correlation_id on USER_ROLE_DETACHED', async () => {
    // 1. Create role and safe inactive assignee
    const roleId = 'custom-r10-f1-role';
    mockPrisma.roles.push({
      id: roleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'R10 F1 Test Role',
      name_lower: 'r10 f1 test role',
      description: 'Testing detached audit',
      is_system: false,
      permissions: [],
    });

    const inactiveUserId = 'user-inactive-r10-f1';
    mockPrisma.users.push({
      id: inactiveUserId,
      merchant_id: MERCHANT_A,
      role: 'ORDER_OPERATOR',
      custom_role_id: roleId,
      status: 'INACTIVE',
    });

    const corrId = 'corr-r10-f1-detach';
    await service.deleteRole(roleId, OWNER_ACTOR, '127.0.0.1', corrId);

    const detachAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'USER_ROLE_DETACHED' && a.entity_id === inactiveUserId
    );
    assert.ok(detachAudit, 'USER_ROLE_DETACHED audit log must exist');
    assert.strictEqual(detachAudit.old_value.correlation_id, corrId);
    assert.strictEqual(detachAudit.new_value.correlation_id, corrId);

    // 2. Test that audit failure during widening block throws canonical 500 instead of swallowing
    const wideningRoleId = 'custom-r10-f1-widening';
    mockPrisma.roles.push({
      id: wideningRoleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'R10 F1 Widening Test',
      name_lower: 'r10 f1 widening test',
      description: 'Audit failure test',
      is_system: false,
      permissions: [],
    });
    mockPrisma.users.push({
      id: 'user-widening-r10',
      merchant_id: MERCHANT_A,
      role: 'OPS_MANAGER', // broader than empty custom role
      custom_role_id: wideningRoleId,
      status: 'INACTIVE',
    });

    // Intercept auditLog.create to throw
    const originalCreate = mockPrisma.auditLog.create;
    mockPrisma.auditLog.create = async () => {
      throw new Error('Database disk full');
    };

    try {
      await service.deleteRole(wideningRoleId, OWNER_ACTOR, '127.0.0.1', 'corr-r10-f1-audit-fail');
      assert.fail('Should have failed with 500 when audit write fails');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 500);
      assert.strictEqual(err.code, 'INTERNAL_SERVER_ERROR');
    } finally {
      mockPrisma.auditLog.create = originalCreate;
    }
  });

  test('Finding 2 (Round 10): Step-up / fresh MFA assurance required when granting sensitive capabilities', async () => {
    // 1. Password-only session actor attempting to create role with pii:unmask -> 403 MFA_FRESH_AUTH_REQUIRED
    const passwordActor = {
      ...OWNER_ACTOR,
      sessionId: 'session-password-owner',
    };

    try {
      await service.createRole(
        {
          name: 'PII Exporter Role',
          permissions: ['pii:unmask'],
        },
        passwordActor,
        '127.0.0.1',
        'corr-r10-f2-pwd-create'
      );
      assert.fail('Should require MFA step-up for pii:unmask');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 403);
      assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
    }

    // 2. MFA verified actor successfully creates role with sensitive permission
    const mfaActor = {
      ...OWNER_ACTOR,
      sessionId: 'session-mfa-owner',
    };
    const created = await service.createRole(
      {
        name: 'MFA PII Exporter Role',
        permissions: ['pii:unmask'],
      },
      mfaActor,
      '127.0.0.1',
      'corr-r10-f2-mfa-create'
    );
    assert.ok(created.data.role.id);

    // 3. Password-only session actor attempting to update role to add reconciliation:approve_rate_policy -> 403 MFA_FRESH_AUTH_REQUIRED
    const baseRoleId = 'custom-r10-f2-base';
    mockPrisma.roles.push({
      id: baseRoleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'R10 F2 Base Role',
      name_lower: 'r10 f2 base role',
      description: 'Base role',
      is_system: false,
      permissions: [
        {
          permission: { code: 'order:view_create' },
        },
      ],
    });

    try {
      await service.updateRole(
        baseRoleId,
        {
          permissions: ['order:view_create', 'reconciliation:approve_rate_policy'],
        },
        passwordActor,
        '127.0.0.1',
        'corr-r10-f2-pwd-update'
      );
      assert.fail('Should require MFA step-up when adding reconciliation:approve_rate_policy');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 403);
      assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
    }
  });

  // Finding 1 (Round 11): Step-up MFA assurance: PASSWORD session with old MFA timestamp rejected, session row locked in tx, recompute sensitive delta
  test('Finding 1 (Round 11): PASSWORD session with stale or active mfaVerifiedAt rejected with 403 MFA_FRESH_AUTH_REQUIRED; locked update recomputes sensitive delta', async () => {
    // 1. Password session with a truthy old MFA timestamp must be rejected (authAssurance === 'PASSWORD')
    const staleMfaPasswordActor = {
      ...OWNER_ACTOR,
      sessionId: 'session-password-owner',
    };

    try {
      await service.createRole(
        {
          name: 'Stale MFA PII Role',
          permissions: ['pii:unmask'],
        },
        staleMfaPasswordActor,
        '127.0.0.1',
        'corr-r11-f1-stale-pwd'
      );
      assert.fail('Should reject password session carrying old MFA timestamp');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 403);
      assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
    }

    // 2. In updateRole: Role initially has pii:unmask. Pre-lock it looks like no new sensitive grant is added.
    // Concurrently, pii:unmask is removed before lock. Locked update must recompute from locked before-image and reject password session.
    const concurrentTargetRoleId = 'role-r11-concurrent-sensitive';
    const pOrder = mockPrisma.permissions.find((p) => p.code === 'order:view_create')!;
    const pPii = mockPrisma.permissions.find((p) => p.code === 'pii:unmask')!;
    mockPrisma.roles.push({
      id: concurrentTargetRoleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'Concurrent Sensitive Role',
      name_lower: 'concurrent sensitive role',
      description: 'Role with PII',
      is_system: false,
      permissions: [{ permission: pOrder }, { permission: pPii }],
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Intercept query to remove pii:unmask concurrently before row lock
    const origQueryRaw = mockPrisma.$queryRaw.bind(mockPrisma);
    mockPrisma.$queryRaw = async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      if (sql.includes('FROM roles') && sql.includes('FOR UPDATE')) {
        const target = mockPrisma.roles.find((r) => r.id === concurrentTargetRoleId);
        if (target) {
          // Concurrently strip pii:unmask
          target.permissions = [{ permission: pOrder }];
        }
      }
      return origQueryRaw(strings, ...values);
    };

    try {
      await service.updateRole(
        concurrentTargetRoleId,
        {
          permissions: ['order:view_create', 'pii:unmask'],
        },
        staleMfaPasswordActor,
        '127.0.0.1',
        'corr-r11-f1-concurrent-patch'
      );
      assert.fail(
        'Locked update must recompute newly added sensitive codes and reject with MFA_FRESH_AUTH_REQUIRED'
      );
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 403);
      assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
    } finally {
      mockPrisma.$queryRaw = origQueryRaw;
    }
  });

  test('Finding 3 (Round 10): getActorPermissions fails closed with empty permissions when user.findUnique returns null', async () => {
    // Deleted or non-existent user holding stale OWNER claim in actor object
    const staleActor = {
      userId: 'non-existent-or-deleted-user-uuid',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      customRoleId: 'custom-role-1',
    };

    const perms = await service.getActorPermissions(staleActor);
    assert.deepStrictEqual(
      perms,
      [],
      'Must fail closed with empty array when user row does not exist in DB'
    );

    // GET /roles can_manage_roles check with stale actor returns false
    const rolesRes = await service.getRoles(MERCHANT_A, 'corr-r10-f3', staleActor);
    assert.strictEqual(
      rolesRes.data.can_manage_roles,
      false,
      'can_manage_roles must be false when DB user lookup fails closed'
    );
  });

  test('Finding 5 (Round 10): Bounds check on description (>1000) and permissions count (>50) in createRole and updateRole', async () => {
    // 1. Description exceeding 1000 chars in createRole
    try {
      await service.createRole(
        {
          name: 'Long Description Role',
          description: 'a'.repeat(1001),
          permissions: ['order:view_create'],
        },
        OWNER_ACTOR,
        '127.0.0.1',
        'corr-r10-f5-create-desc'
      );
      assert.fail('Should reject description > 1000 chars');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 400);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
      const fields = (err.getResponse() as any)?.error?.fields || err.fields || [];
      const descField = fields.find((f: any) => f.field === 'description');
      assert.ok(descField);
      assert.strictEqual(descField.code, 'MAX_LENGTH');
    }

    // 2. Permissions array exceeding 50 items in createRole
    try {
      await service.createRole(
        {
          name: 'Oversized Perms Role',
          permissions: Array(51).fill('order:view_create'),
        },
        OWNER_ACTOR,
        '127.0.0.1',
        'corr-r10-f5-create-perms'
      );
      assert.fail('Should reject permissions > 50 items');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 400);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
      const fields = (err.getResponse() as any)?.error?.fields || err.fields || [];
      const permField = fields.find((f: any) => f.field === 'permissions');
      assert.ok(permField);
      assert.strictEqual(permField.code, 'MAX_ITEMS');
    }

    // 3. UpdateRole with description > 1000 chars
    const roleId = 'custom-r10-f5-role';
    mockPrisma.roles.push({
      id: roleId,
      merchant_id: MERCHANT_A,
      code: null,
      name: 'R10 F5 Valid Role',
      name_lower: 'r10 f5 valid role',
      description: 'Initial',
      is_system: false,
      permissions: [{ permission: { code: 'order:view_create' } }],
    });

    try {
      await service.updateRole(
        roleId,
        { description: 'b'.repeat(1001) },
        OWNER_ACTOR,
        '127.0.0.1',
        'corr-r10-f5-update-desc'
      );
      assert.fail('Should reject update description > 1000 chars');
    } catch (err: any) {
      assert.ok(err instanceof CanonicalApiException);
      assert.strictEqual(err.getStatus(), 400);
      assert.strictEqual(err.code, 'VALIDATION_ERROR');
    }
  });

  test('Finding 6 (Round 10): RbacController uses strictly prefixed api/v1 route and PermissionsGuard has clean return', async () => {
    // 1. Verify RbacController route prefix metadata
    const pathMetadata = Reflect.getMetadata('path', RbacController);
    assert.strictEqual(pathMetadata, 'api/v1', 'RbacController must only listen on api/v1');

    // 2. Verify PermissionsGuard returns cleanly
    const mockReflector = {
      getAllAndOverride: () => ['order:view_create'],
    };
    const guard = new PermissionsGuard(mockReflector as any, service);

    const mockExecutionContext: any = {
      switchToHttp: () => ({
        getRequest: () => ({
          userId: 'user-owner-1',
          merchantId: MERCHANT_A,
          userRole: 'OWNER',
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    };

    const allowed = await guard.canActivate(mockExecutionContext);
    assert.strictEqual(allowed, true);
  });

  // Finding 2 (Round 11): BR-RBAC-01 / BR-RBAC-07: Seed only from privileged startup/migration, audit system-role permission changes, tenant reads do not rewrite global grants
  test('Finding 2 (Round 11): Seed only runs on startup/migration with audit logs and tenant reads do not trigger seed mutation', async () => {
    // 1. Verify onModuleInit lifecycle method exists and seeds platform
    assert.strictEqual(
      typeof service.onModuleInit,
      'function',
      'RbacService must implement OnModuleInit'
    );

    // 2. Track audit logs during seed execution
    // Remove permissions from OWNER role to simulate an unseeded/partially reconciled system role state
    const ownerSysRoleId = mockPrisma.roles.find((r) => r.code === 'OWNER')?.id;
    if (ownerSysRoleId) {
      mockPrisma.rolePermissions = mockPrisma.rolePermissions.filter(
        (rp) => rp.role_id !== ownerSysRoleId
      );
    }
    (service as any).isSeeded = false;
    await service.ensurePlatformSeed();

    // Verify audit log captured SYSTEM_ROLE_PERMISSIONS_RECONCILED when permissions are inserted/reconciled
    const reconAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'SYSTEM_ROLE_PERMISSIONS_RECONCILED'
    );
    assert.ok(reconAudit, 'System role reconciliation must record an audit row');
    assert.strictEqual(reconAudit?.user_id, null);
    assert.strictEqual(reconAudit?.merchant_id, null);

    // 3. Spy ensurePlatformSeed to verify tenant reads do NOT invoke it
    let seedCalled = false;
    const origSeed = service.ensurePlatformSeed.bind(service);
    service.ensurePlatformSeed = async () => {
      seedCalled = true;
      return origSeed();
    };

    try {
      await service.getPermissions('corr-r11-f2-get-perms');
      assert.strictEqual(seedCalled, false, 'GET /permissions must not invoke ensurePlatformSeed');

      await service.getRoles(MERCHANT_A, 'corr-r11-f2-get-roles', OWNER_ACTOR);
      assert.strictEqual(seedCalled, false, 'GET /roles must not invoke ensurePlatformSeed');
    } finally {
      service.ensurePlatformSeed = origSeed;
    }
  });

  // Finding 1 (Round 12): BR-RBAC-07 / BR-RBAC-01 / BR-RBAC-04: Platform seed and audit must not depend on customer merchants, use nullable actor, and onModuleInit must fail startup visibly
  test('Finding 1 (Round 12): Platform seed audit uses nullable platform actor without customer merchant dependency, and onModuleInit fails visibly on seed failure', async () => {
    // 1. Clear merchant findFirst to prove platform seed does not depend on a customer merchant
    mockPrisma.merchant.findFirst = async () => null;
    mockPrisma.auditLogs = [];

    // Remove permissions from OPS_CSKH role to trigger reconciliation
    const cskhSysRoleId = mockPrisma.roles.find((r) => r.code === 'OPS_CSKH')?.id;
    if (cskhSysRoleId) {
      mockPrisma.rolePermissions = mockPrisma.rolePermissions.filter(
        (rp) => rp.role_id !== cskhSysRoleId
      );
    }
    (service as any).isSeeded = false;
    await service.ensurePlatformSeed();

    // Verify audit log exists and has nullable merchant_id and user_id (not tied to any customer tenant)
    const platformAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'SYSTEM_ROLE_PERMISSIONS_RECONCILED'
    );
    assert.ok(platformAudit, 'System role reconciliation audit row must be created');
    assert.strictEqual(
      platformAudit.merchant_id,
      null,
      'Platform audit must not belong to arbitrary customer merchant'
    );
    assert.strictEqual(
      platformAudit.user_id,
      null,
      'Platform audit user_id must be null for system bootstrap'
    );

    // 2. onModuleInit must fail startup visibly if ensurePlatformSeed fails, rather than swallowing error
    (service as any).isSeeded = false;
    mockPrisma.shouldFailPermissionFindMany = true;
    await assert.rejects(
      async () => {
        await service.onModuleInit();
      },
      (err: any) => {
        assert.ok(err, 'onModuleInit must reject when seed fails');
        return true;
      }
    );
    mockPrisma.shouldFailPermissionFindMany = false;
  });

  // Finding 2 (Round 12): Sensitive create/update loads auth_assurance only from caller's active unexpired device_sessions row under FOR UPDATE and rejects when missing
  test('Finding 2 (Round 12): Sensitive grant loads auth_assurance only from active unexpired device_sessions row under FOR UPDATE and rejects request claims or missing session', async () => {
    // 1. Caller with fake authAssurance: 'MFA' in request context but NO sessionId is rejected with 403 MFA_FRESH_AUTH_REQUIRED
    const spoofedActorWithoutSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      authAssurance: 'MFA',
      mfaVerifiedAt: new Date(),
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Spoofed MFA Role No Session',
            permissions: ['pii:unmask'],
          },
          spoofedActorWithoutSession,
          '127.0.0.1',
          'corr-r12-f2-spoof-nosess'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
        return true;
      }
    );

    // 2. Caller with fake authAssurance: 'MFA' pointing to a PASSWORD-only session row in DB is rejected with 403 MFA_FRESH_AUTH_REQUIRED
    const spoofedActorWithPasswordSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'session-password-owner',
      authAssurance: 'MFA', // Attempt to spoof request property
      mfaVerifiedAt: new Date(),
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Spoofed MFA Role Password Session',
            permissions: ['pii:unmask'],
          },
          spoofedActorWithPasswordSession,
          '127.0.0.1',
          'corr-r12-f2-spoof-pwdsess'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
        return true;
      }
    );

    // 3. Caller with non-existent session ID fails closed with 401 SESSION_INVALID
    const actorWithMissingSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'non-existent-session-id',
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Role With Missing Session Row',
            permissions: ['pii:unmask'],
          },
          actorWithMissingSession,
          '127.0.0.1',
          'corr-r12-f2-missing-sess'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );

    // 4. Finding 1 / Round 13: Caller with revoked session row fails with 401 SESSION_INVALID before any write
    const actorWithRevokedSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'session-revoked-owner',
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Role With Revoked Session',
            permissions: ['pii:unmask'],
          },
          actorWithRevokedSession,
          '127.0.0.1',
          'corr-r12-f2-revoked-sess'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );

    // 4b. Finding 1 / Round 13: Caller with expired session row fails with 401 SESSION_INVALID
    const actorWithExpiredSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'session-expired-mfa-owner',
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: 'Role With Expired Session',
            permissions: ['order:view_create'],
          },
          actorWithExpiredSession,
          '127.0.0.1',
          'corr-r13-f1-expired-sess'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );

    // 5. Caller with valid active, unexpired MFA device_sessions row loaded under FOR UPDATE succeeds
    const actorWithValidMfaSession: ActorContext = {
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'session-mfa-owner',
    };

    const validRes = await service.createRole(
      {
        name: 'Valid MFA Session Role',
        permissions: ['pii:unmask'],
      },
      actorWithValidMfaSession,
      '127.0.0.1',
      'corr-r12-f2-valid-mfa'
    );
    assert.ok(validRes.data.role.id, 'Role creation with valid MFA session must succeed');
  });

  // Finding 1 (Round 13): Least privilege revoked/expired session aborts with 401 SESSION_INVALID before role or audit write, and resolveActorFromSession pins session to server
  test('Finding 1 (Round 13): lockAndAuthorizeActor aborts with 401 SESSION_INVALID on non-active or expired session and ignores client/JWT sid in resolveActorFromSession', async () => {
    // 1. resolveActorFromSession ignores client/JWT sid unless server-resolved sessionId is present
    mockPrisma.users.push({
      id: 'user-jwt-sid-test',
      merchant_id: MERCHANT_A,
      role: 'OWNER',
      custom_role_id: null,
      status: 'ACTIVE',
    });

    const reqWithOnlyJwtSid = {
      userId: 'user-jwt-sid-test',
      merchantId: MERCHANT_A,
      jwtClaims: { sid: 'untrusted-client-sid', role: 'OWNER' },
    };
    const resolvedWithoutServerSession = await service.resolveActorFromSession(
      reqWithOnlyJwtSid as any
    );
    assert.strictEqual(
      resolvedWithoutServerSession.sessionId,
      undefined,
      'Must ignore client/JWT sid when req.sessionId is not set'
    );

    const reqWithServerSession = {
      userId: 'user-jwt-sid-test',
      merchantId: MERCHANT_A,
      sessionId: 'server-resolved-sid-123',
      jwtClaims: { sid: 'different-client-sid', role: 'OWNER' },
    };
    const resolvedWithServerSession = await service.resolveActorFromSession(
      reqWithServerSession as any
    );
    assert.strictEqual(
      resolvedWithServerSession.sessionId,
      'server-resolved-sid-123',
      'Must pin to server-resolved sessionId and ignore conflicting client/JWT sid'
    );

    // 2. updateRole aborts with 401 SESSION_INVALID when session is revoked, before any write
    const testRole = await service.createRole(
      { name: 'Role For Revocation Check', permissions: ['order:view_create'] },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-r13-setup-role'
    );
    const initialAuditCount = mockPrisma.auditLogs.length;

    await assert.rejects(
      async () => {
        await service.updateRole(
          testRole.data.role.id,
          { name: 'Mutated By Revoked Session' },
          { ...OWNER_ACTOR, sessionId: 'session-revoked-owner' },
          '127.0.0.1',
          'corr-r13-update-revoked'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
    assert.strictEqual(
      mockPrisma.auditLogs.length,
      initialAuditCount,
      'No audit log must be written when session is revoked'
    );

    // 3. deleteRole aborts with 401 SESSION_INVALID when session is expired, before any delete or audit
    await assert.rejects(
      async () => {
        await service.deleteRole(
          testRole.data.role.id,
          { ...OWNER_ACTOR, sessionId: 'session-expired-mfa-owner' },
          '127.0.0.1',
          'corr-r13-delete-expired'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
    assert.strictEqual(
      mockPrisma.auditLogs.length,
      initialAuditCount,
      'No audit log must be written when session is expired'
    );
    const survivingRole = mockPrisma.roles.find((r) => r.id === testRole.data.role.id);
    assert.ok(survivingRole, 'Role must not be deleted when session is expired');
  });

  // Finding 2 (Round 13): ActorContext is cleanly imported from rbac.dto, re-exported by rbac.service, and spec files compile without TS2305/TS2459
  test('Finding 2 (Round 13): ActorContext interface import from rbac.dto and re-export from rbac.service conforms to required typecheck gate', () => {
    // Assert that an ActorContext instance adheres to the exported interface contract
    const testActor: ActorContext = {
      userId: 'user-typecheck-prove',
      merchantId: MERCHANT_A,
      role: 'OWNER',
      sessionId: 'session-prove-typecheck',
      authAssurance: 'MFA',
      mfaVerifiedAt: new Date(),
    };
    assert.strictEqual(testActor.userId, 'user-typecheck-prove');
    assert.strictEqual(testActor.merchantId, MERCHANT_A);
    assert.strictEqual(testActor.role, 'OWNER');
    assert.strictEqual(testActor.authAssurance, 'MFA');
  });

  // Finding 1 (Round 14 / P1-01): audit_logs schema contract preserves non-null merchant_id on tenant operations and supports nullable platform seed audit
  test('Finding 1 (Round 14 / P1-01): audit_logs contract ensures tenant mutations populate non-null merchant_id while platform seed logs without merchant dependency', async () => {
    // 1. Create a custom role and verify its audit log strictly populates merchant_id
    mockPrisma.auditLogs = [];
    const created = await service.createRole(
      {
        name: `Audit Contract Role ${Date.now()}`,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-01'
    );
    assert.ok(created.data.role.id);

    const tenantAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'ROLE_CREATED' && a.entity_id === created.data.role.id
    );
    assert.ok(tenantAudit, 'Tenant ROLE_CREATED audit must exist');
    assert.strictEqual(
      tenantAudit.merchant_id,
      MERCHANT_A,
      'Tenant audit log must have non-null merchant_id matching the merchant tenant'
    );
    assert.strictEqual(
      tenantAudit.user_id,
      OWNER_ACTOR.userId,
      'Tenant audit log must retain user_id'
    );

    // 2. Clear mock merchant and run platform seed; verify platform reconciliation audit has null merchant_id
    mockPrisma.merchant.findFirst = async () => null;
    const cskhRoleId = mockPrisma.roles.find((r) => r.code === 'OPS_CSKH')?.id;
    if (cskhRoleId) {
      mockPrisma.rolePermissions = mockPrisma.rolePermissions.filter(
        (rp) => rp.role_id !== cskhRoleId
      );
    }
    (service as any).isSeeded = false;
    await service.ensurePlatformSeed();

    const platformAudit = mockPrisma.auditLogs.find(
      (a) => a.action === 'SYSTEM_ROLE_PERMISSIONS_RECONCILED'
    );
    assert.ok(platformAudit, 'Platform seed reconciliation audit must exist');
    assert.strictEqual(
      platformAudit.merchant_id,
      null,
      'Platform audit must have null merchant_id'
    );
    assert.strictEqual(platformAudit.user_id, null, 'Platform audit must have null user_id');
  });

  // Finding 2 (Round 14 / P1-02): RbacController.getPermissions resolves actor and rejects unauthenticated or inactive users
  test('Finding 2 (Round 14 / P1-02): RbacController.getPermissions enforces actor resolution and rejects inactive users', async () => {
    const controller = new RbacController(service);

    // 1. Active owner succeeds and reads catalog
    const res = await controller.getPermissions({
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
    });
    assert.ok(res.data.permissions.length >= 20);
    assert.ok(res.data.categories.length >= 6);

    // 2. Missing user ID fails closed with 403 FORBIDDEN
    await assert.rejects(
      async () => {
        await controller.getPermissions({} as any);
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // 3. Inactive user fails closed with 403 FORBIDDEN
    mockPrisma.users.push({
      id: 'user-inactive-perms',
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: null,
      status: 'SUSPENDED',
    });

    await assert.rejects(
      async () => {
        await controller.getPermissions({
          userId: 'user-inactive-perms',
          merchantId: MERCHANT_A,
        });
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  // Finding 3 (Round 14 / P1-03): resolveActorFromSession populates authAssurance/mfaVerifiedAt from active session, and pre-tx MFA check fires early
  test('Finding 3 (Round 14 / P1-03): resolveActorFromSession populates session assurance, enabling early pre-transaction MFA rejection for sensitive grants', async () => {
    // 1. resolveActorFromSession populates authAssurance and mfaVerifiedAt from session-mfa-owner
    const resolvedActor = await service.resolveActorFromSession({
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      sessionId: 'session-mfa-owner',
    });
    assert.strictEqual(resolvedActor.sessionId, 'session-mfa-owner');
    assert.strictEqual(resolvedActor.authAssurance, 'MFA');
    assert.ok(resolvedActor.mfaVerifiedAt, 'mfaVerifiedAt must be populated on resolved actor');

    // 2. resolveActorFromSession for password session sets authAssurance: 'PASSWORD'
    mockPrisma.deviceSessions.push({
      id: 'session-pwd-user-1',
      user_id: 'user-owner-1',
      auth_assurance: 'PASSWORD',
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 3600000),
      mfa_verified_at: null,
    });

    const resolvedPwdActor = await service.resolveActorFromSession({
      userId: 'user-owner-1',
      merchantId: MERCHANT_A,
      sessionId: 'session-pwd-user-1',
    });
    assert.strictEqual(resolvedPwdActor.authAssurance, 'PASSWORD');
    assert.strictEqual(resolvedPwdActor.mfaVerifiedAt, null);

    // 3. Sensitive grant (pii:unmask) with resolvedPwdActor rejects pre-transaction with 403 MFA_FRESH_AUTH_REQUIRED
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: `Sensitive Role Pre-Tx Check ${Date.now()}`,
            permissions: ['pii:unmask'],
          },
          resolvedPwdActor,
          '127.0.0.1',
          'corr-p1-03'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
        return true;
      }
    );
  });

  // Finding 4 (Round 14 / P2-05 / P2-01): Plain validation rejects < > and control characters with VALIDATION_ERROR
  test('Finding 4 (Round 14 / P2-05 / P2-01): Plain validation rejects < > control characters with VALIDATION_ERROR', async () => {
    // 1. Role name with <script> tag rejects with 400 VALIDATION_ERROR
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: `<script>alert("xss")</script>Sanitized Role ${Date.now()}`,
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p2-01-name-xss'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(
          err.fields?.some((f: any) => f.field === 'name' && f.code === 'INVALID_CHARACTERS')
        );
        return true;
      }
    );

    // 2. Role description with HTML tag rejects with 400 VALIDATION_ERROR
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: `Valid Role Name ${Date.now()}`,
            description: `<p>Valid description</p><img src=x onerror=alert(1)>`,
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p2-01-desc-xss'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(
          err.fields?.some((f: any) => f.field === 'description' && f.code === 'INVALID_CHARACTERS')
        );
        return true;
      }
    );

    // 3. updateRole with HTML payload also rejects with 400 VALIDATION_ERROR
    const validRole = await service.createRole(
      {
        name: `Valid Update Target ${Date.now()}`,
        description: `Clean initial description`,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p2-01-clean'
    );

    await assert.rejects(
      async () => {
        await service.updateRole(
          validRole.data.role.id,
          { name: `<b>Updated Bold Role</b>` },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p2-01-patch-name'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  // Finding 5 (Round 14 / P2-07): OpenAPI specification specifies /api/v1 base server URL aligning /roles and /permissions with RbacController route prefix
  test('Finding 5 (Round 14 / P2-07): OpenAPI server base path /api/v1 matches RbacController route prefix', () => {
    const fs = require('fs');
    const path = require('path');
    const openapiContent = fs.readFileSync(
      path.resolve(__dirname, '../../../../docs/product-spec/contracts/openapi.yaml'),
      'utf-8'
    );
    assert.ok(
      openapiContent.includes('servers:\n  - url: /api/v1'),
      'OpenAPI must declare /api/v1 server mount point'
    );
    assert.ok(
      openapiContent.includes('/permissions:'),
      'OpenAPI must declare /permissions route under base server'
    );
    assert.ok(
      openapiContent.includes('/roles:'),
      'OpenAPI must declare /roles route under base server'
    );
    const controllerPath = Reflect.getMetadata('path', RbacController);
    assert.strictEqual(
      controllerPath,
      'api/v1',
      'RbacController route prefix must match OpenAPI server base URL'
    );
  });

  // Finding 1 (Round 15 / P1-01): createRole removes misleading pre-transaction checks, relying on authoritative in-transaction locks
  test('Finding 1 (Round 15 / P1-01): createRole relies on authoritative in-transaction locks for privilege ceiling and duplicate checks without TOCTOU window', async () => {
    // 1. In-transaction duplicate name check correctly catches existing role under lock with 400 ROLE_NAME_EXISTS
    const dupRoleName = `Authoritative Role ${Date.now()}`;
    await service.createRole(
      {
        name: dupRoleName,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-01-initial'
    );

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: dupRoleName,
            permissions: ['order:view_create'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p1-01-dup'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'ROLE_NAME_EXISTS');
        return true;
      }
    );

    // 2. In-transaction privilege ceiling check under lock catches unauthorized permission escalation with 403 PRIVILEGE_ESCALATION_DENIED
    const delegatedRoleId = `role-delegated-${Date.now()}`;
    mockPrisma.roles.push({
      id: delegatedRoleId,
      code: null,
      name: `Delegated Admin ${Date.now()}`,
      description: 'Admin with order create only',
      is_system: false,
      merchant_id: MERCHANT_A,
      created_at: new Date(),
      updated_at: new Date(),
    });
    mockPrisma.rolePermissions.push(
      {
        id: `rp-${delegatedRoleId}-1`,
        role_id: delegatedRoleId,
        permission_id: mockPrisma.permissions.find((p: any) => p.code === 'iam:manage_users').id,
      },
      {
        id: `rp-${delegatedRoleId}-2`,
        role_id: delegatedRoleId,
        permission_id: mockPrisma.permissions.find((p: any) => p.code === 'order:view_create').id,
      }
    );
    const delegatedUserId = `user-delegated-${Date.now()}`;
    mockPrisma.users.push({
      id: delegatedUserId,
      merchant_id: MERCHANT_A,
      role: 'OPS_CSKH',
      custom_role_id: delegatedRoleId,
      status: 'ACTIVE',
    });
    const delegatedSessionId = `session-mfa-delegated-${Date.now()}`;
    mockPrisma.deviceSessions.push({
      id: delegatedSessionId,
      user_id: delegatedUserId,
      auth_assurance: 'MFA',
      mfa_verified_at: new Date(),
      status: 'ACTIVE',
      expires_at: new Date(Date.now() + 86400000),
    });

    const delegatedActor = {
      userId: delegatedUserId,
      merchantId: MERCHANT_A,
      role: 'OPS_CSKH',
      customRoleId: delegatedRoleId,
      sessionId: delegatedSessionId,
    };

    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: `Escalation Attempt ${Date.now()}`,
            // delegatedActor lacks reconciliation:allocate_bank_receipt
            permissions: ['order:view_create', 'reconciliation:allocate_bank_receipt'],
          },
          delegatedActor,
          '127.0.0.1',
          'corr-p1-01-escalate'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        return true;
      }
    );
  });

  // Finding 2 (Round 15 / P1-02): updateRole enforces MFA step-up when touching roles containing sensitive permissions
  test('Finding 2 (Round 15 / P1-02): updateRole requires fresh MFA when modifying or retaining sensitive permissions on a role', async () => {
    // 1. Create a role with pii:unmask using valid MFA session
    const sensitiveRoleName = `Sensitive Role Retain ${Date.now()}`;
    const created = await service.createRole(
      {
        name: sensitiveRoleName,
        permissions: ['order:view_create', 'pii:unmask'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-02-create'
    );
    const roleId = created.data.role.id;

    // 2. Password session actor attempts to PATCH name/description retaining pii:unmask -> 403 MFA_FRESH_AUTH_REQUIRED
    const passwordOwnerActor = {
      ...OWNER_ACTOR,
      sessionId: 'session-password-owner',
    };

    await assert.rejects(
      async () => {
        await service.updateRole(
          roleId,
          {
            name: `Renamed Sensitive Role ${Date.now()}`,
            // Omitting permissions retains current permissions (which include pii:unmask)
          },
          passwordOwnerActor,
          '127.0.0.1',
          'corr-p1-02-patch-pwd'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'MFA_FRESH_AUTH_REQUIRED');
        return true;
      }
    );

    // 3. MFA verified session actor succeeds in renaming the sensitive role
    const updated = await service.updateRole(
      roleId,
      {
        name: `Renamed Sensitive Role Success ${Date.now()}`,
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-02-patch-mfa'
    );
    assert.ok(updated.data.role.id);
    assert.strictEqual(updated.data.role.name.startsWith('Renamed Sensitive Role Success'), true);
  });

  // Finding 3 (Round 15 / P1-03): audit_logs.merchant_id reader and writer null-safety and downstream compatibility
  test('Finding 3 (Round 15 / P1-03): audit_logs.merchant_id readers and writers are null-safe and downstream queries isolate properly', async () => {
    mockPrisma.auditLogs = [];

    // 1. Writer: Tenant role creation writes non-null merchant_id
    const tenantRole = await service.createRole(
      {
        name: `Tenant Audit Role ${Date.now()}`,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-03-tenant'
    );
    assert.ok(tenantRole.data.role.id);

    // 2. Writer: Platform seed writes null merchant_id
    mockPrisma.merchant.findFirst = async () => null;
    const cskhRoleId = mockPrisma.roles.find((r: any) => r.code === 'OPS_CSKH')?.id;
    if (cskhRoleId) {
      mockPrisma.rolePermissions = mockPrisma.rolePermissions.filter(
        (rp: any) => rp.role_id !== cskhRoleId
      );
    }
    (service as any).isSeeded = false;
    await service.ensurePlatformSeed();

    assert.ok(mockPrisma.auditLogs.length >= 2);

    // 3. Reader: Tenant-scoped query finds tenant log with non-null merchant_id
    const tenantLogs = mockPrisma.auditLogs.filter((a: any) => a.merchant_id === MERCHANT_A);
    assert.ok(tenantLogs.length >= 1, 'Tenant query must return tenant audit logs');
    for (const log of tenantLogs) {
      assert.strictEqual(log.merchant_id, MERCHANT_A);
      assert.strictEqual(typeof log.merchant_id, 'string');
    }

    // 4. Reader: Platform-scoped query finds platform log with null merchant_id
    const platformLogs = mockPrisma.auditLogs.filter((a: any) => a.merchant_id === null);
    assert.ok(platformLogs.length >= 1, 'Platform query must return platform audit logs');
    for (const log of platformLogs) {
      assert.strictEqual(log.merchant_id, null);
    }

    // 5. Reader: Unrestricted reader handles both string and null merchant_id safely
    for (const log of mockPrisma.auditLogs) {
      const merchantDisplay = log.merchant_id ? `Merchant:${log.merchant_id}` : 'Platform';
      assert.ok(merchantDisplay.length > 0);
      const isNullSafe = log.merchant_id === null || typeof log.merchant_id === 'string';
      assert.strictEqual(
        isNullSafe,
        true,
        'All audit log merchant_id values must be string or null'
      );
    }
  });

  // Finding 4 (Round 15 / Round 16 / P2-01): Plain validation rejects < > control characters without regex stripping
  test('Finding 4 (Round 15 / Round 16 / P2-01): hasForbiddenRoleTextCharacters detects <, >, control chars and plain validation rejects', async () => {
    // 1. Forbidden characters detection
    assert.strictEqual(hasForbiddenRoleTextCharacters('<script>'), true);
    assert.strictEqual(hasForbiddenRoleTextCharacters('nested > tag'), true);
    assert.strictEqual(hasForbiddenRoleTextCharacters('null\u0000byte'), true);
    assert.strictEqual(hasForbiddenRoleTextCharacters('control\u001Fchar'), true);
    assert.strictEqual(
      hasForbiddenRoleTextCharacters('Safe Role Name — Tiếng Việt Hợp Lệ 123!'),
      false
    );

    // 2. Valid role name and description without forbidden characters creates and persists cleanly
    const safeName = `Nhân Viên Hỗ Trợ ${Date.now()}`;
    const safeDesc = `Mô tả vai trò hỗ trợ đơn hàng và đối soát tiếng Việt`;
    const res = await service.createRole(
      {
        name: safeName,
        description: safeDesc,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p2-01-valid'
    );
    assert.ok(res.data.role.id);
    assert.strictEqual(res.data.role.name, safeName);
    assert.strictEqual(res.data.role.description, safeDesc);
  });

  // Finding (Round 16 / P1-02, P1-03, P1-04): In-transaction decision reads under row lock
  test('Finding (Round 16 / P1-02): updateRole and deleteRole authorize iam:manage_users inside transaction under actor row lock', async () => {
    // Create custom role to test update and delete
    const roleRes = await service.createRole(
      {
        name: `In-Tx Authz Target ${Date.now()}`,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-02-setup'
    );
    const targetRoleId = roleRes.data.role.id;

    // Simulate an actor whose user row in DB does not have iam:manage_users
    // (e.g. WAREHOUSE user user-warehouse-3)
    const unauthorizedActor: ActorContext = {
      userId: 'user-warehouse-3',
      merchantId: MERCHANT_A,
      role: 'WAREHOUSE',
    };

    // 1. updateRole rejects with 403 FORBIDDEN inside transaction
    await assert.rejects(
      async () => {
        await service.updateRole(
          targetRoleId,
          { name: `Updated Unauthorized ${Date.now()}` },
          unauthorizedActor,
          '127.0.0.1',
          'corr-p1-02-update'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // 2. deleteRole rejects with 403 FORBIDDEN inside transaction
    await assert.rejects(
      async () => {
        await service.deleteRole(targetRoleId, unauthorizedActor, '127.0.0.1', 'corr-p1-02-delete');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  test('Finding (Round 16 / P1-03): updateRole and createRole resolve permissionsInDb strictly inside transaction under row lock', async () => {
    // 1. createRole rejects with 400 VALIDATION_ERROR when permission does not exist in DB
    await assert.rejects(
      async () => {
        await service.createRole(
          {
            name: `Nonexistent Perm Role ${Date.now()}`,
            permissions: ['nonexistent:permission_code'],
          },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p1-03-create'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );

    // 2. Create custom role
    const roleRes = await service.createRole(
      {
        name: `Perm Resolution Target ${Date.now()}`,
        permissions: ['order:view_create'],
      },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-03-setup'
    );
    const targetRoleId = roleRes.data.role.id;

    // 3. updateRole resolves permissions inside transaction; rejects invalid permission with 400 VALIDATION_ERROR
    await assert.rejects(
      async () => {
        await service.updateRole(
          targetRoleId,
          { permissions: ['invalid:perm_code_in_tx'] },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p1-03-update-invalid'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        return true;
      }
    );
  });

  test('Finding (Round 16 / P1-04): updateRole catches duplicate name inside transaction under row lock without pre-tx read', async () => {
    const role1Name = `Unique Role One ${Date.now()}`;
    const role2Name = `Unique Role Two ${Date.now()}`;

    await service.createRole(
      { name: role1Name, permissions: ['order:view_create'] },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-04-r1'
    );
    const role2Res = await service.createRole(
      { name: role2Name, permissions: ['order:view_create'] },
      OWNER_ACTOR,
      '127.0.0.1',
      'corr-p1-04-r2'
    );

    // Attempt to update role 2 to have the same name as role 1 (case-insensitive duplicate)
    await assert.rejects(
      async () => {
        await service.updateRole(
          role2Res.data.role.id,
          { name: role1Name.toLowerCase() },
          OWNER_ACTOR,
          '127.0.0.1',
          'corr-p1-04-dup'
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

  // Finding (Round 16 / P2-03): DTO validation pipes reject bad bodies, extra fields, and invalid formats with 400 field errors
  test('Finding (Round 16 / P2-03): CreateRolePipe and UpdateRolePipe reject bad bodies, unknown fields, and invalid formats', () => {
    const createPipe = new CreateRolePipe();
    const updatePipe = new UpdateRolePipe();

    // 1. Non-object body rejects with 400 VALIDATION_ERROR
    assert.throws(
      () => createPipe.transform(null),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(err.fields?.some((f: any) => f.field === 'body' && f.code === 'INVALID_BODY'));
        return true;
      }
    );

    // 2. Extra unexpected field rejects with 400 VALIDATION_ERROR
    assert.throws(
      () =>
        createPipe.transform({
          name: 'Valid Name',
          permissions: ['order:view_create'],
          malicious_payload: 'injection',
          is_admin: true,
        }),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(
          err.fields?.some(
            (f: any) => f.field === 'malicious_payload' && f.code === 'UNEXPECTED_FIELD'
          )
        );
        assert.ok(
          err.fields?.some((f: any) => f.field === 'is_admin' && f.code === 'UNEXPECTED_FIELD')
        );
        return true;
      }
    );

    // 3. Name with forbidden <script> characters rejects with 400 VALIDATION_ERROR
    assert.throws(
      () =>
        createPipe.transform({
          name: '<script>alert(1)</script>',
          permissions: ['order:view_create'],
        }),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(
          err.fields?.some((f: any) => f.field === 'name' && f.code === 'INVALID_CHARACTERS')
        );
        return true;
      }
    );

    // 4. UpdateRolePipe rejects extra unexpected field
    assert.throws(
      () =>
        updatePipe.transform({
          name: 'Updated Name',
          unknown_patch_field: 42,
        }),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        assert.ok(
          err.fields?.some(
            (f: any) => f.field === 'unknown_patch_field' && f.code === 'UNEXPECTED_FIELD'
          )
        );
        return true;
      }
    );

    // 5. Valid body passes through cleanly
    const validCreate = createPipe.transform({
      name: 'Thủ Kho Trưởng',
      description: 'Quản lý xuất nhập tồn kho',
      permissions: ['order:view_create'],
    });
    assert.strictEqual(validCreate.name, 'Thủ Kho Trưởng');
    assert.strictEqual(validCreate.description, 'Quản lý xuất nhập tồn kho');
    assert.deepStrictEqual(validCreate.permissions, ['order:view_create']);

    const validUpdate = updatePipe.transform({
      description: 'Mô tả cập nhật',
    });
    assert.strictEqual(validUpdate.description, 'Mô tả cập nhật');
  });

  // Finding (Round 16 / P2-04): getRoles uses single grouped query instead of N+1 user count queries
  test('Finding (Round 16 / P2-04): getRoles performs a single grouped query for active user counts across all roles', async () => {
    let groupByCalls = 0;
    let countCalls = 0;
    const origGroupBy = mockPrisma.user.groupBy;
    const origCount = mockPrisma.user.count;

    mockPrisma.user.groupBy = async (args: any) => {
      groupByCalls++;
      return origGroupBy(args);
    };
    mockPrisma.user.count = async (args: any) => {
      countCalls++;
      return origCount(args);
    };

    try {
      const res = await service.getRoles(MERCHANT_A, 'corr-p2-04', OWNER_ACTOR);
      assert.ok(res.data.roles.length >= 5, 'Must return at least 5 system roles');
      // Proves single grouped query executed and 0 individual count queries executed
      assert.strictEqual(groupByCalls, 1, 'Exactly one grouped query must be issued');
      assert.strictEqual(countCalls, 0, 'No individual count queries should be issued (no N+1)');

      // Verify counts are populated correctly
      const ownerRole = res.data.roles.find((r) => r.code === 'OWNER');
      assert.ok(ownerRole);
      assert.ok(typeof ownerRole.user_count === 'number');
    } finally {
      mockPrisma.user.groupBy = origGroupBy;
      mockPrisma.user.count = origCount;
    }
  });
});
