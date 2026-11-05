import { createParser } from 'nuqs';

import type { ColumnSort } from './types';

export function normalizeParamsString(params: URLSearchParams | string | null | undefined): string {
  if (!params) return '';
  const sp =
    typeof params === 'string'
      ? new URLSearchParams(params)
      : new URLSearchParams(params.toString());
  const entries: [string, string][] = [];
  sp.forEach((value, key) => {
    entries.push([key, value]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const sorted = new URLSearchParams();
  for (const [k, v] of entries) {
    sorted.append(k, v);
  }
  return sorted.toString();
}

export function parseSortParam(sortParam: string | null): ColumnSort | null {
  if (!sortParam) return null;
  const parts = sortParam.split('.');
  if (parts.length < 2) return null;
  const [id, order] = parts;
  if (!id) return null;
  const lowerOrder = order?.toLowerCase();
  if (lowerOrder !== 'asc' && lowerOrder !== 'desc') return null;
  return { id, desc: lowerOrder === 'desc' };
}

export function formatSortParam(sort: ColumnSort | null): string | null {
  if (!sort || !sort.id) return null;
  return `${sort.id}.${sort.desc ? 'desc' : 'asc'}`;
}

export function parseFilterValues(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split('.')
    .map((v) => v.trim())
    .filter(Boolean);
}

export const filterValuesParser = createParser<string[]>({
  parse: (value) => parseFilterValues(value),
  serialize: (values) => values.join('.'),
});

export const sortParamParser = createParser<ColumnSort | null>({
  parse: (value) => parseSortParam(value),
  serialize: (sort) => formatSortParam(sort) ?? '',
});
