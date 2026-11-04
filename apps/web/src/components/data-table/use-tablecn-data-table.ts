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
  useQueryState,
  type UseQueryStateOptions,
  useQueryStates,
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
  useChainedUpdate,
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

  const columnIndex = React.useMemo(() => buildColumnIndex(columns), [columns]);

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
    return [...new URLSearchParams(search).keys()]
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
