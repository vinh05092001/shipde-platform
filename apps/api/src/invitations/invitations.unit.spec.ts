import * as assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import {
  InvitationsService,
  maskIdentifier,
  validatePasswordStrength,
} from './invitations.service';
import { UsersService } from '../users/users.service';
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
        findFirst: async () => null,
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
      },
      $transaction: async (cb: any) => cb(mockPrisma),
    };

    service = new InvitationsService(mockPrisma);
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
      assert.ok(res.data.token, 'Plaintext token must be returned in dispatch payload');

      // Database assertion (AC-USR-01-01, AC-USR-01-18)
      assert.ok(createdInviteData);
      assert.notStrictEqual(
        createdInviteData.token_hash,
        res.data.token,
        'Raw token MUST NEVER be persisted in database directly'
      );
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
      let dispatchedParams: any = null;
      const mockDeliveryAdapter = {
        sendVerification: async (params: any) => {
          dispatchedParams = params;
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

      assert.ok(res.data.invitation_url.startsWith('https://app.shipde.vn/invite/accept?token='));
      assert.ok(dispatchedParams);
      assert.strictEqual(dispatchedParams.recipient, 'dispatch_test@shipde.vn');
      assert.strictEqual(dispatchedParams.channel, 'email');
      assert.strictEqual(dispatchedParams.purpose, 'invitation');
      assert.strictEqual(dispatchedParams.link, res.data.invitation_url);
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
  });

  // AC-USR-01-05: Invite sent to email already active in tenant
  describe('AC-USR-01-05: Duplicate active user rejected', () => {
    it('returns 400 USER_ALREADY_EXISTS when identifier belongs to active account', async () => {
      mockPrisma.user.findFirst = async () => ({
        id: 'existing-user-uuid',
        email: 'active@shipde.vn',
        merchant_id: MERCHANT_ID,
        status: 'active',
      });

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
        const err: any = new Error('Unique constraint failed on the fields: (`merchant_id`,`email`)');
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
            'test-corr-06-p2002'
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
      assert.ok(res.data.token);
      assert.deepStrictEqual(updateManyCalledWith.where.status, {
        in: [InvitationStatusEnum.PENDING, InvitationStatusEnum.EXPIRED],
      });
      assert.strictEqual(updateManyCalledWith.where.consumed_at, null);
      assert.strictEqual(updateManyCalledWith.data.status, InvitationStatusEnum.PENDING);
      assert.notStrictEqual(updateManyCalledWith.data.token_hash, 'old-hash');

      assert.ok(auditCreated);
      assert.strictEqual(auditCreated.action, 'INVITATION_RESENT');
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
  });

  // AC-USR-01-10: Owner cancels a pending invitation
  describe('AC-USR-01-10: Owner cancels pending invitation', () => {
    it('transitions status PENDING -> CANCELLED, rotates token_hash, and logs INVITATION_CANCELLED', async () => {
      const pendingInvite = {
        id: 'pending-inv-id',
        merchant_id: MERCHANT_ID,
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
      assert.deepStrictEqual(res.data.store_scopes, ['S1']);
      assert.deepStrictEqual(res.data.warehouse_scopes, ['W1']);
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

      const returnedRawToken = result.data.token;
      assert.strictEqual(returnedRawToken.length, 64); // 32 hex bytes

      // Assert database record has token_hash, NEVER raw token
      assert.strictEqual(createdInvitationData.token, undefined);
      assert.strictEqual(createdInvitationData.rawToken, undefined);
      assert.strictEqual(typeof createdInvitationData.token_hash, 'string');
      assert.strictEqual(createdInvitationData.token_hash.length, 64);
      assert.notStrictEqual(createdInvitationData.token_hash, returnedRawToken);

      // Assert audit log does not leak token or raw identifier
      const auditPayloadStr = JSON.stringify(createdAuditLogData);
      assert.strictEqual(auditPayloadStr.includes(returnedRawToken), false);
      assert.strictEqual(auditPayloadStr.includes('secretcheck@example.com'), false);
      assert.ok(auditPayloadStr.includes('s****k@example.com'));
    });
  });
});
