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
 * Column visibility toggle menu.
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { ColumnDef } from './types';

interface DataTableViewOptionsProps<TData = any> {
  columns: ColumnDef<TData>[];
  hiddenColumns?: Set<string>;
  onToggleColumn: (columnId: string) => void;
  onResetColumns?: () => void;
  className?: string;
}

export function DataTableViewOptions<TData = any>({
  columns,
  hiddenColumns = new Set(),
  onToggleColumn,
  onResetColumns,
  className = '',
}: DataTableViewOptionsProps<TData>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleableColumns = columns.filter((col) => col.enableHiding !== false);

  if (toggleableColumns.length === 0) return null;

  return (
    <div className={`relative inline-block ${className}`} ref={containerRef}>
      <button
        type="button"
        aria-label="Tùy chọn hiển thị cột"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((prev) => !prev)}
        className="h-8 inline-flex items-center gap-1.5 px-3 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-card)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Cột hiển thị</span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Danh sách cột hiển thị"
          className="absolute right-0 top-full mt-1.5 w-48 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xl p-2 z-40 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-2 py-1">
            Hiển thị cột
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5 py-1">
            {toggleableColumns.map((column) => {
              const isVisible = !hiddenColumns.has(column.id);
              const title = typeof column.header === 'string' ? column.header : column.id;

              return (
                <button
                  key={column.id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={isVisible}
                  onClick={() => onToggleColumn(column.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] text-xs text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer select-none transition-colors"
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${
                      isVisible
                        ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
                        : 'border-[var(--border-strong)] bg-white'
                    }`}
                  >
                    {isVisible && <Check className="w-2.5 h-2.5 stroke-[3]" aria-hidden="true" />}
                  </div>
                  <span className="truncate">{title}</span>
                </button>
              );
            })}
          </div>

          {onResetColumns && hiddenColumns.size > 0 && (
            <>
              <div className="h-px bg-[var(--border-subtle)] my-1" />
              <button
                type="button"
                onClick={() => {
                  onResetColumns();
                  setIsOpen(false);
                }}
                className="w-full py-1 text-center text-[11px] text-[var(--primary)] hover:underline cursor-pointer"
              >
                Hiển thị tất cả
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
