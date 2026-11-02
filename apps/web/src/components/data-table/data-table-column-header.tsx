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
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, RotateCcw } from 'lucide-react';
import type { SortDirection } from './types';

export interface DataTableColumnHeaderProps {
  columnId: string;
  title: string;
  canSort?: boolean;
  canHide?: boolean;
  sortDirection?: SortDirection | false;
  align?: 'left' | 'center' | 'right';
  onToggleSort?: (columnId: string, desc?: boolean) => void;
  onClearSort?: (columnId: string) => void;
  onHideColumn?: (columnId: string) => void;
  className?: string;
}

export function DataTableColumnHeader({
  columnId,
  title,
  canSort = true,
  canHide = true,
  sortDirection = false,
  align = 'left',
  onToggleSort,
  onClearSort,
  onHideColumn,
  className = '',
}: DataTableColumnHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const alignClass =
    align === 'right'
      ? 'justify-end text-right'
      : align === 'center'
        ? 'justify-center text-center'
        : 'justify-start text-left';

  if (!canSort && !canHide) {
    return (
      <div
        className={`flex items-center text-xs font-semibold uppercase tracking-wider text-slate-500 ${alignClass} ${className}`}
      >
        <span>{title}</span>
      </div>
    );
  }

  const sortStatusLabel =
    sortDirection === 'asc'
      ? 'đang sắp xếp tăng dần'
      : sortDirection === 'desc'
        ? 'đang sắp xếp giảm dần'
        : 'chưa sắp xếp';

  return (
    <div ref={containerRef} className={`relative flex items-center ${alignClass} ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (canSort && onToggleSort && !canHide) {
            onToggleSort(columnId);
          } else {
            setMenuOpen((prev) => !prev);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && menuOpen) {
            e.stopPropagation();
            setMenuOpen(false);
          }
        }}
        aria-label={`Tùy chọn sắp xếp cột ${title} (${sortStatusLabel})`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`Sắp xếp hoặc tùy chỉnh cột ${title}`}
        className={`group inline-flex items-center gap-1.5 rounded-md px-2 py-1 -mx-2 text-xs font-semibold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 ${
          sortDirection
            ? 'bg-orange-50/80 text-orange-800'
            : 'text-slate-600 hover:bg-slate-200/60 hover:text-slate-900'
        }`}
      >
        <span>{title}</span>
        {canSort && (
          <span className="inline-flex items-center" aria-hidden="true">
            {sortDirection === 'asc' ? (
              <ArrowUp className="h-3.5 w-3.5 text-orange-700" />
            ) : sortDirection === 'desc' ? (
              <ArrowDown className="h-3.5 w-3.5 text-orange-700" />
            ) : (
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400 group-hover:text-slate-600" />
            )}
          </span>
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          aria-label={`Menu cột ${title}`}
          className={`absolute top-full z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 text-left shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {canSort && onToggleSort && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleSort(columnId, false);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sortDirection === 'asc'
                    ? 'bg-orange-50 text-orange-800 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ArrowUp className="h-3.5 w-3.5 text-slate-500" />
                <span>Sắp xếp tăng dần</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleSort(columnId, true);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  sortDirection === 'desc'
                    ? 'bg-orange-50 text-orange-800 font-semibold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ArrowDown className="h-3.5 w-3.5 text-slate-500" />
                <span>Sắp xếp giảm dần</span>
              </button>
              {sortDirection && onClearSort && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClearSort(columnId);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  <span>Mặc định (bỏ sắp xếp)</span>
                </button>
              )}
            </>
          )}

          {canSort && canHide && onHideColumn && (
            <div className="my-1 border-t border-slate-100" role="separator" />
          )}

          {canHide && onHideColumn && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onHideColumn(columnId);
                setMenuOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <EyeOff className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
              <span>Ẩn cột này</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
