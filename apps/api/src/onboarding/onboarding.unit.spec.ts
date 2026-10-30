import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  OnboardingService,
  maskAuditPayload,
  SENSITIVE_ONBOARDING_FIELDS,
} from './onboarding.service';
import {
  validateStepData,
  OnboardingStepId,
  OnboardingStepStatus,
  OnboardingOverallStatus,
  ONBOARDING_STEPS_CATALOG,
} from './onboarding.dto';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';

function createMockPrismaService() {
  const merchants: any[] = [
    {
      id: 'm-tenant-1',
      name: 'Gumac Fashion Flagship',
      code: 'GUMAC_HCM',
      status: 'active',
      legal_name: 'CTY CP GUMAC',
      tax_code: '0312345678',
      operating_notes: 'Giao gio hanh chinh',
      carrier_accounts: [{ id: 'ca-1' }],
      users: [{ id: 'u-1' }, { id: 'u-2' }],
      invitations: [],
      orders: [{ id: 'ord-1' }],
      shipments: [],
    },
    {
      id: 'm-tenant-2',
      name: 'Fresh New Shop',
      code: 'FRESH_SHOP',
      status: 'active',
      legal_name: null,
      tax_code: null,
      operating_notes: null,
      carrier_accounts: [],
      users: [{ id: 'u-3' }],
      invitations: [],
      orders: [],
      shipments: [],
    },
  ];

  const onboardingStates: any[] = [];
  const auditLogs: any[] = [];

  const mockTx = {
    onboardingState: {
      findUnique: async ({ where }: any) => {
        return (
          onboardingStates.find((s) =>
            where.id ? s.id === where.id : s.merchant_id === where.merchant_id
          ) || null
        );
      },
      update: async ({ where, data }: any) => {
        const idx = onboardingStates.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error('OnboardingState not found');
        const updated = {
          ...onboardingStates[idx],
          ...data,
          updated_at: new Date(),
        };
        onboardingStates[idx] = updated;
        return updated;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data, created_at: new Date() };
        auditLogs.push(record);
        return record;
      },
    },
  };

  return {
    merchants,
    onboardingStates,
    auditLogs,
    merchant: {
      findUnique: async ({ where }: any) => {
        return merchants.find((m) => m.id === where.id) || null;
      },
    },
    onboardingState: {
      findUnique: async ({ where }: any) => {
        return (
          onboardingStates.find((s) =>
            where.id ? s.id === where.id : s.merchant_id === where.merchant_id
          ) || null
        );
      },
      create: async ({ data }: any) => {
        const record = {
          id: `onb-${onboardingStates.length + 1}`,
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        onboardingStates.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const idx = onboardingStates.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error('OnboardingState not found');
        const updated = {
          ...onboardingStates[idx],
          ...data,
          updated_at: new Date(),
        };
        onboardingStates[idx] = updated;
        return updated;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data, created_at: new Date() };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(mockTx),
  };
}

describe('FEAT-ONB-01 Guided Onboarding Unit Tests', () => {
  const actorOwner: ActorContext = {
    userId: 'u-1',
    merchantId: 'm-tenant-2',
    role: 'OWNER',
    permissions: ['iam:shop_config'],
  };

  describe('Step Data Validation (validateStepData)', () => {
    it('passes for empty data or non-applicable steps', () => {
      const errs1 = validateStepData(OnboardingStepId.SHOP_PROFILE, undefined);
      assert.strictEqual(errs1.length, 0);
      const errs2 = validateStepData(OnboardingStepId.INVITE_USERS, { foo: 'bar' });
      assert.strictEqual(errs2.length, 0);
    });

    it('validates warehouse payload: requires name >= 2 chars, valid phone, address >= 3 chars', () => {
      const invalid = validateStepData(OnboardingStepId.WAREHOUSE, {
        name: 'A',
        phone: '12345',
        address: 'ab',
      });
      assert.strictEqual(invalid.length, 3);
      assert.strictEqual(invalid[0].field, 'name');
      assert.strictEqual(invalid[1].field, 'phone');
      assert.strictEqual(invalid[2].field, 'address');

      const valid = validateStepData(OnboardingStepId.WAREHOUSE, {
        name: 'Kho Tong Tan Binh',
        phone: '0901234567',
        address: '123 Cong Hoa, Tan Binh, TP.HCM',
      });
      assert.strictEqual(valid.length, 0);

      const validPlus84 = validateStepData(OnboardingStepId.WAREHOUSE, {
        name: 'Kho Ha Noi',
        phone: '+84987654321',
        address: '456 Cau Giay, Ha Noi',
      });
      assert.strictEqual(validPlus84.length, 0);

      // Nested warehouse payload
      const validNested = validateStepData(OnboardingStepId.WAREHOUSE, {
        warehouse: {
          name: 'Kho Ha Noi',
          phone: '0987654321',
          address: '456 Cau Giay, Ha Noi',
        },
      });
      assert.strictEqual(validNested.length, 0);

      const invalidNested = validateStepData(OnboardingStepId.WAREHOUSE, {
        warehouse: {
          name: 'Kho Ha Noi',
          phone: 'invalid-phone',
          address: '456 Cau Giay, Ha Noi',
        },
      });
      assert.strictEqual(invalidNested.length, 1);
      assert.strictEqual(invalidNested[0].field, 'phone');
    });

    it('validates operating defaults payload: checks enum values and timezone', () => {
      const invalid = validateStepData(OnboardingStepId.OPERATING_DEFAULTS, {
        default_fee_payer: 'UNKNOWN',
        default_weight_unit: 'lbs',
        timezone: 'Mars/Phobos',
      });
      assert.strictEqual(invalid.length, 3);
      assert.strictEqual(invalid[0].field, 'default_fee_payer');
      assert.strictEqual(invalid[1].field, 'default_weight_unit');
      assert.strictEqual(invalid[2].field, 'timezone');

      const valid = validateStepData(OnboardingStepId.OPERATING_DEFAULTS, {
        default_fee_payer: 'RECIPIENT',
        default_weight_unit: 'kg',
        timezone: 'Asia/Ho_Chi_Minh',
      });
      assert.strictEqual(valid.length, 0);
    });
  });

  describe('Audit Masking (maskAuditPayload)', () => {
    it('masks phone numbers and secrets in nested step data', () => {
      const raw = {
        name: 'Kho Tan Binh',
        phone: '0901234567',
        secret: 'super-secret-token',
        nested: {
          phone: '+84912345678',
        },
      };
      const masked = maskAuditPayload(raw);
      assert.strictEqual(masked?.name, 'Kho Tan Binh');
      assert.strictEqual(masked?.phone, '090****567');
      assert.strictEqual(masked?.secret, 'sup****ken');
      assert.strictEqual(masked?.nested?.phone, '+84****678');
    });

    it('returns null for null or non-object input', () => {
      assert.strictEqual(maskAuditPayload(null), null);
      assert.strictEqual(maskAuditPayload(undefined), null);
    });
  });

  describe('OnboardingService State & Progress Logic', () => {
    it('AC-ONB-01-01: initializes new onboarding state with order 1..6, status IN_PROGRESS, progress 0%', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      const res = await service.getOnboardingState('m-tenant-2', 'corr-init', '127.0.0.1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, OnboardingOverallStatus.IN_PROGRESS);
      assert.strictEqual(res.data.current_step, OnboardingStepId.SHOP_PROFILE);
      assert.strictEqual(res.data.progress_percentage, 0);
      assert.strictEqual(res.data.steps.length, 6);

      // Verify steps order and required flags
      const stepIds = res.data.steps.map((s) => s.id);
      assert.deepStrictEqual(stepIds, [
        OnboardingStepId.SHOP_PROFILE,
        OnboardingStepId.WAREHOUSE,
        OnboardingStepId.INVITE_USERS,
        OnboardingStepId.CARRIER_ACCOUNT,
        OnboardingStepId.OPERATING_DEFAULTS,
        OnboardingStepId.TEST_ORDER,
      ]);
    });

    it('detects live completed steps for existing configured merchant', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      // m-tenant-1 has legal_name, tax_code, carrier_accounts, users>1, orders
      const res = await service.getOnboardingState('m-tenant-1', 'corr-live');
      const stepMap = new Map(res.data.steps.map((s) => [s.id, s.status]));

      assert.strictEqual(
        stepMap.get(OnboardingStepId.SHOP_PROFILE),
        OnboardingStepStatus.COMPLETED
      );
      assert.strictEqual(
        stepMap.get(OnboardingStepId.INVITE_USERS),
        OnboardingStepStatus.COMPLETED
      );
      assert.strictEqual(
        stepMap.get(OnboardingStepId.CARRIER_ACCOUNT),
        OnboardingStepStatus.COMPLETED
      );
      assert.strictEqual(
        stepMap.get(OnboardingStepId.OPERATING_DEFAULTS),
        OnboardingStepStatus.COMPLETED
      );
    });

    it('AC-ONB-01-02: completes SHOP_PROFILE step and records audit ONBOARDING_STEP_COMPLETED', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      const res = await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.SHOP_PROFILE,
        {},
        actorOwner,
        'corr-comp-1',
        '10.0.0.1'
      );

      assert.strictEqual(res.success, true);
      const profileStep = res.data.steps.find((s) => s.id === OnboardingStepId.SHOP_PROFILE);
      assert.strictEqual(profileStep?.status, OnboardingStepStatus.COMPLETED);
      assert.strictEqual(res.data.completed_required_steps, 1);
      assert.strictEqual(res.data.progress_percentage, 25); // 1 of 4 required

      // Verify audit log
      const audit = mockPrisma.auditLogs.find((a) => a.action === 'ONBOARDING_STEP_COMPLETED');
      assert.ok(audit);
      assert.strictEqual(audit.new_value.step_id, OnboardingStepId.SHOP_PROFILE);
      assert.strictEqual(audit.merchant_id, 'm-tenant-2');
    });

    it('AC-ONB-01-03: completes WAREHOUSE step with payload data', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      // First complete SHOP_PROFILE as prerequisite
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.SHOP_PROFILE,
        {},
        actorOwner,
        'corr-1',
        '127.0.0.1'
      );

      const res = await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.WAREHOUSE,
        {
          data: {
            name: 'Kho Chinh TP.HCM',
            phone: '0901234567',
            address: '789 CMT8, Quan 10, TP.HCM',
          },
        },
        actorOwner,
        'corr-comp-2',
        '127.0.0.1'
      );

      assert.strictEqual(res.success, true);
      const whStep = res.data.steps.find((s) => s.id === OnboardingStepId.WAREHOUSE);
      assert.strictEqual(whStep?.status, OnboardingStepStatus.COMPLETED);
      assert.strictEqual(whStep?.data?.name, 'Kho Chinh TP.HCM');
      assert.strictEqual(res.data.completed_required_steps, 2);
      assert.strictEqual(res.data.progress_percentage, 50); // 2 of 4 required
    });

    it('AC-ONB-01-04: throws STEP_BLOCKED when attempting WAREHOUSE before SHOP_PROFILE', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      await assert.rejects(
        async () => {
          await service.completeStep(
            'm-tenant-2',
            OnboardingStepId.WAREHOUSE,
            { data: { name: 'Kho', phone: '0901234567', address: '123 ABC' } },
            actorOwner,
            'corr-blocked',
            '127.0.0.1'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'STEP_BLOCKED');
          assert.strictEqual(err.status, 400);
          return true;
        }
      );
    });

    it('AC-ONB-01-05: skips optional step INVITE_USERS and records ONBOARDING_STEP_SKIPPED', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      const res = await service.skipStep(
        'm-tenant-2',
        OnboardingStepId.INVITE_USERS,
        actorOwner,
        'corr-skip-1',
        '127.0.0.1'
      );

      assert.strictEqual(res.success, true);
      const step = res.data.steps.find((s) => s.id === OnboardingStepId.INVITE_USERS);
      assert.strictEqual(step?.status, OnboardingStepStatus.SKIPPED);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'ONBOARDING_STEP_SKIPPED');
      assert.ok(audit);
      assert.strictEqual(audit.new_value.step_id, OnboardingStepId.INVITE_USERS);
    });

    it('AC-ONB-01-06: throws CANNOT_SKIP_REQUIRED_STEP when attempting to skip required step', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      await assert.rejects(
        async () => {
          await service.skipStep(
            'm-tenant-2',
            OnboardingStepId.CARRIER_ACCOUNT,
            actorOwner,
            'corr-skip-req',
            '127.0.0.1'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'CANNOT_SKIP_REQUIRED_STEP');
          assert.strictEqual(err.status, 400);
          return true;
        }
      );
    });

    it('AC-ONB-01-07: completes all required steps, transitioning status to COMPLETED', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      // Step 1: SHOP_PROFILE
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.SHOP_PROFILE,
        {},
        actorOwner,
        'c1',
        '127.0.0.1'
      );
      // Step 2: WAREHOUSE
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.WAREHOUSE,
        { data: { name: 'Kho', phone: '0901234567', address: '123 Duong' } },
        actorOwner,
        'c2',
        '127.0.0.1'
      );
      // Step 4: CARRIER_ACCOUNT
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.CARRIER_ACCOUNT,
        {},
        actorOwner,
        'c4',
        '127.0.0.1'
      );
      // Step 6: TEST_ORDER
      const res = await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.TEST_ORDER,
        {},
        actorOwner,
        'c6',
        '127.0.0.1'
      );

      assert.strictEqual(res.data.status, OnboardingOverallStatus.COMPLETED);
      assert.strictEqual(res.data.progress_percentage, 100);
      assert.strictEqual(res.data.completed_required_steps, 4);
      assert.ok(res.data.completed_at);
    });

    it('AC-ONB-01-08: dismisses completed onboarding', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      // Complete all 4 required steps
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.SHOP_PROFILE,
        {},
        actorOwner,
        'c1',
        '127.0.0.1'
      );
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.WAREHOUSE,
        { data: { name: 'Kho', phone: '0901234567', address: '123 Duong' } },
        actorOwner,
        'c2',
        '127.0.0.1'
      );
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.CARRIER_ACCOUNT,
        {},
        actorOwner,
        'c4',
        '127.0.0.1'
      );
      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.TEST_ORDER,
        {},
        actorOwner,
        'c6',
        '127.0.0.1'
      );

      const res = await service.dismissOnboarding(
        'm-tenant-2',
        actorOwner,
        'corr-dismiss',
        '127.0.0.1'
      );
      assert.strictEqual(res.data.status, OnboardingOverallStatus.DISMISSED);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'ONBOARDING_DISMISSED');
      assert.ok(audit);
    });

    it('AC-ONB-01-09: throws ONBOARDING_INCOMPLETE if attempting dismiss before required steps completed', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      await assert.rejects(
        async () => {
          await service.dismissOnboarding(
            'm-tenant-2',
            actorOwner,
            'corr-dismiss-fail',
            '127.0.0.1'
          );
        },
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'ONBOARDING_INCOMPLETE');
          assert.strictEqual(err.status, 400);
          return true;
        }
      );
    });

    it('AC-ONB-01-10: resets onboarding state', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new OnboardingService(mockPrisma as any);

      await service.completeStep(
        'm-tenant-2',
        OnboardingStepId.SHOP_PROFILE,
        {},
        actorOwner,
        'c1',
        '127.0.0.1'
      );
      const resetRes = await service.resetOnboarding(
        'm-tenant-2',
        actorOwner,
        'corr-reset',
        '127.0.0.1'
      );

      assert.strictEqual(resetRes.data.status, OnboardingOverallStatus.IN_PROGRESS);
      assert.strictEqual(resetRes.data.progress_percentage, 0);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'ONBOARDING_RESET');
      assert.ok(audit);
    });
  });
});
