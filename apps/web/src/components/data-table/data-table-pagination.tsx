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

import React, { useId } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ServerDataTableInstance } from './types';

export interface DataTablePaginationProps<TData> {
  table: ServerDataTableInstance<TData>;
  enableRowSelection?: boolean;
  className?: string;
}

export function DataTablePagination<TData>({
  table,
  enableRowSelection = false,
  className = '',
}: DataTablePaginationProps<TData>) {
  const pageSizeSelectId = useId();
  const selectedCount = Object.values(table.selectedRowIds).filter(Boolean).length;
  const totalPages = Math.max(1, table.pageCount);
  const currentPage = Math.max(1, table.page);
  const canPreviousPage = currentPage > 1;
  const canNextPage = currentPage < totalPages;

  return (
    <nav
      aria-label="Điều hướng phân trang bảng dữ liệu"
      className={`flex flex-col items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3 text-xs text-slate-600 sm:flex-row ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        {enableRowSelection && (
          <span className="font-medium text-slate-700 tabular-nums">
            Đã chọn <strong className="font-semibold text-slate-900">{selectedCount}</strong> /{' '}
            {table.data.length} dòng hiển thị
          </span>
        )}
        {typeof table.totalCount === 'number' && (
          <span className="text-slate-600 tabular-nums">
            Tổng cộng:{' '}
            <strong className="font-semibold text-slate-900">
              {table.totalCount.toLocaleString('vi-VN')}
            </strong>{' '}
            bản ghi
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        <div className="flex items-center gap-2">
          <label htmlFor={pageSizeSelectId} className="font-medium text-slate-600">
            Số dòng / trang
          </label>
          <select
            id={pageSizeSelectId}
            value={table.perPage}
            onChange={(event) => table.setPerPage(Number(event.target.value))}
            aria-label="Số dòng hiển thị trên mỗi trang"
            className="h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 tabular-nums focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20"
          >
            {table.pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size} dòng
              </option>
            ))}
          </select>
        </div>

        <div className="font-semibold text-slate-800 tabular-nums" aria-live="polite">
          Trang {currentPage} / {totalPages}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => table.setPage(1)}
            disabled={!canPreviousPage}
            aria-label="Trang đầu tiên"
            title="Chuyển đến trang đầu tiên"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => table.setPage(currentPage - 1)}
            disabled={!canPreviousPage}
            aria-label="Trang trước"
            title="Chuyển về trang trước"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => table.setPage(currentPage + 1)}
            disabled={!canNextPage}
            aria-label="Trang tiếp theo"
            title="Chuyển sang trang tiếp theo"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => table.setPage(totalPages)}
            disabled={!canNextPage}
            aria-label="Trang cuối cùng"
            title="Chuyển đến trang cuối cùng"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
