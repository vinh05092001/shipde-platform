import { PrismaClient, RoleEnum, CarrierCodeEnum, CarrierTierEnum } from '@prisma/client';
import { createHash } from 'node:crypto';

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
  {
    id: 'b0000000-0000-0000-0000-000000000020',
    merchant_id: SEED_MERCHANT_ID,
    email: 'mfa.enrolled@shipde.vn',
    phone: '0908888001',
    full_name: 'MFA Enrolled Test User',
    password_hash:
      'scrypt$16384$8$1$208ddd440a6244a84de5619d5882aa64$b5109485f7030459cb2bf6f372a5ab053363f1aa31051a681750ccb86176bc28413aea018c52bb24207b5b9232968b5656cd57cb0a176e3a8cbfd51ebcb8a343',
    role: RoleEnum.OPS_CSKH,
    status: 'active',
    email_verified_at: new Date('2026-09-01T00:00:00Z'),
    phone_verified_at: new Date('2026-09-01T00:00:00Z'),
    terms_accepted_at: new Date('2026-09-01T00:00:00Z'),
    terms_version: '2026.1',
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

// Deterministic MFA fixtures (FEAT-AUTH-05: encrypted seed & hashed recovery codes)
export const SEED_MFA_FACTOR = {
  id: 'e0000000-0000-0000-0000-000000000001',
  user_id: 'b0000000-0000-0000-0000-000000000020',
  merchant_id: SEED_MERCHANT_ID,
  type: 'TOTP',
  encrypted_secret: JSON.stringify({
    iv: '0102030405060708090a0b0c',
    tag: '112233445566778899aabbccddeeff00',
    data: 'aabbccddeeff00112233445566778899aabbccdd',
  }),
  key_version: 1,
  status: 'ACTIVE',
  activated_at: new Date('2026-09-01T00:00:00Z'),
};

export const SEED_MFA_RECOVERY_CODES = Array.from({ length: 10 }).map((_, i) => ({
  id: `e0000000-0000-0000-0001-00000000000${i}`,
  factor_id: SEED_MFA_FACTOR.id,
  code_hash: createHash('sha256')
    .update(`SEED-RECOVERY-CODE-${i + 1}`)
    .digest('hex'),
}));

// Complete administrative list of 63 provinces & centrally-governed cities of Vietnam
export const VIETNAM_PROVINCES = [
  { code: '01', name: 'Thành phố Hà Nội', region: 'Bắc' },
  { code: '79', name: 'Thành phố Hồ Chí Minh', region: 'Nam' },
  { code: '48', name: 'Thành phố Đà Nẵng', region: 'Trung' },
  { code: '31', name: 'Thành phố Hải Phòng', region: 'Bắc' },
  { code: '92', name: 'Thành phố Cần Thơ', region: 'Nam' },
  { code: '89', name: 'Tỉnh An Giang', region: 'Nam' },
  { code: '77', name: 'Tỉnh Bà Rịa - Vũng Tàu', region: 'Nam' },
  { code: '24', name: 'Tỉnh Bắc Giang', region: 'Bắc' },
  { code: '06', name: 'Tỉnh Bắc Kạn', region: 'Bắc' },
  { code: '95', name: 'Tỉnh Bạc Liêu', region: 'Nam' },
  { code: '27', name: 'Tỉnh Bắc Ninh', region: 'Bắc' },
  { code: '83', name: 'Tỉnh Bến Tre', region: 'Nam' },
  { code: '52', name: 'Tỉnh Bình Định', region: 'Trung' },
  { code: '74', name: 'Tỉnh Bình Dương', region: 'Nam' },
  { code: '70', name: 'Tỉnh Bình Phước', region: 'Nam' },
  { code: '60', name: 'Tỉnh Bình Thuận', region: 'Trung' },
  { code: '96', name: 'Tỉnh Cà Mau', region: 'Nam' },
  { code: '04', name: 'Tỉnh Cao Bằng', region: 'Bắc' },
  { code: '66', name: 'Tỉnh Đắk Lắk', region: 'Tây Nguyên' },
  { code: '67', name: 'Tỉnh Đắk Nông', region: 'Tây Nguyên' },
  { code: '11', name: 'Tỉnh Điện Biên', region: 'Bắc' },
  { code: '75', name: 'Tỉnh Đồng Nai', region: 'Nam' },
  { code: '87', name: 'Tỉnh Đồng Tháp', region: 'Nam' },
  { code: '64', name: 'Tỉnh Gia Lai', region: 'Tây Nguyên' },
  { code: '02', name: 'Tỉnh Hà Giang', region: 'Bắc' },
  { code: '35', name: 'Tỉnh Hà Nam', region: 'Bắc' },
  { code: '42', name: 'Tỉnh Hà Tĩnh', region: 'Trung' },
  { code: '30', name: 'Tỉnh Hải Dương', region: 'Bắc' },
  { code: '93', name: 'Tỉnh Hậu Giang', region: 'Nam' },
  { code: '17', name: 'Tỉnh Hòa Bình', region: 'Bắc' },
  { code: '33', name: 'Tỉnh Hưng Yên', region: 'Bắc' },
  { code: '56', name: 'Tỉnh Khánh Hòa', region: 'Trung' },
  { code: '91', name: 'Tỉnh Kiên Giang', region: 'Nam' },
  { code: '62', name: 'Tỉnh Kon Tum', region: 'Tây Nguyên' },
  { code: '12', name: 'Tỉnh Lai Châu', region: 'Bắc' },
  { code: '68', name: 'Tỉnh Lâm Đồng', region: 'Tây Nguyên' },
  { code: '20', name: 'Tỉnh Lạng Sơn', region: 'Bắc' },
  { code: '10', name: 'Tỉnh Lào Cai', region: 'Bắc' },
  { code: '80', name: 'Tỉnh Long An', region: 'Nam' },
  { code: '36', name: 'Tỉnh Nam Định', region: 'Bắc' },
  { code: '40', name: 'Tỉnh Nghệ An', region: 'Trung' },
  { code: '37', name: 'Tỉnh Ninh Bình', region: 'Bắc' },
  { code: '58', name: 'Tỉnh Ninh Thuận', region: 'Trung' },
  { code: '25', name: 'Tỉnh Phú Thọ', region: 'Bắc' },
  { code: '54', name: 'Tỉnh Phú Yên', region: 'Trung' },
  { code: '44', name: 'Tỉnh Quảng Bình', region: 'Trung' },
  { code: '49', name: 'Tỉnh Quảng Nam', region: 'Trung' },
  { code: '51', name: 'Tỉnh Quảng Ngãi', region: 'Trung' },
  { code: '22', name: 'Tỉnh Quảng Ninh', region: 'Bắc' },
  { code: '45', name: 'Tỉnh Quảng Trị', region: 'Trung' },
  { code: '94', name: 'Tỉnh Sóc Trăng', region: 'Nam' },
  { code: '14', name: 'Tỉnh Sơn La', region: 'Bắc' },
  { code: '72', name: 'Tỉnh Tây Ninh', region: 'Nam' },
  { code: '34', name: 'Tỉnh Thái Bình', region: 'Bắc' },
  { code: '19', name: 'Tỉnh Thái Nguyên', region: 'Bắc' },
  { code: '38', name: 'Tỉnh Thanh Hóa', region: 'Bắc' },
  { code: '46', name: 'Tỉnh Thừa Thiên Huế', region: 'Trung' },
  { code: '82', name: 'Tỉnh Tiền Giang', region: 'Nam' },
  { code: '84', name: 'Tỉnh Trà Vinh', region: 'Nam' },
  { code: '08', name: 'Tỉnh Tuyên Quang', region: 'Bắc' },
  { code: '86', name: 'Tỉnh Vĩnh Long', region: 'Nam' },
  { code: '26', name: 'Tỉnh Vĩnh Phúc', region: 'Bắc' },
  { code: '15', name: 'Tỉnh Yên Bái', region: 'Bắc' },
];

export const SEED_ADDRESS_FIXTURES = [
  {
    province: 'Thành phố Hà Nội',
    district: 'Quận Cầu Giấy',
    ward: 'Phường Dịch Vọng Hậu',
    street: 'Số 1 Duy Tân',
    postal_code: '100000',
    region: 'Bắc',
  },
  {
    province: 'Thành phố Hồ Chí Minh',
    district: 'Quận 1',
    ward: 'Phường Bến Nghé',
    street: '72 Lê Thánh Tôn',
    postal_code: '700000',
    region: 'Nam',
  },
  {
    province: 'Thành phố Đà Nẵng',
    district: 'Quận Hải Châu',
    ward: 'Phường Thạch Thang',
    street: '24 Trần Phú',
    postal_code: '550000',
    region: 'Trung',
  },
];

export async function seedDatabase(client?: PrismaClient): Promise<{
  merchantsCount: number;
  usersCount: number;
  accountsCount: number;
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

    // 5. Seed MFA Test Fixture (FEAT-AUTH-05)
    let mfaCount = 0;
    if ((prisma as any).mfaFactor) {
      await (prisma as any).mfaFactor.upsert({
        where: { id: SEED_MFA_FACTOR.id },
        update: {
          encrypted_secret: SEED_MFA_FACTOR.encrypted_secret,
          status: SEED_MFA_FACTOR.status,
          activated_at: SEED_MFA_FACTOR.activated_at,
        },
        create: SEED_MFA_FACTOR,
      });

      for (const rc of SEED_MFA_RECOVERY_CODES) {
        await (prisma as any).mfaRecoveryCode.upsert({
          where: { id: rc.id },
          update: { code_hash: rc.code_hash },
          create: rc,
        });
      }
      mfaCount = await (prisma as any).mfaFactor.count();
    }

    const merchantsCount = await prisma.merchant.count();
    const usersCount = await prisma.user.count();
    const accountsCount = await prisma.carrierAccount.count();

    if (merchantsCount === 0 || usersCount === 0 || accountsCount === 0) {
      throw new Error(
        `Seed verification failed: found ${merchantsCount} merchants, ${usersCount} users, ${accountsCount} accounts.`
      );
    }

    return { merchantsCount, usersCount, accountsCount, tokensCount, mfaCount };
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
  } catch (error: any) {
    console.error('❌ Lỗi khởi tạo dữ liệu mẫu:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main();
}
