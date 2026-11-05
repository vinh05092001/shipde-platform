// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import {
  type ColumnFilter,
  constructRow,
  type FilterFn,
  makeObjectMap,
  type Row,
  type RowData,
  type RowModel,
  type Table,
  type TableFeatures,
} from '@tanstack/react-table';

import type { DataTableColumnMeta, JoinOperator } from './data-table-types';

import { getFilterVariant, getIsActiveFilter, normalizeColumnFilter } from './data-table-utils';

import { dataTableFilterFn, matchesFilter } from './data-table-filters-match';

const GLOBAL_FILTER_ID = '__global__';

const filterResultsByRow = new WeakMap<object, Record<string, boolean>>();

export interface FilteringColumn<TFeatures extends TableFeatures, TData extends RowData> {
  id: string;
  columnDef: { meta?: unknown };
  getFilterFn?: () => FilterFn<TFeatures, TData> | undefined;
  getCanGlobalFilter?: () => boolean;
}

export interface FilteringMembers<TFeatures extends TableFeatures, TData extends RowData> {
  atoms: {
    columnFilters?: { get: () => ColumnFilter[] };
    joinOperator?: { get: () => JoinOperator };
    globalFilter?: { get: () => unknown };
  };
  options: { filterFromLeafRows?: boolean; maxLeafRowFilterDepth?: number };
  getColumn: (columnId: string) => FilteringColumn<TFeatures, TData> | undefined;
  getAllLeafColumns: () => FilteringColumn<TFeatures, TData>[];
  getGlobalFilterFn?: () => FilterFn<TFeatures, TData> | undefined;
  autoResetPageIndex?: () => void;
}

export type FilteringInstance<
  TFeatures extends TableFeatures,
  TData extends RowData,
> = FilteringMembers<TFeatures, TData> & Table<TFeatures, TData>;

export function asFilteringTable<TFeatures extends TableFeatures, TData extends RowData>(
  table: Table<TFeatures, TData>
) {
  return table as FilteringInstance<TFeatures, TData>;
}

type RowTest<TFeatures extends TableFeatures, TData extends RowData> = (
  row: Row<TFeatures, TData>
) => boolean;

export function getFilteredRowModel<TFeatures extends TableFeatures, TData extends RowData>(
  rowModel: RowModel<TFeatures, TData>,
  instance: FilteringInstance<TFeatures, TData>
): RowModel<TFeatures, TData> {
  const joinOperator = instance.atoms.joinOperator?.get() ?? 'and';
  const testsByColumn = new Map<string, RowTest<TFeatures, TData>[]>();

  for (const filter of instance.atoms.columnFilters?.get() ?? []) {
    const column = instance.getColumn(filter.id);
    const test = column ? getFilterTest(column, filter) : null;
    if (!test) continue;
    testsByColumn.set(filter.id, [...(testsByColumn.get(filter.id) ?? []), test]);
  }

  const globalTests = getGlobalFilterTests(instance);
  const hasFilters = testsByColumn.size > 0 || globalTests.length > 0;

  for (const row of rowModel.flatRows) {
    const results = makeObjectMap<boolean>();

    if (hasFilters) {
      for (const [columnId, tests] of testsByColumn) {
        results[columnId] =
          joinOperator === 'or'
            ? tests.some((test) => test(row))
            : tests.every((test) => test(row));
      }
      if (globalTests.length > 0) {
        results[GLOBAL_FILTER_ID] = globalTests.some((test) => test(row));
      }
    }

    setFilterResults(row, results);
  }

  if (!hasFilters || rowModel.rows.length === 0) return rowModel;

  return filterRows(rowModel.rows, (row) => getRowPasses(row, joinOperator), instance);
}

function getFilterTest<TFeatures extends TableFeatures, TData extends RowData>(
  column: FilteringColumn<TFeatures, TData>,
  filter: ColumnFilter
): RowTest<TFeatures, TData> | null {
  const filterFn = column.getFilterFn?.();

  if (!filter.operator && filterFn && !Object.is(filterFn, dataTableFilterFn)) {
    const value = filterFn.resolveFilterValue?.(filter.value) ?? filter.value;
    return (row) => filterFn(row, column.id, value);
  }

  const item = normalizeColumnFilter(
    filter,
    getFilterVariant(column.columnDef.meta as DataTableColumnMeta | undefined)
  );
  if (!getIsActiveFilter(item)) return null;

  return (row) => matchesFilter(row.getValue(column.id), item);
}

function getGlobalFilterTests<TFeatures extends TableFeatures, TData extends RowData>(
  instance: FilteringInstance<TFeatures, TData>
): RowTest<TFeatures, TData>[] {
  const globalFilter = instance.atoms.globalFilter?.get();
  const filterFn = instance.getGlobalFilterFn?.();

  if (globalFilter === undefined || globalFilter === null || globalFilter === '' || !filterFn) {
    return [];
  }

  const value = filterFn.resolveFilterValue?.(globalFilter) ?? globalFilter;

  return instance
    .getAllLeafColumns()
    .filter((column) => column.getCanGlobalFilter?.())
    .map((column) => (row) => filterFn(row, column.id, value));
}

function setFilterResults<TFeatures extends TableFeatures, TData extends RowData>(
  row: Row<TFeatures, TData>,
  results: Record<string, boolean> = {}
) {
  filterResultsByRow.set(row, results);
  Object.assign(row, {
    columnFilters: results,
    columnFiltersMeta: makeObjectMap(),
  });
}

function filterRows<TFeatures extends TableFeatures, TData extends RowData>(
  rows: Row<TFeatures, TData>[],
  passes: RowTest<TFeatures, TData>,
  instance: FilteringInstance<TFeatures, TData>
): RowModel<TFeatures, TData> {
  const maxDepth = instance.options.maxLeafRowFilterDepth ?? 100;
  const flatRows: Row<TFeatures, TData>[] = [];
  const rowsById = makeObjectMap<Row<TFeatures, TData>>();

  function copyRow(row: Row<TFeatures, TData>) {
    const copy = constructRow(
      instance,
      row.id,
      row.original,
      row.index,
      row.depth,
      undefined,
      row.parentId
    );
    setFilterResults(copy, filterResultsByRow.get(row));
    return copy;
  }

  function addToFlat(subRows: Row<TFeatures, TData>[]) {
    for (const subRow of subRows) {
      flatRows.push(subRow);
      rowsById[subRow.id] = subRow;
      if (subRow.subRows.length) addToFlat(subRow.subRows);
    }
  }

  function fromLeafs(
    rowsToFilter: Row<TFeatures, TData>[],
    depth: number
  ): Row<TFeatures, TData>[] {
    const filtered: Row<TFeatures, TData>[] = [];

    for (const row of rowsToFilter) {
      const copy = copyRow(row);

      if (row.subRows.length && depth < maxDepth) {
        copy.subRows = fromLeafs(row.subRows, depth + 1);
        if (copy.subRows.length || passes(copy)) filtered.push(copy);
      } else if (passes(copy)) {
        copy.subRows = row.subRows;
        filtered.push(copy);
      }
    }

    return filtered;
  }

  function fromRoot(rowsToFilter: Row<TFeatures, TData>[], depth: number): Row<TFeatures, TData>[] {
    const filtered: Row<TFeatures, TData>[] = [];

    for (const row of rowsToFilter) {
      if (!passes(row)) continue;

      if (row.subRows.length && depth < maxDepth) {
        const copy = copyRow(row);
        filtered.push(copy);
        flatRows.push(copy);
        rowsById[copy.id] = copy;
        copy.subRows = fromRoot(row.subRows, depth + 1);
      } else {
        filtered.push(row);
        flatRows.push(row);
        rowsById[row.id] = row;
        if (row.subRows.length) addToFlat(row.subRows);
      }
    }

    return filtered;
  }

  if (instance.options.filterFromLeafRows) {
    const filtered = fromLeafs(rows, 0);
    addToFlat(filtered);
    return { rows: filtered, flatRows, rowsById };
  }

  return { rows: fromRoot(rows, 0), flatRows, rowsById };
}

function getRowPasses<TFeatures extends TableFeatures, TData extends RowData>(
  row: Row<TFeatures, TData>,
  joinOperator: JoinOperator,
  excludedColumnId?: string
) {
  const results = filterResultsByRow.get(row) ?? {};

  if (excludedColumnId !== GLOBAL_FILTER_ID && results[GLOBAL_FILTER_ID] === false) {
    return false;
  }

  const columnIds = Object.keys(results).filter(
    (id) => id !== GLOBAL_FILTER_ID && id !== excludedColumnId
  );
  if (columnIds.length === 0) return true;

  return joinOperator === 'or'
    ? columnIds.some((id) => results[id])
    : columnIds.every((id) => results[id]);
}

export function getFacetedRowModel<TFeatures extends TableFeatures, TData extends RowData>(
  rowModel: RowModel<TFeatures, TData>,
  columnId: string,
  instance: FilteringInstance<TFeatures, TData>
): RowModel<TFeatures, TData> {
  const globalFilter = instance.atoms.globalFilter?.get();
  const hasGlobalFilter =
    columnId !== GLOBAL_FILTER_ID &&
    globalFilter !== undefined &&
    globalFilter !== null &&
    globalFilter !== '';
  const hasOtherFilters =
    hasGlobalFilter ||
    (instance.atoms.columnFilters?.get() ?? []).some((filter) => filter.id !== columnId);

  if (!hasOtherFilters || rowModel.rows.length === 0) return rowModel;

  const joinOperator = instance.atoms.joinOperator?.get() ?? 'and';

  return filterRows(rowModel.rows, (row) => getRowPasses(row, joinOperator, columnId), instance);
}
