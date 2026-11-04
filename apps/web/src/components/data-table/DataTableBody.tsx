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
 * DataTable body rendering: loading skeleton, forbidden (403), error and data rows.
 * Supports loading skeleton, accessible empty, forbidden, and error states,
 * keyboard accessibility, row selection and Vietnamese localization.
 */

'use client';

import React from 'react';
import { FileQuestion, ShieldAlert } from 'lucide-react';
import { isInteractiveControl } from './data-table-row-interactions';
import { ColumnDef, DataTableProps } from './types';

export type DataTableBodyProps<TData = any> = Omit<
  DataTableProps<TData>,
  'toolbar' | 'pagination' | 'visibleColumns' | 'sort' | 'maxHeight' | 'columns'
> & {
  displayedColumns: ColumnDef<TData>[];
  hasSelection: boolean;
};

export function renderDataTableBody<TData>({
  data,
  loading,
  error,
  forbidden,
  forbiddenTitle,
  forbiddenDescription,
  forbiddenActionLabel,
  onForbiddenAction,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  onEmptyAction,
  keyExtractor,
  selectedIds,
  onToggleSelect,
  onRowClick,
  displayedColumns,
  hasSelection,
}: DataTableBodyProps<TData>) {
  return loading ? (
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
          <div className="font-semibold text-sm text-[var(--text-primary)] mb-1">{emptyTitle}</div>
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
  );
}
