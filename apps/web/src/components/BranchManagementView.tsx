'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  GitBranch,
  Building2,
  Plus,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  X,
  Save,
  Star,
  Phone,
  MapPin,
  Search,
  Power,
  Info,
} from 'lucide-react';
import type { Branch, CreateBranchInput, UpdateBranchInput } from '@shipde/contracts';
import { type BranchFormState, validateBranchForm, isValidBranchCode } from '@shipde/contracts';
import { PaginationControls } from './common/SharedListControls';
import { useSharedListState, paginateInMemory } from '@/hooks/useSharedListState';

export type BranchItem = Branch;

export interface BranchManagementViewProps {
  branches?: Branch[];
  loading?: boolean;
  canEdit?: boolean;
  scopedStores?: string[] | null;
  error?: string | null;
  success?: string | null;
  isForbidden?: boolean;
  initialFormOpen?: boolean;
  initialEditingBranch?: Branch | null;
  initialFormState?: Partial<BranchFormState>;
  initialValidationErrors?: Record<string, string>;
  initialPage?: number;
  initialPageSize?: number;
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
  namespace?: string;
  serverTotal?: number;
  serverTotalPages?: number;
  onQueryChange?: (params: {
    page: number;
    limit: number;
    sortBy: string;
    sortOrder: 'asc' | 'desc';
    search: string;
    status: string;
  }) => void;
  tenantId?: string;
  userId?: string;
  onRefresh?: () => void;
  onCreate?: (input: CreateBranchInput) => Promise<void>;
  onUpdate?: (id: string, input: UpdateBranchInput) => Promise<void>;
  onActivate?: (id: string) => Promise<void>;
  onDeactivate?: (id: string) => Promise<void>;
}

export function BranchManagementView({
  branches = [],
  loading = false,
  canEdit = false,
  scopedStores = null,
  error = null,
  success = null,
  isForbidden = false,
  initialFormOpen = false,
  initialEditingBranch = null,
  initialFormState = {},
  initialValidationErrors = {},
  initialPage = 1,
  initialPageSize = 10,
  initialSortBy = 'name',
  initialSortOrder = 'asc',
  namespace,
  serverTotal,
  serverTotalPages,
  onQueryChange,
  tenantId,
  userId,
  onRefresh,
  onCreate,
  onUpdate,
  onActivate,
  onDeactivate,
}: BranchManagementViewProps) {
  // Filter & Search & Pagination & Sort states via shared hook (FEAT-COM-02)
  const listState = useSharedListState({
    defaultPage: initialPage,
    defaultPageSize: initialPageSize,
    defaultSortBy: initialSortBy,
    defaultSortOrder: initialSortOrder,
    defaultSearch: '',
    defaultFilters: { status: 'ALL' },
    syncUrl: true,
    namespace,
    listKey: 'branches',
    tenantId,
    userId,
  });

  const page = listState.page;
  const pageSize = listState.pageSize;
  const sortBy = listState.sortBy;
  const sortOrder = listState.sortOrder;
  const searchQuery = listState.search;
  const statusFilter = listState.filters.status as 'ALL' | 'ACTIVE' | 'INACTIVE';
  const setPage = listState.setPage;
  const setPageSize = listState.setPageSize;
  const setSort = listState.setSort;
  const setSortBy = listState.setSortBy;
  const setSortOrder = listState.setSortOrder;
  const setSearchQuery = listState.setSearch;
  const setStatusFilter = (val: 'ALL' | 'ACTIVE' | 'INACTIVE') =>
    listState.setFilter('status', val);
  const resetFilters = listState.resetFilters;

  // Notify server pagination consumer when query changes
  useEffect(() => {
    if (onQueryChange) {
      onQueryChange({
        page,
        limit: pageSize,
        sortBy,
        sortOrder,
        search: searchQuery,
        status: statusFilter,
      });
    }
  }, [page, pageSize, sortBy, sortOrder, searchQuery, statusFilter, onQueryChange]);

  // Modal / Form state
  const [isFormOpen, setIsFormOpen] = useState(initialFormOpen);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(initialEditingBranch);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Form field states
  const [formState, setFormState] = useState<BranchFormState>({
    name: initialEditingBranch?.name || initialFormState.name || '',
    code: initialEditingBranch?.code || initialFormState.code || '',
    address: initialEditingBranch?.address || initialFormState.address || '',
    phone: initialEditingBranch?.phone || initialFormState.phone || '',
    is_default: initialEditingBranch?.is_default ?? initialFormState.is_default ?? false,
    status: initialEditingBranch?.status || initialFormState.status || 'ACTIVE',
  });

  const [validationErrors, setValidationErrors] =
    useState<Record<string, string>>(initialValidationErrors);
  const [modalError, setModalError] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  const viewError = localError ?? error;
  const viewSuccess = localSuccess ?? success;
  const setViewError = (val: string | null) => setLocalError(val);
  const setViewSuccess = (val: string | null) => setLocalSuccess(val);

  // Filter, sort, and paginate using server metadata when provided or in-memory helper (FEAT-COM-02)
  const isServerPaged = serverTotal !== undefined;
  const paginationResult = useMemo(() => {
    if (isServerPaged) {
      const calcTotalPages = serverTotalPages ?? Math.max(1, Math.ceil(serverTotal / pageSize));
      return {
        pagedItems: branches,
        total: serverTotal,
        totalPages: calcTotalPages,
      };
    }
    return paginateInMemory({
      items: branches,
      page,
      pageSize,
      filterFn: (branch) => {
        if (statusFilter !== 'ALL' && branch.status !== statusFilter) {
          return false;
        }
        if (searchQuery.trim()) {
          const query = searchQuery.toLowerCase().trim();
          const matchName = branch.name.toLowerCase().includes(query);
          const matchCode = branch.code.toLowerCase().includes(query);
          const matchAddress = branch.address
            ? branch.address.toLowerCase().includes(query)
            : false;
          const matchPhone = branch.phone ? branch.phone.includes(query) : false;
          return matchName || matchCode || matchAddress || matchPhone;
        }
        return true;
      },
      sortFn: (a, b) => {
        let cmp = 0;
        if (sortBy === 'name') cmp = a.name.localeCompare(b.name, 'vi');
        else if (sortBy === 'code') cmp = a.code.localeCompare(b.code, 'vi');
        else if (sortBy === 'created_at') {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          cmp = dateA - dateB;
        }
        return sortOrder === 'asc' ? cmp : -cmp;
      },
    });
  }, [
    isServerPaged,
    branches,
    serverTotal,
    serverTotalPages,
    page,
    pageSize,
    statusFilter,
    searchQuery,
    sortBy,
    sortOrder,
  ]);

  const pagedBranches = paginationResult.pagedItems;
  const total = paginationResult.total;
  const totalPages = paginationResult.totalPages;

  const safePage = Math.min(Math.max(1, page), totalPages);

  const activeCount = useMemo(
    () => branches.filter((b) => b.status === 'ACTIVE').length,
    [branches]
  );
  const inactiveCount = useMemo(
    () => branches.filter((b) => b.status === 'INACTIVE').length,
    [branches]
  );

  const isRestrictedScope = useMemo(() => {
    return Array.isArray(scopedStores) && scopedStores.length > 0 && !scopedStores.includes('*');
  }, [scopedStores]);

  // Open Create Form
  const handleOpenCreate = () => {
    if (!canEdit) return;
    setEditingBranch(null);
    setFormState({
      name: '',
      code: '',
      address: '',
      phone: '',
      is_default: branches.length === 0, // Auto-default if first branch
      status: 'ACTIVE',
    });
    setValidationErrors({});
    setModalError(null);
    setIsFormOpen(true);
  };

  // Open Edit Form
  const handleOpenEdit = (branch: Branch) => {
    if (!canEdit) return;
    setEditingBranch(branch);
    setFormState({
      name: branch.name,
      code: branch.code,
      address: branch.address || '',
      phone: branch.phone || '',
      is_default: branch.is_default,
      status: branch.status,
    });
    setValidationErrors({});
    setModalError(null);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingBranch(null);
    setValidationErrors({});
    setModalError(null);
  };

  const handleFormFieldChange = (field: keyof BranchFormState, value: any) => {
    setFormState((prev) => ({
      ...prev,
      [field]: field === 'code' && typeof value === 'string' ? value.toUpperCase().trim() : value,
    }));
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Submit Create or Update
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const { isValid, errors } = validateBranchForm(formState);
    if (!isValid) {
      setValidationErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      if (editingBranch) {
        if (onUpdate) {
          await onUpdate(editingBranch.id, {
            name: formState.name.trim(),
            code: formState.code.trim().toUpperCase(),
            address: formState.address.trim() || null,
            phone: formState.phone.trim() || null,
            is_default: formState.is_default,
            status: formState.status,
          });
          setViewSuccess(`Đã cập nhật chi nhánh "${formState.name}" thành công`);
        }
      } else {
        if (onCreate) {
          await onCreate({
            name: formState.name.trim(),
            code: formState.code.trim().toUpperCase(),
            address: formState.address.trim() || null,
            phone: formState.phone.trim() || null,
            is_default: formState.is_default,
            status: formState.status,
          });
          setViewSuccess(`Đã tạo mới chi nhánh "${formState.name}" thành công`);
        }
      }
      handleCloseForm();
    } catch (err: any) {
      setModalError(err?.message || 'Có lỗi xảy ra khi lưu chi nhánh. Vui lòng kiểm tra lại.');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Activate / Deactivate
  const handleToggleStatus = async (branch: Branch) => {
    if (!canEdit) return;

    if (branch.status === 'ACTIVE') {
      if (branch.is_default) {
        setViewError(
          'Không thể tạm ngưng hoạt động của chi nhánh mặc định. Vui lòng chỉ định một chi nhánh khác làm mặc định trước.'
        );
        return;
      }
      setActionLoadingId(branch.id);
      setViewError(null);
      try {
        if (onDeactivate) {
          await onDeactivate(branch.id);
          setViewSuccess(`Đã tạm ngưng hoạt động chi nhánh "${branch.name}"`);
        }
      } catch (err: any) {
        setViewError(err?.message || 'Không thể tạm ngưng chi nhánh');
      } finally {
        setActionLoadingId(null);
      }
    } else {
      setActionLoadingId(branch.id);
      setViewError(null);
      try {
        if (onActivate) {
          await onActivate(branch.id);
          setViewSuccess(`Đã kích hoạt hoạt động chi nhánh "${branch.name}"`);
        }
      } catch (err: any) {
        setViewError(err?.message || 'Không thể kích hoạt chi nhánh');
      } finally {
        setActionLoadingId(null);
      }
    }
  };

  // Quick action: Set as default
  const handleSetDefault = async (branch: Branch) => {
    if (!canEdit || branch.is_default) return;
    setActionLoadingId(branch.id);
    setViewError(null);
    try {
      if (onUpdate) {
        await onUpdate(branch.id, { is_default: true });
        setViewSuccess(`Đã đặt chi nhánh "${branch.name}" làm mặc định`);
      }
    } catch (err: any) {
      setViewError(err?.message || 'Không thể đặt chi nhánh làm mặc định');
    } finally {
      setActionLoadingId(null);
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className="space-y-6 animate-pulse" data-testid="branch-loading-state">
        <div data-testid="branch-loading-skeleton" className="animate-pulse space-y-4">
          <div className="h-24 bg-slate-200 rounded-2xl w-full" />
          <div className="h-12 bg-slate-200 rounded-xl w-72" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="h-48 bg-slate-200 rounded-2xl" />
            <div className="h-48 bg-slate-200 rounded-2xl" />
            <div className="h-48 bg-slate-200 rounded-2xl" />
          </div>
          <div className="text-center text-xs font-semibold text-slate-400">
            Đang tải danh sách chi nhánh...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="branch-management-container">
      {/* Top Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
            <GitBranch className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900" data-testid="branch-header-title">
                Quản lý Chi nhánh &amp; Điểm gửi hàng
              </h1>
              <span className="text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-md">
                {branches.length} chi nhánh
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Quản lý danh sách chi nhánh, kho gửi hàng, mã định danh và phạm vi vận hành của từng
              đơn vị.
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              data-testid="refresh-branches-button"
              aria-label="Làm mới danh sách"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
              title="Làm mới danh sách"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Làm mới</span>
            </button>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={handleOpenCreate}
              data-testid="create-branch-button"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span data-testid="create-branch-btn">Thêm chi nhánh</span>
            </button>
          )}
        </div>
      </div>

      {/* Forbidden Warning Banner */}
      {(!canEdit || isForbidden) && (
        <div
          className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3"
          data-testid="branch-forbidden-banner"
        >
          <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-amber-900">
              {isForbidden
                ? '403 — Không Có Quyền Quản Lý Chi Nhánh'
                : 'Giới hạn quyền cấu hình chi nhánh'}
            </h4>
            <p className="text-xs text-amber-700 mt-0.5">
              Tài khoản của bạn chỉ có quyền xem danh sách chi nhánh. Cần quyền cấu hình cửa hàng
              (iam:shop_config) để thêm hoặc chỉnh sửa chi nhánh.
            </p>
          </div>
        </div>
      )}

      {/* Store Scoped Info Banner */}
      {isRestrictedScope && (
        <div
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3"
          data-testid="branch-scoped-banner"
        >
          <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-bold text-blue-900">Phạm vi truy cập theo phân quyền</h4>
            <p className="text-xs text-blue-700 mt-0.5">
              Bạn đang xem các chi nhánh được phân quyền theo tài khoản ({scopedStores?.join(', ')}
              ). Các chi nhánh ngoài danh sách phân quyền đã được ẩn server-side.
            </p>
          </div>
        </div>
      )}

      {/* Server Error Banner with Retry */}
      {viewError && (
        <div
          className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-center justify-between gap-3"
          data-testid="branch-error-banner"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
            <div>
              <h4 className="text-xs font-bold text-rose-900">Thông báo lỗi</h4>
              <p className="text-xs text-rose-700 mt-0.5">{viewError}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                data-testid="retry-error-button"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white text-rose-700 border border-rose-300 rounded-lg hover:bg-rose-100 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử lại</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewError(null)}
              data-testid="dismiss-error-button"
              aria-label="Đóng thông báo lỗi"
              title="Đóng thông báo lỗi"
              className="p-1 text-rose-500 hover:text-rose-700 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {viewSuccess && (
        <div
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3"
          data-testid="branch-success-banner"
        >
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-xs font-bold text-emerald-900">{viewSuccess}</p>
          </div>
          <button
            type="button"
            onClick={() => setViewSuccess(null)}
            data-testid="dismiss-success-button"
            aria-label="Đóng thông báo thành công"
            title="Đóng thông báo thành công"
            className="p-1 text-emerald-600 hover:text-emerald-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* When isForbidden is true, do not render grid/list controls */}
      {!isForbidden && (
        <>
          {/* Filter, Search and Sort Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
            {/* Status Tabs */}
            <div
              className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl"
              data-testid="branch-status-filter"
            >
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL');
                  setPage(1);
                }}
                data-testid="filter-tab-all"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  statusFilter === 'ALL'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tất cả ({branches.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ACTIVE');
                  setPage(1);
                }}
                data-testid="filter-tab-active"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  statusFilter === 'ACTIVE'
                    ? 'bg-white text-emerald-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Đang hoạt động ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('INACTIVE');
                  setPage(1);
                }}
                data-testid="filter-tab-inactive"
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition cursor-pointer ${
                  statusFilter === 'INACTIVE'
                    ? 'bg-white text-slate-700 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Tạm ngưng ({inactiveCount})
              </button>
            </div>

            {/* Right: Search & Sort controls */}
            <div className="flex flex-col sm:flex-row items-center gap-2">
              {/* Sort Selector */}
              <div className="flex items-center gap-1.5" data-testid="branch-sort-select">
                <label htmlFor="branch-sort-by" className="text-xs text-slate-500 font-medium">
                  Sắp xếp:
                </label>
                <select
                  id="branch-sort-by"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value);
                    setPage(1);
                  }}
                  className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-hidden"
                >
                  <option value="name">Tên chi nhánh</option>
                  <option value="code">Mã chi nhánh</option>
                  <option value="created_at">Ngày tạo</option>
                </select>
                <button
                  type="button"
                  onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  aria-label="Đổi chiều sắp xếp"
                  className="px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100"
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>

              {/* Search Input */}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="branch-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Tìm theo tên, mã, SĐT..."
                  aria-label="Tìm kiếm chi nhánh theo tên, mã hoặc số điện thoại"
                  data-testid="branch-search-input"
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setPage(1);
                    }}
                    aria-label="Xóa từ khóa tìm kiếm"
                    title="Xóa từ khóa tìm kiếm"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Branch List or Empty State */}
          {total === 0 ? (
            <div
              className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs space-y-4"
              data-testid="branch-empty-state"
            >
              <div className="w-16 h-16 rounded-2xl bg-orange-50 text-orange-600 mx-auto flex items-center justify-center">
                <Building2 className="w-8 h-8" />
              </div>
              <div className="max-w-md mx-auto">
                <h3 className="text-sm font-bold text-slate-900">
                  {searchQuery || statusFilter !== 'ALL'
                    ? 'Không tìm thấy chi nhánh phù hợp'
                    : 'Chưa có chi nhánh nào được thiết lập'}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {searchQuery || statusFilter !== 'ALL'
                    ? 'Thử thay đổi bộ lọc trạng thái hoặc từ khóa tìm kiếm để tìm chi nhánh cần thiết.'
                    : 'Tạo chi nhánh đầu tiên để thiết lập điểm lấy hàng, kho lưu trữ và giới hạn quyền vận hành.'}
                </p>
              </div>
              {canEdit && (
                <div>
                  <button
                    type="button"
                    onClick={handleOpenCreate}
                    data-testid="empty-create-branch-button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span data-testid="empty-create-branch-btn">Tạo chi nhánh đầu tiên</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6" data-testid="branch-grid-container">
              <div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
                data-testid="branch-list-grid"
              >
                {pagedBranches.map((branch) => {
                  const isDefault = branch.is_default;
                  const isActive = branch.status === 'ACTIVE';
                  const isOperating = actionLoadingId === branch.id;

                  return (
                    <div
                      key={branch.id}
                      data-testid={`branch-item-${branch.id}`}
                      className={`bg-white border rounded-2xl p-5 shadow-xs transition flex flex-col justify-between ${
                        isDefault
                          ? 'border-orange-300 ring-1 ring-orange-400/30'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Card Header: Badges & Code */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-md">
                            {branch.code}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isDefault && (
                              <span
                                data-testid={`default-badge-${branch.id}`}
                                className="inline-flex items-center gap-1 text-[11px] font-bold bg-orange-100 text-orange-800 border border-orange-200 px-2 py-0.5 rounded-md"
                              >
                                <Star className="w-3 h-3 fill-orange-500 text-orange-500" />
                                Mặc định
                              </span>
                            )}
                            <span
                              data-testid={`status-badge-${branch.id}`}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                isActive
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 text-slate-600 border-slate-200'
                              }`}
                            >
                              {isActive ? 'Đang hoạt động' : 'Tạm ngưng'}
                            </span>
                          </div>
                        </div>

                        {/* Title and Address */}
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-bold text-slate-900">{branch.name}</h3>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(branch)}
                                data-testid={`edit-branch-button-${branch.id}`}
                                className="p-1.5 text-slate-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition cursor-pointer"
                                title="Chỉnh sửa chi nhánh"
                                aria-label={`Chỉnh sửa chi nhánh ${branch.name}`}
                              >
                                <Edit3 className="w-4 h-4" />
                                <span
                                  className="sr-only"
                                  data-testid={`edit-branch-btn-${branch.id}`}
                                >
                                  Chỉnh sửa
                                </span>
                              </button>
                            )}
                          </div>

                          <div className="space-y-1.5 mt-2.5">
                            <div className="flex items-start gap-2 text-xs text-slate-600">
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-2">
                                {branch.address || (
                                  <span className="text-slate-400 italic">Chưa có địa chỉ</span>
                                )}
                              </span>
                            </div>

                            {branch.phone && (
                              <div className="flex items-center gap-2 text-xs text-slate-600">
                                <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{branch.phone}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer Actions */}
                      {canEdit && (
                        <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 mt-4">
                          <div>
                            {!isDefault && (
                              <button
                                type="button"
                                onClick={() => handleSetDefault(branch)}
                                data-testid={`set-default-button-${branch.id}`}
                                aria-label={`Đặt chi nhánh ${branch.name} làm mặc định`}
                                disabled={isOperating}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-lg transition cursor-pointer disabled:opacity-50"
                              >
                                <Star className="w-3.5 h-3.5" />
                                <span>Đặt làm mặc định</span>
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(branch)}
                              data-testid={
                                isActive
                                  ? `deactivate-branch-button-${branch.id}`
                                  : `activate-branch-button-${branch.id}`
                              }
                              disabled={isOperating || (isActive && isDefault)}
                              title={
                                isActive && isDefault
                                  ? 'Chi nhánh mặc định không thể tạm ngưng hoạt động'
                                  : isActive
                                    ? 'Tạm ngưng hoạt động'
                                    : 'Kích hoạt lại'
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                                isActive
                                  ? 'text-slate-600 hover:text-rose-700 hover:bg-rose-50'
                                  : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                              }`}
                            >
                              <Power className="w-3.5 h-3.5" />
                              <span>{isActive ? 'Tạm ngưng' : 'Kích hoạt lại'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination Controls */}
              <PaginationControls
                page={safePage}
                pageSize={pageSize}
                total={total}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
                onPageSizeChange={(s) => {
                  setPageSize(s);
                  setPage(1);
                }}
                pageSizeOptions={[2, 4, 10, 20]}
                testIdPrefix="branch-pagination"
              />
            </div>
          )}
        </>
      )}

      {/* Create / Edit Branch Modal Dialog */}
      {isFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
          data-testid="branch-form-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3
                    id="modal-title"
                    data-testid="modal-title"
                    className="text-sm font-bold text-slate-900"
                  >
                    {editingBranch ? 'Chỉnh sửa thông tin chi nhánh' : 'Thêm chi nhánh mới'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingBranch
                      ? `Cập nhật thông tin chi nhánh ${editingBranch.name}`
                      : 'Thiết lập địa điểm kho bãi hoặc điểm bán hàng trực tiếp'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseForm}
                data-testid="close-branch-modal"
                aria-label="Đóng biểu mẫu"
                title="Đóng biểu mẫu"
                disabled={submitting}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div
                className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2 text-rose-800 text-xs font-medium"
                data-testid="modal-error-banner"
              >
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-4" data-testid="branch-form">
              {/* Branch Name */}
              <div>
                <label
                  htmlFor="input-branch-name"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Tên chi nhánh <span className="text-rose-500">*</span>
                </label>
                <input
                  id="input-branch-name"
                  type="text"
                  value={formState.name}
                  onChange={(e) => handleFormFieldChange('name', e.target.value)}
                  placeholder="Ví dụ: Chi nhánh Quận 3, Kho Tân Bình..."
                  data-testid="input-branch-name"
                  className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                    validationErrors.name ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {validationErrors.name && (
                  <p
                    className="text-[11px] font-semibold text-rose-600 mt-1"
                    data-testid="error-branch-name"
                  >
                    {validationErrors.name}
                  </p>
                )}
              </div>

              {/* Code & Phone (2 cols) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="input-branch-code"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Mã chi nhánh <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="input-branch-code"
                    type="text"
                    value={formState.code}
                    onChange={(e) => handleFormFieldChange('code', e.target.value)}
                    placeholder="VD: HCM-Q3, HN-KHO-01"
                    data-testid="input-branch-code"
                    className={`w-full px-3 py-2 text-xs font-mono uppercase bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                      validationErrors.code ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {validationErrors.code && (
                    <p
                      className="text-[11px] font-semibold text-rose-600 mt-1"
                      data-testid="error-branch-code"
                    >
                      {validationErrors.code}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="input-branch-phone"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Số điện thoại liên hệ
                  </label>
                  <input
                    id="input-branch-phone"
                    type="tel"
                    value={formState.phone}
                    onChange={(e) => handleFormFieldChange('phone', e.target.value)}
                    placeholder="VD: 0901234567"
                    data-testid="input-branch-phone"
                    className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                      validationErrors.phone ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                    }`}
                  />
                  {validationErrors.phone && (
                    <p
                      className="text-[11px] font-semibold text-rose-600 mt-1"
                      data-testid="error-branch-phone"
                    >
                      {validationErrors.phone}
                    </p>
                  )}
                </div>
              </div>

              {/* Address */}
              <div>
                <label
                  htmlFor="input-branch-address"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Địa chỉ chi nhánh / kho
                </label>
                <textarea
                  id="input-branch-address"
                  rows={2}
                  value={formState.address}
                  onChange={(e) => handleFormFieldChange('address', e.target.value)}
                  placeholder="Địa chỉ số nhà, đường, phường, quận, tỉnh thành..."
                  data-testid="input-branch-address"
                  className={`w-full px-3 py-2 text-xs bg-white border rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition ${
                    validationErrors.address ? 'border-rose-400 bg-rose-50/20' : 'border-slate-300'
                  }`}
                />
                {validationErrors.address && (
                  <p
                    className="text-[11px] font-semibold text-rose-600 mt-1"
                    data-testid="error-branch-address"
                  >
                    {validationErrors.address}
                  </p>
                )}
              </div>

              {/* Options: Default & Status */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <label
                  htmlFor="input-branch-default"
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <input
                    id="input-branch-default"
                    type="checkbox"
                    checked={formState.is_default}
                    onChange={(e) => handleFormFieldChange('is_default', e.target.checked)}
                    data-testid="input-branch-default"
                    className="w-4 h-4 rounded-sm border-slate-300 text-orange-600 focus:ring-orange-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800">
                      Đặt làm chi nhánh mặc định
                    </span>
                    <p className="text-[10px] text-slate-500">
                      Chi nhánh mặc định sẽ được chọn tự động khi tạo đơn hàng mới nếu không chỉ
                      định.
                    </p>
                  </div>
                </label>

                <div>
                  <label
                    htmlFor="input-branch-status"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Trạng thái hoạt động
                  </label>
                  <select
                    id="input-branch-status"
                    value={formState.status}
                    onChange={(e) =>
                      handleFormFieldChange('status', e.target.value as 'ACTIVE' | 'INACTIVE')
                    }
                    data-testid="input-branch-status"
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition"
                  >
                    <option value="ACTIVE">Đang hoạt động (ACTIVE)</option>
                    <option value="INACTIVE">Tạm ngưng (INACTIVE)</option>
                  </select>
                </div>
              </div>

              {/* Form Action Buttons */}
              <div className="pt-4 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  data-testid="cancel-branch-button"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer disabled:opacity-50"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  data-testid="submit-branch-button"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>{editingBranch ? 'Lưu thay đổi' : 'Tạo chi nhánh'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
