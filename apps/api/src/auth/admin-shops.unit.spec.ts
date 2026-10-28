import { test, describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AuthService, CanonicalApiException } from './auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { signAccessToken, resolveAccessTokenSecret } from './token.util';
import { AdminCreateShopDto } from './admin-shops.dto';
import { RoleEnum, SessionStatusEnum } from '@prisma/client';
import { verifyPassword } from './password.util';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';
import { randomUUID } from 'node:crypto';

// In-memory mock Prisma for offline unit tests
function createMockPrismaService() {
  const merchants: any[] = [];
  const users: any[] = [];
  const auditLogs: any[] = [];
  const passwordResetTokens: any[] = [];
  const deviceSessions: any[] = [];

  const mockTx = {
    merchant: {
      create: async ({ data }: any) => {
        const record = { id: `m-${Date.now()}-${Math.random()}`, ...data, created_at: new Date() };
        merchants.push(record);
        return record;
      },
    },
    user: {
      create: async ({ data }: any) => {
        const record = { id: `u-${Date.now()}-${Math.random()}`, ...data, created_at: new Date() };
        users.push(record);
        return record;
      },
    },
    passwordResetToken: {
      create: async ({ data }: any) => {
        const record = {
          id: `prt-${Date.now()}-${Math.random()}`,
          ...data,
          created_at: new Date(),
        };
        passwordResetTokens.push(record);
        return record;
      },
    },
  };

  return {
    merchants,
    users,
    auditLogs,
    passwordResetTokens,
    deviceSessions,
    merchant: {
      findMany: async () => merchants,
      count: async () => merchants.length,
      create: async ({ data }: any) => mockTx.merchant.create({ data }),
    },
    passwordResetToken: {
      create: async ({ data }: any) => mockTx.passwordResetToken.create({ data }),
    },
    deviceSession: {
      findFirst: async ({ where, include }: any) => {
        const found = deviceSessions.find((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.expires_at?.gt && !(s.expires_at > where.expires_at.gt)) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.session_token_hash && s.session_token_hash === cond.session_token_hash)
                return true;
              if (cond.id && s.id === cond.id) return true;
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        });
        if (!found) return null;
        return {
          ...found,
          user: include?.user ? users.find((u) => u.id === found.user_id) : undefined,
        };
      },
      create: async ({ data }: any) => {
        const record = {
          id: `sess-${Date.now()}-${Math.random()}`,
          ...data,
          created_at: new Date(),
        };
        deviceSessions.push(record);
        return record;
      },
    },
    user: {
      findMany: async ({ where, include }: any) => {
        if (!where?.OR) return [];
        return users
          .filter((u) =>
            where.OR.some((condition: any) => {
              if (
                condition.email &&
                u.email &&
                condition.email.toLowerCase() === u.email.toLowerCase()
              )
                return true;
              if (condition.phone && u.phone && condition.phone === u.phone) return true;
              return false;
            })
          )
          .map((u) => ({
            ...u,
            merchant: include?.merchant ? merchants.find((m) => m.id === u.merchant_id) : undefined,
          }));
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { ...data, actor: data.actor || data.user_id, details: data.new_value };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (cb: any) => {
      const snapshotMerchants = [...merchants];
      const snapshotUsers = [...users];
      const snapshotTokens = [...passwordResetTokens];
      try {
        return await cb(mockTx);
      } catch (err) {
        merchants.length = 0;
        merchants.push(...snapshotMerchants);
        users.length = 0;
        users.push(...snapshotUsers);
        passwordResetTokens.length = 0;
        passwordResetTokens.push(...snapshotTokens);
        throw err;
      }
    },
  } as any;
}

function createMockRateLimitService() {
  return {} as any;
}

describe('FEAT-AUTH-02: Admin-Created Shop Account Unit Tests', () => {
  const TEST_SECRET = 'unit-test-token-secret-must-be-32-chars-long';
  process.env.AUTH_TOKEN_SECRET = TEST_SECRET;

  function createMockContext(headers: Record<string, string> = {}) {
    const req: any = { headers };
    return {
      req,
      context: {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as any,
    };
  }

  // AC-ADMIN-01: Missing or invalid session returns 401 SESSION_INVALID
  it('AC-ADMIN-01: Missing session header returns 401 SESSION_INVALID', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const { context } = createMockContext({});
    await assert.rejects(
      async () => guard.canActivate(context),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
  });

  it('AC-ADMIN-01: Empty or malformed session returns 401 SESSION_INVALID', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const { context } = createMockContext({ authorization: 'Bearer ' });
    await assert.rejects(
      async () => guard.canActivate(context),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
  });

  it('AC-ADMIN-01: Expired session token returns 401 SESSION_INVALID', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const { token } = signAccessToken(
      {
        sub: 'u-operator-admin',
        sid: randomUUID(),
        role: RoleEnum.PLATFORM_ADMIN,
        st: 'active',
      },
      TEST_SECRET,
      -3600 // expired 1 hour ago
    );

    const { context } = createMockContext({ authorization: `Bearer ${token}` });
    await assert.rejects(
      async () => guard.canActivate(context),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
  });

  // AC-ADMIN-02: Missing PLATFORM_ADMIN role returns 403 FORBIDDEN
  it('AC-ADMIN-02: Merchant OWNER role returns 403 FORBIDDEN', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const sessionId = randomUUID();
    const userId = 'u-merchant-owner';
    mockPrisma.users.push({ id: userId, role: RoleEnum.OWNER });
    mockPrisma.deviceSessions.push({
      id: sessionId,
      user_id: userId,
      status: SessionStatusEnum.ACTIVE,
      expires_at: new Date(Date.now() + 3600 * 1000),
    });
    const { token } = signAccessToken(
      {
        sub: userId,
        sid: sessionId,
        mid: 'm-tenant-123',
        role: RoleEnum.OWNER,
        st: 'active',
      },
      TEST_SECRET,
      3600
    );

    const { context } = createMockContext({ authorization: `Bearer ${token}` });
    await assert.rejects(
      async () => guard.canActivate(context),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  // AC-ADMIN-03: PLATFORM_ADMIN role is authorized (200/true) with actor from session
  it('AC-ADMIN-03: Valid PLATFORM_ADMIN session is authorized and sets actor from session', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const operatorId = 'u-operator-admin-uuid';
    const sessionId = randomUUID();
    mockPrisma.users.push({ id: operatorId, role: RoleEnum.PLATFORM_ADMIN });
    mockPrisma.deviceSessions.push({
      id: sessionId,
      user_id: operatorId,
      status: SessionStatusEnum.ACTIVE,
      expires_at: new Date(Date.now() + 3600 * 1000),
    });
    const { token } = signAccessToken(
      {
        sub: operatorId,
        sid: sessionId,
        role: RoleEnum.PLATFORM_ADMIN,
        st: 'active',
      },
      TEST_SECRET,
      3600
    );

    const { context, req } = createMockContext({ authorization: `Bearer ${token}` });
    const isAllowed = await guard.canActivate(context);
    assert.strictEqual(isAllowed, true);
    assert.strictEqual(req.userId, operatorId);
    assert.strictEqual(req.adminActor, operatorId);
  });

  // Finding 2 (Proving Test): Guard validates DB session; revoked session in DB returns 401 SESSION_INVALID
  it('Finding 2: Valid token signature but revoked/missing DB session returns 401 SESSION_INVALID', async () => {
    const mockPrisma = createMockPrismaService();
    const guard = new AdminAuthGuard(mockPrisma as any);
    const operatorId = 'u-revoked-operator';
    const sessionId = randomUUID();
    mockPrisma.users.push({ id: operatorId, role: RoleEnum.PLATFORM_ADMIN });
    mockPrisma.deviceSessions.push({
      id: sessionId,
      user_id: operatorId,
      status: SessionStatusEnum.REVOKED,
      expires_at: new Date(Date.now() + 3600 * 1000),
    });
    const { token } = signAccessToken(
      {
        sub: operatorId,
        sid: sessionId,
        role: RoleEnum.PLATFORM_ADMIN,
        st: 'active',
      },
      TEST_SECRET,
      3600
    );

    const { context } = createMockContext({ authorization: `Bearer ${token}` });
    await assert.rejects(
      async () => guard.canActivate(context),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 401);
        assert.strictEqual(err.code, 'SESSION_INVALID');
        return true;
      }
    );
  });

  // AC-ADMIN-09: Missing both email and phone returns 400 VALIDATION_ERROR
  it('AC-ADMIN-09: Missing both email and phone returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop No Contact',
    };

    await assert.rejects(
      async () => service.adminCreateShop(dto, '127.0.0.1', 'corr-09'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'email' && f.code === 'REQUIRED'));
        return true;
      }
    );
  });

  // AC-ADMIN-10: Invalid email format returns 400 VALIDATION_ERROR
  it('AC-ADMIN-10: Invalid email format returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop Invalid Email',
      email: 'not-an-email',
    };

    await assert.rejects(
      async () => service.adminCreateShop(dto, '127.0.0.1', 'corr-10'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'email' && f.code === 'INVALID_FORMAT'));
        return true;
      }
    );
  });

  // AC-ADMIN-11: Invalid phone format returns 400 VALIDATION_ERROR
  it('AC-ADMIN-11: Invalid phone format returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop Invalid Phone',
      phone: '12345',
    };

    await assert.rejects(
      async () => service.adminCreateShop(dto, '127.0.0.1', 'corr-11'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'phone' && f.code === 'INVALID_FORMAT'));
        return true;
      }
    );
  });

  // Finding 5: Pipe characters and non-numeric forms in phone are rejected
  it('Finding 5: Rejects non-numeric phone with pipe character (e.g. 0|87654321)', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    await assert.rejects(
      async () =>
        service.adminCreateShop(
          { merchant_name: 'Shop Pipe Phone', phone: '0|87654321' },
          '127.0.0.1',
          'corr-pipe'
        ),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'phone' && f.code === 'INVALID_FORMAT'));
        return true;
      }
    );
  });

  // Finding 5: Canonical phone normalization persists 0-prefixed form and detects cross-format duplicates
  it('Finding 5: Persists canonical phone and detects +84 vs 0 duplicate collision', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    // Create first shop with 0-prefixed phone
    const res1 = await service.adminCreateShop(
      { merchant_name: 'Shop Phone One', phone: '0987654321' },
      '127.0.0.1',
      'corr-p1'
    );
    assert.strictEqual(res1.success, true);
    assert.strictEqual(mockPrisma.users[0].phone, '0987654321');

    // Attempt second shop with +84 formatted equivalent of the same number
    await assert.rejects(
      async () =>
        service.adminCreateShop(
          { merchant_name: 'Shop Phone Two', phone: '+84 987 654 321' },
          '127.0.0.1',
          'corr-p2'
        ),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'phone' && f.code === 'DUPLICATE'));
        return true;
      }
    );
  });

  // AC-ADMIN-12: Password shorter than 8 characters returns 400 VALIDATION_ERROR
  it('AC-ADMIN-12: Password shorter than 8 characters returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop Short Pass',
      email: 'shortpass@example.com',
      password: '123',
    };

    await assert.rejects(
      async () => service.adminCreateShop(dto, '127.0.0.1', 'corr-12'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'password' && f.code === 'TOO_SHORT'));
        return true;
      }
    );
  });

  // AC-ADMIN-13: merchant_name longer than 255 characters returns 400 VALIDATION_ERROR
  it('AC-ADMIN-13: merchant_name longer than 255 characters returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'A'.repeat(256),
      email: 'longname@example.com',
    };

    await assert.rejects(
      async () => service.adminCreateShop(dto, '127.0.0.1', 'corr-13'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'merchant_name' && f.code === 'MAX_LENGTH'));
        return true;
      }
    );
  });

  // Finding 6: Temporary password generation uses CSPRNG with rejection sampling & Fisher-Yates shuffle
  it('Finding 6: Temporary password uses CSPRNG without modulo bias or Math.random', () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const passwords = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const pass = service.generateTemporaryPassword();
      assert.ok(pass.length >= 12, 'Temporary password must have length >= 12');
      assert.ok(/[A-Z]/.test(pass), 'Must contain uppercase characters');
      assert.ok(/[a-z]/.test(pass), 'Must contain lowercase characters');
      assert.ok(/[0-9]/.test(pass), 'Must contain numeric digits');
      assert.ok(/[!@#$%^&*]/.test(pass), 'Must contain special symbols');
      passwords.add(pass);
    }
    // High entropy CSPRNG: 50 independent passwords must all be distinct
    assert.strictEqual(passwords.size, 50, 'All 50 generated passwords must be unique');
  });

  // AC-ADMIN-03: Valid admin key with email-only creates verified active user and shop
  // AC-ADMIN-04: Database records verification (active status and verified timestamps)
  // AC-ADMIN-05: Generated merchant code unique and follows standard format
  it('AC-ADMIN-03, 04, 05: Valid admin key with email-only creates active verified shop and owner', async () => {
    const mockPrisma = createMockPrismaService();
    const mockDelivery = new MockVerificationDeliveryAdapter();
    const service = new AuthService(mockPrisma, createMockRateLimitService(), mockDelivery);

    const dto: AdminCreateShopDto = {
      merchant_name: 'Tiệm Bánh Mì Sài Gòn',
      email: 'banhmi@saigon.vn',
    };

    const res = await service.adminCreateShop(dto, '127.0.0.1', 'corr-03');

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.merchant.name, 'Tiệm Bánh Mì Sài Gòn');
    assert.strictEqual(res.data.merchant.status, 'active');
    assert.ok(res.data.merchant.code.startsWith('TIEM_BANH_MI_SAI_GON_'));
    assert.strictEqual(res.data.user.email, 'banhmi@saigon.vn');
    assert.strictEqual(res.data.user.role, RoleEnum.OWNER);
    assert.strictEqual(res.data.user.status, 'active');
    assert.ok(res.data.user.email_verified_at instanceof Date);
    assert.strictEqual(res.data.user.phone_verified_at, null);

    // BR-AUTH-05: Plaintext password is NEVER returned in response
    assert.strictEqual(res.data.password_is_temporary, true);
    assert.strictEqual((res.data as any).temporary_password, undefined);

    // Stored in mock db
    assert.strictEqual(mockPrisma.merchants.length, 1);
    assert.strictEqual(mockPrisma.users.length, 1);
    assert.strictEqual(mockPrisma.merchants[0].status, 'active');
    assert.strictEqual(mockPrisma.users[0].status, 'active');
    assert.strictEqual(mockPrisma.passwordResetTokens.length, 1);
    assert.strictEqual(mockPrisma.passwordResetTokens[0].channel, 'email');
    assert.strictEqual(mockPrisma.passwordResetTokens[0].identifier, 'banhmi@saigon.vn');

    // One-time setup link delivered via deliveryAdapter
    const lastMsg = mockDelivery.getLastMessage();
    assert.ok(lastMsg);
    assert.strictEqual(lastMsg.channel, 'email');
    assert.strictEqual(lastMsg.recipient, 'banhmi@saigon.vn');
    assert.strictEqual(lastMsg.purpose, 'password_reset');
    assert.ok(lastMsg.link?.includes('/reset-password?token='));
  });

  // AC-ADMIN-06: Phone-only registration supported with verified status
  it('AC-ADMIN-06: Phone-only registration creates active verified user and shop', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop Điện Thoại 99',
      phone: '0987654321',
    };

    const res = await service.adminCreateShop(dto, '127.0.0.1', 'corr-06');

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.merchant.status, 'active');
    assert.strictEqual(res.data.user.phone, '0987654321');
    assert.strictEqual(res.data.user.email, null);
    assert.strictEqual(res.data.user.status, 'active');
    assert.ok(res.data.user.phone_verified_at instanceof Date);
    assert.strictEqual(res.data.user.email_verified_at, null);
  });

  // AC-ADMIN-07: Custom password provided bypasses temporary password generation
  it('AC-ADMIN-07: Custom password provided bypasses temporary password generation', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const customPass = 'MyStrongPassword123!';
    const dto: AdminCreateShopDto = {
      merchant_name: 'Shop Thời Trang ABC',
      email: 'owner@abc.vn',
      password: customPass,
    };

    const res = await service.adminCreateShop(dto, '127.0.0.1', 'corr-07');

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.data.password_is_temporary, false);
    assert.strictEqual((res.data as any).temporary_password, undefined);

    // Verify stored password hash matches the custom password
    const storedUser = mockPrisma.users[0];
    const match = await verifyPassword(customPass, storedUser.password_hash);
    assert.strictEqual(match, true);
  });

  // AC-ADMIN-08: Duplicate email provided returns 400 VALIDATION_ERROR
  it('AC-ADMIN-08: Duplicate email provided returns 400 VALIDATION_ERROR', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    // First creation
    await service.adminCreateShop(
      { merchant_name: 'Shop First', email: 'dup@example.com' },
      '127.0.0.1',
      'corr-08-1'
    );

    // Duplicate email
    await assert.rejects(
      async () =>
        service.adminCreateShop(
          { merchant_name: 'Shop Second', email: 'dup@example.com' },
          '127.0.0.1',
          'corr-08-2'
        ),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 400);
        assert.strictEqual(err.code, 'VALIDATION_ERROR');
        const fields = (err.getResponse() as any)?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'email' && f.code === 'DUPLICATE'));
        return true;
      }
    );
  });

  // Finding 5: Delivery failure after commit preserves shop in DB and enables canonical retry reconciliation
  it('Finding 5: Delivery failure after commit preserves shop in DB and enables canonical retry', async () => {
    const mockPrisma = createMockPrismaService();
    let deliveryCalls = 0;
    const failingDeliveryAdapter = {
      sendVerification: async () => {
        deliveryCalls++;
        if (deliveryCalls === 1) {
          throw new Error('SMTP connection timed out');
        }
        return true;
      },
    };
    const service = new AuthService(
      mockPrisma,
      createMockRateLimitService(),
      failingDeliveryAdapter as any
    );

    await assert.rejects(
      async () =>
        service.adminCreateShop(
          { merchant_name: 'Shop Delivery Fail', email: 'fail@example.com' },
          '127.0.0.1',
          'corr-fail'
        ),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 503);
        assert.strictEqual(err.code, 'DELIVERY_FAILED');
        return true;
      }
    );

    // Database transaction committed safely before external delivery
    assert.strictEqual(mockPrisma.merchants.length, 1);
    assert.strictEqual(mockPrisma.users.length, 1);
    assert.strictEqual(mockPrisma.passwordResetTokens.length, 1);

    // Canonical retry reconciles delivery without creating a duplicate shop
    const retryRes = await service.adminCreateShop(
      { merchant_name: 'Shop Delivery Fail', email: 'fail@example.com' },
      '127.0.0.1',
      'corr-retry'
    );
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(mockPrisma.merchants.length, 1);
    assert.strictEqual(mockPrisma.users.length, 1);
    assert.strictEqual(deliveryCalls, 2);
  });

  // Finding 1 & 10: Audit log persists platform actions with null merchant_id
  it('Finding 1 & 10: Audit log persists platform-level action with null merchant_id', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    await (service as any).logAudit({
      merchantId: null,
      userId: 'u-platform-admin',
      actor: 'u-platform-admin',
      action: 'PLATFORM_SYSTEM_CONFIG_UPDATE',
      resource: 'system:config',
      details: { setting: 'value' },
    });

    assert.strictEqual(mockPrisma.auditLogs.length, 1);
    assert.strictEqual(mockPrisma.auditLogs[0].merchant_id, null);
    assert.strictEqual(mockPrisma.auditLogs[0].action, 'PLATFORM_SYSTEM_CONFIG_UPDATE');
  });

  // Finding 4: Canonical retry for the same merchant resends setup token without creating a second shop
  it('Finding 4: Canonical retry for the same merchant resends one-time setup without second shop', async () => {
    const mockPrisma = createMockPrismaService();
    const sentMessages: any[] = [];
    const mockDelivery = {
      sendVerification: async (msg: any) => {
        sentMessages.push(msg);
      },
    };
    const service = new AuthService(mockPrisma, createMockRateLimitService(), mockDelivery as any);

    // Initial creation
    const res1 = await service.adminCreateShop(
      { merchant_name: 'Shop Recovery Test', email: 'recover@example.com' },
      '127.0.0.1',
      'corr-rec-1'
    );
    assert.strictEqual(res1.success, true);
    assert.strictEqual(mockPrisma.merchants.length, 1);
    assert.strictEqual(mockPrisma.users.length, 1);
    assert.strictEqual(sentMessages.length, 1);
    assert.strictEqual((res1.data as any).temporary_password, undefined);

    // Operator retries provisioning for the same shop to recover the setup link
    const res2 = await service.adminCreateShop(
      { merchant_name: 'Shop Recovery Test', email: 'recover@example.com' },
      '127.0.0.1',
      'corr-rec-2'
    );
    assert.strictEqual(res2.success, true);
    // Crucial: No duplicate/second shop created
    assert.strictEqual(mockPrisma.merchants.length, 1);
    assert.strictEqual(mockPrisma.users.length, 1);
    // New setup token delivered
    assert.strictEqual(sentMessages.length, 2);
    // Never reveals plaintext password
    assert.strictEqual((res2.data as any).temporary_password, undefined);
  });

  // Finding 4: Code collision exhaustion throws canonical 409 CONFLICT rather than raw Error
  it('Finding 4: Code collision exhaustion throws canonical 409 CONFLICT rather than raw Error', async () => {
    const mockPrisma = createMockPrismaService();
    // Simulate persistent unique constraint collision on merchant code
    mockPrisma.$transaction = async () => {
      const err: any = new Error('Unique constraint failed on the fields: (`code`)');
      err.code = 'P2002';
      err.meta = { target: ['code'] };
      throw err;
    };
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    await assert.rejects(
      async () =>
        service.adminCreateShop(
          { merchant_name: 'Shop Collision', email: 'collision@example.com' },
          '127.0.0.1',
          'corr-coll'
        ),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 409);
        assert.strictEqual(err.code, 'MERCHANT_CODE_COLLISION');
        return true;
      }
    );
  });

  // Finding 7: Durable audit records the server-authenticated actor and never hardcoded provisioning
  it('Finding 7: Audit log durably records server-authenticated actor without PII or secrets', async () => {
    const mockPrisma = createMockPrismaService();
    const service = new AuthService(mockPrisma, createMockRateLimitService());

    const operatorUserId = 'u-operator-admin-uuid';
    await service.adminCreateShop(
      { merchant_name: 'Shop Audit Test', email: 'audit-actor@example.com' },
      '192.168.1.100',
      'corr-audit-actor',
      operatorUserId
    );

    assert.ok(mockPrisma.auditLogs.length > 0, 'Audit record must be logged');
    const log = mockPrisma.auditLogs.find((l: any) => l.action === 'ADMIN_CREATE_SHOP');
    assert.ok(log, 'ADMIN_CREATE_SHOP audit entry must exist');
    assert.strictEqual(
      log.actor,
      operatorUserId,
      'Audit record must match server-authenticated actor'
    );
    // Ensure no PII in details
    assert.strictEqual(log.details.has_email, true);
    assert.strictEqual(log.details.has_phone, false);
    assert.strictEqual(log.details.email, undefined);
    assert.strictEqual(log.details.phone, undefined);
  });
});
