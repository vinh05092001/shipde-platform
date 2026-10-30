import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserManagementTab, DEFAULT_STORES } from '../components/UserManagementTab';
import {
  BulkActionBar,
  BulkConfirmModal,
  BulkAssignScopesModal,
  BulkResultsModal,
  BulkEntityType,
  BulkActionType,
  BulkItemStatus,
  hasBulkActionPermission,
  formatBulkErrorMessage,
  DEFAULT_WAREHOUSES,
  WarehouseItem,
} from '../components/bulk';
import { AuthProvider } from '../context/AuthContext';
import { UserListItem } from '@shipde/contracts';

/**
 * FEAT-COM-03 Step 2: Bulk Actions UI States and Acceptance Proving Test
 *
 * Verifies:
 * 1. Multi-select UI (checkboxes on header and rows, selection count badges)
 * 2. Action bar behavior across entity types (users, branches, warehouses)
 * 3. Destructive confirmation step (confirm modal with explicit explanation & guards)
 * 4. In-flight progress state (loading spinners and indicators)
 * 5. Per-item truthful results reporting (succeeded, failed, canonical error codes)
 * 6. Partial-failure state presentation & "Retry failed items only" workflow
 * 7. Permission enforcement from API (no hardcoded role names; unknown user -> no edit)
 * 8. Bulk assign scopes modal with wildcard and privilege ceiling warnings
 * 9. CSV export result presentation with download button
 * 10. Warehouses and Branches full list & table rendering with multi-select
 */
async function runBulkActionsStatesTest() {
  console.log('================================================================');
  console.log('📦 SHIP DỄ — BỘ KIỂM TRA GIAO DIỆN THAO TÁC HÀNG LOẠT (FEAT-COM-03)');
  console.log('================================================================\n');

  const mockUsers: UserListItem[] = [
    {
      id: 'u-owner-01',
      full_name: 'Trần Văn Chủ Shop',
      email: 'owner@shopde.vn',
      phone: '0901234567',
      role: 'OWNER',
      status: 'ACTIVE',
      store_scopes: ['*'],
      warehouse_scopes: ['*'],
      carrier_account_scopes: ['*'],
      created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
      last_active_at: new Date('2026-03-01T12:00:00Z').toISOString(),
    },
    {
      id: 'u-ops-02',
      full_name: 'Nguyễn CSKH Vận Hành',
      email: 'cskh@shopde.vn',
      phone: '0909876543',
      role: 'OPS_CSKH',
      status: 'ACTIVE',
      store_scopes: ['store_01'],
      warehouse_scopes: ['wh-main-01'],
      carrier_account_scopes: [],
      created_at: new Date('2026-01-15T00:00:00Z').toISOString(),
      last_active_at: new Date('2026-03-01T11:45:00Z').toISOString(),
    },
    {
      id: 'u-acc-03',
      full_name: 'Lê Kế Toán',
      email: 'accountant@shopde.vn',
      phone: '0903334444',
      role: 'ACCOUNTANT',
      status: 'SUSPENDED',
      store_scopes: ['store_01'],
      warehouse_scopes: [],
      carrier_account_scopes: [],
      created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
      last_active_at: null,
    },
  ];

  const renderTab = (props?: any) => {
    return renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(UserManagementTab, props || {}))
    );
  };

  // --------------------------------------------------------------------------
  // TEST 1: Permission derivation contract (Rule 9 & FEAT-RBAC-02)
  // --------------------------------------------------------------------------
  console.log(
    '🧪 Testing Scenario 1: Permissions derived strictly from API, unknown user fails closed...'
  );

  // Unknown user must NEVER have edit/bulk rights
  assert.strictEqual(
    hasBulkActionPermission(['iam:manage_users'], BulkEntityType.USERS, false),
    false,
    'Unknown user must have no bulk action permission'
  );
  assert.strictEqual(
    hasBulkActionPermission(null, BulkEntityType.USERS, true),
    false,
    'Null permissions must have no bulk action permission'
  );
  assert.strictEqual(
    hasBulkActionPermission([], BulkEntityType.USERS, true),
    false,
    'Empty permissions array must have no bulk action permission'
  );

  // User with iam:manage_users can bulk manage users
  assert.strictEqual(
    hasBulkActionPermission(['iam:manage_users'], BulkEntityType.USERS, true),
    true,
    'Actor with iam:manage_users must have bulk rights on users'
  );
  // User with only iam:manage_users CANNOT bulk manage branches or warehouses
  assert.strictEqual(
    hasBulkActionPermission(['iam:manage_users'], BulkEntityType.BRANCHES, true),
    false,
    'Actor without iam:shop_config must NOT have bulk rights on branches'
  );
  assert.strictEqual(
    hasBulkActionPermission(['iam:manage_users'], BulkEntityType.WAREHOUSES, true),
    false,
    'Actor without iam:shop_config must NOT have bulk rights on warehouses'
  );

  // User with iam:shop_config can bulk manage branches and warehouses
  assert.strictEqual(
    hasBulkActionPermission(['iam:shop_config'], BulkEntityType.BRANCHES, true),
    true,
    'Actor with iam:shop_config must have bulk rights on branches'
  );
  assert.strictEqual(
    hasBulkActionPermission(['iam:shop_config'], BulkEntityType.WAREHOUSES, true),
    true,
    'Actor with iam:shop_config must have bulk rights on warehouses'
  );

  // Wildcard permissions
  assert.strictEqual(
    hasBulkActionPermission(['*'], BulkEntityType.USERS, true),
    true,
    'Wildcard grant must have rights on all entities'
  );
  console.log('  PASS: Permission enforcement verified strictly without role hardcoding.\n');

  // --------------------------------------------------------------------------
  // TEST 2: Users table with multi-select checkboxes and selection state
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 2: Users table multi-select checkboxes & selection UI...');

  const htmlNoSelection = renderTab({
    initialUsers: mockUsers,
    initialPermissions: ['iam:manage_users', 'iam:shop_config'],
  });

  // Table must contain the header "Select All" checkbox
  assert.ok(
    htmlNoSelection.includes('data-testid="users-select-all"'),
    'Users table must render header Select All checkbox'
  );
  // Rows must contain row select checkboxes
  assert.ok(
    htmlNoSelection.includes('data-testid="user-select-row-u-owner-01"'),
    'Row 1 must render checkbox'
  );
  assert.ok(
    htmlNoSelection.includes('data-testid="user-select-row-u-ops-02"'),
    'Row 2 must render checkbox'
  );
  // Action bar must be HIDDEN when 0 items are selected
  assert.ok(
    !htmlNoSelection.includes('data-testid="bulk-action-bar"'),
    'Bulk action bar must be hidden when selectedCount is 0'
  );

  // Now render with 2 users selected
  const htmlWithSelection = renderTab({
    initialUsers: mockUsers,
    initialPermissions: ['iam:manage_users', 'iam:shop_config'],
    initialUsersSelected: ['u-ops-02', 'u-acc-03'],
  });

  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-action-bar"'),
    'Bulk action bar must be rendered when items are selected'
  );
  assert.ok(
    htmlWithSelection.includes('Đã chọn 2 / 3 mục'),
    'Bulk action bar must display selected count'
  );
  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-action-activate"'),
    'Activate action button must be rendered'
  );
  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-action-deactivate"'),
    'Deactivate action button must be rendered'
  );
  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-action-assign_scopes"'),
    'Assign scopes action button must be rendered for users'
  );
  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-action-export_csv"'),
    'Export CSV action button must be rendered'
  );
  assert.ok(
    htmlWithSelection.includes('data-testid="bulk-deselect-btn"'),
    'Deselect button must be rendered'
  );
  console.log('  PASS: Users multi-select checkboxes and action bar rendered accurately.\n');

  // --------------------------------------------------------------------------
  // TEST 3: Action bar forbidden state when lacking permissions
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 3: Bulk action bar forbidden state when lacking permission...');

  const htmlUnauthorized = renderTab({
    initialUsers: mockUsers,
    initialPermissions: [], // Lacks iam:manage_users
    initialUsersSelected: ['u-ops-02'],
  });

  assert.ok(
    htmlUnauthorized.includes('data-testid="bulk-forbidden-warning"'),
    'Action bar must display forbidden warning when operator lacks permission'
  );
  assert.ok(
    htmlUnauthorized.includes('iam:manage_users'),
    'Warning must name the required permission'
  );
  console.log('  PASS: Lacking permission disables execution and renders forbidden indicator.\n');

  // --------------------------------------------------------------------------
  // TEST 4: Destructive confirmation modal (BulkConfirmModal)
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 4: Destructive action confirmation step (BulkConfirmModal)...');

  const confirmModalHtml = renderToStaticMarkup(
    React.createElement(BulkConfirmModal, {
      isOpen: true,
      entityType: BulkEntityType.USERS,
      action: BulkActionType.DEACTIVATE,
      selectedCount: 2,
      loading: false,
      onConfirm: () => {},
      onCancel: () => {},
    })
  );

  assert.ok(
    confirmModalHtml.includes('role="dialog"'),
    'Confirmation modal must be an accessible dialog'
  );
  assert.ok(
    confirmModalHtml.includes('aria-modal="true"'),
    'Confirmation modal must have aria-modal="true"'
  );
  assert.ok(
    confirmModalHtml.includes('Xác nhận tạm ngưng hàng loạt'),
    'Modal title must indicate destructive action'
  );
  assert.ok(
    confirmModalHtml.includes('phiên đăng nhập') && confirmModalHtml.includes('thu hồi'),
    'Modal must explain session revocation consequences'
  );
  assert.ok(
    confirmModalHtml.includes('không thể tạm ngưng Chủ Shop (OWNER) duy nhất'),
    'Modal must explain last active owner protection guard'
  );
  assert.ok(
    confirmModalHtml.includes('data-testid="bulk-confirm-submit"'),
    'Confirm submit button must be present'
  );
  assert.ok(
    confirmModalHtml.includes('data-testid="bulk-confirm-cancel"'),
    'Cancel button must be present'
  );
  console.log(
    '  PASS: Destructive confirmation step provides explicit warnings and protections.\n'
  );

  // --------------------------------------------------------------------------
  // TEST 5: In-flight progress state
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 5: In-flight progress state...');

  const actionBarLoadingHtml = renderToStaticMarkup(
    React.createElement(BulkActionBar, {
      entityType: BulkEntityType.USERS,
      selectedCount: 3,
      totalCount: 10,
      userPermissions: ['iam:manage_users'],
      isUserKnown: true,
      loading: true,
      progressText: 'Đang xử lý 3 mục...',
      onActionClick: () => {},
      onClearSelection: () => {},
    })
  );

  assert.ok(
    actionBarLoadingHtml.includes('data-testid="bulk-in-flight-progress"'),
    'Progress container must be rendered'
  );
  assert.ok(actionBarLoadingHtml.includes('Đang xử lý 3 mục...'), 'Progress text must be visible');
  console.log('  PASS: In-flight progress indicator rendered.\n');

  // --------------------------------------------------------------------------
  // TEST 6: Per-item results modal & truthful error reporting
  // --------------------------------------------------------------------------
  console.log(
    '🧪 Testing Scenario 6: Per-item results modal & truthful canonical error reporting...'
  );

  const resultsModalHtml = renderToStaticMarkup(
    React.createElement(BulkResultsModal, {
      isOpen: true,
      result: {
        batch_id: 'batch-test-123',
        entity_type: BulkEntityType.USERS,
        action: BulkActionType.DEACTIVATE,
        total_count: 3,
        success_count: 2,
        failure_count: 1,
        is_partial_failure: true,
        succeeded_ids: ['u-ops-02', 'u-acc-03'],
        failed_ids: ['u-owner-01'],
        results: [
          {
            id: 'u-owner-01',
            status: BulkItemStatus.FAILED,
            error: {
              code: 'CANNOT_REMOVE_LAST_OWNER',
              message: 'Không thể tạm ngưng chủ shop duy nhất',
            },
          },
          {
            id: 'u-ops-02',
            status: BulkItemStatus.SUCCEEDED,
          },
          {
            id: 'u-acc-03',
            status: BulkItemStatus.SUCCEEDED,
          },
        ],
      },
      itemLabels: {
        'u-owner-01': 'Trần Văn Chủ Shop',
        'u-ops-02': 'Nguyễn CSKH Vận Hành',
        'u-acc-03': 'Lê Kế Toán',
      },
      onRetryFailed: () => {},
      onClose: () => {},
    })
  );

  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-results-modal"'),
    'Results modal must be rendered'
  );
  assert.ok(resultsModalHtml.includes('batch-test-123'), 'Batch ID must be displayed');
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-total-count"'),
    'Total count must be displayed'
  );
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-success-count"'),
    'Success count must be displayed'
  );
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-failure-count"'),
    'Failure count must be displayed'
  );

  // Partial failure banner and retry button
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-partial-failure-banner"'),
    'Partial failure banner must be displayed when failure_count > 0'
  );
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-retry-failed-btn"'),
    'Retry failed items only button must be present in banner'
  );

  // Granular item rows
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-result-badge-failed-u-owner-01"'),
    'Failed item badge must be rendered for owner'
  );
  assert.ok(
    resultsModalHtml.includes('CANNOT_REMOVE_LAST_OWNER'),
    'Canonical error code must be displayed'
  );
  assert.ok(
    resultsModalHtml.includes('data-testid="bulk-result-badge-success-u-ops-02"'),
    'Success badge must be rendered for succeeded user'
  );
  console.log('  PASS: Per-item truthful outcomes and canonical errors displayed accurately.\n');

  // --------------------------------------------------------------------------
  // TEST 7: Canonical error messages dictionary
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 7: Vietnamese error message formatting helper...');

  assert.ok(
    formatBulkErrorMessage('CANNOT_REMOVE_LAST_OWNER').includes('Chủ Shop (OWNER) duy nhất')
  );
  assert.ok(
    formatBulkErrorMessage('SELF_SUSPENSION_PROHIBITED').includes('tài khoản của chính bạn')
  );
  assert.ok(
    formatBulkErrorMessage('CANNOT_DEACTIVATE_DEFAULT_BRANCH').includes('chi nhánh mặc định')
  );
  assert.ok(
    formatBulkErrorMessage('CANNOT_DEACTIVATE_DEFAULT_WAREHOUSE').includes('kho hàng mặc định')
  );
  assert.ok(formatBulkErrorMessage('PRIVILEGE_CEILING_EXCEEDED').includes('trần quyền hạn'));
  console.log('  PASS: Vietnamese canonical error messages confirmed.\n');

  // --------------------------------------------------------------------------
  // TEST 8: Bulk assign scopes modal
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 8: Bulk assign scopes modal (BulkAssignScopesModal)...');

  const assignScopesHtml = renderToStaticMarkup(
    React.createElement(BulkAssignScopesModal, {
      isOpen: true,
      selectedCount: 2,
      availableStores: [
        {
          id: 'store_01',
          code: 'HCM-Q3',
          name: 'Chi Nhánh Quận 3',
          address: '128 Nguyễn Trãi',
          phone: '0901234567',
          manager: 'Nguyễn Văn An',
          active_orders_count: 100,
          status: 'ACTIVE',
        },
      ],
      availableWarehouses: DEFAULT_WAREHOUSES,
      loading: false,
      onConfirm: () => {},
      onCancel: () => {},
    })
  );

  assert.ok(
    assignScopesHtml.includes('data-testid="bulk-assign-scopes-modal"'),
    'Assign scopes modal must be rendered'
  );
  assert.ok(
    assignScopesHtml.includes('data-testid="bulk-scope-all-stores"'),
    'All stores wildcard option must be present'
  );
  assert.ok(
    assignScopesHtml.includes('data-testid="bulk-scope-all-warehouses"'),
    'All warehouses wildcard option must be present'
  );
  assert.ok(
    assignScopesHtml.includes('Bảo vệ trần quyền hạn'),
    'Privilege ceiling notice must be displayed'
  );
  console.log('  PASS: Assign scopes modal controls rendered.\n');

  // --------------------------------------------------------------------------
  // TEST 9: Branches tab table and multi-select UI
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 9: Branches subtab table and multi-select UI...');

  const htmlBranches = renderTab({
    initialActiveSubTab: 'stores',
    initialPermissions: ['iam:shop_config'],
    initialBranches: DEFAULT_STORES,
    initialBranchesSelected: ['store_02'],
  });

  assert.ok(
    htmlBranches.includes('data-testid="branches-tab-content"'),
    'Branches tab content must be rendered'
  );
  assert.ok(
    htmlBranches.includes('data-testid="branches-table"'),
    'Branches table must be rendered'
  );
  assert.ok(
    htmlBranches.includes('data-testid="branches-select-all"'),
    'Branches table must have select all checkbox'
  );
  assert.ok(
    htmlBranches.includes('data-testid="branch-select-row-store_01"'),
    'Store 1 row checkbox must be present'
  );
  assert.ok(
    htmlBranches.includes('data-testid="bulk-action-bar"'),
    'Bulk action bar must be rendered for selected branch'
  );
  assert.ok(htmlBranches.includes('Đã chọn 1 /'), 'Selected branch count must be visible');
  // Branches do NOT have assign_scopes action button
  assert.ok(
    !htmlBranches.includes('data-testid="bulk-action-assign_scopes"'),
    'Branches must NOT have assign_scopes action'
  );
  console.log('  PASS: Branches list multi-select and action bar verified.\n');

  // --------------------------------------------------------------------------
  // TEST 10: Warehouses subtab table and multi-select UI
  // --------------------------------------------------------------------------
  console.log('🧪 Testing Scenario 10: Warehouses subtab table and multi-select UI...');

  const htmlWarehouses = renderTab({
    initialActiveSubTab: 'warehouses',
    initialPermissions: ['iam:shop_config'],
    initialWarehouses: DEFAULT_WAREHOUSES,
    initialWarehousesSelected: ['77777777-7777-4777-8777-777777777777'],
  });

  assert.ok(
    htmlWarehouses.includes('data-testid="warehouses-tab-content"'),
    'Warehouses tab content must be rendered'
  );
  assert.ok(
    htmlWarehouses.includes('data-testid="warehouses-table"'),
    'Warehouses table must be rendered'
  );
  assert.ok(
    htmlWarehouses.includes('data-testid="warehouses-select-all"'),
    'Warehouses table must have select all checkbox'
  );
  assert.ok(
    htmlWarehouses.includes(
      'data-testid="warehouse-select-row-77777777-7777-4777-8777-777777777777"'
    ),
    'Warehouse 1 row checkbox must be present'
  );
  assert.ok(htmlWarehouses.includes('Kho Mặc Định'), 'Default warehouse badge must be present');
  assert.ok(
    htmlWarehouses.includes('data-testid="bulk-action-bar"'),
    'Bulk action bar must be rendered for selected warehouse'
  );
  console.log('  PASS: Warehouses list multi-select and action bar verified.\n');

  // --------------------------------------------------------------------------
  // TEST 11: Empty, loading, and error states (no fabricated rows in empty tenant)
  // --------------------------------------------------------------------------
  console.log(
    '🧪 Testing Scenario 11: Empty, loading, and error states for branches & warehouses...'
  );

  // 11.1: Empty tenant must show empty state and NEVER show fabricated rows
  const htmlEmpty = renderTab({
    initialActiveSubTab: 'stores',
    initialPermissions: ['iam:shop_config'],
    initialBranches: [],
    initialWarehouses: [],
  });
  assert.ok(
    htmlEmpty.includes('data-testid="branches-empty"'),
    'Empty branches list must render branches-empty state'
  );
  assert.ok(
    !htmlEmpty.includes('data-testid="branch-row-'),
    'Empty tenant must NEVER render fabricated branch rows'
  );

  const htmlEmptyWh = renderTab({
    initialActiveSubTab: 'warehouses',
    initialPermissions: ['iam:shop_config'],
    initialBranches: [],
    initialWarehouses: [],
  });
  assert.ok(
    htmlEmptyWh.includes('data-testid="warehouses-empty"'),
    'Empty warehouses list must render warehouses-empty state'
  );
  assert.ok(
    !htmlEmptyWh.includes('data-testid="warehouse-row-'),
    'Empty tenant must NEVER render fabricated warehouse rows'
  );

  // 11.2: Loading states
  const htmlLoadingStores = renderTab({
    initialActiveSubTab: 'stores',
    initialPermissions: ['iam:shop_config'],
    initialLoading: true,
  });
  assert.ok(
    htmlLoadingStores.includes('data-testid="branches-loading"'),
    'Loading branches must render branches-loading state'
  );

  const htmlLoadingWh = renderTab({
    initialActiveSubTab: 'warehouses',
    initialPermissions: ['iam:shop_config'],
    initialLoading: true,
  });
  assert.ok(
    htmlLoadingWh.includes('data-testid="warehouses-loading"'),
    'Loading warehouses must render warehouses-loading state'
  );

  // 11.3: Error states with retry button
  const htmlErrorStores = renderTab({
    initialActiveSubTab: 'stores',
    initialPermissions: ['iam:shop_config'],
    initialError: 'Lỗi nạp danh sách chi nhánh',
  });
  assert.ok(
    htmlErrorStores.includes('data-testid="branches-error"'),
    'Error loading branches must render branches-error state'
  );
  assert.ok(
    htmlErrorStores.includes('data-testid="branches-retry-btn"'),
    'Error state must offer actionable retry button'
  );

  const htmlErrorWh = renderTab({
    initialActiveSubTab: 'warehouses',
    initialPermissions: ['iam:shop_config'],
    initialError: 'Lỗi nạp danh sách kho hàng',
  });
  assert.ok(
    htmlErrorWh.includes('data-testid="warehouses-error"'),
    'Error loading warehouses must render warehouses-error state'
  );
  assert.ok(
    htmlErrorWh.includes('data-testid="warehouses-retry-btn"'),
    'Error state must offer actionable retry button'
  );
  console.log('  PASS: Empty, loading, and error states verified (no fabricated live data).\n');

  // --------------------------------------------------------------------------
  // TEST 12: Action errors and modal failure rendering (Finding 3)
  // --------------------------------------------------------------------------
  console.log(
    '🧪 Testing Scenario 12: Action error banners in action bar and modal failure states...'
  );

  const htmlActionBarError = renderToStaticMarkup(
    React.createElement(BulkActionBar, {
      entityType: BulkEntityType.USERS,
      selectedCount: 2,
      totalCount: 5,
      userPermissions: ['iam:manage_users'],
      isUserKnown: true,
      actionError: '400 VALIDATION_ERROR: Tham số không hợp lệ',
      onActionClick: () => {},
      onClearSelection: () => {},
      onClearError: () => {},
    })
  );
  assert.ok(
    htmlActionBarError.includes('data-testid="bulk-action-error"'),
    'Action error must be rendered in action bar'
  );
  assert.ok(htmlActionBarError.includes('400 VALIDATION_ERROR'), 'Error text must be displayed');

  const htmlConfirmModalError = renderToStaticMarkup(
    React.createElement(BulkConfirmModal, {
      isOpen: true,
      entityType: BulkEntityType.USERS,
      action: 'deactivate',
      selectedCount: 1,
      errorMessage: '409 IDEMPOTENCY_CONFLICT: Thao tác đang được xử lý',
      onConfirm: () => {},
      onCancel: () => {},
    })
  );
  assert.ok(
    htmlConfirmModalError.includes('data-testid="bulk-modal-error"'),
    'Confirm modal must render error message'
  );
  assert.ok(
    htmlConfirmModalError.includes('409 IDEMPOTENCY_CONFLICT'),
    'Modal error message content must be visible'
  );

  const htmlAssignScopesModalError = renderToStaticMarkup(
    React.createElement(BulkAssignScopesModal, {
      isOpen: true,
      selectedCount: 1,
      availableStores: DEFAULT_STORES,
      availableWarehouses: DEFAULT_WAREHOUSES,
      errorMessage: '403 PRIVILEGE_CEILING_EXCEEDED: Vượt quá trần thẩm quyền',
      onConfirm: () => {},
      onCancel: () => {},
    })
  );
  assert.ok(
    htmlAssignScopesModalError.includes('data-testid="bulk-modal-error"'),
    'Assign scopes modal must render error message'
  );
  assert.ok(
    htmlAssignScopesModalError.includes('PRIVILEGE_CEILING_EXCEEDED'),
    'Scope modal error text must be displayed'
  );
  console.log('  PASS: Action error and modal failure states verified.\n');

  console.log('================================================================');
  console.log('🎉 ALL FEAT-COM-03 BULK ACTION UI STATES & CONTROLS PASSED 100%!');
  console.log('================================================================\n');
}

void runBulkActionsStatesTest();
