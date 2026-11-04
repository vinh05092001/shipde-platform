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
 * Sort menu dropdown for DataTableColumnHeader with arrow-key menu navigation.
 */

'use client';

import React from 'react';
import { ArrowDown, ArrowUp, EyeOff } from 'lucide-react';
import { ColumnDef } from './types';

interface DataTableColumnHeaderMenuProps<TData = any> {
  column: ColumnDef<TData>;
  title: string;
  isSorted: false | 'asc' | 'desc';
  hasHide: boolean;
  onSort: (columnId: string, desc: boolean) => void;
  onHide?: (columnId: string) => void;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  menuRef: React.RefObject<HTMLDivElement | null>;
  menuItemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  isMounted: boolean;
  menuPosition: { top: number; left: number } | null;
}

export function DataTableColumnHeaderMenu<TData = any>({
  column,
  title,
  isSorted,
  hasHide,
  onSort,
  onHide,
  setIsOpen,
  menuRef,
  menuItemRefs,
  isMounted,
  menuPosition,
}: DataTableColumnHeaderMenuProps<TData>) {
  const totalMenuItems = hasHide ? 3 : 2;

  const handleMenuItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (index + 1) % totalMenuItems;
      menuItemRefs.current[nextIdx]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (index - 1 + totalMenuItems) % totalMenuItems;
      menuItemRefs.current[prevIdx]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      menuItemRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      menuItemRefs.current[totalMenuItems - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
      <div
        ref={menuRef}
        role="menu"
        aria-label={`Tùy chọn cho cột ${title}`}
        className={`${
          isMounted && typeof document !== 'undefined'
            ? 'fixed z-50'
            : 'absolute left-0 top-full mt-1.5 z-30'
        } w-44 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100`}
        style={
          isMounted && typeof document !== 'undefined'
            ? {
                top: menuPosition ? `${menuPosition.top}px` : undefined,
                left: menuPosition ? `${menuPosition.left}px` : undefined,
                visibility: menuPosition ? 'visible' : 'hidden',
              }
            : undefined
        }
      >
        <button
          ref={(el) => {
            menuItemRefs.current[0] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={0}
          onClick={() => {
            onSort(column.id, false);
            setIsOpen(false);
          }}
          onKeyDown={(e) => handleMenuItemKeyDown(e, 0)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
            isSorted === 'asc'
              ? 'font-semibold text-[var(--primary)] bg-[var(--primary-subtle)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
          }`}
        >
          <ArrowUp className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span>Tăng dần</span>
        </button>

        <button
          ref={(el) => {
            menuItemRefs.current[1] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => {
            onSort(column.id, true);
            setIsOpen(false);
          }}
          onKeyDown={(e) => handleMenuItemKeyDown(e, 1)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] ${
            isSorted === 'desc'
              ? 'font-semibold text-[var(--primary)] bg-[var(--primary-subtle)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]'
          }`}
        >
          <ArrowDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span>Giảm dần</span>
        </button>

        {hasHide && (
          <>
            <div className="h-px bg-[var(--border-subtle)] my-1" />
            <button
              ref={(el) => {
                menuItemRefs.current[2] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                onHide!(column.id);
                setIsOpen(false);
              }}
              onKeyDown={(e) => handleMenuItemKeyDown(e, 2)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--text-dim)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
            >
              <EyeOff className="w-3.5 h-3.5 text-[var(--text-dim)]" aria-hidden="true" />
              <span>Ẩn cột này</span>
            </button>
          </>
        )}
      </div>
  );
}
