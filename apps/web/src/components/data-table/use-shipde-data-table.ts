// Ship Dễ server-driven data table state.

'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { normalizeParamsString, parseSortParam } from './data-table-url-params';
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
  browserHistory?: string[];
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
  resetEpoch: number;
  table?: any;
}

export function useShipdeDataTable(props: UseDataTableProps = {}): UseDataTableReturn {
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
  const [resetEpoch, setResetEpoch] = useState(0);

  const routerSearchParams =
    props.searchParams !== undefined ? props.searchParams : nextSearchParams;

  // Table state is a pure function of the committed router search params (BR-UI-01)
  const activeSearchParams = routerSearchParams;
  const committedParams = normalizeParamsString(routerSearchParams);

  // useChainedUpdate pattern adapted from tablecn: preserves successive edits before router commit
  const pendingRef = React.useRef<{ base: string; next: string } | null>(null);

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

  // URL query builder: builds from current committed parameters (BR-UI-01: single source of truth)
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const newSearchParams = new URLSearchParams(committedParams);

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      return newSearchParams.toString();
    },
    [committedParams]
  );

  const navigate = useCallback(
    (queryString: string) => {
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
          sortStr = null;
        }
      } else {
        sortStr = `${columnId}.asc`;
      }

      const qs = createQueryString({
        sort: sortStr,
        page: null,
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
        page: null,
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
        page: null,
      });
      navigate(qs);
    },
    [createQueryString, navigate]
  );

  const resetFilters = useCallback(() => {
    setResetEpoch((epoch) => epoch + 1);
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