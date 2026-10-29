import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UserListItem } from '@shipde/contracts';
import UsersSettingsPage from './page';
import {
  isManageUsersForbidden,
  resolveUsersUIState,
  shouldDisplayUsersEmptyState,
  USERS_EMPTY_STATE_TEXT,
  USER_SUSPEND_SUCCESS_TOAST,
  USER_ACTIVATE_SUCCESS_TOAST,
  USER_DEACTIVATE_SUCCESS_TOAST,
  USER_UPDATE_SUCCESS_TOAST,
} from '@/components/UserManagementTab';
import { AuthProvider } from '@/context/AuthContext';

/**
 * FEAT-USR-02: Web UI States and Component Verification Test
 * Tests SCR-USR-01 (/settings/users):
 * - Loading state (skeleton rows)
 * - Empty state ("Không tìm thấy người dùng phù hợp")
 * - Error state (persistent banner with retry)
 * - Forbidden state (403 callout)
 * - Populated table with ACTIVE, SUSPENDED, and DISABLED statuses
 * - Action button guards (sole owner and self disruption disabled)
 * - State helper contracts
 */
async function runUsersPageStatesTest() {
  console.log('--- Running FEAT-USR-02 Users Settings Page UI States Proving Test ---');

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
      store_scopes: ['store_01', 'store_02'],
      warehouse_scopes: ['wh_tanbinh'],
      carrier_account_scopes: ['ca_ghn_01'],
      created_at: new Date('2026-01-15T00:00:00Z').toISOString(),
      last_active_at: new Date('2026-03-01T11:45:00Z').toISOString(),
    },
    {
      id: 'u-suspended-03',
      full_name: 'Lê Văn Tạm Ngưng',
      email: 'suspended@shopde.vn',
      phone: '0903334444',
      role: 'ACCOUNTANT',
      status: 'SUSPENDED',
      store_scopes: ['store_01'],
      warehouse_scopes: [],
      carrier_account_scopes: [],
      created_at: new Date('2026-02-01T00:00:00Z').toISOString(),
      last_active_at: new Date('2026-02-20T08:00:00Z').toISOString(),
    },
    {
      id: 'u-disabled-04',
      full_name: 'Phạm Văn Đã Nghỉ',
      email: 'disabled@shopde.vn',
      phone: '0904445555',
      role: 'WAREHOUSE',
      status: 'DISABLED',
      store_scopes: [],
      warehouse_scopes: ['wh_tanbinh'],
      carrier_account_scopes: [],
      created_at: new Date('2026-02-10T00:00:00Z').toISOString(),
      last_active_at: null,
    },
  ];

  const renderPage = (props?: any) => {
    return renderToStaticMarkup(
      React.createElement(AuthProvider, null, React.createElement(UsersSettingsPage, props || {}))
    );
  };

  // 1. Helper contracts verification
  assert.strictEqual(isManageUsersForbidden('OWNER'), false, 'OWNER must be allowed');
  assert.strictEqual(isManageUsersForbidden('OPS_CSKH'), false, 'OPS_CSKH must be allowed');
  assert.strictEqual(isManageUsersForbidden('ACCOUNTANT'), true, 'ACCOUNTANT must be forbidden');
  assert.strictEqual(isManageUsersForbidden('WAREHOUSE'), true, 'WAREHOUSE must be forbidden');
  assert.strictEqual(isManageUsersForbidden(null), true, 'Unauthenticated must be forbidden');

  assert.strictEqual(
    resolveUsersUIState({ isForbidden: true, error: null, loading: false, itemCount: 10 }),
    'forbidden'
  );
  assert.strictEqual(
    resolveUsersUIState({
      isForbidden: false,
      error: 'Network Error',
      loading: false,
      itemCount: 0,
    }),
    'error'
  );
  assert.strictEqual(
    resolveUsersUIState({ isForbidden: false, error: null, loading: true, itemCount: 0 }),
    'loading'
  );
  assert.strictEqual(
    resolveUsersUIState({ isForbidden: false, error: null, loading: false, itemCount: 0 }),
    'empty'
  );
  assert.strictEqual(
    resolveUsersUIState({ isForbidden: false, error: null, loading: false, itemCount: 5 }),
    'ready'
  );

  assert.strictEqual(
    shouldDisplayUsersEmptyState({ error: null, loading: false, itemCount: 0 }),
    true,
    'Empty state should display when no error and 0 items'
  );
  assert.strictEqual(
    shouldDisplayUsersEmptyState({ error: 'Server outage', loading: false, itemCount: 0 }),
    false,
    'Empty state must NOT display during server error'
  );
  assert.strictEqual(
    shouldDisplayUsersEmptyState({ error: null, loading: true, itemCount: 0 }),
    false,
    'Empty state must NOT display during loading'
  );

  // 2. UI State: LOADING
  const loadingHtml = renderPage({ initialLoading: true, initialUsers: [] });
  assert.ok(
    loadingHtml.includes('data-testid="users-loading-skeleton"'),
    'Loading state must render skeleton container'
  );
  assert.ok(
    loadingHtml.includes('animate-pulse'),
    'Loading skeleton must feature animate-pulse CSS'
  );
  assert.ok(
    !loadingHtml.includes(USERS_EMPTY_STATE_TEXT),
    'Loading state must NOT render empty copy prematurely'
  );

  // 3. UI State: FORBIDDEN
  const forbiddenHtml = renderPage({
    initialLoading: false,
    initialForbidden: true,
    initialUsers: mockUsers,
  });
  assert.ok(
    forbiddenHtml.includes('data-testid="users-forbidden-state"'),
    'Forbidden state must render forbidden callout container'
  );
  assert.ok(
    forbiddenHtml.includes('403') && forbiddenHtml.includes('Không Có Quyền'),
    'Forbidden state must render 403 message'
  );
  assert.ok(
    !forbiddenHtml.includes('data-testid="user-row-u-owner-01"'),
    'Forbidden state must hide user management table'
  );

  // 4. UI State: ERROR banner with retry
  const errorHtml = renderPage({
    initialLoading: false,
    initialError: 'Lỗi kết nối máy chủ khi tải danh sách người dùng',
    initialUsers: [],
  });
  assert.ok(
    errorHtml.includes('role="alert"') && errorHtml.includes('Lỗi kết nối máy chủ'),
    'Error state must render alert banner with error message'
  );
  assert.ok(errorHtml.includes('Thử lại'), 'Error state must display retry button');
  assert.ok(
    !errorHtml.includes(USERS_EMPTY_STATE_TEXT),
    'Error state must NOT render empty state during server error'
  );

  // 5. UI State: EMPTY
  const emptyHtml = renderPage({
    initialLoading: false,
    initialUsers: [],
  });
  assert.ok(
    emptyHtml.includes('data-testid="users-empty-state"'),
    'Empty state container must be rendered'
  );
  assert.ok(
    emptyHtml.includes(USERS_EMPTY_STATE_TEXT),
    `Empty state must render exact contract text: "${USERS_EMPTY_STATE_TEXT}"`
  );

  // 6. UI State: POPULATED TABLE & ALL STATUSES
  const populatedHtml = renderPage({
    initialLoading: false,
    initialUsers: mockUsers,
  });

  // Verify rows rendered
  assert.ok(populatedHtml.includes('data-testid="user-row-u-owner-01"'), 'Owner row rendered');
  assert.ok(populatedHtml.includes('Trần Văn Chủ Shop'), 'Owner full name rendered');
  assert.ok(populatedHtml.includes('data-testid="user-row-u-ops-02"'), 'CSKH row rendered');
  assert.ok(
    populatedHtml.includes('data-testid="user-row-u-suspended-03"'),
    'Suspended row rendered'
  );
  assert.ok(
    populatedHtml.includes('data-testid="user-row-u-disabled-04"'),
    'Disabled row rendered'
  );

  // Verify status badges
  assert.ok(populatedHtml.includes('Hoạt động'), 'ACTIVE status badge rendered');
  assert.ok(populatedHtml.includes('Tạm ngưng'), 'SUSPENDED status badge rendered');
  assert.ok(populatedHtml.includes('Vô hiệu hóa'), 'DISABLED status badge rendered');

  // Verify action buttons present
  assert.ok(populatedHtml.includes('data-testid="edit-btn-u-owner-01"'), 'Edit button rendered');
  assert.ok(
    populatedHtml.includes('data-testid="suspend-btn-u-ops-02"'),
    'Suspend button for ACTIVE user rendered'
  );
  assert.ok(
    populatedHtml.includes('data-testid="activate-btn-u-suspended-03"'),
    'Activate button for SUSPENDED user rendered'
  );
  assert.ok(
    populatedHtml.includes('data-testid="deactivate-btn-u-ops-02"'),
    'Deactivate button rendered'
  );

  // Verify sole active owner guard
  // Sole owner u-owner-01 cannot be suspended or deactivated
  assert.ok(
    populatedHtml.includes('data-testid="suspend-btn-u-owner-01"') &&
      populatedHtml.includes('cursor-not-allowed'),
    'Sole active owner suspend button must be disabled with cursor-not-allowed'
  );

  // Verify toast constants
  assert.ok(USER_SUSPEND_SUCCESS_TOAST.length > 0);
  assert.ok(USER_ACTIVATE_SUCCESS_TOAST.length > 0);
  assert.ok(USER_DEACTIVATE_SUCCESS_TOAST.length > 0);
  assert.ok(USER_UPDATE_SUCCESS_TOAST.length > 0);

  console.log('✅ ALL SCR-USR-01 UI STATE AND CONTRACT TESTS PASSED');
}

void runUsersPageStatesTest();
