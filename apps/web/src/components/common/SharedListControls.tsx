'use client';

import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Search,
  FilterX,
  AlertCircle,
  ShieldAlert,
} from 'lucide-react';

export interface PaginationControlsProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newPageSize: number) => void;
  pageSizeOptions?: readonly number[];
  testIdPrefix?: string;
}

export function PaginationControls({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  testIdPrefix = 'pagination',
}: PaginationControlsProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const safePage = Math.min(Math.max(1, page), safeTotalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div
      className="flex flex-col sm:flex-row items-center justify-between gap-3 py-3 px-4 bg-white border-t border-slate-200 text-xs text-slate-600 rounded-b-xl"
      data-testid={`${testIdPrefix}-controls`}
    >
      <div className="flex items-center gap-3" data-testid={`${testIdPrefix}-info`}>
        <span>
          Hiển thị <strong className="font-semibold text-slate-900">{from}</strong> –{' '}
          <strong className="font-semibold text-slate-900">{to}</strong> trong{' '}
          <strong className="font-semibold text-slate-900" data-testid={`${testIdPrefix}-total`}>
            {total}
          </strong>{' '}
          bản ghi
        </span>

        {onPageSizeChange && (
          <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 pl-3">
            <span>Mỗi trang:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="py-1 px-2 border border-slate-200 rounded text-xs bg-white text-slate-700 font-medium cursor-pointer"
              aria-label="Số bản ghi mỗi trang"
              data-testid={`${testIdPrefix}-page-size`}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="text-xs text-slate-500 font-medium px-2"
          data-testid={`${testIdPrefix}-page-indicator`}
        >
          Trang {safePage} / {safeTotalPages}
        </span>

        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition font-medium cursor-pointer"
          aria-label="Trang trước"
          data-testid={`${testIdPrefix}-prev-btn`}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          <span>Trước</span>
        </button>

        <button
          type="button"
          disabled={safePage >= safeTotalPages}
          onClick={() => onPageChange(safePage + 1)}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition font-medium cursor-pointer"
          aria-label="Trang sau"
          data-testid={`${testIdPrefix}-next-btn`}
        >
          <span>Sau</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export interface SortableColumnHeaderProps {
  label: string;
  field: string;
  currentSort: string;
  currentDirection: 'asc' | 'desc';
  onSort: (field: string) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
  testId?: string;
}

export function SortableColumnHeader({
  label,
  field,
  currentSort,
  currentDirection,
  onSort,
  className = '',
  align = 'left',
  testId,
}: SortableColumnHeaderProps) {
  const isSorted = currentSort === field;
  const sortDirectionText = isSorted
    ? currentDirection === 'asc'
      ? 'tăng dần'
      : 'giảm dần'
    : 'chưa sắp xếp';

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-slate-600 hover:text-slate-900 transition cursor-pointer select-none ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      } ${className}`}
      aria-label={`Sắp xếp theo ${label} (${sortDirectionText})`}
      data-testid={testId || `sort-header-${field}`}
    >
      <span>{label}</span>
      {isSorted ? (
        currentDirection === 'asc' ? (
          <ChevronUp className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3 text-slate-300 hover:text-slate-500 shrink-0" />
      )}
    </button>
  );
}

export interface ListEmptyOrNoResultsProps {
  total: number;
  hasActiveFilters: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  noResultsTitle?: string;
  noResultsDescription?: string;
  onClearFilters?: () => void;
  emptyTestId?: string;
  noResultsTestId?: string;
}

export function ListEmptyOrNoResults({
  total,
  hasActiveFilters,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptyIcon,
  noResultsTitle = 'Không tìm thấy kết quả phù hợp với bộ lọc',
  noResultsDescription = 'Hãy thử điều chỉnh từ khóa tìm kiếm hoặc bỏ các tiêu chí lọc.',
  onClearFilters,
  emptyTestId = 'list-empty-state',
  noResultsTestId = 'list-no-results-state',
}: ListEmptyOrNoResultsProps) {
  if (total > 0) return null;

  if (hasActiveFilters) {
    return (
      <div
        className="modern-card p-12 text-center space-y-4 my-2 border border-dashed border-slate-300"
        data-testid={noResultsTestId}
      >
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
          <Search className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-slate-900">{noResultsTitle}</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">{noResultsDescription}</p>
        </div>
        {onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition cursor-pointer"
            data-testid="clear-filters-btn"
          >
            <FilterX className="w-3.5 h-3.5" />
            <span>Xóa bộ lọc</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="modern-card p-12 text-center space-y-4 my-2 border border-dashed border-slate-300"
      data-testid={emptyTestId}
    >
      {emptyIcon && (
        <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
          {emptyIcon}
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-bold text-slate-900">{emptyTitle}</h3>
        {emptyDescription && (
          <p className="text-xs text-slate-500 max-w-md mx-auto">{emptyDescription}</p>
        )}
      </div>
      {emptyAction && <div className="pt-2">{emptyAction}</div>}
    </div>
  );
}

export function ListLoadingSkeleton({
  rows = 4,
  testId = 'list-loading-skeleton',
}: {
  rows?: number;
  testId?: string;
}) {
  return (
    <div className="modern-card p-6 space-y-3" data-testid={testId}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-slate-100 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

export function ListErrorBanner({
  error,
  onRetry,
  retryLabel = 'Thử lại',
  testId = 'list-error-banner',
}: {
  error: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  testId?: string;
}) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl text-xs flex items-center justify-between"
      data-testid={testId}
    >
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
        <span>{error}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary text-xs py-1 px-3 bg-white hover:bg-slate-50 cursor-pointer"
          data-testid={`${testId}-retry-btn`}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function ListForbiddenCallout({
  message = '403 — Không Có Quyền Truy Cập',
  explanation = 'Bạn không có quyền truy cập tính năng này. Vui lòng liên hệ Chủ Shop để được cấp quyền.',
  testId = 'list-forbidden-state',
}: {
  message?: string;
  explanation?: string;
  testId?: string;
}) {
  return (
    <div
      className="p-6 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-center"
      data-testid={testId}
    >
      <div className="flex items-center justify-center gap-2 text-amber-800 font-bold text-sm">
        <ShieldAlert className="w-5 h-5 text-amber-600" />
        <span>{message}</span>
      </div>
      <p className="text-xs text-amber-700 max-w-md mx-auto">{explanation}</p>
    </div>
  );
}
