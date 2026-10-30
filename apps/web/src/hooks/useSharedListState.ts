'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

export interface SavedView<TFilters extends Record<string, string>> {
  id: string;
  name: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
  filters: TFilters;
  createdAt: string;
}

export interface ColumnSettings {
  visibleColumns: string[];
  columnOrder?: string[];
}

export interface SharedListStateOptions<TFilters extends Record<string, string>> {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string;
  defaultSortOrder?: 'asc' | 'desc';
  defaultSearch?: string;
  defaultFilters: TFilters;
  syncUrl?: boolean;
  namespace?: string;
  listKey?: string;
  initialColumns?: string[];
}

export interface SharedListState<TFilters extends Record<string, string>> {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search: string;
  filters: TFilters;
  hasActiveFilters: boolean;
  savedViews: SavedView<TFilters>[];
  columnSettings: ColumnSettings;
  setPage: (newPage: number) => void;
  setPageSize: (newPageSize: number) => void;
  setSort: (field: string, direction?: 'asc' | 'desc') => void;
  setSortBy: (field: string) => void;
  setSortOrder: (order: 'asc' | 'desc' | ((prev: 'asc' | 'desc') => 'asc' | 'desc')) => void;
  setSearch: (query: string) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  resetFilters: () => void;
  getUrlSearchParams: () => URLSearchParams;
  saveCurrentView: (name: string) => SavedView<TFilters>;
  applySavedView: (viewId: string) => boolean;
  deleteSavedView: (viewId: string) => boolean;
  updateColumnSettings: (settings: Partial<ColumnSettings>) => void;
}

/**
 * Safely reads a search param from window.location.search if in browser.
 * When namespace is provided, only matches namespaced param (e.g. branch_page).
 */
function getInitialParam(key: string, namespace?: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (namespace) {
      const nsVal = params.get(`${namespace}_${key}`);
      if (nsVal !== null) return nsVal;
      return null;
    }
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
    namespace,
    listKey,
    initialColumns = [],
  } = options;

  // Initialize from URL or default
  const [page, setPageState] = useState<number>(() => {
    const p = getInitialParam('page', namespace);
    if (p && /^\d+$/.test(p) && Number(p) > 0) return Number(p);
    return defaultPage;
  });

  const [pageSize, setPageSizeState] = useState<number>(() => {
    const s =
      getInitialParam('limit', namespace) ||
      getInitialParam('pageSize', namespace) ||
      getInitialParam('size', namespace);
    if (s && /^\d+$/.test(s) && Number(s) > 0) return Number(s);
    return defaultPageSize;
  });

  const [sortBy, setSortBy] = useState<string>(() => {
    return (
      getInitialParam('sort_by', namespace) || getInitialParam('sortBy', namespace) || defaultSortBy
    );
  });

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const o = getInitialParam('sort_order', namespace) || getInitialParam('sortOrder', namespace);
    return o === 'asc' || o === 'desc' ? o : defaultSortOrder;
  });

  const [search, setSearchState] = useState<string>(() => {
    return getInitialParam('search', namespace) || getInitialParam('q', namespace) || defaultSearch;
  });

  const [filters, setFiltersState] = useState<TFilters>(() => {
    const initial: Record<string, string> = { ...defaultFilters };
    if (typeof window !== 'undefined') {
      try {
        const params = new URLSearchParams(window.location.search);
        for (const key of Object.keys(defaultFilters)) {
          const paramKey = namespace ? `${namespace}_${key}` : key;
          const val = params.get(paramKey);
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

  // Persisted saved views and column settings in localStorage (AC-COM-02-13)
  const prefStorageKey = `shipde_pref_${listKey || namespace || 'default'}`;

  const [savedViews, setSavedViews] = useState<SavedView<TFilters>[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(`${prefStorageKey}_views`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const [columnSettings, setColumnSettings] = useState<ColumnSettings>(() => {
    if (typeof window === 'undefined') return { visibleColumns: initialColumns };
    try {
      const raw = localStorage.getItem(`${prefStorageKey}_columns`);
      return raw ? JSON.parse(raw) : { visibleColumns: initialColumns };
    } catch {
      return { visibleColumns: initialColumns };
    }
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

  // Sync state to URL if enabled, strictly respecting namespace
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const pageKey = namespace ? `${namespace}_page` : 'page';
      const limitKey = namespace ? `${namespace}_limit` : 'limit';
      const sortByKey = namespace ? `${namespace}_sort_by` : 'sort_by';
      const sortOrderKey = namespace ? `${namespace}_sort_order` : 'sort_order';
      const searchKey = namespace ? `${namespace}_search` : 'search';

      // Page
      if (page > 1) {
        params.set(pageKey, String(page));
      } else {
        params.delete(pageKey);
      }

      // Page size
      if (pageSize !== defaultPageSize) {
        params.set(limitKey, String(pageSize));
      } else {
        params.delete(limitKey);
      }

      // Sort
      if (sortBy !== defaultSortBy) {
        params.set(sortByKey, sortBy);
      } else {
        params.delete(sortByKey);
      }
      if (sortOrder !== defaultSortOrder) {
        params.set(sortOrderKey, sortOrder);
      } else {
        params.delete(sortOrderKey);
      }

      // Search
      if (search.trim().length > 0) {
        params.set(searchKey, search.trim());
      } else {
        params.delete(searchKey);
        if (!namespace) params.delete('q');
      }

      // Filters
      for (const [key, val] of Object.entries(filters)) {
        const filterKey = namespace ? `${namespace}_${key}` : key;
        const def = defaultFilters[key];
        if (val && val !== def && val !== 'ALL') {
          params.set(filterKey, val);
        } else {
          params.delete(filterKey);
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
    namespace,
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

  // Atomic sort update: updates field and direction atomically, resetting page to 1
  const setSort = useCallback((field: string, direction?: 'asc' | 'desc') => {
    setSortBy((prevSort) => {
      if (direction) {
        setSortOrder(direction);
      } else if (prevSort === field) {
        setSortOrder((prevOrder) => (prevOrder === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortOrder('asc');
      }
      return field;
    });
    setPageState(1);
  }, []);

  const setSortByDirect = useCallback((field: string) => {
    setSortBy(field);
    setPageState(1);
  }, []);

  const setSortOrderDirect = useCallback(
    (order: 'asc' | 'desc' | ((prev: 'asc' | 'desc') => 'asc' | 'desc')) => {
      setSortOrder(order);
      setPageState(1);
    },
    []
  );

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
    const pageKey = namespace ? `${namespace}_page` : 'page';
    const limitKey = namespace ? `${namespace}_limit` : 'limit';
    const sortByKey = namespace ? `${namespace}_sort_by` : 'sort_by';
    const sortOrderKey = namespace ? `${namespace}_sort_order` : 'sort_order';
    const searchKey = namespace ? `${namespace}_search` : 'search';

    if (page > 1) p.set(pageKey, String(page));
    p.set(limitKey, String(pageSize));
    p.set(sortByKey, sortBy);
    p.set(sortOrderKey, sortOrder);
    if (search.trim()) p.set(searchKey, search.trim());
    for (const [k, v] of Object.entries(filters)) {
      const fKey = namespace ? `${namespace}_${k}` : k;
      if (v && v !== 'ALL') p.set(fKey, v);
    }
    return p;
  }, [page, pageSize, sortBy, sortOrder, search, filters, namespace]);

  const saveCurrentView = useCallback(
    (name: string): SavedView<TFilters> => {
      const newView: SavedView<TFilters> = {
        id: `view_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'Chế độ xem',
        page,
        pageSize,
        sortBy,
        sortOrder,
        search,
        filters: { ...filters },
        createdAt: new Date().toISOString(),
      };
      setSavedViews((prev) => {
        const next = [newView, ...prev.filter((v) => v.name !== newView.name)];
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(`${prefStorageKey}_views`, JSON.stringify(next));
          }
        } catch {
          // ignore storage quota errors
        }
        return next;
      });
      return newView;
    },
    [page, pageSize, sortBy, sortOrder, search, filters, prefStorageKey]
  );

  const applySavedView = useCallback(
    (viewId: string): boolean => {
      const target = savedViews.find((v) => v.id === viewId);
      if (!target) return false;
      setPageState(target.page || 1);
      setPageSizeState(target.pageSize || defaultPageSize);
      setSortBy(target.sortBy || defaultSortBy);
      setSortOrder(target.sortOrder || defaultSortOrder);
      setSearchState(target.search || '');
      setFiltersState(target.filters);
      return true;
    },
    [savedViews, defaultPageSize, defaultSortBy, defaultSortOrder]
  );

  const deleteSavedView = useCallback(
    (viewId: string): boolean => {
      setSavedViews((prev) => {
        const next = prev.filter((v) => v.id !== viewId);
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(`${prefStorageKey}_views`, JSON.stringify(next));
          }
        } catch {
          // ignore
        }
        return next;
      });
      return true;
    },
    [prefStorageKey]
  );

  const updateColumnSettings = useCallback(
    (newSettings: Partial<ColumnSettings>) => {
      setColumnSettings((prev) => {
        const next: ColumnSettings = {
          visibleColumns: newSettings.visibleColumns || prev.visibleColumns,
          columnOrder: newSettings.columnOrder || prev.columnOrder,
        };
        try {
          if (typeof window !== 'undefined') {
            localStorage.setItem(`${prefStorageKey}_columns`, JSON.stringify(next));
          }
        } catch {
          // ignore
        }
        return next;
      });
    },
    [prefStorageKey]
  );

  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    filters,
    hasActiveFilters,
    savedViews,
    columnSettings,
    setPage,
    setPageSize,
    setSort,
    setSortBy: setSortByDirect,
    setSortOrder: setSortOrderDirect,
    setSearch,
    setFilter,
    resetFilters,
    getUrlSearchParams,
    saveCurrentView,
    applySavedView,
    deleteSavedView,
    updateColumnSettings,
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
