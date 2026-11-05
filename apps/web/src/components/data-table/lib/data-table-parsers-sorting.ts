// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import { createParser } from 'nuqs/server';

import type { ColumnSortItem } from './data-table-types';

export const getSortingStateParser = <TColumnId extends string = string>(
  columnIds?: readonly TColumnId[] | Set<TColumnId>
) => {
  const validIds = getIdSet(columnIds);

  return createParser<ColumnSortItem<TColumnId>[]>({
    parse: (value) => {
      const sorting = parseSorting(value);
      return sorting && getHasKnownIds(sorting, validIds) ? sorting : null;
    },
    serialize: (value) => {
      const compact = value.map((item) => `${item.id}.${item.desc ? 'desc' : 'asc'}`).join(',');
      const parsed = parseSorting(compact);

      // Ids with a comma, or a first id starting with `[`, don't round-trip
      return parsed && getIsSameSorting(parsed, value) ? compact : JSON.stringify(value);
    },
    eq: getIsSameSorting,
  });
};

function getIdSet<TColumnId extends string>(ids?: readonly TColumnId[] | Set<TColumnId>) {
  if (!ids) return null;
  return ids instanceof Set ? ids : new Set(ids);
}

function parseSorting(value: string): ColumnSortItem[] | null {
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return null;
      for (const item of parsed) {
        if (
          typeof item !== 'object' ||
          !item ||
          typeof item.id !== 'string' ||
          typeof item.desc !== 'boolean'
        ) {
          return null;
        }
      }
      return parsed as ColumnSortItem[];
    } catch {
      return null;
    }
  }

  const sorting: ColumnSortItem[] = [];

  for (const part of value.split(',')) {
    const index = part.lastIndexOf('.');
    const order = part.slice(index + 1);

    if (index <= 0 || (order !== 'asc' && order !== 'desc')) return null;

    sorting.push({ id: part.slice(0, index), desc: order === 'desc' });
  }

  return sorting;
}

function getHasKnownIds<TColumnItem extends { id: string }, TColumnId extends string>(
  items: TColumnItem[],
  ids: ReadonlySet<TColumnId> | null
): items is (TColumnItem & { id: TColumnId })[] {
  const knownIds: ReadonlySet<string> | null = ids;
  return knownIds === null || items.every((item) => knownIds.has(item.id));
}

function getIsSameSorting(a: ColumnSortItem[], b: ColumnSortItem[]) {
  return (
    a.length === b.length &&
    a.every((item, index) => item.id === b[index]?.id && item.desc === b[index]?.desc)
  );
}
