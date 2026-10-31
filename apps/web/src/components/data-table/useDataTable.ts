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

import { useCallback, useMemo, useState, useTransition } from 'react';
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

  const activeSearchParams =
    props.searchParams !== undefined ? props.searchParams : nextSearchParams;

  const [isPending, startTransition] = useTransition();

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

  // URL query builder
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const newSearchParams = new URLSearchParams(activeSearchParams?.toString() ?? '');

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
      const targetUrl = queryString ? `${pathname || ''}?${queryString}` : pathname || '';
      if (onNavigate) {
        onNavigate(targetUrl);
        return;
      }
      if (router) {
        startTransition(() => {
          router.push(targetUrl);
        });
      }
    },
    [onNavigate, pathname, router]
  );

  const setPagination = useCallback(
    (newPage: number, newPageSize?: number) => {
      const updates: Record<string, string | number | null> = {
        page: newPage <= 1 ? null : newPage,
      };
      if (newPageSize !== undefined && newPageSize !== defaultPageSize) {
        updates.per_page = newPageSize;
      } else if (newPageSize === defaultPageSize) {
        updates.per_page = null;
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
      const trimmed = val ? val.trim() : null;
      const qs = createQueryString({
        search: trimmed && trimmed.length > 0 ? trimmed : null,
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
  };
}
