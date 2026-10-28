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
    {
      id: 'p_pii',
      code: 'pii:unmask',
      name: 'Mở che thông tin khách hàng (PII)',
      feature: 'Mở che thông tin khách hàng (PII)',
    },
    {
      id: 'p_reattempt',
      code: 'shipment:cancel_redeliver',
      name: 'Hủy đơn và yêu cầu giao lại',
      feature: 'Hủy đơn và yêu cầu giao lại (Cứu đơn)',
    },
    {
      id: 'p_discrepancy',
      code: 'reconciliation:approve_rate_policy',
      name: 'Phê duyệt chính sách đối soát',
      feature: 'Phê duyệt chính sách đối soát',
    },
    {
      id: 'p_close_period',
      code: 'reconciliation:run_review_audit',
      name: 'Chạy và đối chiếu kiểm toán',
      feature: 'Chạy và đối chiếu kiểm toán',
    },
    {
      id: 'p_return_scan',
      code: 'shipment:receive_return',
      name: 'Nhận hàng hoàn và quét bằng chứng',
      feature: 'Nhận hàng hoàn và quét bằng chứng',
    },
    {
      id: 'p_api_config',
      code: 'iam:shop_config',
      name: 'Cấu hình cửa hàng',
      feature: 'Cấu hình cửa hàng',
    },
    {
      id: 'p_export_ledgers',
      code: 'reconciliation:allocate_bank_receipt',
      name: 'Phân bổ dòng tiền thực nhận',
      feature: 'Phân bổ dòng tiền thực nhận',
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

  // 4. Round 3 Finding 1: When liveRoles is empty (in-flight, failed, or empty catalog),
  // resolveMatrixForLiveRoles returns 0 role grants. Never paint fallback roles or fake grants.
  const emptyResolved = resolveMatrixForLiveRoles([], canonicalMatrixRows);
  assert.strictEqual(emptyResolved.length, canonicalMatrixRows.length);
  for (const row of emptyResolved) {
    assert.strictEqual(
      Object.keys(row.roles).length,
      0,
      `Row ${row.code} must not contain any role grants when live roles are empty`
    );
  }

  // 5. Round 7 Finding 4: Canonical capability mapping verification from seed/spec
  const auditRow = resolved.find((r) => r.code === 'reconciliation:run_review_audit')!;
  assert.strictEqual(auditRow.feature, 'Chạy và đối chiếu kiểm toán');
  assert.strictEqual(auditRow.name, 'Chạy và đối chiếu kiểm toán');

  const bankRow = resolved.find((r) => r.code === 'reconciliation:allocate_bank_receipt')!;
  assert.strictEqual(bankRow.feature, 'Phân bổ dòng tiền thực nhận');
  assert.strictEqual(bankRow.name, 'Phân bổ dòng tiền thực nhận');

  const policyRow = resolved.find((r) => r.code === 'reconciliation:approve_rate_policy')!;
  assert.strictEqual(policyRow.feature, 'Phê duyệt chính sách đối soát');
  assert.strictEqual(policyRow.name, 'Phê duyệt chính sách đối soát');

  console.log(
    '✅ Finding 4 (Round 7): Matrix rows bound to canonical RBAC catalog names and codes proved successfully!'
  );

  console.log(
    '✅ Finding 1 (Round 3): Zero fake grants painted when live roles are empty/in-flight.'
  );
  console.log('✅ Finding 2 & 10: Canonical RBAC Matrix live resolution proved successfully!');
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
