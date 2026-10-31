/**
 * Ported from sadmann7/shadcn-table (MIT License)
 * Source: https://github.com/sadmann7/shadcn-table
 * License: MIT
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
}

export function parseSortParam(sortParam: string | null): ColumnSort | null {
  if (!sortParam) return null;
  const [id, order] = sortParam.split('.');
  if (!id) return null;
  return { id, desc: order?.toLowerCase() === 'desc' };
}

export function formatSortParam(sort: ColumnSort | null): string | null {
  if (!sort) return null;
  return `${sort.id}.${sort.desc ? 'desc' : 'asc'}`;
}

export function useDataTable({
  pageCount = 1,
  defaultPageSize = 10,
  filterableColumns = [],
  searchableColumns = [],
  defaultSort,
}: UseDataTableProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Search params state
  const page = useMemo(() => {
    const p = searchParams?.get('page');
    const parsed = p ? parseInt(p, 10) : 1;
    return isNaN(parsed) || parsed < 1 ? 1 : parsed;
  }, [searchParams]);

  const perPage = useMemo(() => {
    const pp = searchParams?.get('per_page');
    const parsed = pp ? parseInt(pp, 10) : defaultPageSize;
    return isNaN(parsed) || parsed < 1 ? defaultPageSize : parsed;
  }, [searchParams, defaultPageSize]);

  const sort = useMemo<ColumnSort | null>(() => {
    const s = searchParams?.get('sort');
    if (s) {
      return parseSortParam(s);
    }
    return defaultSort ?? null;
  }, [searchParams, defaultSort]);

  // Column visibility local state
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set());

  // URL query builder
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const newSearchParams = new URLSearchParams(searchParams?.toString() ?? '');

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      return newSearchParams.toString();
    },
    [searchParams]
  );

  const navigate = useCallback(
    (queryString: string) => {
      startTransition(() => {
        const url = `${pathname || ''}?${queryString}`;
        router.push(url);
      });
    },
    [pathname, router]
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

  const setFilter = useCallback(
    (key: string, values: string[] | string | null) => {
      let valueStr: string | null = null;
      if (Array.isArray(values)) {
        valueStr = values.length > 0 ? values.join('.') : null;
      } else {
        valueStr = values;
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
