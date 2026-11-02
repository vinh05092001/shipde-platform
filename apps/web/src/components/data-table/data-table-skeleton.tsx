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

export interface DataTableSkeletonProps {
  columnCount?: number;
  rowCount?: number;
  searchableColumnCount?: number;
  filterableColumnCount?: number;
  showViewOptions?: boolean;
  showPagination?: boolean;
  className?: string;
}

export function DataTableSkeleton({
  columnCount = 6,
  rowCount = 6,
  searchableColumnCount = 1,
  filterableColumnCount = 2,
  showViewOptions = true,
  showPagination = true,
  className = '',
}: DataTableSkeletonProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Đang tải dữ liệu bảng..."
      className={`modern-card overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}
    >
      {/* Toolbar skeleton */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {Array.from({ length: searchableColumnCount }).map((_, idx) => (
            <div
              key={`search-skel-${idx}`}
              className="h-9 w-56 animate-pulse rounded-lg bg-slate-100"
            />
          ))}
          {Array.from({ length: filterableColumnCount }).map((_, idx) => (
            <div
              key={`filter-skel-${idx}`}
              className="h-9 w-28 animate-pulse rounded-lg border border-dashed border-slate-200 bg-slate-50"
            />
          ))}
        </div>
        {showViewOptions && (
          <div className="flex items-center gap-2">
            <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-9 w-28 animate-pulse rounded-lg bg-slate-100" />
          </div>
        )}
      </div>

      {/* Table structure skeleton */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {Array.from({ length: columnCount }).map((_, colIdx) => (
                <th key={`th-skel-${colIdx}`} className="px-4 py-3">
                  <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from({ length: rowCount }).map((_, rowIdx) => (
              <tr key={`tr-skel-${rowIdx}`}>
                {Array.from({ length: columnCount }).map((__, colIdx) => (
                  <td key={`td-skel-${rowIdx}-${colIdx}`} className="px-4 py-3">
                    <div
                      className={`h-4 animate-pulse rounded bg-slate-100 ${
                        colIdx === 0 ? 'w-32' : colIdx === columnCount - 1 ? 'ml-auto w-20' : 'w-24'
                      }`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination skeleton */}
      {showPagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
          <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
          <div className="flex items-center gap-4">
            <div className="h-8 w-28 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
            <div className="flex items-center gap-1">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-200" />
            </div>
          </div>
        </div>
      )}
      <span className="sr-only">Đang tải dữ liệu vận hành, vui lòng chờ...</span>
    </div>
  );
}
