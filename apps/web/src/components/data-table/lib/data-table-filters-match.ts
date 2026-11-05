// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import { constructFilterFn } from '@tanstack/react-table';

import type { ColumnFilterItem, DataTableColumnMeta } from './data-table-types';

import {
  createPlainFilter,
  getFilterVariant,
  parseFilterDate,
  stringifyFilterValue,
} from './data-table-utils';

const DAY_MS = 24 * 60 * 60 * 1000;

export function matchesFilter(
  cellValue: unknown,
  filter: Pick<ColumnFilterItem, 'operator' | 'variant' | 'value'>
): boolean {
  const { operator, variant, value } = filter;
  const isDate = variant === 'date' || variant === 'date-range';
  const isNumeric = variant === 'number' || variant === 'range';

  switch (operator) {
    case 'iLike':
      return typeof value === 'string'
        ? getLowercaseText(cellValue).includes(value.toLowerCase())
        : true;

    case 'notILike':
      return typeof value === 'string'
        ? !getLowercaseText(cellValue).includes(value.toLowerCase())
        : true;

    case 'eq':
      if (variant === 'boolean') return getBooleanString(cellValue) === value;
      if (isDate) return getIsSameDay(cellValue, value);
      if (isNumeric) return parseNumber(cellValue) === parseNumber(value);
      return stringifyFilterValue(cellValue) === String(value);

    case 'ne':
      if (variant === 'boolean') return getBooleanString(cellValue) !== value;
      if (isDate) return !getIsSameDay(cellValue, value);
      if (isNumeric) return parseNumber(cellValue) !== parseNumber(value);
      return stringifyFilterValue(cellValue) !== String(value);

    case 'inArray':
      return Array.isArray(value) ? value.includes(stringifyFilterValue(cellValue)) : true;

    case 'notInArray':
      return Array.isArray(value) ? !value.includes(stringifyFilterValue(cellValue)) : true;

    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return compare(cellValue, value, operator, isDate);

    case 'isBetween':
      return getIsBetween(cellValue, value, isDate);

    case 'isRelativeToToday':
      return getIsRelativeToToday(cellValue, value);

    case 'isEmpty':
      return getIsEmptyValue(cellValue);

    case 'isNotEmpty':
      return !getIsEmptyValue(cellValue);

    default:
      return true;
  }
}

export const dataTableFilterFn = constructFilterFn({
  filter: (dataValue, filterValue, row, columnId) => {
    const variant = getFilterVariant(
      row.table.getColumn(columnId)?.columnDef.meta as DataTableColumnMeta | undefined
    );
    const item = createPlainFilter(columnId, variant, filterValue);
    return !item || matchesFilter(dataValue, item);
  },
  autoRemove: (value) => value === undefined,
});

function getLowercaseText(value: unknown) {
  return stringifyFilterValue(value).toLowerCase();
}

function getBooleanString(value: unknown) {
  return value === true || value === 'true' ? 'true' : 'false';
}

function getIsSameDay(cellValue: unknown, value: unknown) {
  const cell = parseTime(cellValue);
  const target = parseTime(value);
  if (Number.isNaN(cell) || Number.isNaN(target)) return false;
  return cell >= startOfDay(target) && cell <= endOfDay(target);
}

function parseTime(value: unknown) {
  return parseFilterDate(value)?.getTime() ?? Number.NaN;
}

function startOfDay(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(time: number) {
  const date = new Date(time);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function parseNumber(value: unknown) {
  if (value === '' || value == null) return Number.NaN;
  return typeof value === 'number' ? value : Number(value);
}

function compare(
  cellValue: unknown,
  value: unknown,
  operator: 'lt' | 'lte' | 'gt' | 'gte',
  isDate: boolean
) {
  if (Array.isArray(value)) return true;

  let cell: number;
  let target: number;

  if (isDate) {
    cell = parseTime(cellValue);
    const time = parseTime(value);
    target = operator === 'lt' || operator === 'gte' ? startOfDay(time) : endOfDay(time);
  } else {
    cell = parseNumber(cellValue);
    target = parseNumber(value);
  }

  if (Number.isNaN(cell) || Number.isNaN(target)) return false;

  switch (operator) {
    case 'lt':
      return cell < target;
    case 'lte':
      return cell <= target;
    case 'gt':
      return cell > target;
    default:
      return cell >= target;
  }
}

function getIsBetween(cellValue: unknown, value: unknown, isDate: boolean) {
  if (!Array.isArray(value) || value.length !== 2) return true;

  const [rawStart, rawEnd] = value;
  const hasStart = stringifyFilterValue(rawStart).trim() !== '';
  const hasEnd = stringifyFilterValue(rawEnd).trim() !== '';

  if (!hasStart && !hasEnd) return true;

  const cell = isDate ? parseTime(cellValue) : parseNumber(cellValue);
  if (Number.isNaN(cell)) return false;

  if (isDate) {
    const start = hasStart ? startOfDay(parseTime(rawStart)) : null;
    const end = hasEnd ? endOfDay(parseTime(rawEnd)) : null;
    return (start === null || cell >= start) && (end === null || cell <= end);
  }

  const start = hasStart ? parseNumber(rawStart) : null;
  const end = hasEnd ? parseNumber(rawEnd) : null;

  return (start === null || cell >= start) && (end === null || cell <= end);
}

function getIsRelativeToToday(cellValue: unknown, value: unknown) {
  if (typeof value !== 'string') return true;

  const [amountRaw, unit] = value.split(' ');
  const amount = Number.parseInt(amountRaw ?? '', 10);
  if (Number.isNaN(amount) || !unit) return true;

  const today = Date.now();
  let start: number;
  let end: number;

  switch (unit) {
    case 'days':
      start = startOfDay(today + amount * DAY_MS);
      end = endOfDay(start);
      break;
    case 'weeks':
      start = startOfDay(today + amount * 7 * DAY_MS);
      end = endOfDay(start + 6 * DAY_MS);
      break;
    case 'months':
      start = startOfDay(today + amount * 30 * DAY_MS);
      end = endOfDay(start + 29 * DAY_MS);
      break;
    default:
      return true;
  }

  const cell = parseTime(cellValue);
  if (Number.isNaN(cell)) return false;
  return cell >= start && cell <= end;
}

function getIsEmptyValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}
