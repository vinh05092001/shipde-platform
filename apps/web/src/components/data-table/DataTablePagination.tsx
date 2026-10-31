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
 * Pagination controls with accessible page size selector and navigation buttons.
 */

'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { DataTablePaginationProps } from './types';

export function DataTablePagination({
  pageIndex,
  pageSize,
  pageCount,
  totalCount,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  selectedCount,
}: DataTablePaginationProps) {
  const fromRecord = totalCount === 0 ? 0 : (pageIndex - 1) * pageSize + 1;
  const toRecord = Math.min(pageIndex * pageSize, totalCount);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-app)] text-xs text-[var(--text-secondary)]">
      {/* Left: Selection and Records info */}
      <div className="flex items-center gap-2">
        {selectedCount !== undefined && selectedCount > 0 ? (
          <span className="font-medium text-[var(--text-primary)]">
            Đã chọn{' '}
            <strong className="tabular-nums font-mono text-[var(--primary)]">
              {selectedCount}
            </strong>{' '}
            trên <strong className="tabular-nums font-mono">{totalCount}</strong> hàng
          </span>
        ) : (
          <span>
            Hiển thị{' '}
            <strong className="tabular-nums font-mono text-[var(--text-primary)]">
              {fromRecord}-{toRecord}
            </strong>{' '}
            trên{' '}
            <strong className="tabular-nums font-mono text-[var(--text-primary)]">
              {totalCount}
            </strong>{' '}
            bản ghi
          </span>
        )}
      </div>

      {/* Right: Page size and Navigation */}
      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        {/* Page size dropdown */}
        <div className="flex items-center gap-2">
          <label htmlFor="page-size-select" className="text-[var(--text-muted)] whitespace-nowrap">
            Số dòng mỗi trang:
          </label>
          <select
            id="page-size-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="Chọn số dòng hiển thị mỗi trang"
            className="h-8 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        {/* Current page indicator */}
        <div className="tabular-nums font-mono text-[var(--text-primary)] whitespace-nowrap">
          Trang <span className="font-semibold">{pageIndex}</span> /{' '}
          <span>{Math.max(1, pageCount)}</span>
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(1)}
            disabled={pageIndex <= 1}
            aria-label="Đến trang đầu tiên"
            title="Trang đầu"
            className="p-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <ChevronsLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(pageIndex - 1)}
            disabled={pageIndex <= 1}
            aria-label="Đến trang trước"
            title="Trang trước"
            className="p-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(pageIndex + 1)}
            disabled={pageIndex >= pageCount}
            aria-label="Đến trang kế tiếp"
            title="Trang sau"
            className="p-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onPageChange(pageCount)}
            disabled={pageIndex >= pageCount}
            aria-label="Đến trang cuối cùng"
            title="Trang cuối"
            className="p-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
          >
            <ChevronsRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
