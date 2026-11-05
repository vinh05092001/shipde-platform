// Ship Dễ server-driven data table state.

'use client';

import { parseAsInteger, parseAsString, useQueryStates, type UseQueryStatesKeysMap } from 'nuqs';
import * as React from 'react';

import { filterValuesParser, parseFilterValues, sortParamParser } from './data-table-url-params';
import { ColumnSort, DataTableFilterableColumn, DataTableSearchableColumn } from './types';

export interface UseDataTableProps {
  pageCount?: number;
  defaultPageSize?: number;
  filterableColumns?: DataTableFilterableColumn[];
  searchableColumns?: DataTableSearchableColumn[];
  defaultSort?: ColumnSort;
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
  isPending: boolean;
  resetEpoch: number;
  table?: any;
}

const PAGE_KEY = 'page';
const PER_PAGE_KEY = 'per_page';
const SORT_KEY = 'sort';
const SEARCH_KEY = 'search';

export function useShipdeDataTable(props: UseDataTableProps = {}): UseDataTableReturn {
  const {
    pageCount = 1,
    defaultPageSize = 10,
    filterableColumns = [],
    searchableColumns = [],
    defaultSort,
  } = props;

  const [isPending, startTransition] = React.useTransition();
  const [resetEpoch, setResetEpoch] = React.useState(0);

  // Column visibility local state
  const [visibleColumns, setVisibleColumns] = React.useState<Set<string>>(() => new Set());

  // Single source of truth for every table URL parameter (BR-UI-01): one nuqs
  // useQueryStates holding page, per_page, sort, search and every facet column.
  const parsers = React.useMemo(
    () =>
      ({
        [PAGE_KEY]: parseAsInteger.withDefault(1),
        [PER_PAGE_KEY]: parseAsInteger.withDefault(defaultPageSize),
        [SORT_KEY]: sortParamParser,
        [SEARCH_KEY]: parseAsString.withDefault(''),
        ...Object.fromEntries(
          filterableColumns.map((col) => [
            col.id,
            filterValuesParser.withOptions({ history: 'replace' }).withDefault([]),
          ])
        ),
        ...Object.fromEntries(
          searchableColumns.map((col) => [col.id, filterValuesParser.withDefault([])])
        ),
      }) as UseQueryStatesKeysMap,
    [defaultPageSize, filterableColumns, searchableColumns]
  );

  // Server-driven table: shallow: false so every URL change reruns the server page.
  const [state, setTableState] = useQueryStates(parsers, {
    shallow: false,
    history: 'push',
    startTransition,
  });

  const page: number = state[PAGE_KEY] ?? 1;
  const perPage: number = state[PER_PAGE_KEY] ?? defaultPageSize;

  const sort = React.useMemo<ColumnSort | null>(
    () => state[SORT_KEY] ?? defaultSort ?? null,
    [state, defaultSort]
  );

  const searchValue: string = state[SEARCH_KEY] ?? '';

  const filters = React.useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const col of filterableColumns) {
      result[col.id] = Array.isArray(state[col.id]) ? state[col.id] : [];
    }
    return result;
  }, [filterableColumns, state]);

  const getFilter = React.useCallback(
    (key: string): string[] => {
      const value = state[key];
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') return parseFilterValues(value);
      return [];
    },
    [state]
  );

  const isFiltered = React.useMemo(() => {
    if (searchValue.trim().length > 0) return true;
    for (const col of [...filterableColumns, ...searchableColumns]) {
      if (getFilter(col.id).length > 0) return true;
    }
    return false;
  }, [filterableColumns, getFilter, searchableColumns, searchValue]);

  // Every write is a functional partial patch of the single nuqs state: only the
  // keys touched by the action are queued, so successive updates in one tick
  // compose instead of clobbering each other (no committed-snapshot builder).
  const setPagination = React.useCallback(
    (newPage: number, newPageSize?: number) => {
      setTableState(() => ({
        [PAGE_KEY]: newPage <= 1 ? null : newPage,
        ...(newPageSize !== undefined ? { [PER_PAGE_KEY]: newPageSize } : {}),
      }));
    },
    [setTableState]
  );

  const setSort = React.useCallback(
    (columnId: string, desc?: boolean) => {
      setTableState((prev) => {
        const current = prev[SORT_KEY] ?? defaultSort ?? null;
        let nextSort: ColumnSort | null;
        if (desc !== undefined) {
          nextSort = { id: columnId, desc };
        } else if (current?.id === columnId) {
          nextSort = current.desc ? null : { id: columnId, desc: true };
        } else {
          nextSort = { id: columnId, desc: false };
        }
        return { [SORT_KEY]: nextSort, [PAGE_KEY]: null };
      });
    },
    [defaultSort, setTableState]
  );

  const setSearch = React.useCallback(
    (val: string | null) => {
      const queryVal = val !== null && val !== undefined && val.length > 0 ? val : null;
      setTableState(() => ({ [SEARCH_KEY]: queryVal, [PAGE_KEY]: null }));
    },
    [setTableState]
  );

  const setFilter = React.useCallback(
    (key: string, values: string[] | string | null) => {
      const nextValues = Array.isArray(values) ? values.filter(Boolean) : parseFilterValues(values);
      setTableState(() => ({
        [key]: nextValues.length > 0 ? nextValues : null,
        [PAGE_KEY]: null,
      }));
    },
    [setTableState]
  );

  const resetFilters = React.useCallback(() => {
    setResetEpoch((epoch) => epoch + 1);
    setTableState(() => {
      const cleared: Record<string, null> = {
        [PAGE_KEY]: null,
        [SORT_KEY]: null,
        [SEARCH_KEY]: null,
      };
      for (const col of [...filterableColumns, ...searchableColumns]) {
        cleared[col.id] = null;
      }
      return cleared;
    });
  }, [filterableColumns, searchableColumns, setTableState]);

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
    isPending,
    resetEpoch,
  };
}
