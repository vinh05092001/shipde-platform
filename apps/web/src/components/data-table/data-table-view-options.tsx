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

import React, { useEffect, useRef, useState } from 'react';
import { Check, Columns, Rows } from 'lucide-react';
import type { ServerDataTableColumnDef, TableDensity, VisibilityState } from './types';

export interface DataTableViewOptionsProps<TData> {
  columns: ServerDataTableColumnDef<TData>[];
  columnVisibility: VisibilityState;
  density: TableDensity;
  onToggleColumnVisibility: (columnId: string, visible: boolean) => void;
  onChangeDensity: (density: TableDensity) => void;
}

export function DataTableViewOptions<TData>({
  columns,
  columnVisibility,
  density,
  onToggleColumnVisibility,
  onChangeDensity,
}: DataTableViewOptionsProps<TData>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hideableColumns = columns.filter((col) => col.enableHiding !== false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Mật độ dòng bảng dữ liệu"
        className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-slate-100/80 p-0.5"
      >
        <button
          type="button"
          onClick={() => onChangeDensity('compact')}
          aria-pressed={density === 'compact'}
          title="Chế độ dòng thu gọn (36px) tối ưu vận hành mật độ cao"
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
            density === 'compact'
              ? 'bg-white text-slate-900 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Rows className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Thu gọn</span>
        </button>
        <button
          type="button"
          onClick={() => onChangeDensity('comfortable')}
          aria-pressed={density === 'comfortable'}
          title="Chế độ dòng tiêu chuẩn (48px)"
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
            density === 'comfortable'
              ? 'bg-white text-slate-900 shadow-xs font-semibold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>Tiêu chuẩn</span>
        </button>
      </div>

      {hideableColumns.length > 0 && (
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-label="Tùy chỉnh hiển thị cột"
            aria-expanded={open}
            aria-haspopup="menu"
            title="Ẩn hoặc hiện các cột dữ liệu"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
          >
            <Columns className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>Hiển thị cột</span>
          </button>

          {open && (
            <div
              role="menu"
              aria-label="Danh sách cột hiển thị"
              className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
            >
              <div className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Chọn cột hiển thị
              </div>
              <div className="my-1 border-t border-slate-100" role="separator" />
              {hideableColumns.map((column) => {
                const isVisible = columnVisibility[column.id] !== false;
                return (
                  <button
                    key={column.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isVisible}
                    onClick={() => onToggleColumnVisibility(column.id, !isVisible)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600"
                  >
                    <span className="truncate">{column.header}</span>
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        isVisible
                          ? 'border-orange-600 bg-orange-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                      aria-hidden="true"
                    >
                      {isVisible && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
