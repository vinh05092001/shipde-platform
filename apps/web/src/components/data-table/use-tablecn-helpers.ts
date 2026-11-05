// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

'use client';

import {
  type ColumnFiltersState,
  functionalUpdate,
  type RowData,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
} from '@tanstack/react-table';
import * as React from 'react';

import type { DataTableFeatures } from './lib/data-table-features';
import type { DataTableQueryKeys, FilterVariant } from './lib/data-table-types';
import { getFilterVariant, normalizeColumnFilter } from './lib/data-table-utils';

export const PAGE_KEY = 'page';
export const PER_PAGE_KEY = 'perPage';
export const SORT_KEY = 'sort';
export const JOIN_OPERATOR_KEY = 'joinOperator';
export const DEBOUNCE_MS = 300;
export const THROTTLE_MS = 50;
export const DEFAULT_PAGE_SIZE = 10;
export const EMPTY_SORTING: SortingState = [];

export interface FiltersDraft {
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
        mode?: 'client';
        pageCount?: never;
      }
  );

export function buildColumnIndex(columns: any) {
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
}

export function subscribeToHistory(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

export function getLocationSearch() {
  if (typeof window === 'undefined') return '';
  return window.location.search;
}

export function getServerLocationSearch() {
  if (typeof window !== 'undefined' && window.location?.search) {
    return window.location.search;
  }
  return '';
}

export function selectTableState(state: TableState<DataTableFeatures>) {
  return {
    columnFilters: state.columnFilters,
    joinOperator: state.joinOperator,
    pagination: state.pagination,
    sorting: state.sorting,
  };
}

export function useChainedUpdate<TValue>(value: TValue) {
  const pendingRef = React.useRef<{ base: TValue; next: TValue } | null>(null);

  return (updater: Updater<TValue>) => {
    const pending = pendingRef.current;
    const next = functionalUpdate(updater, pending?.base === value ? pending.next : value);
    pendingRef.current = { base: value, next };
    return next;
  };
}
