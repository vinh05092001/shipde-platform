'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from sadmann7/shadcn-table
 * (https://github.com/sadmann7/shadcn-table)
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
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import React from 'react';
import {
  AlertTriangle,
  FileSpreadsheet,
  Inbox,
  RefreshCw,
  RotateCcw,
  SearchX,
  ShieldAlert,
} from 'lucide-react';
import type { DataTableFilterField, ServerDataTableInstance } from './types';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTablePagination } from './data-table-pagination';
import { DataTableSkeleton } from './data-table-skeleton';
import { DataTableToolbar } from './data-table-toolbar';

export interface ServerDataTableProps<TData> {
  table: ServerDataTableInstance<TData>;
  filterFields?: DataTableFilterField<TData>[];
  facetCounts?: Record<string, Record<string, number>>;
  caption?: string;
  enableRowSelection?: boolean;
  onRowClick?: (row: TData, index: number) => void;
  toolbarActions?: React.ReactNode;
  bulkActionsBar?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;
  isLoading?: boolean;
  error?: {
    title?: string;
    message: string;
    code?: string;
  } | null;
  onRetry?: () => void;
  isForbidden?: boolean;
  forbiddenMessage?: string;
  onSwitchTenantOrRequestAccess?: () => void;
  validationError?: string | null;
  partialWarning?: {
    message: string;
    detail?: string;
  } | null;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  className?: string;
}

export function ServerDataTable<TData>({
  table,
  filterFields = [],
  facetCounts,
  caption = 'Bảng dữ liệu vận hành Ship Dễ',
  enableRowSelection = false,
  onRowClick,
  toolbarActions,
  bulkActionsBar,
  isLoading = false,
  error = null,
  onRetry,
  isForbidden = false,
  forbiddenMessage,
  onSwitchTenantOrRequestAccess,
  validationError = null,
  partialWarning = null,
  emptyTitle = 'Chưa có dữ liệu vận hành',
  emptyDescription = 'Hiện chưa có bản ghi nào trong phạm vi cửa hàng hoặc kho đang chọn.',
  emptyActionLabel,
  onEmptyAction,
  className = '',
}: ServerDataTableProps<TData>) {
  if (isLoading) {
    return (
      <DataTableSkeleton
        columnCount={table.visibleColumns.length + (enableRowSelection ? 1 : 0)}
        rowCount={Math.min(table.perPage, 8)}
        searchableColumnCount={
          filterFields.filter((f) => f.variant === 'text' || !f.options).length || 1
        }
        filterableColumnCount={
          filterFields.filter((f) => f.variant === 'faceted' || Boolean(f.options)).length
        }
        className={className}
      />
    );
  }

  if (isForbidden) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`modern-card overflow-hidden rounded-xl border border-amber-200 bg-white p-8 text-center ${className}`}
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          Không đủ quyền truy cập dữ liệu (403 Forbidden)
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">
          {forbiddenMessage ??
            'Tài khoản hoặc vai trò hiện tại của bạn không có quyền xem danh sách dữ liệu này trong phạm vi cửa hàng đang chọn.'}
        </p>
        {onSwitchTenantOrRequestAccess && (
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={onSwitchTenantOrRequestAccess}
              className="btn-secondary inline-flex items-center gap-2 text-xs"
            >
              <span>Chuyển ngữ cảnh cửa hàng hoặc yêu cầu cấp quyền</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className={`modern-card overflow-hidden rounded-xl border border-rose-200 bg-white p-8 text-center ${className}`}
      >
        <div
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600"
        >
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900">
          {error.title ?? 'Không thể tải dữ liệu bảng'}
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-slate-600">
          {error.message}
        </p>
        {error.code && (
          <p className="mt-2 font-mono text-[11px] text-rose-700 tabular-nums">
            Mã lỗi: {error.code}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-primary inline-flex items-center gap-2 text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Thử tải lại</span>
            </button>
          )}
          {table.isFiltered && (
            <button
              type="button"
              onClick={() => table.resetFilters()}
              className="btn-secondary inline-flex items-center gap-1.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Đặt lại bộ lọc</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const allValidationMessages = [
    ...(validationError ? [validationError] : []),
    ...table.validationErrors,
  ];

  const pageRowIds = table.data.map((row, index) => table.getRowId(row, index));
  const selectedRows = table.data.filter((row, index) =>
    Boolean(table.selectedRowIds[table.getRowId(row, index)])
  );
  const allPageSelected =
    pageRowIds.length > 0 && pageRowIds.every((id) => Boolean(table.selectedRowIds[id]));
  const somePageSelected =
    !allPageSelected && pageRowIds.some((id) => Boolean(table.selectedRowIds[id]));

  const isOutOfRangePage =
    table.data.length === 0 &&
    table.page > 1 &&
    typeof table.totalCount === 'number' &&
    table.totalCount > 0;

  const cellPaddingClass = table.density === 'compact' ? 'px-4 py-2' : 'px-4 py-3.5';

  return (
    <div
      className={`modern-card overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs ${className}`}
    >
      <DataTableToolbar
        table={table}
        filterFields={filterFields}
        facetCounts={facetCounts}
        toolbarActions={toolbarActions}
      />

      {/* Validation error alert banner (invalid URL search params) */}
      {allValidationMessages.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-900"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden="true">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            </span>
            <div>
              <p className="font-semibold">Tham số truy vấn URL cần điều chỉnh:</p>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                {allValidationMessages.map((msg, idx) => (
                  <li key={idx}>{msg}</li>
                ))}
              </ul>
            </div>
          </div>
          <button
            type="button"
            onClick={() => table.resetFilters()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Đặt lại tham số mặc định</span>
          </button>
        </div>
      )}

      {/* Partial data / degraded upstream banner */}
      {partialWarning && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-200 bg-sky-50/80 px-4 py-2.5 text-xs text-sky-900"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true">
              <AlertTriangle className="h-4 w-4 shrink-0 text-sky-700" />
            </span>
            <div>
              <span className="font-semibold">{partialWarning.message}</span>
              {partialWarning.detail && (
                <span className="ml-1.5 text-sky-800">{partialWarning.detail}</span>
              )}
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-md border border-sky-300 bg-white px-2.5 py-1 text-xs font-medium text-sky-900 hover:bg-sky-100"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>Đồng bộ lại</span>
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar when rows are selected */}
      {enableRowSelection && selectedRows.length > 0 && (
        <div
          role="region"
          aria-label="Thanh thao tác hàng loạt"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-200 bg-orange-50/80 px-4 py-2 text-xs text-orange-950"
        >
          <div className="flex items-center gap-2 font-medium tabular-nums">
            <span>
              Đang chọn <strong>{selectedRows.length}</strong> bản ghi trên trang này
            </span>
            <button
              type="button"
              onClick={() => table.clearRowSelection()}
              className="underline hover:text-orange-700"
            >
              Bỏ chọn tất cả
            </button>
          </div>
          {bulkActionsBar && (
            <div className="flex items-center gap-2">
              {bulkActionsBar(selectedRows, table.clearRowSelection)}
            </div>
          )}
        </div>
      )}

      {/* Table container */}
      <div className="max-h-[640px] overflow-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-xs">
            <tr>
              {enableRowSelection && (
                <th scope="col" className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allPageSelected}
                    ref={(el) => {
                      if (el) {
                        el.indeterminate = somePageSelected;
                      }
                    }}
                    onChange={(event) => table.toggleAllPageRowsSelected(event.target.checked)}
                    aria-label="Chọn tất cả các dòng trên trang hiện tại"
                    className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-600"
                  />
                </th>
              )}

              {table.visibleColumns.map((column) => {
                const sortSpec = table.sorting.find((s) => s.id === column.id);
                const sortDirection = sortSpec ? (sortSpec.desc ? 'desc' : 'asc') : false;
                const ariaSort =
                  sortDirection === 'asc'
                    ? 'ascending'
                    : sortDirection === 'desc'
                      ? 'descending'
                      : column.enableSorting !== false
                        ? 'none'
                        : undefined;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    style={{
                      width: column.width,
                      minWidth: column.minWidth,
                    }}
                    className="px-4 py-3 align-middle"
                  >
                    <DataTableColumnHeader
                      columnId={column.id}
                      title={column.header}
                      canSort={column.enableSorting !== false}
                      canHide={column.enableHiding !== false}
                      sortDirection={sortDirection}
                      align={column.align}
                      onToggleSort={table.toggleColumnSort}
                      onClearSort={table.clearColumnSort}
                      onHideColumn={(colId) => table.setColumnVisibility(colId, false)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-200/80 text-sm text-slate-800">
            {isOutOfRangePage ? (
              <tr>
                <td
                  colSpan={table.visibleColumns.length + (enableRowSelection ? 1 : 0)}
                  className="px-6 py-12 text-center"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                      <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-slate-900">
                      Trang {table.page} vượt quá số trang hiện có ({table.pageCount})
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Bộ lọc hoặc tổng số bản ghi đã thay đổi khiến trang hiện tại không còn dữ
                      liệu.
                    </p>
                    <button
                      type="button"
                      onClick={() => table.setPage(1)}
                      className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Quay về trang 1</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : table.data.length === 0 && table.isFiltered ? (
              <tr>
                <td
                  colSpan={table.visibleColumns.length + (enableRowSelection ? 1 : 0)}
                  className="px-6 py-12 text-center"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <SearchX className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-slate-900">
                      Không tìm thấy kết quả phù hợp với bộ lọc
                    </h4>
                    <p className="mt-1 text-xs text-slate-500">
                      Không có bản ghi nào khớp với từ khóa hoặc tiêu chí lọc hiện tại. Hãy thử nới
                      rộng điều kiện hoặc xóa bộ lọc.
                    </p>
                    <button
                      type="button"
                      onClick={() => table.resetFilters()}
                      className="btn-secondary mt-4 inline-flex items-center gap-1.5 text-xs"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Xóa bộ lọc để xem toàn bộ</span>
                    </button>
                  </div>
                </td>
              </tr>
            ) : table.data.length === 0 ? (
              <tr>
                <td
                  colSpan={table.visibleColumns.length + (enableRowSelection ? 1 : 0)}
                  className="px-6 py-14 text-center"
                >
                  <div className="mx-auto flex max-w-md flex-col items-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Inbox className="h-6 w-6" aria-hidden="true" />
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-slate-900">{emptyTitle}</h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">
                      {emptyDescription}
                    </p>
                    {emptyActionLabel && onEmptyAction && (
                      <button
                        type="button"
                        onClick={onEmptyAction}
                        className="btn-primary mt-4 inline-flex items-center gap-1.5 text-xs"
                      >
                        <span>{emptyActionLabel}</span>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              table.data.map((row, rowIndex) => {
                const rowId = table.getRowId(row, rowIndex);
                const isSelected = Boolean(table.selectedRowIds[rowId]);
                const record = row as Record<string, unknown>;

                return (
                  <tr
                    key={rowId}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-selected={enableRowSelection ? isSelected : undefined}
                    onClick={() => onRowClick?.(row, rowIndex)}
                    onKeyDown={(event) => {
                      if (!onRowClick) {
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onRowClick(row, rowIndex);
                      } else if (event.key === 'ArrowDown') {
                        const nextRow = event.currentTarget
                          .nextElementSibling as HTMLElement | null;
                        nextRow?.focus();
                      } else if (event.key === 'ArrowUp') {
                        const prevRow = event.currentTarget
                          .previousElementSibling as HTMLElement | null;
                        prevRow?.focus();
                      }
                    }}
                    className={`transition-colors ${
                      isSelected ? 'bg-orange-50/60' : 'hover:bg-slate-50/90'
                    } ${
                      onRowClick
                        ? 'cursor-pointer focus-visible:bg-orange-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-600'
                        : ''
                    }`}
                  >
                    {enableRowSelection && (
                      <td className={cellPaddingClass} onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => table.toggleRowSelected(rowId, event.target.checked)}
                          aria-label={`Chọn dòng ${rowId}`}
                          className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-600"
                        />
                      </td>
                    )}

                    {table.visibleColumns.map((column) => {
                      const alignClass =
                        column.align === 'right'
                          ? 'text-right'
                          : column.align === 'center'
                            ? 'text-center'
                            : 'text-left';
                      const tabularClass = column.tabularNums ? 'font-mono tabular-nums' : '';

                      let cellContent: React.ReactNode;
                      if (column.cell) {
                        cellContent = column.cell(row, rowIndex);
                      } else if (column.accessorFn) {
                        cellContent = column.accessorFn(row) ?? '—';
                      } else {
                        const key = column.accessorKey ?? column.id;
                        const val = record[key];
                        cellContent =
                          val !== undefined && val !== null && val !== '' ? String(val) : '—';
                      }

                      return (
                        <td
                          key={column.id}
                          className={`${cellPaddingClass} ${alignClass} ${tabularClass} align-middle`}
                        >
                          {cellContent}
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

      <DataTablePagination table={table} enableRowSelection={enableRowSelection} />
    </div>
  );
}
