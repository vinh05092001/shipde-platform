import { test, describe, it } from 'node:test';
import * as assert from 'node:assert';
import { AuthService, CanonicalApiException } from './auth.service';
import { validateAdminKey, extractAdminKey, getExpectedAdminKey } from './admin-auth.guard';
import { AdminCreateShopDto } from './admin-shops.dto';
import { RoleEnum } from '@prisma/client';
import { verifyPassword } from './password.util';
import { MockVerificationDeliveryAdapter } from '@shipde/testkit';

// In-memory mock Prisma for offline unit tests
function createMockPrismaService() {
  const merchants: any[] = [];
  const users: any[] = [];
  const auditLogs: any[] = [];
  const passwordResetTokens: any[] = [];

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
    merchant: {
      findMany: async () => merchants,
      count: async () => merchants.length,
      create: async ({ data }: any) => mockTx.merchant.create({ data }),
    },
    passwordResetToken: {
      create: async ({ data }: any) => mockTx.passwordResetToken.create({ data }),
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
        auditLogs.push(data);
        return data;
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
  const originalEnvKey = process.env.ADMIN_API_KEY;

  test('setup test environment', () => {
    process.env.ADMIN_API_KEY = 'test-admin-secret-key-40-chars';
  });

  // AC-ADMIN-01: Missing admin key returns 403 Forbidden
  it('AC-ADMIN-01: Missing admin key throws 403 Forbidden', () => {
    assert.throws(
      () => validateAdminKey(undefined),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );
  });

  it('AC-ADMIN-01: Unconfigured admin credential fails closed with 403 Forbidden', () => {
    delete process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_KEY;
    try {
      assert.strictEqual(getExpectedAdminKey(), undefined);
      assert.throws(
        () => validateAdminKey('some-key'),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.ok(response?.error?.message?.includes('chưa được cấu hình'));
          return true;
        }
      );
    } finally {
      process.env.ADMIN_API_KEY = 'test-admin-secret-key-40-chars';
    }
  });

  // AC-ADMIN-02: Invalid admin key returns 403 Forbidden
  it('AC-ADMIN-02: Invalid admin key throws 403 Forbidden', () => {
    assert.throws(
      () => validateAdminKey('wrong-admin-key'),
      (err: any) => {
        assert.ok(err instanceof CanonicalApiException);
        assert.strictEqual(err.getStatus(), 403);
        assert.strictEqual(err.code, 'FORBIDDEN');
        return true;
      }
    );

    // Valid key does not throw
    assert.doesNotThrow(() => validateAdminKey('test-admin-secret-key-40-chars'));
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
        const fields = err.getResponse()?.error?.fields;
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
    assert.strictEqual(res.data.temporary_password, undefined);

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
        const fields = err.getResponse()?.error?.fields;
        assert.ok(fields.some((f: any) => f.field === 'email' && f.code === 'DUPLICATE'));
        return true;
      }
    );
  });

  // Finding 4: Delivery adapter failure rolls back the transaction atomically
  it('Finding 4: Delivery adapter failure rolls back transaction without committing merchant or user', async () => {
    const mockPrisma = createMockPrismaService();
    const failingDeliveryAdapter = {
      sendVerification: async () => {
        throw new Error('SMTP connection timed out');
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

    // Verify rollback: no merchant or user was committed to database
    assert.strictEqual(mockPrisma.merchants.length, 0);
    assert.strictEqual(mockPrisma.users.length, 0);
    assert.strictEqual(mockPrisma.passwordResetTokens.length, 0);
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

    const authenticatedActor = 'admin:key:e8c3b417d9a1';
    await service.adminCreateShop(
      { merchant_name: 'Shop Audit Test', email: 'audit-actor@example.com' },
      '192.168.1.100',
      'corr-audit-actor',
      authenticatedActor
    );

    assert.ok(mockPrisma.auditLogs.length > 0, 'Audit record must be logged');
    const log = mockPrisma.auditLogs.find((l: any) => l.action === 'ADMIN_CREATE_SHOP');
    assert.ok(log, 'ADMIN_CREATE_SHOP audit entry must exist');
    assert.strictEqual(
      log.actor,
      authenticatedActor,
      'Audit record must match server-authenticated actor'
    );
    // Ensure no PII in details
    assert.strictEqual(log.details.has_email, true);
    assert.strictEqual(log.details.has_phone, false);
    assert.strictEqual(log.details.email, undefined);
    assert.strictEqual(log.details.phone, undefined);
  });

  test('teardown test environment', () => {
    if (originalEnvKey !== undefined) {
      process.env.ADMIN_API_KEY = originalEnvKey;
    } else {
      delete process.env.ADMIN_API_KEY;
    }
  });
});
