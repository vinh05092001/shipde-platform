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

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { parseAsInteger, parseAsString, parseAsArrayOf, createParser, useQueryStates } from 'nuqs';
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

export const sortParser = createParser<ColumnSort | null>({
  parse: (value) => parseSortParam(value),
  serialize: (value) => (value ? (formatSortParam(value) ?? '') : ''),
});

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
  const [resetEpoch, setResetEpoch] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set());

  const activeSearchParams =
    props.searchParams !== undefined ? props.searchParams : nextSearchParams;
  const committedParams = normalizeParamsString(activeSearchParams);

  // Chained query builder: preserves uncommitted pending intent across rapid successive edits (tablecn useChainedUpdate)
  const pendingQueryRef = useRef<{ base: string; next: string } | null>(null);

  // URL query builder: composes against pending uncommitted intent or committed router search parameters (BR-UI-01)
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const pending = pendingQueryRef.current;
      const base =
        pending && pending.base === committedParams && committedParams !== pending.next
          ? pending.next
          : committedParams;
      const newSearchParams = new URLSearchParams(base);

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      const nextQuery = newSearchParams.toString();
      pendingQueryRef.current = {
        base: committedParams,
        next: normalizeParamsString(nextQuery),
      };
      return nextQuery;
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

  // nuqs parsers for URL state
  const parsers = useMemo(() => {
    const map: Record<string, any> = {
      page: parseAsInteger.withDefault(1),
      per_page: parseAsInteger.withDefault(defaultPageSize),
      sort: defaultSort ? sortParser.withDefault(defaultSort) : sortParser,
      search: parseAsString.withDefault(''),
    };
    for (const col of filterableColumns) {
      map[col.id] = parseAsArrayOf(parseAsString, '.').withDefault([]);
    }
    for (const col of searchableColumns) {
      if (!map[col.id]) {
        map[col.id] = parseAsString.withDefault('');
      }
    }
    return map;
  }, [defaultPageSize, defaultSort, filterableColumns, searchableColumns]);

  const [nuqsState, setNuqsState] = useQueryStates(parsers, {
    shallow: false,
    history: 'push',
    throttleMs: 50,
  });

  const page = useMemo(() => {
    if (activeSearchParams) {
      const p = activeSearchParams.get('page');
      if (!p) return 1;
      const parsed = parseInt(p, 10);
      return isNaN(parsed) || parsed < 1 ? 1 : parsed;
    }
    return nuqsState.page ?? 1;
  }, [activeSearchParams, nuqsState.page]);

  const perPage = useMemo(() => {
    if (activeSearchParams) {
      const pp = activeSearchParams.get('per_page');
      if (!pp) return defaultPageSize;
      const parsed = parseInt(pp, 10);
      return isNaN(parsed) || parsed < 1 ? defaultPageSize : parsed;
    }
    return nuqsState.per_page ?? defaultPageSize;
  }, [activeSearchParams, defaultPageSize, nuqsState.per_page]);

  const sort = useMemo<ColumnSort | null>(() => {
    if (activeSearchParams) {
      const s = activeSearchParams.get('sort');
      if (s) {
        const parsed = parseSortParam(s);
        if (parsed) return parsed;
      }
      return defaultSort ?? null;
    }
    return nuqsState.sort ?? defaultSort ?? null;
  }, [activeSearchParams, defaultSort, nuqsState.sort]);

  const searchValue = useMemo(() => {
    if (activeSearchParams) {
      return activeSearchParams.get('search') ?? '';
    }
    return nuqsState.search ?? '';
  }, [activeSearchParams, nuqsState.search]);

  const filters = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const col of filterableColumns) {
      if (activeSearchParams) {
        const val = activeSearchParams.get(col.id);
        result[col.id] = val
          ? val
              .split('.')
              .map((v) => v.trim())
              .filter(Boolean)
          : [];
      } else {
        const val = nuqsState[col.id];
        result[col.id] = Array.isArray(val) ? val : [];
      }
    }
    return result;
  }, [activeSearchParams, filterableColumns, nuqsState]);

  const getFilter = useCallback(
    (key: string): string[] => {
      if (activeSearchParams) {
        const val = activeSearchParams.get(key);
        return val
          ? val
              .split('.')
              .map((v) => v.trim())
              .filter(Boolean)
          : [];
      }
      const val = nuqsState[key];
      return Array.isArray(val) ? val : [];
    },
    [activeSearchParams, nuqsState]
  );

  const isFiltered = useMemo(() => {
    if (searchValue.trim().length > 0) return true;
    for (const col of filterableColumns) {
      const val = filters[col.id];
      if (val && val.length > 0) return true;
    }
    for (const col of searchableColumns) {
      const val = activeSearchParams ? activeSearchParams.get(col.id) : nuqsState[col.id];
      if (val && typeof val === 'string' && val.trim().length > 0) return true;
    }
    return false;
  }, [activeSearchParams, filterableColumns, filters, nuqsState, searchableColumns, searchValue]);

  const setPagination = useCallback(
    (newPage: number, newPageSize?: number) => {
      const updates: Record<string, any> = {
        page: newPage <= 1 ? null : newPage,
      };
      if (newPageSize !== undefined) {
        updates.per_page = newPageSize === defaultPageSize ? null : newPageSize;
      }
      const qs = createQueryString(updates);
      navigate(qs);
      void setNuqsState(updates);
    },
    [createQueryString, defaultPageSize, navigate, setNuqsState]
  );

  const setSort = useCallback(
    (columnId: string, desc?: boolean) => {
      let nextSort: ColumnSort | null = null;
      if (desc !== undefined) {
        nextSort = { id: columnId, desc };
      } else if (sort?.id === columnId) {
        if (!sort.desc) {
          nextSort = { id: columnId, desc: true };
        } else {
          nextSort = null;
        }
      } else {
        nextSort = { id: columnId, desc: false };
      }

      const sortStr = nextSort ? formatSortParam(nextSort) : null;
      const qs = createQueryString({ sort: sortStr, page: null });
      navigate(qs);
      void setNuqsState({ sort: nextSort, page: null });
    },
    [createQueryString, navigate, setNuqsState, sort]
  );

  const setSearch = useCallback(
    (val: string | null) => {
      const queryVal = val !== null && val !== undefined && val.length > 0 ? val : null;
      const qs = createQueryString({ search: queryVal, page: null });
      navigate(qs);
      void setNuqsState({ search: queryVal, page: null });
    },
    [createQueryString, navigate, setNuqsState]
  );

  const setFilter = useCallback(
    (key: string, values: string[] | string | null) => {
      let parsedValues: string[] | null = null;
      let valueStr: string | null = null;
      if (Array.isArray(values)) {
        const nonEmpties = values.filter(Boolean);
        parsedValues = nonEmpties.length > 0 ? nonEmpties : null;
        valueStr = nonEmpties.length > 0 ? nonEmpties.join('.') : null;
      } else if (values && values.trim().length > 0) {
        parsedValues = [values.trim()];
        valueStr = values.trim();
      }

      const qs = createQueryString({ [key]: valueStr, page: null });
      navigate(qs);
      void setNuqsState({ [key]: parsedValues, page: null });
    },
    [createQueryString, navigate, setNuqsState]
  );

  const resetFilters = useCallback(() => {
    pendingQueryRef.current = null;
    setResetEpoch((epoch) => epoch + 1);
    const updates: Record<string, null> = {
      page: null,
      sort: null,
      search: null,
    };
    for (const col of filterableColumns) {
      updates[col.id] = null;
    }
    for (const col of searchableColumns) {
      updates[col.id] = null;
    }
    const qs = createQueryString(updates);
    navigate(qs);
    void setNuqsState(updates);
  }, [createQueryString, filterableColumns, navigate, searchableColumns, setNuqsState]);

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
