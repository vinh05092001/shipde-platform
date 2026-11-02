'use client';

/**
 * Server-Driven Data Table Hook & URL Search Params State Helpers
 *
 * Adapted from sadmann7/shadcn-table (https://github.com/sadmann7/shadcn-table)
 * License: MIT License
 * Copyright (c) 2023 Sadman Sakib
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface DataTableOption {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
}

export interface DataTableFilterField<TData> {
  id: Extract<keyof TData, string> | string;
  label: string;
  placeholder?: string;
  options?: DataTableOption[];
  description?: string;
}

export interface DataTableSortState {
  id: string;
  desc: boolean;
}

export type DataTableDensity = 'compact' | 'comfortable';

export interface DataTableColumnDef<TData> {
  id: string;
  header: string;
  accessorKey?: keyof TData | string;
  cell?: (row: TData, rowIndex: number) => React.ReactNode;
  enableSorting?: boolean;
  enableHiding?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export type DataTableSearchParamsInput =
  URLSearchParams | string | Record<string, string | string[] | undefined> | null | undefined;

export const DEFAULT_PAGE_SIZES = [10, 20, 30, 50, 100] as const;

export function toUrlSearchParams(input?: DataTableSearchParamsInput): URLSearchParams {
  if (!input) {
    return new URLSearchParams();
  }
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input.toString());
  }
  if (typeof input === 'string') {
    const cleaned = input.startsWith('?') ? input.slice(1) : input;
    return new URLSearchParams(cleaned);
  }
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(input)) {
    if (Array.isArray(val)) {
      if (val.length > 0) {
        params.set(key, val.join('.'));
      }
    } else if (typeof val === 'string' && val.length > 0) {
      params.set(key, val);
    }
  }
  return params;
}

export function parseSortParam(
  sortParam: string | null | undefined,
  allowedColumnIds?: string[],
  defaultSort: DataTableSortState | null = null
): { sort: DataTableSortState | null; validationError: string | null } {
  if (!sortParam || !sortParam.trim()) {
    return { sort: defaultSort, validationError: null };
  }

  const parts = sortParam.trim().split('.');
  if (parts.length !== 2) {
    return {
      sort: defaultSort,
      validationError: `Tham số sắp xếp "${sortParam}" không đúng định dạng "<cột>.<asc|desc>".`,
    };
  }

  const [colId, dir] = parts;
  if (!colId || (dir !== 'asc' && dir !== 'desc')) {
    return {
      sort: defaultSort,
      validationError: `Chiều sắp xếp "${dir || ''}" không hợp lệ (chỉ chấp nhận "asc" hoặc "desc").`,
    };
  }

  if (allowedColumnIds && allowedColumnIds.length > 0 && !allowedColumnIds.includes(colId)) {
    return {
      sort: defaultSort,
      validationError: `Cột sắp xếp "${colId}" không được phép hoặc không tồn tại trên bảng này.`,
    };
  }

  return {
    sort: { id: colId, desc: dir === 'desc' },
    validationError: null,
  };
}

export function serializeSortParam(sort: DataTableSortState | null): string | null {
  if (!sort || !sort.id) return null;
  return `${sort.id}.${sort.desc ? 'desc' : 'asc'}`;
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultPerPage = 10,
  allowedPageSizes: readonly number[] = DEFAULT_PAGE_SIZES
): { page: number; perPage: number; validationError: string | null } {
  const rawPage = searchParams.get('page');
  const rawPerPage = searchParams.get('per_page');
  let validationError: string | null = null;

  let page = 1;
  if (rawPage !== null && rawPage !== '') {
    const parsedPage = Number(rawPage);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      validationError = `Tham số trang "page=${rawPage}" không hợp lệ (phải là số nguyên dương >= 1).`;
    } else {
      page = parsedPage;
    }
  }

  let perPage = defaultPerPage;
  if (rawPerPage !== null && rawPerPage !== '') {
    const parsedPerPage = Number(rawPerPage);
    if (!Number.isInteger(parsedPerPage) || !allowedPageSizes.includes(parsedPerPage)) {
      const errMsg = `Tham số kích thước trang "per_page=${rawPerPage}" không hợp lệ (chấp nhận: ${allowedPageSizes.join(', ')}).`;
      validationError = validationError ? `${validationError} ${errMsg}` : errMsg;
    } else {
      perPage = parsedPerPage;
    }
  }

  return { page, perPage, validationError };
}

export function parseFilterParams<TData>(
  searchParams: URLSearchParams,
  filterFields: DataTableFilterField<TData>[] = []
): {
  textFilters: Record<string, string>;
  facetedFilters: Record<string, string[]>;
  validationError: string | null;
} {
  const textFilters: Record<string, string> = {};
  const facetedFilters: Record<string, string[]> = {};
  let validationError: string | null = null;

  for (const field of filterFields) {
    const key = String(field.id);
    const rawValue = searchParams.get(key);
    if (!rawValue || !rawValue.trim()) continue;

    if (field.options && field.options.length > 0) {
      const tokens = rawValue
        .split(/[.,]/)
        .map((v) => v.trim())
        .filter(Boolean);
      const allowedValues = new Set(field.options.map((opt) => opt.value));
      const invalidTokens = tokens.filter((t) => !allowedValues.has(t));
      if (invalidTokens.length > 0) {
        validationError = `Giá trị lọc "${invalidTokens.join(', ')}" cho trường "${field.label}" không nằm trong danh mục cho phép.`;
      }
      const validTokens = tokens.filter((t) => allowedValues.has(t));
      if (validTokens.length > 0) {
        facetedFilters[key] = Array.from(new Set(validTokens));
      }
    } else {
      textFilters[key] = rawValue.trim();
    }
  }

  return { textFilters, facetedFilters, validationError };
}

export function createQueryString(
  baseParams: URLSearchParams,
  updates: Record<string, string | number | null | undefined>
): string {
  const nextParams = new URLSearchParams(baseParams.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') {
      nextParams.delete(key);
    } else {
      nextParams.set(key, String(value));
    }
  }
  return nextParams.toString();
}

export interface ServerTableQueryState {
  page: number;
  perPage: number;
  sort: DataTableSortState | null;
  textFilters: Record<string, string>;
  facetedFilters: Record<string, string[]>;
}

export function applyServerDataTableQuery<TData extends Record<string, unknown>>(
  rows: readonly TData[],
  query: ServerTableQueryState,
  options?: {
    searchKeys?: (keyof TData | string)[];
  }
): {
  rows: TData[];
  totalRows: number;
  pageCount: number;
  page: number;
  perPage: number;
} {
  let filtered = [...rows];

  for (const [fieldId, searchVal] of Object.entries(query.textFilters)) {
    const needle = searchVal.trim().toLowerCase();
    if (!needle) continue;
    const keysToSearch =
      fieldId === 'q' && options?.searchKeys && options.searchKeys.length > 0
        ? options.searchKeys.map(String)
        : [fieldId];

    filtered = filtered.filter((row) =>
      keysToSearch.some((k) => {
        const val = row[k];
        return val !== null && val !== undefined && String(val).toLowerCase().includes(needle);
      })
    );
  }

  for (const [fieldId, selectedValues] of Object.entries(query.facetedFilters)) {
    if (!selectedValues || selectedValues.length === 0) continue;
    const allowedSet = new Set(selectedValues.map((v) => v.toUpperCase()));
    filtered = filtered.filter((row) => {
      const val = row[fieldId];
      if (val === null || val === undefined) return false;
      return allowedSet.has(String(val).toUpperCase());
    });
  }

  if (query.sort && query.sort.id) {
    const { id: sortKey, desc } = query.sort;
    const multiplier = desc ? -1 : 1;
    filtered.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return (va - vb) * multiplier;
      }
      if (typeof va === 'bigint' && typeof vb === 'bigint') {
        return (va < vb ? -1 : 1) * multiplier;
      }
      return (
        String(va).localeCompare(String(vb), 'vi', { numeric: true, sensitivity: 'base' }) *
        multiplier
      );
    });
  }

  const totalRows = filtered.length;
  const safePerPage = Math.max(1, query.perPage || 10);
  const pageCount = Math.max(1, Math.ceil(totalRows / safePerPage));
  const safePage = Math.min(Math.max(1, query.page || 1), pageCount);
  const startIdx = (safePage - 1) * safePerPage;
  const pagedRows = filtered.slice(startIdx, startIdx + safePerPage);

  return {
    rows: pagedRows,
    totalRows,
    pageCount,
    page: safePage,
    perPage: safePerPage,
  };
}

function useSafeNextNavigation(
  fallbackPathname: string,
  fallbackSearchParams?: DataTableSearchParamsInput,
  onUrlChange?: (nextUrl: string, nextParams: URLSearchParams) => void
) {
  let nextPathname: string | null = null;
  let nextSearchParams: URLSearchParams | null = null;
  let nextRouter: ReturnType<typeof useRouter> | null = null;

  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    nextPathname = usePathname();
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const sp = useSearchParams();
    if (sp) {
      nextSearchParams = new URLSearchParams(sp.toString());
    }
    // eslint-disable-next-line react-hooks/rules-of-hooks
    nextRouter = useRouter();
  } catch {
    // Running inside SSR / renderToStaticMarkup outside Next App Router context
  }

  const resolvedPathname = nextPathname || fallbackPathname;
  const resolvedSearchParams =
    fallbackSearchParams !== undefined && fallbackSearchParams !== null
      ? toUrlSearchParams(fallbackSearchParams)
      : nextSearchParams || new URLSearchParams();

  const navigate = React.useCallback(
    (nextParams: URLSearchParams) => {
      const qs = nextParams.toString();
      const nextUrl = qs ? `${resolvedPathname}?${qs}` : resolvedPathname;
      if (onUrlChange) {
        onUrlChange(nextUrl, nextParams);
        return;
      }
      if (nextRouter) {
        nextRouter.push(nextUrl, { scroll: false });
      }
    },
    [nextRouter, onUrlChange, resolvedPathname]
  );

  return {
    pathname: resolvedPathname,
    searchParams: resolvedSearchParams,
    navigate,
  };
}

export interface UseDataTableProps<TData> {
  data: TData[];
  columns: DataTableColumnDef<TData>[];
  pageCount: number;
  totalRows?: number;
  filterFields?: DataTableFilterField<TData>[];
  defaultPerPage?: number;
  defaultSort?: DataTableSortState | null;
  defaultDensity?: DataTableDensity;
  getRowId?: (row: TData, index: number) => string;
  initialSearchParams?: DataTableSearchParamsInput;
  pathname?: string;
  onUrlChange?: (nextUrl: string, nextParams: URLSearchParams) => void;
}

export function useDataTable<TData>({
  data,
  columns,
  pageCount,
  totalRows,
  filterFields = [],
  defaultPerPage = 10,
  defaultSort = null,
  defaultDensity = 'comfortable',
  getRowId,
  initialSearchParams,
  pathname = '/',
  onUrlChange,
}: UseDataTableProps<TData>) {
  const { searchParams: externalParams, navigate } = useSafeNextNavigation(
    pathname,
    initialSearchParams,
    onUrlChange
  );

  const externalParamsString = externalParams.toString();
  const [overrideParams, setOverrideParams] = React.useState<{
    base: string;
    value: string;
  } | null>(null);

  const localParamsString =
    overrideParams && overrideParams.base === externalParamsString
      ? overrideParams.value
      : externalParamsString;

  const activeSearchParams = React.useMemo(
    () => new URLSearchParams(localParamsString),
    [localParamsString]
  );

  const sortableColumnIds = React.useMemo(
    () => columns.filter((col) => col.enableSorting !== false).map((col) => col.id),
    [columns]
  );

  const paginationParsed = React.useMemo(
    () => parsePaginationParams(activeSearchParams, defaultPerPage),
    [activeSearchParams, defaultPerPage]
  );

  const sortParsed = React.useMemo(
    () => parseSortParam(activeSearchParams.get('sort'), sortableColumnIds, defaultSort),
    [activeSearchParams, sortableColumnIds, defaultSort]
  );

  const filtersParsed = React.useMemo(
    () => parseFilterParams(activeSearchParams, filterFields),
    [activeSearchParams, filterFields]
  );

  const validationError =
    paginationParsed.validationError ||
    sortParsed.validationError ||
    filtersParsed.validationError ||
    null;

  const [density, setDensity] = React.useState<DataTableDensity>(defaultDensity);
  const [columnVisibility, setColumnVisibility] = React.useState<Record<string, boolean>>({});
  const [selectedRowIds, setSelectedRowIds] = React.useState<Set<string>>(() => new Set());

  const resolveRowId = React.useCallback(
    (row: TData, index: number) => {
      if (getRowId) return getRowId(row, index);
      const candidate = (row as Record<string, unknown>)?.id;
      return candidate !== undefined && candidate !== null ? String(candidate) : String(index);
    },
    [getRowId]
  );

  const commitParams = React.useCallback(
    (updates: Record<string, string | number | null | undefined>) => {
      const nextQs = createQueryString(activeSearchParams, updates);
      const nextParams = new URLSearchParams(nextQs);
      setOverrideParams({ base: externalParamsString, value: nextQs });
      navigate(nextParams);
    },
    [activeSearchParams, externalParamsString, navigate]
  );

  const setPage = React.useCallback(
    (nextPage: number) => {
      const clamped = Math.max(1, Math.min(nextPage, Math.max(1, pageCount)));
      commitParams({ page: clamped });
    },
    [commitParams, pageCount]
  );

  const setPerPage = React.useCallback(
    (nextPerPage: number) => {
      commitParams({ per_page: nextPerPage, page: 1 });
    },
    [commitParams]
  );

  const setSort = React.useCallback(
    (columnId: string, explicitDesc?: boolean) => {
      if (!sortableColumnIds.includes(columnId)) return;
      const current = sortParsed.sort;
      let nextSort: DataTableSortState | null = null;
      if (typeof explicitDesc === 'boolean') {
        nextSort = { id: columnId, desc: explicitDesc };
      } else if (!current || current.id !== columnId) {
        nextSort = { id: columnId, desc: false };
      } else if (!current.desc) {
        nextSort = { id: columnId, desc: true };
      } else {
        nextSort = null;
      }
      commitParams({ sort: serializeSortParam(nextSort), page: 1 });
    },
    [commitParams, sortParsed.sort, sortableColumnIds]
  );

  const setTextFilter = React.useCallback(
    (columnId: string, value: string) => {
      commitParams({ [columnId]: value.trim() || null, page: 1 });
    },
    [commitParams]
  );

  const setFacetedFilter = React.useCallback(
    (columnId: string, values: string[]) => {
      const cleaned = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
      commitParams({
        [columnId]: cleaned.length > 0 ? cleaned.join('.') : null,
        page: 1,
      });
    },
    [commitParams]
  );

  const resetFilters = React.useCallback(() => {
    const updates: Record<string, null | number> = { page: 1 };
    for (const field of filterFields) {
      updates[String(field.id)] = null;
    }
    commitParams(updates);
  }, [commitParams, filterFields]);

  const resetInvalidParams = React.useCallback(() => {
    const updates: Record<string, string | number | null> = {
      page: 1,
      per_page: defaultPerPage,
      sort: serializeSortParam(defaultSort),
    };
    for (const field of filterFields) {
      updates[String(field.id)] = null;
    }
    commitParams(updates);
  }, [commitParams, defaultPerPage, defaultSort, filterFields]);

  const toggleColumnVisibility = React.useCallback((columnId: string) => {
    setColumnVisibility((prev) => ({
      ...prev,
      [columnId]: prev[columnId] === false ? true : false,
    }));
  }, []);

  const visibleColumns = React.useMemo(
    () => columns.filter((col) => columnVisibility[col.id] !== false),
    [columns, columnVisibility]
  );

  const toggleRowSelection = React.useCallback((rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const isAllPageRowsSelected =
    data.length > 0 && data.every((row, idx) => selectedRowIds.has(resolveRowId(row, idx)));

  const toggleAllRows = React.useCallback(() => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (isAllPageRowsSelected) {
        data.forEach((row, idx) => next.delete(resolveRowId(row, idx)));
      } else {
        data.forEach((row, idx) => next.add(resolveRowId(row, idx)));
      }
      return next;
    });
  }, [data, isAllPageRowsSelected, resolveRowId]);

  const clearSelection = React.useCallback(() => {
    setSelectedRowIds(new Set());
  }, []);

  const isFiltered =
    Object.keys(filtersParsed.textFilters).length > 0 ||
    Object.keys(filtersParsed.facetedFilters).length > 0;

  return {
    data,
    columns,
    visibleColumns,
    filterFields,
    page: paginationParsed.page,
    perPage: paginationParsed.perPage,
    pageCount: Math.max(1, pageCount),
    totalRows: totalRows ?? data.length,
    sort: sortParsed.sort,
    textFilters: filtersParsed.textFilters,
    facetedFilters: filtersParsed.facetedFilters,
    isFiltered,
    validationError,
    density,
    setDensity,
    columnVisibility,
    toggleColumnVisibility,
    selectedRowIds,
    isAllPageRowsSelected,
    toggleRowSelection,
    toggleAllRows,
    clearSelection,
    resolveRowId,
    setPage,
    setPerPage,
    setSort,
    setTextFilter,
    setFacetedFilter,
    resetFilters,
    resetInvalidParams,
    searchParamsString: activeSearchParams.toString(),
  };
}
