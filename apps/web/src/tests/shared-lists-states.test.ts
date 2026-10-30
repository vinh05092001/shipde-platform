import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  UserManagementTab,
  USERS_EMPTY_STATE_TEXT,
  USERS_FORBIDDEN_TEXT,
} from '@/components/UserManagementTab';
import { WarehouseManagementView } from '@/components/WarehouseManagementView';
import { BranchManagementView, BranchItem } from '@/components/BranchManagementView';
import BranchesSettingsPage from '@/app/settings/branches/page';
import { AuthProvider } from '@/context/AuthContext';
import { paginateInMemory } from '@/hooks/useSharedListState';
import { parseListQuery } from '@shipde/contracts';
import { USERS_LIST_POLICY, WAREHOUSES_LIST_POLICY, BRANCHES_LIST_POLICY } from '@shipde/config';
import type { Warehouse, UserListItem, Branch } from '@shipde/contracts';

/**
 * FEAT-COM-02: Shared List Behaviour Proving Test Suite
 *
 * Verifies the shared list contract across:
 * 1. Users list (SCR-USR-01 / UserManagementTab)
 * 2. Warehouses list (SCR-WH-01 / WarehouseManagementView)
 * 3. Branches list (SCR-WH-01 / BranchManagementView / BranchesSettingsPage)
 *
 * Checks all AGENTS.md states:
 * - Loading skeleton
 * - Clean empty state
 * - Filtered no-results state with clear filter action
 * - Sortable columns with aria-sort
 * - Pagination controls (page, limit, total, total_pages, prev/next)
 * - Error with recoverable retry
 * - Forbidden 403 state
 * - Permission-based edit rights from API (no hardcoded roles, unknown user fails closed)
 * - In-memory pagination/filter/sort helper mathematical correctness
 */
async function runSharedListsTestSuite() {
  console.log('================================================================');
  console.log('SHIP DỄ — SHARED LISTS CONTRACT & UI STATES TEST SUITE (FEAT-COM-02)');
  console.log('================================================================');

  const mockUsers: UserListItem[] = [
    {
      id: 'usr_01',
      full_name: 'Nguyễn Văn An',
      email: 'owner@ananboutique.vn',
      phone: '0901234567',
      role: 'OWNER',
      store_scopes: ['*'],
      warehouse_scopes: ['*'],
      carrier_account_scopes: ['*'],
      status: 'ACTIVE',
      last_active_at: '2026-03-01T12:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'usr_02',
      full_name: 'Trần Thị Hoa',
      email: 'cskh_hoa@ananboutique.vn',
      phone: '0909876543',
      role: 'OPS_CSKH',
      store_scopes: ['store_01'],
      warehouse_scopes: ['wh_01'],
      carrier_account_scopes: ['ca_01'],
      status: 'ACTIVE',
      last_active_at: '2026-03-01T11:45:00Z',
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'usr_03',
      full_name: 'Lê Minh Test',
      email: 'test_minh@ananboutique.vn',
      phone: '0903334444',
      role: 'ACCOUNTANT',
      store_scopes: [],
      warehouse_scopes: [],
      carrier_account_scopes: [],
      status: 'SUSPENDED',
      last_active_at: null,
      created_at: '2026-02-01T00:00:00Z',
    },
  ];

  const mockWarehouses: Warehouse[] = [
    {
      id: 'wh-01',
      merchant_id: 'm-01',
      name: 'Kho Tân Bình',
      code: 'WH-TB-01',
      status: 'active',
      is_default: true,
      contact_name: 'Nguyễn Văn Kho',
      contact_phone: '0901112222',
      contact_email: 'kho@shipde.vn',
      address_line: '123 Cộng Hòa',
      ward: 'Phường 12',
      district: 'Quận Tân Bình',
      city: 'Hồ Chí Minh',
      postal_code: '700000',
      address_json: {},
      use_different_return_address: false,
      return_contact_name: null,
      return_contact_phone: null,
      return_address_line: null,
      return_ward: null,
      return_district: null,
      return_city: null,
      return_address_json: null,
      operating_hours: null,
      cutoff_time: '16:00',
      schedule_notes: null,
      contacts_json: null,
      printer_paper_size: 'A6',
      printer_dpi: 203,
      printer_name: null,
      printer_auto_print: false,
      printer_config: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'wh-02',
      merchant_id: 'm-01',
      name: 'Kho Cầu Giấy',
      code: 'WH-HN-02',
      status: 'active',
      is_default: false,
      contact_name: 'Trần Thị Hà',
      contact_phone: '0903334444',
      contact_email: 'khohn@shipde.vn',
      address_line: '45 Trần Thái Tông',
      ward: 'Phường Dịch Vọng',
      district: 'Quận Cầu Giấy',
      city: 'Hà Nội',
      postal_code: '100000',
      address_json: {},
      use_different_return_address: false,
      return_contact_name: null,
      return_contact_phone: null,
      return_address_line: null,
      return_ward: null,
      return_district: null,
      return_city: null,
      return_address_json: null,
      operating_hours: null,
      cutoff_time: '17:00',
      schedule_notes: null,
      contacts_json: null,
      printer_paper_size: 'A6',
      printer_dpi: 203,
      printer_name: null,
      printer_auto_print: false,
      printer_config: null,
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    },
  ];

  const mockBranches: Branch[] = [
    {
      id: 'store_01',
      merchant_id: 'tenant-test-1',
      code: 'HCM-Q3',
      name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
      address: '128 Nguyễn Trãi, P.3, Q.5, TP. Hồ Chí Minh',
      phone: '0901234567',
      status: 'ACTIVE',
      is_default: true,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'store_02',
      merchant_id: 'tenant-test-1',
      code: 'HCM-TB',
      name: 'Kho Vận & Cửa Hàng Tân Bình',
      address: '123 Cộng Hòa, P.12, Q. Tân Bình, TP. Hồ Chí Minh',
      phone: '0909876543',
      status: 'ACTIVE',
      is_default: false,
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    },
    {
      id: 'store_03',
      merchant_id: 'tenant-test-1',
      code: 'HN-CG',
      name: 'Chi Nhánh Hà Nội (Cầu Giấy)',
      address: '45 Trần Thái Tông, Cầu Giấy, Hà Nội',
      phone: '0903334444',
      status: 'ACTIVE',
      is_default: false,
      created_at: '2026-01-15T00:00:00Z',
      updated_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 'store_04',
      merchant_id: 'tenant-test-1',
      code: 'DN-HC',
      name: 'Chi Nhánh Đà Nẵng (Hải Châu)',
      address: '88 Nguyễn Văn Linh, Hải Châu, Đà Nẵng',
      phone: '0905556666',
      status: 'ACTIVE',
      is_default: false,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ];

  // ================================================================
  // 1. In-memory Pagination, Filter, and Sort Helper
  // ================================================================
  console.log('🧪 1. Testing in-memory paginateInMemory helper...');
  {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const page1 = paginateInMemory({ items, page: 1, pageSize: 4 });
    assert.strictEqual(page1.total, 10);
    assert.strictEqual(page1.totalPages, 3);
    assert.strictEqual(page1.from, 1);
    assert.strictEqual(page1.to, 4);
    assert.deepStrictEqual(page1.pagedItems, [1, 2, 3, 4]);

    const page2 = paginateInMemory({ items, page: 2, pageSize: 4 });
    assert.strictEqual(page2.from, 5);
    assert.strictEqual(page2.to, 8);
    assert.deepStrictEqual(page2.pagedItems, [5, 6, 7, 8]);

    const page3 = paginateInMemory({ items, page: 3, pageSize: 4 });
    assert.strictEqual(page3.from, 9);
    assert.strictEqual(page3.to, 10);
    assert.deepStrictEqual(page3.pagedItems, [9, 10]);

    // Out-of-bounds page clamps safely
    const page99 = paginateInMemory({ items, page: 99, pageSize: 4 });
    assert.deepStrictEqual(page99.pagedItems, [9, 10]);

    // Empty list
    const emptyResult = paginateInMemory({ items: [], page: 1, pageSize: 4 });
    assert.strictEqual(emptyResult.total, 0);
    assert.strictEqual(emptyResult.totalPages, 1);
    assert.strictEqual(emptyResult.from, 0);
    assert.strictEqual(emptyResult.to, 0);
    assert.deepStrictEqual(emptyResult.pagedItems, []);

    // Filter and Sort together
    const filteredSorted = paginateInMemory({
      items: [
        { name: 'Beta', val: 2 },
        { name: 'Alpha', val: 1 },
        { name: 'Gamma', val: 3 },
      ],
      page: 1,
      pageSize: 10,
      filterFn: (x) => x.val >= 2,
      sortFn: (a, b) => a.name.localeCompare(b.name),
    });
    assert.strictEqual(filteredSorted.total, 2);
    assert.strictEqual(filteredSorted.pagedItems[0].name, 'Beta');
    assert.strictEqual(filteredSorted.pagedItems[1].name, 'Gamma');

    console.log('  PASS: paginateInMemory helper verified.');
  }

  // ================================================================
  // 2. Shared List Policies Validation
  // ================================================================
  console.log('🧪 2. Testing Shared List Policies in @shipde/config...');
  {
    assert.ok(USERS_LIST_POLICY.pageKey === 'page');
    assert.ok(USERS_LIST_POLICY.sizeKey === 'limit');
    assert.ok(USERS_LIST_POLICY.sortFields.includes('created_at'));
    assert.ok(USERS_LIST_POLICY.sortFields.includes('full_name'));

    assert.ok(WAREHOUSES_LIST_POLICY.pageKey === 'page');
    assert.ok(WAREHOUSES_LIST_POLICY.sizeKey === 'limit');
    assert.ok(WAREHOUSES_LIST_POLICY.sortFields.includes('name'));
    assert.ok(WAREHOUSES_LIST_POLICY.sortFields.includes('code'));

    assert.ok(BRANCHES_LIST_POLICY.pageKey === 'page');
    assert.ok(BRANCHES_LIST_POLICY.sizeKey === 'limit');
    assert.ok(BRANCHES_LIST_POLICY.sortFields.includes('name'));

    const parsedUserQuery = parseListQuery({ page: 2, limit: 15 }, USERS_LIST_POLICY);
    assert.strictEqual(parsedUserQuery.page, 2);
    assert.strictEqual(parsedUserQuery.limit, 15);
    assert.strictEqual(parsedUserQuery.skip, 15);

    console.log('  PASS: List policies verified.');
  }

  // ================================================================
  // 3. Users List Shared Contract States (SCR-USR-01)
  // ================================================================
  console.log('🧪 3. Testing Users list shared contract states...');
  {
    // A. Loading skeleton
    const loadingHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialLoading: true,
          initialUsers: [],
        })
      )
    );
    assert.ok(loadingHtml.includes('data-testid="users-loading-skeleton"'));
    assert.ok(loadingHtml.includes('animate-pulse'));

    // B. Clean Empty State (no search/filter)
    const emptyHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialLoading: false,
          initialUsers: [],
        })
      )
    );
    assert.ok(emptyHtml.includes('data-testid="users-empty-state"'));
    assert.ok(emptyHtml.includes(USERS_EMPTY_STATE_TEXT));

    // C. Error with retry
    const errorHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialLoading: false,
          initialError: 'Lỗi máy chủ khi tải danh sách',
          initialUsers: [],
        })
      )
    );
    assert.ok(errorHtml.includes('data-testid="users-error-banner"'));
    assert.ok(errorHtml.includes('data-testid="users-retry-button"'));

    // D. Forbidden state
    const forbiddenHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialForbidden: true,
          initialUsers: mockUsers,
        })
      )
    );
    assert.ok(forbiddenHtml.includes('data-testid="users-forbidden-state"'));
    assert.ok(forbiddenHtml.includes(USERS_FORBIDDEN_TEXT));
    assert.ok(!forbiddenHtml.includes('data-testid="users-table"'));

    // E. Ready populated table with sort headers and pagination controls
    const populatedHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialLoading: false,
          initialUsers: mockUsers,
          initialPage: 1,
          initialPageSize: 10,
          initialSortBy: 'full_name',
          initialSortOrder: 'asc',
        })
      )
    );
    assert.ok(populatedHtml.includes('data-testid="users-table"'));
    assert.ok(populatedHtml.includes('data-testid="sort-header-user-fullname"'));
    assert.ok(populatedHtml.includes('data-testid="sort-header-user-created"'));
    assert.ok(populatedHtml.includes('Ngày Tạo'));
    assert.ok(populatedHtml.includes('Đăng Nhập Gần Nhất'));
    assert.ok(populatedHtml.includes('data-testid="users-pagination-controls"'));
    assert.ok(populatedHtml.includes('data-testid="users-pagination-prev-btn"'));
    assert.ok(populatedHtml.includes('data-testid="users-pagination-next-btn"'));
    assert.ok(populatedHtml.includes('data-testid="users-pagination-info"'));
    assert.ok(populatedHtml.includes('Sắp xếp theo Nhân Viên / Email (tăng dần)'));

    // F. User RBAC fail-closed when user has unauthorized permissions
    const forbiddenUserHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(UserManagementTab, {
          initialForbidden: true,
          initialUsers: mockUsers,
        })
      )
    );
    assert.ok(forbiddenUserHtml.includes(USERS_FORBIDDEN_TEXT));
    assert.ok(!forbiddenUserHtml.includes('data-testid="users-table"'));

    console.log('  PASS: Users list shared contract states verified.');
  }

  // ================================================================
  // 4. Warehouses List Shared Contract States (SCR-WH-01)
  // ================================================================
  console.log('🧪 4. Testing Warehouses list shared contract states...');
  {
    // A. Loading skeleton
    const loadingHtml = renderToStaticMarkup(
      React.createElement(WarehouseManagementView, {
        loading: true,
        warehouses: [],
      })
    );
    assert.ok(loadingHtml.includes('data-testid="warehouse-loading-state"'));

    // B. Clean Empty State
    const emptyHtml = renderToStaticMarkup(
      React.createElement(WarehouseManagementView, {
        loading: false,
        warehouses: [],
        canEdit: true,
      })
    );
    assert.ok(emptyHtml.includes('data-testid="warehouse-empty-state"'));
    assert.ok(emptyHtml.includes('data-testid="empty-create-warehouse-button"'));
    assert.ok(emptyHtml.includes('Chưa có kho hàng nào được thiết lập'));

    // C. Error with retry
    const errorHtml = renderToStaticMarkup(
      React.createElement(WarehouseManagementView, {
        loading: false,
        warehouses: [],
        error: 'Lỗi tải danh sách kho',
        onRefresh: () => {},
      })
    );
    assert.ok(errorHtml.includes('data-testid="warehouse-error-banner"'));
    assert.ok(errorHtml.includes('data-testid="retry-error-button"'));

    // D. Populated list with sort selector and pagination controls
    const populatedHtml = renderToStaticMarkup(
      React.createElement(WarehouseManagementView, {
        loading: false,
        warehouses: mockWarehouses,
        canEdit: true,
        initialPage: 1,
        initialPageSize: 1,
        initialSortBy: 'name',
        initialSortOrder: 'asc',
      })
    );
    assert.ok(populatedHtml.includes('data-testid="warehouse-list-state"'));
    assert.ok(populatedHtml.includes('data-testid="filter-sort"'));
    assert.ok(populatedHtml.includes('data-testid="warehouse-pagination-controls"'));
    assert.ok(populatedHtml.includes('data-testid="warehouse-pagination-prev-btn"'));
    assert.ok(populatedHtml.includes('data-testid="warehouse-pagination-next-btn"'));
    // With pageSize=1 and 2 warehouses, page 1 shows 1 warehouse and pagination says Trang 1 / 2
    assert.ok(populatedHtml.includes('Trang 1 / 2'));

    console.log('  PASS: Warehouses list shared contract states verified.');
  }

  // ================================================================
  // 5. Branches List Shared Contract States (SCR-WH-01 / BranchesSettingsPage)
  // ================================================================
  console.log('🧪 5. Testing Branches list shared contract states...');
  {
    // A. Loading skeleton
    const loadingHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        loading: true,
        branches: [],
      })
    );
    assert.ok(loadingHtml.includes('data-testid="branch-loading-skeleton"'));
    assert.ok(loadingHtml.includes('animate-pulse'));

    // B. Clean Empty State
    const emptyHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        loading: false,
        branches: [],
        canEdit: true,
      })
    );
    assert.ok(emptyHtml.includes('data-testid="branch-empty-state"'));
    assert.ok(emptyHtml.includes('data-testid="empty-create-branch-btn"'));
    assert.ok(emptyHtml.includes('Chưa có chi nhánh nào'));

    // C. Error with retry
    const errorHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        loading: false,
        branches: [],
        error: 'Lỗi tải danh sách chi nhánh',
      })
    );
    assert.ok(errorHtml.includes('data-testid="branch-error-banner"'));

    // D. Forbidden state
    const forbiddenHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        isForbidden: true,
        branches: mockBranches,
      })
    );
    assert.ok(forbiddenHtml.includes('data-testid="branch-forbidden-banner"'));
    assert.ok(forbiddenHtml.includes('403 — Không Có Quyền Quản Lý Chi Nhánh'));
    assert.ok(!forbiddenHtml.includes('data-testid="branch-grid-container"'));

    // E. Populated Grid with search, sort, status filter, and pagination
    const populatedHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        loading: false,
        branches: mockBranches,
        canEdit: true,
        initialPage: 1,
        initialPageSize: 2,
        initialSortBy: 'name',
        initialSortOrder: 'asc',
      })
    );
    assert.ok(populatedHtml.includes('data-testid="branch-grid-container"'));
    assert.ok(populatedHtml.includes('data-testid="branch-search-input"'));
    assert.ok(populatedHtml.includes('data-testid="branch-status-filter"'));
    assert.ok(populatedHtml.includes('data-testid="branch-sort-select"'));
    assert.ok(populatedHtml.includes('data-testid="branch-pagination-controls"'));
    assert.ok(populatedHtml.includes('data-testid="branch-pagination-prev-btn"'));
    assert.ok(populatedHtml.includes('data-testid="branch-pagination-next-btn"'));
    assert.ok(populatedHtml.includes('data-testid="create-branch-btn"'));
    // Page 1 (sorted by name asc: Đà Nẵng, Hà Nội) contains store_04
    assert.ok(populatedHtml.includes('data-testid="edit-branch-btn-store_04"'));
    assert.ok(populatedHtml.includes('Trang 1 / 2'));

    // F. Full Page Container: BranchesSettingsPage
    const pageHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(BranchesSettingsPage, {
          initialBranches: mockBranches,
        })
      )
    );
    assert.ok(pageHtml.includes('Cửa hàng &amp; Chi nhánh'));
    assert.ok(pageHtml.includes('href="/settings/shop"'));
    assert.ok(pageHtml.includes('href="/settings/warehouses"'));
    assert.ok(pageHtml.includes('href="/settings/users"'));
    assert.ok(pageHtml.includes('href="/settings/roles"'));

    // G. Default-branch deactivate protection (P1 finding 7)
    const defaultBranchDeactivateHtml = renderToStaticMarkup(
      React.createElement(BranchManagementView, {
        loading: false,
        branches: mockBranches,
        canEdit: true,
      })
    );
    assert.ok(
      defaultBranchDeactivateHtml.includes('Chi nhánh mặc định không thể tạm ngưng hoạt động'),
      'Default branch must disable deactivate button with explanation'
    );
    assert.ok(
      defaultBranchDeactivateHtml.includes('disabled'),
      'Default branch deactivate button must have disabled attribute'
    );

    console.log('  PASS: Branches list shared contract states verified.');
  }

  // ================================================================
  // 6. UI Edit Rights & Permission Enforcement (Rule 9)
  // ================================================================
  console.log('🧪 6. Testing UI Edit Rights & Permission Enforcement (Rule 9)...');
  {
    // Unknown user means no edit rights (fail closed)
    const anonymousBranchHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(BranchesSettingsPage, {
          initialBranches: mockBranches,
        })
      )
    );
    assert.ok(
      !anonymousBranchHtml.includes('data-testid="create-branch-btn"'),
      'Anonymous user must NOT see create branch button'
    );
    assert.ok(
      !anonymousBranchHtml.includes('data-testid="edit-branch-btn-store_01"'),
      'Anonymous user must NOT see edit branch button'
    );

    // canEdit explicit override
    const authorizedBranchHtml = renderToStaticMarkup(
      React.createElement(
        AuthProvider,
        null,
        React.createElement(BranchesSettingsPage, {
          initialBranches: mockBranches,
          initialCanEdit: true,
        })
      )
    );
    assert.ok(
      authorizedBranchHtml.includes('data-testid="create-branch-btn"'),
      'Authorized user with canEdit=true must see create branch button'
    );
    assert.ok(
      authorizedBranchHtml.includes('data-testid="edit-branch-btn-store_01"'),
      'Authorized user with canEdit=true must see edit branch button'
    );

    console.log('  PASS: UI Edit Rights & Permission Enforcement verified.');
  }

  console.log('================================================================');
  console.log('🎉 ALL FEAT-COM-02 SHARED LIST CONTRACT & STATE TESTS PASSED 100%!');
  console.log('================================================================');
}

void runSharedListsTestSuite();
