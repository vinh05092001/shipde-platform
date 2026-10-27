import * as assert from 'node:assert';
import { RoleItem } from '@shipde/contracts';
import { resolveMatrixForLiveRoles } from '../components/UserManagementTab';

/**
 * Finding 2 & Finding 10 Proving Test: Canonical RBAC Permission Matrix resolution from live roles
 * (SCR-USR-01, BR-RBAC-01, BR-RBAC-06, BR-12)
 */
async function runTest() {
  console.log('--- Running Finding 2 & 10 Live RBAC Matrix Proving Test ---');

  const mockLiveRoles: RoleItem[] = [
    {
      id: 'role-owner',
      code: 'OWNER',
      name: 'Chủ Shop',
      is_system: true,
      permissions_count: 20,
      user_count: 1,
      permissions: [
        { id: 'p1', code: 'pii:unmask', name: 'Xem PII', description: '', category: 'orders' },
        {
          id: 'p2',
          code: 'shipment:cancel_redeliver',
          name: 'Cứu đơn',
          description: '',
          category: 'shipments',
        },
        {
          id: 'p3',
          code: 'reconciliation:approve_rate_policy',
          name: 'Duyệt sai lệch',
          description: '',
          category: 'finance',
        },
        {
          id: 'p4',
          code: 'reconciliation:run_review_audit',
          name: 'Khóa sổ',
          description: '',
          category: 'finance',
        },
        {
          id: 'p5',
          code: 'shipment:receive_return',
          name: 'Nhận hoàn',
          description: '',
          category: 'shipments',
        },
        {
          id: 'p6',
          code: 'iam:shop_config',
          name: 'Cấu hình Shop',
          description: '',
          category: 'iam',
        },
        {
          id: 'p7',
          code: 'reconciliation:allocate_bank_receipt',
          name: 'Xuất sổ',
          description: '',
          category: 'finance',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'role-cskh',
      code: 'OPS_CSKH',
      name: 'CSKH',
      is_system: true,
      permissions_count: 5,
      user_count: 2,
      permissions: [
        { id: 'p1', code: 'pii:unmask', name: 'Xem PII', description: '', category: 'orders' },
        {
          id: 'p2',
          code: 'shipment:cancel_redeliver',
          name: 'Cứu đơn',
          description: '',
          category: 'shipments',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'role-warehouse',
      code: 'WAREHOUSE',
      name: 'Thủ kho',
      is_system: true,
      permissions_count: 4,
      user_count: 1,
      permissions: [
        {
          id: 'p5',
          code: 'shipment:receive_return',
          name: 'Nhận hoàn',
          description: '',
          category: 'shipments',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const canonicalMatrixRows = [
    { id: 'p_pii', code: 'pii:unmask', feature: 'Xem & Mở che số điện thoại khách hàng (PII)' },
    {
      id: 'p_reattempt',
      code: 'shipment:cancel_redeliver',
      feature: 'Gửi lệnh cứu đơn & yêu cầu giao lại qua Open API',
    },
    {
      id: 'p_discrepancy',
      code: 'reconciliation:approve_rate_policy',
      feature: 'Duyệt xử lý sai lệch đối soát (Maker-Checker)',
    },
    {
      id: 'p_close_period',
      code: 'reconciliation:run_review_audit',
      feature: 'Khóa sổ kỳ đối soát COD & Cước',
    },
    {
      id: 'p_return_scan',
      code: 'shipment:receive_return',
      feature: 'Quét nhận hàng hoàn kho ngoại tuyến SQLite',
    },
    {
      id: 'p_api_config',
      code: 'iam:shop_config',
      feature: 'Khai báo API Hãng, Webhook Key & Biểu giá',
    },
    {
      id: 'p_export_ledgers',
      code: 'reconciliation:allocate_bank_receipt',
      feature: 'Xuất dữ liệu Ba Sổ Giá Trị & File Báo Cáo',
    },
  ];

  const resolved = resolveMatrixForLiveRoles(mockLiveRoles, canonicalMatrixRows);

  // 1. OWNER has all canonical capabilities enabled
  for (const row of resolved) {
    assert.strictEqual(
      row.roles['role-owner'],
      true,
      `Owner must hold canonical permission ${row.code}`
    );
  }

  // 2. CSKH has rescue (shipment:cancel_redeliver) and PII, but lacks discrepancy approval (Maker-Checker)
  const rescueRow = resolved.find((r) => r.id === 'p_reattempt')!;
  assert.strictEqual(
    rescueRow.roles['role-cskh'],
    true,
    'CSKH must have shipment:cancel_redeliver'
  );
  const discrepancyRow = resolved.find((r) => r.id === 'p_discrepancy')!;
  assert.strictEqual(
    discrepancyRow.roles['role-cskh'],
    false,
    'CSKH must NOT have reconciliation:approve_rate_policy'
  );

  // 3. WAREHOUSE has return scan (shipment:receive_return)
  const returnRow = resolved.find((r) => r.id === 'p_return_scan')!;
  assert.strictEqual(
    returnRow.roles['role-warehouse'],
    true,
    'Warehouse must have shipment:receive_return'
  );

  console.log('✅ Finding 2 & 10: Canonical RBAC Matrix live resolution proved successfully!');
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
