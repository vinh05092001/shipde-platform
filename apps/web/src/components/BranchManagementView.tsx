'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Store,
  Plus,
  Edit3,
  MapPin,
  Phone,
  User,
  Package,
  Search,
  RefreshCw,
  FilterX,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';
import {
  PaginationControls,
  SortableColumnHeader,
  ListLoadingSkeleton,
  ListErrorBanner,
  ListForbiddenCallout,
  ListEmptyOrNoResults,
} from './common/SharedListControls';
import { useSharedListState, paginateInMemory } from '@/hooks/useSharedListState';

export interface BranchItem {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  manager: string;
  active_orders_count: number;
  status: 'ACTIVE' | 'INACTIVE';
  is_default?: boolean;
  created_at?: string;
}

export const DEFAULT_BRANCHES: BranchItem[] = [
  {
    id: 'store_01',
    code: 'HCM-Q3',
    name: 'Chi Nhánh Quận 3 (Trụ Sở Chính)',
    address: '128 Nguyễn Trãi, P.3, Q.5, TP. Hồ Chí Minh',
    phone: '0901234567',
    manager: 'Nguyễn Văn An',
    active_orders_count: 1420,
    status: 'ACTIVE',
    is_default: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'store_02',
    code: 'HCM-TB',
    name: 'Kho Vận & Cửa Hàng Tân Bình',
    address: '123 Cộng Hòa, P.12, Q. Tân Bình, TP. Hồ Chí Minh',
    phone: '0909876543',
    manager: 'Phạm Văn Kho',
    active_orders_count: 890,
    status: 'ACTIVE',
    is_default: false,
    created_at: '2026-01-10T00:00:00Z',
  },
  {
    id: 'store_03',
    code: 'HN-CG',
    name: 'Chi Nhánh Hà Nội (Cầu Giấy)',
    address: '45 Trần Thái Tông, Cầu Giấy, Hà Nội',
    phone: '0903334444',
    manager: 'Lê Minh Kế Toán',
    active_orders_count: 650,
    status: 'ACTIVE',
    is_default: false,
    created_at: '2026-01-15T00:00:00Z',
  },
  {
    id: 'store_04',
    code: 'DN-HC',
    name: 'Chi Nhánh Đà Nẵng (Hải Châu)',
    address: '88 Nguyễn Văn Linh, Hải Châu, Đà Nẵng',
    phone: '0905556666',
    manager: 'Trần Thị Hoa',
    active_orders_count: 320,
    status: 'ACTIVE',
    is_default: false,
    created_at: '2026-02-01T00:00:00Z',
  },
];

export interface BranchManagementViewProps {
  branches?: BranchItem[];
  loading?: boolean;
  canEdit?: boolean;
  isForbidden?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onEdit?: (branch: BranchItem) => void;
  onCreate?: () => void;
  initialPage?: number;
  initialPageSize?: number;
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
  initialSearch?: string;
  initialStatusFilter?: 'ALL' | 'ACTIVE' | 'INACTIVE';
}

export function BranchManagementView({
  branches = DEFAULT_BRANCHES,
  loading = false,
  canEdit = false,
  isForbidden = false,
  error = null,
  onRefresh,
  onEdit,
  onCreate,
  initialPage = 1,
  initialPageSize = 10,
  initialSortBy = 'name',
  initialSortOrder = 'asc',
  initialSearch = '',
  initialStatusFilter = 'ALL',
}: BranchManagementViewProps) {
  const listState = useSharedListState({
    defaultPage: initialPage,
    defaultPageSize: initialPageSize,
    defaultSortBy: initialSortBy,
    defaultSortOrder: initialSortOrder,
    defaultSearch: initialSearch,
    defaultFilters: {
      status: initialStatusFilter,
    },
    syncUrl: true,
  });

  const {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    filters,
    hasActiveFilters,
    setPage,
    setPageSize,
    setSort,
    setSearch,
    setFilter,
    resetFilters,
  } = listState;

  // Filter and sort in-memory
  const paginationResult = useMemo(() => {
    return paginateInMemory<BranchItem>({
      items: branches,
      page,
      pageSize,
      filterFn: (b) => {
        if (filters.status !== 'ALL' && b.status !== filters.status) {
          return false;
        }
        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const matchName = b.name.toLowerCase().includes(q);
          const matchCode = b.code.toLowerCase().includes(q);
          const matchAddress = b.address.toLowerCase().includes(q);
          const matchManager = b.manager.toLowerCase().includes(q);
          const matchPhone = b.phone.includes(q);
          return matchName || matchCode || matchAddress || matchManager || matchPhone;
        }
        return true;
      },
      sortFn: (a, b) => {
        let cmp = 0;
        if (sortBy === 'name') {
          cmp = a.name.localeCompare(b.name, 'vi');
        } else if (sortBy === 'code') {
          cmp = a.code.localeCompare(b.code, 'vi');
        } else if (sortBy === 'active_orders_count') {
          cmp = a.active_orders_count - b.active_orders_count;
        } else if (sortBy === 'created_at') {
          cmp = (a.created_at || '').localeCompare(b.created_at || '');
        } else {
          cmp = a.name.localeCompare(b.name, 'vi');
        }
        // Unique tie breaker by id
        if (cmp === 0) {
          cmp = a.id.localeCompare(b.id);
        }
        return sortOrder === 'asc' ? cmp : -cmp;
      },
    });
  }, [branches, page, pageSize, filters.status, search, sortBy, sortOrder]);

  const { pagedItems, total, totalPages } = paginationResult;

  if (isForbidden) {
    return (
      <div className="space-y-4" data-testid="branch-forbidden-banner">
        <ListForbiddenCallout
          message="403 — Không Có Quyền Quản Lý Chi Nhánh"
          explanation="Bạn không có quyền xem hoặc thao tác cấu hình chi nhánh cửa hàng. Vui lòng liên hệ Chủ Shop (quyền iam:shop_config)."
          testId="branch-forbidden-callout"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Header & Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Store className="w-5 h-5 text-blue-600" />
            <span>Quản Lý Cửa Hàng / Chi Nhánh</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Phân định điểm bán hàng, quản lý kho chi nhánh và gán nhân sự phụ trách.
          </p>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={onCreate}
            className="btn-primary text-xs flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
            data-testid="create-branch-btn"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm Chi Nhánh</span>
          </button>
        )}
      </div>

      {/* Filter & Search Bar */}
      <div className="modern-card p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên, mã chi nhánh, quản lý, SĐT..."
                className="modern-input pl-9 text-xs w-full py-1.5"
                data-testid="branch-search-input"
              />
            </div>

            {/* Status Filter */}
            <select
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value as any)}
              className="modern-input text-xs py-1.5 font-medium"
              data-testid="branch-status-filter"
              aria-label="Lọc theo trạng thái chi nhánh"
            >
              <option value="ALL">Tất cả trạng thái</option>
              <option value="ACTIVE">Đang hoạt động (ACTIVE)</option>
              <option value="INACTIVE">Tạm ngưng (INACTIVE)</option>
            </select>

            {/* Sort Select */}
            <select
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [f, o] = e.target.value.split('-');
                setSort(f);
                if (o !== sortOrder) setSort(f);
              }}
              className="modern-input text-xs py-1.5 font-medium"
              data-testid="branch-sort-select"
              aria-label="Sắp xếp chi nhánh"
            >
              <option value="name-asc">Tên (A-Z)</option>
              <option value="name-desc">Tên (Z-A)</option>
              <option value="code-asc">Mã chi nhánh (A-Z)</option>
              <option value="active_orders_count-desc">Đơn hoạt động (Nhiều nhất)</option>
              <option value="active_orders_count-asc">Đơn hoạt động (Ít nhất)</option>
            </select>

            {/* Clear Filters */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 cursor-pointer"
                data-testid="branch-clear-filters-btn"
              >
                <FilterX className="w-3.5 h-3.5" />
                <span>Xóa lọc</span>
              </button>
            )}

            {/* Refresh */}
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={loading}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer"
                data-testid="branch-refresh-btn"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span>Làm mới</span>
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Tổng:{' '}
            <strong className="text-slate-900" data-testid="branch-count">
              {branches.length}
            </strong>{' '}
            chi nhánh
          </div>
        </div>
      </div>

      {/* Error Alert */}
      <ListErrorBanner
        error={error}
        onRetry={onRefresh}
        retryLabel="Thử lại"
        testId="branch-error-banner"
      />

      {/* Loading Skeleton */}
      {loading ? (
        <ListLoadingSkeleton rows={4} testId="branch-loading-skeleton" />
      ) : total === 0 ? (
        /* Empty or No-Results State */
        <ListEmptyOrNoResults
          total={total}
          hasActiveFilters={hasActiveFilters}
          emptyTitle="Chưa có chi nhánh nào"
          emptyDescription="Hãy tạo chi nhánh đầu tiên để thiết lập điểm bán hàng và kiểm soát luồng vận đơn."
          emptyIcon={<Store className="w-6 h-6 text-slate-400" />}
          emptyTestId="branch-empty-state"
          noResultsTitle="Không tìm thấy chi nhánh phù hợp với bộ lọc"
          noResultsDescription="Hãy thử thay đổi từ khóa tìm kiếm hoặc điều chỉnh điều kiện lọc trạng thái."
          noResultsTestId="branch-no-results-state"
          onClearFilters={resetFilters}
          emptyAction={
            canEdit ? (
              <button
                type="button"
                onClick={onCreate}
                className="btn-primary text-xs flex items-center gap-1.5 mx-auto cursor-pointer"
                data-testid="empty-create-branch-btn"
              >
                <Plus className="w-4 h-4" />
                <span>Tạo chi nhánh đầu tiên</span>
              </button>
            ) : null
          }
        />
      ) : (
        /* Populated Grid / Cards */
        <div className="space-y-4">
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
            data-testid="branch-grid-container"
          >
            {pagedItems.map((store) => (
              <div
                key={store.id}
                data-testid={`branch-card-${store.id}`}
                className="modern-card p-5 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {store.code}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        store.status === 'ACTIVE'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                      data-testid={`branch-status-badge-${store.id}`}
                    >
                      {store.status === 'ACTIVE' ? 'Đang hoạt động' : 'Tạm ngưng'}
                    </span>
                  </div>

                  <h4 className="font-bold text-slate-900 text-sm">{store.name}</h4>

                  <div className="space-y-1 text-xs text-slate-500">
                    <p className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{store.address}</span>
                    </p>
                    <p className="flex items-center gap-1.5 font-mono text-[11px]">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>Hotline: {store.phone}</span>
                    </p>
                    <p className="flex items-center gap-1.5 text-slate-600">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        Quản lý: <strong>{store.manager}</strong>
                      </span>
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                  <div className="flex items-center gap-1 text-slate-500">
                    <Package className="w-3.5 h-3.5 text-slate-400" />
                    <span>Đơn active:</span>
                    <strong className="font-mono text-slate-900 font-bold ml-1">
                      {store.active_orders_count.toLocaleString()} đơn
                    </strong>
                  </div>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onEdit?.(store)}
                      className="btn-secondary text-[11px] py-1 px-2.5 flex items-center gap-1 cursor-pointer"
                      data-testid={`edit-branch-btn-${store.id}`}
                    >
                      <Edit3 className="w-3 h-3" />
                      <span>Sửa</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[4, 8, 12, 20]}
            testIdPrefix="branch-pagination"
          />
        </div>
      )}
    </div>
  );
}
