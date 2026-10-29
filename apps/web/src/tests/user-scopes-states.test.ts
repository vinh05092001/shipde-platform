import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UserManagementTab,
  UserWithStores,
  USERS_EMPTY_STATE_TEXT,
  USERS_FORBIDDEN_TEXT,
  USERS_RETRY_LABEL,
  USERS_SCOPE_SUCCESS_TOAST,
  mapCanonicalFieldErrors,
} from '@/components/UserManagementTab';
import { AuthProvider } from '@/context/AuthContext';

/**
 * FEAT-RBAC-02 Acceptance Proving Test: SCR-USR-01 Scope Assignment Real Component UI States
 *
 * Drives real rendering of UserManagementTab across all required UI states:
 * 1. Loading: Skeleton displayed while fetching users; save button shows spinner when submitting
 * 2. Empty: Informative empty state displayed if no team members exist in the shop
 * 3. Forbidden: Unauthorized actors receive 403 callout with iam:manage_users explanation
 * 4. Error with Retry: Persistent error banner allowing immediate retry
 * 5. Ready Table: Displays Store Scopes, Warehouse Scopes, and Carrier Account Scopes
 * 6. Success Toast: Notification banner when scopes are updated
 * 7. Edit Modal: Scope selectors for Branch, Warehouse, and Carrier Account with wildcard support
 * 8. Modal Saving State: Inline spinner on submit button
 * 9. Modal Error & Recovery: Server validation error banner without losing form state
 */
async function runTest() {
  console.log(
    '--- Running FEAT-RBAC-02 User Management & Scope Assignment Component States Test ---'
  );

  const mockUsers: UserWithStores[] = [
    {
      id: 'usr_01',
      full_name: 'Nguyễn Văn An',
      email: 'owner@ananboutique.vn',
      phone: '0901234567',
      role: 'OWNER',
      assigned_stores: ['*'],
      warehouse_scopes: ['*'],
      carrier_account_scopes: ['*'],
      status: 'ACTIVE',
      last_login: 'Vừa xong',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'usr_02',
      full_name: 'Trần Thị Hoa',
      email: 'cskh_hoa@ananboutique.vn',
      phone: '0909876543',
      role: 'OPS_CSKH',
      assigned_stores: ['store_01', 'store_04'],
      warehouse_scopes: ['wh_01'],
      carrier_account_scopes: ['c0000000-0000-0000-0000-000000000001'],
      status: 'ACTIVE',
      last_login: '10 phút trước',
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'usr_03',
      full_name: 'Lê Minh Test',
      email: 'test_minh@ananboutique.vn',
      phone: '0903334444',
      role: 'OPS_CSKH',
      assigned_stores: [],
      warehouse_scopes: [],
      carrier_account_scopes: [],
      status: 'ACTIVE',
      last_login: 'Chưa đăng nhập',
      created_at: '2026-02-01T00:00:00Z',
    },
  ];

  const renderComponent = (props?: any) => {
    return renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(UserManagementTab, props || {}))
    );
  };

  // 1. UI State: LOADING
  console.log('Testing 1. UI State: LOADING...');
  const loadingHtml = renderComponent({ initialLoading: true, initialUsers: [] });
  assert.ok(
    loadingHtml.includes('data-testid="users-loading-skeleton"') ||
      loadingHtml.includes('animate-pulse'),
    'Loading state must render loading skeleton with animate-pulse'
  );
  assert.ok(
    !loadingHtml.includes(USERS_FORBIDDEN_TEXT),
    'Loading state must NOT render false forbidden callout before fetch completes'
  );

  // 2. UI State: EMPTY
  console.log('Testing 2. UI State: EMPTY...');
  const emptyHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: [],
  });
  assert.ok(
    emptyHtml.includes('data-testid="users-empty-state"'),
    'Empty state must render users-empty-state container'
  );
  assert.ok(
    emptyHtml.includes(USERS_EMPTY_STATE_TEXT),
    `Empty state must render exact copy: "${USERS_EMPTY_STATE_TEXT}"`
  );

  // 3. UI State: FORBIDDEN
  console.log('Testing 3. UI State: FORBIDDEN...');
  const forbiddenHtml = renderComponent({
    initialLoading: false,
    initialForbidden: true,
    initialUsers: mockUsers,
  });
  assert.ok(
    forbiddenHtml.includes('data-testid="users-forbidden-callout"'),
    'Forbidden state must render users-forbidden-callout'
  );
  assert.ok(
    forbiddenHtml.includes(USERS_FORBIDDEN_TEXT),
    `Forbidden state must render exact copy: "${USERS_FORBIDDEN_TEXT}"`
  );
  assert.ok(
    forbiddenHtml.includes('iam:manage_users'),
    'Forbidden state must explain iam:manage_users requirement'
  );
  assert.ok(
    !forbiddenHtml.includes('data-testid="users-table"'),
    'Forbidden state must NOT render users data table'
  );

  // 4. UI State: ERROR WITH RETRY
  console.log('Testing 4. UI State: ERROR WITH RETRY...');
  const errorHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialError: 'Lỗi kết nối máy chủ khi tải danh sách người dùng',
    initialUsers: [],
  });
  assert.ok(
    errorHtml.includes('data-testid="users-error-banner"'),
    'Error state must render users-error-banner'
  );
  assert.ok(errorHtml.includes('Lỗi kết nối máy chủ'), 'Error state must render the error message');
  assert.ok(
    errorHtml.includes('data-testid="users-retry-button"') && errorHtml.includes(USERS_RETRY_LABEL),
    'Error state must render retry button with exact label'
  );

  // 5. UI State: READY TABLE & SCOPES PRESENTATION
  console.log('Testing 5. UI State: READY TABLE & SCOPES PRESENTATION...');
  const readyHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
  });
  assert.ok(readyHtml.includes('data-testid="users-table"'), 'Ready state must render users table');
  assert.ok(
    readyHtml.includes('Phạm Vi Chi Nhánh') &&
      readyHtml.includes('Phạm Vi Kho Hàng') &&
      readyHtml.includes('Phạm Vi TK Vận Chuyển'),
    'Ready state table must have column headers for Branch, Warehouse, and Carrier Account scopes'
  );
  assert.ok(
    readyHtml.includes('Toàn Hệ Thống (*)') &&
      readyHtml.includes('Tất Cả Kho (*)') &&
      readyHtml.includes('Tất Cả TK Vận Chuyển (*)'),
    'Ready state table must render wildcard indicators for Owner'
  );
  assert.ok(
    readyHtml.includes('store_01') &&
      readyHtml.includes('wh_01') &&
      readyHtml.includes('c0000000-0000-0000-0000-000000000001'),
    'Ready state table must render specific scope tags for restricted user'
  );
  assert.ok(
    readyHtml.includes('không gán phạm vi'),
    'Ready state table must render "không gán phạm vi" for empty scope arrays'
  );
  assert.ok(
    readyHtml.includes('data-testid="edit-scopes-btn-usr_02"'),
    'Ready state table must render "Gán Phạm Vi" button for users'
  );

  // 6. UI State: SUCCESS TOAST
  console.log('Testing 6. UI State: SUCCESS TOAST...');
  const successHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialToastMessage: USERS_SCOPE_SUCCESS_TOAST,
  });
  assert.ok(
    successHtml.includes(USERS_SCOPE_SUCCESS_TOAST),
    `Success state must render exact toast copy: "${USERS_SCOPE_SUCCESS_TOAST}"`
  );

  // 7. UI State: EDIT SCOPES MODAL
  console.log('Testing 7. UI State: EDIT SCOPES MODAL...');
  const modalHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialEditingUser: mockUsers[1],
  });
  assert.ok(
    modalHtml.includes('data-testid="scope-edit-modal"'),
    'Edit state must render scope-edit-modal'
  );
  assert.ok(
    modalHtml.includes('Phân Quyền &amp; Gán Phạm Vi Cho Nhân Viên') ||
      modalHtml.includes('Phân Quyền & Gán Phạm Vi Cho Nhân Viên'),
    'Edit modal must display title'
  );
  assert.ok(
    modalHtml.includes('data-testid="store-scope-wildcard"'),
    'Edit modal must have store wildcard checkbox'
  );
  assert.ok(
    modalHtml.includes('data-testid="warehouse-scope-wildcard"'),
    'Edit modal must have warehouse wildcard checkbox'
  );
  assert.ok(
    modalHtml.includes('data-testid="carrier-scope-wildcard"'),
    'Edit modal must have carrier account wildcard checkbox'
  );
  assert.ok(
    modalHtml.includes('data-testid="save-scopes-submit-btn"'),
    'Edit modal must have save scopes submit button'
  );

  // 8. UI State: MODAL SAVING (SPINNER)
  console.log('Testing 8. UI State: MODAL SAVING (SPINNER)...');
  const savingHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialEditingUser: mockUsers[1],
    initialScopeLoading: true,
  });
  assert.ok(
    savingHtml.includes('animate-spin'),
    'Saving state must render inline spinner on submit button'
  );
  assert.ok(
    savingHtml.includes('disabled=""') || savingHtml.includes('disabled'),
    'Submit button must be disabled during active scope save submission'
  );

  // 9. UI State: MODAL ERROR & RECOVERY
  console.log('Testing 9. UI State: MODAL ERROR & RECOVERY...');
  const modalErrorHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialEditingUser: mockUsers[1],
    initialScopeError: 'Tài khoản vận chuyển không tồn tại trong hệ thống cửa hàng',
  });
  assert.ok(
    modalErrorHtml.includes('data-testid="scope-save-error"'),
    'Modal error state must render scope-save-error alert banner'
  );
  assert.ok(
    modalErrorHtml.includes('Tài khoản vận chuyển không tồn tại'),
    'Modal error state must display the server validation message'
  );
  assert.ok(
    modalErrorHtml.includes('data-testid="scope-edit-modal"'),
    'Modal must remain open upon error allowing user recovery and re-submission'
  );

  // 10. UI State: FIELD-LEVEL VALIDATION ERRORS (Finding 9)
  console.log('Testing 10. UI State: FIELD-LEVEL VALIDATION ERRORS...');
  const modalFieldErrorHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialEditingUser: mockUsers[1],
    initialFieldErrors: {
      carrier_account_scopes: 'Phần tử trong carrier_account_scopes chứa ký tự không hợp lệ',
      store_scopes: 'Phần tử trong store_scopes chứa ký tự không hợp lệ',
    },
  });
  assert.ok(
    modalFieldErrorHtml.includes('data-testid="field-error-carrier-scopes"'),
    'Modal must render field error for carrier_account_scopes'
  );
  assert.ok(
    modalFieldErrorHtml.includes('data-testid="field-error-store-scopes"'),
    'Modal must render field error for store_scopes'
  );

  // 11. UI State: LIVE CANONICAL ERROR BODY MAPPING (AC-RBAC-02-20, Grok Round 4 Finding 2)
  console.log('Testing 11. UI State: LIVE CANONICAL ERROR BODY MAPPING...');
  const realApiErrorBody = {
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Tài khoản vận chuyển không tồn tại hoặc không thuộc cửa hàng này: ca-invalid-999',
      retryable: false,
      fields: [
        {
          field: 'carrier_account_scopes',
          code: 'INVALID_CARRIER_ACCOUNT',
          message: 'Tài khoản ca-invalid-999 không hợp lệ',
        },
        {
          field: 'store_scopes[0]',
          code: 'INVALID_CHARACTERS',
          message: 'Chứa ký tự không hợp lệ trong chi nhánh',
        },
      ],
    },
  };

  // 11a. Test pure mapping function against real error shape
  const mapped = mapCanonicalFieldErrors(realApiErrorBody);
  assert.strictEqual(
    mapped.carrier_account_scopes,
    'Tài khoản ca-invalid-999 không hợp lệ',
    'mapCanonicalFieldErrors must map carrier_account_scopes'
  );
  assert.strictEqual(
    mapped.store_scopes,
    'Chứa ký tự không hợp lệ trong chi nhánh',
    'mapCanonicalFieldErrors must strip array index and map store_scopes'
  );
  assert.strictEqual(
    mapped['store_scopes[0]'],
    'Chứa ký tự không hợp lệ trong chi nhánh',
    'mapCanonicalFieldErrors must keep exact field path'
  );

  // 11b. Feed real API error body shape to UserManagementTab component
  const modalRealErrorHtml = renderComponent({
    initialLoading: false,
    initialForbidden: false,
    initialUsers: mockUsers,
    initialEditingUser: mockUsers[1],
    initialScopeErrorBody: realApiErrorBody,
  });

  // Must preserve banner
  assert.ok(
    modalRealErrorHtml.includes('data-testid="scope-save-error"'),
    'Modal must keep alert banner when live API error is returned'
  );
  assert.ok(
    modalRealErrorHtml.includes('Tài khoản vận chuyển không tồn tại'),
    'Modal alert banner must display server error message'
  );

  // Must render field errors mapped onto field-error-*
  assert.ok(
    modalRealErrorHtml.includes('data-testid="field-error-carrier-scopes"'),
    'Modal must render field error for carrier_account_scopes from canonical fields array'
  );
  assert.ok(
    modalRealErrorHtml.includes('Tài khoản ca-invalid-999 không hợp lệ'),
    'Modal carrier scope field error must display exact message from fields array'
  );
  assert.ok(
    modalRealErrorHtml.includes('data-testid="field-error-store-scopes"'),
    'Modal must render field error for store_scopes from canonical fields array'
  );
  assert.ok(
    modalRealErrorHtml.includes('Chứa ký tự không hợp lệ trong chi nhánh'),
    'Modal store scope field error must display exact message from fields array'
  );

  console.log(
    'All FEAT-RBAC-02 User Management & Scope Assignment UI States tests passed successfully!'
  );
}

runTest().catch((err) => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
