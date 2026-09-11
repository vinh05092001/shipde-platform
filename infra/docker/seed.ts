import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Bắt đầu khởi tạo dữ liệu mẫu (Deterministic Seed Data)...');

  // Verify connection
  await prisma.$connect();
  console.log('✅ Đã kết nối cơ sở dữ liệu PostgreSQL.');

  console.log('✅ Khởi tạo dữ liệu mẫu thành công.');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi khởi tạo dữ liệu mẫu:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
