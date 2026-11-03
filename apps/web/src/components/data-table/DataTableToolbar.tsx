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
  // useDataTable resetEpoch: increments on explicit filter resets.
  resetEpoch?: number;
}

/**
 * Computes the synchronized draft for the search input when the committed
 * searchValue prop changes or an explicit filter reset occurs.
 *
 * BR-UI-01: the committed URL is the single source of truth; the local draft
 * is only the debounced input text. Changes that may be treated as mere
 * acknowledgments of this toolbar's own requests are: one matching
 * `lastSentSearch` — the last value the toolbar itself dispatched to the
 * router — and, while a newer intent is still unsent, a commit of an earlier
 * value found in `sentSearchLog` — the values this toolbar dispatched but has
 * not seen committed yet (Round 41 finding 6). Every other committed change
 * (external Link navigation, Back/Forward, or a commit superseded by newer
 * local typing) is authoritative: the draft resynchronizes to the URL value
 * and any unsent debounced search is cancelled, so it can never override the
 * navigation (Round 39 findings 2 and 4, Round 40 finding 2).
 *
 * Finding 4 P1: `resetEvent` marks changes driven by an explicit filter reset.
 */
export function computeToolbarDraftOnPropChange(
  currentDraft: string,
  incomingSearchValue: string | undefined | null,
  prevSearchValue: string | undefined | null,
  lastSentSearch: string | undefined | null,
  resetEvent = false,
  sentSearchLog: string[] = []
): {
  nextDraft: string;
  nextPrevSearchValue: string;
  shouldCancelDebounce: boolean;
} {
  const incoming = incomingSearchValue || '';
  const prev = prevSearchValue || '';
  const lastSent = lastSentSearch || '';

  if (resetEvent) {
    // Explicit filter reset: apply the reset's target value ('') immediately.
    // If incoming still contains the old committed search text, retain prev so
    // the delayed cleared commit is recognized as the reset's own target and
    // does not repopulate the old search text while in-flight (Finding 11 P2).
    return {
      nextDraft: '',
      nextPrevSearchValue: incoming !== '' ? prev : '',
      shouldCancelDebounce: true,
    };
  }

  if (incoming === prev) {
    return {
      nextDraft: currentDraft,
      nextPrevSearchValue: prev,
      shouldCancelDebounce: false,
    };
  }

  if (incoming === lastSent) {
    // Acknowledgment of this toolbar's own latest dispatched request: keep the
    // draft (the user may have typed newer text while the request was in
    // flight) and keep its debounce timer alive.
    return {
      nextDraft: currentDraft,
      nextPrevSearchValue: incoming,
      shouldCancelDebounce: false,
    };
  }

  // Intermediate acknowledgment of an earlier owned request while the latest
  // dispatched request is still pending and no newer unsent text is drafted
  // (currentDraft === lastSent, Finding 2 P1). Preserve the latest dispatched intent.
  // If the user typed newer unsent draft (currentDraft !== lastSent), an authoritative
  // external navigation colliding with an earlier owned request (e.g. Link to ?search=N)
  // discards cancelled unsent intent and resyncs to the URL (Finding 1 P1).
  if (currentDraft === lastSent && sentSearchLog.indexOf(incoming) !== -1) {
    return {
      nextDraft: currentDraft,
      nextPrevSearchValue: incoming,
      shouldCancelDebounce: false,
    };
  }

  // The committed URL differs from what this toolbar last dispatched: an
  // external navigation, Back/Forward, or a cancelled intermediate edit
  // committed late. The URL wins — restore the displayed value and discard
  // unsent local edits.
  return {
    nextDraft: incoming,
    nextPrevSearchValue: incoming,
    shouldCancelDebounce: true,
  };
}

/**
 * Prunes the owned dispatched-request log after a commit. When the committed
 * value was dispatched by this toolbar, everything at or before it is now
 * acknowledged (removed); later owned entries remain pending (Round 41
 * finding 6). A value never dispatched here clears the log entirely.
 */
export function advanceSentSearchLog(sentSearchLog: string[], committed: string): string[] {
  const idx = sentSearchLog.indexOf(committed);
  if (idx === -1) return [];
  return sentSearchLog.slice(idx + 1);
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
  // Maintain an immediately updated input draft to preserve spaces and avoid pending-navigation lag
  const [prevSearchValue, setPrevSearchValue] = React.useState(searchValue);
  const [draftSearch, setDraftSearch] = React.useState(searchValue || '');
  const [prevResetEpoch, setPrevResetEpoch] = React.useState(resetEpoch);

  // Last search value this toolbar dispatched to the router. A commit of this
  // value, or of an earlier still-unacknowledged entry of `sentSearchLogRef`,
  // acknowledges the toolbar's own request (Finding 2 P1, Round 41 finding 6).
  const [lastSentSearch, setLastSentSearch] = React.useState(searchValue);

  // Values dispatched by this toolbar whose commits have not arrived yet,
  // oldest first. Lets a late acknowledgment of an earlier own request be
  // recognized instead of being misread as external navigation (finding 6).
  const [sentSearchLog, setSentSearchLog] = React.useState<string[]>([]);
  const [authoritativeCommitToken, setAuthoritativeCommitToken] = React.useState(0);

  // Keep the latest callback without ever replacing the debounce object, so a
  // timer scheduled before a parent rerender is never abandoned (Finding 3 P1).
  const searchCallbackRef = React.useRef(onSearchChange);
  React.useEffect(() => {
    searchCallbackRef.current = onSearchChange;
  }, [onSearchChange]);

  // Latest draft, mirrored in a ref so a firing debounce timer can detect
  // that an authoritative navigation already replaced it and stay silent
  // instead of overriding the URL (Finding 4 P1).
  const draftRef = React.useRef(searchValue || '');
  React.useEffect(() => {
    draftRef.current = draftSearch;
  }, [draftSearch]);

  // Single debounce object, created lazily in event handlers and never
  // replaced, so scheduled timers always belong to the live object.
  const debouncedSearchRef = React.useRef<ReturnType<typeof createDebouncedSearch> | null>(null);
  const getDebouncedSearch = () => {
    if (debouncedSearchRef.current === null) {
      debouncedSearchRef.current = createDebouncedSearch((val) => {
        if (draftRef.current !== val) return;
        // Record this dispatched value as owned-but-unacknowledged so its
        // later commit is recognized as our own acknowledgment (finding 6).
        setSentSearchLog((prev) => [...prev, val]);
        setLastSentSearch(val);
        searchCallbackRef.current?.(val);
      }, debounceMs);
    }
    return debouncedSearchRef.current;
  };

  // Cancel unsent debounced text ONLY when the prop-synchronization pass
  // classified a commit as authoritative (external Link, Back/Forward, or a
  // commit superseded by newer local typing). Round 41 finding 1: this must
  // not run in the effect's cleanup, because a cleanup fires on every
  // dep change — including the toolbar's OWN acknowledgment — where it would
  // wrongly discard the newer unsent draft's timer. Acknowledgments (latest or
  // intermediate) keep the newer timer alive so it still dispatches (BR-UI-01).
  React.useEffect(() => {
    if (authoritativeCommitToken > 0) {
      debouncedSearchRef.current?.cancel();
    }
  }, [authoritativeCommitToken]);

  // Drop a scheduled debounce when the toolbar unmounts.
  React.useEffect(() => {
    return () => {
      debouncedSearchRef.current?.cancel();
    };
  }, []);

  // Authoritative browser history navigation (Back/Forward) discards unsent
  // search intent even when the committed search value itself is unchanged
  // (Round 41 finding 2, BR-UI-01): the render follows the URL, not the
  // abandoned draft. location already holds the history entry's URL here.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      debouncedSearchRef.current?.cancel();
      setSentSearchLog([]);
      const authoritative = new URLSearchParams(window.location.search).get('search') || '';
      draftRef.current = authoritative;
      setDraftSearch(authoritative);
      setLastSentSearch(authoritative);
      setPrevSearchValue(authoritative);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Synchronize draft when the committed searchValue prop changes or an
  // explicit filter reset is triggered. Unsent debounced edits are discarded
  // only on AUTHORITATIVE changes (the cancel effect below) so they can never
  // override the navigation, while acknowledgments of this toolbar's own
  // requests — latest or intermediate — preserve the newer draft (Findings 2 &
  // 4 P1, Round 41 findings 1 and 6, BR-UI-01).
  if (searchValue !== prevSearchValue || resetEpoch !== prevResetEpoch) {
    const result = computeToolbarDraftOnPropChange(
      draftSearch,
      searchValue,
      prevSearchValue,
      lastSentSearch,
      resetEpoch !== prevResetEpoch,
      sentSearchLog
    );
    setPrevSearchValue(result.nextPrevSearchValue);
    setPrevResetEpoch(resetEpoch);
    if (resetEpoch !== prevResetEpoch || result.shouldCancelDebounce) {
      // Explicit reset or authoritative external navigation: the toolbar abandons
      // all of its cancelled own requests and invalidates ownership markers (Finding 1 & 4 P1).
      setSentSearchLog([]);
    } else {
      // Commit acknowledged this toolbar's value (up to it, if intermediate).
      setSentSearchLog(advanceSentSearchLog(sentSearchLog, searchValue || ''));
    }
    if (result.shouldCancelDebounce) {
      setLastSentSearch(result.nextDraft);
      setAuthoritativeCommitToken((token) => token + 1);
    }
    if (result.nextDraft !== draftSearch) {
      setDraftSearch(result.nextDraft);
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    draftRef.current = e.target.value;
    setDraftSearch(e.target.value);
    getDebouncedSearch().type(e.target.value);
  };

  const handleClear = () => {
    draftRef.current = '';
    setDraftSearch('');
    getDebouncedSearch().clear();
  };

  const handleReset = () => {
    draftRef.current = '';
    getDebouncedSearch().cancel();
    setLastSentSearch('');
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
