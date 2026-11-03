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
 * Custom hook to synchronize server-driven data table state with Next.js URL search params.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ColumnSort, DataTableFilterableColumn, DataTableSearchableColumn } from './types';

export interface UseDataTableProps {
  pageCount?: number;
  defaultPageSize?: number;
  filterableColumns?: DataTableFilterableColumn[];
  searchableColumns?: DataTableSearchableColumn[];
  defaultSort?: ColumnSort;
  // Optional explicit searchParams or navigation override for testing and decoupled usage
  searchParams?: URLSearchParams | null;
  onNavigate?: (url: string) => void;
}

export interface UseDataTableReturn {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  sort: ColumnSort | null;
  searchValue: string;
  setSearch: (value: string | null) => void;
  filters: Record<string, string[]>;
  getFilter: (key: string) => string[];
  isFiltered: boolean;
  visibleColumns: Set<string>;
  setVisibleColumns: React.Dispatch<React.SetStateAction<Set<string>>>;
  setPagination: (page: number, pageSize?: number) => void;
  setSort: (columnId: string, desc?: boolean) => void;
  setFilter: (key: string, values: string[] | string | null) => void;
  resetFilters: () => void;
  createQueryString: (params: Record<string, string | number | null | undefined>) => string;
  isPending: boolean;
  // Increments on every real browser history navigation (Back/Forward popstate).
  // Consumers use it to distinguish navigation from acknowledgments of their own
  // pending interactions (Review item 3).
  historyEpoch: number;
  // Increments on explicit filter resets (Finding 4 P1).
  resetEpoch: number;
}

export function normalizeParamsString(params: URLSearchParams | string | null | undefined): string {
  if (!params) return '';
  const sp =
    typeof params === 'string'
      ? new URLSearchParams(params)
      : new URLSearchParams(params.toString());
  const entries: [string, string][] = [];
  sp.forEach((value, key) => {
    entries.push([key, value]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const sorted = new URLSearchParams();
  for (const [k, v] of entries) {
    sorted.append(k, v);
  }
  return sorted.toString();
}

export function parseSortParam(sortParam: string | null): ColumnSort | null {
  if (!sortParam) return null;
  const parts = sortParam.split('.');
  if (parts.length < 2) return null;
  const [id, order] = parts;
  if (!id) return null;
  const lowerOrder = order?.toLowerCase();
  if (lowerOrder !== 'asc' && lowerOrder !== 'desc') return null;
  return { id, desc: lowerOrder === 'desc' };
}

export function formatSortParam(sort: ColumnSort | null): string | null {
  if (!sort || !sort.id) return null;
  return `${sort.id}.${sort.desc ? 'desc' : 'asc'}`;
}

export function useDataTable(props: UseDataTableProps = {}): UseDataTableReturn {
  const {
    pageCount = 1,
    defaultPageSize = 10,
    filterableColumns = [],
    searchableColumns = [],
    defaultSort,
    onNavigate,
  } = props;

  const nextSearchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() || '';

  const [isPending, startTransition] = useTransition();

  // Explicit browser history navigation signal (Review item 3): increments on
  // every Back/Forward popstate so consumers can distinguish navigation from
  // acknowledgments of their own pending interactions.
  const [historyEpoch, setHistoryEpoch] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => setHistoryEpoch((epoch) => epoch + 1);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const activeSearchParams = useMemo(() => {
    if (props.searchParams !== undefined) {
      return props.searchParams;
    }
    if (typeof window !== 'undefined' && historyEpoch > 0) {
      return new URLSearchParams(window.location.search);
    }
    return nextSearchParams;
  }, [props.searchParams, historyEpoch, nextSearchParams]);

  // Filter reset signal (Finding 4 P1): increments when resetFilters is called.
  const [resetEpoch, setResetEpoch] = useState(0);

  // Queue of pending navigation requests (Finding 10 P1).
  // Successive interactions under delayed navigation accumulate on top of the
  // latest pending query. When intermediate commits arrive (acknowledging older
  // requests in the queue), remaining newer pending queries are retained rather
  // than being discarded. On external navigation or popstate, the queue is cleared.
  //
  // Round 12 P1: query equality alone cannot tell our own commit from another
  // same-page Next.js navigation that happens to land on an older pending URL
  // (pending searches "N" then "Ng"; an external navigation chooses "?search=N").
  // If an older pending navigation had parameters changed or removed by a subsequent
  // navigation, it is marked cancelled. A matching commit of a cancelled edit or
  // an unrecognized URL is treated as external: the pending queue is dropped so
  // later edits compose from the URL that won.
  const pendingNavigationsRef = useRef<
    Array<{ query: URLSearchParams; normalized: string; cancelled?: boolean }>
  >([]);
  const prevHistoryEpochRef = useRef<number>(0);
  const prevActiveSearchParamsStrRef = useRef<string>(normalizeParamsString(activeSearchParams));

  // Synchronize pending navigation queue on activeSearchParams or historyEpoch change
  const currentCommittedNorm = normalizeParamsString(activeSearchParams);
  useEffect(() => {
    if (historyEpoch !== prevHistoryEpochRef.current) {
      // Popstate navigation: Back/Forward always clears all pending navigations
      pendingNavigationsRef.current = [];
      prevHistoryEpochRef.current = historyEpoch;
      prevActiveSearchParamsStrRef.current = currentCommittedNorm;
    } else if (currentCommittedNorm !== prevActiveSearchParamsStrRef.current) {
      prevHistoryEpochRef.current = historyEpoch;
      prevActiveSearchParamsStrRef.current = currentCommittedNorm;
      const idx = pendingNavigationsRef.current.findIndex(
        (p) => !p.cancelled && p.normalized === currentCommittedNorm
      );
      if (idx !== -1) {
        // Intermediate uncancelled request acknowledged! Retain subsequent pending intent (Finding 10 P1)
        pendingNavigationsRef.current = pendingNavigationsRef.current.slice(idx + 1);
        prevHistoryEpochRef.current = historyEpoch;
      } else {
        // External navigation or commit of a cancelled edit (Round 12/14 P1)
        pendingNavigationsRef.current = [];
        setHistoryEpoch((epoch) => epoch + 1);
      }
    }
  }, [currentCommittedNorm, historyEpoch]);

  // Search params state with validation & fallback
  const page = useMemo(() => {
    const p = activeSearchParams?.get('page');
    if (!p) return 1;
    const parsed = parseInt(p, 10);
    return isNaN(parsed) || parsed < 1 ? 1 : parsed;
  }, [activeSearchParams]);

  const perPage = useMemo(() => {
    const pp = activeSearchParams?.get('per_page');
    if (!pp) return defaultPageSize;
    const parsed = parseInt(pp, 10);
    return isNaN(parsed) || parsed < 1 ? defaultPageSize : parsed;
  }, [activeSearchParams, defaultPageSize]);

  const sort = useMemo<ColumnSort | null>(() => {
    const s = activeSearchParams?.get('sort');
    if (s) {
      const parsed = parseSortParam(s);
      if (parsed) return parsed;
    }
    return defaultSort ?? null;
  }, [activeSearchParams, defaultSort]);

  const searchValue = useMemo(() => {
    return activeSearchParams?.get('search') ?? '';
  }, [activeSearchParams]);

  const filters = useMemo(() => {
    const result: Record<string, string[]> = {};
    if (!activeSearchParams) return result;
    for (const col of filterableColumns) {
      const val = activeSearchParams.get(col.id);
      if (val) {
        result[col.id] = val
          .split('.')
          .map((v: string) => v.trim())
          .filter(Boolean);
      } else {
        result[col.id] = [];
      }
    }
    return result;
  }, [activeSearchParams, filterableColumns]);

  const getFilter = useCallback(
    (key: string): string[] => {
      const val = activeSearchParams?.get(key);
      if (!val) return [];
      return val
        .split('.')
        .map((v: string) => v.trim())
        .filter(Boolean);
    },
    [activeSearchParams]
  );

  const isFiltered = useMemo(() => {
    if (searchValue.trim().length > 0) return true;
    for (const col of filterableColumns) {
      const val = activeSearchParams?.get(col.id);
      if (val && val.trim().length > 0) return true;
    }
    for (const col of searchableColumns) {
      const val = activeSearchParams?.get(col.id);
      if (val && val.trim().length > 0) return true;
    }
    return false;
  }, [activeSearchParams, filterableColumns, searchableColumns, searchValue]);

  // Column visibility local state
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set());

  // URL query builder. Composes against the latest pending query when requests
  // are in-flight, so successive interactions under delayed navigation accumulate
  // instead of discarding each other (Finding 10 P1).
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const latestPending =
        pendingNavigationsRef.current.length > 0
          ? pendingNavigationsRef.current[pendingNavigationsRef.current.length - 1]
          : null;
      const base = latestPending
        ? latestPending.query.toString()
        : (activeSearchParams?.toString() ?? '');
      const newSearchParams = new URLSearchParams(base);

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      return newSearchParams.toString();
    },
    [activeSearchParams]
  );

  const navigate = useCallback(
    (queryString: string) => {
      const query = new URLSearchParams(queryString);
      const normalized = normalizeParamsString(query);

      // Check if this new navigation cancels any older pending navigation.
      // An older pending navigation is cancelled if any parameter key it set
      // is different or missing in the new navigation (e.g. search changed from 'N' to 'Ng').
      // It is NOT cancelled if the new navigation preserves its parameters (e.g. adding carrier=GHN on top of status=FAILED).
      const updatedQueue = pendingNavigationsRef.current.map((p) => {
        if (p.cancelled) return p;
        let isCancelled = false;
        p.query.forEach((val, key) => {
          if (query.get(key) !== val) {
            isCancelled = true;
          }
        });
        return isCancelled ? { ...p, cancelled: true } : p;
      });

      pendingNavigationsRef.current = [...updatedQueue, { query, normalized, cancelled: false }];

      const targetUrl = queryString ? `${pathname || ''}?${queryString}` : pathname || '';
      if (onNavigate) {
        onNavigate(targetUrl);
        return;
      }
      if (router) {
        try {
          startTransition(() => {
            router.push(targetUrl);
          });
        } catch {
          router.push(targetUrl);
        }
      }
    },
    [onNavigate, pathname, router]
  );

  const setPagination = useCallback(
    (newPage: number, newPageSize?: number) => {
      const updates: Record<string, string | number | null> = {
        page: newPage <= 1 ? null : newPage,
      };
      // Page-only navigation omits the size argument so a pending page-size
      // change already queued is not overwritten by the committed size
      // (Round 12 P1). An explicit size still replaces or clears per_page.
      if (newPageSize !== undefined) {
        updates.per_page = newPageSize === defaultPageSize ? null : newPageSize;
      }
      const qs = createQueryString(updates);
      navigate(qs);
    },
    [createQueryString, defaultPageSize, navigate]
  );

  const setSort = useCallback(
    (columnId: string, desc?: boolean) => {
      let sortStr: string | null = null;
      if (desc !== undefined) {
        sortStr = `${columnId}.${desc ? 'desc' : 'asc'}`;
      } else if (sort?.id === columnId) {
        if (!sort.desc) {
          sortStr = `${columnId}.desc`;
        } else {
          sortStr = null; // Reset sort
        }
      } else {
        sortStr = `${columnId}.asc`;
      }

      const qs = createQueryString({
        sort: sortStr,
        page: null, // Reset to page 1 on sort change
      });
      navigate(qs);
    },
    [createQueryString, navigate, sort]
  );

  const setSearch = useCallback(
    (val: string | null) => {
      // Preserve spaces during editing to allow normal typing of multiword phrases like 'Nguyễn Văn An'
      const queryVal = val !== null && val !== undefined && val.length > 0 ? val : null;
      const qs = createQueryString({
        search: queryVal,
        page: null, // Reset to page 1 on search change
      });
      navigate(qs);
    },
    [createQueryString, navigate]
  );

  const setFilter = useCallback(
    (key: string, values: string[] | string | null) => {
      let valueStr: string | null = null;
      if (Array.isArray(values)) {
        const nonEmpties = values.filter(Boolean);
        valueStr = nonEmpties.length > 0 ? nonEmpties.join('.') : null;
      } else if (values) {
        valueStr = values.trim().length > 0 ? values.trim() : null;
      }

      const qs = createQueryString({
        [key]: valueStr,
        page: null, // Reset to page 1 on filter change
      });
      navigate(qs);
    },
    [createQueryString, navigate]
  );

  const resetFilters = useCallback(() => {
    setResetEpoch((epoch) => epoch + 1);
    pendingNavigationsRef.current = [];
    const keysToRemove: Record<string, null> = {
      page: null,
      sort: null,
      search: null,
    };
    filterableColumns.forEach((col) => {
      keysToRemove[col.id] = null;
    });
    searchableColumns.forEach((col) => {
      keysToRemove[col.id] = null;
    });
    const qs = createQueryString(keysToRemove);
    navigate(qs);
  }, [createQueryString, filterableColumns, navigate, searchableColumns]);

  return {
    pageIndex: page,
    pageSize: perPage,
    pageCount,
    sort,
    searchValue,
    setSearch,
    filters,
    getFilter,
    isFiltered,
    visibleColumns,
    setVisibleColumns,
    setPagination,
    setSort,
    setFilter,
    resetFilters,
    createQueryString,
    isPending,
    historyEpoch,
    resetEpoch,
  };
}
