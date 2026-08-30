// ============================================================================
// Ship Dễ — Regression Audit Test Suite
// Kiểm toán hồi quy tính nhất quán dữ liệu, phân quyền và luật nghiệp vụ
// ============================================================================

import {
  MASTER_SHIPMENTS,
  MASTER_EXCEPTIONS,
  MASTER_DISCREPANCIES,
  MASTER_CLAIMS,
  getUnifiedMetrics,
} from '../services/unifiedDataStore';
import { MakerCheckerEngine } from '../core/maker-checker';
import { DiscrepancyResolution } from '../types/domain';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ FAILED: ${message}`);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runRegressionSuite() {
  console.log('\n================================================================');
  console.log('🏁 CHẠY KIỂM TOÁN HỒI QUY DỮ LIỆU & QUY TẮC NGHIỆP VỤ SHIP DỄ');
  console.log('================================================================\n');

  // Test 1: Data Count Invariants
  const metrics = getUnifiedMetrics();
  assert(
    metrics.totalShipments === 50,
    `Tổng số bưu kiện trong kho dữ liệu chuẩn là 50 (Thực tế: ${metrics.totalShipments})`
  );
  assert(
    MASTER_SHIPMENTS.length === 50,
    `Danh sách bưu kiện đồng bộ 100% với metrics (50 bản ghi)`
  );
  assert(
    metrics.openExceptionsCount ===
      MASTER_EXCEPTIONS.filter((e) => e.status === 'OPEN' || e.status === 'ASSIGNED').length,
    `Badge Hộp việc và danh sách sự cố mở khớp số lượng (${metrics.openExceptionsCount})`
  );
  assert(
    metrics.openDiscrepanciesCount ===
      MASTER_DISCREPANCIES.filter((d) => d.status === 'OPEN').length,
    `Badge Khoản lệch và bảng đối soát khớp số lượng (${metrics.openDiscrepanciesCount})`
  );

  // Test 2: Maker-Checker Segregation of Duties (BR-12)
  const mcEngine = new MakerCheckerEngine();
  const disc1 = MASTER_DISCREPANCIES[0]; // created_by_user = 'usr_02' (CSKH Hoa)

  // Case 2a: User CSKH Hoa cố gắng tự duyệt chênh lệch do chính mình tạo -> Bị chặn
  let selfApprovalBlocked = false;
  const mockShipment = {
    id: 'shp_001',
    merchant_id: 'merc_01',
    order_id: 'ord_01',
    order_code: 'ORD_01',
    carrier_code: 'GHN' as any,
    carrier_account_id: 'acc_01',
    tracking_code: disc1.tracking_code,
    current_status: 'delivered' as any,
    declared_weight_g: 350,
    quoted_fee: 22000,
    cod_amount: 450000,
    created_at: new Date(),
    version: 1,
    last_modified_by: 'usr_02',
  };

  try {
    mcEngine.resolveDiscrepancy(
      {
        id: disc1.id,
        merchant_id: 'merc_01',
        shipment_id: 'shp_001',
        statement_row_id: 'stmt_01',
        type: disc1.type as any,
        tracking_code: disc1.tracking_code,
        amount: 7000,
        status: DiscrepancyResolution.OPEN,
        created_by_user: 'usr_02',
        version: 1,
        created_at: new Date(),
      },
      mockShipment,
      {
        discrepancy_id: disc1.id,
        resolution: DiscrepancyResolution.CONFIRMED,
        reason: 'Tôi tự duyệt',
        user_id: 'usr_02', // Cố tình tự duyệt
        user_name: 'Trần Thị Hoa',
        expected_version: 1,
      }
    );
  } catch (err: any) {
    if (
      err.code === 'self_approval_forbidden' ||
      err.message?.includes('tách quyền') ||
      err.message?.includes('không thể tự duyệt')
    ) {
      selfApprovalBlocked = true;
    }
  }
  assert(
    selfApprovalBlocked,
    'Quy tắc BR-12: Chặn tuyệt đối người tạo (CSKH) tự duyệt khoản chênh lệch tài chính'
  );

  // Case 2b: Kế toán viên độc lập (usr_03) duyệt chênh lệch -> Thành công
  const testDiscrepancy = {
    id: disc1.id,
    merchant_id: 'merc_01',
    shipment_id: 'shp_001',
    tracking_code: disc1.tracking_code,
    type: disc1.type as any,
    amount: 7000,
    status: DiscrepancyResolution.OPEN,
    created_by_user: 'usr_02',
    version: 1,
    created_at: new Date(),
  };

  const resolved = mcEngine.resolveDiscrepancy(testDiscrepancy as any, mockShipment, {
    discrepancy_id: disc1.id,
    resolution: DiscrepancyResolution.CONFIRMED,
    reason: 'Đã xác minh bảng kê hợp đồng',
    user_id: 'usr_03', // Kế toán duyệt
    user_name: 'Lê Minh Kế Toán',
    expected_version: 1,
  });
  assert(
    resolved.status === DiscrepancyResolution.CONFIRMED && resolved.version === 2,
    'Kế toán viên độc lập duyệt chênh lệch thành công và tăng version lên 2'
  );

  // Test 3: Total Discrepancy Sum Consistency
  const sumAmount = MASTER_DISCREPANCIES.reduce((sum, d) => sum + d.discrepancy_amount, 0);
  assert(
    sumAmount === 1978000,
    `Tổng số tiền lệch D1..D7 tính toán chính xác từ từng dòng: 1.978.000 đ (Thực tế: ${sumAmount.toLocaleString('vi-VN')} đ)`
  );

  console.log('\n================================================================');
  console.log('🎉 TẤT CẢ CÁC BÀI KIỂM TOÁN HỒI QUY ĐẠT 100%');
  console.log('================================================================\n');
}

runRegressionSuite().catch((e) => {
  console.error(e);
  process.exit(1);
});
