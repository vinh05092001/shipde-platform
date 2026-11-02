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
import { RotateCcw, Search, X } from 'lucide-react';
import type { DataTableFilterField, ServerDataTableInstance } from './types';
import { DataTableFacetedFilter } from './data-table-faceted-filter';
import { DataTableViewOptions } from './data-table-view-options';

export interface DataTableToolbarProps<TData> {
  table: ServerDataTableInstance<TData>;
  filterFields?: DataTableFilterField<TData>[];
  facetCounts?: Record<string, Record<string, number>>;
  toolbarActions?: React.ReactNode;
  className?: string;
}

export function DataTableToolbar<TData>({
  table,
  filterFields = [],
  facetCounts,
  toolbarActions,
  className = '',
}: DataTableToolbarProps<TData>) {
  const searchableColumns = filterFields.filter(
    (field) => field.variant === 'text' || !field.options
  );
  const filterableColumns = filterFields.filter(
    (field) => field.variant === 'faceted' || Array.isArray(field.options)
  );

  return (
    <div
      role="region"
      aria-label="Thanh công cụ lọc và tùy chỉnh bảng dữ liệu"
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 ${className}`}
    >
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {searchableColumns.map((column) => {
          const inputId = `data-table-search-${column.id}`;
          const rawValue = table.getFilterValue(column.id);
          const currentValue = typeof rawValue === 'string' ? rawValue : '';

          return (
            <div key={column.id} className="relative flex items-center">
              <label htmlFor={inputId} className="sr-only">
                {column.label}
              </label>
              <Search
                className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                id={inputId}
                type="search"
                value={currentValue}
                onChange={(event) =>
                  table.setFilterValue(
                    column.id,
                    event.target.value.length > 0 ? event.target.value : undefined
                  )
                }
                placeholder={column.placeholder ?? `Tìm theo ${column.label.toLowerCase()}...`}
                className="h-9 w-56 rounded-lg border border-slate-300 bg-white pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 transition-colors focus:border-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-600/20 sm:w-64"
              />
              {currentValue.length > 0 && (
                <button
                  type="button"
                  onClick={() => table.setFilterValue(column.id, undefined)}
                  aria-label={`Xóa từ khóa ${column.label}`}
                  title={`Xóa từ khóa ${column.label}`}
                  className="absolute right-2 rounded p-0.5 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}

        {filterableColumns.map((column) => {
          const rawValue = table.getFilterValue(column.id);
          const selectedValues = Array.isArray(rawValue)
            ? rawValue
            : typeof rawValue === 'string' && rawValue.length > 0
              ? rawValue.split(',').filter(Boolean)
              : [];

          return (
            <DataTableFacetedFilter
              key={column.id}
              columnId={column.id}
              title={column.label}
              options={column.options ?? []}
              selectedValues={selectedValues}
              facetCounts={facetCounts?.[column.id]}
              onChange={(nextValues) => table.setFilterValue(column.id, nextValues)}
            />
          );
        })}

        {table.isFiltered && (
          <button
            type="button"
            onClick={() => table.resetFilters()}
            aria-label="Xóa tất cả bộ lọc và đặt lại bảng"
            title="Xóa tất cả bộ lọc đang áp dụng"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Xóa bộ lọc</span>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {toolbarActions}
        <DataTableViewOptions
          columns={table.columns}
          columnVisibility={table.columnVisibility}
          density={table.density}
          onToggleColumnVisibility={table.setColumnVisibility}
          onChangeDensity={table.setDensity}
        />
      </div>
    </div>
  );
}
