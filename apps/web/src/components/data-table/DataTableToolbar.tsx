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

interface DataTableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filtersSlot?: React.ReactNode;
  actionsSlot?: React.ReactNode;
  viewOptionsSlot?: React.ReactNode;
  isFiltered?: boolean;
  onResetFilters?: () => void;
  className?: string;
  // useDataTable historyEpoch: increments on every browser Back/Forward
  // (popstate). When it changes, the incoming searchValue (even an unchanged
  // one) is a navigation, not an acknowledgment of pending edits.
  historyEpoch?: number;
  // useDataTable resetEpoch: increments on explicit filter resets.
  resetEpoch?: number;
}

/**
 * Computes the synchronized draft for the search input when external/committed
 * searchValue prop changes (Finding 5).
 * Distinguishes acknowledgments of older local edits from external navigation.
 *
 * Review item 3: `navigationEvent` marks changes driven by a real browser
 * history navigation (Back/Forward popstate, surfaced as useDataTable
 * `historyEpoch`). Such a change is NEVER an acknowledgment of a pending
 * local edit, even when the incoming value happens to match an older pending
 * edit (e.g. draft "Ngu", committed "N", pending ["Ng","Ngu"] and Back to an
 * existing "Ng" entry): the draft resynchronizes to the URL value and the
 * pending edit tracking is discarded.
 *
 * Finding 4 P1: `resetEvent` marks changes driven by an explicit filter reset.
 */
export function computeToolbarDraftOnPropChange(
  currentDraft: string,
  incomingSearchValue: string | undefined | null,
  prevSearchValue: string | undefined | null,
  pendingEdits: string[],
  navigationEvent = false,
  resetEvent = false
): {
  nextDraft: string;
  nextPrevSearchValue: string;
  nextPendingEdits: string[];
  wasIgnoredDueToPendingEdits: boolean;
} {
  const incoming = incomingSearchValue || '';
  const prev = prevSearchValue || '';

  if (resetEvent) {
    // Explicit filter reset: apply the reset's target value ('') immediately.
    // If incoming still contains the old committed search text, retain prev
    // and enqueue '' as a pending edit so that delayed reset navigation
    // does not repopulate the old search text while in-flight (Finding 11 P2).
    const isOldSearchPendingClear = incoming !== '';
    return {
      nextDraft: '',
      nextPrevSearchValue: isOldSearchPendingClear ? prev : '',
      nextPendingEdits: isOldSearchPendingClear ? [''] : [],
      wasIgnoredDueToPendingEdits: false,
    };
  }

  if (navigationEvent) {
    // Explicit browser/history navigation: resynchronize draft to incoming URL value
    // and drop pending edit tracking. Never treat as an acknowledgment.
    return {
      nextDraft: incoming,
      nextPrevSearchValue: incoming,
      nextPendingEdits: [],
      wasIgnoredDueToPendingEdits: false,
    };
  }

  if (incoming === prev) {
    return {
      nextDraft: currentDraft,
      nextPrevSearchValue: prev,
      nextPendingEdits: pendingEdits,
      wasIgnoredDueToPendingEdits: false,
    };
  }

  const pendingIdx = pendingEdits.indexOf(incoming);
  if (pendingIdx !== -1) {
    const nextPending = pendingEdits.slice(pendingIdx + 1);
    if (nextPending.length === 0) {
      // All pending local edits are acknowledged; align draft with incoming
      return {
        nextDraft: incoming,
        nextPrevSearchValue: incoming,
        nextPendingEdits: nextPending,
        wasIgnoredDueToPendingEdits: false,
      };
    } else {
      // User typed newer edits, ignore older acknowledgment to avoid overwriting newer draft
      return {
        nextDraft: currentDraft,
        nextPrevSearchValue: incoming,
        nextPendingEdits: nextPending,
        wasIgnoredDueToPendingEdits: true,
      };
    }
  } else {
    // External navigation: reset draft and clear pending edits
    return {
      nextDraft: incoming,
      nextPrevSearchValue: incoming,
      nextPendingEdits: [],
      wasIgnoredDueToPendingEdits: false,
    };
  }
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
  historyEpoch = 0,
  resetEpoch = 0,
}: DataTableToolbarProps) {
  // Maintain an immediately updated input draft to preserve spaces and avoid pending-navigation lag
  const [prevSearchValue, setPrevSearchValue] = React.useState(searchValue);
  const [draftSearch, setDraftSearch] = React.useState(searchValue || '');
  const [pendingEdits, setPendingEdits] = React.useState<string[]>([]);
  const [prevHistoryEpoch, setPrevHistoryEpoch] = React.useState(historyEpoch);
  const [prevResetEpoch, setPrevResetEpoch] = React.useState(resetEpoch);

  // Synchronize draft when external/committed searchValue prop changes, a
  // browser history navigation (Back/Forward) occurs, or an explicit filter reset is triggered.
  if (
    searchValue !== prevSearchValue ||
    historyEpoch !== prevHistoryEpoch ||
    resetEpoch !== prevResetEpoch
  ) {
    const result = computeToolbarDraftOnPropChange(
      draftSearch,
      searchValue,
      prevSearchValue,
      pendingEdits,
      historyEpoch !== prevHistoryEpoch,
      resetEpoch !== prevResetEpoch
    );
    setPrevSearchValue(result.nextPrevSearchValue);
    setPrevHistoryEpoch(historyEpoch);
    setPrevResetEpoch(resetEpoch);
    setPendingEdits(result.nextPendingEdits);
    if (result.nextDraft !== draftSearch) {
      setDraftSearch(result.nextDraft);
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextVal = e.target.value;
    setDraftSearch(nextVal);
    setPendingEdits((prev) => [...prev, nextVal]);
    onSearchChange?.(nextVal);
  };

  const handleClear = () => {
    setDraftSearch('');
    setPendingEdits((prev) => [...prev, '']);
    onSearchChange?.('');
  };

  const handleReset = () => {
    setDraftSearch('');
    setPendingEdits(['']);
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
