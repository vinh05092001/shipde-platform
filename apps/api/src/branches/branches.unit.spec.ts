import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { BranchesService, maskAuditValue, SENSITIVE_AUDIT_FIELDS } from './branches.service';
import {
  validateCreateBranchDto,
  validateUpdateBranchDto,
  CreateBranchDto,
  UpdateBranchDto,
} from './branches.dto';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';

const B1_ID = '11111111-1111-1111-1111-111111111111';
const B2_ID = '22222222-2222-2222-2222-222222222222';
const B_FOREIGN_ID = '99999999-9999-9999-9999-999999999999';

function createMockPrismaService() {
  const branches: any[] = [
    {
      id: B1_ID,
      merchant_id: 'm-tenant-1',
      name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
      code: 'HCM-Q3',
      address: '128 Nguyễn Trãi, P. 3, Q. 5, TP. HCM',
      phone: '0901234567',
      is_default: true,
      status: 'ACTIVE',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: B2_ID,
      merchant_id: 'm-tenant-1',
      name: 'Kho Vận Tân Bình',
      code: 'HCM-TB',
      address: '55 CMT8, P. 5, Tân Bình, TP. HCM',
      phone: '0909876543',
      is_default: false,
      status: 'ACTIVE',
      created_at: new Date('2026-01-02T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: B_FOREIGN_ID,
      merchant_id: 'm-tenant-2',
      name: 'Chi Nhánh Tenant Khác',
      code: 'OTHER-01',
      address: '100 Lê Lợi, Hà Nội',
      phone: '0912345678',
      is_default: true,
      status: 'ACTIVE',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const users: any[] = [
    {
      id: 'u-owner-1',
      merchant_id: 'm-tenant-1',
      role: 'OWNER',
      store_scopes: [],
    },
    {
      id: 'u-scoped-1',
      merchant_id: 'm-tenant-1',
      role: 'OPS_CSKH',
      store_scopes: ['HCM-Q3'],
    },
    {
      id: 'u-wildcard-1',
      merchant_id: 'm-tenant-1',
      role: 'OPS_CSKH',
      store_scopes: ['*'],
    },
  ];

  const auditLogs: any[] = [];

  const mockTx = {
    branch: {
      create: async ({ data }: any) => {
        const record = {
          id: `branch-${Date.now()}`,
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        branches.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const idx = branches.findIndex((b) => b.id === where.id);
        if (idx === -1) throw new Error('Branch not found');
        branches[idx] = { ...branches[idx], ...data, updated_at: new Date() };
        return branches[idx];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (let i = 0; i < branches.length; i++) {
          if (branches[i].merchant_id === where.merchant_id) {
            if (!where.id || (where.id.not && branches[i].id !== where.id.not)) {
              branches[i] = { ...branches[i], ...data, updated_at: new Date() };
              count++;
            }
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        const idx = branches.findIndex((b) => b.id === where.id);
        if (idx === -1) throw new Error('Branch not found');
        const [deleted] = branches.splice(idx, 1);
        return deleted;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        const record = { id: `audit-${Date.now()}`, ...data, created_at: new Date() };
        auditLogs.push(record);
        return record;
      },
    },
  };

  return {
    branches,
    users,
    auditLogs,
    branch: {
      findMany: async ({ where, orderBy }: any) => {
        let result = branches.filter((b) => {
          if (where.merchant_id && b.merchant_id !== where.merchant_id) return false;
          if (where.status && b.status !== where.status) return false;
          if (where.OR) {
            const matched = where.OR.some((cond: any) => {
              if (cond.id?.in?.includes(b.id)) return true;
              if (cond.code?.in?.includes(b.code)) return true;
              return false;
            });
            if (!matched) return false;
          }
          return true;
        });
        return result;
      },
      findFirst: async ({ where }: any) => {
        return (
          branches.find((b) => {
            if (where.id && b.id !== where.id) return false;
            if (where.merchant_id && b.merchant_id !== where.merchant_id) return false;
            if (where.code && b.code !== where.code) return false;
            if (where.id?.not && b.id === where.id.not) return false;
            return true;
          }) || null
        );
      },
      count: async ({ where }: any) => {
        return branches.filter((b) => b.merchant_id === where.merchant_id).length;
      },
      create: mockTx.branch.create,
      update: mockTx.branch.update,
      updateMany: mockTx.branch.updateMany,
      delete: mockTx.branch.delete,
    },
    user: {
      findUnique: async ({ where }: any) => {
        return users.find((u) => u.id === where.id) || null;
      },
    },
    auditLog: mockTx.auditLog,
    $transaction: async (cb: any) => cb(mockTx),
  };
}

describe('FEAT-ORG-02: Branches Unit Test Suite', () => {
  describe('DTO Validation: validateCreateBranchDto', () => {
    it('validates valid CreateBranchDto with 0 errors', () => {
      const dto: CreateBranchDto = {
        name: 'Chi Nhánh Đà Nẵng',
        code: 'DN-HC',
        address: '102 Hoàng Văn Thụ, Hải Châu, Đà Nẵng',
        phone: '0901234567',
        is_default: false,
        status: 'ACTIVE',
      };
      const errors = validateCreateBranchDto(dto);
      assert.strictEqual(errors.length, 0);
    });

    it('rejects missing or empty name', () => {
      const dto: any = { name: '', code: 'HCM-01' };
      const errors = validateCreateBranchDto(dto);
      assert.strictEqual(
        errors.some((e) => e.field === 'name'),
        true
      );
    });

    it('rejects name exceeding 255 characters', () => {
      const dto: CreateBranchDto = {
        name: 'A'.repeat(256),
        code: 'HCM-01',
      };
      const errors = validateCreateBranchDto(dto);
      assert.strictEqual(
        errors.some((e) => e.field === 'name' && e.code === 'MAX_LENGTH'),
        true
      );
    });

    it('rejects invalid branch code format', () => {
      const invalidCodes = ['H', 'CODE WITH SPACES', 'CODE@#$', 'A'.repeat(65)];
      for (const code of invalidCodes) {
        const errors = validateCreateBranchDto({ name: 'Chi Nhánh Test', code });
        assert.strictEqual(
          errors.some((e) => e.field === 'code'),
          true,
          `Expected error for code "${code}"`
        );
      }
    });

    it('accepts valid branch codes (alphanumeric, hyphen, underscore)', () => {
      const validCodes = ['HCM-Q3', 'HN_CG', 'store01', 'BRANCH-123_ABC'];
      for (const code of validCodes) {
        const errors = validateCreateBranchDto({ name: 'Chi Nhánh Test', code });
        assert.strictEqual(
          errors.filter((e) => e.field === 'code').length,
          0,
          `Expected no error for code "${code}"`
        );
      }
    });

    it('rejects invalid Vietnamese phone number', () => {
      const errors = validateCreateBranchDto({
        name: 'Chi Nhánh Test',
        code: 'TEST-01',
        phone: '123456',
      });
      assert.strictEqual(
        errors.some((e) => e.field === 'phone'),
        true
      );
    });

    it('accepts valid Vietnamese phone formats', () => {
      const phones = ['0901234567', '+84901234567', '0389998888', '098 123 4567'];
      for (const phone of phones) {
        const errors = validateCreateBranchDto({
          name: 'Chi Nhánh Test',
          code: 'TEST-01',
          phone,
        });
        assert.strictEqual(
          errors.filter((e) => e.field === 'phone').length,
          0,
          `Expected no phone error for "${phone}"`
        );
      }
    });

    it('rejects invalid status value', () => {
      const errors = validateCreateBranchDto({
        name: 'Chi Nhánh Test',
        code: 'TEST-01',
        status: 'DELETED' as any,
      });
      assert.strictEqual(
        errors.some((e) => e.field === 'status'),
        true
      );
    });
  });

  describe('DTO Validation: validateUpdateBranchDto', () => {
    it('validates valid partial update with 0 errors', () => {
      const dto: UpdateBranchDto = {
        name: 'Tên mới',
        phone: '0909876543',
      };
      const errors = validateUpdateBranchDto(dto);
      assert.strictEqual(errors.length, 0);
    });

    it('rejects update with invalid code', () => {
      const dto: UpdateBranchDto = { code: 'INVALID CODE' };
      const errors = validateUpdateBranchDto(dto);
      assert.strictEqual(
        errors.some((e) => e.field === 'code'),
        true
      );
    });
  });

  describe('Audit Logging: maskAuditValue', () => {
    it('masks sensitive phone numbers in audit diffs', () => {
      assert.strictEqual(maskAuditValue('phone', '0901234567'), '090****567');
      assert.strictEqual(maskAuditValue('phone', '+84901234567'), '+84****567');
    });

    it('preserves non-sensitive fields in audit diffs', () => {
      assert.strictEqual(maskAuditValue('name', 'Chi Nhánh Q3'), 'Chi Nhánh Q3');
      assert.strictEqual(maskAuditValue('code', 'HCM-Q3'), 'HCM-Q3');
      assert.strictEqual(maskAuditValue('is_default', true), true);
    });
  });

  describe('BranchesService: Business Rules & Scope Enforcement', () => {
    it('AC-ORG-02-01: Owner lists all tenant branches', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const result = await service.listBranches('m-tenant-1', actor, {}, 'corr-1');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.branches.length, 2);
      assert.strictEqual(result.data.branches[0].code, 'HCM-Q3');
    });

    it('AC-ORG-02-02: Scoped user only sees assigned branches in store_scopes', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      const result = await service.listBranches('m-tenant-1', actor, {}, 'corr-2');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.branches.length, 1);
      assert.strictEqual(result.data.branches[0].code, 'HCM-Q3');
    });

    it('AC-ORG-02-03: Create new branch with code uppercase normalization and audit', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      const dto: CreateBranchDto = {
        name: 'Chi Nhánh Hà Nội',
        code: 'hn-cg',
        address: '320 Cầu Giấy, Hà Nội',
        phone: '0901234567',
      };

      const result = await service.createBranch(
        'm-tenant-1',
        actor,
        dto,
        '127.0.0.1',
        'corr-create'
      );
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data.code, 'HN-CG');
      assert.strictEqual(result.data.is_default, false);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'BRANCH_CREATED');
      assert.ok(audit);
      assert.strictEqual(audit.new_value.code, 'HN-CG');
      assert.strictEqual(audit.new_value.phone, '090****567');
    });

    it('AC-ORG-02-04: Reject duplicate branch code in same tenant with 409 BRANCH_CODE_EXISTS', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.createBranch(
            'm-tenant-1',
            actor,
            { name: 'Duplicate Q3', code: 'hcm-q3' },
            '127.0.0.1',
            'corr-dup'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 409);
          assert.strictEqual(err.code, 'BRANCH_CODE_EXISTS');
          return true;
        }
      );
    });

    it('AC-ORG-02-07: Setting is_default = true atomically resets other branches to is_default = false', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      assert.strictEqual(mockPrisma.branches[0].is_default, true);
      assert.strictEqual(mockPrisma.branches[1].is_default, false);

      await service.updateBranch(
        B2_ID,
        'm-tenant-1',
        actor,
        { is_default: true },
        '127.0.0.1',
        'corr-default'
      );

      assert.strictEqual(mockPrisma.branches[0].is_default, false);
      assert.strictEqual(mockPrisma.branches[1].is_default, true);
    });

    it('AC-ORG-02-10: Reject deactivating default branch with 400 CANNOT_DEACTIVATE_DEFAULT_BRANCH', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.deactivateBranch(B1_ID, 'm-tenant-1', actor, '127.0.0.1', 'corr-deact');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 400);
          assert.strictEqual(err.code, 'CANNOT_DEACTIVATE_DEFAULT_BRANCH');
          return true;
        }
      );
    });

    it('AC-ORG-02-11: Scoped user attempting to access out-of-scope branch receives 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.getBranchById(B2_ID, actor, 'corr-forbidden');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('AC-ORG-02-12: Cross-tenant branch access rejected with 404 BRANCH_NOT_FOUND', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.getBranchById(B_FOREIGN_ID, actor, 'corr-foreign');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 404);
          assert.strictEqual(err.code, 'BRANCH_NOT_FOUND');
          return true;
        }
      );
    });
  });
});
