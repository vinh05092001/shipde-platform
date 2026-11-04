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
 * Toolbar with search input, faceted filter controls, reset button, and view options.
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
  resetEpoch?: number;
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
  resetEpoch = 0,
}: DataTableToolbarProps) {
  // Only local state allowed: the search box's in-progress text (BR-UI-01)
  const [draftSearch, setDraftSearch] = React.useState(searchValue || '');

  // Keep latest callback in ref so scheduled timers invoke the latest function
  const searchCallbackRef = React.useRef(onSearchChange);
  React.useEffect(() => {
    searchCallbackRef.current = onSearchChange;
  }, [onSearchChange]);

  const debouncedSearchRef = React.useRef<ReturnType<typeof createDebouncedSearch> | null>(null);
  const getDebouncedSearch = () => {
    if (debouncedSearchRef.current === null) {
      debouncedSearchRef.current = createDebouncedSearch((val) => {
        searchCallbackRef.current?.(val);
      }, debounceMs);
    }
    return debouncedSearchRef.current;
  };

  // Reset to URL value whenever the committed URL value changes (one useEffect on that value)
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset search draft when URL search param or reset epoch changes (BR-UI-01)
    setDraftSearch(searchValue || '');
    debouncedSearchRef.current?.cancel();
  }, [searchValue, resetEpoch]);

  // Drop scheduled debounce when the toolbar unmounts
  React.useEffect(() => {
    return () => {
      debouncedSearchRef.current?.cancel();
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftSearch(e.target.value);
    getDebouncedSearch().type(e.target.value);
  };

  const handleClear = () => {
    setDraftSearch('');
    getDebouncedSearch().clear();
  };

  const handleReset = () => {
    setDraftSearch('');
    getDebouncedSearch().cancel();
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
