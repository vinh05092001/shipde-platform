'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface SharedListStateOptions<TFilters extends Record<string, string>> {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
  defaultSearch?: string;
  defaultFilters: TFilters;
  syncUrl?: boolean;
}

export interface SharedListState<TFilters extends Record<string, string>> {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  filters: TFilters;
  hasActiveFilters: boolean;
  setPage: (newPage: number) => void;
  setPageSize: (newPageSize: number) => void;
  setSort: (field: string) => void;
  setSearch: (query: string) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  resetFilters: () => void;
  getUrlSearchParams: () => URLSearchParams;
}

/**
 * Safely reads a search param from window.location.search if in browser.
 */
function getInitialParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  } catch {
    return null;
  }
}

export function useSharedListState<TFilters extends Record<string, string>>(
  options: SharedListStateOptions<TFilters>
): SharedListState<TFilters> {
  const {
    defaultPage = 1,
    defaultPageSize = 20,
    defaultSortBy = 'created_at',
    defaultSortOrder = 'desc',
    defaultSearch = '',
    defaultFilters,
    syncUrl = true,
  } = options;

  // Initialize from URL or default
  const [page, setPageState] = useState<number>(() => {
    const p = getInitialParam('page');
    if (p && /^\d+$/.test(p) && Number(p) > 0) return Number(p);
    return defaultPage;
  });

  const [pageSize, setPageSizeState] = useState<number>(() => {
    const s = getInitialParam('limit') || getInitialParam('pageSize');
    if (s && /^\d+$/.test(s) && Number(s) > 0) return Number(s);
    return defaultPageSize;
  });

  const [sortBy, setSortBy] = useState<string>(() => {
    return getInitialParam('sort_by') || getInitialParam('sortBy') || defaultSortBy;
  });

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const o = getInitialParam('sort_order') || getInitialParam('sortOrder');
    return o === 'asc' || o === 'desc' ? o : defaultSortOrder;
  });

  const [search, setSearchState] = useState<string>(() => {
    return getInitialParam('search') || getInitialParam('q') || defaultSearch;
  });

  const [filters, setFiltersState] = useState<TFilters>(() => {
    const initial: Record<string, string> = { ...defaultFilters };
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        for (const key of Object.keys(defaultFilters)) {
          const val = params.get(key);
          if (val !== null) {
            initial[key] = val;
          }
        }
      } catch {
        // Fallback to defaultFilters
      }
    }
    return initial as TFilters;
  });

  const hasActiveFilters = useMemo(() => {
    if (search.trim().length > 0) return true;
    for (const [key, value] of Object.entries(filters)) {
      const defVal = defaultFilters[key];
      if (value !== defVal && value !== 'ALL' && value !== '') {
        return true;
      }
    }
    return false;
  }, [search, filters, defaultFilters]);

  // Sync state to URL if enabled
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      // Page
      if (page > 1) {
        params.set('page', String(page));
      } else {
        params.delete('page');
      }

      // Page size
      if (pageSize !== defaultPageSize) {
        params.set('limit', String(pageSize));
      } else {
        params.delete('limit');
      }

      // Sort
      if (sortBy !== defaultSortBy) {
        params.set('sort_by', sortBy);
      } else {
        params.delete('sort_by');
      }
      if (sortOrder !== defaultSortOrder) {
        params.set('sort_order', sortOrder);
      } else {
        params.delete('sort_order');
      }

      // Search
      if (search.trim().length > 0) {
        params.set('search', search.trim());
      } else {
        params.delete('search');
        params.delete('q');
      }

      // Filters
      for (const [key, val] of Object.entries(filters)) {
        const def = defaultFilters[key];
        if (val && val !== def && val !== 'ALL') {
          params.set(key, val);
        } else {
          params.delete(key);
        }
      }

      const queryString = params.toString();
      const newUrl = `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', newUrl);
    } catch {
      // Ignore URL manipulation failures in restricted environments
    }
  }, [
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    filters,
    syncUrl,
    defaultPageSize,
    defaultSortBy,
    defaultSortOrder,
    defaultFilters,
  ]);

  const setPage = useCallback((newPage: number) => {
    setPageState(Math.max(1, newPage));
  }, []);

  const setPageSize = useCallback((newPageSize: number) => {
    setPageSizeState(newPageSize);
    setPageState(1);
  }, []);

  const setSort = useCallback((field: string) => {
    setSortBy((prevSort) => {
      if (prevSort === field) {
        setSortOrder((prevOrder) => (prevOrder === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortOrder('asc');
      }
      return field;
    });
    setPageState(1);
  }, []);

  const setSearch = useCallback((query: string) => {
    setSearchState(query);
    setPageState(1);
  }, []);

  const setFilter = useCallback(<K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setFiltersState((prev) => ({ ...prev, [key]: value }));
    setPageState(1);
  }, []);

  const resetFilters = useCallback(() => {
    setSearchState(defaultSearch);
    setFiltersState(defaultFilters);
    setPageState(1);
  }, [defaultSearch, defaultFilters]);

  const getUrlSearchParams = useCallback(() => {
    const p = new URLSearchParams();
    if (page > 1) p.set('page', String(page));
    p.set('limit', String(pageSize));
    p.set('sort_by', sortBy);
    p.set('sort_order', sortOrder);
    if (search.trim()) p.set('search', search.trim());
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== 'ALL') p.set(k, v);
    }
    return p;
  }, [page, pageSize, sortBy, sortOrder, search, filters]);

  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    filters,
    hasActiveFilters,
    setPage,
    setPageSize,
    setSort,
    setSearch,
    setFilter,
    resetFilters,
    getUrlSearchParams,
  };
}

/**
 * In-memory client-side pagination, filter, and sort helper.
 */
export function paginateInMemory<T>(params: {
  items: readonly T[];
  page: number;
  pageSize: number;
  filterFn?: (item: T) => boolean;
  sortFn?: (a: T, b: T) => number;
}): {
  pagedItems: T[];
  total: number;
  totalPages: number;
  from: number;
  to: number;
} {
  const { items, page, pageSize, filterFn, sortFn } = params;
  let filtered = filterFn ? items.filter(filterFn) : [...items];
  if (sortFn) {
    filtered = filtered.sort(sortFn);
  }
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const skip = (safePage - 1) * pageSize;
  const pagedItems = filtered.slice(skip, skip + pageSize);
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + pageSize, total);

  return {
    pagedItems,
    total,
    totalPages,
    from,
    to,
  };
}
