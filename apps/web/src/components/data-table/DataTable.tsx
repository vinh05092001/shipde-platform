// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table
/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 *
 * MIT License
 * Copyright (c) 2024 Sadman Sakib
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
 *
 * Core reusable server-driven DataTable component.
 * Supports loading skeleton, accessible empty, forbidden, and error states,
 * keyboard accessibility, row selection, sticky header in vertical scroll container, and Vietnamese localization.
 */

'use client';

import React from 'react';
import { AlertCircle, FileQuestion, RefreshCw, ShieldAlert } from 'lucide-react';
import { DataTableProps } from './types';

export function isInteractiveControl(
  target: EventTarget | null,
  currentTarget: EventTarget | null
): boolean {
  if (!target || target === currentTarget) return false;
  const el = target as Element;
  return Boolean(
    el.closest?.(
      'button, a, input, select, textarea, [role="button"], [role="checkbox"], [role="link"], [role="menuitem"], [role="switch"]'
    )
  );
}

export function DataTable<TData = any>({
  data,
  columns,
  keyExtractor = (item: any) => (item?.id !== undefined ? String(item.id) : JSON.stringify(item)),
  loading = false,
  error = null,
  onRetry,
  forbidden = null,
  forbiddenTitle = 'Không có quyền truy cập',
  forbiddenDescription = 'Bạn không có quyền xem hoặc thao tác trên danh sách dữ liệu này. Vui lòng liên hệ quản trị viên để được cấp quyền.',
  forbiddenActionLabel,
  onForbiddenAction,
  emptyTitle = 'Không tìm thấy dữ liệu',
  emptyDescription = 'Không có bản ghi nào phù hợp với điều kiện tìm kiếm hoặc bộ lọc hiện tại.',
  emptyActionLabel,
  onEmptyAction,
  toolbar,
  pagination,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  visibleColumns,
  sort,
  maxHeight,
}: DataTableProps<TData>) {
  // Filter columns based on visibility set
  const displayedColumns = columns.filter((col) => !visibleColumns?.has(col.id));

  const hasSelection = Boolean(onToggleSelect && onSelectAll);
  const isAllSelected =
    data.length > 0 && selectedIds ? data.every((d) => selectedIds.has(keyExtractor(d))) : false;

  return (
    <div className="space-y-4 w-full">
      {/* Optional Toolbar slot */}
      {toolbar}

      {/* Error Alert Banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-[8px] bg-[var(--status-risk-bg)] border border-[var(--status-risk-border)] text-[var(--status-risk-text)] flex items-start justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed">
              <span className="font-semibold block mb-0.5">Đã xảy ra lỗi khi tải dữ liệu</span>
              <span>{typeof error === 'string' ? error : error.message}</span>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              title="Thử lại tải dữ liệu"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-semibold bg-[var(--bg-card)] border border-[var(--status-risk-border)] hover:bg-[var(--bg-subtle)] text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Thử lại</span>
            </button>
          )}
        </div>
      )}

      {/* Table Container with vertical scroll container for sticky header (Finding 8 P2) */}
      <div className="rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-xs overflow-hidden">
        <div
          data-testid="table-scroll-container"
          className="overflow-x-auto overflow-y-auto max-h-[600px] relative custom-scrollbar"
          style={maxHeight !== undefined ? { maxHeight } : undefined}
        >
          <table
            className="w-full text-left text-xs text-[var(--text-primary)]"
            role="table"
            aria-busy={loading}
          >
            <thead className="sticky top-0 z-10 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)] text-[11px] select-none shadow-xs">
              <tr role="row">
                {hasSelection && (
                  <th
                    scope="col"
                    style={{ width: '40px' }}
                    className="px-3 py-3 text-center align-middle bg-[var(--bg-subtle)]"
                  >
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={onSelectAll}
                      aria-label="Chọn tất cả các dòng trên trang này"
                      title="Chọn tất cả các dòng trên trang này"
                      className="w-3.5 h-3.5 rounded-[3px] border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--border-focus)] cursor-pointer align-middle"
                    />
                  </th>
                )}

                {displayedColumns.map((col) => {
                  const alignClass =
                    col.align === 'right'
                      ? 'text-right'
                      : col.align === 'center'
                        ? 'text-center'
                        : 'text-left';

                  // Apply sort state to th (aria-sort: 'ascending' | 'descending' | 'none')
                  const colSortState =
                    col.enableSorting === false
                      ? undefined
                      : sort?.id === col.id
                        ? sort.desc
                          ? 'descending'
                          : 'ascending'
                        : 'none';

                  return (
                    <th
                      key={col.id}
                      scope="col"
                      aria-sort={colSortState}
                      style={{ width: col.width }}
                      className={`px-4 py-3 font-semibold text-[var(--text-secondary)] uppercase tracking-wider bg-[var(--bg-subtle)] align-middle ${alignClass}`}
                    >
                      {typeof col.header === 'function' ? col.header({ column: col }) : col.header}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody
              className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-card)]"
              aria-busy={loading ? 'true' : undefined}
            >
              {loading ? (
                // Loading Skeleton State
                Array.from({ length: 6 }).map((_, rIdx) => (
                  <tr key={`skeleton-${rIdx}`} role="row" className="animate-pulse">
                    {hasSelection && (
                      <td className="px-3 py-3 text-center align-middle">
                        <div className="w-3.5 h-3.5 rounded-[3px] bg-[var(--bg-subtle)] mx-auto" />
                      </td>
                    )}
                    {displayedColumns.map((col) => (
                      <td key={`skel-cell-${col.id}`} className="px-4 py-3 align-middle">
                        <div className="h-3.5 bg-[var(--bg-subtle)] rounded-[4px] w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : forbidden ? (
                // Forbidden (403 Permission Denied) State
                <tr role="row">
                  <td
                    colSpan={displayedColumns.length + (hasSelection ? 1 : 0)}
                    className="py-12 px-4 text-center"
                  >
                    <div
                      className="flex flex-col items-center justify-center max-w-sm mx-auto"
                      role="alert"
                      aria-live="assertive"
                    >
                      <div className="w-12 h-12 rounded-full bg-[var(--status-risk-bg)] border border-[var(--status-risk-border)] flex items-center justify-center text-[var(--status-risk-text)] mb-3">
                        <ShieldAlert className="w-6 h-6 stroke-[1.5]" aria-hidden="true" />
                      </div>
                      <div className="font-semibold text-sm text-[var(--text-primary)] mb-1">
                        {forbiddenTitle}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
                        {typeof forbidden === 'string' ? forbidden : forbiddenDescription}
                      </p>
                      {forbiddenActionLabel && onForbiddenAction && (
                        <button
                          type="button"
                          onClick={onForbiddenAction}
                          className="btn-secondary !text-xs !min-h-[34px] !py-1.5 !px-3"
                        >
                          {forbiddenActionLabel}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : error ? null : data.length === 0 ? (
                // Empty State
                <tr role="row">
                  <td
                    colSpan={displayedColumns.length + (hasSelection ? 1 : 0)}
                    className="py-12 px-4 text-center"
                  >
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                      <div className="w-12 h-12 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-dim)] mb-3">
                        <FileQuestion className="w-6 h-6 stroke-[1.5]" aria-hidden="true" />
                      </div>
                      <div className="font-semibold text-sm text-[var(--text-primary)] mb-1">
                        {emptyTitle}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
                        {emptyDescription}
                      </p>
                      {emptyActionLabel && onEmptyAction && (
                        <button
                          type="button"
                          onClick={onEmptyAction}
                          className="btn-secondary !text-xs !min-h-[34px] !py-1.5 !px-3"
                        >
                          {emptyActionLabel}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                // Data Rows
                data.map((item, index) => {
                  const id = keyExtractor(item);
                  const isSelected = selectedIds?.has(id);

                  return (
                    <tr
                      key={id}
                      role="row"
                      aria-selected={isSelected}
                      onClick={(e) => {
                        if (!onRowClick) return;
                        if (isInteractiveControl(e.target, e.currentTarget)) return;
                        onRowClick(item);
                      }}
                      onKeyDown={(e) => {
                        if (!onRowClick) return;
                        // Exclude descendant controls from row activation
                        if (isInteractiveControl(e.target, e.currentTarget)) return;
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onRowClick(item);
                        }
                      }}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-[var(--primary-subtle)] hover:bg-[var(--primary-subtle)]/80'
                          : 'hover:bg-[var(--bg-subtle)]'
                      } ${onRowClick ? 'cursor-pointer' : ''}`}
                    >
                      {hasSelection && (
                        <td
                          className="px-3 py-3 text-center align-middle"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (e.target === e.currentTarget) {
                              onToggleSelect?.(id, (e.nativeEvent as MouseEvent).shiftKey);
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected || false}
                            onChange={(e) => {
                              onToggleSelect?.(id, (e.nativeEvent as any).shiftKey);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            onKeyDown={(e) => {
                              // Ensure Space/Enter on checkbox never bubbles to row activation
                              e.stopPropagation();
                            }}
                            aria-label={`Chọn hàng có mã ${id}`}
                            title={`Chọn hàng có mã ${id}`}
                            className="w-3.5 h-3.5 rounded-[3px] border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--border-focus)] cursor-pointer align-middle"
                          />
                        </td>
                      )}

                      {displayedColumns.map((col, colIdx) => {
                        const alignClass =
                          col.align === 'right'
                            ? 'text-right'
                            : col.align === 'center'
                              ? 'text-center'
                              : 'text-left';

                        return (
                          <td
                            key={col.id}
                            className={`px-4 py-3 text-[var(--text-primary)] align-middle ${alignClass}`}
                          >
                            {colIdx === 0 && onRowClick && (
                              <button
                                type="button"
                                data-row-action="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onRowClick(item);
                                }}
                                aria-label={`Xem chi tiết ${id}`}
                                className="sr-only focus:not-sr-only focus:inline-block focus:px-2 focus:py-1 focus:text-xs focus:font-medium focus:text-[var(--primary)] focus:bg-[var(--bg-app)] focus:border focus:border-[var(--border-focus)] focus:rounded-[4px] focus:mr-2"
                              >
                                Xem chi tiết
                              </button>
                            )}
                            {col.cell
                              ? col.cell({ row: item, index })
                              : col.accessorKey
                                ? (item as any)[col.accessorKey]
                                : null}
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
      </div>

      {/* Optional Pagination slot */}
      {pagination}
    </div>
  );
}
