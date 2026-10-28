import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert';
import { MeService, DEFAULT_NOTIFICATION_PREFERENCES, isValidIanaTimezone } from './me.service';
import { CanonicalApiException } from '../auth/auth.service';

function createMockPrismaService() {
  const users: any[] = [];
  const auditLogs: any[] = [];
  const merchants: any[] = [];

  const mockTx = {
    user: {
      update: async ({ where, data, include }: any) => {
        const idx = users.findIndex((u) => u.id === where.id);
        if (idx === -1) throw new Error('User not found');
        users[idx] = { ...users[idx], ...data, updated_at: new Date() };
        const result = { ...users[idx] };
        if (include?.merchant) {
          result.merchant = merchants.find((m) => m.id === result.merchant_id) || null;
        }
        return result;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const entry = {
          id: `audit-${Date.now()}-${Math.random()}`,
          ...data,
          created_at: new Date(),
        };
        auditLogs.push(entry);
        return entry;
      },
    },
  };

  return {
    users,
    auditLogs,
    merchants,
    user: {
      findUnique: async ({ where, include }: any) => {
        const u = users.find((user) => user.id === where.id);
        if (!u) return null;
        const res = { ...u };
        if (include?.merchant) {
          res.merchant = merchants.find((m) => m.id === res.merchant_id) || null;
        }
        return res;
      },
      findFirst: async ({ where }: any) => {
        return (
          users.find((user) => {
            if (where.phone && user.phone !== where.phone) return false;
            if (where.id?.not && user.id === where.id.not) return false;
            return true;
          }) || null
        );
      },
      update: mockTx.user.update,
    },
    auditLog: {
      create: mockTx.auditLog.create,
    },
    $transaction: async (fn: any) => fn(mockTx),
  };
}

describe('MeService Unit Tests (FEAT-PRO-01)', () => {
  let mockPrisma: ReturnType<typeof createMockPrismaService>;
  let meService: MeService;

  const TEST_MERCHANT_ID = 'm-test-1111';
  const TEST_USER_ID = 'u-test-2222';
  const OTHER_USER_ID = 'u-other-3333';

  beforeEach(() => {
    mockPrisma = createMockPrismaService();
    meService = new MeService(mockPrisma as any);

    mockPrisma.merchants.push({
      id: TEST_MERCHANT_ID,
      name: 'Shop Cưng Của Mẹ',
    });

    mockPrisma.users.push({
      id: TEST_USER_ID,
      merchant_id: TEST_MERCHANT_ID,
      email: 'user@example.com',
      phone: '0901234567',
      full_name: 'Nguyễn Văn A',
      role: 'OPS_CSKH',
      status: 'ACTIVE',
      avatar_url: null,
      language: 'vi',
      timezone: 'Asia/Ho_Chi_Minh',
      default_warehouse_id: 'wh-1',
      store_scopes: ['store-1'],
      warehouse_scopes: ['wh-1', 'wh-2'],
      custom_role_id: null,
      notification_preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });

    mockPrisma.users.push({
      id: OTHER_USER_ID,
      merchant_id: TEST_MERCHANT_ID,
      email: 'other@example.com',
      phone: '0987654321',
      full_name: 'Trần Thị B',
      role: 'WAREHOUSE',
      status: 'ACTIVE',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('AC-PRO-01-01: Retrieves authenticated user profile with merchant metadata and preferences', async () => {
    const res = await meService.getMe(TEST_USER_ID, 'corr-1');
    assert.strictEqual(res.data.id, TEST_USER_ID);
    assert.strictEqual(res.data.email, 'user@example.com');
    assert.strictEqual(res.data.full_name, 'Nguyễn Văn A');
    assert.strictEqual(res.data.language, 'vi');
    assert.strictEqual(res.data.timezone, 'Asia/Ho_Chi_Minh');
    assert.strictEqual(res.data.default_warehouse_id, 'wh-1');
    assert.strictEqual(res.data.merchant?.name, 'Shop Cưng Của Mẹ');
    assert.strictEqual(res.meta.correlation_id, 'corr-1');
  });

  it('AC-PRO-01-02: Updates full name, phone number, and avatar URL with audit log', async () => {
    const res = await meService.updateMe(
      TEST_USER_ID,
      {
        full_name: 'Nguyễn Văn Đã Đổi Tên',
        phone: '0933445566',
        avatar_url: 'https://example.com/avatar.png',
      },
      '127.0.0.1',
      'corr-2'
    );

    assert.strictEqual(res.data.full_name, 'Nguyễn Văn Đã Đổi Tên');
    assert.strictEqual(res.data.phone, '0933445566');
    assert.strictEqual(res.data.avatar_url, 'https://example.com/avatar.png');

    // Verify audit log created
    assert.strictEqual(mockPrisma.auditLogs.length, 1);
    const log = mockPrisma.auditLogs[0];
    assert.strictEqual(log.action, 'PROFILE_UPDATED');
    assert.strictEqual(log.user_id, TEST_USER_ID);
    assert.strictEqual(log.new_value.full_name, 'Nguyễn Văn Đã Đổi Tên');
    assert.strictEqual(log.old_value.full_name, 'Nguyễn Văn A');
  });

  it('AC-PRO-01-03: Rejects duplicate phone number with 409 PHONE_ALREADY_EXISTS', async () => {
    await assert.rejects(
      async () => {
        await meService.updateMe(
          TEST_USER_ID,
          { phone: '0987654321' }, // Owned by OTHER_USER_ID
          '127.0.0.1',
          'corr-3'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 409);
        assert.strictEqual(err.code, 'PHONE_ALREADY_EXISTS');
        return true;
      }
    );
  });

  it('AC-PRO-01-04: Rejects invalid phone format with 400 INVALID_INPUT', async () => {
    await assert.rejects(
      async () => {
        await meService.updateMe(TEST_USER_ID, { phone: '12345' }, '127.0.0.1', 'corr-4');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'INVALID_INPUT');
        return true;
      }
    );
  });

  it('AC-PRO-01-05: Rejects privilege escalation attempts (role, store_scopes) with 403 PRIVILEGE_ESCALATION_DENIED', async () => {
    await assert.rejects(
      async () => {
        await meService.updateMe(TEST_USER_ID, { role: 'OWNER' } as any, '127.0.0.1', 'corr-5');
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
        return true;
      }
    );

    // Verify user role was NOT changed
    const user = mockPrisma.users.find((u) => u.id === TEST_USER_ID);
    assert.strictEqual(user.role, 'OPS_CSKH');
  });

  it('AC-PRO-01-06: Updates language, timezone, and non-critical notification preferences', async () => {
    const res = await meService.updateMyPreferences(
      TEST_USER_ID,
      {
        language: 'en',
        timezone: 'Asia/Bangkok',
        notification_preferences: {
          channels: { email: true, in_app: false, push: true },
          digest_window_minutes: 30,
          subscriptions: {
            delivery_fail: false,
            rate_discrepancy: false,
          },
        },
      },
      '127.0.0.1',
      'corr-6'
    );

    assert.strictEqual(res.data.language, 'en');
    assert.strictEqual(res.data.timezone, 'Asia/Bangkok');
    assert.strictEqual(res.data.notification_preferences.channels.push, true);
    assert.strictEqual(res.data.notification_preferences.digest_window_minutes, 30);
    assert.strictEqual(res.data.notification_preferences.subscriptions.delivery_fail, false);
    // Critical alert remains true
    assert.strictEqual(res.data.notification_preferences.subscriptions.security_alerts, true);

    // Verify audit log
    const log = mockPrisma.auditLogs.find((l) => l.action === 'PREFERENCES_UPDATED');
    assert.ok(log, 'PREFERENCES_UPDATED audit log must be recorded');
  });

  it('AC-PRO-01-07: Rejects attempts to disable critical alerts with 400 CANNOT_DISABLE_CRITICAL_NOTIFICATIONS', async () => {
    await assert.rejects(
      async () => {
        await meService.updateMyPreferences(
          TEST_USER_ID,
          {
            notification_preferences: {
              subscriptions: {
                security_alerts: false,
              },
            },
          },
          '127.0.0.1',
          'corr-7'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'CANNOT_DISABLE_CRITICAL_NOTIFICATIONS');
        return true;
      }
    );
  });

  it('AC-PRO-01-08: Rejects default warehouse assignment outside warehouse_scopes with 403 WAREHOUSE_SCOPE_UNAUTHORIZED', async () => {
    await assert.rejects(
      async () => {
        await meService.updateMe(
          TEST_USER_ID,
          { default_warehouse_id: 'wh-unauthorized-99' },
          '127.0.0.1',
          'corr-8'
        );
      },
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
        return true;
      }
    );
  });

  it('Validates IANA timezones correctly', () => {
    assert.strictEqual(isValidIanaTimezone('Asia/Ho_Chi_Minh'), true);
    assert.strictEqual(isValidIanaTimezone('UTC'), true);
    assert.strictEqual(isValidIanaTimezone('America/New_York'), true);
    assert.strictEqual(isValidIanaTimezone('Invalid/Timezone'), false);
  });
});
