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

export function isCompatibleSubset(
  committedStr: string,
  targetStr: string,
  baselineStr?: string
): boolean {
  if (!committedStr) return true;
  if (!targetStr && !baselineStr) return false;
  const committed = new URLSearchParams(committedStr);
  const target = new URLSearchParams(targetStr);
  const baseline = baselineStr ? new URLSearchParams(baselineStr) : null;
  for (const [key, value] of committed.entries()) {
    const targetValue = target.get(key);
    if (targetValue === value) {
      continue;
    }
    // If targetValue is null, check if this is an intermediate facet removal from baseline (Finding 6 P1).
    if (targetValue === null) {
      if (baseline) {
        const baselineValue = baseline.get(key);
        if (baselineValue) {
          const committedSegments = value.split('.').filter(Boolean);
          const baselineSegments = baselineValue.split('.').filter(Boolean);
          if (
            committedSegments.length > 0 &&
            committedSegments.every((segment) => baselineSegments.includes(segment))
          ) {
            continue;
          }
        }
      }
      return false;
    }
    // A facet value is a dot-joined multi-selection (e.g. status=FAILED or
    // status=FAILED.DELIVERED). A commit of an earlier same-facet selection is
    // a compatible intermediate acknowledgment when every segment it carries
    // is still present in the newer pending target, so the newer selection is
    // preserved instead of treated as a conflict (Round 41 finding 5).
    const committedSegments = value.split('.').filter(Boolean);
    const targetSegments = targetValue.split('.').filter(Boolean);
    if (
      committedSegments.length > 0 &&
      committedSegments.every((segment) => targetSegments.includes(segment))
    ) {
      continue;
    }
    return false;
  }
  return true;
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

  // Filter reset signal (Finding 4 P1): increments when resetFilters is called.
  const [resetEpoch, setResetEpoch] = useState(0);

  const routerSearchParams =
    props.searchParams !== undefined ? props.searchParams : nextSearchParams;

  // Pending navigation intent: the query string this hook pushed, with
  // the committed baseline it was composed from. Intermediate acknowledgments
  // advance the baseline while preserving newer pending intent (BR-UI-01, Finding 4 P1).
  const pendingNavigationRef = useRef<{ baseline: string; target: string } | null>(null);

  const committedParams = normalizeParamsString(routerSearchParams);

  // If the committed params reached the pending target, the navigation has settled.
  // Invalidate pending intent once committed so subsequent external navigation
  // cannot match a stale baseline and resurrect settled filters (Finding 5 P1).
  useEffect(() => {
    if (pendingNavigationRef.current && committedParams === pendingNavigationRef.current.target) {
      pendingNavigationRef.current = null;
    }
  }, [committedParams]);

  // Table state is a pure function of the committed router search params (BR-UI-01)
  const activeSearchParams = routerSearchParams;

  // Next query string for a table action: composes onto the pending intent of
  // a navigation still unacknowledged, else onto the committed URL.
  const getNextQueryBase = useCallback(() => {
    const pending = pendingNavigationRef.current;
    if (!pending) {
      return { baseline: committedParams, base: committedParams };
    }
    if (committedParams === pending.target) {
      pendingNavigationRef.current = null;
      return { baseline: committedParams, base: committedParams };
    }
    if (committedParams === pending.baseline) {
      return { baseline: committedParams, base: pending.target };
    }
    // Intermediate acknowledgment: if committedParams is a compatible subset of
    // the pending target (e.g. status=FAILED committed while carrier=GHN is still pending, Finding 4 P1;
    // or status=FAILED committed while status removal is pending, Finding 6 P1),
    // advance baseline and preserve the pending target.
    if (isCompatibleSubset(committedParams, pending.target, pending.baseline)) {
      pending.baseline = committedParams;
      return { baseline: committedParams, base: pending.target };
    }
    // Conflicting or external navigation: committed URL wins
    pendingNavigationRef.current = null;
    return { baseline: committedParams, base: committedParams };
  }, [committedParams]);

  // Authoritative browser history navigation (Back/Forward) discards any
  // uncommitted pending intent so a subsequent edit composes from the history
  // entry the user actually landed on, never resurrecting cancelled queued
  // filters — even when that entry's params are a subset of the pending target
  // (Round 41 finding 4, BR-UI-01).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      pendingNavigationRef.current = null;
      if (typeof window !== 'undefined' && (window as any).__shipde_table_queries) {
        (window as any).__shipde_table_queries.clear();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

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

  // URL query builder: composes against committed router search parameters,
  // or against the pending intent of a navigation that has not committed yet
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const newSearchParams = new URLSearchParams(getNextQueryBase().base);

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      return newSearchParams.toString();
    },
    [getNextQueryBase]
  );

  const navigate = useCallback(
    (queryString: string) => {
      const targetUrl = queryString ? `${pathname || ''}?${queryString}` : pathname || '';
      const normalizedTarget = normalizeParamsString(queryString);
      const prev = pendingNavigationRef.current;
      const currentBaseline =
        prev &&
        (prev.baseline === committedParams ||
          isCompatibleSubset(committedParams, prev.target, prev.baseline))
          ? prev.baseline
          : committedParams;
      pendingNavigationRef.current = {
        baseline: currentBaseline,
        target: normalizedTarget,
      };
      if (typeof window !== 'undefined') {
        const globalAny = window as any;
        if (!globalAny.__shipde_table_queries) {
          globalAny.__shipde_table_queries = new Set<string>();
        }
        globalAny.__shipde_table_queries.add(normalizedTarget);
      }
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
    [committedParams, onNavigate, pathname, router]
  );

  const setPagination = useCallback(
    (newPage: number, newPageSize?: number) => {
      const updates: Record<string, string | number | null> = {
        page: newPage <= 1 ? null : newPage,
      };
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
    if (typeof window !== 'undefined' && (window as any).__shipde_table_queries) {
      (window as any).__shipde_table_queries.clear();
    }
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
    resetEpoch,
  };
}
