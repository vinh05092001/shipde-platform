import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import {
  WarehousesService,
  maskWarehouseAuditValue,
  SENSITIVE_WAREHOUSE_AUDIT_FIELDS,
} from './warehouses.service';
import {
  validateCreateWarehouseDto,
  validateUpdateWarehouseDto,
  CreateWarehouseDto,
  UpdateWarehouseDto,
} from './warehouses.dto';
import { CanonicalApiException } from '../auth/auth.service';
import type { ActorContext } from '../rbac/rbac.dto';

function createMockPrismaService() {
  const warehouses: any[] = [
    {
      id: 'wh-hcm-01',
      merchant_id: 'm-tenant-1',
      name: 'Kho Tân Bình',
      code: 'WH-HCM-01',
      status: 'active',
      is_default: true,
      contact_name: 'Nguyễn Văn Kho',
      contact_phone: '0901234567',
      contact_email: 'kho.tanbinh@gumac.vn',
      address_line: '128 Đường Trường Chinh, Phường 12',
      ward: 'Phường 12',
      district: 'Quận Tân Bình',
      city: 'TP. Hồ Chí Minh',
      postal_code: '700000',
      address_json: {
        contact_name: 'Nguyễn Văn Kho',
        contact_phone: '0901234567',
        contact_email: 'kho.tanbinh@gumac.vn',
        address_line: '128 Đường Trường Chinh, Phường 12',
        ward: 'Phường 12',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        postal_code: '700000',
      },
      use_different_return_address: false,
      return_contact_name: null,
      return_contact_phone: null,
      return_address_line: null,
      return_ward: null,
      return_district: null,
      return_city: null,
      return_address_json: null,
      operating_hours: {
        monday: { open: '08:00', close: '18:00' },
      },
      cutoff_time: '16:00',
      schedule_notes: 'Lấy hàng trước 16h',
      contacts_json: null,
      printer_paper_size: 'A6',
      printer_dpi: 203,
      printer_name: 'Xprinter XP-420B',
      printer_auto_print: false,
      printer_config: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'wh-hn-01',
      merchant_id: 'm-tenant-1',
      name: 'Kho Long Biên',
      code: 'WH-HN-01',
      status: 'active',
      is_default: false,
      contact_name: 'Trần Văn Bắc',
      contact_phone: '0987654321',
      contact_email: 'kho.longbien@gumac.vn',
      address_line: '45 Đường Nguyễn Văn Cừ',
      ward: 'Phường Bồ Đề',
      district: 'Quận Long Biên',
      city: 'TP. Hà Nội',
      postal_code: '100000',
      address_json: {},
      use_different_return_address: false,
      created_at: new Date('2026-01-02T00:00:00Z'),
      updated_at: new Date('2026-01-02T00:00:00Z'),
    },
    {
      id: 'wh-foreign-01',
      merchant_id: 'm-tenant-2',
      name: 'Kho Đối Thủ',
      code: 'WH-DT-01',
      status: 'active',
      is_default: true,
      contact_name: 'Người Lạ',
      contact_phone: '0912345678',
      address_line: '100 Lê Duẩn',
      district: 'Quận Hải Châu',
      city: 'TP. Đà Nẵng',
      address_json: {},
      use_different_return_address: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const users: any[] = [
    {
      id: 'u-owner-1',
      role: 'OWNER',
      warehouse_scopes: [],
    },
    {
      id: 'u-scoped-hcm',
      role: 'WAREHOUSE',
      warehouse_scopes: ['wh-hcm-01'],
    },
    {
      id: 'u-scoped-wildcard',
      role: 'OPS_CSKH',
      warehouse_scopes: ['*'],
    },
    {
      id: 'u-scoped-empty',
      role: 'WAREHOUSE',
      warehouse_scopes: [],
    },
  ];

  const auditLogs: any[] = [];

  const mockTx = {
    warehouse: {
      create: async ({ data }: any) => {
        const record = {
          id: data.id || `wh-mock-${Date.now()}`,
          ...data,
          created_at: new Date(),
          updated_at: new Date(),
        };
        warehouses.push(record);
        return record;
      },
      update: async ({ where, data }: any) => {
        const idx = warehouses.findIndex((w) => w.id === where.id);
        if (idx === -1) throw new Error('Warehouse not found');
        warehouses[idx] = { ...warehouses[idx], ...data, updated_at: new Date() };
        return warehouses[idx];
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (let i = 0; i < warehouses.length; i++) {
          if (where.merchant_id && warehouses[i].merchant_id !== where.merchant_id) continue;
          if (where.is_default !== undefined && warehouses[i].is_default !== where.is_default)
            continue;
          if (where.id?.not && warehouses[i].id === where.id.not) continue;
          warehouses[i] = { ...warehouses[i], ...data, updated_at: new Date() };
          count++;
        }
        return { count };
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
    warehouses,
    users,
    auditLogs,
    warehouse: {
      findFirst: async ({ where }: any) => {
        return (
          warehouses.find((w) => {
            if (where.id && w.id !== where.id) return false;
            if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
            return true;
          }) || null
        );
      },
      findUnique: async ({ where }: any) => {
        if (where.id) {
          return warehouses.find((w) => w.id === where.id) || null;
        }
        if (where.merchant_id_code) {
          return (
            warehouses.find(
              (w) =>
                w.merchant_id === where.merchant_id_code.merchant_id &&
                w.code === where.merchant_id_code.code
            ) || null
          );
        }
        return null;
      },
      findMany: async ({ where, orderBy }: any) => {
        let res = warehouses.filter((w) => {
          if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.id?.in && cond.id.in.includes(w.id)) return true;
              if (cond.code?.in && cond.code.in.includes(w.code)) return true;
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        });
        return res;
      },
      count: async ({ where }: any) => {
        return warehouses.filter((w) => {
          if (where.merchant_id && w.merchant_id !== where.merchant_id) return false;
          return true;
        }).length;
      },
      create: mockTx.warehouse.create,
      update: mockTx.warehouse.update,
      updateMany: mockTx.warehouse.updateMany,
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

describe('FEAT-WH-01: Warehouses Unit Test Suite', () => {
  describe('DTO Validation: validateCreateWarehouseDto', () => {
    it('should validate complete valid DTO with 0 errors', () => {
      const validDto: CreateWarehouseDto = {
        name: 'Kho Tân Bình',
        code: 'WH-HCM-01',
        is_default: true,
        contact_name: 'Nguyễn Văn Kho',
        contact_phone: '0901234567',
        contact_email: 'kho.tanbinh@gumac.vn',
        address_line: '128 Trường Chinh, P.12',
        ward: 'Phường 12',
        district: 'Quận Tân Bình',
        city: 'TP. Hồ Chí Minh',
        postal_code: '700000',
        use_different_return_address: false,
        cutoff_time: '16:00',
        schedule_notes: 'Giao ca lúc 12:00',
        printer_paper_size: 'A6',
        printer_dpi: 203,
        printer_name: 'Xprinter XP-420B',
        printer_auto_print: true,
      };
      const errors = validateCreateWarehouseDto(validDto);
      assert.strictEqual(errors.length, 0);
    });

    it('should reject invalid phone format (wrong prefix or short)', () => {
      const dto: CreateWarehouseDto = {
        name: 'Kho Test',
        contact_name: 'A',
        contact_phone: '0123456789', // Invalid prefix 01
        address_line: '123 Đường ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
      };
      const errors = validateCreateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'contact_phone' && e.code === 'INVALID_FORMAT'));
    });

    it('should accept valid Vietnamese phone numbers (09x, 08x, 07x, 05x, 03x, +84)', () => {
      const validPhones = [
        '0901234567',
        '0868123456',
        '0791234567',
        '0561234567',
        '0381234567',
        '+84901234567',
      ];
      for (const phone of validPhones) {
        const dto: CreateWarehouseDto = {
          name: 'Kho Test',
          contact_name: 'Quản Kho',
          contact_phone: phone,
          address_line: '123 Đường ABC',
          district: 'Quận 1',
          city: 'TP.HCM',
        };
        const errors = validateCreateWarehouseDto(dto);
        assert.strictEqual(errors.length, 0, `Phone ${phone} should be valid`);
      }
    });

    it('should reject missing required address fields (address_line, district, city)', () => {
      const dto = {
        name: 'Kho Test',
        contact_name: 'Quản Kho',
        contact_phone: '0901234567',
      } as CreateWarehouseDto;
      const errors = validateCreateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'address_line' && e.code === 'REQUIRED'));
      assert.ok(errors.some((e) => e.field === 'district' && e.code === 'REQUIRED'));
      assert.ok(errors.some((e) => e.field === 'city' && e.code === 'REQUIRED'));
    });

    it('should validate return address fields when use_different_return_address is true', () => {
      const dto: CreateWarehouseDto = {
        name: 'Kho Test',
        contact_name: 'Quản Kho',
        contact_phone: '0901234567',
        address_line: '123 Đường ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
        use_different_return_address: true,
        // missing return contact and address
      };
      const errors = validateCreateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'return_contact_name'));
      assert.ok(errors.some((e) => e.field === 'return_contact_phone'));
      assert.ok(errors.some((e) => e.field === 'return_address_line'));
      assert.ok(errors.some((e) => e.field === 'return_district'));
      assert.ok(errors.some((e) => e.field === 'return_city'));
    });

    it('should reject invalid cutoff_time format (must be HH:mm)', () => {
      const invalidTimes = ['25:00', '16:60', '9:00', 'abc', '16-00'];
      for (const time of invalidTimes) {
        const dto: CreateWarehouseDto = {
          name: 'Kho Test',
          contact_name: 'Quản Kho',
          contact_phone: '0901234567',
          address_line: '123 Đường ABC',
          district: 'Quận 1',
          city: 'TP.HCM',
          cutoff_time: time,
        };
        const errors = validateCreateWarehouseDto(dto);
        assert.ok(
          errors.some((e) => e.field === 'cutoff_time' && e.code === 'INVALID_FORMAT'),
          `Cutoff time ${time} should be rejected`
        );
      }
    });

    it('should accept valid cutoff_time (e.g. 08:30, 16:00, 23:59)', () => {
      const validTimes = ['08:30', '16:00', '23:59', '00:00'];
      for (const time of validTimes) {
        const dto: CreateWarehouseDto = {
          name: 'Kho Test',
          contact_name: 'Quản Kho',
          contact_phone: '0901234567',
          address_line: '123 Đường ABC',
          district: 'Quận 1',
          city: 'TP.HCM',
          cutoff_time: time,
        };
        const errors = validateCreateWarehouseDto(dto);
        assert.strictEqual(errors.length, 0, `Cutoff time ${time} should be accepted`);
      }
    });

    it('should reject invalid printer paper size and DPI', () => {
      const dto: CreateWarehouseDto = {
        name: 'Kho Test',
        contact_name: 'Quản Kho',
        contact_phone: '0901234567',
        address_line: '123 Đường ABC',
        district: 'Quận 1',
        city: 'TP.HCM',
        printer_paper_size: 'LETTER' as any,
        printer_dpi: 600 as any,
      };
      const errors = validateCreateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'printer_paper_size' && e.code === 'INVALID_ENUM'));
      assert.ok(errors.some((e) => e.field === 'printer_dpi' && e.code === 'INVALID_ENUM'));
    });
  });

  describe('DTO Validation: validateUpdateWarehouseDto', () => {
    it('should accept partial update with valid fields', () => {
      const dto: UpdateWarehouseDto = {
        name: 'Kho Tân Bình Cập Nhật',
        cutoff_time: '17:30',
        printer_paper_size: 'K80',
      };
      const errors = validateUpdateWarehouseDto(dto);
      assert.strictEqual(errors.length, 0);
    });

    it('should reject invalid phone in update', () => {
      const dto: UpdateWarehouseDto = {
        contact_phone: '12345',
      };
      const errors = validateUpdateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'contact_phone'));
    });

    it('should reject invalid status in update', () => {
      const dto: UpdateWarehouseDto = {
        status: 'archived' as any,
      };
      const errors = validateUpdateWarehouseDto(dto);
      assert.ok(errors.some((e) => e.field === 'status' && e.code === 'INVALID_ENUM'));
    });
  });

  describe('Audit Log Masking: maskWarehouseAuditValue', () => {
    it('masks sensitive fields including phone and email', () => {
      assert.strictEqual(maskWarehouseAuditValue('contact_phone', '0901234567'), '090****567');
      assert.strictEqual(
        maskWarehouseAuditValue('contact_email', 'warehouse@gumac.vn'),
        'w****e@gumac.vn'
      );
      assert.strictEqual(
        maskWarehouseAuditValue('return_contact_phone', '0987654321'),
        '098****321'
      );
    });

    it('preserves non-sensitive fields unmasked', () => {
      assert.strictEqual(maskWarehouseAuditValue('name', 'Kho Tân Bình'), 'Kho Tân Bình');
      assert.strictEqual(maskWarehouseAuditValue('code', 'WH-HCM-01'), 'WH-HCM-01');
      assert.strictEqual(
        maskWarehouseAuditValue('address_line', '128 Trường Chinh'),
        '128 Trường Chinh'
      );
      assert.strictEqual(maskWarehouseAuditValue('printer_paper_size', 'A6'), 'A6');
    });
  });

  describe('WarehousesService Operations', () => {
    it('AC-WH-01-01: Owner lists all warehouses in tenant', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      const res = await service.listWarehouses('m-tenant-1', actor, true, 'corr-1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.length, 2);
      assert.strictEqual(res.data[0].merchant_id, 'm-tenant-1');
      assert.strictEqual(res.data[1].merchant_id, 'm-tenant-1');
    });

    it('AC-WH-01-02: Scoped user lists only assigned warehouses', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = {
        userId: 'u-scoped-hcm',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      const res = await service.listWarehouses('m-tenant-1', actor, false, 'corr-2');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.length, 1);
      assert.strictEqual(res.data[0].id, 'wh-hcm-01');
    });

    it('AC-WH-01-02b: User with empty warehouse_scopes receives empty list', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = {
        userId: 'u-scoped-empty',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      const res = await service.listWarehouses('m-tenant-1', actor, false, 'corr-empty');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.length, 0);
    });

    it('AC-WH-01-03: Scoped user views permitted warehouse detail', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = {
        userId: 'u-scoped-hcm',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      const res = await service.getWarehouseById('wh-hcm-01', 'm-tenant-1', actor, false, 'corr-3');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.id, 'wh-hcm-01');
      assert.strictEqual(res.data.name, 'Kho Tân Bình');
    });

    it('AC-WH-01-04: Scoped user gets 403 WAREHOUSE_SCOPE_UNAUTHORIZED on unassigned warehouse', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = {
        userId: 'u-scoped-hcm',
        merchantId: 'm-tenant-1',
        role: 'WAREHOUSE',
      };

      await assert.rejects(
        () => service.getWarehouseById('wh-hn-01', 'm-tenant-1', actor, false, 'corr-4'),
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'WAREHOUSE_SCOPE_UNAUTHORIZED');
          assert.strictEqual(err.getStatus(), 403);
          return true;
        }
      );
    });

    it('AC-WH-01-05: Cross-tenant query returns 404 WAREHOUSE_NOT_FOUND', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      await assert.rejects(
        () => service.getWarehouseById('wh-foreign-01', 'm-tenant-1', actor, true, 'corr-5'),
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'WAREHOUSE_NOT_FOUND');
          assert.strictEqual(err.getStatus(), 404);
          return true;
        }
      );
    });

    it('AC-WH-01-06: Create warehouse and verify audit log generation with masked PII', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      const dto: CreateWarehouseDto = {
        name: 'Kho Bình Thạnh',
        code: 'WH-BT-01',
        contact_name: 'Lê Văn Kho',
        contact_phone: '0933123456',
        contact_email: 'binhthanh@gumac.vn',
        address_line: '50 Điện Biên Phủ',
        district: 'Quận Bình Thạnh',
        city: 'TP. Hồ Chí Minh',
        cutoff_time: '17:00',
        printer_paper_size: 'A6',
        printer_dpi: 300,
      };

      const res = await service.createWarehouse(
        dto,
        'm-tenant-1',
        actor,
        'corr-create',
        '127.0.0.1'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.name, 'Kho Bình Thạnh');
      assert.strictEqual(res.data.code, 'WH-BT-01');
      assert.strictEqual(res.data.printer_dpi, 300);

      // Verify audit log
      const audit = mockPrisma.auditLogs.find((a) => a.action === 'WAREHOUSE_CREATED');
      assert.ok(audit, 'Expected WAREHOUSE_CREATED audit log');
      assert.strictEqual(audit.new_value.contact_phone, '093****456');
      assert.strictEqual(audit.new_value.contact_email, 'b****h@gumac.vn');
    });

    it('AC-WH-01-07: First warehouse automatically becomes is_default = true', async () => {
      const mockPrisma = createMockPrismaService();
      mockPrisma.warehouses.length = 0; // empty warehouses
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = {
        userId: 'u-owner-1',
        merchantId: 'm-tenant-new',
        role: 'OWNER',
      };

      const dto: CreateWarehouseDto = {
        name: 'Kho Đầu Tiên',
        contact_name: 'Nguyễn Văn A',
        contact_phone: '0901234567',
        address_line: '100 Lê Lợi',
        district: 'Quận 1',
        city: 'TP.HCM',
        is_default: false, // caller passed false, but should become true as first
      };

      const res = await service.createWarehouse(
        dto,
        'm-tenant-new',
        actor,
        'corr-first',
        '127.0.0.1'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.is_default, true);
    });

    it('AC-WH-01-08: Reject create warehouse with duplicate code (409 WAREHOUSE_CODE_EXISTS)', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      const dto: CreateWarehouseDto = {
        name: 'Kho Trùng Mã',
        code: 'WH-HCM-01', // already exists in m-tenant-1
        contact_name: 'Nguyễn Văn B',
        contact_phone: '0901234567',
        address_line: '100 Lê Lợi',
        district: 'Quận 1',
        city: 'TP.HCM',
      };

      await assert.rejects(
        () => service.createWarehouse(dto, 'm-tenant-1', actor, 'corr-dup', '127.0.0.1'),
        (err: any) => {
          assert.strictEqual(err instanceof CanonicalApiException, true);
          assert.strictEqual(err.code, 'WAREHOUSE_CODE_EXISTS');
          assert.strictEqual(err.getStatus(), 409);
          return true;
        }
      );
    });

    it('AC-WH-01-12: Update warehouse details and log masked audit', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      const updateDto: UpdateWarehouseDto = {
        name: 'Kho Tân Bình Mở Rộng',
        contact_phone: '0918999888',
        cutoff_time: '18:00',
      };

      const res = await service.updateWarehouse(
        'wh-hcm-01',
        updateDto,
        'm-tenant-1',
        actor,
        'corr-update',
        '127.0.0.1'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.name, 'Kho Tân Bình Mở Rộng');
      assert.strictEqual(res.data.cutoff_time, '18:00');

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'WAREHOUSE_UPDATED');
      assert.ok(audit, 'Expected WAREHOUSE_UPDATED audit log');
      assert.strictEqual(audit.old_value.contact_phone, '090****567');
      assert.strictEqual(audit.new_value.contact_phone, '091****888');
    });

    it('AC-WH-01-13: Set warehouse as default and unset previous default', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      assert.strictEqual(mockPrisma.warehouses[0].is_default, true);
      assert.strictEqual(mockPrisma.warehouses[1].is_default, false);

      const res = await service.setDefaultWarehouse(
        'wh-hn-01',
        'm-tenant-1',
        actor,
        'corr-def',
        '127.0.0.1'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.id, 'wh-hn-01');
      assert.strictEqual(res.data.is_default, true);

      // Verify previous default was unset
      assert.strictEqual(mockPrisma.warehouses[0].is_default, false);
      assert.strictEqual(mockPrisma.warehouses[1].is_default, true);

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'WAREHOUSE_SET_DEFAULT');
      assert.ok(audit, 'Expected WAREHOUSE_SET_DEFAULT audit log');
    });

    it('AC-WH-01-14: Deactivate warehouse (soft-delete)', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new WarehousesService(mockPrisma as any);
      const actor: ActorContext = { userId: 'u-owner-1', merchantId: 'm-tenant-1', role: 'OWNER' };

      const res = await service.deactivateWarehouse(
        'wh-hn-01',
        'm-tenant-1',
        actor,
        'corr-deact',
        '127.0.0.1'
      );
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.status, 'inactive');

      const audit = mockPrisma.auditLogs.find((a) => a.action === 'WAREHOUSE_DEACTIVATED');
      assert.ok(audit, 'Expected WAREHOUSE_DEACTIVATED audit log');
    });
  });
});
