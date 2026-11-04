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
 */

'use client';

import React from 'react';
import { Search, X } from 'lucide-react';

export interface DataTableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filtersSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  viewOptionsSlot?: React.ReactNode;
  isFiltered?: boolean;
  onResetFilters?: () => void;
  className?: string;
  debounceMs?: number;
  table?: any;
}

export function createDebouncedSearch(
  onSearchChange: ((val: string) => void) | undefined,
  delay: number = 300
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    type: (val: string) => {
      if (timer) clearTimeout(timer);
      if (delay <= 0) {
        onSearchChange?.(val);
      } else {
        timer = setTimeout(() => {
          onSearchChange?.(val);
        }, delay);
      }
    },
    clear: () => {
      if (timer) clearTimeout(timer);
      onSearchChange?.('');
    },
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export function DataTableToolbar({
  searchValue = '',
  onSearchChange,
  searchPlaceholder = 'Tìm kiếm dữ liệu...',
  filtersSlot,
  actionsSlot,
  viewOptionsSlot,
  isFiltered = false,
  onResetFilters,
  className = '',
  debounceMs = 300,
}: DataTableToolbarProps) {
  // Only local state allowed: the search box's in-progress text (BR-UI-01)
  const [draftSearch, setDraftSearch] = React.useState(searchValue || '');

  // Keep latest callback in ref so scheduled timers invoke the latest function
  const searchCallbackRef = React.useRef(onSearchChange);
  React.useEffect(() => {
    searchCallbackRef.current = onSearchChange;
  }, [onSearchChange]);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDispatchedRef = React.useRef<string | null>(null);
  const isPopstateRef = React.useRef(false);

  React.useEffect(() => {
    const handlePopstate = () => {
      isPopstateRef.current = true;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handlePopstate);
      return () => window.removeEventListener('popstate', handlePopstate);
    }
  }, []);

  // Reset to URL value whenever the committed URL value changes (BR-UI-01)
  React.useEffect(() => {
    if (isPopstateRef.current) {
      isPopstateRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDraftSearch(searchValue || '');
      return;
    }

    // If searchValue matches our own in-flight dispatch and user is actively drafting newer text, preserve newer draft
    if (
      lastDispatchedRef.current !== null &&
      searchValue === lastDispatchedRef.current &&
      timerRef.current !== null
    ) {
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDraftSearch(searchValue || '');
  }, [searchValue]);

  // Drop scheduled debounce when the toolbar unmounts
  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDraftSearch(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (debounceMs <= 0) {
      lastDispatchedRef.current = val;
      searchCallbackRef.current?.(val);
    } else {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastDispatchedRef.current = val;
        searchCallbackRef.current?.(val);
      }, debounceMs);
    }
  };

  const handleClear = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastDispatchedRef.current = '';
    setDraftSearch('');
    searchCallbackRef.current?.('');
  };

  const handleReset = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    lastDispatchedRef.current = '';
    setDraftSearch('');
    onResetFilters?.();
  };

  return (
    <div
      className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 bg-[var(--bg-card)] border-b border-[var(--border-subtle)] ${className}`}
    >
      {/* Left side: Search input and Faceted filters */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange !== undefined && (
          <div className="relative w-full sm:w-64 max-w-sm">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={draftSearch}
              onChange={handleInputChange}
              aria-label={searchPlaceholder}
              className="w-full h-8 pl-8 pr-7 text-xs rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] transition-colors"
            />
            {draftSearch && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Xóa nội dung tìm kiếm"
                title="Xóa nội dung tìm kiếm"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-dim)] hover:text-[var(--text-primary)] rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {filtersSlot}

        {isFiltered && onResetFilters && (
          <button
            type="button"
            onClick={handleReset}
            aria-label="Đặt lại tất cả bộ lọc"
            title="Đặt lại tất cả bộ lọc"
            className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-[6px] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary-subtle)] transition-colors cursor-pointer"
          >
            <span>Đặt lại bộ lọc</span>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Right side: Actions & Column View Options */}
      <div className="flex items-center gap-2 self-end sm:self-auto">
        {actionsSlot}
        {viewOptionsSlot}
      </div>
    </div>
  );
}
