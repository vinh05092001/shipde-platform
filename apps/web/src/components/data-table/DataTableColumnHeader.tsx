/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 * License: MIT
 *
 * Column header with sorting controls and accessible ARIA attributes.
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, X } from 'lucide-react';
import { ColumnDef, ColumnSort } from './types';

interface DataTableColumnHeaderProps<TData = any> {
  column: ColumnDef<TData>;
  title: string;
  sort?: ColumnSort | null;
  onSort?: (columnId: string, desc?: boolean) => void;
  onHide?: (columnId: string) => void;
  className?: string;
}

export function DataTableColumnHeader<TData = any>({
  column,
  title,
  sort,
  onSort,
  onHide,
  className = '',
}: DataTableColumnHeaderProps<TData>) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isSorted = sort?.id === column.id ? (sort.desc ? 'desc' : 'asc') : null;

  // Close dropdown on outside click or escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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

  if (column.enableSorting === false || !onSort) {
    return (
      <div
        className={`text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider ${className}`}
      >
        {title}
      </div>
    );
  }

  const ariaSort = isSorted === 'asc' ? 'ascending' : isSorted === 'desc' ? 'descending' : 'none';

  return (
    <div className={`relative inline-flex items-center gap-1 ${className}`} ref={dropdownRef}>
      <button
        type="button"
        aria-label={`Sắp xếp theo ${title}: hiện tại ${isSorted === 'asc' ? 'tăng dần' : isSorted === 'desc' ? 'giảm dần' : 'chưa sắp xếp'}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group inline-flex items-center gap-1.5 px-1.5 py-1 -ml-1.5 rounded-[6px] text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors cursor-pointer"
      >
        <span>{title}</span>
        {isSorted === 'desc' ? (
          <ArrowDown className="w-3.5 h-3.5 text-[var(--primary)]" aria-hidden="true" />
        ) : isSorted === 'asc' ? (
          <ArrowUp className="w-3.5 h-3.5 text-[var(--primary)]" aria-hidden="true" />
        ) : (
          <ArrowUpDown
            className="w-3.5 h-3.5 text-[var(--text-dim)] group-hover:text-[var(--text-secondary)]"
            aria-hidden="true"
          />
        )}
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={`Tùy chọn cho cột ${title}`}
          className="absolute left-0 top-full mt-1.5 w-44 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg py-1 z-30 animate-in fade-in zoom-in-95 duration-100"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSort(column.id, false);
              setIsOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:bg-[var(--bg-subtle)] focus-visible:bg-[var(--bg-subtle)] focus-visible:outline-none transition-colors ${
              isSorted === 'asc'
                ? 'text-[var(--primary)] font-semibold'
                : 'text-[var(--text-primary)]'
            }`}
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sắp xếp tăng dần</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onSort(column.id, true);
              setIsOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:bg-[var(--bg-subtle)] focus-visible:bg-[var(--bg-subtle)] focus-visible:outline-none transition-colors ${
              isSorted === 'desc'
                ? 'text-[var(--primary)] font-semibold'
                : 'text-[var(--text-primary)]'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sắp xếp giảm dần</span>
          </button>

          {isSorted !== null && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSort(column.id); // Toggle or clear
                setIsOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:bg-[var(--bg-subtle)] focus-visible:bg-[var(--bg-subtle)] focus-visible:outline-none text-[var(--text-muted)] transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Xóa sắp xếp</span>
            </button>
          )}

          {column.enableHiding !== false && onHide && (
            <>
              <div className="h-px bg-[var(--border-subtle)] my-1" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onHide(column.id);
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer hover:bg-[var(--bg-subtle)] focus-visible:bg-[var(--bg-subtle)] focus-visible:outline-none text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ẩn cột này</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
