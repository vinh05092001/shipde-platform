// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

'use client';

import {
  type ColumnFiltersState,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
  useTable,
} from '@tanstack/react-table';
import {
  parseAsInteger,
  parseAsStringEnum,
  useQueryStates,
  type UseQueryStatesKeysMap,
} from 'nuqs';
import * as React from 'react';

import type { ColumnFilterItem, JoinOperator } from './lib/data-table-types';

import { useDebouncedCallback } from '../../hooks/use-debounced-callback';
import { dataTableFeatures } from './lib/data-table-features';
import {
  getColumnFilterParser,
  getColumnFilters,
  getColumnFiltersKey,
  getSortingStateParser,
  sortColumnFiltersBySearch,
} from './lib/data-table-parsers';
import { getActiveFilters, JOIN_OPERATORS } from './lib/data-table-utils';
import {
  buildColumnIndex,
  DEBOUNCE_MS,
  DEFAULT_PAGE_SIZE,
  EMPTY_SORTING,
  getServerLocationSearch,
  getLocationSearch,
  JOIN_OPERATOR_KEY,
  PAGE_KEY,
  PER_PAGE_KEY,
  selectTableState,
  SORT_KEY,
  subscribeToHistory,
  THROTTLE_MS,
  type FiltersDraft,
  type TablecnUseDataTableProps,
} from './use-tablecn-helpers';

export function useTablecnDataTable<TData extends RowData>({
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
  shallow: shallowProp = false,
  startTransition,
  ...props
}: TablecnUseDataTableProps<TData>) {
  const isServer = mode === 'server';
  const shallow = isServer ? false : (shallowProp ?? true);

  const safeStartTransition = React.useCallback(
    (cb: () => void) => {
      try {
        (startTransition ?? ((fn) => fn()))(cb);
      } catch {
        cb();
      }
    },
    [startTransition]
  );

  const pageKey = queryKeys?.page ?? PAGE_KEY;
  const perPageKey = queryKeys?.perPage ?? PER_PAGE_KEY;
  const sortKey = queryKeys?.sort ?? SORT_KEY;
  const joinOperatorKey = queryKeys?.joinOperator ?? JOIN_OPERATOR_KEY;

  const [initialTableState] = React.useState(initialState);
  const columnIndex = React.useMemo(() => buildColumnIndex(columns), [columns]);

  const pageParser = React.useMemo(
    () => parseAsInteger.withOptions({ history, shallow }).withDefault(1),
    [history, shallow]
  );
  const perPageParser = React.useMemo(
    () =>
      parseAsInteger
        .withOptions({ history, shallow })
        .withDefault(initialTableState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE),
    [history, initialTableState, shallow]
  );
  const sortingParser = React.useMemo(
    () =>
      getSortingStateParser(columnIndex.sortableIds)
        .withOptions({ history, shallow })
        .withDefault(initialTableState?.sorting ?? EMPTY_SORTING),
    [columnIndex, history, initialTableState, shallow]
  );
  const joinOperatorParser = React.useMemo(
    () =>
      parseAsStringEnum([...JOIN_OPERATORS])
        .withOptions({ history, shallow })
        .withDefault(initialTableState?.joinOperator ?? 'and'),
    [history, initialTableState, shallow]
  );
  const filterParsers = React.useMemo(
    () =>
      Object.fromEntries(
        columnIndex.filterableIds.map((id) => [
          id,
          getColumnFilterParser(id, columnIndex.variantById[id] ?? 'text').withOptions({
            history: 'replace',
            shallow,
          }),
        ])
      ),
    [columnIndex, shallow]
  );

  const parsers = React.useMemo(
    () =>
      ({
        [pageKey]: pageParser,
        [perPageKey]: perPageParser,
        [sortKey]: sortingParser,
        [joinOperatorKey]: joinOperatorParser,
        ...filterParsers,
      }) as UseQueryStatesKeysMap,
    [
      pageKey,
      perPageKey,
      sortKey,
      joinOperatorKey,
      pageParser,
      perPageParser,
      sortingParser,
      joinOperatorParser,
      filterParsers,
    ]
  );

  const [state, setState] = useQueryStates(parsers, {
    shallow,
    history,
    clearOnDefault,
    startTransition: safeStartTransition,
  });

  const page: number = state[pageKey] ?? 1;
  const perPage: number =
    state[perPageKey] ?? initialTableState?.pagination?.pageSize ?? DEFAULT_PAGE_SIZE;
  const sorting: SortingState = state[sortKey] ?? initialTableState?.sorting ?? EMPTY_SORTING;
  const joinOperator: JoinOperator =
    state[joinOperatorKey] ?? initialTableState?.joinOperator ?? 'and';
  const filterParams = React.useMemo(() => {
    const result: Record<string, ColumnFilterItem[]> = {};
    for (const id of columnIndex.filterableIds) {
      result[id] = Array.isArray(state[id]) ? (state[id] as ColumnFilterItem[]) : [];
    }
    return result;
  }, [columnIndex.filterableIds, state]);

  const search = React.useSyncExternalStore(
    subscribeToHistory,
    getLocationSearch,
    getServerLocationSearch
  );

  const filterOrder = React.useMemo(() => {
    const ids = new Set(columnIndex.filterableIds);
    return [...new URLSearchParams(search).keys()].filter((k) => ids.has(k)).join('&');
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

  function onPaginationChange(updater: Updater<PaginationState>) {
    const next = updater instanceof Function ? updater(pagination) : updater;
    setState((prev) => ({
      [pageKey]: next.pageIndex + 1,
      ...(next.pageSize !== (prev[perPageKey] ?? DEFAULT_PAGE_SIZE)
        ? { [perPageKey]: next.pageSize }
        : {}),
    }));
    if (next.pageIndex !== pageIndex && activeDraft?.pageToReset) {
      setFiltersDraft((prev) => prev && { ...prev, pageToReset: null });
    }
  }

  function onSortingChange(updater: Updater<SortingState>) {
    const next = updater instanceof Function ? updater(sorting) : updater;
    setState(() => ({ [sortKey]: next }));
  }

  const debouncedWriteFilters = useDebouncedCallback(
    (columnFilters: ColumnFiltersState, sourceUrlFiltersKey: string) => {
      if (sourceUrlFiltersKey !== urlFiltersKey) return;

      const filters = getActiveFilters(columnIndex.normalizeColumnFilters(columnFilters)).filter(
        (filter) => Object.hasOwn(columnIndex.variantById, filter.id)
      );
      const params: Record<string, ColumnFilterItem[] | null> = {};

      for (const filter of filters) {
        if (!params[filter.id]) params[filter.id] = [];
        params[filter.id]!.push(filter);
      }
      for (const id of columnIndex.filterableIds) {
        if (params[id] === undefined) params[id] = null;
      }

      const nextUrlFiltersKey = getColumnFiltersKey(filters);
      setFiltersDraft((prev) => prev && { ...prev, urlFiltersKey: nextUrlFiltersKey });
      setState((prev) => ({
        ...(prev[pageKey] !== 1 ? { [pageKey]: 1 } : {}),
        ...params,
      }));
    },
    debounceMs
  );

  function onColumnFiltersChange(updater: Updater<ColumnFiltersState>) {
    const filters = updater instanceof Function ? updater(columnFilters) : updater;
    setFiltersDraft({
      filters,
      urlFiltersKey,
      pageToReset: !isServer && page !== 1 ? page : null,
    });
    debouncedWriteFilters(filters, urlFiltersKey);
  }

  function onJoinOperatorChange(updater: Updater<JoinOperator>) {
    const next = updater instanceof Function ? updater(joinOperator) : updater;
    setState(() => ({ [joinOperatorKey]: next }));
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
