import { PrismaClient, RoleEnum, CarrierCodeEnum, CarrierTierEnum } from '@prisma/client';

export const SEED_MERCHANT_ID = 'a0000000-0000-0000-0000-000000000001';
export const SEED_MERCHANT_CODE = 'SHOP_DEMO_01';

export const SEED_USERS = [
  {
    id: 'b0000000-0000-0000-0000-000000000001',
    merchant_id: SEED_MERCHANT_ID,
    email: 'owner@shipde.vn',
    phone: '0901234567',
    full_name: 'Chủ Shop Dễ',
    password_hash: '$2b$10$hashedpasswordsampleforseedtestingonly0000000000000000000',
    role: RoleEnum.OWNER,
    status: 'active',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    merchant_id: SEED_MERCHANT_ID,
    email: 'ops@shipde.vn',
    phone: '0901234568',
    full_name: 'Điều Phối Viên',
    password_hash: '$2b$10$hashedpasswordsampleforseedtestingonly0000000000000000000',
    role: RoleEnum.OPS_CSKH,
    status: 'active',
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    merchant_id: SEED_MERCHANT_ID,
    email: 'accountant@shipde.vn',
    phone: '0901234569',
    full_name: 'Kế Toán Viên',
    password_hash: '$2b$10$hashedpasswordsampleforseedtestingonly0000000000000000000',
    role: RoleEnum.ACCOUNTANT,
    status: 'active',
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
        where: {
          merchant_id_email: {
            merchant_id: u.merchant_id,
            email: u.email,
          },
        },
        update: {
          phone: u.phone,
          full_name: u.full_name,
          role: u.role,
          status: u.status,
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

    const merchantsCount = await prisma.merchant.count();
    const usersCount = await prisma.user.count();
    const accountsCount = await prisma.carrierAccount.count();

    if (merchantsCount === 0 || usersCount === 0 || accountsCount === 0) {
      throw new Error(
        `Seed verification failed: found ${merchantsCount} merchants, ${usersCount} users, ${accountsCount} accounts.`
      );
    }

    return { merchantsCount, usersCount, accountsCount };
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
  } catch (error: any) {
    console.error('❌ Lỗi khởi tạo dữ liệu mẫu:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  main();
}
