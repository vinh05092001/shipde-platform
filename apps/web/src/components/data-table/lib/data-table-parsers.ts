// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import { parseAsInteger, parseAsStringEnum } from 'nuqs/server';

import type {
  ColumnFilterItem,
  ColumnSortItem,
  DataTableColumnConfig,
  DataTableColumnConfigs,
  DataTableColumnConfigsQuery,
  FilterableColumnId,
  FilterVariant,
  JoinOperator,
  SortableColumnId,
} from './data-table-types';

import { getFilterVariant, JOIN_OPERATORS } from './data-table-utils';
import {
  getColumnFilterParser,
  getKeys,
  serializeColumnFilter,
} from './data-table-parsers-filters';
import { getSortingStateParser } from './data-table-parsers-sorting';

export {
  getColumnFilterParser,
  parseColumnFilter,
  serializeColumnFilter,
} from './data-table-parsers-filters';
export { getSortingStateParser } from './data-table-parsers-sorting';

export function getColumnFilters<TColumnId extends string>(
  columnIds: readonly TColumnId[],
  getFilters: (id: TColumnId) => ColumnFilterItem<TColumnId>[]
) {
  return columnIds.flatMap((id) =>
    getFilters(id).map((filter, index) => ({
      ...filter,
      filterId: `${id}-${index}`,
    }))
  );
}

export function sortColumnFiltersBySearch<TFilter extends ColumnFilterItem>(
  filters: TFilter[],
  search: string | URLSearchParams
) {
  const positions = new Map<string, number>();
  for (const key of new URLSearchParams(search).keys()) {
    if (!positions.has(key)) positions.set(key, positions.size);
  }

  return [...filters].sort(
    (a, b) =>
      (positions.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (positions.get(b.id) ?? Number.POSITIVE_INFINITY)
  );
}

export function getColumnFiltersKey(filters: ColumnFilterItem[]) {
  return filters
    .map((filter) => `${filter.id}=${serializeColumnFilter(filter)}`)
    .sort()
    .join('&');
}

export function getFilterableColumns<TColumnConfigs extends DataTableColumnConfigs>(
  columnConfigs: TColumnConfigs
) {
  const entries = getKeys<keyof TColumnConfigs & string>(columnConfigs).flatMap((id) => {
    const config = columnConfigs[id];
    return config?.variant ? [[id, getFilterVariant(config)] as const] : [];
  });

  return Object.fromEntries(entries) as Record<FilterableColumnId<TColumnConfigs>, FilterVariant>;
}

export function getSortableColumns<TColumnConfigs extends DataTableColumnConfigs>(
  columnConfigs: TColumnConfigs
) {
  return getKeys<keyof TColumnConfigs & string>(columnConfigs).filter(
    (id): id is SortableColumnId<TColumnConfigs> => columnConfigs[id]?.isSortable !== false
  );
}

export function getColumnOptions(config: DataTableColumnConfig) {
  return {
    enableColumnFilter: config.variant !== undefined,
    enableSorting: config.isSortable !== false,
  };
}

interface DataTableSearchParamsOptions<TColumnConfigs extends DataTableColumnConfigs> {
  columnConfigs: TColumnConfigs;
  defaultSorting?: ColumnSortItem<NoInfer<SortableColumnId<TColumnConfigs>>>[];
  defaultPerPage?: number;
}

export function getDataTableSearchParams<TColumnConfigs extends DataTableColumnConfigs>({
  columnConfigs,
  defaultSorting = [],
  defaultPerPage = 10,
}: DataTableSearchParamsOptions<TColumnConfigs>) {
  return {
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(defaultPerPage),
    sort: getSortingStateParser(getSortableColumns(columnConfigs)).withDefault(defaultSorting),
    joinOperator: parseAsStringEnum([...JOIN_OPERATORS]).withDefault('and'),
    ...getFilterParsers(getFilterableColumns(columnConfigs)),
  };
}

interface DataTableSearch<TSortColumnId extends string> {
  page: number;
  perPage: number;
  sort: ColumnSortItem<TSortColumnId>[];
  joinOperator: JoinOperator;
}

export function getDataTableQuery<TColumnConfigs extends DataTableColumnConfigs>(
  search: NoInfer<
    DataTableSearch<SortableColumnId<TColumnConfigs>> &
      Record<
        FilterableColumnId<TColumnConfigs>,
        ColumnFilterItem<FilterableColumnId<TColumnConfigs>>[]
      >
  >,
  columnConfigs: TColumnConfigs
): DataTableColumnConfigsQuery<TColumnConfigs> {
  const filtersById: Record<
    FilterableColumnId<TColumnConfigs>,
    ColumnFilterItem<FilterableColumnId<TColumnConfigs>>[]
  > = search;

  return {
    page: search.page,
    perPage: search.perPage,
    sorting: search.sort,
    filters: getColumnFilters(
      getKeys(getFilterableColumns(columnConfigs)),
      (id) => filtersById[id]
    ),
    joinOperator: search.joinOperator,
  };
}

function getFilterParsers<TColumnId extends string>(columns: Record<TColumnId, FilterVariant>) {
  const parsers = getKeys(columns).map(
    (id) => [id, getColumnFilterParser(id, columns[id])] as const
  );
  return Object.fromEntries(parsers) as Record<
    TColumnId,
    ReturnType<typeof getColumnFilterParser<TColumnId>>
  >;
}
