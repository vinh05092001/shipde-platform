/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 * License: MIT
 *
 * Core reusable server-driven DataTable component.
 * Supports loading skeleton, accessible empty and error states,
 * keyboard accessibility, row selection, and Vietnamese localization.
 */

'use client';

import React from 'react';
import { AlertCircle, FileQuestion, RefreshCw } from 'lucide-react';
import { DataTableProps } from './types';

export function DataTable<TData = any>({
  data,
  columns,
  keyExtractor,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Không tìm thấy dữ liệu nào',
  emptyDescription = 'Không có bản ghi nào phù hợp với bộ lọc hoặc từ khóa tìm kiếm hiện tại.',
  emptyActionLabel,
  onEmptyAction,
  toolbar,
  pagination,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onRowClick,
  visibleColumns,
}: DataTableProps<TData>) {
  // Filter active columns based on visibility
  const displayedColumns = React.useMemo(() => {
    if (!visibleColumns || visibleColumns.size === 0) return columns;
    return columns.filter((col) => !visibleColumns.has(col.id));
  }, [columns, visibleColumns]);

  const hasSelection = onToggleSelect !== undefined;
  const isAllSelected =
    data.length > 0 &&
    selectedIds !== undefined &&
    data.every((item) => selectedIds.has(keyExtractor(item)));

  const errorMessage = typeof error === 'string' ? error : error?.message;

  return (
    <div className="w-full rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-xs flex flex-col overflow-hidden">
      {/* Optional Toolbar */}
      {toolbar}

      {/* Error State Banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="m-4 p-4 rounded-[8px] bg-[var(--status-risk-bg)] border border-[var(--status-risk-border)] text-[var(--status-risk-text)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <div>
              <div className="font-semibold text-sm">Đã xảy ra lỗi khi tải dữ liệu</div>
              <div className="text-xs opacity-90 mt-0.5">
                {errorMessage || 'Không thể kết nối đến máy chủ. Vui lòng thử lại.'}
              </div>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-white border border-[var(--status-risk-border)] text-xs font-semibold text-[var(--status-risk-text)] hover:bg-[var(--status-risk-bg)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] self-end sm:self-auto"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Thử lại</span>
            </button>
          )}
        </div>
      )}

      {/* Table Viewport */}
      <div
        className="overflow-x-auto relative w-full"
        tabIndex={0}
        aria-label="Khung cuộn bảng dữ liệu"
      >
        <table className="w-full border-collapse text-xs text-left" role="table">
          <thead
            className="bg-[var(--bg-subtle)] sticky top-0 z-10 border-b border-[var(--border-subtle)]"
            role="rowgroup"
          >
            <tr role="row">
              {hasSelection && (
                <th
                  scope="col"
                  style={{ width: '40px' }}
                  className="px-3 py-3 text-center align-middle"
                >
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={onSelectAll}
                    aria-label="Chọn tất cả các dòng trên trang này"
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

                return (
                  <th
                    key={col.id}
                    scope="col"
                    style={{ width: col.width }}
                    className={`px-4 py-3 font-semibold text-[var(--text-secondary)] uppercase tracking-wider align-middle ${alignClass}`}
                  >
                    {typeof col.header === 'function' ? col.header({ column: col }) : col.header}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody
            className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-card)]"
            role="rowgroup"
            aria-busy={loading}
          >
            {loading ? (
              // Loading Skeleton State
              Array.from({ length: 6 }).map((_, rIdx) => (
                <tr key={`skeleton-${rIdx}`} className="animate-pulse" role="row">
                  {hasSelection && (
                    <td className="px-3 py-3 text-center align-middle">
                      <div className="w-3.5 h-3.5 bg-[var(--bg-hover)] mx-auto rounded-[3px]" />
                    </td>
                  )}
                  {displayedColumns.map((col, cIdx) => (
                    <td key={`skeleton-col-${cIdx}`} className="px-4 py-3 align-middle">
                      <div
                        className={`h-3.5 bg-[var(--bg-hover)] rounded-[4px] ${
                          col.align === 'right'
                            ? 'ml-auto w-16'
                            : col.align === 'center'
                              ? 'mx-auto w-20'
                              : 'w-3/4'
                        }`}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
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
                    onClick={() => onRowClick && onRowClick(item)}
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
                          onToggleSelect(id, (e.nativeEvent as MouseEvent).shiftKey);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected || false}
                          onChange={() => {}}
                          aria-label={`Chọn hàng có mã ${id}`}
                          className="w-3.5 h-3.5 rounded-[3px] border-[var(--border-strong)] text-[var(--primary)] focus:ring-[var(--border-focus)] cursor-pointer align-middle"
                        />
                      </td>
                    )}

                    {displayedColumns.map((col) => {
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
                          {col.cell
                            ? col.cell({ row: item, index })
                            : col.accessorKey
                              ? String(
                                  (item as Record<string, unknown>)[col.accessorKey as string] ?? ''
                                )
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

      {/* Optional Pagination Bar */}
      {pagination}
    </div>
  );
}
