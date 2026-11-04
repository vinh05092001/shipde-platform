// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table
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
 */

'use client';

import {
  type ColumnFiltersState,
  functionalUpdate,
  type PaginationState,
  type RowData,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
  useTable,
} from '@tanstack/react-table';
import {
  parseAsInteger,
  parseAsStringEnum,
  useQueryState,
  type UseQueryStateOptions,
  useQueryStates,
} from 'nuqs';
import * as React from 'react';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type {
  ColumnFilterItem,
  DataTableQueryKeys,
  FilterVariant,
  JoinOperator,
} from './lib/data-table-types';

import { useDebouncedCallback } from '../../hooks/use-debounced-callback';
import { type DataTableFeatures, dataTableFeatures } from './lib/data-table-features';
import {
  getColumnFilterParser,
  getColumnFilters,
  getColumnFiltersKey,
  getSortingStateParser,
  sortColumnFiltersBySearch,
} from './lib/data-table-parsers';
import {
  getActiveFilters,
  getFilterVariant,
  JOIN_OPERATORS,
  normalizeColumnFilter,
} from './lib/data-table-utils';
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

const PAGE_KEY = 'page';
const PER_PAGE_KEY = 'perPage';
const SORT_KEY = 'sort';
const JOIN_OPERATOR_KEY = 'joinOperator';
const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;
const DEFAULT_PAGE_SIZE = 10;
const EMPTY_SORTING: SortingState = [];

interface FiltersDraft {
  filters: ColumnFiltersState;
  urlFiltersKey: string;
  pageToReset: number | null;
}

export type TablecnUseDataTableProps<TData extends RowData> = Omit<
  TableOptions<DataTableFeatures, TData>,
  'state' | 'pageCount' | 'features' | 'manualFiltering' | 'manualPagination' | 'manualSorting'
> & {
  queryKeys?: Partial<DataTableQueryKeys>;
  history?: 'push' | 'replace';
  debounceMs?: number;
  throttleMs?: number;
  clearOnDefault?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  startTransition?: React.TransitionStartFunction;
} & (
    | {
        mode?: 'server';
        pageCount: number;
      }
    | {
        mode: 'client';
        pageCount?: never;
      }
  );

function useTablecnDataTable<TData extends RowData>({
  columns,
  mode = 'server',
  pageCount,
  initialState,
  queryKeys,
  history = 'replace',
  debounceMs = DEBOUNCE_MS,
  throttleMs = THROTTLE_MS,
  clearOnDefault = false,
  scroll = false,
  shallow: shallowProp = true,
  startTransition,
  ...props
}: TablecnUseDataTableProps<TData>) {
  const isServer = mode === 'server';
  const shallow = isServer ? shallowProp : true;

  const pageKey = queryKeys?.page ?? PAGE_KEY;
  const perPageKey = queryKeys?.perPage ?? PER_PAGE_KEY;
  const sortKey = queryKeys?.sort ?? SORT_KEY;
  const joinOperatorKey = queryKeys?.joinOperator ?? JOIN_OPERATOR_KEY;

  const queryStateOptions = React.useMemo<Omit<UseQueryStateOptions<string>, 'parse'>>(
    () => ({
      history,
      scroll,
      shallow,
      throttleMs,
      debounceMs,
      clearOnDefault,
      startTransition,
    }),
    [history, scroll, shallow, throttleMs, debounceMs, clearOnDefault, startTransition]
  );

  const [initialTableState] = React.useState(initialState);

  const pageParser = React.useMemo(
    () => parseAsInteger.withOptions(queryStateOptions).withDefault(1),
    [queryStateOptions]
  );
  const perPageParser = React.useMemo(
    () =>
      parseAsInteger
        .withOptions(queryStateOptions)
        .withDefault(initialTableState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE),
    [initialTableState, queryStateOptions]
  );

  const [page, setPage] = useQueryState(pageKey, pageParser);
  const [perPage, setPerPage] = useQueryState(perPageKey, perPageParser);

  const columnIndex = React.useMemo(() => {
    const sortableIds = new Set<string>();
    const filterableVariants = new Map<string, FilterVariant>();

    for (const column of columns) {
      if (!column.id) continue;
      const hasAccessor = 'accessorKey' in column || 'accessorFn' in column;
      if (hasAccessor && column.enableSorting !== false) {
        sortableIds.add(column.id);
      }
      if (!column.enableColumnFilter) continue;

      filterableVariants.set(column.id, getFilterVariant(column.meta));
    }

    return {
      sortableIds,
      filterableIds: [...filterableVariants.keys()],
      variantById: Object.fromEntries(filterableVariants),
      normalizeColumnFilters: (filters: ColumnFiltersState) =>
        filters.map((filter) =>
          normalizeColumnFilter(filter, filterableVariants.get(filter.id) ?? 'text')
        ),
    };
  }, [columns]);

  const sortingParser = React.useMemo(
    () =>
      getSortingStateParser(columnIndex.sortableIds)
        .withOptions(queryStateOptions)
        .withDefault(initialTableState?.sorting ?? EMPTY_SORTING),
    [columnIndex, initialTableState, queryStateOptions]
  );

  const [sorting, setSorting] = useQueryState(sortKey, sortingParser);

  const getNextSorting = useChainedUpdate(sorting);

  function onSortingChange(updater: Updater<SortingState>) {
    void setSorting(getNextSorting(updater));
  }

  const joinOperatorParser = React.useMemo(
    () =>
      parseAsStringEnum([...JOIN_OPERATORS])
        .withOptions(queryStateOptions)
        .withDefault(initialTableState?.joinOperator ?? 'and'),
    [initialTableState, queryStateOptions]
  );

  const [joinOperator, setJoinOperator] = useQueryState(joinOperatorKey, joinOperatorParser);

  const getNextJoinOperator = useChainedUpdate(joinOperator);

  function onJoinOperatorChange(updater: Updater<JoinOperator>) {
    void setJoinOperator(getNextJoinOperator(updater));
  }

  const filterParsers = React.useMemo(
    () =>
      Object.fromEntries(
        columnIndex.filterableIds.map((id) => [
          id,
          getColumnFilterParser(id, columnIndex.variantById[id] ?? 'text').withOptions(
            queryStateOptions
          ),
        ])
      ),
    [columnIndex, queryStateOptions]
  );

  const [filterParams, setFilterParams] = useQueryStates(filterParsers);

  const search = React.useSyncExternalStore(
    subscribeToHistory,
    getLocationSearch,
    getServerLocationSearch
  );

  const filterOrder = React.useMemo(() => {
    const filterableIds = new Set(columnIndex.filterableIds);
    return [...new Set(new URLSearchParams(search).keys())]
      .filter((key) => filterableIds.has(key))
      .join('&');
  }, [columnIndex, search]);

  const urlFilters = React.useMemo(
    () =>
      sortColumnFiltersBySearch(
        getColumnFilters(columnIndex.filterableIds, (id) => filterParams[id] ?? []),
        filterOrder
      ),
    [columnIndex, filterParams, filterOrder]
  );
  const urlFiltersKey = getColumnFiltersKey(urlFilters);

  const [filtersDraft, setFiltersDraft] = React.useState<FiltersDraft | null>(() => {
    const initialFilters = initialTableState?.columnFilters;
    if (urlFilters.length > 0 || !initialFilters?.length) return null;

    return {
      filters: columnIndex.normalizeColumnFilters(initialFilters),
      urlFiltersKey,
      pageToReset: null,
    };
  });

  const activeDraft = filtersDraft?.urlFiltersKey === urlFiltersKey ? filtersDraft : null;
  const columnFilters = activeDraft?.filters ?? urlFilters;
  const pageIndex = activeDraft?.pageToReset === page ? 0 : page - 1;

  const pagination = React.useMemo<PaginationState>(
    () => ({ pageIndex, pageSize: perPage }),
    [pageIndex, perPage]
  );

  const getNextPagination = useChainedUpdate(pagination);

  function onPaginationChange(updater: Updater<PaginationState>) {
    const next = getNextPagination(updater);
    if (next.pageIndex !== pagination.pageIndex) {
      if (activeDraft?.pageToReset) {
        setFiltersDraft((prev) => prev && { ...prev, pageToReset: null });
      }
      void setPage(next.pageIndex + 1);
    }
    if (next.pageSize !== pagination.pageSize) {
      void setPerPage(next.pageSize);
    }
  }

  const debouncedWriteFilters = useDebouncedCallback(
    (columnFilters: ColumnFiltersState, sourceUrlFiltersKey: string) => {
      if (sourceUrlFiltersKey !== urlFiltersKey) return;

      const filters = getActiveFilters(columnIndex.normalizeColumnFilters(columnFilters)).filter(
        (filter) => Object.hasOwn(columnIndex.variantById, filter.id)
      );
      const params = new Map<string, ColumnFilterItem[] | null>();

      for (const filter of filters) {
        const group = params.get(filter.id);
        if (group) group.push(filter);
        else params.set(filter.id, [filter]);
      }
      for (const id of columnIndex.filterableIds) {
        if (!params.has(id)) params.set(id, null);
      }

      const nextUrlFiltersKey = getColumnFiltersKey(filters);
      setFiltersDraft((prev) => prev && { ...prev, urlFiltersKey: nextUrlFiltersKey });
      if (page !== 1) void setPage(1);
      void setFilterParams(Object.fromEntries(params));
    },
    debounceMs
  );

  const getNextColumnFilters = useChainedUpdate(columnFilters);

  function onColumnFiltersChange(updater: Updater<ColumnFiltersState>) {
    const filters = getNextColumnFilters(updater);
    setFiltersDraft({
      filters,
      urlFiltersKey,
      pageToReset: !isServer && page !== 1 ? page : null,
    });
    debouncedWriteFilters(filters, urlFiltersKey);
  }

  const table = useTable(
    {
      ...props,
      features: dataTableFeatures,
      columns,
      initialState: initialTableState,
      pageCount: isServer ? pageCount : undefined,
      state: {
        pagination,
        sorting,
        columnFilters,
        joinOperator,
      },
      onPaginationChange,
      onSortingChange,
      onColumnFiltersChange,
      onJoinOperatorChange,
      manualPagination: isServer,
      manualSorting: isServer,
      manualFiltering: isServer,
    },
    selectTableState
  );

  return { table };
}

function subscribeToHistory(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function getLocationSearch() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

function getServerLocationSearch() {
  if (typeof window !== 'undefined' && window.location?.search) {
    return window.location.search;
  }
  return '';
}

function selectTableState(state: TableState<DataTableFeatures>) {
  return {
    columnFilters: state.columnFilters,
    joinOperator: state.joinOperator,
    pagination: state.pagination,
    sorting: state.sorting,
  };
}

function useChainedUpdate<TValue>(value: TValue) {
  const pendingRef = React.useRef<{ base: TValue; next: TValue } | null>(null);

  return (updater: Updater<TValue>) => {
    const pending = pendingRef.current;
    const next = functionalUpdate(updater, pending?.base === value ? pending.next : value);
    pendingRef.current = { base: value, next };
    return next;
  };
}

function useShipdeDataTable(props: UseDataTableProps = {}): UseDataTableReturn {
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

  // URL query builder: builds from committed parameters and chains uncommitted rapid edits
  const createQueryString = useCallback(
    (params: Record<string, string | number | null | undefined>) => {
      const pending = pendingRef.current;
      const baseStr = pending && pending.base === committedParams ? pending.next : committedParams;
      const newSearchParams = new URLSearchParams(baseStr);

      for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') {
          newSearchParams.delete(key);
        } else {
          newSearchParams.set(key, String(value));
        }
      }

      const nextStr = newSearchParams.toString();
      pendingRef.current = { base: committedParams, next: nextStr };
      return nextStr;
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

export function useDataTable<TData extends RowData>(
  props: TablecnUseDataTableProps<TData>
): { table: any };
export function useDataTable(props?: UseDataTableProps): UseDataTableReturn;
export function useDataTable(props: any = {}): any {
  if (
    props &&
    'columns' in props &&
    Array.isArray(props.columns) &&
    !('filterableColumns' in props)
  ) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useTablecnDataTable(props);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useShipdeDataTable(props);
}
