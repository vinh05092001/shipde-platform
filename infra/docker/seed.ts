import { PrismaClient, RoleEnum, CarrierCodeEnum, CarrierTierEnum } from '@prisma/client';
import {
  CATALOG_REVISION_2026_10_31,
  SEED_CARRIERS,
  SEED_CARRIER_SERVICES,
  SEED_CANONICAL_STATUSES,
  SEED_FEE_COMPONENTS,
  SEED_COMPATIBILITY_MAPPINGS,
} from '../../packages/testkit/src/carriers/catalog/index.js';

export const SEED_MERCHANT_ID = 'a0000000-0000-0000-0000-000000000001';
export const SEED_MERCHANT_CODE = 'SHOP_DEMO_01';

export const SEED_USERS = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    merchant_id: SEED_MERCHANT_ID,
    email: 'owner@shipde.vn',
    phone: '0901234567',
    full_name: 'Chủ Shop Dễ',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OWNER,
    status: 'active',
    email_verified_at: new Date('2026-09-01T00:00:00Z'),
    phone_verified_at: new Date('2026-09-01T00:00:00Z'),
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    merchant_id: SEED_MERCHANT_ID,
    email: 'ops@shipde.vn',
    phone: '0901234568',
    full_name: 'Điều Phối Viên',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OPS_CSKH,
    status: 'active',
    email_verified_at: new Date('2026-09-01T00:00:00Z'),
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    merchant_id: SEED_MERCHANT_ID,
    email: 'accountant@shipde.vn',
    phone: '0901234569',
    full_name: 'Kế Toán Viên',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.ACCOUNTANT,
    status: 'active',
    email_verified_at: new Date('2026-09-01T00:00:00Z'),
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000010',
    merchant_id: SEED_MERCHANT_ID,
    email: 'pending@shipde.vn',
    phone: '0909999001',
    full_name: 'Pending Test User',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OWNER,
    status: 'pending_verification',
    email_verified_at: null,
    phone_verified_at: null,
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000011',
    merchant_id: SEED_MERCHANT_ID,
    email: 'expired@shipde.vn',
    phone: '0909999002',
    full_name: 'Expired Token Test User',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OWNER,
    status: 'pending_verification',
    email_verified_at: null,
    phone_verified_at: null,
    terms_accepted_at: new Date('2026-08-01T00:00:00Z'),
    terms_version: '2026.1',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000012',
    merchant_id: SEED_MERCHANT_ID,
    email: 'consumed.phone@shipde.vn',
    phone: '0909999003',
    full_name: 'Consumed Phone Test User',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OWNER,
    status: 'pending_verification',
    email_verified_at: null,
    phone_verified_at: null,
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
  },
];

export const SEED_MFA_FACTOR_ID = 'e0000000-0000-0000-0000-000000000001';
export const SEED_MFA_FACTORS = [
  {
    id: SEED_MFA_FACTOR_ID,
    user_id: 'b0000000-0000-0000-0000-000000000002',
    merchant_id: SEED_MERCHANT_ID,
    type: 'TOTP',
    status: 'ACTIVE',
    // Deterministic encrypted test factor material (never plaintext)
    secret_ciphertext:
      'v1:a1b2c3d4e5f6a1b2c3d4e5f6:f1e2d3c4b5a6f1e2d3c4b5a6f1e2d3c4:5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f',
    key_version: 1,
    activated_at: new Date('2026-09-01T00:00:00Z'),
  },
];

export const SEED_VERIFICATION_TOKENS = [
  {
    id: 'd0000000-0000-0000-0000-000000000001',
    user_id: 'b0000000-0000-0000-0000-000000000010',
    token: 'test-token-pending-valid',
    channel: 'email',
    identifier: 'pending@shipde.vn',
    otp: null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    consumed_at: null,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000002',
    user_id: 'b0000000-0000-0000-0000-000000000010',
    token: 'test-token-phone-otp',
    channel: 'phone',
    identifier: '0909999001',
    otp: '123456',
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
    consumed_at: null,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000003',
    user_id: 'b0000000-0000-0000-0000-000000000011',
    token: 'test-token-expired',
    channel: 'email',
    identifier: 'expired@shipde.vn',
    otp: null,
    expires_at: new Date('2026-08-02T00:00:00Z'),
    consumed_at: null,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000004',
    user_id: 'b0000000-0000-0000-0000-000000000010',
    token: 'test-token-consumed',
    channel: 'email',
    identifier: 'pending@shipde.vn',
    otp: null,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    consumed_at: new Date('2026-09-01T00:00:00Z'),
  },
  {
    id: 'd0000000-0000-0000-0000-000000000005',
    user_id: 'b0000000-0000-0000-0000-000000000011',
    token: 'test-token-phone-expired',
    channel: 'phone',
    identifier: '0909999002',
    otp: '123456',
    expires_at: new Date('2026-08-02T00:00:00Z'),
    consumed_at: null,
  },
  {
    id: 'd0000000-0000-0000-0000-000000000006',
    user_id: 'b0000000-0000-0000-0000-000000000012',
    token: 'test-token-phone-consumed',
    channel: 'phone',
    identifier: '0909999003',
    otp: '123456',
    expires_at: new Date(Date.now() + 15 * 60 * 1000),
    consumed_at: new Date('2026-09-01T00:00:00Z'),
  },
];

export const SEED_CARRIER_ACCOUNTS = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    merchant_id: SEED_MERCHANT_ID,
    carrier_code: CarrierCodeEnum.GHN,
    label: 'GHN Chính Thức',
    tier: CarrierTierEnum.L2_EXECUTE,
    encrypted_credentials: JSON.stringify({ token: 'ghn-deterministic-test-token' }),
    status: 'active',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    merchant_id: SEED_MERCHANT_ID,
    carrier_code: CarrierCodeEnum.GHTK,
    label: 'GHTK Chuẩn',
    tier: CarrierTierEnum.L1_ASSIST,
    encrypted_credentials: JSON.stringify({ token: 'ghtk-deterministic-test-token' }),
    status: 'active',
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    merchant_id: SEED_MERCHANT_ID,
    carrier_code: CarrierCodeEnum.VIETTEL_POST,
    label: 'ViettelPost Kho',
    tier: CarrierTierEnum.L1_ASSIST,
    encrypted_credentials: JSON.stringify({ token: 'vtp-deterministic-test-token' }),
    status: 'active',
  },
];

export async function seedDatabase(client?: PrismaClient): Promise<{
  merchantsCount: number;
  usersCount: number;
  accountsCount: number;
  tokensCount: number;
}> {
  const prisma = client || new PrismaClient();
  try {
    // 1. Seed Merchant
    await prisma.merchant.upsert({
      where: { id: SEED_MERCHANT_ID },
      update: {
        name: 'Ship Dễ Flagship Store',
        code: SEED_MERCHANT_CODE,
        status: 'active',
      },
      create: {
        id: SEED_MERCHANT_ID,
        name: 'Ship Dễ Flagship Store',
        code: SEED_MERCHANT_CODE,
        status: 'active',
      },
    });

    // 2. Seed Users
    for (const u of SEED_USERS) {
      await prisma.user.upsert({
        where: { email: u.email },
        update: {
          phone: u.phone,
          full_name: u.full_name,
          // Keep the seeded password authoritative so dev databases seeded
          // before a hash-format change converge back to the documented
          // TestPassword123! credential instead of silently keeping stale
          // hashes that break login.
          password_hash: u.password_hash,
          role: u.role,
          status: u.status,
          email_verified_at: u.email_verified_at,
          phone_verified_at: u.phone_verified_at,
          terms_accepted_at: u.terms_accepted_at,
          terms_version: u.terms_version,
        },
        create: u,
      });
    }

    // 3. Seed Carrier Accounts
    for (const ca of SEED_CARRIER_ACCOUNTS) {
      await prisma.carrierAccount.upsert({
        where: {
          merchant_id_label: {
            merchant_id: ca.merchant_id,
            label: ca.label,
          },
        },
        update: {
          carrier_code: ca.carrier_code,
          tier: ca.tier,
          encrypted_credentials: ca.encrypted_credentials,
          status: ca.status,
        },
        create: ca,
      });
    }

    // 4. Seed Verification Tokens
    let tokensCount = 0;
    if (prisma.verificationToken) {
      for (const vt of SEED_VERIFICATION_TOKENS) {
        await prisma.verificationToken.upsert({
          where: { token: vt.token },
          update: {
            channel: vt.channel,
            identifier: vt.identifier,
            otp: vt.otp,
            expires_at: vt.expires_at,
            consumed_at: vt.consumed_at,
          },
          create: vt,
        });
      }
      tokensCount = await prisma.verificationToken.count();
    }

    const merchantsCount = await prisma.merchant.count();
    const usersCount = await prisma.user.count();
    const accountsCount = await prisma.carrierAccount.count();

    if (merchantsCount === 0 || usersCount === 0 || accountsCount === 0) {
      throw new Error(
        `Seed verification failed: found ${merchantsCount} merchants, ${usersCount} users, ${accountsCount} accounts.`
      );
    }

    // 5. Seed MFA Factors (if model available)
    if ((prisma as any).mfaFactor) {
      for (const mf of SEED_MFA_FACTORS) {
        await (prisma as any).mfaFactor.upsert({
          where: { id: mf.id },
          update: {
            status: mf.status,
            secret_ciphertext: mf.secret_ciphertext,
            activated_at: mf.activated_at,
          },
          create: mf,
        });
      }
    }

    // 6. Seed Platform Carrier Catalog Revision (FEAT-CAR-01)
    let carriersCount = 0;
    let servicesCount = 0;
    let statusesCount = 0;
    let feeComponentsCount = 0;
    let mappingsCount = 0;

    if (prisma.carrier) {
      for (const c of SEED_CARRIERS) {
        await prisma.carrier.upsert({
          where: {
            catalogRevision_code: {
              catalogRevision: c.catalog_revision,
              code: c.code,
            },
          },
          update: {
            name: c.name,
            logoUrl: c.logo_url,
            isActive: c.is_active,
            evidenceLevel: c.evidence_level,
            description: c.description,
          },
          create: {
            id: c.id,
            catalogRevision: c.catalog_revision,
            code: c.code,
            name: c.name,
            logoUrl: c.logo_url,
            isActive: c.is_active,
            evidenceLevel: c.evidence_level,
            description: c.description,
          },
        });
      }
      carriersCount = await prisma.carrier.count({
        where: { catalogRevision: CATALOG_REVISION_2026_10_31 },
      });
    }

    if (prisma.carrierService) {
      for (const s of SEED_CARRIER_SERVICES) {
        await prisma.carrierService.upsert({
          where: {
            catalogRevision_carrierCode_code: {
              catalogRevision: s.catalog_revision,
              carrierCode: s.carrier_code,
              code: s.code,
            },
          },
          update: {
            name: s.name,
            serviceType: s.service_type,
            description: s.description,
            isActive: s.is_active,
            evidenceLevel: s.evidence_level,
            sourceRevision: s.source_revision,
          },
          create: {
            id: s.id,
            carrierId: s.carrier_id,
            catalogRevision: s.catalog_revision,
            carrierCode: s.carrier_code,
            code: s.code,
            name: s.name,
            serviceType: s.service_type,
            description: s.description,
            isActive: s.is_active,
            evidenceLevel: s.evidence_level,
            sourceRevision: s.source_revision,
          },
        });
      }
      servicesCount = await prisma.carrierService.count({
        where: { catalogRevision: CATALOG_REVISION_2026_10_31 },
      });
    }

    if (prisma.canonicalStatusReference) {
      for (const st of SEED_CANONICAL_STATUSES) {
        await prisma.canonicalStatusReference.upsert({
          where: {
            catalogRevision_code: {
              catalogRevision: st.catalog_revision,
              code: st.code,
            },
          },
          update: {
            category: st.category,
            label: st.label,
            description: st.description,
            stageOrder: st.stage_order,
          },
          create: {
            id: st.id,
            catalogRevision: st.catalog_revision,
            code: st.code,
            category: st.category,
            label: st.label,
            description: st.description,
            stageOrder: st.stage_order,
          },
        });
      }
      statusesCount = await prisma.canonicalStatusReference.count({
        where: { catalogRevision: CATALOG_REVISION_2026_10_31 },
      });
    }

    if (prisma.feeComponentReference) {
      for (const fc of SEED_FEE_COMPONENTS) {
        await prisma.feeComponentReference.upsert({
          where: {
            catalogRevision_code: {
              catalogRevision: fc.catalog_revision,
              code: fc.code,
            },
          },
          update: {
            name: fc.name,
            category: fc.category,
            description: fc.description,
            isRefundable: fc.is_refundable,
            vatApplicable: fc.vat_applicable,
          },
          create: {
            id: fc.id,
            catalogRevision: fc.catalog_revision,
            code: fc.code,
            name: fc.name,
            category: fc.category,
            description: fc.description,
            isRefundable: fc.is_refundable,
            vatApplicable: fc.vat_applicable,
          },
        });
      }
      feeComponentsCount = await prisma.feeComponentReference.count({
        where: { catalogRevision: CATALOG_REVISION_2026_10_31 },
      });
    }

    if (prisma.catalogCompatibilityMapping) {
      for (const m of SEED_COMPATIBILITY_MAPPINGS) {
        await prisma.catalogCompatibilityMapping.upsert({
          where: {
            id: m.id,
          },
          update: {
            catalogRevision: m.catalog_revision,
            carrierCode: m.carrier_code,
            domain: m.domain,
            rawKey: m.raw_key,
            canonicalCode: m.canonical_code,
            disposition: m.disposition,
          },
          create: {
            id: m.id,
            catalogRevision: m.catalog_revision,
            carrierCode: m.carrier_code,
            domain: m.domain,
            rawKey: m.raw_key,
            canonicalCode: m.canonical_code,
            disposition: m.disposition,
          },
        });
      }
      mappingsCount = await prisma.catalogCompatibilityMapping.count({
        where: { catalogRevision: CATALOG_REVISION_2026_10_31 },
      });
    }

    return {
      merchantsCount,
      usersCount,
      accountsCount,
      tokensCount,
      carriersCount,
      servicesCount,
      statusesCount,
      feeComponentsCount,
      mappingsCount,
    };
  } finally {
    if (!client) {
      await prisma.$disconnect();
    }
  }
}

async function main() {
  console.log('================================================================');
  console.log('🌱 SHIP DỄ — KHỞI TẠO DỮ LIỆU MẪU (DATABASE SEED)');
  console.log('================================================================');

  try {
    const counts = await seedDatabase();
    console.log(`✅ Khởi tạo dữ liệu mẫu thành công:`);
    console.log(` - Merchants: ${counts.merchantsCount}`);
    console.log(` - Users: ${counts.usersCount}`);
    console.log(` - Carrier Accounts: ${counts.accountsCount}`);
    console.log(` - Verification Tokens: ${counts.tokensCount}`);
    console.log(` - Carriers: ${counts.carriersCount}`);
    console.log(` - Carrier Services: ${counts.servicesCount}`);
    console.log(` - Canonical Statuses: ${counts.statusesCount}`);
    console.log(` - Fee Components: ${counts.feeComponentsCount}`);
    console.log(` - Compatibility Mappings: ${counts.mappingsCount}`);
  } catch (error: any) {
    console.error('❌ Lỗi khởi tạo dữ liệu mẫu:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main();
}
