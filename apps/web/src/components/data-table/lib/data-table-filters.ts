// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import {
  type RowData,
  skipFirstRun,
  type Table,
  type TableFeatures,
  tableMemo,
} from '@tanstack/react-table';

import {
  asFilteringTable,
  getFacetedRowModel,
  getFilteredRowModel,
} from './data-table-filters-row-model';

export * from './data-table-filters-match';

export function createDataTableFilteredRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>() {
  return (table: Table<TFeatures, TData>) => {
    const instance = asFilteringTable(table);

    return tableMemo({
      feature: 'dataTableFilteringFeature',
      table,
      fnName: 'table.getFilteredRowModel',
      memoDeps: () => [
        table.getPreFilteredRowModel(),
        instance.atoms.columnFilters?.get(),
        instance.atoms.joinOperator?.get(),
        instance.atoms.globalFilter?.get(),
      ],
      fn: () => getFilteredRowModel(table.getPreFilteredRowModel(), instance),
      onAfterUpdate: skipFirstRun(() => instance.autoResetPageIndex?.()),
    });
  };
}

export function createDataTableFacetedRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>() {
  return (table: Table<TFeatures, TData>, columnId: string) => {
    const instance = asFilteringTable(table);

    return tableMemo({
      feature: 'columnFacetingFeature',
      table,
      fnName: 'createDataTableFacetedRowModel',
      memoDeps: () => [
        table.getPreFilteredRowModel(),
        instance.atoms.columnFilters?.get(),
        instance.atoms.joinOperator?.get(),
        instance.atoms.globalFilter?.get(),
        table.getFilteredRowModel(),
      ],
      fn: () => getFacetedRowModel(table.getPreFilteredRowModel(), columnId, instance),
    });
  };
}
