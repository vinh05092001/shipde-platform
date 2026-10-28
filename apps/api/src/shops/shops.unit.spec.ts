import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { ShopsService } from './shops.service';
import { validateUpdateShopProfileDto, UpdateShopProfileDto } from './shops.dto';
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
      contact_email: 'support@gumac.vn',
      contact_phone: '0901234567',
      legal_address: '128 Nguyen Trai, P3, Q5, TP.HCM',
      billing_email: 'finance@gumac.vn',
      billing_address: '128 Nguyen Trai, P3, Q5, TP.HCM',
      bank_name: 'Vietcombank',
      bank_account_number: '0071001234567',
      bank_account_name: 'CTY CP GUMAC',
      bank_branch: 'Chi nhánh Nam Sài Gòn',
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      default_fee_payer: 'SHOP',
      default_weight_unit: 'g',
      auto_routing_enabled: false,
      operating_notes: 'Giao giờ hành chính',
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    {
      id: 'm-tenant-2',
      name: 'Another Merchant',
      code: 'ANOTHER_SHOP',
      status: 'active',
      legal_name: 'CTY TNHH KHAC',
      tax_code: '0101234567',
      contact_email: 'info@another.vn',
      contact_phone: '0912345678',
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
      default_fee_payer: 'SHOP',
      default_weight_unit: 'g',
      auto_routing_enabled: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
  ];

  const auditLogs: any[] = [];

  const mockTx = {
    merchant: {
      update: async ({ where, data }: any) => {
        const idx = merchants.findIndex((m) => m.id === where.id);
        if (idx === -1) throw new Error('Merchant not found');
        merchants[idx] = { ...merchants[idx], ...data, updated_at: new Date() };
        return merchants[idx];
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
    merchants,
    auditLogs,
    merchant: {
      findUnique: async ({ where }: any) => {
        return merchants.find((m) => m.id === where.id) || null;
      },
      findMany: async ({ where }: any) => {
        if (!where) return merchants;
        return merchants.filter((m) => m.id === where.id);
      },
      update: mockTx.merchant.update,
    },
    auditLog: mockTx.auditLog,
    $transaction: async (cb: any) => cb(mockTx),
  };
}

describe('FEAT-ORG-01: Shop Profile Unit Test Suite', () => {
  describe('DTO Validation: validateUpdateShopProfileDto', () => {
    it('should validate complete valid DTO with 0 errors', () => {
      const validDto: UpdateShopProfileDto = {
        name: 'Gumac Saigon Store',
        legal_name: 'Công ty Cổ phần Thời trang Gumac',
        tax_code: '0312345678',
        contact_email: 'contact@gumac.vn',
        contact_phone: '0901234567',
        legal_address: '128 Nguyễn Trãi, P.3, Q.5, TP.HCM',
        billing_email: 'invoice@gumac.vn',
        billing_address: '128 Nguyễn Trãi, P.3, Q.5, TP.HCM',
        bank_name: 'Vietcombank',
        bank_account_number: '1234567890',
        bank_account_name: 'CTY CP GUMAC',
        bank_branch: 'Chi nhánh Nam Sài Gòn',
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        default_fee_payer: 'SHOP',
        default_weight_unit: 'g',
        auto_routing_enabled: true,
        operating_notes: 'Kiểm tra hàng trước khi nhận',
      };
      const errors = validateUpdateShopProfileDto(validDto);
      assert.strictEqual(errors.length, 0);
    });

    it('should accept 13-digit branch tax code with hyphen (0312345678-001)', () => {
      const dto: UpdateShopProfileDto = {
        tax_code: '0312345678-001',
      };
      const errors = validateUpdateShopProfileDto(dto);
      assert.strictEqual(errors.length, 0);
    });

    it('should reject invalid tax codes (wrong length or characters)', () => {
      const testCases = ['12345', '031234567890', '031234567A', '0312345678-12', 'invalid-tax'];
      for (const tax of testCases) {
        const errors = validateUpdateShopProfileDto({ tax_code: tax });
        assert.ok(errors.length > 0, `Expected tax_code '${tax}' to fail validation`);
        assert.strictEqual(errors[0].field, 'tax_code');
        assert.strictEqual(errors[0].code, 'INVALID_FORMAT');
      }
    });

    it('should reject short or too long shop names', () => {
      const shortErr = validateUpdateShopProfileDto({ name: 'A' });
      assert.strictEqual(shortErr.length, 1);
      assert.strictEqual(shortErr[0].field, 'name');
      assert.strictEqual(shortErr[0].code, 'INVALID_LENGTH');

      const longErr = validateUpdateShopProfileDto({ name: 'A'.repeat(256) });
      assert.strictEqual(longErr.length, 1);
      assert.strictEqual(longErr[0].field, 'name');
      assert.strictEqual(longErr[0].code, 'INVALID_LENGTH');
    });

    it('should reject invalid contact and billing emails', () => {
      const errContact = validateUpdateShopProfileDto({ contact_email: 'not-an-email' });
      assert.strictEqual(errContact.length, 1);
      assert.strictEqual(errContact[0].field, 'contact_email');

      const errBilling = validateUpdateShopProfileDto({ billing_email: 'wrong@com' });
      assert.strictEqual(errBilling.length, 1);
      assert.strictEqual(errBilling[0].field, 'billing_email');
    });

    it('should reject invalid phone format', () => {
      const errPhone = validateUpdateShopProfileDto({ contact_phone: '123456' });
      assert.strictEqual(errPhone.length, 1);
      assert.strictEqual(errPhone[0].field, 'contact_phone');
      assert.strictEqual(errPhone[0].code, 'INVALID_FORMAT');
    });

    it('should accept normalized Vietnamese phone numbers (09x, 08x, 07x, 05x, 03x and +84)', () => {
      const validPhones = [
        '0901234567',
        '0381234567',
        '0771234567',
        '+84901234567',
        '090 123 4567',
      ];
      for (const phone of validPhones) {
        const errors = validateUpdateShopProfileDto({ contact_phone: phone });
        assert.strictEqual(errors.length, 0, `Expected phone '${phone}' to be valid`);
      }
    });

    it('should reject invalid bank account numbers (too short)', () => {
      const err = validateUpdateShopProfileDto({ bank_account_number: '123' });
      assert.strictEqual(err.length, 1);
      assert.strictEqual(err[0].field, 'bank_account_number');
      assert.strictEqual(err[0].code, 'INVALID_FORMAT');
    });

    it('should reject invalid default_fee_payer enum', () => {
      const err = validateUpdateShopProfileDto({ default_fee_payer: 'UNKNOWN' as any });
      assert.strictEqual(err.length, 1);
      assert.strictEqual(err[0].field, 'default_fee_payer');
      assert.strictEqual(err[0].code, 'INVALID_ENUM');
    });

    it('should reject invalid default_weight_unit enum', () => {
      const err = validateUpdateShopProfileDto({ default_weight_unit: 'lbs' as any });
      assert.strictEqual(err.length, 1);
      assert.strictEqual(err[0].field, 'default_weight_unit');
      assert.strictEqual(err[0].code, 'INVALID_ENUM');
    });

    it('should reject operating notes exceeding 1000 characters', () => {
      const err = validateUpdateShopProfileDto({ operating_notes: 'X'.repeat(1001) });
      assert.strictEqual(err.length, 1);
      assert.strictEqual(err[0].field, 'operating_notes');
      assert.strictEqual(err[0].code, 'MAX_LENGTH');
    });
  });

  describe('ShopsService Operations', () => {
    const actor: ActorContext = {
      userId: 'user-owner-1',
      merchantId: 'm-tenant-1',
      role: 'OWNER',
    };

    it('AC-ORG-01-01: should retrieve current shop profile', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      const res = await service.getShopProfile('m-tenant-1', 'corr-1');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.id, 'm-tenant-1');
      assert.strictEqual(res.data.name, 'Gumac Fashion Flagship');
      assert.strictEqual(res.data.legal_name, 'CTY CP GUMAC');
      assert.strictEqual(res.data.tax_code, '0312345678');
      assert.strictEqual(res.data.bank_name, 'Vietcombank');
      assert.strictEqual(res.data.timezone, 'Asia/Ho_Chi_Minh');
      assert.strictEqual(res.data.default_fee_payer, 'SHOP');
    });

    it('should throw NOT_FOUND for nonexistent merchantId', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      await assert.rejects(
        () => service.getShopProfile('non-existent', 'corr-2'),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.code, 'SHOP_NOT_FOUND');
          return true;
        }
      );
    });

    it('AC-ORG-01-02: should update legal profile and log audit', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      const res = await service.updateShopProfile(
        'm-tenant-1',
        actor,
        {
          name: 'Gumac Global Flagship',
          legal_name: 'Công ty Cổ phần Quốc tế Gumac',
          tax_code: '0312345678-001',
          contact_email: 'new-contact@gumac.vn',
        },
        '192.168.1.1',
        'corr-update-legal'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.name, 'Gumac Global Flagship');
      assert.strictEqual(res.data.legal_name, 'Công ty Cổ phần Quốc tế Gumac');
      assert.strictEqual(res.data.tax_code, '0312345678-001');
      assert.strictEqual(res.data.contact_email, 'new-contact@gumac.vn');

      // Verify audit log
      assert.strictEqual(mockPrisma.auditLogs.length, 1);
      const audit = mockPrisma.auditLogs[0];
      assert.strictEqual(audit.action, 'SHOP_PROFILE_UPDATED');
      assert.strictEqual(audit.merchant_id, 'm-tenant-1');
      assert.strictEqual(audit.entity_type, 'merchant');
      assert.strictEqual(audit.entity_id, 'm-tenant-1');
      assert.strictEqual(audit.actor, 'OWNER');
      assert.ok(audit.ip_address);
      assert.ok(audit.reason.includes('corr-update-legal'));
      assert.deepStrictEqual(audit.new_value.name, 'Gumac Global Flagship');
    });

    it('AC-ORG-01-03: should update billing profile and normalize bank account name to uppercase', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      const res = await service.updateShopProfile(
        'm-tenant-1',
        actor,
        {
          billing_email: 'billing@gumac.vn',
          bank_name: 'Techcombank',
          bank_account_number: '1903123456789',
          bank_account_name: 'cty cp gumac saigon',
        },
        '10.0.0.1',
        'corr-billing'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.billing_email, 'billing@gumac.vn');
      assert.strictEqual(res.data.bank_name, 'Techcombank');
      assert.strictEqual(res.data.bank_account_number, '1903123456789');
      assert.strictEqual(res.data.bank_account_name, 'CTY CP GUMAC SAIGON');
    });

    it('AC-ORG-01-04: should update operating defaults', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      const res = await service.updateShopProfile(
        'm-tenant-1',
        actor,
        {
          default_fee_payer: 'RECIPIENT',
          default_weight_unit: 'kg',
          auto_routing_enabled: true,
          operating_notes: 'Đóng gói 2 lớp',
        },
        '10.0.0.1',
        'corr-operating'
      );

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.default_fee_payer, 'RECIPIENT');
      assert.strictEqual(res.data.default_weight_unit, 'kg');
      assert.strictEqual(res.data.auto_routing_enabled, true);
      assert.strictEqual(res.data.operating_notes, 'Đóng gói 2 lớp');
    });

    it('AC-ORG-01-05: should reject invalid tax code with 400 VALIDATION_ERROR', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      await assert.rejects(
        () =>
          service.updateShopProfile(
            'm-tenant-1',
            actor,
            { tax_code: 'INVALID_TAX' },
            '10.0.0.1',
            'corr-err'
          ),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.ok(err.fields.some((f: any) => f.field === 'tax_code'));
          return true;
        }
      );
    });

    it('AC-ORG-01-10: should enforce strict tenant scoping on getShopById and updateShopById', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      // Caller from tenant 1 accessing tenant 1 profile by ID -> allowed
      const ownRes = await service.getShopById('m-tenant-1', actor, 'corr-own');
      assert.strictEqual(ownRes.success, true);

      // Caller from tenant 1 accessing tenant 2 profile by ID -> 403 FORBIDDEN
      await assert.rejects(
        () => service.getShopById('m-tenant-2', actor, 'corr-cross'),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );

      // Caller from tenant 1 updating tenant 2 profile by ID -> 403 FORBIDDEN
      await assert.rejects(
        () =>
          service.updateShopById(
            'm-tenant-2',
            actor,
            { name: 'Hijacked Name' },
            '10.0.0.1',
            'corr-cross-up'
          ),
        (err: any) => {
          assert.ok(err instanceof CanonicalApiException);
          assert.strictEqual(err.code, 'FORBIDDEN');
          return true;
        }
      );
    });

    it('AC-ORG-01-12: should list authorized shops for the caller', async () => {
      const mockPrisma = createMockPrismaService();
      const service = new ShopsService(mockPrisma as any);

      const res = await service.listShops('m-tenant-1', 'corr-list');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data.shops.length, 1);
      assert.strictEqual(res.data.shops[0].id, 'm-tenant-1');
    });
  });
});
