import * as assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  InvitationsService,
  maskIdentifier,
  validatePasswordStrength,
  canonicalizePhoneNumber,
} from './invitations.service';
import { resolveFrontendBaseUrl } from './invitation-url.util';
import { UsersService } from '../users/users.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { RoleEnum, InvitationStatusEnum } from '@prisma/client';
import { CanonicalApiException } from '../auth/auth.service';
import { HttpStatus } from '@nestjs/common';

describe('FEAT-USR-01 — User Invitations Unit Specification', () => {
  let mockPrisma: any;
  let service: InvitationsService;

  const MERCHANT_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_MERCHANT_ID = '22222222-2222-2222-2222-222222222222';
  const OWNER_USER_ID = '33333333-3333-3333-3333-333333333333';
  const OPS_USER_ID = '44444444-4444-4444-4444-444444444444';
  const WAREHOUSE_USER_ID = '55555555-5555-5555-5555-555555555555';

  beforeEach(() => {
    mockPrisma = {
      user: {
        findFirst: async (args: any) => {
          if (args?.where?.id) {
            if (args.where.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: RoleEnum.OWNER,
                store_scopes: ['*'],
                warehouse_scopes: ['*'],
                status: 'active',
              };
            }
            if (args.where.id === OPS_USER_ID) {
              return {
                id: OPS_USER_ID,
                merchant_id: MERCHANT_ID,
                role: RoleEnum.OPS_CSKH,
                store_scopes: ['STORE-01'],
                warehouse_scopes: ['WH-01'],
                status: 'active',
              };
            }
            if (args.where.id === WAREHOUSE_USER_ID) {
              return {
                id: WAREHOUSE_USER_ID,
                merchant_id: MERCHANT_ID,
                role: RoleEnum.WAREHOUSE,
                store_scopes: [],
                warehouse_scopes: ['WH-01'],
                status: 'active',
              };
            }
            return null;
          }
          return null;
        },
        findUnique: async () => null,
        create: async (args: any) => ({
          id: 'new-user-uuid',
          ...args.data,
        }),
      },
      invitation: {
        findFirst: async () => null,
        findUnique: async () => null,
        findMany: async () => [],
        count: async () => 0,
        create: async (args: any) => ({
          id: 'new-invite-uuid',
          created_at: new Date(),
          updated_at: new Date(),
          consumed_at: null,
          ...args.data,
        }),
        update: async (args: any) => ({
          id: args.where.id,
          ...args.data,
        }),
        updateMany: async () => ({ count: 1 }),
        deleteMany: async () => ({ count: 1 }),
        update: async (args: any) => ({ id: args?.where?.id, ...args?.data }),
        delete: async (args: any) => ({ id: args?.where?.id }),
      },
      merchant: {
        findUnique: async () => ({
          id: MERCHANT_ID,
          name: 'Test Fashion Shop',
          code: 'TEST_FASHION',
        }),
      },
      auditLog: {
        create: async (args: any) => ({
          id: 'audit-log-uuid',
          ...args.data,
        }),
        deleteMany: async () => ({ count: 0 }),
      },
      $transaction: async (arg: any) =>
        typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
    };

    const defaultDeliveryAdapter = {
      sendVerification: async () => ({ success: true, messageId: 'msg-default' }),
    };
    service = new InvitationsService(mockPrisma, defaultDeliveryAdapter as any);
  });

  // AC-USR-01-18: Zero plaintext token or password leakage; masking utility
  describe('Helper Functions & Security Assertions (AC-USR-01-18)', () => {
    it('masks email identifiers properly without leaking full username', () => {
      assert.strictEqual(maskIdentifier('longusername@shipde.vn'), 'l****e@shipde.vn');
      assert.strictEqual(maskIdentifier('ab@shipde.vn'), 'a*@shipde.vn');
      assert.strictEqual(maskIdentifier(''), '');
    });

    it('masks phone numbers properly, hiding middle 4 digits', () => {
      assert.strictEqual(maskIdentifier('0901234567'), '090****567');
      assert.strictEqual(maskIdentifier('+84901234567'), '+84****567');
    });

    it('enforces password complexity criteria (AC-USR-01-16)', () => {
      const weakShort = validatePasswordStrength('Short1!');
      assert.strictEqual(weakShort.valid, false);

      const weakNoUpper = validatePasswordStrength('lowercase123!@#');
      assert.strictEqual(weakNoUpper.valid, false);

      const weakNoSpecial = validatePasswordStrength('Uppercase1234');
      assert.strictEqual(weakNoSpecial.valid, false);

      const strong = validatePasswordStrength('StrongPassword123!');
      assert.strictEqual(strong.valid, true);
      assert.strictEqual(strong.errors.length, 0);
    });
  });

  // AC-USR-01-01: Owner invites new operator with valid email and warehouse scope
  describe('AC-USR-01-01: Owner invites new operator with email and warehouse scope', () => {
    it('creates invitation with PENDING status, SHA-256 hashed token, 7-day expiry and INVITATION_SENT audit log', async () => {
      let createdInviteData: any = null;
      let createdAuditData: any = null;

      mockPrisma.invitation.create = async (args: any) => {
        createdInviteData = args.data;
        return {
          id: 'inv-123',
          created_at: new Date(),
          consumed_at: null,
          ...args.data,
        };
      };

      mockPrisma.auditLog.create = async (args: any) => {
        createdAuditData = args.data;
        return { id: 'audit-123', ...args.data };
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.createInvitation(
        {
          email: 'operator@shipde.vn',
          role: RoleEnum.OPS_CSKH,
          warehouse_scopes: ['WH-HCM-01'],
          store_scopes: ['STORE-Q1'],
        },
        actor,
        '127.0.0.1',
        'test-corr-01'
      );

      assert.strictEqual(res.data.email, 'operator@shipde.vn');
      assert.strictEqual(res.data.status, InvitationStatusEnum.PENDING);
      assert.deepStrictEqual(res.data.warehouse_scopes, ['WH-HCM-01']);
      // Security NFR / BR-INV-02: Zero raw token or invitation_url in admin response
      assert.strictEqual((res.data as any).token, undefined);
      assert.strictEqual((res.data as any).invitation_url, undefined);

      // Database assertion (AC-USR-01-01, AC-USR-01-18)
      assert.ok(createdInviteData);
      assert.strictEqual(
        createdInviteData.token_hash.length,
        64,
        'SHA-256 hash must be 64 hex characters'
      );

      // Expiry check (7 days = 168 hours)
      const expiryDiffMs = new Date(createdInviteData.expires_at).getTime() - Date.now();
      const expiryDays = Math.round(expiryDiffMs / (24 * 60 * 60 * 1000));
      assert.strictEqual(expiryDays, 7);

      // Audit log assertion (BR-INV-09)
      assert.ok(createdAuditData);
      assert.strictEqual(createdAuditData.action, 'INVITATION_SENT');
      assert.strictEqual(createdAuditData.merchant_id, MERCHANT_ID);
      assert.strictEqual(createdAuditData.user_id, OWNER_USER_ID);
      assert.strictEqual(typeof createdAuditData.new_value.invitation_id, 'string');
      assert.strictEqual(
        JSON.stringify(createdAuditData).includes(res.data.token),
        false,
        'Audit log must never contain raw plaintext token'
      );
    });

    it('dispatches invitation through configured delivery adapter using frontend origin (Finding 4)', async () => {
      const prevFrontendUrl = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'https://app.shipde.vn';
      try {
        let dispatchedParams: any = null;
        const mockDeliveryAdapter = {
          sendVerification: async (params: any) => {
            dispatchedParams = params;
            return { success: true, messageId: 'msg-mock' };
          },
        };

        const customService = new InvitationsService(mockPrisma, mockDeliveryAdapter as any);
        const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
        const frontendOrigin = 'https://app.shipde.vn';

        const res = await customService.createInvitation(
          {
            email: 'dispatch_test@shipde.vn',
            role: RoleEnum.OPS_CSKH,
          },
          actor,
          '127.0.0.1',
          'test-corr-dispatch',
          frontendOrigin
        );

        assert.strictEqual((res.data as any).token, undefined);
        assert.strictEqual((res.data as any).invitation_url, undefined);
        assert.ok(dispatchedParams);
        assert.ok(dispatchedParams.link.startsWith('https://app.shipde.vn/invite/accept?token='));
        assert.strictEqual(dispatchedParams.recipient, 'dispatch_test@shipde.vn');
        assert.strictEqual(dispatchedParams.channel, 'email');
        assert.strictEqual(dispatchedParams.purpose, 'invitation');
      } finally {
        process.env.FRONTEND_URL = prevFrontendUrl;
      }
    });

    it('fails closed with 502 DELIVERY_FAILED when delivery adapter fails to send (Finding 2)', async () => {
      const failingAdapter = {
        sendVerification: async () => ({ success: false, messageId: '' }),
      };
      const failingService = new InvitationsService(mockPrisma, failingAdapter as any);
      await assert.rejects(
        () =>
          failingService.createInvitation(
            { email: 'delivery_fail@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '127.0.0.1',
            'corr-fail'
          ),
        (err: any) => {
          assert.strictEqual(err.code, 'DELIVERY_FAILED');
          assert.strictEqual(err.status, 502);
          return true;
        }
      );
    });

    it('rejects untrusted Origin / base URL and falls back strictly to configured FRONTEND_URL (Finding 1)', async () => {
      const prevFrontendUrl = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'https://portal.shipde.vn';
      try {
        let dispatchedParams: any = null;
        const mockDeliveryAdapter = {
          sendVerification: async (params: any) => {
            dispatchedParams = params;
            return { success: true, messageId: 'msg-mock' };
          },
        };

        const customService = new InvitationsService(mockPrisma, mockDeliveryAdapter as any);
        const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
        const attackerHost = 'https://attacker.evil.com';

        const res = await customService.createInvitation(
          {
            email: 'untrusted_origin@shipde.vn',
            role: RoleEnum.OPS_CSKH,
          },
          actor,
          '127.0.0.1',
          'test-corr-untrusted-origin',
          attackerHost
        );

        // Security assertion: must NOT leak raw token in admin JSON response
        assert.strictEqual((res.data as any).token, undefined);
        assert.strictEqual((res.data as any).invitation_url, undefined);
        assert.ok(dispatchedParams);
        assert.ok(!dispatchedParams.link.includes('attacker.evil.com'));
        assert.ok(
          dispatchedParams.link.startsWith('https://portal.shipde.vn/invite/accept?token=')
        );
      } finally {
        process.env.FRONTEND_URL = prevFrontendUrl;
      }
    });

    it('disallows localhost / 127.0.0.1 origins when NODE_ENV is production (Finding 6)', () => {
      const prevNodeEnv = process.env.NODE_ENV;
      const prevFrontendUrl = process.env.FRONTEND_URL;
      try {
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_URL = 'https://portal.shipde.vn';

        const resolved = resolveFrontendBaseUrl('http://localhost:3000');
        assert.strictEqual(resolved, 'https://portal.shipde.vn');

        const resolvedIp = resolveFrontendBaseUrl('http://127.0.0.1:3000');
        assert.strictEqual(resolvedIp, 'https://portal.shipde.vn');

        const resolvedProd = resolveFrontendBaseUrl('https://portal.shipde.vn');
        assert.strictEqual(resolvedProd, 'https://portal.shipde.vn');
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
        process.env.FRONTEND_URL = prevFrontendUrl;
      }
    });
  });

  // AC-USR-01-02: Owner invites new operator with phone identifier
  describe('AC-USR-01-02: Phone-based invitation', () => {
    it('creates phone-based invitation with PENDING status', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.createInvitation(
        {
          phone: '0901234567',
          role: RoleEnum.WAREHOUSE,
        },
        actor,
        '127.0.0.1',
        'test-corr-02'
      );

      assert.strictEqual(res.data.phone, '0901234567');
      assert.strictEqual(res.data.role, RoleEnum.WAREHOUSE);
      assert.strictEqual(res.data.status, InvitationStatusEnum.PENDING);
    });
  });

  // AC-USR-01-03: Non-owner manager attempts to invite a user with OWNER role or role/scopes they do not hold
  describe('AC-USR-01-03: Privilege Ceiling Exceeded', () => {
    it('rejects non-owner inviting OWNER with 403 FORBIDDEN', async () => {
      const actor = { userId: OPS_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OPS_CSKH };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'newowner@shipde.vn',
              role: RoleEnum.OWNER,
            },
            actor,
            '127.0.0.1',
            'test-corr-03'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('rejects OPS_CSKH inviting ACCOUNTANT with 403 FORBIDDEN', async () => {
      const actor = { userId: OPS_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OPS_CSKH };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'accountant@shipde.vn',
              role: RoleEnum.ACCOUNTANT,
            },
            actor,
            '127.0.0.1',
            'test-corr-03b'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.ok(response?.error?.message?.includes('vai trò ACCOUNTANT'));
          return true;
        }
      );
    });

    it('rejects OPS_CSKH inviting WAREHOUSE with 403 FORBIDDEN', async () => {
      const actor = { userId: OPS_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OPS_CSKH };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'warehouse@shipde.vn',
              role: RoleEnum.WAREHOUSE,
            },
            actor,
            '127.0.0.1',
            'test-corr-03c'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('rejects OPS_CSKH assigning warehouse scopes outside actor live scopes with 403 FORBIDDEN', async () => {
      const actor = {
        userId: OPS_USER_ID,
        merchantId: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        warehouse_scopes: ['WH-01'],
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'ops2@shipde.vn',
              role: RoleEnum.OPS_CSKH,
              warehouse_scopes: ['WH-01', 'WH-UNAUTHORIZED'],
            },
            actor,
            '127.0.0.1',
            'test-corr-03d'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.ok(response?.error?.message?.includes('Kho hàng không thuộc phạm vi quản lý'));
          return true;
        }
      );
    });

    it('rejects OPS_CSKH assigning store scopes outside actor live scopes with 403 FORBIDDEN', async () => {
      const actor = {
        userId: OPS_USER_ID,
        merchantId: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['STORE-01'],
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'ops3@shipde.vn',
              role: RoleEnum.OPS_CSKH,
              store_scopes: ['STORE-01', 'STORE-UNAUTHORIZED'],
            },
            actor,
            '127.0.0.1',
            'test-corr-03e'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.ok(response?.error?.message?.includes('Chi nhánh không thuộc phạm vi quản lý'));
          return true;
        }
      );
    });

    it('allows OPS_CSKH inviting OPS_CSKH within live store and warehouse scopes', async () => {
      const actor = {
        userId: OPS_USER_ID,
        merchantId: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['STORE-01'],
        warehouse_scopes: ['WH-01'],
      };

      const res = await service.createInvitation(
        {
          email: 'ops_allowed@shipde.vn',
          role: RoleEnum.OPS_CSKH,
          store_scopes: ['STORE-01'],
          warehouse_scopes: ['WH-01'],
        },
        actor,
        '127.0.0.1',
        'test-corr-03f'
      );

      assert.strictEqual(res.data.role, RoleEnum.OPS_CSKH);
      assert.deepStrictEqual(res.data.store_scopes, ['STORE-01']);
      assert.deepStrictEqual(res.data.warehouse_scopes, ['WH-01']);
    });
  });

  // AC-USR-01-04: User without Manage users/roles permission attempts to send invite
  describe('AC-USR-01-04: Unauthorized actor denied', () => {
    it('rejects WAREHOUSE actor attempting to send invite with 403 FORBIDDEN', async () => {
      const actor = {
        userId: WAREHOUSE_USER_ID,
        merchantId: MERCHANT_ID,
        role: RoleEnum.WAREHOUSE,
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'warehouse2@shipde.vn',
              role: RoleEnum.WAREHOUSE,
            },
            actor,
            '127.0.0.1',
            'test-corr-04'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('rejects demoted actor even if caller claims role OWNER in token (Finding 7)', async () => {
      // Live DB row has been demoted to WAREHOUSE
      mockPrisma.user.findFirst = async (args: any) => {
        if (args?.where?.id === 'demoted-user-id') {
          return {
            id: 'demoted-user-id',
            role: RoleEnum.WAREHOUSE,
            store_scopes: [],
            warehouse_scopes: [],
            status: 'active',
          };
        }
        return null;
      };

      const actor = {
        userId: 'demoted-user-id',
        merchantId: MERCHANT_ID,
        role: RoleEnum.OWNER, // Stale token claims OWNER
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'newuser@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor,
            '127.0.0.1',
            'test-corr-demoted'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('rejects suspended/disabled/non-active actor with 403 FORBIDDEN (Finding 4)', async () => {
      mockPrisma.user.findFirst = async (args: any) => {
        if (args?.where?.id === 'suspended-user-id') {
          return {
            id: 'suspended-user-id',
            role: RoleEnum.OWNER,
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
            status: 'suspended', // Suspended owner account!
          };
        }
        return null;
      };

      const actor = {
        userId: 'suspended-user-id',
        merchantId: MERCHANT_ID,
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'test@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor,
            '127.0.0.1',
            'test-corr-suspended'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message.includes('vô hiệu hóa'));
          return true;
        }
      );
    });

    it('rejects actor when DB user row is missing, ignoring caller-supplied role fallback (Finding 5)', async () => {
      // DB user is not found
      mockPrisma.user.findFirst = async () => null;

      const actor = {
        userId: 'non-existent-user-id',
        merchantId: MERCHANT_ID,
        role: RoleEnum.OWNER, // Caller attempts to inject OWNER claim
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
      };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'test@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor as any,
            '127.0.0.1',
            'test-corr-fallback-check'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });
  });

  // AC-USR-01-05: Invite sent to email already active in tenant
  describe('AC-USR-01-05: Duplicate active user rejected', () => {
    it('returns 400 USER_ALREADY_EXISTS when identifier belongs to active account', async () => {
      mockPrisma.user.findFirst = async (args: any) => {
        if (args?.where?.id === OWNER_USER_ID) {
          return {
            id: OWNER_USER_ID,
            merchant_id: MERCHANT_ID,
            role: RoleEnum.OWNER,
            store_scopes: ['*'],
            warehouse_scopes: ['*'],
            status: 'active',
          };
        }
        return {
          id: 'existing-user-uuid',
          email: 'active@shipde.vn',
          merchant_id: MERCHANT_ID,
          status: 'active',
        };
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'active@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor,
            '127.0.0.1',
            'test-corr-05'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'USER_ALREADY_EXISTS');
          return true;
        }
      );
    });
  });

  // AC-USR-01-06: Invite sent to email with pending unexpired invite
  describe('AC-USR-01-06: Duplicate pending invitation rejected', () => {
    it('returns 400 INVITATION_ALREADY_PENDING suggesting resend action', async () => {
      mockPrisma.invitation.findFirst = async () => ({
        id: 'pending-invite-uuid',
        email: 'pending@shipde.vn',
        merchant_id: MERCHANT_ID,
        status: InvitationStatusEnum.PENDING,
        expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'pending@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor,
            '127.0.0.1',
            'test-corr-06'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_PENDING');
          return true;
        }
      );
    });

    it('maps P2002 partial unique index constraint violation on concurrent insert to 400 INVITATION_ALREADY_PENDING', async () => {
      mockPrisma.invitation.findFirst = async () => null; // Check-then-insert race: read passed
      mockPrisma.invitation.create = async () => {
        const err: any = new Error(
          'Unique constraint failed on the fields: (`merchant_id`,`email`)'
        );
        err.code = 'P2002';
        err.meta = { target: ['invitations_merchant_pending_email_unique'] };
        throw err;
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            {
              email: 'concurrent_pending@shipde.vn',
              role: RoleEnum.OPS_CSKH,
            },
            actor,
            '127.0.0.1',
            'test-corr-06b'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_PENDING');
          return true;
        }
      );
    });

    it('expires time-elapsed PENDING invitations in-transaction before insert, preventing P2002 collision (Finding 3)', async () => {
      let updateManyCalledWith: any = null;
      let createdInvite: any = null;
      mockPrisma.invitation.findFirst = async () => null; // unexpired pending check returns null
      mockPrisma.invitation.updateMany = async (args: any) => {
        updateManyCalledWith = args;
        return { count: 1 };
      };
      mockPrisma.invitation.create = async (args: any) => {
        createdInvite = {
          id: 'fresh-invite-uuid',
          ...args.data,
          created_at: new Date(),
        };
        return createdInvite;
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.createInvitation(
        { email: 'expired_prev@shipde.vn', role: RoleEnum.OPS_CSKH },
        actor,
        '127.0.0.1',
        'test-corr-expire-first'
      );

      assert.strictEqual(res.data.id, 'fresh-invite-uuid');
      assert.ok(updateManyCalledWith);
      assert.strictEqual(updateManyCalledWith.where.status, InvitationStatusEnum.PENDING);
      assert.ok(updateManyCalledWith.where.expires_at.lte);
      assert.strictEqual(updateManyCalledWith.data.status, InvitationStatusEnum.EXPIRED);
    });
  });

  // AC-USR-01-07: Missing required recipient identifier or role
  describe('AC-USR-01-07: Validation error on missing fields', () => {
    it('returns 400 VALIDATION_ERROR when email and phone are omitted', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            { role: RoleEnum.OPS_CSKH },
            actor,
            '127.0.0.1',
            'test-corr-07'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    it('returns 400 VALIDATION_ERROR when role is missing or invalid', async () => {
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.createInvitation(
            { email: 'test@shipde.vn', role: 'INVALID_ROLE' as any },
            actor,
            '127.0.0.1',
            'test-corr-07b'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });
  });

  // AC-USR-01-08: Owner lists invitations (scoped to merchant, raw tokens omitted)
  describe('AC-USR-01-08: Owner lists invitations', () => {
    it('returns list of invitations scoped to merchant and omits raw tokens and token_hash', async () => {
      mockPrisma.invitation.findMany = async (args: any) => {
        assert.strictEqual(args.where.merchant_id, MERCHANT_ID);
        return [
          {
            id: 'inv-1',
            merchant_id: MERCHANT_ID,
            email: 'user1@shipde.vn',
            phone: null,
            role: RoleEnum.OPS_CSKH,
            store_scopes: ['S1'],
            warehouse_scopes: ['W1'],
            token_hash: 'secret-hash-1',
            status: InvitationStatusEnum.PENDING,
            invited_by_user_id: OWNER_USER_ID,
            expires_at: new Date(Date.now() + 86400000),
            created_at: new Date(),
            consumed_at: null,
          },
        ];
      };
      mockPrisma.invitation.count = async () => 1;

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.listInvitations(actor, { page: 1, limit: 10 }, 'test-corr-08');

      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].email, 'user1@shipde.vn');
      assert.strictEqual((res.data[0] as any).token_hash, undefined, 'token_hash must be omitted');
      assert.strictEqual((res.data[0] as any).token, undefined, 'token must be omitted');
    });

    it('persists and filters EXPIRED status for expired invitations (Finding 8)', async () => {
      let updateManyCalled = false;
      let findManyWhere: any = null;
      mockPrisma.invitation.updateMany = async (args: any) => {
        if (args?.where?.status === InvitationStatusEnum.PENDING && args?.where?.expires_at) {
          updateManyCalled = true;
        }
        return { count: 1 };
      };
      mockPrisma.invitation.findMany = async (args: any) => {
        findManyWhere = args.where;
        return [
          {
            id: 'expired-1',
            merchant_id: MERCHANT_ID,
            email: 'expired@shipde.vn',
            role: RoleEnum.OPS_CSKH,
            store_scopes: [],
            warehouse_scopes: [],
            token_hash: 'hash-exp',
            status: InvitationStatusEnum.EXPIRED,
            invited_by_user_id: OWNER_USER_ID,
            expires_at: new Date(Date.now() - 10000),
            created_at: new Date(),
            consumed_at: null,
          },
        ];
      };
      mockPrisma.invitation.count = async () => 1;

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.listInvitations(actor, { status: 'EXPIRED' }, 'test-corr-exp');

      assert.strictEqual(updateManyCalled, true);
      assert.ok(findManyWhere.OR);
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].status, InvitationStatusEnum.EXPIRED);
    });
  });

  // AC-USR-01-09: Owner resends an expired invitation
  describe('AC-USR-01-09: Resending expired invitation', () => {
    it('regenerates token, sets status to PENDING, extends expiry 7 days, and writes INVITATION_RESENT audit log', async () => {
      const existingExpired = {
        id: 'expired-inv-id',
        merchant_id: MERCHANT_ID,
        email: 'expired@shipde.vn',
        role: RoleEnum.OPS_CSKH,
        status: InvitationStatusEnum.EXPIRED,
        expires_at: new Date(Date.now() - 3600000),
        consumed_at: null,
        token_hash: 'old-hash',
      };

      let updateManyCalledWith: any = null;
      mockPrisma.invitation.findUnique = async () => ({
        ...existingExpired,
        status: updateManyCalledWith ? InvitationStatusEnum.PENDING : existingExpired.status,
      });
      mockPrisma.invitation.updateMany = async (args: any) => {
        updateManyCalledWith = args;
        return { count: 1 };
      };

      let auditCreated: any = null;
      mockPrisma.auditLog.create = async (args: any) => {
        auditCreated = args.data;
        return { id: 'audit-resend', ...args.data };
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.resendInvitation(
        'expired-inv-id',
        actor,
        '127.0.0.1',
        'test-corr-09'
      );

      assert.strictEqual(res.data.status, InvitationStatusEnum.PENDING);
      assert.strictEqual((res.data as any).token, undefined);
      assert.strictEqual((res.data as any).invitation_url, undefined);
      assert.deepStrictEqual(updateManyCalledWith.where.status, {
        in: [InvitationStatusEnum.PENDING, InvitationStatusEnum.EXPIRED],
      });
      assert.strictEqual(updateManyCalledWith.where.consumed_at, null);
      assert.strictEqual(updateManyCalledWith.data.status, InvitationStatusEnum.PENDING);
      assert.notStrictEqual(updateManyCalledWith.data.token_hash, 'old-hash');

      assert.ok(auditCreated);
      assert.strictEqual(auditCreated.action, 'INVITATION_RESENT');
      // Finding 4: target_identifier_masked, merchant_id, actor_id, and correlation_id (BR-INV-09)
      assert.strictEqual(auditCreated.new_value.target_identifier_masked, 'e****d@shipde.vn');
      assert.strictEqual(auditCreated.new_value.merchant_id, MERCHANT_ID);
      assert.strictEqual(auditCreated.new_value.actor_id, OWNER_USER_ID);
      assert.strictEqual(auditCreated.new_value.correlation_id, 'test-corr-09');
    });

    it('rejects resend with 400 INVITATION_ALREADY_USED when concurrent accept committed (count === 0)', async () => {
      const existingAccepted = {
        id: 'concurrent-accepted-id',
        merchant_id: MERCHANT_ID,
        email: 'concurrent@shipde.vn',
        role: RoleEnum.OPS_CSKH,
        status: InvitationStatusEnum.ACCEPTED,
        consumed_at: new Date(),
        token_hash: 'token-hash',
      };

      // Initial read before race sees PENDING, but atomic updateMany finds 0 rows because accepted
      let readCount = 0;
      mockPrisma.invitation.findUnique = async () => {
        readCount++;
        if (readCount === 1) {
          return { ...existingAccepted, status: InvitationStatusEnum.PENDING, consumed_at: null };
        }
        return existingAccepted;
      };
      mockPrisma.invitation.updateMany = async () => ({ count: 0 });

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      await assert.rejects(
        async () => {
          await service.resendInvitation(
            'concurrent-accepted-id',
            actor,
            '127.0.0.1',
            'test-corr-09-race'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_USED');
          return true;
        }
      );
    });

    it('rejects non-owner resending invitation with role or scope exceeding actor privilege ceiling (Finding 3)', async () => {
      const opsActor = {
        userId: OPS_USER_ID,
        merchantId: MERCHANT_ID,
      };

      // Case 1: OPS_CSKH trying to resend WAREHOUSE role invitation
      mockPrisma.invitation.findUnique = async () => ({
        id: 'wh-inv-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.WAREHOUSE,
        store_scopes: [],
        warehouse_scopes: ['WH-01'],
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
      });

      await assert.rejects(
        async () => {
          await service.resendInvitation(
            'wh-inv-id',
            opsActor,
            '127.0.0.1',
            'test-corr-resend-role'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message.includes('vượt quá quyền hạn'));
          return true;
        }
      );

      // Case 2: OPS_CSKH trying to resend invite with warehouse outside their scope
      mockPrisma.invitation.findUnique = async () => ({
        id: 'scope-inv-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['STORE-01'],
        warehouse_scopes: ['WH-UNAUTHORIZED'],
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
      });

      await assert.rejects(
        async () => {
          await service.resendInvitation(
            'scope-inv-id',
            opsActor,
            '127.0.0.1',
            'test-corr-resend-scope'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message.includes('Kho hàng không thuộc phạm vi quản lý'));
          return true;
        }
      );
    });
  });

  // AC-USR-01-10: Owner cancels a pending invitation
  describe('AC-USR-01-10: Owner cancels pending invitation', () => {
    it('transitions status PENDING -> CANCELLED, rotates token_hash, and logs INVITATION_CANCELLED', async () => {
      const pendingInvite = {
        id: 'pending-inv-id',
        merchant_id: MERCHANT_ID,
        email: 'cancel_pending@shipde.vn',
        role: RoleEnum.OPS_CSKH,
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
        token_hash: 'initial-pending-hash',
      };

      let updateManyCalledWith: any = null;
      mockPrisma.invitation.findUnique = async () => ({
        ...pendingInvite,
        status: InvitationStatusEnum.CANCELLED,
        token_hash: updateManyCalledWith?.data?.token_hash,
      });
      mockPrisma.invitation.updateMany = async (args: any) => {
        updateManyCalledWith = args;
        return { count: 1 };
      };

      let auditCreated: any = null;
      mockPrisma.auditLog.create = async (args: any) => {
        auditCreated = args.data;
        return { id: 'audit-cancel', ...args.data };
      };

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      const res = await service.cancelInvitation(
        'pending-inv-id',
        actor,
        '127.0.0.1',
        'test-corr-10'
      );

      assert.strictEqual(res.data.status, InvitationStatusEnum.CANCELLED);
      assert.strictEqual(updateManyCalledWith.where.status, InvitationStatusEnum.PENDING);
      assert.strictEqual(updateManyCalledWith.where.consumed_at, null);
      assert.strictEqual(updateManyCalledWith.data.status, InvitationStatusEnum.CANCELLED);
      // Prove token_hash was rotated
      assert.ok(updateManyCalledWith.data.token_hash);
      assert.notStrictEqual(updateManyCalledWith.data.token_hash, 'initial-pending-hash');

      assert.ok(auditCreated);
      assert.strictEqual(auditCreated.action, 'INVITATION_CANCELLED');
      // Finding 4: target_identifier_masked, merchant_id, actor_id, and correlation_id (BR-INV-09)
      assert.strictEqual(auditCreated.new_value.target_identifier_masked, 'c****g@shipde.vn');
      assert.strictEqual(auditCreated.new_value.merchant_id, MERCHANT_ID);
      assert.strictEqual(auditCreated.new_value.actor_id, OWNER_USER_ID);
      assert.strictEqual(auditCreated.new_value.correlation_id, 'test-corr-10');
    });

    it('rejects cancel with 400 INVITATION_ALREADY_USED when concurrent accept committed (count === 0)', async () => {
      const acceptedInvite = {
        id: 'concurrent-cancel-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: InvitationStatusEnum.ACCEPTED,
        consumed_at: new Date(),
        token_hash: 'accepted-hash',
      };

      let readCount = 0;
      mockPrisma.invitation.findUnique = async () => {
        readCount++;
        if (readCount === 1) {
          return { ...acceptedInvite, status: InvitationStatusEnum.PENDING, consumed_at: null };
        }
        return acceptedInvite;
      };
      mockPrisma.invitation.updateMany = async () => ({ count: 0 });

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };
      await assert.rejects(
        async () => {
          await service.cancelInvitation(
            'concurrent-cancel-id',
            actor,
            '127.0.0.1',
            'test-corr-10-race'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_USED');
          return true;
        }
      );
    });

    it('rejects non-owner cancelling invitation with role or scope exceeding actor privilege ceiling (Finding 3)', async () => {
      const opsActor = {
        userId: OPS_USER_ID,
        merchantId: MERCHANT_ID,
      };

      // Case 1: OPS_CSKH trying to cancel WAREHOUSE role invitation
      mockPrisma.invitation.findUnique = async () => ({
        id: 'wh-cancel-inv-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.WAREHOUSE,
        store_scopes: [],
        warehouse_scopes: ['WH-01'],
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
      });

      await assert.rejects(
        async () => {
          await service.cancelInvitation(
            'wh-cancel-inv-id',
            opsActor,
            '127.0.0.1',
            'test-corr-cancel-role'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message.includes('vượt quá quyền hạn'));
          return true;
        }
      );

      // Case 2: OPS_CSKH trying to cancel invite with store outside their scope
      mockPrisma.invitation.findUnique = async () => ({
        id: 'scope-cancel-inv-id',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['STORE-UNAUTHORIZED'],
        warehouse_scopes: ['WH-01'],
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
      });

      await assert.rejects(
        async () => {
          await service.cancelInvitation(
            'scope-cancel-inv-id',
            opsActor,
            '127.0.0.1',
            'test-corr-cancel-scope'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const resp = err.getResponse() as any;
          assert.ok(resp?.error?.message.includes('Chi nhánh không thuộc phạm vi quản lý'));
          return true;
        }
      );
    });
  });

  // AC-USR-01-11: Cross-tenant actor attempts to cancel or resend invitation
  describe('AC-USR-01-11: Cross-tenant isolation', () => {
    it('returns 403 FORBIDDEN when attempting to access invitation of another merchant', async () => {
      mockPrisma.invitation.findUnique = async () => ({
        id: 'target-inv-id',
        merchant_id: OTHER_MERCHANT_ID, // Belongs to different merchant!
        role: RoleEnum.OPS_CSKH,
        status: InvitationStatusEnum.PENDING,
      });

      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: RoleEnum.OWNER };

      await assert.rejects(
        async () => {
          await service.cancelInvitation('target-inv-id', actor, '127.0.0.1', 'test-corr-11');
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });
  });

  // AC-USR-01-12: Public verification of valid unexpired invitation token
  describe('AC-USR-01-12: Public verification of valid token', () => {
    it('returns 200 OK with masked identifier, tenant name, and assigned scopes', async () => {
      const rawToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const tokenHash = (service as any).hashToken(rawToken);

      mockPrisma.invitation.findUnique = async (args: any) => {
        if (args.where.token_hash === tokenHash) {
          return {
            id: 'valid-inv-id',
            merchant_id: MERCHANT_ID,
            email: 'recipient@shipde.vn',
            role: RoleEnum.OPS_CSKH,
            store_scopes: ['S1'],
            warehouse_scopes: ['W1'],
            status: InvitationStatusEnum.PENDING,
            consumed_at: null,
            expires_at: new Date(Date.now() + 86400000),
            merchant: { name: 'An An Boutique' },
          };
        }
        return null;
      };

      const res = await service.verifyInvitation(rawToken, 'test-corr-12');
      assert.strictEqual(res.data.valid, true);
      assert.strictEqual(res.data.tenant_name, 'An An Boutique');
      assert.strictEqual(res.data.role, RoleEnum.OPS_CSKH);
      assert.strictEqual(res.data.identifier, 'r****t@shipde.vn');
      assert.strictEqual((res.data as any).store_scopes, undefined);
      assert.strictEqual((res.data as any).warehouse_scopes, undefined);
    });
  });

  // AC-USR-01-13: Public verification of expired, cancelled, or nonexistent token
  describe('AC-USR-01-13: Anti-enumeration on public verification', () => {
    it('returns canonical 404 INVITATION_NOT_FOUND for nonexistent token', async () => {
      mockPrisma.invitation.findUnique = async () => null;

      await assert.rejects(
        async () => {
          await service.verifyInvitation('nonexistent-token', 'test-corr-13a');
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.NOT_FOUND);
          assert.strictEqual(err.code, 'INVITATION_NOT_FOUND');
          return true;
        }
      );
    });

    it('returns identical canonical 404 INVITATION_NOT_FOUND for expired token', async () => {
      mockPrisma.invitation.findUnique = async () => ({
        id: 'expired-id',
        status: InvitationStatusEnum.PENDING,
        expires_at: new Date(Date.now() - 10000), // Expired!
        merchant: { name: 'Shop' },
      });

      await assert.rejects(
        async () => {
          await service.verifyInvitation('expired-token', 'test-corr-13b');
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.NOT_FOUND);
          assert.strictEqual(err.code, 'INVITATION_NOT_FOUND');
          return true;
        }
      );
    });

    it('returns identical canonical 404 INVITATION_NOT_FOUND for cancelled token', async () => {
      mockPrisma.invitation.findUnique = async () => ({
        id: 'cancelled-id',
        status: InvitationStatusEnum.CANCELLED,
        expires_at: new Date(Date.now() + 86400000),
        merchant: { name: 'Shop' },
      });

      await assert.rejects(
        async () => {
          await service.verifyInvitation('cancelled-token', 'test-corr-13c');
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.NOT_FOUND);
          assert.strictEqual(err.code, 'INVITATION_NOT_FOUND');
          return true;
        }
      );
    });
  });

  // AC-USR-01-14: Recipient accepts valid invitation
  describe('AC-USR-01-14: Recipient accepts invitation', () => {
    it('creates active User, sets status ACCEPTED, hashes password with scrypt, and logs INVITATION_ACCEPTED', async () => {
      const rawToken = 'validaccepttoken123456789012345678901234567890123456789012345678';
      const tokenHash = (service as any).hashToken(rawToken);

      const invitationRecord = {
        id: 'inv-to-accept',
        merchant_id: MERCHANT_ID,
        email: 'newuser@shipde.vn',
        phone: null,
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['S1'],
        warehouse_scopes: ['WH1'],
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
        expires_at: new Date(Date.now() + 86400000),
      };

      mockPrisma.invitation.findUnique = async () => invitationRecord;

      let createdUserRecord: any = null;
      let auditLogRecord: any = null;

      mockPrisma.user.create = async (args: any) => {
        createdUserRecord = { id: 'created-user-id', ...args.data };
        return createdUserRecord;
      };

      mockPrisma.auditLog.create = async (args: any) => {
        auditLogRecord = args.data;
        return { id: 'audit-accept', ...args.data };
      };

      const res = await service.acceptInvitation(
        {
          token: rawToken,
          full_name: 'Nguyen Van Accepted',
          password: 'StrongPassword123!',
          password_confirm: 'StrongPassword123!',
        },
        '127.0.0.1',
        'test-corr-14'
      );

      assert.strictEqual(res.data.status, 'ACTIVE');
      assert.strictEqual(res.data.email, 'newuser@shipde.vn');
      assert.strictEqual(res.data.full_name, 'Nguyen Van Accepted');

      assert.ok(createdUserRecord);
      assert.strictEqual(createdUserRecord.status, 'active');
      assert.ok(
        createdUserRecord.password_hash.startsWith('scrypt$'),
        'Password must be hashed with scrypt'
      );
      assert.deepStrictEqual(createdUserRecord.warehouse_scopes, ['WH1']);
      assert.strictEqual(
        createdUserRecord.terms_accepted_at,
        null,
        'Uncaptured terms must not be recorded'
      );
      assert.strictEqual(createdUserRecord.terms_version, null);

      assert.ok(auditLogRecord);
      assert.strictEqual(auditLogRecord.action, 'INVITATION_ACCEPTED');
      assert.strictEqual(
        JSON.stringify(auditLogRecord).includes(rawToken),
        false,
        'Audit log must not contain raw token'
      );
    });
  });

  // AC-USR-01-15: Recipient attempts to accept already-used invitation token
  describe('AC-USR-01-15: Replay protection on acceptance', () => {
    it('returns 400 INVITATION_ALREADY_USED when token was already consumed', async () => {
      const rawToken = 'alreadyusedtoken123456789012345678901234567890123456789012345678';
      mockPrisma.invitation.findUnique = async () => ({
        id: 'consumed-inv',
        status: InvitationStatusEnum.ACCEPTED,
        consumed_at: new Date(Date.now() - 3600000),
        expires_at: new Date(Date.now() + 86400000),
      });

      await assert.rejects(
        async () => {
          await service.acceptInvitation(
            {
              token: rawToken,
              full_name: 'Nguyen Van Duplicate',
              password: 'StrongPassword123!',
            },
            '127.0.0.1',
            'test-corr-15'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_USED');
          return true;
        }
      );
    });

    it('pins token_hash, consumed_at null, and unexpired date in updateMany predicate (Finding 2)', async () => {
      const rawToken = 'pendingtoken123456789012345678901234567890123456789012345678';
      let capturedWhere: any = null;

      mockPrisma.invitation.findUnique = async () => ({
        id: 'inv-atomic-check',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        email: 'atomic@shipde.vn',
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
        expires_at: new Date(Date.now() + 86400000),
      });

      mockPrisma.invitation.updateMany = async (args: any) => {
        capturedWhere = args.where;
        return { count: 1 };
      };

      await service.acceptInvitation(
        {
          token: rawToken,
          full_name: 'Nguyen Van Atomic',
          password: 'StrongPassword123!',
        },
        '127.0.0.1',
        'test-corr-atomic-accept'
      );

      assert.ok(capturedWhere, 'updateMany must have been called');
      assert.strictEqual(capturedWhere.id, 'inv-atomic-check');
      assert.strictEqual(capturedWhere.status, InvitationStatusEnum.PENDING);
      assert.strictEqual(capturedWhere.consumed_at, null);
      assert.ok(capturedWhere.token_hash, 'must pin token_hash');
      assert.ok(capturedWhere.expires_at?.gt, 'must pin unexpired expires_at');
    });

    it('rejects in-flight rotated or expired token when updateCount is 0 (Finding 2)', async () => {
      const rawToken = 'pendingtoken123456789012345678901234567890123456789012345678';

      mockPrisma.invitation.findUnique = async () => ({
        id: 'inv-race-check',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        email: 'race@shipde.vn',
        status: InvitationStatusEnum.PENDING,
        consumed_at: null,
        expires_at: new Date(Date.now() + 86400000),
      });

      // updateMany returns 0 because token_hash was rotated concurrently by resend
      mockPrisma.invitation.updateMany = async () => ({ count: 0 });

      await assert.rejects(
        async () => {
          await service.acceptInvitation(
            {
              token: rawToken,
              full_name: 'Nguyen Van Race',
              password: 'StrongPassword123!',
            },
            '127.0.0.1',
            'test-corr-race'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_USED');
          return true;
        }
      );
    });
  });

  // AC-USR-01-16: Recipient provides weak password during acceptance
  describe('AC-USR-01-16: Password strength validation on acceptance', () => {
    it('returns 400 VALIDATION_ERROR and keeps invitation PENDING when password is weak', async () => {
      const rawToken = 'pendingtoken123456789012345678901234567890123456789012345678';
      let updateCalled = false;
      mockPrisma.invitation.updateMany = async () => {
        updateCalled = true;
        return { count: 1 };
      };

      await assert.rejects(
        async () => {
          await service.acceptInvitation(
            {
              token: rawToken,
              full_name: 'Nguyen Van Weak',
              password: '123', // Weak password!
            },
            '127.0.0.1',
            'test-corr-16'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(
            updateCalled,
            false,
            'Invitation must not be modified when password fails'
          );
          return true;
        }
      );
    });
  });

  // AC-USR-01-17: Accepted user logs in and attempts access outside assigned scope
  describe('AC-USR-01-17: Scope authorization enforcement on accepted user', () => {
    it('authorizes operator within assigned warehouse scope', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: 'operator-user-1',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['store-alpha'],
        warehouse_scopes: ['wh-north'],
      });

      const result = await usersService.checkScopeAccess(
        'operator-user-1',
        MERCHANT_ID,
        { warehouse_id: 'wh-north' },
        'corr-scope-1'
      );

      assert.strictEqual(result.data.authorized, true);
      assert.strictEqual(result.data.user_id, 'operator-user-1');
    });

    it('rejects operator accessing unassigned warehouse scope with 403 FORBIDDEN', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: 'operator-user-1',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['store-alpha'],
        warehouse_scopes: ['wh-north'],
      });

      await assert.rejects(
        async () => {
          await usersService.checkScopeAccess(
            'operator-user-1',
            MERCHANT_ID,
            { warehouse_id: 'wh-south' }, // Unassigned warehouse!
            'corr-scope-2'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.match(response?.error?.message, /kho hàng/);
          return true;
        }
      );
    });

    it('rejects operator accessing unassigned store scope with 403 FORBIDDEN', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: 'operator-user-1',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['store-alpha'],
        warehouse_scopes: ['wh-north'],
      });

      await assert.rejects(
        async () => {
          await usersService.checkScopeAccess(
            'operator-user-1',
            MERCHANT_ID,
            { store_id: 'store-beta' }, // Unassigned store!
            'corr-scope-3'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'FORBIDDEN');
          const response = err.getResponse() as any;
          assert.match(response?.error?.message, /chi nhánh cửa hàng/);
          return true;
        }
      );
    });

    it('grants owner role full access across all store and warehouse scopes', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: OWNER_USER_ID,
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OWNER,
        status: 'active',
        store_scopes: [],
        warehouse_scopes: [],
      });

      const result = await usersService.checkScopeAccess(
        OWNER_USER_ID,
        MERCHANT_ID,
        { warehouse_id: 'wh-any', store_id: 'store-any' },
        'corr-scope-4'
      );

      assert.strictEqual(result.data.authorized, true);
    });

    it('rejects empty scope check omitting both store_id and warehouse_id with 400 VALIDATION_ERROR (Finding 6)', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: 'operator-user-1',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['store-alpha'],
        warehouse_scopes: ['wh-north'],
      });

      await assert.rejects(
        async () => {
          await usersService.checkScopeAccess(
            'operator-user-1',
            MERCHANT_ID,
            {}, // Empty scope!
            'corr-empty-scope'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    it('authorizes operator with wildcard "*" warehouse and store scopes (Finding 6)', async () => {
      const usersService = new UsersService(mockPrisma as any, {} as any);
      mockPrisma.user.findFirst = async () => ({
        id: 'operator-user-wildcard',
        merchant_id: MERCHANT_ID,
        role: RoleEnum.OPS_CSKH,
        status: 'active',
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
      });

      const resWarehouse = await usersService.checkScopeAccess(
        'operator-user-wildcard',
        MERCHANT_ID,
        { warehouse_id: 'any-wh-123' },
        'corr-wildcard-wh'
      );
      assert.strictEqual(resWarehouse.data.authorized, true);

      const resStore = await usersService.checkScopeAccess(
        'operator-user-wildcard',
        MERCHANT_ID,
        { store_id: 'any-store-456' },
        'corr-wildcard-store'
      );
      assert.strictEqual(resStore.data.authorized, true);
    });
  });

  // AC-USR-01-18: Inspection of logs, audit entries, and database secrecy
  describe('AC-USR-01-18: Zero plaintext invitation tokens and password secrecy', () => {
    it('proves raw invitation token is never stored in DB or audit entries', async () => {
      let createdInvitationData: any = null;
      let createdAuditLogData: any = null;

      mockPrisma.invitation.create = async (args: any) => {
        createdInvitationData = args.data;
        return {
          id: 'test-inv-id',
          ...args.data,
          created_at: new Date(),
          consumed_at: null,
        };
      };

      mockPrisma.auditLog.create = async (args: any) => {
        createdAuditLogData = args.data;
        return { id: 'audit-id', ...args.data };
      };

      const result = await service.createInvitation(
        {
          email: 'secretcheck@example.com',
          role: RoleEnum.OPS_CSKH,
          warehouse_scopes: ['wh-1'],
        },
        { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
        '10.0.0.1',
        'corr-sec-1'
      );

      // Security assertion: Zero raw token or invitation_url in admin response
      assert.strictEqual((result.data as any).token, undefined);
      assert.strictEqual((result.data as any).invitation_url, undefined);

      // Assert database record has token_hash, NEVER raw token
      assert.strictEqual(createdInvitationData.token, undefined);
      assert.strictEqual(createdInvitationData.rawToken, undefined);
      assert.strictEqual(typeof createdInvitationData.token_hash, 'string');
      assert.strictEqual(createdInvitationData.token_hash.length, 64);

      // Assert audit log does not leak raw identifier
      const auditPayloadStr = JSON.stringify(createdAuditLogData);
      assert.strictEqual(auditPayloadStr.includes('secretcheck@example.com'), false);
      assert.ok(auditPayloadStr.includes('s****k@example.com'));
    });
  });

  // Finding 9: Rate limiting on dispatch/accept and transactional audit log commit
  describe('Finding 9: Rate limiting and transactional audit commit', () => {
    it('enforces dispatch rate limit on createInvitation with 429 RATE_LIMITED', async () => {
      const mockRateLimit = {
        checkInvitationDispatchLimit: async () => ({
          allowed: false,
          retryAfterSeconds: 45,
          reason: 'Too many requests',
        }),
        recordInvitationDispatchAttempt: async () => {},
      };

      const limitedService = new InvitationsService(mockPrisma, undefined, mockRateLimit as any);

      await assert.rejects(
        async () => {
          await limitedService.createInvitation(
            { email: 'ratelimited@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '192.168.1.1',
            'corr-rate-limit'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
          assert.strictEqual(err.code, 'RATE_LIMITED');
          assert.strictEqual(err.retryAfterSeconds, 45);
          return true;
        }
      );
    });

    it('Finding 3: does not consume dispatch quota when request is unauthorized or invalid', async () => {
      let dispatchQuotaChecked = false;
      const trackingRateLimit = {
        checkInvitationDispatchLimit: async () => {
          dispatchQuotaChecked = true;
          return { allowed: true };
        },
        recordInvitationDispatchAttempt: async () => {},
      };

      const testService = new InvitationsService(
        mockPrisma,
        { sendVerification: async () => ({ success: true }) } as any,
        trackingRateLimit as any
      );

      // 1. Unauthorized actor (WAREHOUSE) rejected with 403 without consuming quota
      await assert.rejects(
        () =>
          testService.createInvitation(
            { email: 'unauth-quota@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: WAREHOUSE_USER_ID, merchantId: MERCHANT_ID, role: 'WAREHOUSE' },
            '10.0.0.1',
            'corr-unauth'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
      assert.strictEqual(
        dispatchQuotaChecked,
        false,
        'Quota must not be consumed for unauthorized caller'
      );

      // 2. Validation error (missing identifier) rejected with 400 without consuming quota
      await assert.rejects(
        () =>
          testService.createInvitation(
            { role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-val-err'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
      assert.strictEqual(
        dispatchQuotaChecked,
        false,
        'Quota must not be consumed for validation failure'
      );

      // 3. Authorized and valid call consumes quota
      const res = await testService.createInvitation(
        { email: 'valid-quota@shipde.vn', role: RoleEnum.OPS_CSKH },
        { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
        '10.0.0.1',
        'corr-valid-call'
      );
      assert.ok(res.data.id);
      assert.strictEqual(dispatchQuotaChecked, true, 'Quota consumed for valid authorized attempt');
    });

    it('enforces accept rate limit on acceptInvitation with 429 RATE_LIMITED', async () => {
      const mockRateLimit = {
        checkInvitationAcceptLimit: async () => ({
          allowed: false,
          retryAfterSeconds: 60,
          reason: 'Too many accept attempts',
        }),
        recordInvitationAcceptAttempt: async () => {},
      };

      const limitedService = new InvitationsService(mockPrisma, undefined, mockRateLimit as any);

      await assert.rejects(
        async () => {
          await limitedService.acceptInvitation(
            {
              token: 'testtoken'.repeat(8),
              full_name: 'Test Name',
              password: 'Password123!',
            },
            '192.168.1.1',
            'corr-rate-limit-accept'
          );
        },
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.getStatus(), HttpStatus.TOO_MANY_REQUESTS);
          assert.strictEqual(err.code, 'RATE_LIMITED');
          assert.strictEqual(err.retryAfterSeconds, 60);
          return true;
        }
      );
    });

    it('proves createInvitation commits mutation inside transaction and writes INVITATION_SENT audit upon delivery success', async () => {
      let transactionCalled = false;
      let invitationCreatedInTx = false;
      let auditCreatedOnSuccess = false;

      const txPrisma = {
        ...mockPrisma,
        invitation: {
          ...mockPrisma.invitation,
          create: async (args: any) => {
            assert.ok(transactionCalled, 'invitation.create must be called inside $transaction');
            invitationCreatedInTx = true;
            return {
              id: 'tx-invite-id',
              created_at: new Date(),
              updated_at: new Date(),
              consumed_at: null,
              ...args.data,
            };
          },
        },
        auditLog: {
          create: async (args: any) => {
            if (args.data?.action === 'INVITATION_SENT') {
              auditCreatedOnSuccess = true;
            }
            return { id: 'tx-audit-id', ...args.data };
          },
        },
      };

      const customPrisma = {
        ...txPrisma,
        $transaction: async (cb: any) => {
          transactionCalled = true;
          return cb(txPrisma);
        },
      };

      const txService = new InvitationsService(
        customPrisma as any,
        {
          sendVerification: async () => ({ success: true, messageId: 'msg-tx' }),
        } as any
      );
      const res = await txService.createInvitation(
        { email: 'txcheck@shipde.vn', role: RoleEnum.OPS_CSKH },
        { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
        '10.0.0.2',
        'corr-tx-1'
      );

      assert.ok(res.data.id);
      assert.strictEqual(transactionCalled, true);
      assert.strictEqual(invitationCreatedInTx, true);
      assert.strictEqual(auditCreatedOnSuccess, true);
    });

    it('Finding 1: createInvitation conditionally retires row with deleteMany predicates and logs compensating audit without deleting audit history on delivery failure', async () => {
      let invitationDeletedManyWhere: any = null;
      let auditDeletedCalled = false;
      let compensatingAuditCreated: any = null;

      const mockPrismaWithCompensation = {
        user: {
          findFirst: async (args: any) => {
            if (args?.where?.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: 'OWNER',
                status: 'active',
                store_scopes: [],
                warehouse_scopes: [],
              };
            }
            return null;
          },
        },
        invitation: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          create: async (args: any) => ({
            id: 'failed-dispatch-id',
            ...args.data,
            created_at: new Date(),
            updated_at: new Date(),
            consumed_at: null,
          }),
          deleteMany: async (args: any) => {
            invitationDeletedManyWhere = args.where;
            return { count: 1 };
          },
        },
        auditLog: {
          create: async (args: any) => {
            if (args.data?.action === 'INVITATION_DELIVERY_FAILED') {
              compensatingAuditCreated = args.data;
            }
            return { id: 'failed-audit-id', ...args.data };
          },
          deleteMany: async () => {
            auditDeletedCalled = true;
            return { count: 1 };
          },
        },
        $transaction: async (arg: any) => {
          if (Array.isArray(arg)) {
            for (const item of arg) {
              await item;
            }
            return [];
          }
          if (typeof arg === 'function') {
            return arg(mockPrismaWithCompensation);
          }
        },
      };

      const failingService = new InvitationsService(
        mockPrismaWithCompensation as any,
        {
          sendVerification: async () => ({ success: false, error: 'Provider outage' }),
        } as any
      );

      await assert.rejects(
        () =>
          failingService.createInvitation(
            { email: 'delivery-fail@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-del-fail'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 502);
          assert.strictEqual(err.code, 'DELIVERY_FAILED');
          return true;
        }
      );

      assert.ok(invitationDeletedManyWhere, 'invitation.deleteMany must be called');
      assert.strictEqual(invitationDeletedManyWhere.id, 'failed-dispatch-id');
      assert.strictEqual(invitationDeletedManyWhere.merchant_id, MERCHANT_ID);
      assert.strictEqual(invitationDeletedManyWhere.status, 'PENDING');
      assert.strictEqual(invitationDeletedManyWhere.consumed_at, null);
      assert.ok(invitationDeletedManyWhere.token_hash, 'must assert token_hash predicate');
      assert.strictEqual(auditDeletedCalled, false, 'Audit history must NEVER be deleted');
      assert.ok(compensatingAuditCreated, 'Compensating audit event must be recorded');
      assert.strictEqual(compensatingAuditCreated.action, 'INVITATION_DELIVERY_FAILED');
    });

    it('Finding 1: createInvitation delivery failure preserves accepted invite if concurrent accept committed (deleteMany count === 0)', async () => {
      let compensatingAuditCreated = false;

      const mockPrismaConcurrent = {
        user: {
          findFirst: async (args: any) => {
            if (args?.where?.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: 'OWNER',
                status: 'active',
                store_scopes: [],
                warehouse_scopes: [],
              };
            }
            return null;
          },
        },
        invitation: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          create: async (args: any) => ({
            id: 'concurrent-accept-id',
            ...args.data,
            created_at: new Date(),
            updated_at: new Date(),
            consumed_at: null,
          }),
          deleteMany: async () => {
            // Concurrent accept already committed, so status is ACCEPTED and consumed_at is non-null
            return { count: 0 };
          },
        },
        auditLog: {
          create: async (args: any) => {
            if (args.data?.action === 'INVITATION_DELIVERY_FAILED') {
              compensatingAuditCreated = true;
            }
            return { id: 'audit-id', ...args.data };
          },
          deleteMany: async () => {
            throw new Error('Audit deletion prohibited');
          },
        },
        $transaction: async (cb: any) => cb(mockPrismaConcurrent),
      };

      const failingService = new InvitationsService(
        mockPrismaConcurrent as any,
        {
          sendVerification: async () => ({ success: false, error: 'Provider outage' }),
        } as any
      );

      await assert.rejects(
        () =>
          failingService.createInvitation(
            { email: 'delivery-fail2@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-del-fail-2'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 502);
          return true;
        }
      );

      assert.strictEqual(
        compensatingAuditCreated,
        false,
        'Should not record delivery failure compensation audit if already accepted'
      );
    });

    it('Finding 2: resendInvitation restores prior token hash with updateMany predicates and records compensating audit without deleting audit history on delivery failure', async () => {
      let updateManyWhere: any = null;
      let updateManyData: any = null;
      let auditDeletedCalled = false;
      let compensatingAudit: any = null;
      const initialHash = 'initial-hash-123';
      const initialExpiry = new Date(Date.now() + 86400000);

      const mockPrismaWithCompensation = {
        user: {
          findFirst: async (args: any) => {
            if (args?.where?.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: 'OWNER',
                status: 'active',
                store_scopes: [],
                warehouse_scopes: [],
              };
            }
            return null;
          },
        },
        invitation: {
          findFirst: async () => null,
          findUnique: async () => ({
            id: 'resend-fail-id',
            merchant_id: MERCHANT_ID,
            email: 'resend-fail@shipde.vn',
            role: 'OPS_CSKH',
            status: 'PENDING',
            token_hash: initialHash,
            expires_at: initialExpiry,
            consumed_at: null,
            store_scopes: [],
            warehouse_scopes: [],
          }),
          updateMany: async (args: any) => {
            if (args.data?.token_hash === initialHash) {
              // This is the compensation restore call
              updateManyWhere = args.where;
              updateManyData = args.data;
            }
            return { count: 1 };
          },
        },
        auditLog: {
          create: async (args: any) => {
            if (args.data?.action === 'INVITATION_RESEND_FAILED') {
              compensatingAudit = args.data;
            }
            return { id: 'resend-audit-id', ...args.data };
          },
          deleteMany: async () => {
            auditDeletedCalled = true;
            return { count: 1 };
          },
        },
        $transaction: async (arg: any) => {
          if (Array.isArray(arg)) {
            for (const item of arg) {
              await item;
            }
            return [];
          }
          if (typeof arg === 'function') {
            return arg(mockPrismaWithCompensation);
          }
        },
      };

      const failingService = new InvitationsService(
        mockPrismaWithCompensation as any,
        {
          sendVerification: async () => ({ success: false, error: 'Network timeout' }),
        } as any
      );

      await assert.rejects(
        () =>
          failingService.resendInvitation(
            'resend-fail-id',
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-resend-fail'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 502);
          assert.strictEqual(err.code, 'DELIVERY_FAILED');
          return true;
        }
      );

      assert.ok(updateManyWhere, 'Compensation updateMany must be called');
      assert.strictEqual(updateManyWhere.id, 'resend-fail-id');
      assert.strictEqual(updateManyWhere.merchant_id, MERCHANT_ID);
      assert.strictEqual(updateManyWhere.status, 'PENDING');
      assert.strictEqual(updateManyWhere.consumed_at, null);
      assert.ok(updateManyWhere.token_hash, 'Must assert new token_hash predicate');
      assert.strictEqual(updateManyData.token_hash, initialHash);
      assert.strictEqual(auditDeletedCalled, false, 'Audit history must NEVER be deleted');
      assert.ok(compensatingAudit, 'Must record compensating INVITATION_RESEND_FAILED audit');
      assert.strictEqual(compensatingAudit.action, 'INVITATION_RESEND_FAILED');
    });

    it('Finding 2: resendInvitation delivery failure does not overwrite row if concurrent accept committed (updateMany count === 0)', async () => {
      let compensatingAuditCreated = false;
      const initialHash = 'initial-hash-concurrent';
      const initialExpiry = new Date(Date.now() + 86400000);

      const mockPrismaConcurrent = {
        user: {
          findFirst: async (args: any) => {
            if (args?.where?.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: 'OWNER',
                status: 'active',
                store_scopes: [],
                warehouse_scopes: [],
              };
            }
            return null;
          },
        },
        invitation: {
          findFirst: async () => null,
          findUnique: async () => ({
            id: 'resend-concurrent-id',
            merchant_id: MERCHANT_ID,
            email: 'resend-concurrent@shipde.vn',
            role: 'OPS_CSKH',
            status: 'PENDING',
            token_hash: initialHash,
            expires_at: initialExpiry,
            consumed_at: null,
            store_scopes: [],
            warehouse_scopes: [],
          }),
          updateMany: async (args: any) => {
            if (args.data?.token_hash === initialHash) {
              // Concurrent accept already committed, so status is ACCEPTED and token_hash is consumed
              return { count: 0 };
            }
            return { count: 1 };
          },
        },
        auditLog: {
          create: async (args: any) => {
            if (args.data?.action === 'INVITATION_RESEND_FAILED') {
              compensatingAuditCreated = true;
            }
            return { id: 'audit-id', ...args.data };
          },
          deleteMany: async () => {
            throw new Error('Audit deletion prohibited');
          },
        },
        $transaction: async (cb: any) => cb(mockPrismaConcurrent),
      };

      const failingService = new InvitationsService(
        mockPrismaConcurrent as any,
        {
          sendVerification: async () => ({ success: false, error: 'Network timeout' }),
        } as any
      );

      await assert.rejects(
        () =>
          failingService.resendInvitation(
            'resend-concurrent-id',
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-resend-concurrent'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 502);
          return true;
        }
      );

      assert.strictEqual(
        compensatingAuditCreated,
        false,
        'Should not record resend failure compensation audit if already accepted'
      );
    });

    it('Finding 2: canonicalizes phone numbers to standard national format and avoids duplicate invites/users', async () => {
      assert.strictEqual(canonicalizePhoneNumber('+84901234567'), '0901234567');
      assert.strictEqual(canonicalizePhoneNumber('090-123-4567'), '0901234567');
      assert.strictEqual(canonicalizePhoneNumber('84901234567'), '0901234567');
      assert.strictEqual(canonicalizePhoneNumber('  090 123 4567 '), '0901234567');

      let insertedPhone: string | null = null;
      let dispatchedRecipient: string | null = null;

      const mockPrismaPhone = {
        user: {
          findFirst: async (args: any) => {
            if (args?.where?.id === OWNER_USER_ID) {
              return {
                id: OWNER_USER_ID,
                merchant_id: MERCHANT_ID,
                role: 'OWNER',
                status: 'active',
                store_scopes: [],
                warehouse_scopes: [],
              };
            }
            // Simulate existing active user with national format
            if (args?.where?.OR?.some((cond: any) => cond.phone === '0901234567')) {
              return { id: 'existing-phone-user', phone: '0901234567' };
            }
            return null;
          },
        },
        invitation: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          create: async (args: any) => {
            insertedPhone = args.data.phone;
            return {
              id: 'phone-invite-id',
              ...args.data,
              created_at: new Date(),
              updated_at: new Date(),
              consumed_at: null,
            };
          },
        },
        auditLog: {
          create: async (args: any) => ({ id: 'phone-audit-id', ...args.data }),
        },
        $transaction: async (cb: any) =>
          typeof cb === 'function' ? cb(mockPrismaPhone) : Promise.all(cb),
      };

      const phoneService = new InvitationsService(
        mockPrismaPhone as any,
        {
          sendVerification: async (params: any) => {
            dispatchedRecipient = params.recipient;
            return { success: true, messageId: 'phone-msg-1' };
          },
        } as any
      );

      // 1. Should reject +84 format when national format already exists in users
      await assert.rejects(
        () =>
          phoneService.createInvitation(
            { phone: '+84901234567', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-phone-dup'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'USER_ALREADY_EXISTS');
          return true;
        }
      );

      // 2. When creating with +84 for a new number, it stores and dispatches canonical 09... format
      const newPhoneService = new InvitationsService(
        {
          ...mockPrismaPhone,
          user: {
            findFirst: async (args: any) =>
              args?.where?.id === OWNER_USER_ID
                ? {
                    id: OWNER_USER_ID,
                    merchant_id: MERCHANT_ID,
                    role: 'OWNER',
                    status: 'active',
                    store_scopes: [],
                    warehouse_scopes: [],
                  }
                : null,
          },
        } as any,
        {
          sendVerification: async (params: any) => {
            dispatchedRecipient = params.recipient;
            return { success: true, messageId: 'phone-msg-2' };
          },
        } as any
      );

      const created = await newPhoneService.createInvitation(
        { phone: '+84987654321', role: RoleEnum.OPS_CSKH },
        { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
        '10.0.0.1',
        'corr-phone-new'
      );

      assert.strictEqual(created.data.phone, '0987654321');
      assert.strictEqual(insertedPhone, '0987654321');
      assert.strictEqual(dispatchedRecipient, '0987654321');
    });

    it('Finding 3: rejects creating invitation with both email and phone, preventing cross-binding verification abuse', async () => {
      await assert.rejects(
        () =>
          service.createInvitation(
            {
              email: 'attacker@shipde.vn',
              phone: '0901234567',
              role: RoleEnum.OPS_CSKH,
            },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.0.0.1',
            'corr-dual-id'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'EXCLUSIVE_IDENTIFIER');
          return true;
        }
      );
    });

    it('Finding 4: atomic consume-before-dispatch and tenant-scoped recipient flood control', async () => {
      const realRateLimiter = new RateLimitService();

      // Recipient in Merchant A: first 5 attempts succeed and consume
      for (let i = 0; i < 5; i++) {
        const res = await realRateLimiter.checkInvitationDispatchLimit(
          '1.2.3.4',
          'user@shipde.vn',
          MERCHANT_ID
        );
        assert.strictEqual(res.allowed, true, `Attempt ${i + 1} should be allowed`);
      }

      // 6th attempt for user@shipde.vn in Merchant A is blocked (5/hr recipient limit)
      const blockedRes = await realRateLimiter.checkInvitationDispatchLimit(
        '1.2.3.4',
        'user@shipde.vn',
        MERCHANT_ID
      );
      assert.strictEqual(blockedRes.allowed, false);
      assert.ok(blockedRes.reason?.includes('người dùng này'));

      // BUT in OTHER_MERCHANT_ID, user@shipde.vn is NOT blocked (tenant-scoped)
      const otherMerchantRes = await realRateLimiter.checkInvitationDispatchLimit(
        '5.6.7.8',
        'user@shipde.vn',
        OTHER_MERCHANT_ID
      );
      assert.strictEqual(
        otherMerchantRes.allowed,
        true,
        'Different merchant tenant must have its own recipient quota'
      );

      // IP limit (20/hr): make 15 more attempts on 1.2.3.4 (5 were made already)
      for (let i = 0; i < 15; i++) {
        const res = await realRateLimiter.checkInvitationDispatchLimit(
          '1.2.3.4',
          `distinct-${i}@shipde.vn`,
          MERCHANT_ID
        );
        assert.strictEqual(res.allowed, true);
      }

      // 21st attempt from IP 1.2.3.4 is blocked by IP flood control
      const ipBlockedRes = await realRateLimiter.checkInvitationDispatchLimit(
        '1.2.3.4',
        'another@shipde.vn',
        MERCHANT_ID
      );
      assert.strictEqual(ipBlockedRes.allowed, false);
      assert.ok(ipBlockedRes.reason?.includes('địa chỉ IP'));
    });

    it('Finding 4: atomic consume for checkInvitationVerifyLimit blocks brute-force without check-then-record race', async () => {
      const rateLimiter = new RateLimitService();
      const ip = '10.99.1.1';

      // 30 verification checks succeed and atomically consume quota
      for (let i = 0; i < 30; i++) {
        const res = await rateLimiter.checkInvitationVerifyLimit(ip);
        assert.strictEqual(res.allowed, true, `Verify attempt ${i + 1} should be allowed`);
      }

      // 31st check is blocked atomically without needing recordInvitationVerifyAttempt
      const blocked = await rateLimiter.checkInvitationVerifyLimit(ip);
      assert.strictEqual(blocked.allowed, false);
      assert.ok(blocked.retryAfterSeconds! > 0);
    });

    it('Finding 4: atomic consume for checkInvitationAcceptLimit blocks parallel race and reverts only the exact member', async () => {
      const rateLimiter = new RateLimitService();
      const ip = '10.99.2.1';
      const tokenHash = 'test-token-hash-brute-force';

      // Parallel race test: 15 concurrent accept attempts on the same token
      // In check-then-record, all 15 would pass; with atomic consume, exactly 5 must pass
      const results = await Promise.all(
        Array.from({ length: 15 }, () => rateLimiter.checkInvitationAcceptLimit(ip, tokenHash))
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      assert.strictEqual(allowedCount, 5, 'Exactly 5 concurrent token attempts must be allowed');
      assert.strictEqual(blockedCount, 10, 'Exactly 10 concurrent token attempts must be rejected');

      // The 10 rejected token attempts reverted their IP consume, so IP consumed is still 5
      // Verify we can perform 5 more attempts with a different token from the same IP (reaching 10 max IP limit)
      for (let i = 0; i < 5; i++) {
        const res = await rateLimiter.checkInvitationAcceptLimit(ip, `different-token-${i}`);
        assert.strictEqual(res.allowed, true, `IP attempt ${5 + i + 1} should be allowed`);
      }

      // 11th IP attempt is blocked
      const ipBlocked = await rateLimiter.checkInvitationAcceptLimit(ip, 'another-token');
      assert.strictEqual(ipBlocked.allowed, false);
      assert.ok(ipBlocked.reason?.includes('địa chỉ IP'));
    });
  });

  // Round 6 regressions
  describe('Round 6', () => {
    const makeFakeRedis = () => {
      const sets = new Map<string, Map<string, number>>();
      const calls = { zremrangebyrank: 0, zrem: [] as string[] };
      const client = {
        status: 'ready',
        eval: async (
          _lua: string,
          _n: number,
          key: string,
          now: string,
          clearBefore: string,
          limit: string,
          _w: string,
          member: string
        ) => {
          const set = sets.get(key) || new Map<string, number>();
          for (const [m, s] of set) if (s <= Number(clearBefore)) set.delete(m);
          if (set.size >= Number(limit)) {
            const earliest = Math.min(...set.values());
            sets.set(key, set);
            return [0, set.size, earliest];
          }
          set.set(member, Number(now));
          sets.set(key, set);
          return [1, set.size, Number(now)];
        },
        zrem: async (key: string, member: string) => {
          calls.zrem.push(member);
          sets.get(key)?.delete(member);
          return 1;
        },
        zremrangebyrank: async () => {
          calls.zremrangebyrank++;
          return 1;
        },
      };
      return { sets, calls, redisService: { getClient: () => client } as any };
    };

    it('Finding 2: delivery-failure refund removes only the consumed member, never a concurrent slot', async () => {
      const { sets, calls, redisService } = makeFakeRedis();
      const rl = new RateLimitService(redisService);
      const ipKey = 'ratelimit:invite:dispatch:ip:9.9.9.9';

      const a = await rl.checkInvitationDispatchLimit('9.9.9.9', 'r6@shipde.vn', MERCHANT_ID);
      const b = await rl.checkInvitationDispatchLimit('9.9.9.9', 'r6@shipde.vn', MERCHANT_ID);
      assert.strictEqual(a.allowed, true);
      assert.strictEqual(b.allowed, true);
      const aMembers = a.reservation!.attempts.map((x) => x.member);
      const bMembers = b.reservation!.attempts.map((x) => x.member);
      assert.strictEqual(aMembers.length, 2, 'IP and recipient slots captured');

      // Request A fails delivery and refunds; request B's concurrent slot must stay counted
      await rl.revertInvitationDispatchAttempt(a.reservation);
      await rl.revertInvitationDispatchAttempt(a.reservation); // double refund is a no-op
      assert.strictEqual(calls.zremrangebyrank, 0, 'never drops an arbitrary rank');
      assert.deepStrictEqual(calls.zrem.sort(), [...aMembers].sort());
      const ipSet = sets.get(ipKey)!;
      assert.strictEqual(ipSet.size, 1);
      assert.ok(ipSet.has(bMembers[0]!), 'concurrent successful dispatch remains counted');
    });

    it('Finding 2: in-memory refund without a reservation removes nothing', async () => {
      const rl = new RateLimitService();
      for (let i = 0; i < 5; i++) {
        const r = await rl.checkInvitationDispatchLimit('9.9.9.8', 'cap@shipde.vn', MERCHANT_ID);
        assert.strictEqual(r.allowed, true);
      }
      await rl.revertInvitationDispatchAttempt(undefined);
      const blocked = await rl.checkInvitationDispatchLimit(
        '9.9.9.8',
        'cap@shipde.vn',
        MERCHANT_ID
      );
      assert.strictEqual(blocked.allowed, false, 'recipient cap 5/h still enforced');
    });

    const ownerUser = {
      id: OWNER_USER_ID,
      merchant_id: MERCHANT_ID,
      role: 'OWNER',
      status: 'active',
      store_scopes: [],
      warehouse_scopes: [],
    };

    const makeResendPrisma = (opts: { sibling?: any; targetUpdateThrows?: any }) => {
      const calls = { targetUpdates: 0, siblingExpire: 0 };
      const target = {
        id: 'r6-target',
        merchant_id: MERCHANT_ID,
        email: 'r6-resend@shipde.vn',
        phone: null,
        role: 'OPS_CSKH',
        status: 'EXPIRED',
        token_hash: 'old-hash',
        expires_at: new Date(Date.now() - 1000),
        consumed_at: null,
        store_scopes: [],
        warehouse_scopes: [],
        created_at: new Date(),
      };
      const prisma: any = {
        user: { findFirst: async (a: any) => (a?.where?.id === OWNER_USER_ID ? ownerUser : null) },
        invitation: {
          findUnique: async () => ({ ...target }),
          findFirst: async () => opts.sibling ?? null,
          updateMany: async (a: any) => {
            if (a.where?.id === 'r6-target') {
              calls.targetUpdates++;
              if (opts.targetUpdateThrows) throw opts.targetUpdateThrows;
              return { count: 1 };
            }
            calls.siblingExpire++;
            return { count: 0 };
          },
        },
        auditLog: { create: async (a: any) => ({ id: 'a', ...a.data }) },
        $transaction: async (fn: any) => fn(prisma),
      };
      return { prisma, calls };
    };

    it('Finding 1: resend with a replacement pending invite returns 400 INVITATION_ALREADY_PENDING without consuming quota', async () => {
      const { prisma, calls } = makeResendPrisma({
        sibling: { id: 'r6-replacement', status: 'PENDING' },
      });
      let quotaChecked = false;
      const svc = new InvitationsService(
        prisma,
        { sendVerification: async () => ({ success: true }) } as any,
        {
          checkInvitationDispatchLimit: async () => {
            quotaChecked = true;
            return { allowed: true };
          },
        } as any
      );
      await assert.rejects(
        () =>
          svc.resendInvitation(
            'r6-target',
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.6.1.1',
            'corr-r6-1'
          ),
        (err: any) => {
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_PENDING');
          return true;
        }
      );
      assert.strictEqual(quotaChecked, false);
      assert.strictEqual(calls.targetUpdates, 0, 'target row unchanged');
    });

    it('Finding 1: resend losing the pending-unique race maps P2002 to 400 and refunds the exact quota', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      p2002.meta = { target: 'invitations_merchant_pending_email_unique' };
      const { prisma, calls } = makeResendPrisma({ targetUpdateThrows: p2002 });
      const rl = new RateLimitService();
      let sent = false;
      const svc = new InvitationsService(
        prisma,
        {
          sendVerification: async () => {
            sent = true;
            return { success: true };
          },
        } as any,
        rl
      );
      await assert.rejects(
        () =>
          svc.resendInvitation(
            'r6-target',
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.6.1.2',
            'corr-r6-2'
          ),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.status, 400);
          assert.strictEqual(err.code, 'INVITATION_ALREADY_PENDING');
          return true;
        }
      );
      assert.strictEqual(sent, false, 'no dispatch for a rolled-back resend');
      assert.strictEqual(calls.siblingExpire, 1, 'stale pending siblings expired in-transaction');
      // Recipient quota fully refunded: 5 further dispatches remain available
      for (let i = 0; i < 5; i++) {
        const r = await rl.checkInvitationDispatchLimit(
          '10.6.1.2',
          'r6-resend@shipde.vn',
          MERCHANT_ID
        );
        assert.strictEqual(r.allowed, true, `slot ${i + 1} available after refund`);
      }
    });

    it('Finding 4: create losing the pending-unique race refunds the consumed dispatch quota', async () => {
      const p2002: any = new Error('Unique constraint failed');
      p2002.code = 'P2002';
      p2002.meta = { target: 'invitations_merchant_pending_email_unique' };
      const prisma: any = {
        user: { findFirst: async (a: any) => (a?.where?.id === OWNER_USER_ID ? ownerUser : null) },
        invitation: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          create: async () => {
            throw p2002;
          },
        },
        auditLog: { create: async (a: any) => ({ id: 'a', ...a.data }) },
        $transaction: async (fn: any) => fn(prisma),
      };
      const rl = new RateLimitService();
      const svc = new InvitationsService(
        prisma,
        { sendVerification: async () => ({ success: true }) } as any,
        rl
      );
      await assert.rejects(
        () =>
          svc.createInvitation(
            { email: 'r6-race@shipde.vn', role: RoleEnum.OPS_CSKH },
            { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
            '10.6.4.1',
            'corr-r6-4'
          ),
        (err: any) => {
          assert.strictEqual(err.code, 'INVITATION_ALREADY_PENDING');
          return true;
        }
      );
      for (let i = 0; i < 5; i++) {
        const r = await rl.checkInvitationDispatchLimit(
          '10.6.4.1',
          'r6-race@shipde.vn',
          MERCHANT_ID
        );
        assert.strictEqual(r.allowed, true, `recipient slot ${i + 1} not burned by lost race`);
      }
    });

    it('Finding 5: delivery compensation audits persist only fixed reason codes, never provider text', async () => {
      const audits: any[] = [];
      const prisma: any = {
        user: { findFirst: async (a: any) => (a?.where?.id === OWNER_USER_ID ? ownerUser : null) },
        invitation: {
          findFirst: async () => null,
          updateMany: async () => ({ count: 0 }),
          deleteMany: async () => ({ count: 1 }),
          create: async (a: any) => ({
            id: 'r6-f5',
            ...a.data,
            created_at: new Date(),
            consumed_at: null,
          }),
        },
        auditLog: {
          create: async (a: any) => {
            audits.push(a.data);
            return { id: 'a', ...a.data };
          },
        },
        $transaction: async (fn: any) => fn(prisma),
      };
      let leakedLink = '';
      const svc = new InvitationsService(
        prisma,
        {
          sendVerification: async (req: any) => {
            leakedLink = req.link;
            throw new Error(`SMTP rejected message body ${req.link} token=${req.token}`);
          },
        } as any,
        new RateLimitService()
      );
      await assert.rejects(() =>
        svc.createInvitation(
          { email: 'r6-f5@shipde.vn', role: RoleEnum.OPS_CSKH },
          { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
          '10.6.5.1',
          'corr-r6-5'
        )
      );
      const failed = audits.find((x) => x.action === 'INVITATION_DELIVERY_FAILED');
      assert.ok(failed, 'compensating audit recorded');
      assert.strictEqual(failed.new_value.reason, 'DELIVERY_EXCEPTION');
      const rawToken = new URL(leakedLink).searchParams.get('token')!;
      assert.ok(rawToken.length >= 32);
      assert.strictEqual(JSON.stringify(audits).includes(rawToken), false, 'no raw token in audit');
    });

    it('Finding 5: resend failure audit stores DELIVERY_FAILED code instead of provider error', async () => {
      const audits: any[] = [];
      const { prisma } = makeResendPrisma({});
      prisma.auditLog.create = async (a: any) => {
        audits.push(a.data);
        return { id: 'a', ...a.data };
      };
      const svc = new InvitationsService(
        prisma,
        {
          sendVerification: async (req: any) => ({ success: false, error: `bounce ${req.link}` }),
        } as any,
        new RateLimitService()
      );
      await assert.rejects(() =>
        svc.resendInvitation(
          'r6-target',
          { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' },
          '10.6.5.2',
          'corr-r6-5b'
        )
      );
      const failed = audits.find((x) => x.action === 'INVITATION_RESEND_FAILED');
      assert.ok(failed);
      assert.strictEqual(failed.new_value.reason, 'DELIVERY_FAILED');
      assert.strictEqual(JSON.stringify(audits).includes('token='), false);
    });

    it('Finding 7: list rejects non-integer pagination with 400 VALIDATION_ERROR instead of 500', async () => {
      let findManyArgs: any = null;
      const prisma: any = {
        user: { findFirst: async (a: any) => (a?.where?.id === OWNER_USER_ID ? ownerUser : null) },
        invitation: {
          updateMany: async () => ({ count: 0 }),
          count: async () => 0,
          findMany: async (a: any) => {
            findManyArgs = a;
            return [];
          },
        },
      };
      const svc = new InvitationsService(prisma, undefined as any, new RateLimitService());
      const actor = { userId: OWNER_USER_ID, merchantId: MERCHANT_ID, role: 'OWNER' };
      for (const bad of [
        { page: 'abc' },
        { limit: 'xyz' },
        { page: '1.5' },
        { page: '0' },
        { limit: '-3' },
      ]) {
        await assert.rejects(
          () => svc.listInvitations(actor, bad as any, 'corr-r6-7'),
          (err: any) => {
            assert.strictEqual(err.status, 400, JSON.stringify(bad));
            assert.strictEqual(err.code, 'VALIDATION_ERROR');
            return true;
          }
        );
      }
      const ok = await svc.listInvitations(actor, { page: '2', limit: '500' }, 'corr-r6-7b');
      assert.strictEqual(ok.meta.page, 2);
      assert.strictEqual(ok.meta.limit, 100);
      assert.strictEqual(findManyArgs.skip, 100);
      assert.strictEqual(findManyArgs.where.merchant_id, MERCHANT_ID);
    });
  });
});
