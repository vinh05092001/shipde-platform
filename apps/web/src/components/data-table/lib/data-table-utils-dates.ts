// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import type { ColumnFilterItem, FilterVariant } from './data-table-types';

import { formatDate } from './utils';

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseFilterDate(value: unknown): Date | undefined {
  if (value instanceof Date) return getValidDate(value);
  if (typeof value === 'number') return getValidDate(new Date(value));
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  const text = value.trim();
  const match = CALENDAR_DATE_PATTERN.exec(text);
  if (match) {
    const [, year, month, day] = match.map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return undefined;
    }
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
      ? date
      : undefined;
  }

  const numeric = Number(text);
  return getValidDate(new Date(Number.isNaN(numeric) ? text : numeric));
}

export function formatFilterDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getIsDateVariant(variant: FilterVariant) {
  return variant === 'date' || variant === 'date-range';
}

export function getFilterDates(value: ColumnFilterItem['value']) {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const date = parseFilterDate(item);
    return date ? [date] : [];
  });
}

export function getFilterDateValue(date: Date | undefined) {
  return date ? formatFilterDate(date) : '';
}

export function getDateFilterLabel(filter: ColumnFilterItem) {
  const [startDate, endDate] = getFilterDates(filter.value);
  if (!startDate) return undefined;

  const start = formatDate(startDate, { month: 'short' });
  if (
    filter.operator !== 'isBetween' ||
    !endDate ||
    startDate.toDateString() === endDate.toDateString()
  ) {
    return start;
  }

  return `${start} - ${formatDate(endDate, { month: 'short' })}`;
}

function getValidDate(date: Date) {
  return Number.isNaN(date.getTime()) ? undefined : date;
}
