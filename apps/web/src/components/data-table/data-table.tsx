'use client';

/**
 * Reusable Server-Driven Data Table Components
 *
 * Adapted from sadmann7/shadcn-table (https://github.com/sadmann7/shadcn-table)
 * License: MIT License
 * Copyright (c) 2023 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  EyeOff,
  Filter,
  Inbox,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  DEFAULT_PAGE_SIZES,
  useDataTable,
  type DataTableColumnDef,
  type DataTableDensity,
  type DataTableFilterField,
  type DataTableOption,
  type DataTableSearchParamsInput,
  type DataTableSortState,
} from './use-data-table';

// ============================================================================
// 1. DataTableColumnHeader
// ============================================================================
export interface DataTableColumnHeaderProps {
  columnId: string;
  title: string;
  enableSorting?: boolean;
  enableHiding?: boolean;
  currentSort: DataTableSortState | null;
  onSort: (columnId: string, desc?: boolean) => void;
  onHide?: (columnId: string) => void;
  align?: 'left' | 'center' | 'right';
}

export function DataTableColumnHeader({
  columnId,
  title,
  enableSorting = true,
  enableHiding = false,
  currentSort,
  onSort,
  onHide,
  align = 'left',
}: DataTableColumnHeaderProps) {
  const isSorted = currentSort?.id === columnId;
  const isDesc = isSorted && currentSort?.desc;

  if (!enableSorting) {
    return (
      <span
        className={`inline-flex items-center font-semibold text-xs uppercase tracking-wider text-[#3b4352] ${
          align === 'right'
            ? 'justify-end w-full'
            : align === 'center'
              ? 'justify-center w-full'
              : ''
        }`}
      >
        {title}
      </span>
    );
  }

  const nextDirectionLabel = !isSorted
    ? 'Sắp xếp tăng dần'
    : !isDesc
      ? 'Sắp xếp giảm dần'
      : 'Bỏ sắp xếp';

  return (
    <div
      className={`inline-flex items-center gap-1 ${
        align === 'right' ? 'justify-end w-full' : align === 'center' ? 'justify-center w-full' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(columnId)}
        aria-label={`${title}: ${nextDirectionLabel}`}
        data-testid={`data-table-sort-${columnId}`}
        className="inline-flex items-center gap-1.5 px-2 py-1 -mx-2 rounded-md text-xs font-semibold uppercase tracking-wider text-[#3b4352] hover:text-[#0c1421] hover:bg-[#f2f0ec] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
      >
        <span>{title}</span>
        {isSorted ? (
          isDesc ? (
            <ArrowDown className="w-3.5 h-3.5 text-[#c23807]" />
          ) : (
            <ArrowUp className="w-3.5 h-3.5 text-[#c23807]" />
          )
        ) : (
          <ArrowUpDown className="w-3.5 h-3.5 text-[#9da6b8]" />
        )}
      </button>
      {enableHiding && onHide && (
        <button
          type="button"
          onClick={() => onHide(columnId)}
          aria-label={`Ẩn cột ${title}`}
          title={`Ẩn cột ${title}`}
          className="p-1 rounded text-[#9da6b8] hover:text-[#3b4352] hover:bg-[#f2f0ec] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
        >
          <EyeOff className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// 2. DataTableFacetedFilter
// ============================================================================
export interface DataTableFacetedFilterProps {
  columnId: string;
  title: string;
  options: DataTableOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
}

export function DataTableFacetedFilter({
  columnId,
  title,
  options,
  selectedValues,
  onChange,
}: DataTableFacetedFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const selectedSet = React.useMemo(() => new Set(selectedValues), [selectedValues]);

  const filteredOptions = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );
  }, [options, searchQuery]);

  const handleToggleOption = (val: string) => {
    const next = new Set(selectedSet);
    if (next.has(val)) {
      next.delete(val);
    } else {
      next.add(val);
    }
    onChange(Array.from(next));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      e.stopPropagation();
      setIsOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="relative inline-block" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Bộ lọc đa chiều: ${title}`}
        data-testid={`data-table-facet-${columnId}`}
        className="inline-flex items-center gap-2 min-h-[36px] px-3 py-1.5 rounded-lg border border-dashed border-[#d5d1cb] bg-white hover:bg-[#f6f5f3] text-xs font-semibold text-[#0c1421] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
      >
        <Filter className="w-3.5 h-3.5 text-[#697386]" />
        <span>{title}</span>
        {selectedSet.size > 0 && (
          <span className="inline-flex items-center gap-1 pl-2 border-l border-[#eae7e4]">
            {selectedSet.size > 2 ? (
              <span className="px-1.5 py-0.5 rounded bg-[#fff5f0] text-[#c23807] font-bold text-[11px]">
                Đã chọn {selectedSet.size}
              </span>
            ) : (
              options
                .filter((opt) => selectedSet.has(opt.value))
                .map((opt) => (
                  <span
                    key={opt.value}
                    className="px-1.5 py-0.5 rounded bg-[#fff5f0] text-[#c23807] font-bold text-[11px]"
                  >
                    {opt.label}
                  </span>
                ))
            )}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={`Tùy chọn lọc ${title}`}
          data-testid={`data-table-facet-popover-${columnId}`}
          className="absolute left-0 mt-1.5 w-64 rounded-xl bg-white border border-[#eae7e4] shadow-lg z-30 p-2 space-y-2"
        >
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#697386] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Tìm trong ${title}...`}
              aria-label={`Tìm tùy chọn trong ${title}`}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#eae7e4] focus:outline-none focus:border-[#c23807]"
            />
          </div>

          <ul
            role="listbox"
            aria-multiselectable="true"
            aria-label={`Danh sách giá trị ${title}`}
            className="max-h-48 overflow-y-auto space-y-1 py-1"
          >
            {filteredOptions.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-[#697386]">
                Không tìm thấy tùy chọn phù hợp.
              </li>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedSet.has(opt.value);
                const IconComp = opt.icon;
                return (
                  <li key={opt.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => handleToggleOption(opt.value)}
                      data-testid={`data-table-facet-option-${columnId}-${opt.value}`}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#fff5f0] text-[#c23807] font-semibold'
                          : 'text-[#0c1421] hover:bg-[#f6f5f3]'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center ${
                            isSelected
                              ? 'bg-[#c23807] border-[#c23807] text-white'
                              : 'border-[#d5d1cb] bg-white'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3" />}
                        </span>
                        {IconComp && <IconComp className="w-3.5 h-3.5 text-[#697386]" />}
                        <span>{opt.label}</span>
                      </span>
                      {typeof opt.count === 'number' && (
                        <span className="font-mono text-[11px] text-[#697386] tabular-nums">
                          {opt.count}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {selectedSet.size > 0 && (
            <div className="pt-1 border-t border-[#eae7e4]">
              <button
                type="button"
                onClick={() => onChange([])}
                data-testid={`data-table-facet-clear-${columnId}`}
                className="w-full py-1.5 text-center text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2] rounded-lg transition cursor-pointer"
              >
                Xóa lọc {title}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 3. DataTableViewOptions
// ============================================================================
export interface DataTableViewOptionsProps<TData> {
  columns: DataTableColumnDef<TData>[];
  columnVisibility: Record<string, boolean>;
  onToggleColumn: (columnId: string) => void;
  density: DataTableDensity;
  onChangeDensity: (density: DataTableDensity) => void;
}

export function DataTableViewOptions<TData>({
  columns,
  columnVisibility,
  onToggleColumn,
  density,
  onChangeDensity,
}: DataTableViewOptionsProps<TData>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const hideableColumns = columns.filter((col) => col.enableHiding !== false);

  return (
    <div
      className="relative inline-flex items-center gap-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && isOpen) {
          e.stopPropagation();
          setIsOpen(false);
        }
      }}
    >
      <div
        role="group"
        aria-label="Mật độ hiển thị dòng"
        className="inline-flex items-center rounded-lg border border-[#eae7e4] bg-[#f6f5f3] p-0.5"
      >
        <button
          type="button"
          onClick={() => onChangeDensity('compact')}
          aria-pressed={density === 'compact'}
          data-testid="data-table-density-compact"
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
            density === 'compact'
              ? 'bg-white text-[#0c1421] shadow-2xs'
              : 'text-[#697386] hover:text-[#0c1421]'
          }`}
        >
          Thu gọn
        </button>
        <button
          type="button"
          onClick={() => onChangeDensity('comfortable')}
          aria-pressed={density === 'comfortable'}
          data-testid="data-table-density-comfortable"
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
            density === 'comfortable'
              ? 'bg-white text-[#0c1421] shadow-2xs'
              : 'text-[#697386] hover:text-[#0c1421]'
          }`}
        >
          Thoải mái
        </button>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        data-testid="data-table-view-options"
        className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] text-xs font-semibold text-[#0c1421] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
      >
        <SlidersHorizontal className="w-3.5 h-3.5 text-[#697386]" />
        <span>Hiển thị cột</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Tùy chọn hiển thị cột"
          className="absolute right-0 top-full mt-1.5 w-56 rounded-xl bg-white border border-[#eae7e4] shadow-lg z-30 p-2 space-y-1"
        >
          <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-[#697386] border-b border-[#eae7e4]">
            Bật / tắt cột dữ liệu
          </div>
          {hideableColumns.map((col) => {
            const isVisible = columnVisibility[col.id] !== false;
            return (
              <button
                key={col.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={isVisible}
                onClick={() => onToggleColumn(col.id)}
                data-testid={`data-table-toggle-col-${col.id}`}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#0c1421] hover:bg-[#f6f5f3] transition cursor-pointer"
              >
                <span>{col.header}</span>
                {isVisible && <Check className="w-3.5 h-3.5 text-[#c23807]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 4. DataTableToolbar
// ============================================================================
export interface DataTableToolbarProps<TData> {
  filterFields: DataTableFilterField<TData>[];
  textFilters: Record<string, string>;
  facetedFilters: Record<string, string[]>;
  isFiltered: boolean;
  onTextFilterChange: (columnId: string, value: string) => void;
  onFacetedFilterChange: (columnId: string, values: string[]) => void;
  onResetFilters: () => void;
  columns: DataTableColumnDef<TData>[];
  columnVisibility: Record<string, boolean>;
  onToggleColumn: (columnId: string) => void;
  density: DataTableDensity;
  onChangeDensity: (density: DataTableDensity) => void;
  toolbarActions?: React.ReactNode;
}

export function DataTableToolbar<TData>({
  filterFields,
  textFilters,
  facetedFilters,
  isFiltered,
  onTextFilterChange,
  onFacetedFilterChange,
  onResetFilters,
  columns,
  columnVisibility,
  onToggleColumn,
  density,
  onChangeDensity,
  toolbarActions,
}: DataTableToolbarProps<TData>) {
  const searchableFields = filterFields.filter((f) => !f.options || f.options.length === 0);
  const facetedFields = filterFields.filter((f) => f.options && f.options.length > 0);

  return (
    <div
      data-testid="data-table-toolbar"
      className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 bg-[#faf9f7] border-b border-[#eae7e4]"
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {searchableFields.map((field) => {
          const fieldId = String(field.id);
          const currentVal = textFilters[fieldId] || '';
          return (
            <div key={fieldId} className="relative min-w-[220px] max-w-xs flex-1">
              <label htmlFor={`dt-search-${fieldId}`} className="sr-only">
                {field.label}
              </label>
              <Search className="w-3.5 h-3.5 text-[#697386] absolute left-3 top-2.5 pointer-events-none" />
              <input
                id={`dt-search-${fieldId}`}
                type="search"
                value={currentVal}
                onChange={(e) => onTextFilterChange(fieldId, e.target.value)}
                placeholder={field.placeholder || `Lọc theo ${field.label.toLowerCase()}...`}
                aria-label={field.label}
                data-testid={`data-table-search-${fieldId}`}
                className="w-full min-h-[36px] pl-8 pr-7 py-1.5 rounded-lg border border-[#eae7e4] bg-white text-xs text-[#0c1421] focus:outline-none focus:border-[#c23807]"
              />
              {currentVal && (
                <button
                  type="button"
                  onClick={() => onTextFilterChange(fieldId, '')}
                  aria-label={`Xóa từ khóa ${field.label}`}
                  className="absolute right-2 top-2 text-[#697386] hover:text-[#0c1421] p-0.5 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {facetedFields.map((field) => {
          const fieldId = String(field.id);
          return (
            <DataTableFacetedFilter
              key={fieldId}
              columnId={fieldId}
              title={field.label}
              options={field.options || []}
              selectedValues={facetedFilters[fieldId] || []}
              onChange={(vals) => onFacetedFilterChange(fieldId, vals)}
            />
          );
        })}

        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
            data-testid="data-table-reset-filters"
            className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold text-[#b91c1c] bg-[#fef2f2] hover:bg-[#fee2e2] border border-[#fecaca] focus-visible:outline-2 focus-visible:outline-[#c23807] transition cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Xóa bộ lọc</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {toolbarActions}
        <DataTableViewOptions
          columns={columns}
          columnVisibility={columnVisibility}
          onToggleColumn={onToggleColumn}
          density={density}
          onChangeDensity={onChangeDensity}
        />
      </div>
    </div>
  );
}

// ============================================================================
// 5. DataTablePagination
// ============================================================================
export interface DataTablePaginationProps {
  page: number;
  perPage: number;
  pageCount: number;
  totalRows: number;
  selectedCount: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export function DataTablePagination({
  page,
  perPage,
  pageCount,
  totalRows,
  selectedCount,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  onPageChange,
  onPerPageChange,
}: DataTablePaginationProps) {
  const safePageCount = Math.max(1, pageCount);
  const canPrev = page > 1;
  const canNext = page < safePageCount;

  return (
    <div
      data-testid="data-table-pagination"
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 bg-[#faf9f7] border-t border-[#eae7e4] text-xs text-[#3b4352]"
    >
      <div className="flex items-center gap-3 tabular-nums">
        <span>
          Tổng số: <strong className="text-[#0c1421] font-bold">{totalRows}</strong> bản ghi
        </span>
        {selectedCount > 0 && (
          <span
            data-testid="data-table-selected-count"
            className="px-2 py-0.5 rounded-md bg-[#fff5f0] text-[#c23807] font-semibold border border-[#fdddd0]"
          >
            Đã chọn {selectedCount} dòng
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="dt-per-page-select" className="font-medium text-[#3b4352]">
            Số dòng mỗi trang
          </label>
          <select
            id="dt-per-page-select"
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            aria-label="Số dòng mỗi trang"
            data-testid="data-table-per-page-select"
            className="min-h-[32px] px-2.5 py-1 rounded-lg border border-[#eae7e4] bg-white text-xs font-semibold text-[#0c1421] focus:outline-none focus:border-[#c23807] tabular-nums"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size} dòng
              </option>
            ))}
          </select>
        </div>

        <div
          data-testid="data-table-page-indicator"
          className="font-semibold text-[#0c1421] tabular-nums"
        >
          Trang {page} / {safePageCount}
        </div>

        <div className="inline-flex items-center gap-1" role="group" aria-label="Điều hướng trang">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange(1)}
            aria-label="Trang đầu"
            title="Trang đầu"
            data-testid="data-table-page-first"
            className="p-1.5 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => onPageChange(page - 1)}
            aria-label="Trang trước"
            title="Trang trước"
            data-testid="data-table-page-prev"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Trước</span>
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onPageChange(page + 1)}
            aria-label="Trang sau"
            title="Trang sau"
            data-testid="data-table-page-next"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] disabled:opacity-40 disabled:cursor-not-allowed font-semibold transition cursor-pointer"
          >
            <span>Sau</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => onPageChange(safePageCount)}
            aria-label="Trang cuối"
            title="Trang cuối"
            data-testid="data-table-page-last"
            className="p-1.5 rounded-lg border border-[#eae7e4] bg-white hover:bg-[#f6f5f3] disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 6. ServerDataTable (Main Reusable Component)
// ============================================================================
export interface ServerDataTableProps<TData> {
  data: TData[];
  columns: DataTableColumnDef<TData>[];
  pageCount: number;
  totalRows?: number;
  filterFields?: DataTableFilterField<TData>[];
  defaultPerPage?: number;
  defaultSort?: DataTableSortState | null;
  defaultDensity?: DataTableDensity;
  getRowId?: (row: TData, index: number) => string;
  enableRowSelection?: boolean;
  onRowClick?: (row: TData) => void;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;
  toolbarActions?: React.ReactNode;
  caption?: string;
  // UI States per DESIGN-SYSTEM-UX-RULES.md & apps/web/AGENTS.md
  loading?: boolean;
  error?: string | null;
  forbidden?: boolean;
  forbiddenMessage?: string;
  validationMessage?: string | null;
  isPartial?: boolean;
  partialMessage?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  onRetry?: () => void;
  onForbiddenRecovery?: () => void;
  // SSR / Test / Controlled URL Search Params hooks
  initialSearchParams?: DataTableSearchParamsInput;
  pathname?: string;
  onUrlChange?: (nextUrl: string, nextParams: URLSearchParams) => void;
}

export function ServerDataTable<TData>({
  data,
  columns,
  pageCount,
  totalRows,
  filterFields = [],
  defaultPerPage = 10,
  defaultSort = null,
  defaultDensity = 'comfortable',
  getRowId,
  enableRowSelection = true,
  onRowClick,
  bulkActions,
  toolbarActions,
  caption = 'Bảng dữ liệu vận hành điều khiển từ máy chủ',
  loading = false,
  error = null,
  forbidden = false,
  forbiddenMessage = 'Tài khoản hiện tại không có quyền truy cập tập dữ liệu này. Vui lòng liên hệ Chủ shop hoặc Quản trị viên để cấp quyền.',
  validationMessage = null,
  isPartial = false,
  partialMessage,
  emptyTitle = 'Không tìm thấy bản ghi nào',
  emptyDescription = 'Chưa có dữ liệu hoặc không có bản ghi nào khớp với điều kiện lọc hiện tại.',
  emptyActionLabel,
  onEmptyAction,
  onRetry,
  onForbiddenRecovery,
  initialSearchParams,
  pathname,
  onUrlChange,
}: ServerDataTableProps<TData>) {
  const table = useDataTable({
    data,
    columns,
    pageCount,
    totalRows,
    filterFields,
    defaultPerPage,
    defaultSort,
    defaultDensity,
    getRowId,
    initialSearchParams,
    pathname,
    onUrlChange,
  });

  const rowRefs = React.useRef<Array<HTMLTableRowElement | null>>([]);
  const effectiveValidationError = validationMessage || table.validationError;
  const cellPadding = table.density === 'compact' ? 'px-3 py-2 text-xs' : 'px-4 py-3.5 text-sm';

  const selectedRows = React.useMemo(
    () => data.filter((row, idx) => table.selectedRowIds.has(table.resolveRowId(row, idx))),
    [data, table]
  );

  const handleRowKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    row: TData,
    rowId: string,
    rowIndex: number
  ) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = rowRefs.current[Math.min(data.length - 1, rowIndex + 1)];
      next?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = rowRefs.current[Math.max(0, rowIndex - 1)];
      prev?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      rowRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      rowRefs.current[data.length - 1]?.focus();
    } else if (e.key === 'Enter' && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    } else if (e.key === ' ' && enableRowSelection) {
      e.preventDefault();
      table.toggleRowSelection(rowId);
    }
  };

  return (
    <div
      data-testid="server-data-table"
      data-density={table.density}
      className="modern-card overflow-hidden flex flex-col"
    >
      {/* Live region for screen-reader async status announcements */}
      <div className="sr-only" aria-live="polite" role="status">
        {loading
          ? 'Đang tải dữ liệu bảng từ máy chủ...'
          : `Hiển thị ${data.length} trên tổng số ${table.totalRows} bản ghi, trang ${table.page} trên ${table.pageCount}.`}
      </div>

      {/* Filter & View Toolbar */}
      <DataTableToolbar
        filterFields={filterFields}
        textFilters={table.textFilters}
        facetedFilters={table.facetedFilters}
        isFiltered={table.isFiltered}
        onTextFilterChange={table.setTextFilter}
        onFacetedFilterChange={table.setFacetedFilter}
        onResetFilters={table.resetFilters}
        columns={columns}
        columnVisibility={table.columnVisibility}
        onToggleColumn={table.toggleColumnVisibility}
        density={table.density}
        onChangeDensity={table.setDensity}
        toolbarActions={toolbarActions}
      />

      {/* Validation Error Banner (URL Search Params / Schema Validation) */}
      {effectiveValidationError && (
        <div
          role="alert"
          data-testid="data-table-validation-state"
          className="px-4 py-3 bg-[#fffbeb] border-b border-[#fde68a] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#b45309]"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <div>
              <span className="font-bold">Lỗi tham số truy vấn: </span>
              <span>{effectiveValidationError}</span>
              <span className="ml-1 text-[#697386]">
                (Dữ liệu gốc không bị thay đổi; đã áp dụng giá trị mặc định an toàn.)
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={table.resetInvalidParams}
            data-testid="data-table-validation-reset"
            className="px-3 py-1.5 rounded-lg bg-white border border-[#fde68a] font-semibold text-[#b45309] hover:bg-[#fef3c7] transition cursor-pointer shrink-0"
          >
            Đặt lại tham số hợp lệ
          </button>
        </div>
      )}

      {/* Partial Data Warning Banner */}
      {isPartial && !loading && !error && !forbidden && (
        <div
          role="status"
          data-testid="data-table-partial-state"
          className="px-4 py-2.5 bg-[#fffbeb] border-b border-[#fde68a] flex items-center justify-between gap-2 text-xs text-[#b45309]"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              <strong>Chế độ hiển thị một phần: </strong>
              {partialMessage ||
                `Đang hiển thị ${data.length}/${table.totalRows} bản ghi trong phạm vi được cấp quyền hoặc giới hạn truy vấn.`}
            </span>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-2.5 py-1 rounded-md bg-white border border-[#fde68a] font-semibold text-[#b45309] hover:bg-[#fef3c7] transition cursor-pointer shrink-0"
            >
              Tải lại đầy đủ
            </button>
          )}
        </div>
      )}

      {/* Bulk Action Bar when rows are selected */}
      {enableRowSelection && selectedRows.length > 0 && !loading && !error && !forbidden && (
        <div
          role="region"
          aria-label="Thanh tác vụ hàng loạt"
          data-testid="data-table-bulk-bar"
          className="px-4 py-2.5 bg-[#fff5f0] border-b border-[#fdddd0] flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-2 text-[#0c1421]">
            <span className="font-bold text-[#c23807] tabular-nums">
              Đã chọn {selectedRows.length} bản ghi
            </span>
            <button
              type="button"
              onClick={table.clearSelection}
              data-testid="data-table-clear-selection"
              className="underline text-[#3b4352] hover:text-[#0c1421] font-medium cursor-pointer"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          <div className="flex items-center gap-2">
            {bulkActions ? bulkActions(selectedRows, table.clearSelection) : null}
          </div>
        </div>
      )}

      {/* Dedicated Forbidden (403) State */}
      {forbidden ? (
        <div
          role="alert"
          data-testid="data-table-forbidden-state"
          className="p-10 text-center flex flex-col items-center justify-center space-y-3 bg-[#fef2f2]/40"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="max-w-md space-y-1">
            <h3 className="text-sm font-bold text-[#0c1421]">Quyền truy cập bị từ chối (403)</h3>
            <p className="text-xs text-[#3b4352]">{forbiddenMessage}</p>
            <p className="text-[11px] text-[#697386]">
              Dữ liệu không bị thay đổi. Vui lòng chuyển sang phạm vi cửa hàng được phép hoặc yêu
              cầu cấp quyền.
            </p>
          </div>
          {onForbiddenRecovery && (
            <button
              type="button"
              onClick={onForbiddenRecovery}
              data-testid="data-table-forbidden-recovery"
              className="btn-secondary text-xs mt-1"
            >
              Quay lại phạm vi được phép
            </button>
          )}
        </div>
      ) : error ? (
        /* Dedicated Error State with Actionable Recovery */
        <div
          role="alert"
          data-testid="data-table-error-state"
          className="p-10 text-center flex flex-col items-center justify-center space-y-3 bg-[#fef2f2]/30"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#fef2f2] border border-[#fecaca] text-[#b91c1c] flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="max-w-md space-y-1">
            <h3 className="text-sm font-bold text-[#0c1421]">Không thể tải dữ liệu bảng</h3>
            <p className="text-xs text-[#3b4352]">{error}</p>
            <p className="text-[11px] text-[#697386]">
              Dữ liệu hiện tại không bị thay đổi. Hãy kiểm tra kết nối hoặc bấm Thử lại.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                data-testid="data-table-retry-button"
                className="btn-primary text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Thử lại</span>
              </button>
            )}
            {table.isFiltered && (
              <button type="button" onClick={table.resetFilters} className="btn-secondary text-xs">
                Xóa bộ lọc
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Table Viewport (Sticky Header + Horizontal Overflow) */
        <div
          className="overflow-x-auto max-h-[600px] overflow-y-auto"
          aria-busy={loading ? 'true' : 'false'}
        >
          <table className="modern-table w-full border-collapse">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 z-10 bg-[#faf9f7] shadow-[0_1px_0_0_#eae7e4]">
              <tr>
                {enableRowSelection && (
                  <th scope="col" className="w-10 px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={table.isAllPageRowsSelected}
                      onChange={table.toggleAllRows}
                      aria-label="Chọn tất cả các dòng trên trang"
                      data-testid="data-table-select-all"
                      className="w-4 h-4 rounded border-[#d5d1cb] text-[#c23807] focus:ring-[#c23807] cursor-pointer"
                    />
                  </th>
                )}
                {table.visibleColumns.map((col) => {
                  const isSorted = table.sort?.id === col.id;
                  const ariaSort: 'ascending' | 'descending' | 'none' | undefined =
                    col.enableSorting === false
                      ? undefined
                      : isSorted
                        ? table.sort?.desc
                          ? 'descending'
                          : 'ascending'
                        : 'none';

                  return (
                    <th
                      key={col.id}
                      scope="col"
                      style={{ width: col.width }}
                      aria-sort={ariaSort}
                      className={`px-4 py-3 border-b border-[#eae7e4] ${
                        col.align === 'right'
                          ? 'text-right'
                          : col.align === 'center'
                            ? 'text-center'
                            : 'text-left'
                      }`}
                    >
                      <DataTableColumnHeader
                        columnId={col.id}
                        title={col.header}
                        enableSorting={col.enableSorting !== false}
                        enableHiding={col.enableHiding}
                        currentSort={table.sort}
                        onSort={table.setSort}
                        onHide={table.toggleColumnVisibility}
                        align={col.align}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody
              data-testid={
                loading
                  ? 'data-table-loading-state'
                  : data.length === 0
                    ? 'data-table-empty-state'
                    : 'data-table-success-state'
              }
            >
              {loading ? (
                Array.from({ length: Math.min(table.perPage, 5) }).map((_, rIdx) => (
                  <tr
                    key={`skeleton-${rIdx}`}
                    data-testid="data-table-skeleton-row"
                    className="border-b border-[#eae7e4]"
                  >
                    {enableRowSelection && (
                      <td className="px-3 py-3 text-center">
                        <div className="w-4 h-4 rounded bg-[#eae7e4] animate-pulse mx-auto" />
                      </td>
                    )}
                    {table.visibleColumns.map((col) => (
                      <td key={col.id} className={cellPadding}>
                        <div className="h-4 rounded bg-[#eae7e4] animate-pulse w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={table.visibleColumns.length + (enableRowSelection ? 1 : 0)}
                    className="p-10 text-center"
                  >
                    <div className="flex flex-col items-center justify-center space-y-3 max-w-md mx-auto">
                      <div className="w-12 h-12 rounded-2xl bg-[#f6f5f3] border border-[#eae7e4] text-[#697386] flex items-center justify-center">
                        <Inbox className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h4 className="text-sm font-bold text-[#0c1421]">{emptyTitle}</h4>
                        <p className="text-xs text-[#697386]">{emptyDescription}</p>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        {table.isFiltered && (
                          <button
                            type="button"
                            onClick={table.resetFilters}
                            data-testid="data-table-empty-reset-filters"
                            className="btn-secondary text-xs"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Xóa bộ lọc hiện tại</span>
                          </button>
                        )}
                        {emptyActionLabel && onEmptyAction && (
                          <button
                            type="button"
                            onClick={onEmptyAction}
                            data-testid="data-table-empty-action"
                            className="btn-primary text-xs"
                          >
                            {emptyActionLabel}
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((row, rowIndex) => {
                  const rowId = table.resolveRowId(row, rowIndex);
                  const isSelected = table.selectedRowIds.has(rowId);
                  return (
                    <tr
                      key={rowId}
                      ref={(el) => {
                        rowRefs.current[rowIndex] = el;
                      }}
                      tabIndex={0}
                      aria-selected={enableRowSelection ? isSelected : undefined}
                      data-testid={`data-table-row-${rowId}`}
                      onClick={() => onRowClick?.(row)}
                      onKeyDown={(e) => handleRowKeyDown(e, row, rowId, rowIndex)}
                      className={`border-b border-[#eae7e4] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#c23807] transition ${
                        isSelected ? 'bg-[#fff5f0]/70' : 'hover:bg-[#faf9f7]'
                      } ${onRowClick ? 'cursor-pointer' : ''}`}
                    >
                      {enableRowSelection && (
                        <td
                          className="px-3 py-2.5 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => table.toggleRowSelection(rowId)}
                            aria-label={`Chọn dòng ${rowId}`}
                            data-testid={`data-table-select-row-${rowId}`}
                            className="w-4 h-4 rounded border-[#d5d1cb] text-[#c23807] focus:ring-[#c23807] cursor-pointer"
                          />
                        </td>
                      )}
                      {table.visibleColumns.map((col) => {
                        const rawVal = col.accessorKey
                          ? (row as Record<string, unknown>)[String(col.accessorKey)]
                          : undefined;
                        return (
                          <td
                            key={col.id}
                            className={`${cellPadding} tabular-nums ${
                              col.align === 'right'
                                ? 'text-right'
                                : col.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                            }`}
                          >
                            {col.cell
                              ? col.cell(row, rowIndex)
                              : rawVal !== undefined && rawVal !== null
                                ? String(rawVal)
                                : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Server-Driven URL Pagination Bar */}
      <DataTablePagination
        page={table.page}
        perPage={table.perPage}
        pageCount={table.pageCount}
        totalRows={table.totalRows}
        selectedCount={table.selectedRowIds.size}
        onPageChange={table.setPage}
        onPerPageChange={table.setPerPage}
      />
    </div>
  );
}

export { ServerDataTable as PortedDataTable };
