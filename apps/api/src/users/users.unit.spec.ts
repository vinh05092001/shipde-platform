import * as assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { UsersService } from './users.service';
import { RoleEnum } from '@prisma/client';
import { CanonicalApiException } from '../auth/auth.service';
// Keep shared list acceptance coverage in the existing API test entry point.
import './lists.unit.spec';

/**
 * Mock Prisma Client for UsersService unit testing.
 */
class MockPrismaService {
  users: any[] = [];
  auditLogs: any[] = [];
  deviceSessions: any[] = [];
  shouldFailAudit = false;
  shouldFailUpdate = false;

  user = {
    findFirst: async ({ where }: any) => {
      const u = this.users.find((u) => {
        if (where.id && u.id !== where.id) return false;
        if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
        return true;
      });
      if (!u) return null;
      return {
        ...u,
        created_at: u.created_at || new Date(),
        updated_at: u.updated_at || new Date(),
        device_sessions: this.deviceSessions
          .filter((ds) => ds.user_id === u.id)
          .sort((a, b) => b.last_active_at.getTime() - a.last_active_at.getTime())
          .slice(0, 1),
      };
    },
    findMany: async ({ where, skip = 0, take = 20 }: any) => {
      let filtered = this.users.filter((u) => {
        if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
        if (where.role && u.role !== where.role) return false;
        if (
          where.status &&
          (u.status || '').toLowerCase() !== (where.status.equals || '').toLowerCase()
        )
          return false;
        if (where.OR && Array.isArray(where.OR)) {
          const match = where.OR.some((clause: any) => {
            if (
              clause.full_name?.contains &&
              u.full_name?.toLowerCase().includes(clause.full_name.contains.toLowerCase())
            )
              return true;
            if (
              clause.email?.contains &&
              u.email?.toLowerCase().includes(clause.email.contains.toLowerCase())
            )
              return true;
            if (
              clause.phone?.contains &&
              u.phone?.toLowerCase().includes(clause.phone.contains.toLowerCase())
            )
              return true;
            return false;
          });
          if (!match) return false;
        }
        return true;
      });
      return filtered.slice(skip, skip + take).map((u) => ({
        ...u,
        created_at: u.created_at || new Date(),
        updated_at: u.updated_at || new Date(),
        device_sessions: this.deviceSessions
          .filter((ds) => ds.user_id === u.id)
          .sort((a, b) => b.last_active_at.getTime() - a.last_active_at.getTime())
          .slice(0, 1),
      }));
    },
    count: async ({ where }: any) => {
      return this.users.filter((u) => {
        if (where.merchant_id && u.merchant_id !== where.merchant_id) return false;
        if (where.role && u.role !== where.role) return false;
        if (where.status?.in) {
          const lowerList = where.status.in.map((s: string) => s.toLowerCase());
          if (!lowerList.includes((u.status || '').toLowerCase())) return false;
        }
        return true;
      }).length;
    },
    update: async ({ where, data }: any) => {
      if (this.shouldFailUpdate) {
        throw new Error('Database update failure simulation');
      }
      const idx = this.users.findIndex((u) => u.id === where.id);
      if (idx === -1) throw new Error('User not found');
      this.users[idx] = { ...this.users[idx], ...data, updated_at: new Date() };
      return this.users[idx];
    },
  };

  auditLog = {
    create: async ({ data }: any) => {
      if (this.shouldFailAudit) {
        throw new Error('Audit log database error simulation');
      }
      const row = { id: `audit-${Date.now()}-${Math.random()}`, created_at: new Date(), ...data };
      this.auditLogs.push(row);
      return row;
    },
  };

  $transaction = async (fn: (tx: any) => Promise<any>) => {
    // Execute function with current mock instance acting as tx
    return await fn(this);
  };
}

/**
 * Mock SessionService for UsersService unit testing.
 */
class MockSessionService {
  revokedCalls: any[] = [];

  async revokeTargetUserSessions(
    targetUserId: string,
    merchantId: string,
    revokedByUserId: string,
    reason: string,
    correlationId: string,
    ipAddress?: string,
    tx?: any
  ): Promise<number> {
    this.revokedCalls.push({
      targetUserId,
      merchantId,
      revokedByUserId,
      reason,
      correlationId,
      ipAddress,
      txProvided: !!tx,
    });
    return 2;
  }
}

/**
 * Mock RbacService for UsersService unit testing.
 */
class MockRbacService {
  async resolveActorFromSession(input: any) {
    return {
      userId: input.userId,
      merchantId: input.merchantId,
      role: input.userRole,
      customRoleId: input.customRoleId,
    };
  }

  async actorHasPermissions(actor: any, permissions: string[]): Promise<boolean> {
    if (actor.role === 'OWNER') return true;
    if (actor.permissions && Array.isArray(actor.permissions)) {
      return permissions.every((p) => actor.permissions.includes(p));
    }
    return false;
  }
}

describe('FEAT-USR-02 — UsersService Unit Tests', () => {
  let mockPrisma: MockPrismaService;
  let mockSession: MockSessionService;
  let mockRbac: MockRbacService;
  let usersService: UsersService;

  const MERCHANT_ID = 'merch-test-111';
  const OTHER_MERCHANT_ID = 'merch-other-222';
  const OWNER_USER_ID = 'user-owner-001';
  const OPERATOR_USER_ID = 'user-ops-002';
  const SECOND_OWNER_ID = 'user-owner-003';
  const CROSS_TENANT_USER_ID = 'user-cross-999';

  beforeEach(() => {
    mockPrisma = new MockPrismaService();
    mockSession = new MockSessionService();
    mockRbac = new MockRbacService();
    usersService = new UsersService(mockPrisma as any, mockSession as any, mockRbac as any);

    mockPrisma.users = [
      {
        id: OWNER_USER_ID,
        merchant_id: MERCHANT_ID,
        email: 'owner@shipde.vn',
        phone: '0901111111',
        full_name: 'Shop Owner 1',
        password_hash: 'secret-hash-hidden',
        role: RoleEnum.OWNER,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: OPERATOR_USER_ID,
        merchant_id: MERCHANT_ID,
        email: 'ops@shipde.vn',
        phone: '0902222222',
        full_name: 'Ops Operator 2',
        password_hash: 'secret-hash-hidden',
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['store-1'],
        warehouse_scopes: ['wh-1'],
        created_at: new Date('2026-01-02T00:00:00Z'),
        updated_at: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: SECOND_OWNER_ID,
        merchant_id: MERCHANT_ID,
        email: 'owner2@shipde.vn',
        phone: '0903333333',
        full_name: 'Shop Owner 2',
        password_hash: 'secret-hash-hidden',
        role: RoleEnum.OWNER,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
        created_at: new Date('2026-01-03T00:00:00Z'),
        updated_at: new Date('2026-01-03T00:00:00Z'),
      },
      {
        id: CROSS_TENANT_USER_ID,
        merchant_id: OTHER_MERCHANT_ID,
        email: 'cross@other.vn',
        phone: '0909999999',
        full_name: 'Cross Tenant User',
        password_hash: 'secret-hash-hidden',
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: [],
        warehouse_scopes: [],
        created_at: new Date('2026-01-04T00:00:00Z'),
        updated_at: new Date('2026-01-04T00:00:00Z'),
      },
    ];

    mockPrisma.deviceSessions = [
      {
        id: 'sess-1',
        user_id: OPERATOR_USER_ID,
        merchant_id: MERCHANT_ID,
        last_active_at: new Date('2026-01-10T12:00:00Z'),
      },
    ];
  });

  // =========================================================================
  // 1. listUsers
  // =========================================================================
  describe('listUsers (AC-USR-02-01)', () => {
    test('returns paginated users scoped strictly to caller merchant', async () => {
      const res = await usersService.listUsers(MERCHANT_ID, { page: 1, limit: 10 }, 'corr-1');
      assert.strictEqual(res.data.length, 3);
      assert.strictEqual(res.meta.total, 3);
      assert.strictEqual(res.meta.page, 1);
      assert.strictEqual(res.meta.correlation_id, 'corr-1');

      // Password hash must never be returned
      for (const u of res.data) {
        assert.strictEqual((u as any).password_hash, undefined);
      }
    });

    test('filters users by search query', async () => {
      const res = await usersService.listUsers(MERCHANT_ID, { search: 'Operator' }, 'corr-2');
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].id, OPERATOR_USER_ID);
    });

    test('filters users by role', async () => {
      const res = await usersService.listUsers(MERCHANT_ID, { role: RoleEnum.OWNER }, 'corr-3');
      assert.strictEqual(res.data.length, 2);
      for (const u of res.data) {
        assert.strictEqual(u.role, RoleEnum.OWNER);
      }
    });
  });

  // =========================================================================
  // 2. getUser
  // =========================================================================
  describe('getUser (AC-USR-02-02, AC-USR-02-15)', () => {
    test('returns user details when user belongs to caller merchant', async () => {
      const res = await usersService.getUser(OPERATOR_USER_ID, MERCHANT_ID, 'corr-get-1');
      assert.strictEqual(res.data.id, OPERATOR_USER_ID);
      assert.strictEqual(res.data.email, 'ops@shipde.vn');
      assert.strictEqual(res.data.status, 'ACTIVE');
      assert.strictEqual((res.data as any).password_hash, undefined);
    });

    test('throws 403 FORBIDDEN when user belongs to different merchant (AC-USR-02-15)', async () => {
      await assert.rejects(
        usersService.getUser(CROSS_TENANT_USER_ID, MERCHANT_ID, 'corr-cross'),
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.response?.error?.code, 'FORBIDDEN');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 3. updateUser
  // =========================================================================
  describe('updateUser (AC-USR-02-03, AC-USR-02-14, BR-USR-01)', () => {
    test('allows owner to update user full_name and warehouse scopes', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      const res = await usersService.updateUser(
        OPERATOR_USER_ID,
        { full_name: 'Ops Updated Name', warehouse_scopes: ['wh-1', 'wh-2'] },
        actor,
        '127.0.0.1',
        'corr-up-1'
      );
      assert.strictEqual(res.data.full_name, 'Ops Updated Name');
      assert.deepStrictEqual(res.data.warehouse_scopes, ['wh-1', 'wh-2']);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'USER_UPDATED');
      assert.ok(audit, 'USER_UPDATED audit log must be created');
      assert.strictEqual(audit.entity_id, OPERATOR_USER_ID);
    });

    test('rejects empty full_name with 400 VALIDATION_ERROR', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.updateUser(
          OPERATOR_USER_ID,
          { full_name: '   ' },
          actor,
          '127.0.0.1',
          'corr-err'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    test('rejects non-owner actor attempting to assign OWNER role with 403 FORBIDDEN (AC-USR-02-14)', async () => {
      const actor = { userId: OPERATOR_USER_ID, merchantId: MERCHANT_ID, role: 'OPS_CSKH' };
      // Allow ops actor to pass iam:manage_users check by mocking permission
      (mockRbac as any).actorHasPermissions = async () => true;

      await assert.rejects(
        usersService.updateUser(
          OPERATOR_USER_ID,
          { role: RoleEnum.OWNER },
          actor,
          '127.0.0.1',
          'corr-role-esc'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.response?.error?.code, 'FORBIDDEN');
          assert.ok(err.response?.error?.message.includes('Chủ cửa hàng (OWNER)'));
          return true;
        }
      );
    });

    test('rejects demoting sole active owner with 400 CANNOT_REMOVE_LAST_OWNER (BR-USR-01)', async () => {
      // Remove second owner so OWNER_USER_ID is the only owner
      mockPrisma.users = mockPrisma.users.filter((u) => u.id !== SECOND_OWNER_ID);

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.updateUser(
          OWNER_USER_ID,
          { role: RoleEnum.OPS_CSKH },
          actor,
          '127.0.0.1',
          'corr-last-owner'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'CANNOT_REMOVE_LAST_OWNER');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 4. suspendUser
  // =========================================================================
  describe('suspendUser (AC-USR-02-04, AC-USR-02-10..13, AC-USR-02-17)', () => {
    test('rejects blank suspension reason with 400 VALIDATION_ERROR (AC-USR-02-12, BR-USR-07)', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.suspendUser(
          OPERATOR_USER_ID,
          { reason: '   ' },
          actor,
          '127.0.0.1',
          'corr-sus-blank'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    test('rejects self-suspension with 400 SELF_SUSPENSION_PROHIBITED (AC-USR-02-10, BR-USR-02)', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.suspendUser(
          OWNER_USER_ID,
          { reason: 'Self suspend test' },
          actor,
          '127.0.0.1',
          'corr-self'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'SELF_SUSPENSION_PROHIBITED');
          return true;
        }
      );
    });

    test('rejects suspending sole active owner with 400 CANNOT_REMOVE_LAST_OWNER (AC-USR-02-11, BR-USR-01)', async () => {
      // Keep only SECOND_OWNER_ID as the only active owner
      mockPrisma.users = mockPrisma.users.filter((u) => u.id !== OWNER_USER_ID);

      const actorOwner = { userId: 'different-owner-id', merchantId: MERCHANT_ID, role: 'OWNER' };
      mockPrisma.users.push({
        id: 'different-owner-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OWNER,
        status: 'suspended', // inactive owner so active owners count = 1
      });

      await assert.rejects(
        usersService.suspendUser(
          SECOND_OWNER_ID,
          { reason: 'Suspend last owner' },
          actorOwner,
          '127.0.0.1',
          'corr-last-own-sus'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'CANNOT_REMOVE_LAST_OWNER');
          return true;
        }
      );
    });

    test('rejects suspending non-ACTIVE user with 409 INVALID_STATUS_TRANSITION (AC-USR-02-13, BR-USR-04)', async () => {
      const target = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      target.status = 'suspended';

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.suspendUser(
          OPERATOR_USER_ID,
          { reason: 'Suspend again' },
          actor,
          '127.0.0.1',
          'corr-invalid-trans'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.response?.error?.code, 'INVALID_STATUS_TRANSITION');
          return true;
        }
      );
    });

    test('successfully suspends active user, revokes device sessions in transaction, and logs audit (AC-USR-02-04)', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      const res = await usersService.suspendUser(
        OPERATOR_USER_ID,
        { reason: 'Violated warehouse safety policy' },
        actor,
        '10.0.0.1',
        'corr-sus-ok'
      );

      assert.strictEqual(res.data.status, 'SUSPENDED');
      assert.strictEqual(res.data.revoked_sessions_count, 2);

      // Verify user status in mock DB updated
      const updated = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      assert.strictEqual(updated.status, 'suspended');

      // Verify session revocation called with tx
      assert.strictEqual(mockSession.revokedCalls.length, 1);
      assert.strictEqual(mockSession.revokedCalls[0].targetUserId, OPERATOR_USER_ID);
      assert.strictEqual(mockSession.revokedCalls[0].txProvided, true);

      // Verify audit log created
      const audit = mockPrisma.auditLogs.find((a) => a.action === 'USER_SUSPENDED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, OPERATOR_USER_ID);
      assert.strictEqual(audit.reason, 'Violated warehouse safety policy');
    });

    test('rolls back transaction on audit failure and returns 500 INTERNAL_SERVER_ERROR (AC-USR-02-17)', async () => {
      mockPrisma.shouldFailAudit = true;

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.suspendUser(
          OPERATOR_USER_ID,
          { reason: 'Audit should fail' },
          actor,
          '127.0.0.1',
          'corr-fail'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 500);
          assert.strictEqual(err.response?.error?.code, 'INTERNAL_SERVER_ERROR');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 5. activateUser
  // =========================================================================
  describe('activateUser (AC-USR-02-07, BR-USR-04)', () => {
    test('rejects activating a user that is not in SUSPENDED status with 409 INVALID_STATUS_TRANSITION', async () => {
      // User is currently ACTIVE
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.activateUser(
          OPERATOR_USER_ID,
          { reason: 'Activate active user' },
          actor,
          '127.0.0.1',
          'corr-act-err'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.response?.error?.code, 'INVALID_STATUS_TRANSITION');
          return true;
        }
      );
    });

    test('successfully activates suspended user and creates USER_ACTIVATED audit log', async () => {
      const target = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      target.status = 'suspended';

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      const res = await usersService.activateUser(
        OPERATOR_USER_ID,
        { reason: 'Completed disciplinary review' },
        actor,
        '10.0.0.1',
        'corr-act-ok'
      );

      assert.strictEqual(res.data.status, 'ACTIVE');
      const updatedUser = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      assert.strictEqual(updatedUser.status, 'active');

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'USER_ACTIVATED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, OPERATOR_USER_ID);
    });
  });

  // =========================================================================
  // 6. deactivateUser
  // =========================================================================
  describe('deactivateUser (AC-USR-02-08..11, BR-USR-01, BR-USR-02, BR-USR-04)', () => {
    test('rejects self-deactivation with 400 SELF_SUSPENSION_PROHIBITED (AC-USR-02-10, BR-USR-02)', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.deactivateUser(
          OWNER_USER_ID,
          { reason: 'Self deactivate' },
          actor,
          '127.0.0.1',
          'corr-deact-self'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.response?.error?.code, 'SELF_SUSPENSION_PROHIBITED');
          return true;
        }
      );
    });

    test('rejects deactivating already DISABLED user with 409 INVALID_STATUS_TRANSITION (AC-USR-02-13)', async () => {
      const target = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      target.status = 'disabled';

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await assert.rejects(
        usersService.deactivateUser(
          OPERATOR_USER_ID,
          { reason: 'Deactivate disabled' },
          actor,
          '127.0.0.1',
          'corr-deact-again'
        ),
        (err: any) => {
          assert.strictEqual(err.status, 409);
          assert.strictEqual(err.response?.error?.code, 'INVALID_STATUS_TRANSITION');
          return true;
        }
      );
    });

    test('successfully deactivates user, revokes sessions in tx, and creates USER_DEACTIVATED audit log (AC-USR-02-08)', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      const res = await usersService.deactivateUser(
        OPERATOR_USER_ID,
        { reason: 'Employee left the company' },
        actor,
        '10.0.0.1',
        'corr-deact-ok'
      );

      assert.strictEqual(res.data.status, 'DISABLED');
      assert.strictEqual(res.data.revoked_sessions_count, 2);

      const target = mockPrisma.users.find((u) => u.id === OPERATOR_USER_ID);
      assert.strictEqual(target.status, 'disabled');

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'USER_DEACTIVATED');
      assert.ok(audit);
      assert.strictEqual(audit.entity_id, OPERATOR_USER_ID);
      assert.strictEqual(audit.reason, 'Employee left the company');
    });
  });

  // =========================================================================
  // 7. checkActorManageUsersPermission
  // =========================================================================
  describe('checkActorManageUsersPermission (AC-USR-02-16)', () => {
    test('allows owner actor without explicit rbac permission check', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      await usersService.checkActorManageUsersPermission(actor);
    });

    test('rejects non-owner actor who lacks iam:manage_users with 403 FORBIDDEN', async () => {
      const actor = { userId: OPERATOR_USER_ID, merchantId: MERCHANT_ID, role: 'OPS_CSKH' };
      (mockRbac as any).actorHasPermissions = async () => false;

      await assert.rejects(usersService.checkActorManageUsersPermission(actor), (err: any) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.response?.error?.code, 'FORBIDDEN');
        assert.ok(err.response?.error?.message.includes('quản lý người dùng'));
        return true;
      });
    });

    test('allows non-owner actor who possesses iam:manage_users permission', async () => {
      const actor = { userId: OPERATOR_USER_ID, merchantId: MERCHANT_ID, role: 'OPS_CSKH' };
      (mockRbac as any).actorHasPermissions = async () => true;

      await usersService.checkActorManageUsersPermission(actor);
    });
  });
});
