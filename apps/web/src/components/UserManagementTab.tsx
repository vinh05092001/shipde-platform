'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  UserCheck,
  UserPlus,
  Smartphone,
  Trash2,
  Key,
  CheckCircle2,
  ShieldAlert,
  Shield,
  Store,
  Lock,
  Eye,
  Sliders,
  Check,
  RotateCcw,
  Building2,
  MapPin,
  Plus,
  Edit,
  ChevronRight,
  Filter,
  Layers,
  Mail,
  Phone,
  AlertCircle,
  RefreshCw,
  Loader2,
  Clock,
  Warehouse,
  Search,
  FilterX,
} from 'lucide-react';
import { RoleItem, UserListItem } from '@shipde/contracts';
import { useAuth } from '@/context/AuthContext';
import { InviteUserModal } from './forms/InviteUserModal';
import { PaginationControls, SortableColumnHeader } from './common/SharedListControls';
import { BranchManagementView } from './BranchManagementView';
import { useSharedListState } from '@/hooks/useSharedListState';

// Available Stores in the system
export const INVITE_SUCCESS_TOAST = 'Đã gửi lời mời thành công';
export const INVITATIONS_EMPTY_STATE_TEXT = 'Chưa có lời mời nào đang chờ xử lý';
export const INVITATIONS_FORBIDDEN_TEXT = '403 — Không Có Quyền Truy Cập';
export const INVITATIONS_RETRY_LABEL = 'Thử lại';

export const USERS_EMPTY_STATE_TEXT = 'Chưa có nhân viên nào trong cửa hàng';
export const USERS_FORBIDDEN_TEXT = '403 — Không Có Quyền Truy Cập';
export const USERS_RETRY_LABEL = 'Thử lại';
export const USERS_SCOPE_SUCCESS_TOAST = 'Đã cập nhật phạm vi quyền hạn thành công';
export const USER_SUSPEND_SUCCESS_TOAST = 'Đã tạm dừng người dùng thành công';
export const USER_ACTIVATE_SUCCESS_TOAST = 'Đã kích hoạt lại người dùng thành công';
export const USER_DEACTIVATE_SUCCESS_TOAST = 'Đã vô hiệu hóa tài khoản người dùng thành công';
export const USER_UPDATE_SUCCESS_TOAST =
  'Đã cập nhật thông tin và phân quyền người dùng thành công';

export const AVAILABLE_WAREHOUSES = [
  { id: 'wh_tanbinh', name: 'Kho Vận Tân Bình (HCM)' },
  { id: 'wh_hanoi', name: 'Kho Hà Nội' },
  { id: 'wh_danang', name: 'Kho Đà Nẵng' },
];

export function isManageUsersForbidden(userRole?: string | null): boolean {
  if (!userRole) return true;
  return userRole !== 'OWNER' && userRole !== 'OPS_CSKH';
}

export type UsersUIState = 'forbidden' | 'error' | 'loading' | 'empty' | 'ready';

export function resolveUsersUIState(params: {
  isForbidden: boolean;
  error: string | null;
  loading: boolean;
  itemCount: number;
}): UsersUIState {
  if (params.isForbidden) return 'forbidden';
  if (params.error) return 'error';
  if (params.loading) return 'loading';
  if (params.itemCount === 0) return 'empty';
  return 'ready';
}

export function shouldDisplayUsersEmptyState(params: {
  error: string | null;
  loading: boolean;
  itemCount: number;
}): boolean {
  return !params.error && !params.loading && params.itemCount === 0;
}

export type InvitationsUIState = 'forbidden' | 'error' | 'loading' | 'empty' | 'ready';

export function resolveInvitationsUIState(params: {
  isForbidden: boolean;
  error: string | null;
  loading: boolean;
  itemCount: number;
}): InvitationsUIState {
  if (params.isForbidden) return 'forbidden';
  if (params.error) return 'error';
  if (params.loading) return 'loading';
  if (params.itemCount === 0) return 'empty';
  return 'ready';
}

/**
 * Empty state contract helper (Round 11 Finding 3 / SCR-USR-01):
 * Never show empty copy during an outage or error; empty state is only shown
 * when the request succeeded with zero rows.
 */
export function shouldDisplayInvitationsEmptyState(params: {
  error: string | null;
  loading: boolean;
  itemCount: number;
}): boolean {
  return !params.error && !params.loading && params.itemCount === 0;
}

export interface StoreItem {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  active_orders_count: number;
  status: 'ACTIVE' | 'INACTIVE';
}

// User with Store Scoping & Custom Overrides
export function formatStoreScopeLabel(storeScopes?: string[] | null): string {
  if (storeScopes && storeScopes.length > 0) {
    return storeScopes.join(', ');
  }
  return 'không gán phạm vi';
}

export function isInvitationResendable(status: string, consumedAt?: string | null): boolean {
  if (consumedAt) return false;
  const s = status.toUpperCase();
  return s === 'PENDING' || s === 'EXPIRED';
}

export interface UserWithStores {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  role: string;
  custom_role_id?: string | null;
  custom_role?: { id: string; name: string } | null;
  assigned_stores: string[]; // ['*'] for all, or store IDs ['store_01', 'store_02']
  store_scopes?: string[];
  warehouse_scopes?: string[];
  carrier_account_scopes?: string[];
  custom_permissions?: { [key: string]: boolean };
  status: string;
  last_login?: string;
  last_active_at?: string | null;
  created_at: string;
}

/**
 * Maps canonical API error response (fields/details) onto field-error-* dictionary.
 * Supports canonical error.fields from validateScopeArray/validateCarrierAccountScopes,
 * as well as legacy/fallback details/fields formats.
 */
export function mapCanonicalFieldErrors(
  errorData: any,
  fallbackMessage = 'Đã có lỗi xảy ra'
): Record<string, string> {
  const fields =
    errorData?.error?.fields ||
    errorData?.fields ||
    errorData?.error?.details ||
    errorData?.details;

  if (!Array.isArray(fields)) return {};

  const map: Record<string, string> = {};
  for (const d of fields) {
    if (d && d.field) {
      const baseField = d.field.replace(/\[\d+\]$/, '');
      const msg = d.message || errorData?.error?.message || errorData?.message || fallbackMessage;
      map[baseField] = msg;
      map[d.field] = msg;
      if (baseField === 'carrier_account_scopes') {
        map['carrier_scopes'] = msg;
      } else if (baseField === 'carrier_scopes') {
        map['carrier_account_scopes'] = msg;
      }
    }
  }
  return map;
}

export interface UserManagementTabProps {
  initialUsers?: (UserListItem | UserWithStores)[];
  initialLoading?: boolean;
  initialError?: string | null;
  initialForbidden?: boolean;
  initialEditingUser?: (UserListItem | UserWithStores) | null;
  initialToastMessage?: string | null;
  initialScopeError?: string | null;
  initialScopeLoading?: boolean;
  initialScopeErrorBody?: any;
  initialFieldErrors?: Record<string, string>;
  initialActiveSubTab?: 'matrix' | 'stores' | 'members' | 'devices' | 'invitations';
  initialSubTab?: 'matrix' | 'stores' | 'members' | 'devices' | 'invitations';
  initialStores?: StoreItem[];
  initialCanEditBranches?: boolean;
  initialPage?: number;
  initialPageSize?: number;
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
}

export const UserManagementTab: React.FC<UserManagementTabProps> = (props = {}) => {
  const { token, user, isHydrating } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<
    'matrix' | 'stores' | 'members' | 'devices' | 'invitations'
  >(props.initialActiveSubTab ?? props.initialSubTab ?? 'members');
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(
    props.initialToastMessage ?? null
  );

  // Invitations state (FEAT-USR-01)
  const [invitations, setInvitations] = useState<any[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [invitationsStatusFilter, setInvitationsStatusFilter] = useState<string>('ALL');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Permission-based authorization check (Rule 9: permissions from API, unknown user means no edit, fail closed)
  const isAuthLoading = isHydrating;
  const isComponentLoading = Boolean(props.initialLoading);

  const isForbidden =
    props.initialForbidden !== undefined
      ? props.initialForbidden
      : isAuthLoading || isComponentLoading
        ? false
        : !user
          ? true
          : Array.isArray((user as any).permissions)
            ? !(user as any).permissions.includes('iam:manage_users')
            : true;

  const canEditBranches =
    props.initialCanEditBranches !== undefined
      ? props.initialCanEditBranches
      : Boolean(
          user &&
          Array.isArray((user as any).permissions) &&
          (user as any).permissions.includes('iam:shop_config')
        );

  const fetchInvitations = useCallback(async () => {
    if (isForbidden) return;
    setInvitationsLoading(true);
    setInvitationsError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const url = new URL(`${apiBase}/api/v1/invitations`);
      if (invitationsStatusFilter !== 'ALL') {
        url.searchParams.set('status', invitationsStatusFilter);
      }
      const res = await fetch(url.toString(), {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể tải danh sách lời mời');
      }
      setInvitations(data.data || []);
    } catch (err: any) {
      setInvitationsError(err.message || 'Lỗi kết nối khi tải lời mời');
    } finally {
      setInvitationsLoading(false);
    }
  }, [token, invitationsStatusFilter, isForbidden]);

  useEffect(() => {
    if (activeSubTab === 'invitations') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Client-side invitations list initial fetch
      void fetchInvitations();
    }
  }, [activeSubTab, fetchInvitations]);

  const handleResendInvite = async (inviteId: string) => {
    setActionLoadingId(inviteId);
    setInvitationsError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/invitations/${inviteId}/resend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể gửi lại lời mời');
      }
      setToastMessage('Đã cấp lại lời mời thành công và gia hạn 7 ngày');
      void fetchInvitations();
    } catch (err: any) {
      setInvitationsError(err.message || 'Thao tác gửi lại lời mời thất bại. Vui lòng thử lại.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!confirm('Bạn có chắc chắn muốn hủy lời mời này?')) return;
    setActionLoadingId(inviteId);
    setInvitationsError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/invitations/${inviteId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể hủy lời mời');
      }
      setToastMessage('Đã hủy lời mời thành công');
      void fetchInvitations();
    } catch (err: any) {
      setInvitationsError(err.message || 'Thao tác hủy lời mời thất bại. Vui lòng thử lại.');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Users list and filter state (FEAT-USR-02)
  const [users, setUsers] = useState<UserListItem[]>(() => {
    if (!props.initialUsers) return [];
    return (props.initialUsers as any[]).map((u) => ({
      ...u,
      store_scopes: u.store_scopes || u.assigned_stores || [],
      warehouse_scopes: u.warehouse_scopes || [],
      carrier_account_scopes: u.carrier_account_scopes || [],
    })) as UserListItem[];
  });
  const [usersLoading, setUsersLoading] = useState<boolean>(
    props.initialLoading ?? !props.initialUsers
  );
  const [usersError, setUsersError] = useState<string | null>(props.initialError || null);
  // User list shared pagination, filter, and sort state via shared hook (FEAT-COM-02)
  const userListState = useSharedListState({
    defaultPage: props.initialPage || 1,
    defaultPageSize: props.initialPageSize || 20,
    defaultSortBy: props.initialSortBy || 'created_at',
    defaultSortOrder: props.initialSortOrder || 'desc',
    defaultSearch: '',
    defaultFilters: {
      role: 'ALL',
      status: 'ALL',
    },
    syncUrl: true,
    namespace: 'user',
    listKey: 'users',
    initialColumns: [
      'full_name',
      'role',
      'store_scopes',
      'warehouse_scopes',
      'carrier_scopes',
      'created_at',
      'last_active_at',
      'status',
    ],
  });

  const userPage = userListState.page;
  const userPageSize = userListState.pageSize;
  const userSortBy = userListState.sortBy;
  const userSortOrder = userListState.sortOrder;
  const userSearch = userListState.search;
  const userRoleFilter = userListState.filters.role;
  const userStatusFilter = userListState.filters.status;
  const setUserPage = userListState.setPage;
  const setUserPageSize = userListState.setPageSize;
  const setUserSort = userListState.setSort;
  const setUserSearch = userListState.setSearch;
  const setUserRoleFilter = (role: string) => userListState.setFilter('role', role);
  const setUserStatusFilter = (status: string) => userListState.setFilter('status', status);

  const [totalUsers, setTotalUsers] = useState<number>(props.initialUsers?.length || 0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [stores, setStores] = useState<StoreItem[]>(props.initialStores || []);
  const [storesLoading, setStoresLoading] = useState<boolean>(false);
  const [storesError, setStoresError] = useState<string | null>(null);

  const fetchStores = useCallback(async () => {
    setStoresLoading(true);
    setStoresError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/branches`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        setStores([]);
        if (res.status === 403) {
          setStoresError('Bạn không có quyền xem danh sách chi nhánh (403)');
        } else if (res.status === 401) {
          setStoresError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại (401)');
        } else {
          const errData = await res.json().catch(() => null);
          setStoresError(
            errData?.error?.message || `Lỗi máy chủ khi tải danh sách chi nhánh (${res.status})`
          );
        }
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json || !json.success || !Array.isArray(json.data?.branches)) {
        setStores([]);
        setStoresError('Dữ liệu danh sách chi nhánh từ máy chủ không hợp lệ');
        return;
      }
      setStores(json.data.branches);
    } catch (err: any) {
      setStores([]);
      setStoresError(err?.message || 'Lỗi kết nối khi tải danh sách chi nhánh');
    } finally {
      setStoresLoading(false);
    }
  }, [token]);

  const handleCreateBranch = useCallback(
    async (input: any) => {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/branches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tạo mới chi nhánh');
      }
      await fetchStores();
    },
    [token, fetchStores]
  );

  const handleUpdateBranch = useCallback(
    async (id: string, input: any) => {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/branches/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể cập nhật chi nhánh');
      }
      await fetchStores();
    },
    [token, fetchStores]
  );

  const handleActivateBranch = useCallback(
    async (id: string) => {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/branches/${id}/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể kích hoạt chi nhánh');
      }
      await fetchStores();
    },
    [token, fetchStores]
  );

  const handleDeactivateBranch = useCallback(
    async (id: string) => {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/branches/${id}/deactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tạm ngưng chi nhánh');
      }
      await fetchStores();
    },
    [token, fetchStores]
  );

  useEffect(() => {
    if (activeSubTab === 'stores' && (!props.initialStores || props.initialStores.length === 0)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial stores fetch
      void fetchStores();
    }
  }, [activeSubTab, fetchStores, props.initialStores]);

  // Modal new store state
  const [isNewStoreModalOpen, setIsNewStoreModalOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [newStoreCode, setNewStoreCode] = useState('');
  const [newStoreAddress, setNewStoreAddress] = useState('');
  const [newStorePhone, setNewStorePhone] = useState('0908889999');

  // Modal edit user state
  const [editingUser, setEditingUser] = useState<any | null>(props.initialEditingUser ?? null);
  const [editFullName, setEditFullName] = useState<string>(
    props.initialEditingUser?.full_name || ''
  );
  const [editRole, setEditRole] = useState<string>(props.initialEditingUser?.role || 'OPS_CSKH');
  const [editStoreScopes, setEditStoreScopes] = useState<string[]>(
    (props.initialEditingUser as any)?.store_scopes ||
      (props.initialEditingUser as any)?.assigned_stores ||
      []
  );
  const [editWarehouseScopes, setEditWarehouseScopes] = useState<string[]>(
    props.initialEditingUser?.warehouse_scopes || []
  );
  const [editCarrierScopes, setEditCarrierScopes] = useState<string[]>(
    (props.initialEditingUser as any)?.carrier_account_scopes || []
  );
  const [editError, setEditError] = useState<string | null>(null);
  const [scopeSaveError, setScopeSaveError] = useState<string | null>(
    props.initialScopeError ??
      props.initialScopeErrorBody?.error?.message ??
      props.initialScopeErrorBody?.message ??
      null
  );
  const [scopeSaveLoading, setScopeSaveLoading] = useState<boolean>(
    props.initialScopeLoading ?? false
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>(() => {
    if (props.initialFieldErrors) return props.initialFieldErrors;
    if (props.initialScopeErrorBody) {
      return mapCanonicalFieldErrors(props.initialScopeErrorBody);
    }
    return {};
  });

  // Modal suspend user state
  const [suspendingUser, setSuspendingUser] = useState<UserListItem | null>(null);
  const [suspensionReason, setSuspensionReason] = useState<string>('');
  const [suspensionError, setSuspensionError] = useState<string | null>(null);

  // Modal activate user state
  const [activatingUser, setActivatingUser] = useState<UserListItem | null>(null);

  // Modal deactivate user state
  const [deactivatingUser, setDeactivatingUser] = useState<UserListItem | null>(null);
  const [deactivationReason, setDeactivationReason] = useState<string>('');

  const [mutationLoading, setMutationLoading] = useState<boolean>(false);

  const fetchUsers = useCallback(async () => {
    if (isForbidden) {
      setUsersLoading(false);
      return;
    }
    setUsersLoading(true);
    setUsersError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const url = new URL(`${apiBase}/api/v1/users`);
      url.searchParams.set('page', String(userPage));
      url.searchParams.set('limit', String(userPageSize));
      url.searchParams.set('sort_by', userSortBy);
      url.searchParams.set('sort_order', userSortOrder);
      if (userRoleFilter && userRoleFilter !== 'ALL') {
        url.searchParams.set('role', userRoleFilter);
      }
      if (userStatusFilter && userStatusFilter !== 'ALL') {
        url.searchParams.set('status', userStatusFilter);
      }
      if (userSearch && userSearch.trim().length > 0) {
        url.searchParams.set('search', userSearch.trim());
      }
      const res = await fetch(url.toString(), {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể tải danh sách người dùng');
      }
      const returnedTotal = data.meta?.total ?? (data.data || []).length;
      const returnedTotalPages =
        data.meta?.total_pages ?? Math.max(1, Math.ceil(returnedTotal / userPageSize));
      setUsers(data.data || []);
      setTotalUsers(returnedTotal);
      setTotalPages(returnedTotalPages);
      if (returnedTotal > 0 && userPage > returnedTotalPages) {
        setUserPage(returnedTotalPages);
      }
    } catch (err: any) {
      setUsersError(err.message || 'Lỗi kết nối khi tải danh sách người dùng');
    } finally {
      setUsersLoading(false);
    }
  }, [
    token,
    isForbidden,
    userRoleFilter,
    userStatusFilter,
    userSearch,
    userPage,
    userPageSize,
    userSortBy,
    userSortOrder,
    setUserPage,
  ]);

  useEffect(() => {
    if (activeSubTab === 'members' && !props.initialUsers) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Client-side users list initial fetch
      void fetchUsers();
    }
  }, [activeSubTab, fetchUsers, props.initialUsers]);

  const handleOpenEdit = (u: any) => {
    setEditingUser(u);
    setEditFullName(u.full_name || '');
    setEditRole(u.role || '');
    setEditStoreScopes(u.store_scopes || u.assigned_stores || []);
    setEditWarehouseScopes(u.warehouse_scopes || []);
    setEditCarrierScopes(u.carrier_account_scopes || []);
    setEditError(null);
    setScopeSaveError(null);
    setFieldErrors({});
  };

  const handleSaveUserPermissions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    if (!editFullName || editFullName.trim().length === 0) {
      setEditError('Họ và tên không được để trống');
      setFieldErrors({ full_name: 'Họ và tên không được để trống' });
      return;
    }

    setMutationLoading(true);
    setScopeSaveLoading(true);
    setEditError(null);
    setScopeSaveError(null);
    setFieldErrors({});

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      // 1. Save scopes to dedicated scopes endpoint (PATCH /api/v1/users/:id/scopes) (AC-RBAC-02-20)
      const scopesRes = await fetch(`${apiBase}/api/v1/users/${editingUser.id}/scopes`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          store_scopes: editStoreScopes,
          warehouse_scopes: editWarehouseScopes,
          carrier_account_scopes: editCarrierScopes,
        }),
      });

      if (!scopesRes.ok) {
        const errorData = await scopesRes.json().catch(() => ({}));
        const msg =
          errorData.error?.message || errorData.message || 'Không thể cập nhật phạm vi quyền hạn';
        setScopeSaveError(msg);

        // Map field validation errors from canonical error body's fields array (AC-RBAC-02-20)
        const map = mapCanonicalFieldErrors(errorData, msg);
        if (Object.keys(map).length > 0) {
          setFieldErrors(map);
        }
        return;
      }

      // 2. Save user profile & role to PATCH /api/v1/users/:id
      const userRes = await fetch(`${apiBase}/api/v1/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          full_name: editFullName.trim(),
          role: editRole,
          store_scopes: editStoreScopes,
          warehouse_scopes: editWarehouseScopes,
          carrier_account_scopes: editCarrierScopes,
        }),
      });

      if (!userRes.ok) {
        const errorData = await userRes.json().catch(() => ({}));
        const msg =
          errorData.error?.message ||
          errorData.message ||
          'Không thể cập nhật thông tin người dùng';
        setEditError(msg);
        const map = mapCanonicalFieldErrors(errorData, msg);
        if (Object.keys(map).length > 0) {
          setFieldErrors(map);
        }
        return;
      }

      // Success toast only after 200 OK
      setToastMessage(USERS_SCOPE_SUCCESS_TOAST);
      setEditingUser(null);
      void fetchUsers();
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setScopeSaveError(err.message || 'Lỗi khi cập nhật phạm vi quyền hạn');
      setEditError(err.message || 'Lỗi khi cập nhật người dùng');
    } finally {
      setMutationLoading(false);
      setScopeSaveLoading(false);
    }
  };

  const handleOpenSuspend = (u: UserListItem) => {
    setSuspendingUser(u);
    setSuspensionReason('');
    setSuspensionError(null);
  };

  const handleConfirmSuspend = async () => {
    if (!suspendingUser) return;
    if (!suspensionReason || suspensionReason.trim().length === 0) {
      setSuspensionError('Lý do tạm dừng không được để trống');
      return;
    }

    setMutationLoading(true);
    setSuspensionError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/users/${suspendingUser.id}/suspend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reason: suspensionReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể tạm dừng người dùng');
      }
      setToastMessage(USER_SUSPEND_SUCCESS_TOAST);
      setSuspendingUser(null);
      void fetchUsers();
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setSuspensionError(err.message || 'Lỗi khi tạm dừng người dùng');
    } finally {
      setMutationLoading(false);
    }
  };

  const handleOpenActivate = (u: UserListItem) => {
    setActivatingUser(u);
  };

  const handleConfirmActivate = async () => {
    if (!activatingUser) return;
    setMutationLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/users/${activatingUser.id}/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể kích hoạt lại người dùng');
      }
      setToastMessage(USER_ACTIVATE_SUCCESS_TOAST);
      setActivatingUser(null);
      void fetchUsers();
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setToastMessage(err.message || 'Lỗi khi kích hoạt lại người dùng');
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setMutationLoading(false);
    }
  };

  const handleOpenDeactivate = (u: UserListItem) => {
    setDeactivatingUser(u);
    setDeactivationReason('');
  };

  const handleConfirmDeactivate = async () => {
    if (!deactivatingUser) return;
    setMutationLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiBase}/api/v1/users/${deactivatingUser.id}/deactivate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reason: deactivationReason.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || 'Không thể vô hiệu hóa tài khoản');
      }
      setToastMessage(USER_DEACTIVATE_SUCCESS_TOAST);
      setDeactivatingUser(null);
      void fetchUsers();
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err: any) {
      setToastMessage(err.message || 'Lỗi khi vô hiệu hóa tài khoản');
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setMutationLoading(false);
    }
  };

  // Modal new store state

  // Live dynamic RBAC Roles state from GET /api/v1/roles (Finding 10 / SCR-USR-01)
  const [liveRoles, setLiveRoles] = useState<RoleItem[]>([]);
  const [matrixLoading, setMatrixLoading] = useState<boolean>(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  // RBAC Granular Matrix State with Canonical Permission Codes (Finding 4 / Round 7 / BR-RBAC-06 / SCR-USR-01)
  const [permissionsMatrix] = useState([
    {
      id: 'p_pii',
      code: 'pii:unmask',
      name: 'Mở che thông tin khách hàng (PII)',
      feature: 'Mở che thông tin khách hàng (PII)',
      rule: 'BR-42 · Ghi nhật ký Audit Trail bất biến khi xem SĐT/địa chỉ',
    },
    {
      id: 'p_reattempt',
      code: 'shipment:cancel_redeliver',
      name: 'Hủy đơn và yêu cầu giao lại',
      feature: 'Hủy đơn và yêu cầu giao lại (Cứu đơn)',
      rule: 'CN-10 · L2 Execute / L1 Assist cứu đơn & giao lại',
    },
    {
      id: 'p_discrepancy',
      code: 'reconciliation:approve_rate_policy',
      name: 'Phê duyệt chính sách đối soát',
      feature: 'Phê duyệt chính sách đối soát',
      rule: 'BR-12 · Tách quyền SoD Maker-Checker (Checker phê duyệt chính sách)',
    },
    {
      id: 'p_close_period',
      code: 'reconciliation:run_review_audit',
      name: 'Chạy và đối chiếu kiểm toán',
      feature: 'Chạy và đối chiếu kiểm toán',
      rule: 'BR-11 / D1-D7 · Kích hoạt khớp 6 quy tắc và rà soát sai lệch cước/COD',
    },
    {
      id: 'p_return_scan',
      code: 'shipment:receive_return',
      name: 'Nhận hàng hoàn và quét bằng chứng',
      feature: 'Nhận hàng hoàn và quét bằng chứng',
      rule: 'BR-40 / BR-36 · Quét hoàn ngoại tuyến SQLite & đối soát kiện trả',
    },
    {
      id: 'p_api_config',
      code: 'iam:shop_config',
      name: 'Cấu hình cửa hàng',
      feature: 'Cấu hình cửa hàng',
      rule: 'BR-51 · Quyền quản trị kết nối Shop và biểu phí',
    },
    {
      id: 'p_export_ledgers',
      code: 'reconciliation:allocate_bank_receipt',
      name: 'Phân bổ dòng tiền thực nhận',
      feature: 'Phân bổ dòng tiền thực nhận',
      rule: 'BR-45 · Khớp số tiền ngân hàng thực nhận vào kỳ đối soát',
    },
  ]);

  // Fetch live roles from GET /api/v1/roles (Finding 10)
  const fetchLiveRoles = useCallback(async () => {
    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('shipde_token') : null;
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${API_BASE}/api/v1/roles`, { headers });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error?.message || 'Không thể tải danh sách vai trò từ máy chủ');
      }
      const json = await res.json();
      if (json?.data?.roles) {
        setLiveRoles(json.data.roles);
      }
    } catch (err: any) {
      setMatrixError(err.message || 'Lỗi kết nối khi đồng bộ vai trò từ máy chủ');
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSubTab === 'matrix') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial live roles fetch
      void fetchLiveRoles();
    }
  }, [activeSubTab, fetchLiveRoles]);

  // Active Device Sessions
  const [deviceSessions, setDeviceSessions] = useState([
    {
      id: 'dev_01',
      user_name: 'Nguyễn Văn An (Chủ Shop)',
      device_name: 'MacBook Pro 16" (macOS 15.1 · Chrome 128)',
      store_scope: 'Toàn hệ thống (4 Chi nhánh)',
      ip_address: '118.69.182.10',
      location: 'Quận 1, TP. Hồ Chí Minh',
      last_active: 'Đang hoạt động',
      is_current: true,
    },
    {
      id: 'dev_02',
      user_name: 'Trần Thị Hoa (CSKH)',
      device_name: 'Windows 11 PC (Edge 127)',
      store_scope: 'Chi Nhánh Quận 3 & Đà Nẵng',
      ip_address: '14.232.208.45',
      location: 'Quận 3, TP. Hồ Chí Minh',
      last_active: '12 phút trước',
      is_current: false,
    },
    {
      id: 'dev_03',
      user_name: 'Phạm Văn Kho (Thủ Kho)',
      device_name: 'PDA Máy Quét Honeywell EDA51 (Android 11)',
      store_scope: 'Kho Vận Tân Bình',
      ip_address: '115.78.14.92',
      location: 'Tân Bình, TP. Hồ Chí Minh',
      last_active: '35 phút trước (Offline Sync)',
      is_current: false,
    },
  ]);

  const handleRevokeDevice = (deviceId: string, userName: string) => {
    setDeviceSessions((prev) => prev.filter((d) => d.id !== deviceId));
    setToastMessage(
      `[BR-08]: Đã thu hồi quyền truy cập của thiết bị [${userName}]. Mọi lệnh quét offline từ máy này sẽ bị từ chối với mã 401 device_revoked.`
    );
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleCreateStore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStoreName || !newStoreCode) return;

    const newStore: StoreItem = {
      id: `store_${Date.now().toString().slice(-4)}`,
      code: newStoreCode.toUpperCase(),
      name: newStoreName,
      address: newStoreAddress,
      phone: newStorePhone,
      manager: 'Nguyễn Văn An',
      active_orders_count: 0,
      status: 'ACTIVE',
    };

    setStores((prev) => [...prev, newStore]);
    setIsNewStoreModalOpen(false);
    setNewStoreName('');
    setNewStoreCode('');
    setNewStoreAddress('');
    setToastMessage(`Đã thêm chi nhánh mới [${newStore.name}].`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  return (
    <div className="w-full space-y-5">
      {/* Toast Feedback */}
      {toastMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-semibold flex items-center justify-between shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="font-bold text-slate-500 hover:text-slate-800"
          >
            ✕
          </button>
        </div>
      )}

      {/* Header Bar */}
      <div className="modern-card p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Trung Tâm Phân Quyền & Quản Trị Cửa Hàng (Multi-Store RBAC)
            </h2>
            <span className="badge-ok text-xs">Chuẩn Tách Quyền BR-12</span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Phân quyền chi tiết theo từng người dùng, giới hạn phạm vi truy cập theo chi nhánh/kho,
            và thu hồi thiết bị từ xa (BR-08)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsNewStoreModalOpen(true)}
            className="btn-secondary text-xs"
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>+ Thêm Chi Nhánh</span>
          </button>
          <button
            type="button"
            onClick={() => setIsInviteOpen(true)}
            disabled={Boolean(isForbidden)}
            className={`btn-primary text-xs ${isForbidden ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={isForbidden ? 'Bạn không có quyền mời thành viên mới' : ''}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>+ Mời Thành Viên Mới</span>
          </button>
        </div>
      </div>

      {/* 5-SubTab Navigation */}
      <div className="flex border-b border-slate-200 space-x-2 text-xs font-bold overflow-x-auto">
        {[
          {
            id: 'members',
            label: '1. Phân Quyền Nhân Viên & Cửa Hàng',
            icon: UserCheck,
            count: users.length,
          },
          {
            id: 'invitations',
            label: '2. Lời Mời Đội Ngũ (FEAT-USR-01)',
            icon: Mail,
            count: invitations.length,
          },
          {
            id: 'stores',
            label: '3. Quản Lý Cửa Hàng / Chi Nhánh',
            icon: Store,
            count: stores.length,
          },
          { id: 'matrix', label: '4. Ma Trận Quyền Nghiệp Vụ (RBAC)', icon: Sliders },
          {
            id: 'devices',
            label: '5. Phiên Thiết Bị & Thu Hồi Từ Xa (BR-08)',
            icon: Smartphone,
            count: deviceSessions.length,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`px-4 py-2.5 border-b-2 flex items-center gap-2 transition cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-lg'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SUBTAB 1: MEMBERS & STORE SCOPING */}
      {activeSubTab === 'members' && (
        <div className="space-y-4">
          {/* Search, Filter and Actions Toolbar */}
          <div className="modern-card p-4 bg-slate-50/60 space-y-3">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex flex-wrap items-center gap-2 flex-1">
                <div className="relative min-w-[220px] flex-1 max-w-sm">
                  <input
                    type="text"
                    placeholder="Tìm kiếm theo tên, email, sđt..."
                    value={userSearch}
                    onChange={(e) => {
                      setUserSearch(e.target.value);
                      setUserPage(1);
                    }}
                    className="modern-input w-full pl-8 pr-3 py-1.5 text-xs"
                    data-testid="user-search-input"
                  />
                  <Filter className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
                </div>

                <select
                  value={userRoleFilter}
                  onChange={(e) => {
                    setUserRoleFilter(e.target.value);
                    setUserPage(1);
                  }}
                  className="modern-input text-xs py-1.5 font-medium"
                  data-testid="user-role-filter"
                  aria-label="Lọc theo vai trò"
                >
                  <option value="ALL">Tất cả vai trò</option>
                  <option value="OWNER">👑 Chủ Shop (Owner)</option>
                  <option value="STORE_MANAGER">🏢 Quản lý cửa hàng</option>
                  <option value="OPS_CSKH">🎧 CSKH / Vận hành</option>
                  <option value="ACCOUNTANT">💼 Kế toán</option>
                  <option value="WAREHOUSE">📦 Thủ kho</option>
                </select>

                <select
                  value={userStatusFilter}
                  onChange={(e) => {
                    setUserStatusFilter(e.target.value);
                    setUserPage(1);
                  }}
                  className="modern-input text-xs py-1.5 font-medium"
                  data-testid="user-status-filter"
                  aria-label="Lọc theo trạng thái nhân sự"
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="ACTIVE">Hoạt động (ACTIVE)</option>
                  <option value="SUSPENDED">Tạm ngưng (SUSPENDED)</option>
                  <option value="DISABLED">Vô hiệu hóa (DISABLED)</option>
                </select>

                {(userSearch.trim() || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserSearch('');
                      setUserRoleFilter('ALL');
                      setUserStatusFilter('ALL');
                      setUserPage(1);
                    }}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 cursor-pointer"
                    data-testid="users-clear-filters-btn"
                  >
                    <FilterX className="w-3.5 h-3.5" />
                    <span>Xóa lọc</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => void fetchUsers()}
                  disabled={usersLoading}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer"
                  data-testid="user-refresh-btn"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${usersLoading ? 'animate-spin' : ''}`} />
                  <span>Làm mới</span>
                </button>
              </div>

              <div className="text-xs text-slate-600 font-medium">
                Tổng số{' '}
                <strong data-testid="user-count">
                  {totalUsers > 0 ? totalUsers : users.length}
                </strong>{' '}
                nhân sự trong hệ thống
              </div>
            </div>
          </div>

          {/* Forbidden State */}
          {isForbidden ? (
            <div
              className="p-8 text-center bg-amber-50/60 border border-amber-200 rounded-2xl space-y-2 animate-in fade-in"
              data-testid="users-forbidden-callout"
            >
              <div data-testid="users-forbidden-state">
                <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto" />
                <h4 className="font-bold text-sm text-slate-800">{USERS_FORBIDDEN_TEXT}</h4>
                <p className="text-xs text-slate-600 max-w-md mx-auto">
                  Tài khoản của bạn ({user?.role || 'Người dùng'}) không có quyền Quản lý người dùng
                  và vai trò (Manage users/roles - yêu cầu quyền <code>iam:manage_users</code>). Vui
                  lòng liên hệ Chủ cửa hàng (OWNER) để được cấp quyền.
                </p>
              </div>
            </div>
          ) : usersError ? (
            /* Error State with persistent retry banner */
            <div
              role="alert"
              className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between"
              data-testid="users-error-banner"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{usersError}</span>
              </div>
              <button
                type="button"
                data-testid="users-retry-button"
                onClick={() => void fetchUsers()}
                className="btn-secondary text-xs py-1 px-3 bg-white hover:bg-slate-50"
              >
                {USERS_RETRY_LABEL}
              </button>
            </div>
          ) : usersLoading ? (
            /* Loading Skeleton State */
            <div className="modern-card p-6 space-y-3" data-testid="users-loading-skeleton">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : users.length === 0 ? (
            totalUsers > 0 && userPage > totalPages ? (
              /* Out-of-range Page Recovery State (Finding 9) */
              <div className="space-y-4">
                <div
                  className="modern-card p-12 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                  data-testid="users-out-of-range-state"
                >
                  <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Trang {userPage} không có dữ liệu
                  </h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Hiện có {totalUsers} người dùng trên {totalPages} trang. Vui lòng chuyển về
                    trang hợp lệ.
                  </p>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setUserPage(totalPages)}
                      className="btn-primary text-xs py-1.5 px-3 cursor-pointer"
                      data-testid="users-nav-last-page-btn"
                    >
                      Đến trang {totalPages}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserPage(1)}
                      className="btn-secondary text-xs py-1.5 px-3 cursor-pointer"
                      data-testid="users-nav-first-page-btn"
                    >
                      Về trang 1
                    </button>
                  </div>
                </div>

                <PaginationControls
                  page={userPage}
                  pageSize={userPageSize}
                  total={totalUsers}
                  totalPages={totalPages}
                  onPageChange={(p) => setUserPage(p)}
                  onPageSizeChange={(s) => {
                    setUserPageSize(s);
                    setUserPage(1);
                  }}
                  pageSizeOptions={[10, 20, 50]}
                  testIdPrefix="users-pagination"
                />
              </div>
            ) : userSearch.trim() || userRoleFilter !== 'ALL' || userStatusFilter !== 'ALL' ? (
              /* No Results State with active filters */
              <div
                className="modern-card p-12 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                data-testid="users-no-results-state"
              >
                <Search className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-sm font-bold text-slate-900">
                  Không tìm thấy người dùng phù hợp với bộ lọc
                </h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Hãy thử thay đổi từ khóa tìm kiếm hoặc điều chỉnh điều kiện lọc vai trò / trạng
                  thái.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setUserSearch('');
                    setUserRoleFilter('ALL');
                    setUserStatusFilter('ALL');
                    setUserPage(1);
                  }}
                  className="btn-secondary text-xs py-1.5 px-3 inline-flex items-center gap-1.5 cursor-pointer mx-auto"
                  data-testid="users-clear-filters-btn"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  <span>Xóa bộ lọc</span>
                </button>
              </div>
            ) : (
              /* Clean Empty State */
              <div
                className="modern-card p-12 text-center bg-slate-50 border border-slate-200 rounded-xl space-y-2"
                data-testid="users-empty-state"
              >
                <UserCheck className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-600 font-medium" data-testid="users-empty-text">
                  {USERS_EMPTY_STATE_TEXT}
                </p>
              </div>
            )
          ) : (
            /* Populated Table State */
            <div className="modern-card overflow-hidden">
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left border-collapse text-xs"
                  data-testid="users-table"
                >
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                      <th className="py-3 px-4">
                        <SortableColumnHeader
                          label="Nhân Viên / Email"
                          field="full_name"
                          currentSort={userSortBy}
                          currentDirection={userSortOrder}
                          onSort={(f) => setUserSort(f)}
                          testId="sort-header-user-fullname"
                        />
                      </th>
                      <th className="py-3 px-4">Vai Trò Chính</th>
                      <th className="py-3 px-4">Phạm Vi Chi Nhánh</th>
                      <th className="py-3 px-4">Phạm Vi Kho Hàng</th>
                      <th className="py-3 px-4">Phạm Vi TK Vận Chuyển</th>
                      <th className="py-3 px-4">
                        <SortableColumnHeader
                          label="Ngày Tạo"
                          field="created_at"
                          currentSort={userSortBy}
                          currentDirection={userSortOrder}
                          onSort={(f) => setUserSort(f)}
                          testId="sort-header-user-created"
                        />
                      </th>
                      <th className="py-3 px-4">Đăng Nhập Gần Nhất</th>
                      <th className="py-3 px-4">Trạng Thái</th>
                      <th className="py-3 px-4 text-right">Thao Tác</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u: any) => {
                      const userStores: string[] = u.store_scopes || u.assigned_stores || [];
                      const userWarehouses: string[] = u.warehouse_scopes || [];
                      const userCarriers: string[] = u.carrier_account_scopes || [];
                      const isAllStores = userStores.includes('*');
                      const isAllWarehouses = userWarehouses.includes('*');
                      const isAllCarriers = userCarriers.includes('*');
                      const assignedStoreObjs = isAllStores
                        ? stores
                        : stores.filter((s) => userStores.includes(s.id));

                      const activeOwnersCount = users.filter(
                        (x) => x.role === 'OWNER' && x.status?.toUpperCase() === 'ACTIVE'
                      ).length;
                      const isCurrentActor = Boolean(user?.id && u.id === user.id);
                      const isSoleActiveOwner =
                        u.role === 'OWNER' &&
                        u.status?.toUpperCase() === 'ACTIVE' &&
                        activeOwnersCount <= 1;

                      const normalizedStatus = (u.status || 'ACTIVE').toUpperCase();

                      return (
                        <tr
                          key={u.id}
                          className="hover:bg-slate-50/80 transition"
                          data-testid={`user-row-${u.id}`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                                {u.full_name ? u.full_name.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div>
                                <strong className="text-slate-900 text-xs block">
                                  {u.full_name}
                                </strong>
                                <span className="font-mono text-[11px] text-slate-500">
                                  {u.email || u.phone || 'Chưa cập nhật'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4">
                            <span
                              className={`badge-muted text-[11px] font-bold ${
                                String(u.role) === 'OWNER'
                                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                                  : String(u.role) === 'ACCOUNTANT'
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : String(u.role) === 'OPS_CSKH'
                                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                                      : String(u.role) === 'STORE_MANAGER'
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {String(u.role) === 'OWNER'
                                ? '👑 Chủ Shop (Owner)'
                                : String(u.role) === 'ACCOUNTANT'
                                  ? '💼 Kế Toán (Maker-Checker)'
                                  : String(u.role) === 'OPS_CSKH'
                                    ? '🎧 CSKH / Cứu Đơn'
                                    : String(u.role) === 'STORE_MANAGER'
                                      ? '🏢 Quản Lý Chi Nhánh'
                                      : String(u.role) === 'WAREHOUSE'
                                        ? '📦 Thủ Kho'
                                        : u.role}
                            </span>
                          </td>

                          {/* Branch / Store Scopes */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1">
                              {isAllStores ? (
                                <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[10px] flex items-center gap-1">
                                  <Building2 className="w-3 h-3" />
                                  <span>Toàn Hệ Thống (*)</span>
                                </span>
                              ) : !userStores.length ? (
                                <span className="text-[10px] text-slate-400">
                                  không gán phạm vi
                                </span>
                              ) : (
                                userStores.map((s) => (
                                  <span
                                    key={s}
                                    className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[10px] flex items-center gap-1"
                                  >
                                    <Store className="w-3 h-3 text-slate-400" />
                                    <span>{s}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>

                          {/* Warehouse Scopes */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1">
                              {isAllWarehouses ? (
                                <span className="px-2 py-0.5 rounded-md bg-purple-50 border border-purple-200 text-purple-700 font-bold text-[10px] flex items-center gap-1">
                                  <Warehouse className="w-3 h-3" />
                                  <span>Tất Cả Kho (*)</span>
                                </span>
                              ) : !userWarehouses.length ? (
                                <span className="text-[10px] text-slate-400">
                                  không gán phạm vi
                                </span>
                              ) : (
                                userWarehouses.map((w) => (
                                  <span
                                    key={w}
                                    className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[10px] flex items-center gap-1"
                                  >
                                    <Warehouse className="w-3 h-3 text-slate-400" />
                                    <span>{w}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>

                          {/* Carrier Account Scopes */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-wrap gap-1">
                              {isAllCarriers ? (
                                <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-[10px] flex items-center gap-1">
                                  <span>Tất Cả TK Vận Chuyển (*)</span>
                                </span>
                              ) : !userCarriers.length ? (
                                <span className="text-[10px] text-slate-400">
                                  không gán phạm vi
                                </span>
                              ) : (
                                userCarriers.map((c) => (
                                  <span
                                    key={c}
                                    className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium text-[10px] flex items-center gap-1"
                                  >
                                    <span>{c}</span>
                                  </span>
                                ))
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                            {u.created_at ? new Date(u.created_at).toLocaleString('vi-VN') : '—'}
                          </td>

                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500">
                            {u.last_active_at
                              ? new Date(u.last_active_at).toLocaleString('vi-VN')
                              : 'Chưa hoạt động'}
                          </td>

                          <td className="py-3.5 px-4">
                            {normalizedStatus === 'ACTIVE' ? (
                              <span
                                className="badge-ok text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200"
                                data-testid={`status-badge-${u.id}`}
                              >
                                Hoạt động
                              </span>
                            ) : normalizedStatus === 'SUSPENDED' ? (
                              <span
                                className="badge-warn text-[10px] bg-amber-50 text-amber-700 border border-amber-200"
                                data-testid={`status-badge-${u.id}`}
                              >
                                Tạm ngưng
                              </span>
                            ) : normalizedStatus === 'DISABLED' ? (
                              <span
                                className="badge-danger text-[10px] bg-rose-50 text-rose-700 border border-rose-200"
                                data-testid={`status-badge-${u.id}`}
                              >
                                Vô hiệu hóa
                              </span>
                            ) : (
                              <span
                                className="badge-muted text-[10px]"
                                data-testid={`status-badge-${u.id}`}
                              >
                                {normalizedStatus}
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(u)}
                                className="btn-secondary text-xs py-1 px-2.5 text-blue-600 hover:text-blue-700"
                                title="Chỉnh sửa thông tin &amp; phân quyền"
                                data-testid={`edit-btn-${u.id}`}
                              >
                                <Sliders className="w-3.5 h-3.5" />
                                <span>Phân Quyền</span>
                              </button>

                              <button
                                type="button"
                                data-testid={`edit-scopes-btn-${u.id}`}
                                onClick={() => handleOpenEdit(u)}
                                className="btn-secondary text-xs py-1 px-2.5 text-indigo-600 hover:text-indigo-700 inline-flex items-center gap-1"
                              >
                                <span>Gán Phạm Vi</span>
                              </button>

                              {normalizedStatus === 'ACTIVE' && (
                                <button
                                  type="button"
                                  disabled={isCurrentActor || isSoleActiveOwner}
                                  title={
                                    isCurrentActor
                                      ? 'Bạn không thể tự tạm dừng tài khoản của chính mình'
                                      : isSoleActiveOwner
                                        ? 'Không thể tạm dừng chủ sở hữu duy nhất còn hoạt động của cửa hàng'
                                        : 'Tạm dừng tài khoản người dùng'
                                  }
                                  onClick={() => handleOpenSuspend(u)}
                                  className={`btn-secondary text-xs py-1 px-2.5 text-amber-600 hover:text-amber-700 ${
                                    isCurrentActor || isSoleActiveOwner
                                      ? 'opacity-40 cursor-not-allowed'
                                      : ''
                                  }`}
                                  data-testid={`suspend-btn-${u.id}`}
                                >
                                  <ShieldAlert className="w-3.5 h-3.5" />
                                  <span>Tạm Dừng</span>
                                </button>
                              )}

                              {normalizedStatus === 'SUSPENDED' && (
                                <button
                                  type="button"
                                  onClick={() => handleConfirmActivate()}
                                  onMouseEnter={() => setActivatingUser(u)}
                                  className="btn-secondary text-xs py-1 px-2.5 text-emerald-600 hover:text-emerald-700"
                                  title="Kích hoạt lại tài khoản người dùng"
                                  data-testid={`activate-btn-${u.id}`}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Kích Hoạt</span>
                                </button>
                              )}

                              {normalizedStatus !== 'DISABLED' && (
                                <button
                                  type="button"
                                  disabled={isCurrentActor || isSoleActiveOwner}
                                  title={
                                    isCurrentActor
                                      ? 'Bạn không thể tự vô hiệu hóa tài khoản của chính mình'
                                      : isSoleActiveOwner
                                        ? 'Không thể vô hiệu hóa chủ sở hữu duy nhất còn hoạt động của cửa hàng'
                                        : 'Vô hiệu hóa vĩnh viễn tài khoản người dùng'
                                  }
                                  onClick={() => handleOpenDeactivate(u)}
                                  className={`btn-secondary text-xs py-1 px-2.5 text-rose-600 hover:text-rose-700 ${
                                    isCurrentActor || isSoleActiveOwner
                                      ? 'opacity-40 cursor-not-allowed'
                                      : ''
                                  }`}
                                  data-testid={`deactivate-btn-${u.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Vô Hiệu Hóa</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls (FEAT-COM-02 shared list contract) */}
              <PaginationControls
                page={userPage}
                pageSize={userPageSize}
                total={totalUsers > 0 ? totalUsers : users.length}
                totalPages={totalPages}
                onPageChange={(p) => setUserPage(p)}
                onPageSizeChange={(s) => {
                  setUserPageSize(s);
                  setUserPage(1);
                }}
                pageSizeOptions={[10, 20, 50]}
                testIdPrefix="users-pagination"
              />
            </div>
          )}
        </div>
      )}

      {/* SUBTAB: INVITATIONS (FEAT-USR-01) */}
      {activeSubTab === 'invitations' && (
        <div className="space-y-4">
          {isForbidden ? (
            <div className="p-8 text-center bg-amber-50/60 border border-amber-200 rounded-2xl space-y-2 animate-in fade-in">
              <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto" />
              <h4 className="font-bold text-sm text-slate-800">{INVITATIONS_FORBIDDEN_TEXT}</h4>
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Tài khoản của bạn ({user?.role || 'Người dùng'}) không có quyền Quản lý người dùng
                và vai trò (Manage users/roles). Vui lòng liên hệ Chủ cửa hàng (OWNER) để được cấp
                quyền.
              </p>
            </div>
          ) : (
            <>
              {/* Error banner with retry */}
              {invitationsError && (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{invitationsError}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void fetchInvitations()}
                      className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded font-semibold transition"
                    >
                      {INVITATIONS_RETRY_LABEL}
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvitationsError(null)}
                      className="text-red-500 hover:text-red-700 font-bold ml-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              {/* Filter and stats bar */}
              <div className="modern-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50/60">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-700">Lọc theo trạng thái:</span>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { key: 'ALL', label: 'Tất cả' },
                      { key: 'PENDING', label: 'Đang chờ' },
                      { key: 'EXPIRED', label: 'Hết hạn' },
                      { key: 'ACCEPTED', label: 'Đã chấp nhận' },
                      { key: 'CANCELLED', label: 'Đã hủy' },
                    ].map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setInvitationsStatusFilter(f.key)}
                        className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                          invitationsStatusFilter === f.key
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void fetchInvitations()}
                    disabled={invitationsLoading}
                    className="p-1.5 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg text-slate-600 text-xs transition"
                    title="Làm mới danh sách"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${invitationsLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(true)}
                    className="btn-primary text-xs"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>+ Gửi Lời Mời Mới</span>
                  </button>
                </div>
              </div>

              {/* Table / List: dismissible retry alert only on error with zero rows; keep last successful rows on refresh failure */}
              {!(invitationsError && invitations.length === 0) && (
                <div className="modern-card overflow-hidden">
                  {invitationsLoading ? (
                    <div className="p-6 space-y-3 animate-pulse">
                      <div className="h-4 bg-slate-200 rounded w-1/4" />
                      <div className="h-10 bg-slate-100 rounded" />
                      <div className="h-10 bg-slate-100 rounded" />
                      <div className="h-10 bg-slate-100 rounded" />
                    </div>
                  ) : invitations.length === 0 ? (
                    <div className="text-center py-12 px-4">
                      <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <h4 className="font-bold text-sm text-slate-700">
                        {INVITATIONS_EMPTY_STATE_TEXT}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        Hiện không có lời mời nào trong mục này. Bạn có thể nhấn &quot;Gửi Lời Mời
                        Mới&quot; để mời thêm nhân sự vào cửa hàng.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsInviteOpen(true)}
                        className="btn-primary text-xs mt-4 inline-flex items-center gap-1.5"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Gửi Lời Mời Mới
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                            <th className="py-3 px-4">Người Nhận</th>
                            <th className="py-3 px-4">Vai Trò Chỉ Định</th>
                            <th className="py-3 px-4">Phạm Vi Chi Nhánh / Kho</th>
                            <th className="py-3 px-4">Trạng Thái</th>
                            <th className="py-3 px-4">Thời Gian Hết Hạn</th>
                            <th className="py-3 px-4 text-right">Thao Tác</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {invitations.map((inv) => {
                            const isExpired = inv.status === 'EXPIRED';
                            const isPending = inv.status === 'PENDING';
                            const isAccepted = inv.status === 'ACCEPTED';
                            const isCancelled = inv.status === 'CANCELLED';
                            const isLoadingAction = actionLoadingId === inv.id;

                            return (
                              <tr key={inv.id} className="hover:bg-slate-50/80 transition">
                                <td className="py-3 px-4">
                                  <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                    {inv.email ? (
                                      <>
                                        <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                        <span>{inv.email}</span>
                                      </>
                                    ) : (
                                      <>
                                        <Phone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        <span>{inv.phone}</span>
                                      </>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-0.5">
                                    Tạo ngày: {new Date(inv.created_at).toLocaleDateString('vi-VN')}
                                  </div>
                                </td>

                                <td className="py-3 px-4">
                                  <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-700">
                                    {inv.role === 'OWNER' && 'Chủ Cửa Hàng'}
                                    {inv.role === 'OPS_CSKH' && 'CSKH / Vận Hành'}
                                    {inv.role === 'WAREHOUSE' && 'Thủ Kho'}
                                    {inv.role === 'ACCOUNTANT' && 'Kế Toán'}
                                  </span>
                                </td>

                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    <div className="flex flex-wrap gap-1">
                                      {inv.store_scopes?.length > 0 ? (
                                        inv.store_scopes.map((sc: string) => (
                                          <span
                                            key={sc}
                                            className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.2 rounded font-medium"
                                          >
                                            {sc}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-[10px] text-slate-400">
                                          không gán phạm vi
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {inv.warehouse_scopes?.length > 0 &&
                                        inv.warehouse_scopes.map((wh: string) => (
                                          <span
                                            key={wh}
                                            className="text-[10px] bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded font-medium"
                                          >
                                            {wh}
                                          </span>
                                        ))}
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3 px-4">
                                  {isPending && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                      <Clock className="w-3 h-3" /> Đang chờ xử lý
                                    </span>
                                  )}
                                  {isAccepted && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      <Check className="w-3 h-3" /> Đã chấp nhận
                                    </span>
                                  )}
                                  {isExpired && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                                      <AlertCircle className="w-3 h-3" /> Đã hết hạn
                                    </span>
                                  )}
                                  {isCancelled && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                      Đã hủy
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-4 text-slate-600">
                                  <div>{new Date(inv.expires_at).toLocaleDateString('vi-VN')}</div>
                                  <div className="text-[10px] text-slate-400">
                                    {new Date(inv.expires_at).toLocaleTimeString('vi-VN')}
                                  </div>
                                </td>

                                <td className="py-3 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1.5">
                                    {/* Recovery: Resend button for unconsumed PENDING and EXPIRED (Finding 5) */}
                                    {isInvitationResendable(inv.status, inv.consumed_at) && (
                                      <button
                                        type="button"
                                        onClick={() => void handleResendInvite(inv.id)}
                                        disabled={isLoadingAction}
                                        className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded font-semibold text-xs flex items-center gap-1 transition"
                                      >
                                        {isLoadingAction ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <RefreshCw className="w-3 h-3" />
                                        )}
                                        <span>Gửi lại</span>
                                      </button>
                                    )}

                                    {/* Cancel button for PENDING */}
                                    {isPending && (
                                      <button
                                        type="button"
                                        onClick={() => void handleCancelInvite(inv.id)}
                                        disabled={isLoadingAction}
                                        className="px-2.5 py-1 bg-slate-100 hover:bg-red-50 hover:text-red-700 hover:border-red-200 text-slate-600 border border-slate-200 rounded font-semibold text-xs flex items-center gap-1 transition"
                                      >
                                        {isLoadingAction ? (
                                          <Loader2 className="w-3 h-3 animate-spin" />
                                        ) : (
                                          <span>Hủy lời mời</span>
                                        )}
                                      </button>
                                    )}

                                    {isAccepted && (
                                      <span className="text-[11px] text-slate-400 italic">
                                        Đã kích hoạt
                                      </span>
                                    )}
                                    {isCancelled && (
                                      <span className="text-[11px] text-slate-400 italic">
                                        Đã hủy bỏ
                                      </span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SUBTAB 2: STORES / BRANCHES MANAGEMENT (FEAT-COM-02 shared list contract) */}
      {activeSubTab === 'stores' && (
        <BranchManagementView
          branches={stores.map((s) => ({
            merchant_id: '',
            is_default: false,
            created_at: '',
            updated_at: '',
            ...s,
          }))}
          loading={storesLoading}
          error={storesError}
          canEdit={canEditBranches}
          onRefresh={fetchStores}
          onCreate={handleCreateBranch}
          onUpdate={handleUpdateBranch}
          onActivate={handleActivateBranch}
          onDeactivate={handleDeactivateBranch}
          namespace="branch"
        />
      )}

      {/* SUBTAB 3: RBAC MATRIX */}
      {activeSubTab === 'matrix' && (
        <div className="space-y-4">
          <div className="modern-card p-4 bg-slate-50/70 border border-slate-200 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <ShieldAlert className="w-4 h-4 text-blue-600" />
                <span>Bảo Vệ Tính Toàn Vẹn Quyền Hạn (Invariants Guard)</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                Hệ thống thực thi nguyên tắc phân chia trách nhiệm (Segregation of Duties). Quy tắc{' '}
                <strong>Maker-Checker (BR-12)</strong> khóa cứng không cho phép vai trò CSKH tự
                duyệt sai lệch đối soát tài chính nhằm phòng ngừa gian lận.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void fetchLiveRoles()}
                disabled={matrixLoading}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 text-slate-700 bg-white border border-slate-300 hover:bg-slate-50"
                title="Tải lại ma trận quyền từ API /roles"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${matrixLoading ? 'animate-spin' : ''}`} />
                <span>Đồng bộ Live</span>
              </button>
              <Link
                href="/settings/roles"
                className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap flex items-center gap-1.5 font-semibold text-blue-600 hover:text-blue-700 bg-white border border-blue-200 shadow-sm"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Quản Lý Vai Trò Cửa Hàng →</span>
              </Link>
            </div>
          </div>

          {matrixLoading && liveRoles.length === 0 ? (
            <div className="modern-card p-8 flex flex-col items-center justify-center gap-3 text-slate-500 text-xs">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span className="font-medium">
                Đang tải ma trận phân quyền từ máy chủ (GET /roles)...
              </span>
              <div className="w-full max-w-md space-y-2 pt-2 animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-3/4 mx-auto" />
                <div className="h-4 bg-slate-100 rounded w-1/2 mx-auto" />
              </div>
            </div>
          ) : matrixError && liveRoles.length === 0 ? (
            <div className="modern-card p-6 bg-rose-50 border border-rose-200 text-rose-700 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                <div>
                  <p className="font-bold">Không thể tải dữ liệu phân quyền</p>
                  <p className="text-[11px] text-rose-600">{matrixError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void fetchLiveRoles()}
                className="btn-secondary text-xs py-1.5 px-3 bg-white border border-rose-300 text-rose-700 hover:bg-rose-100 font-semibold"
              >
                Thử lại
              </button>
            </div>
          ) : liveRoles.length === 0 ? (
            <div className="modern-card p-8 text-center text-slate-500 text-xs space-y-3">
              <ShieldAlert className="w-8 h-8 text-slate-400 mx-auto" />
              <p className="font-semibold text-slate-700">
                Chưa có vai trò nào được cấu hình từ máy chủ
              </p>
              <button
                type="button"
                onClick={() => void fetchLiveRoles()}
                className="btn-secondary text-xs py-1.5 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700"
              >
                Tải lại
              </button>
            </div>
          ) : (
            <div className="modern-card overflow-hidden">
              <div className="p-3 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-700">
                    Mô hình phân quyền hoạt động:
                  </span>
                  <span className="badge-ok text-[11px]">
                    Live RBAC: {liveRoles.length} vai trò (
                    {liveRoles.filter((r) => !r.is_system).length} tùy chỉnh)
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-bold uppercase text-[11px] tracking-wider">
                      <th className="py-3 px-4 w-1/3">Tính Năng & Nghiệp Vụ</th>
                      <th className="py-3 px-4">Quy Tắc Ràng Buộc</th>
                      {liveRoles.map((r) => (
                        <th key={r.id} className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-slate-800">{r.name}</span>
                            <span
                              className={`text-[9px] font-medium px-1.5 py-0.2 rounded mt-0.5 ${
                                r.is_system
                                  ? 'bg-slate-100 text-slate-500'
                                  : 'bg-blue-50 text-blue-600 border border-blue-200'
                              }`}
                            >
                              {r.is_system ? 'Mặc định' : 'Tùy chỉnh'}
                            </span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {permissionsMatrix.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">
                            {row.name || row.feature}
                          </div>
                          <div className="text-[11px] font-mono text-blue-600 font-normal">
                            {row.code}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                          {row.rule}
                        </td>
                        {liveRoles.map((role) => {
                          const hasPerm = (role.permissions || []).some(
                            (p) => p.code === row.code || p.id === row.id
                          );
                          return (
                            <td key={role.id} className="py-3 px-3 text-center">
                              <span
                                className={`w-6 h-6 mx-auto rounded-md inline-flex items-center justify-center ${
                                  hasPerm
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                    : 'bg-slate-100 text-slate-400 border border-slate-200'
                                }`}
                                title={
                                  hasPerm
                                    ? `Được cấp quyền: ${role.name}`
                                    : `Không có quyền: ${role.name}`
                                }
                              >
                                {hasPerm ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '✕'}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 4: REMOTE DEVICE SESSIONS */}
      {activeSubTab === 'devices' && (
        <div className="space-y-4">
          <div className="modern-card p-4 bg-slate-50/70 text-xs space-y-1">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-600" />
              <span>Cơ Chế Thu Hồi Quyền Thiết Bị Từ Xa (CN-25 · BR-08)</span>
            </h4>
            <p className="text-slate-600 text-[11px]">
              Khi thiết bị PDA của nhân viên kho bị thất lạc, Chủ Shop có thể thu hồi phiên tức thì.
              Máy bị thu hồi khi có mạng sẽ nhận mã <strong>401 device_revoked</strong> và bị hủy
              quyền đồng bộ dữ liệu.
            </p>
          </div>

          <div className="space-y-3">
            {deviceSessions.map((session) => (
              <div
                key={session.id}
                className="modern-card p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-slate-900 text-xs">{session.device_name}</strong>
                      {session.is_current && (
                        <span className="badge-ok text-[10px]">Thiết bị này</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 space-x-2">
                      <span>
                        Người dùng: <strong>{session.user_name}</strong>
                      </span>
                      <span>·</span>
                      <span>
                        Chi nhánh: <strong>{session.store_scope}</strong>
                      </span>
                      <span>·</span>
                      <span className="font-mono">
                        IP: {session.ip_address} ({session.location})
                      </span>
                    </div>
                  </div>
                </div>

                {!session.is_current && (
                  <button
                    type="button"
                    onClick={() => handleRevokeDevice(session.id, session.user_name)}
                    className="btn-danger text-xs py-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Thu Hồi Quyền (Revoke)</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: EDIT USER PERMISSIONS & SCOPES */}
      {editingUser && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"
          data-testid="scope-edit-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Phân Quyền & Gán Phạm Vi Cho Nhân Viên
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {editingUser.full_name} ({editingUser.email || editingUser.phone})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            {(scopeSaveError || editError) && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2"
                data-testid="scope-save-error"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{scopeSaveError || editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveUserPermissions} className="space-y-4">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  Họ và Tên Nhân Viên <span className="text-rose-500">*</span>:
                </label>
                <input
                  type="text"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  placeholder="Nhập họ và tên..."
                  className="modern-input w-full text-xs font-semibold"
                  data-testid="edit-fullname-input"
                />
                {fieldErrors.full_name && (
                  <p className="text-xs text-rose-600 mt-1" data-testid="field-error-full-name">
                    {fieldErrors.full_name}
                  </p>
                )}
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Vai Trò Phân Quyền:</label>
                <select
                  value={editRole}
                  onChange={(e: any) => setEditRole(e.target.value)}
                  className="modern-input w-full text-xs font-semibold"
                  data-testid="edit-role-select"
                >
                  {(user?.role === 'OWNER' || editingUser.role === 'OWNER') && (
                    <option value="OWNER">👑 Chủ Shop (Owner - Toàn quyền)</option>
                  )}
                  <option value="STORE_MANAGER">🏢 Quản Lý Cửa Hàng (Store Manager)</option>
                  <option value="OPS_CSKH">🎧 CSKH / Vận Hành (Cứu đơn)</option>
                  <option value="ACCOUNTANT">💼 Kế Toán Đối Soát (Maker-Checker)</option>
                  <option value="WAREHOUSE">📦 Thủ Kho (Quét hoàn)</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Phạm Vi Cửa Hàng / Chi Nhánh Được Phép Truy Cập:
                </label>
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-900 pb-1.5 border-b border-slate-200">
                    <input
                      type="checkbox"
                      data-testid="store-scope-wildcard"
                      checked={editStoreScopes.includes('*')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditStoreScopes(['*']);
                        } else {
                          setEditStoreScopes(['store_01']);
                        }
                      }}
                      className="rounded text-blue-600"
                    />
                    <span>Toàn Hệ Thống (Tất Cả Chi Nhánh)</span>
                  </label>

                  {!editStoreScopes.includes('*') && (
                    <div className="space-y-1.5 pt-1">
                      {stores.map((s) => {
                        const isChecked = editStoreScopes.includes(s.id);
                        return (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                let newStores = [...editStoreScopes];
                                if (e.target.checked) {
                                  newStores.push(s.id);
                                } else {
                                  newStores = newStores.filter((id) => id !== s.id);
                                }
                                setEditStoreScopes(newStores);
                              }}
                              className="rounded text-blue-600"
                            />
                            <span>{s.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                {fieldErrors.store_scopes && (
                  <p className="text-xs text-rose-600 mt-1" data-testid="field-error-store-scopes">
                    {fieldErrors.store_scopes}
                  </p>
                )}
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Phạm Vi Kho Vận Được Phép Truy Cập:
                </label>
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-900 pb-1.5 border-b border-slate-200">
                    <input
                      type="checkbox"
                      data-testid="warehouse-scope-wildcard"
                      checked={editWarehouseScopes.includes('*')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditWarehouseScopes(['*']);
                        } else {
                          setEditWarehouseScopes(['wh_tanbinh']);
                        }
                      }}
                      className="rounded text-blue-600"
                    />
                    <span>Tất Cả Kho Vận</span>
                  </label>

                  {!editWarehouseScopes.includes('*') && (
                    <div className="space-y-1.5 pt-1">
                      {AVAILABLE_WAREHOUSES.map((w) => {
                        const isChecked = editWarehouseScopes.includes(w.id);
                        return (
                          <label
                            key={w.id}
                            className="flex items-center gap-2 text-slate-700 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                let newWhs = [...editWarehouseScopes];
                                if (e.target.checked) {
                                  newWhs.push(w.id);
                                } else {
                                  newWhs = newWhs.filter((id) => id !== w.id);
                                }
                                setEditWarehouseScopes(newWhs);
                              }}
                              className="rounded text-blue-600"
                            />
                            <span>{w.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                {fieldErrors.warehouse_scopes && (
                  <p
                    className="text-xs text-rose-600 mt-1"
                    data-testid="field-error-warehouse-scopes"
                  >
                    {fieldErrors.warehouse_scopes}
                  </p>
                )}
              </div>

              {/* 3. Carrier Account Scopes */}
              <div>
                <label className="font-bold text-slate-700 block mb-1.5">
                  Phạm Vi Tài Khoản Vận Chuyển (Carrier Accounts):
                </label>
                <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-900 pb-1.5 border-b border-slate-200">
                    <input
                      type="checkbox"
                      data-testid="carrier-scope-wildcard"
                      checked={editCarrierScopes.includes('*')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setEditCarrierScopes(['*']);
                        } else {
                          setEditCarrierScopes([]);
                        }
                      }}
                      className="rounded text-blue-600"
                    />
                    <span>Tất Cả Tài Khoản Vận Chuyển (*)</span>
                  </label>

                  {!editCarrierScopes.includes('*') && (
                    <div className="space-y-1.5 pt-1">
                      <input
                        type="text"
                        data-testid="carrier-scopes-input"
                        placeholder="UUID tài khoản vận chuyển phân cách bởi dấu phẩy"
                        value={editCarrierScopes.join(', ')}
                        onChange={(e) => {
                          const val = e.target.value;
                          const items = val
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean);
                          setEditCarrierScopes(items);
                        }}
                        className="modern-input w-full text-xs font-mono"
                      />
                      <span className="text-[10px] text-slate-400 block">
                        Nhập UUID tài khoản vận chuyển (vd: c0000000-0000-0000-0000-000000000001)
                      </span>
                    </div>
                  )}
                </div>
                {fieldErrors.carrier_account_scopes && (
                  <p
                    className="text-xs text-rose-600 mt-1"
                    data-testid="field-error-carrier-scopes"
                  >
                    {fieldErrors.carrier_account_scopes}
                  </p>
                )}
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  disabled={mutationLoading}
                  className="btn-secondary text-xs"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={mutationLoading || scopeSaveLoading}
                  className="btn-primary text-xs flex items-center gap-1.5"
                  data-testid="save-scopes-submit-btn"
                >
                  {(mutationLoading || scopeSaveLoading) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Lưu Phân Quyền &amp; Phạm Vi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SUSPEND USER */}
      {suspendingUser && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"
          data-testid="suspend-user-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Tạm Dừng Người Dùng</h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {suspendingUser.full_name} ({suspendingUser.email || suspendingUser.phone})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSuspendingUser(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Tài khoản sẽ bị tạm ngưng truy cập vào hệ thống ngay lập tức và toàn bộ các phiên làm
              việc đang hoạt động sẽ bị thu hồi.
            </p>

            {suspensionError && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center gap-2"
                data-testid="suspend-reason-error"
              >
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{suspensionError}</span>
              </div>
            )}

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Lý Do Tạm Dừng <span className="text-rose-500">*</span>:
              </label>
              <textarea
                value={suspensionReason}
                onChange={(e) => setSuspensionReason(e.target.value)}
                placeholder="Nhập lý do tạm dừng tài khoản (bắt buộc)..."
                rows={3}
                className="modern-input w-full text-xs"
                data-testid="suspend-reason-input"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSuspendingUser(null)}
                disabled={mutationLoading}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSuspend()}
                disabled={mutationLoading}
                className="btn-primary text-xs bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5"
                data-testid="confirm-suspend-btn"
              >
                {mutationLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Xác Nhận Tạm Dừng</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ACTIVATE USER */}
      {activatingUser && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"
          data-testid="activate-user-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Kích Hoạt Lại Người Dùng</h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {activatingUser.full_name} ({activatingUser.email || activatingUser.phone})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActivatingUser(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có chắc chắn muốn kích hoạt lại tài khoản này? Người dùng sẽ có thể đăng nhập và
              tiếp tục làm việc bình thường.
            </p>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setActivatingUser(null)}
                disabled={mutationLoading}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmActivate()}
                disabled={mutationLoading}
                className="btn-primary text-xs bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5"
                data-testid="confirm-activate-btn"
              >
                {mutationLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Xác Nhận Kích Hoạt</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DEACTIVATE USER */}
      {deactivatingUser && (
        <div
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in"
          data-testid="deactivate-user-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Vô Hiệu Hóa Vĩnh Viễn Tài Khoản
                  </h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    {deactivatingUser.full_name} ({deactivatingUser.email || deactivatingUser.phone}
                    )
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeactivatingUser(null)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl space-y-1">
              <strong className="block text-[11px] font-bold">Lưu ý quan trọng:</strong>
              <p className="text-[11px] leading-relaxed">
                Tài khoản sẽ được chuyển sang trạng thái <strong>Vô hiệu hóa (DISABLED)</strong>.
                Toàn bộ các phiên làm việc sẽ bị thu hồi và tài khoản sẽ không thể đăng nhập lại.
              </p>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                Lý Do Vô Hiệu Hóa (tùy chọn):
              </label>
              <textarea
                value={deactivationReason}
                onChange={(e) => setDeactivationReason(e.target.value)}
                placeholder="Nhập lý do vô hiệu hóa..."
                rows={2}
                className="modern-input w-full text-xs"
                data-testid="deactivate-reason-input"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeactivatingUser(null)}
                disabled={mutationLoading}
                className="btn-secondary text-xs"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeactivate()}
                disabled={mutationLoading}
                className="btn-primary text-xs bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1.5"
                data-testid="confirm-deactivate-btn"
              >
                {mutationLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Xác Nhận Vô Hiệu Hóa</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE NEW STORE */}
      {isNewStoreModalOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-2xl text-xs animate-in zoom-in-95">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-slate-900">
                    Thêm Cửa Hàng / Chi Nhánh Mới
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Mở rộng mạng lưới cửa hàng và kho vận
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewStoreModalOpen(false)}
                className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateStore} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Mã Chi Nhánh:</label>
                  <input
                    type="text"
                    value={newStoreCode}
                    onChange={(e) => setNewStoreCode(e.target.value)}
                    placeholder="HCM-BT"
                    className="modern-input w-full font-mono uppercase font-bold text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Số Hotline:</label>
                  <input
                    type="tel"
                    value={newStorePhone}
                    onChange={(e) => setNewStorePhone(e.target.value)}
                    className="modern-input w-full font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Tên Cửa Hàng / Kho:</label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  placeholder="Chi Nhánh Bình Thạnh - Kho Phụ"
                  className="modern-input w-full text-xs"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Địa Chỉ Chi Tiết:</label>
                <input
                  type="text"
                  value={newStoreAddress}
                  onChange={(e) => setNewStoreAddress(e.target.value)}
                  placeholder="345 Bạch Đằng, P.14, Bình Thạnh, HCM"
                  className="modern-input w-full text-xs"
                  required
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsNewStoreModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Hủy
                </button>
                <button type="submit" className="btn-primary text-xs">
                  Tạo Chi Nhánh
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: INVITE USER */}
      <InviteUserModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        onUserInvited={(_invited: any) => {
          setIsInviteOpen(false);
          setToastMessage(INVITE_SUCCESS_TOAST);
          setActiveSubTab('invitations');
          void fetchInvitations();
          setTimeout(() => setToastMessage(null), 5000);
        }}
      />
    </div>
  );
};

export function resolveMatrixForLiveRoles(
  liveRoles: RoleItem[],
  matrixRows: Array<{ id: string; code: string; feature: string; name?: string }>
) {
  return matrixRows.map((row) => {
    const rolePermissions: Record<string, boolean> = {};
    for (const role of liveRoles) {
      rolePermissions[role.id] = (role.permissions || []).some(
        (p) => p.code === row.code || p.id === row.id
      );
    }
    return {
      id: row.id,
      code: row.code,
      name: row.name || row.feature,
      feature: row.feature,
      roles: rolePermissions,
    };
  });
}
