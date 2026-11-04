// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import type { Column, RowData } from '@tanstack/react-table';

import type { DataTableFeatures } from './data-table-features';
import type {
  ColumnFilterItem,
  ColumnSelectOption,
  ColumnVariantMeta,
  FilterOperator,
  FilterOperatorOption,
  FilterVariant,
} from './data-table-types';

export const FILTER_VARIANTS = [
  'text',
  'number',
  'range',
  'date',
  'date-range',
  'boolean',
  'select',
  'multi-select',
] as const;

export const FILTER_OPERATORS = {
  iLike: 'ilike',
  notILike: 'not.ilike',
  eq: 'eq',
  ne: 'neq',
  inArray: 'in',
  notInArray: 'not.in',
  isEmpty: 'is.empty',
  isNotEmpty: 'not.is.empty',
  lt: 'lt',
  lte: 'lte',
  gt: 'gt',
  gte: 'gte',
  isBetween: 'between',
  isRelativeToToday: 'rel',
} as const;

export const JOIN_OPERATORS = ['and', 'or'] as const;

export const SORT_ORDERS = [
  { label: 'Asc', value: 'asc' },
  { label: 'Desc', value: 'desc' },
] as const;

const TEXT_OPERATORS = [
  { label: 'Contains', value: 'iLike' },
  { label: 'Does not contain', value: 'notILike' },
  { label: 'Is', value: 'eq' },
  { label: 'Is not', value: 'ne' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'isNotEmpty' },
] satisfies FilterOperatorOption[];

const NUMERIC_OPERATORS = [
  { label: 'Is', value: 'eq' },
  { label: 'Is not', value: 'ne' },
  { label: 'Is less than', value: 'lt' },
  { label: 'Is less than or equal to', value: 'lte' },
  { label: 'Is greater than', value: 'gt' },
  { label: 'Is greater than or equal to', value: 'gte' },
  { label: 'Is between', value: 'isBetween' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'isNotEmpty' },
] satisfies FilterOperatorOption[];

const DATE_OPERATORS = [
  { label: 'Is', value: 'eq' },
  { label: 'Is not', value: 'ne' },
  { label: 'Is before', value: 'lt' },
  { label: 'Is after', value: 'gt' },
  { label: 'Is on or before', value: 'lte' },
  { label: 'Is on or after', value: 'gte' },
  { label: 'Is between', value: 'isBetween' },
  { label: 'Is relative to today', value: 'isRelativeToToday' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'isNotEmpty' },
] satisfies FilterOperatorOption[];

const SELECT_OPERATORS = [
  { label: 'Is', value: 'eq' },
  { label: 'Is not', value: 'ne' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'isNotEmpty' },
] satisfies FilterOperatorOption[];

const MULTI_SELECT_OPERATORS = [
  { label: 'Has any of', value: 'inArray' },
  { label: 'Has none of', value: 'notInArray' },
  { label: 'Is empty', value: 'isEmpty' },
  { label: 'Is not empty', value: 'isNotEmpty' },
] satisfies FilterOperatorOption[];

const BOOLEAN_OPERATORS = [
  { label: 'Is', value: 'eq' },
  { label: 'Is not', value: 'ne' },
] satisfies FilterOperatorOption[];

const MULTI_VALUE_FILTER_VARIANTS: FilterVariant[] = [
  'select',
  'multi-select',
  'range',
  'date-range',
];

const FILTER_OPERATORS_BY_VARIANT: Record<FilterVariant, FilterOperatorOption[]> = {
  text: TEXT_OPERATORS,
  number: NUMERIC_OPERATORS,
  range: NUMERIC_OPERATORS,
  date: DATE_OPERATORS,
  'date-range': DATE_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  select: SELECT_OPERATORS,
  'multi-select': MULTI_SELECT_OPERATORS,
};

export function getFilterOperators(filterVariant: FilterVariant) {
  return FILTER_OPERATORS_BY_VARIANT[filterVariant] ?? [];
}

export function getDefaultFilterOperator(filterVariant: FilterVariant) {
  const operators = getFilterOperators(filterVariant);

  return operators[0]?.value ?? (filterVariant === 'text' ? 'iLike' : 'eq');
}

export function getIsValuelessOperator(operator: FilterOperator) {
  return operator === 'isEmpty' || operator === 'isNotEmpty';
}

export function coerceFilterValue(operator: FilterOperator, value: string | string[]) {
  if (getIsValuelessOperator(operator)) return '';

  if (operator === 'inArray' || operator === 'notInArray') {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  if (operator === 'isBetween') {
    return Array.isArray(value) ? value : [value, ''];
  }

  if (Array.isArray(value)) return value.find((item) => item !== '') ?? '';

  return value;
}

export function getFilterVariant(meta: ColumnVariantMeta | undefined): FilterVariant {
  switch (meta?.variant) {
    case 'number':
      return meta.filter === 'range' ? 'range' : 'number';
    case 'date':
      return meta.filter === 'range' ? 'date-range' : 'date';
    case 'boolean':
    case 'select':
    case 'multi-select':
      return meta.variant;
    default:
      return 'text';
  }
}

export function getColumnSelectOptions(meta: ColumnVariantMeta | undefined): ColumnSelectOption[] {
  return meta?.variant === 'select' || meta?.variant === 'multi-select' ? (meta.options ?? []) : [];
}

export function getDefaultFilter<TData extends RowData>(column: Column<DataTableFeatures, TData>) {
  const variant = getFilterVariant(column.columnDef.meta);

  return {
    id: column.id,
    variant,
    operator: getDefaultFilterOperator(variant),
    value: '',
  };
}

export function getSelectFilterValue(filter: ColumnFilterItem) {
  if (filter.variant === 'multi-select') {
    return Array.isArray(filter.value) ? filter.value : [];
  }

  return typeof filter.value === 'string' ? filter.value : undefined;
}

export function getIsMultiValueVariant(variant: FilterVariant) {
  return MULTI_VALUE_FILTER_VARIANTS.includes(variant);
}

export function getPlainFilterOperator(variant: FilterVariant): FilterOperator {
  if (variant === 'select' || variant === 'multi-select') return 'inArray';
  if (variant === 'range' || variant === 'date-range') return 'isBetween';
  return getDefaultFilterOperator(variant);
}

export function getIsPlainFilter(filter: ColumnFilterItem) {
  return (
    filter.operator === getPlainFilterOperator(filter.variant) &&
    Array.isArray(filter.value) === getIsMultiValueVariant(filter.variant)
  );
}

export function getPlainFilterId(columnId: string) {
  return `${columnId}-filter`;
}
