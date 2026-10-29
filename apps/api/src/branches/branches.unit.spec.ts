import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { BranchesService, maskAuditValue, SENSITIVE_AUDIT_FIELDS } from './branches.service';
import { BranchesController } from './branches.controller';
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
    {
      id: 'u-scoped-tb',
      merchant_id: 'm-tenant-1',
      role: 'OPS_CSKH',
      store_scopes: ['HCM-TB', 'HCM-NEW-SCOPED'],
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
            if (where.is_default !== undefined && branches[i].is_default !== where.is_default)
              continue;
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

  const db = {
    branches,
    users,
    auditLogs,
    branch: {
      findMany: async ({ where, orderBy }: any) => {
        let result = branches.filter((b) => {
          if (where.merchant_id && b.merchant_id !== where.merchant_id) return false;
          if (where.status && b.status !== where.status) return false;
          if (where.is_default !== undefined && b.is_default !== where.is_default) return false;
          if (where.id?.not && b.id === where.id.not) return false;
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
    $transaction: async (cb: any) =>
      cb({
        ...mockTx,
        $queryRaw: async () => [{ id: 'm-tenant-1' }],
        branch: { ...db.branch },
      }),
  };
  return db;
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

    it('rejects non-string or non-boolean types in create DTO with INVALID_TYPE', () => {
      const errors = validateCreateBranchDto({
        name: 'Chi Nhánh Test',
        code: 'TEST-01',
        address: 12345 as any,
        phone: { number: '0901234567' } as any,
        is_default: 'true' as any,
      });
      assert.strictEqual(
        errors.some((e) => e.field === 'address' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'phone' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'is_default' && e.code === 'INVALID_TYPE'),
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

    it('rejects non-string or non-boolean types in update DTO with INVALID_TYPE without throwing', () => {
      const errors = validateUpdateBranchDto({
        name: 12345 as any,
        code: { bad: 'code' } as any,
        address: true as any,
        phone: ['0901234567'] as any,
        is_default: 'false' as any,
      });
      assert.strictEqual(
        errors.some((e) => e.field === 'name' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'code' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'address' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'phone' && e.code === 'INVALID_TYPE'),
        true
      );
      assert.strictEqual(
        errors.some((e) => e.field === 'is_default' && e.code === 'INVALID_TYPE'),
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

    it('Finding 8: listBranches rejects invalid status query with 400 VALIDATION_ERROR', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.listBranches(
            'm-tenant-1',
            actor,
            { status: 'INVALID_STATUS' as any },
            'corr-invalid-status'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 400);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          return true;
        }
      );
    });

    it('Finding 7: createBranch maps concurrent P2002 error to 409 BRANCH_CODE_EXISTS', async () => {
      const mockPrisma = createMockPrismaService();
      mockPrisma.$transaction = async () => {
        const p2002Error: any = new Error(
          'Unique constraint failed on the fields: (`merchant_id`,`code`)'
        );
        p2002Error.code = 'P2002';
        throw p2002Error;
      };
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
            { name: 'Chi Nhánh Đua Lệnh', code: 'HCM-RACE' },
            '127.0.0.1',
            'corr-p2002'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 409);
          assert.strictEqual(err.code, 'BRANCH_CODE_EXISTS');
          return true;
        }
      );
    });

    it('Finding 7: updateBranch maps concurrent P2002 error to 409 BRANCH_CODE_EXISTS', async () => {
      const mockPrisma = createMockPrismaService();
      mockPrisma.$transaction = async () => {
        const p2002Error: any = new Error('Unique constraint failed');
        p2002Error.code = 'P2002';
        throw p2002Error;
      };
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-1',
        role: 'OWNER',
      };

      await assert.rejects(
        async () => {
          await service.updateBranch(
            B1_ID,
            'm-tenant-1',
            actor,
            { code: 'HCM-RACE-UPDATED' },
            '127.0.0.1',
            'corr-p2002-upd'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 409);
          assert.strictEqual(err.code, 'BRANCH_CODE_EXISTS');
          return true;
        }
      );
    });

    it('Finding 3: createBranch rejects out-of-scope creation by scoped actor with 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.createBranch(
            'm-tenant-1',
            actor,
            { name: 'Chi nhánh ngoài phạm vi', code: 'OUT-OF-SCOPE' },
            '127.0.0.1',
            'corr-create-out'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('Finding 1: activateBranch rejects out-of-scope branch for scoped actor with 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.activateBranch(B2_ID, 'm-tenant-1', actor, '127.0.0.1', 'corr-act-out');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('Finding 1: deactivateBranch rejects out-of-scope branch for scoped actor with 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.deactivateBranch(B2_ID, 'm-tenant-1', actor, '127.0.0.1', 'corr-deact-out');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('Finding 1: deleteBranch rejects out-of-scope branch for scoped actor with 403 FORBIDDEN', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      const actor: ActorContext = {
        userId: 'u-scoped-1',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.deleteBranch(B2_ID, 'm-tenant-1', actor, '127.0.0.1', 'corr-del-out');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('Finding 3: createBranch rejects is_default: true when an existing default branch is outside actor scope (out-of-scope default remains unchanged)', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      // u-scoped-tb has scope on ['HCM-TB', 'HCM-NEW-SCOPED'].
      // The current default branch is B1_ID ('HCM-Q3'), which is outside this user's scope.
      const actor: ActorContext = {
        userId: 'u-scoped-tb',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.createBranch(
            'm-tenant-1',
            actor,
            { name: 'Chi nhánh Mới', code: 'HCM-NEW-SCOPED', is_default: true },
            '127.0.0.1',
            'corr-create-def'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      // Verify B1_ID remains default and new branch was not created
      const b1 = mockPrisma.branches.find((b) => b.id === B1_ID);
      assert.strictEqual(b1?.is_default, true);
      const newBranch = mockPrisma.branches.find((b) => b.code === 'HCM-NEW-SCOPED');
      assert.strictEqual(newBranch, undefined);
    });

    it('Finding 3: updateBranch rejects is_default: true when an existing default branch is outside actor scope (out-of-scope default remains unchanged)', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new BranchesService(mockPrisma as any);

      // u-scoped-tb has scope on ['HCM-TB', 'HCM-NEW-SCOPED'].
      // Target B2_ID ('HCM-TB') is in scope, but current default B1_ID ('HCM-Q3') is out of scope.
      const actor: ActorContext = {
        userId: 'u-scoped-tb',
        merchantId: 'm-tenant-1',
        role: 'OPS_CSKH',
      };

      await assert.rejects(
        async () => {
          await service.updateBranch(
            B2_ID,
            'm-tenant-1',
            actor,
            { is_default: true },
            '127.0.0.1',
            'corr-update-def'
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      // Verify B1_ID remains default and B2_ID remains non-default
      const b1 = mockPrisma.branches.find((b) => b.id === B1_ID);
      assert.strictEqual(b1?.is_default, true);
      const b2 = mockPrisma.branches.find((b) => b.id === B2_ID);
      assert.strictEqual(b2?.is_default, false);
    });
  });

  describe('Default branch concurrent scope regression', () => {
    for (const operation of ['create', 'update'] as const) {
      it(`${operation} rejects an out-of-scope default committed before the transaction lock`, async () => {
        const db = createMockPrismaService();
        // Initially both the target and current default are in scope. A competing
        // request commits a new default while this request is entering its transaction.
        db.users.find((u) => u.id === 'u-scoped-tb')!.store_scopes.push('HCM-Q3');
        const outside = {
          ...db.branches[0],
          id: '33333333-3333-3333-3333-333333333333',
          code: 'OUTSIDE',
          is_default: false,
        };
        db.branches.push(outside);
        const transaction = db.$transaction;
        let locked = false;
        db.$transaction = async (cb: any) => {
          db.branches[0].is_default = false;
          outside.is_default = true;
          return transaction(async (tx: any) => {
            tx.$queryRaw = async (sql: TemplateStringsArray, ...values: unknown[]) => {
              assert.match(sql.join('?'), /merchants[\s\S]*FOR NO KEY UPDATE/);
              assert.deepStrictEqual(values, ['m-tenant-1']);
              locked = true;
              return [{ id: 'm-tenant-1' }];
            };
            const findMany = tx.branch.findMany;
            tx.branch.findMany = async (args: any) => {
              assert.ok(locked, 'affected defaults must be read after acquiring the tenant lock');
              return findMany(args);
            };
            return cb(tx);
          });
        };
        const service = new BranchesService(db as any);
        const actor: ActorContext = {
          userId: 'u-scoped-tb',
          merchantId: 'm-tenant-1',
          role: 'OPS_CSKH',
        };
        await assert.rejects(
          () =>
            operation === 'create'
              ? service.createBranch(
                  actor.merchantId,
                  actor,
                  { name: 'New branch', code: 'HCM-NEW-SCOPED', is_default: true },
                  '',
                  'concurrent-create'
                )
              : service.updateBranch(
                  B2_ID,
                  actor.merchantId,
                  actor,
                  { is_default: true },
                  '',
                  'concurrent-update'
                ),
          (err: any) => err.getStatus() === 403 && err.code === 'FORBIDDEN'
        );
        assert.ok(locked);
        assert.strictEqual(outside.is_default, true);
        assert.strictEqual(db.branches[1].is_default, false);
        assert.strictEqual(db.branches.length, 4, 'no branch was created');
        assert.strictEqual(db.auditLogs.length, 0, 'denied mutation must not write an audit');
      });
    }
  });

  describe('BranchesController: Read Guard & Custom Role Authorization (Finding 2)', () => {
    it('denies both read actions when the registry denies access, regardless of enum or custom role code', async () => {
      let reads = 0;
      const controller = new BranchesController(
        {
          listBranches: async () => reads++,
          getBranchById: async () => reads++,
        } as any,
        { actorHasPermissions: async () => false } as any
      );
      for (const role of ['OWNER', 'OPS_CSKH', 'FINANCE'] as const) {
        for (const customRoleId of [undefined, 'custom-finance']) {
          const req: any = {
            actorContext: { userId: 'user', merchantId: 'merchant', role, customRoleId },
          };
          await assert.rejects(
            () => controller.listBranches(undefined, req, {} as any),
            (err: any) => err.getStatus() === 403 && err.code === 'FORBIDDEN'
          );
          await assert.rejects(
            () => controller.getBranchById(B1_ID, req, {} as any),
            (err: any) => err.getStatus() === 403 && err.code === 'FORBIDDEN'
          );
        }
      }
      assert.strictEqual(reads, 0, 'denied reads must never reach branch data');
    });
    it('rejects listBranches and getBranchById for custom role without code and without iam:shop_config even if named "Non-Finance" or "Finance"', async () => {
      const mockBranchesService: any = {
        listBranches: async () => ({ success: true, data: { branches: [], can_edit: false } }),
        getBranchById: async () => ({ success: true, data: {} }),
      };
      const mockRbacService: any = {
        actorHasPermissions: async () => false,
      };
      const controller = new BranchesController(mockBranchesService, mockRbacService);

      const makeReqRes = (customRoleId: string) => {
        const actor: ActorContext = {
          userId: 'u-1',
          merchantId: 'm-tenant-1',
          role: 'ACCOUNTANT',
          customRoleId,
        };
        const req: any = { actorContext: actor };
        const res: any = {
          status: (s: number) => ({ json: (d: any) => ({ status: s, ...d }) }),
        };
        return { req, res };
      };

      // 1. Non-Finance display name -> rejected 403 for listBranches and getBranchById
      const { req: req1, res: res1 } = makeReqRes('role-non-finance');
      await assert.rejects(
        async () => {
          await controller.listBranches(undefined, req1, res1);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await controller.getBranchById(B1_ID, req1, res1);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      // 2. "Finance Lead" display name without authoritative code -> also rejected 403
      const { req: req2, res: res2 } = makeReqRes('role-finance-name');
      await assert.rejects(
        async () => {
          await controller.listBranches(undefined, req2, res2);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      await assert.rejects(
        async () => {
          await controller.getBranchById(B1_ID, req2, res2);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), 403);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('allows listBranches and getBranchById only through registered view or configuration permissions', async () => {
      const mockBranchesService: any = {
        listBranches: async () => ({ success: true, data: { branches: [], can_edit: false } }),
        getBranchById: async () => ({ success: true, data: { id: B1_ID } }),
      };
      const mockRbacService: any = {
        actorHasPermissions: async (actor: any, perms: string[]) =>
          Boolean(
            (perms.includes('iam:shop_config') && actor.hasPerm) ||
            (perms.includes('iam:shop_view') && actor.customRoleId === 'role-authoritative-finance')
          ),
      };
      const controller = new BranchesController(mockBranchesService, mockRbacService);

      // Role with authoritative code: 'FINANCE'
      const actorFinance: ActorContext = {
        userId: 'u-1',
        merchantId: 'm-tenant-1',
        role: 'ACCOUNTANT',
        customRoleId: 'role-authoritative-finance',
      };
      const reqFinance: any = { actorContext: actorFinance };
      let statusSet = 0;
      const resFinance: any = {
        status: (s: number) => {
          statusSet = s;
          return { json: (d: any) => d };
        },
      };

      await controller.listBranches(undefined, reqFinance, resFinance);
      assert.strictEqual(statusSet, 200);

      await controller.getBranchById(B1_ID, reqFinance, resFinance);
      assert.strictEqual(statusSet, 200);

      // Member holding iam:shop_config
      const actorWithPerm: any = {
        userId: 'u-2',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
        hasPerm: true,
      };
      const reqPerm: any = { actorContext: actorWithPerm };
      await controller.listBranches(undefined, reqPerm, resFinance);
      assert.strictEqual(statusSet, 200);

      await controller.getBranchById(B1_ID, reqPerm, resFinance);
      assert.strictEqual(statusSet, 200);
    });
  });
});
