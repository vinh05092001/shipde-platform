// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import type { Column, ColumnFilter, RowData, SortingState, Table } from '@tanstack/react-table';

import type { DataTableFeatures } from './data-table-features';
import type { ColumnFilterItem, FilterOperator, FilterVariant } from './data-table-types';

import { formatFilterDate, getIsDateVariant, parseFilterDate } from './data-table-utils-dates';
import {
  getIsMultiValueVariant,
  getIsValuelessOperator,
  getPlainFilterId,
  getPlainFilterOperator,
} from './data-table-utils-operators';

export * from './data-table-utils-dates';
export * from './data-table-utils-operators';

export function getAriaSort(
  sorting: SortingState,
  columnId: string
): React.AriaAttributes['aria-sort'] {
  const sort = sorting[0];
  if (sort?.id !== columnId) return undefined;
  return sort.desc ? 'descending' : 'ascending';
}

export function getVisibleSelectedRows<TData extends RowData>(
  table: Table<DataTableFeatures, TData>
) {
  return table.getRowModel().rows.filter((row) => row.getIsSelected());
}

export function getColumnPinningStyle<TData extends RowData>(
  column: Column<DataTableFeatures, TData>,
  isPinned = column.getIsPinned()
): React.CSSProperties {
  return {
    insetInlineStart:
      isPinned === 'start' ? `var(${getColumnVar(column.id, 'offset')})` : undefined,
    insetInlineEnd: isPinned === 'end' ? `var(${getColumnVar(column.id, 'offset')})` : undefined,
    position: isPinned ? 'sticky' : 'relative',
    width: `var(${getColumnVar(column.id, 'size')})`,
    zIndex: isPinned ? 20 : undefined,
  };
}

export function getColumnSizingStyle<TData extends RowData>(
  table: Table<DataTableFeatures, TData>
): React.CSSProperties {
  const style: Record<string, string> = {
    minWidth: `${table.getTotalSize()}px`,
  };

  for (const header of table.getFlatHeaders()) {
    style[getColumnVar(header.column.id, 'size')] = `${header.getSize()}px`;
  }

  for (const { column } of table.getLeafHeaders()) {
    const isPinned = column.getIsPinned();
    if (!isPinned) continue;

    const offset = isPinned === 'start' ? column.getStart('start') : column.getAfter('end');
    style[getColumnVar(column.id, 'offset')] = `${offset}px`;
  }

  return style;
}

export function getIsEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function getColumnVar(columnId: string, property: 'size' | 'offset') {
  const name = columnId.replace(
    /[^a-zA-Z0-9-]/g,
    (char) => `_${char.codePointAt(0)?.toString(16)}_`
  );
  return `--column-${name}-${property}`;
}

export function stringifyFilterValue(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- narrows `unknown` for no-base-to-string
  return String(value as string | number | boolean | bigint);
}

const UNBOUNDED_RANGE: [number, number] = [-Infinity, Infinity];

export function getRangeFilterBounds(
  values: [string, string],
  [min, max]: [number, number] = UNBOUNDED_RANGE
): [number | undefined, number | undefined] {
  const [start, end] = values.map((value) => {
    const number = Number(value);
    return value.trim() === '' || Number.isNaN(number)
      ? undefined
      : Math.min(Math.max(number, min), max);
  });

  return start !== undefined && end !== undefined && start > end ? [end, start] : [start, end];
}

export function getValidRangeFilterBounds(
  values: [string, string],
  [min, max]: [number, number] = UNBOUNDED_RANGE
): [number | undefined, number | undefined] | null {
  const [start, end] = values.map((value) => (value.trim() === '' ? undefined : Number(value)));

  for (const bound of [start, end]) {
    if (bound === undefined) continue;
    if (Number.isNaN(bound) || bound < min || bound > max) return null;
  }
  if (start !== undefined && end !== undefined && start > end) return null;

  return [start, end];
}

export function createPlainFilter<TColumnId extends string>(
  id: TColumnId,
  variant: FilterVariant,
  value: unknown
): ColumnFilterItem<TColumnId> | null {
  if (value === undefined || value === null || value === '') return null;

  const operator = getPlainFilterOperator(variant);
  const filterId = getPlainFilterId(id);
  const stringify = getFilterValueStringifier(variant, operator);

  if (getIsMultiValueVariant(variant)) {
    const values = normalizeFilterValues(
      variant,
      operator,
      (Array.isArray(value) ? value : [value]).map(stringify)
    );
    if (values.every((item) => item === '')) return null;
    return { id, variant, operator, value: values, filterId };
  }

  if (Array.isArray(value)) return null;

  return { id, variant, operator, value: stringify(value), filterId };
}

export function normalizeColumnFilter(
  filter: ColumnFilter,
  variant: FilterVariant
): ColumnFilterItem {
  const filterId = filter.filterId ?? getPlainFilterId(filter.id);

  if (filter.operator) {
    const filterVariant = filter.variant ?? variant;
    const stringify = getFilterValueStringifier(filterVariant, filter.operator);

    return {
      id: filter.id,
      variant: filterVariant,
      operator: filter.operator,
      value: Array.isArray(filter.value)
        ? normalizeFilterValues(filterVariant, filter.operator, filter.value.map(stringify))
        : stringify(filter.value),
      filterId,
    };
  }

  const item = createPlainFilter(filter.id, variant, filter.value);
  if (item) return { ...item, filterId };

  return {
    id: filter.id,
    variant,
    operator: getPlainFilterOperator(variant),
    value: getIsMultiValueVariant(variant) ? [] : '',
    filterId,
  };
}

export function getPlainFilterValue(filter: ColumnFilterItem): unknown {
  const { variant, value } = filter;

  if (variant === 'select' || variant === 'multi-select') {
    return Array.isArray(value) ? value : [value];
  }

  if (variant === 'range') {
    return Array.isArray(value)
      ? value.map((item) => (item === '' ? undefined : Number(item)))
      : value;
  }

  if (getIsDateVariant(variant)) {
    return Array.isArray(value)
      ? value.map((item) => parseFilterDate(item)?.getTime())
      : parseFilterDate(value)?.getTime();
  }

  return value;
}

export function getIsActiveFilter(filter: ColumnFilterItem) {
  return (
    getIsValuelessOperator(filter.operator) ||
    (Array.isArray(filter.value) ? filter.value.some((value) => value !== '') : filter.value !== '')
  );
}

export function getActiveFilters<TFilterItem extends ColumnFilterItem>(
  filters: TFilterItem[]
): TFilterItem[] {
  return filters.filter(getIsActiveFilter);
}

function normalizeFilterValues(variant: FilterVariant, operator: FilterOperator, values: string[]) {
  if (operator !== 'isBetween') return values;

  if (getIsDateVariant(variant)) {
    const [start = '', end = ''] = values;
    const startTime = parseFilterDate(start)?.getTime();
    const endTime = parseFilterDate(end)?.getTime();
    return startTime !== undefined && endTime !== undefined && startTime > endTime
      ? [end, start]
      : [start, end];
  }

  if (variant !== 'number' && variant !== 'range') return values;

  const [start = '', end = ''] = values.map((value) => {
    const trimmed = value.trim();
    return trimmed === '' || Number.isNaN(Number(trimmed)) ? '' : trimmed;
  });

  return start !== '' && end !== '' && Number(start) > Number(end) ? [end, start] : [start, end];
}

function getFilterValueStringifier(variant: FilterVariant, operator: FilterOperator) {
  return getIsDateVariant(variant) && operator !== 'isRelativeToToday'
    ? stringifyFilterDate
    : stringifyFilterValue;
}

function stringifyFilterDate(value: unknown) {
  const date = parseFilterDate(value);
  return date ? formatFilterDate(date) : '';
}
