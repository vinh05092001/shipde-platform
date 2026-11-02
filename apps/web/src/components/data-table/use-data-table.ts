'use client';

/**
 * MIT License
 *
 * Portions of this file are adapted from sadmann7/shadcn-table
 * (https://github.com/sadmann7/shadcn-table)
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
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  ColumnFiltersState,
  ColumnSort,
  DataTableFilterField,
  DataTableSearchParamsConfig,
  ParsedTableUrlState,
  ServerDataTableColumnDef,
  ServerDataTableInstance,
  SortingState,
  TableDensity,
  VisibilityState,
} from './types';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 50, 100];

export type SearchParamsInput =
  URLSearchParams | string | Record<string, string | string[] | undefined> | undefined;

export function toUrlSearchParams(input: SearchParamsInput): URLSearchParams {
  if (!input) {
    return new URLSearchParams();
  }
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input.toString());
  }
  if (typeof input === 'string') {
    const normalized = input.startsWith('?') ? input.slice(1) : input;
    return new URLSearchParams(normalized);
  }
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(input)) {
    if (Array.isArray(rawValue)) {
      const joined = rawValue.filter(Boolean).join(',');
      if (joined) {
        params.set(key, joined);
      }
    } else if (typeof rawValue === 'string' && rawValue.trim().length > 0) {
      params.set(key, rawValue);
    }
  }
  return params;
}

/**
 * Parses URL search parameters into a validated server-driven table state.
 * Adapted from sadmann7/shadcn-table search params parser conventions:
 * - page: 1-based positive integer
 * - per_page: allowed page size integer
 * - sort: "columnId.asc" or "columnId.desc" (comma-separated for multi-sort)
 * - density: "compact" | "comfortable"
 * - hide: comma-separated hidden column IDs
 * - <filterId>: text query or comma-separated faceted values
 */
export function parseTableSearchParams<TData>(
  input: SearchParamsInput,
  config: DataTableSearchParamsConfig<TData> = {}
): ParsedTableUrlState {
  const params = toUrlSearchParams(input);
  const validationErrors: string[] = [];

  const defaultPage = config.defaultPage ?? 1;
  const allowedPageSizes = config.allowedPageSizes ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const defaultPerPage = config.defaultPerPage ?? allowedPageSizes[0] ?? 10;
  const defaultSort = config.defaultSort ?? [];
  const defaultDensity: TableDensity = config.defaultDensity ?? 'compact';
  const filterFields = config.filterFields ?? [];

  // 1. Parse page
  let page = defaultPage;
  const rawPage = params.get('page');
  if (rawPage !== null && rawPage.trim() !== '') {
    const parsedPage = Number(rawPage);
    if (!Number.isInteger(parsedPage) || parsedPage < 1) {
      validationErrors.push(
        `Tham số trang "page=${rawPage}" không hợp lệ (phải là số nguyên dương >= 1).`
      );
    } else {
      page = parsedPage;
    }
  }

  // 2. Parse per_page
  let perPage = defaultPerPage;
  const rawPerPage = params.get('per_page');
  if (rawPerPage !== null && rawPerPage.trim() !== '') {
    const parsedPerPage = Number(rawPerPage);
    if (!Number.isInteger(parsedPerPage) || !allowedPageSizes.includes(parsedPerPage)) {
      validationErrors.push(
        `Tham số kích thước trang "per_page=${rawPerPage}" không hợp lệ (chỉ chấp nhận: ${allowedPageSizes.join(', ')}).`
      );
    } else {
      perPage = parsedPerPage;
    }
  }

  // 3. Parse sort (e.g. "createdAt.desc" or "status.asc,codAmount.desc")
  let sorting: SortingState = [...defaultSort];
  const rawSort = params.get('sort');
  if (rawSort !== null && rawSort.trim() !== '') {
    const segments = rawSort
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedSorts: ColumnSort[] = [];

    for (const segment of segments) {
      const lastDot = segment.lastIndexOf('.');
      if (lastDot <= 0) {
        validationErrors.push(
          `Tham số sắp xếp "sort=${segment}" sai định dạng (cần theo mẫu <cột>.asc hoặc <cột>.desc).`
        );
        continue;
      }
      const colId = segment.slice(0, lastDot);
      const direction = segment.slice(lastDot + 1).toLowerCase();
      if (direction !== 'asc' && direction !== 'desc') {
        validationErrors.push(
          `Chiều sắp xếp "${direction}" của cột "${colId}" không hợp lệ (chỉ hỗ trợ asc hoặc desc).`
        );
        continue;
      }
      if (
        config.allowedSortIds &&
        config.allowedSortIds.length > 0 &&
        !config.allowedSortIds.includes(colId)
      ) {
        validationErrors.push(`Cột sắp xếp "${colId}" không nằm trong danh sách cho phép.`);
        continue;
      }
      parsedSorts.push({ id: colId, desc: direction === 'desc' });
    }

    if (parsedSorts.length > 0) {
      sorting = parsedSorts;
    }
  }

  // 4. Parse density
  let density: TableDensity = defaultDensity;
  const rawDensity = params.get('density');
  if (rawDensity !== null && rawDensity.trim() !== '') {
    if (rawDensity === 'compact' || rawDensity === 'comfortable') {
      density = rawDensity;
    } else {
      validationErrors.push(
        `Tham số mật độ hiển thị "density=${rawDensity}" không hợp lệ (chỉ hỗ trợ compact hoặc comfortable).`
      );
    }
  }

  // 5. Parse hidden columns
  const columnVisibility: VisibilityState = {};
  const rawHide = params.get('hide');
  if (rawHide !== null && rawHide.trim() !== '') {
    const hiddenCols = rawHide
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    for (const colId of hiddenCols) {
      columnVisibility[colId] = false;
    }
  }

  // 6. Parse filter fields
  const columnFilters: ColumnFiltersState = [];
  for (const field of filterFields) {
    const rawFilterVal = params.get(field.id);
    if (rawFilterVal === null || rawFilterVal.trim() === '') {
      continue;
    }

    const isFaceted = field.variant === 'faceted' || Array.isArray(field.options);
    if (isFaceted) {
      const rawValues = rawFilterVal
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      if (field.options && field.options.length > 0) {
        const validSet = new Set(field.options.map((opt) => opt.value));
        const validValues: string[] = [];
        for (const candidate of rawValues) {
          if (validSet.has(candidate)) {
            validValues.push(candidate);
          } else {
            validationErrors.push(
              `Giá trị lọc "${candidate}" của bộ lọc "${field.label}" không hợp lệ.`
            );
          }
        }
        if (validValues.length > 0) {
          columnFilters.push({ id: field.id, value: validValues });
        }
      } else if (rawValues.length > 0) {
        columnFilters.push({ id: field.id, value: rawValues });
      }
    } else {
      const trimmed = rawFilterVal.trim();
      if (trimmed.length > 120) {
        validationErrors.push(`Từ khóa tìm kiếm "${field.label}" vượt quá 120 ký tự.`);
      } else if (trimmed.length > 0) {
        columnFilters.push({ id: field.id, value: trimmed });
      }
    }
  }

  return {
    page,
    perPage,
    sorting,
    columnFilters,
    columnVisibility,
    density,
    validationErrors,
  };
}

/**
 * Serializes table state into a canonical URL query string.
 */
export function serializeTableSearchParams<TData>(
  state: Partial<ParsedTableUrlState>,
  config: DataTableSearchParamsConfig<TData> = {},
  baseSearchParams?: SearchParamsInput
): string {
  const params = toUrlSearchParams(baseSearchParams);
  const defaultPage = config.defaultPage ?? 1;
  const allowedPageSizes = config.allowedPageSizes ?? DEFAULT_PAGE_SIZE_OPTIONS;
  const defaultPerPage = config.defaultPerPage ?? allowedPageSizes[0] ?? 10;
  const defaultSort = config.defaultSort ?? [];
  const defaultDensity = config.defaultDensity ?? 'compact';
  const filterFields = config.filterFields ?? [];

  // Clear managed keys first
  params.delete('page');
  params.delete('per_page');
  params.delete('sort');
  params.delete('density');
  params.delete('hide');
  for (const field of filterFields) {
    params.delete(field.id);
  }

  const page = state.page ?? defaultPage;
  if (page > 1 && page !== defaultPage) {
    params.set('page', String(page));
  }

  const perPage = state.perPage ?? defaultPerPage;
  if (perPage !== defaultPerPage) {
    params.set('per_page', String(perPage));
  }

  const sorting = state.sorting ?? defaultSort;
  const serializedSort = sorting.map((s) => `${s.id}.${s.desc ? 'desc' : 'asc'}`).join(',');
  const serializedDefaultSort = defaultSort
    .map((s) => `${s.id}.${s.desc ? 'desc' : 'asc'}`)
    .join(',');
  if (serializedSort && serializedSort !== serializedDefaultSort) {
    params.set('sort', serializedSort);
  }

  const density = state.density ?? defaultDensity;
  if (density !== defaultDensity) {
    params.set('density', density);
  }

  const visibility = state.columnVisibility ?? {};
  const hiddenColumns = Object.entries(visibility)
    .filter(([, isVisible]) => isVisible === false)
    .map(([colId]) => colId);
  if (hiddenColumns.length > 0) {
    params.set('hide', hiddenColumns.join(','));
  }

  const filters = state.columnFilters ?? [];
  for (const filter of filters) {
    if (Array.isArray(filter.value)) {
      const clean = filter.value.map((v) => v.trim()).filter(Boolean);
      if (clean.length > 0) {
        params.set(filter.id, clean.join(','));
      }
    } else if (typeof filter.value === 'string' && filter.value.trim().length > 0) {
      params.set(filter.id, filter.value.trim());
    }
  }

  return params.toString();
}

export interface ServerDrivenDataResult<TData> {
  rows: TData[];
  totalCount: number;
  pageCount: number;
  facetCounts: Record<string, Record<string, number>>;
}

/**
 * Deterministic server-side / fixture query processor that applies filterFields,
 * sorting, facet counting, and pagination to a dataset according to URL state.
 */
export function applyServerDrivenTableOperations<TData extends Record<string, unknown>>(
  allRows: TData[],
  state: ParsedTableUrlState,
  columns: ServerDataTableColumnDef<TData>[],
  filterFields: DataTableFilterField<TData>[] = []
): ServerDrivenDataResult<TData> {
  // Compute facet counts prior to applying that specific facet's filter
  const facetCounts: Record<string, Record<string, number>> = {};
  for (const field of filterFields) {
    if (field.variant === 'faceted' || Array.isArray(field.options)) {
      const counts: Record<string, number> = {};
      for (const row of allRows) {
        const rawVal = row[field.id];
        if (typeof rawVal === 'string' || typeof rawVal === 'number') {
          const key = String(rawVal);
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
      facetCounts[field.id] = counts;
    }
  }

  // 1. Apply columnFilters
  let filteredRows = [...allRows];
  for (const filter of state.columnFilters) {
    const fieldConfig = filterFields.find((f) => f.id === filter.id);
    const isFaceted =
      fieldConfig?.variant === 'faceted' ||
      Array.isArray(fieldConfig?.options) ||
      Array.isArray(filter.value);

    if (isFaceted) {
      const selectedValues = Array.isArray(filter.value)
        ? filter.value
        : String(filter.value)
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean);
      if (selectedValues.length > 0) {
        const selectedSet = new Set(selectedValues);
        filteredRows = filteredRows.filter((row) => {
          const cellVal = row[filter.id];
          return cellVal !== undefined && cellVal !== null && selectedSet.has(String(cellVal));
        });
      }
    } else {
      const query = String(filter.value).trim().toLowerCase();
      if (query.length > 0) {
        filteredRows = filteredRows.filter((row) => {
          const directVal = row[filter.id];
          if (directVal !== undefined && directVal !== null) {
            if (String(directVal).toLowerCase().includes(query)) {
              return true;
            }
          }
          // Also allow searching across all string/number values when filter id is 'search' or 'q'
          if (filter.id === 'search' || filter.id === 'q') {
            return Object.values(row).some(
              (val) =>
                (typeof val === 'string' || typeof val === 'number') &&
                String(val).toLowerCase().includes(query)
            );
          }
          return false;
        });
      }
    }
  }

  // 2. Apply sorting
  if (state.sorting.length > 0) {
    const colMap = new Map(columns.map((c) => [c.id, c]));
    filteredRows.sort((a, b) => {
      for (const sortSpec of state.sorting) {
        const col = colMap.get(sortSpec.id);
        const getVal = (item: TData): string | number | boolean | null | undefined => {
          if (col?.accessorFn) {
            return col.accessorFn(item);
          }
          const key = col?.accessorKey ?? sortSpec.id;
          const raw = item[key];
          if (
            typeof raw === 'string' ||
            typeof raw === 'number' ||
            typeof raw === 'boolean' ||
            raw === null ||
            raw === undefined
          ) {
            return raw;
          }
          return String(raw);
        };

        const valA = getVal(a);
        const valB = getVal(b);

        if (valA === valB) {
          continue;
        }
        if (valA === undefined || valA === null) {
          return 1;
        }
        if (valB === undefined || valB === null) {
          return -1;
        }

        let comparison = 0;
        if (typeof valA === 'number' && typeof valB === 'number') {
          comparison = valA - valB;
        } else {
          comparison = String(valA).localeCompare(String(valB), 'vi');
        }
        return sortSpec.desc ? -comparison : comparison;
      }
      return 0;
    });
  }

  // 3. Apply pagination
  const totalCount = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / state.perPage));
  const startIndex = (state.page - 1) * state.perPage;
  const paginatedRows =
    startIndex >= 0 && startIndex < totalCount
      ? filteredRows.slice(startIndex, startIndex + state.perPage)
      : [];

  return {
    rows: paginatedRows,
    totalCount,
    pageCount,
    facetCounts,
  };
}

export interface UseDataTableProps<TData> extends DataTableSearchParamsConfig<TData> {
  data: TData[];
  columns: ServerDataTableColumnDef<TData>[];
  pageCount: number;
  totalCount?: number;
  searchParams?: SearchParamsInput;
  pathname?: string;
  onUrlChange?: (nextUrl: string, nextState: ParsedTableUrlState) => void;
  getRowId?: (row: TData, index: number) => string;
  syncWithBrowserHistory?: boolean;
}

/**
 * Reusable server-driven data table hook adapted from sadmann7/shadcn-table.
 * Synchronizes sort, text filters, faceted multi-select filters, pagination,
 * column visibility, and density with URL search params.
 */
export function useDataTable<TData>({
  data,
  columns,
  pageCount,
  totalCount,
  filterFields = [],
  allowedSortIds,
  defaultPage = 1,
  defaultPerPage = 10,
  allowedPageSizes = DEFAULT_PAGE_SIZE_OPTIONS,
  defaultSort = [],
  defaultDensity = 'compact',
  searchParams,
  pathname = '',
  onUrlChange,
  getRowId,
  syncWithBrowserHistory = true,
}: UseDataTableProps<TData>): ServerDataTableInstance<TData> {
  const effectiveAllowedSortIds = useMemo(() => {
    if (allowedSortIds && allowedSortIds.length > 0) {
      return allowedSortIds;
    }
    return columns.filter((col) => col.enableSorting !== false).map((col) => col.id);
  }, [allowedSortIds, columns]);

  const config = useMemo<DataTableSearchParamsConfig<TData>>(
    () => ({
      filterFields,
      allowedSortIds: effectiveAllowedSortIds,
      defaultPage,
      defaultPerPage,
      allowedPageSizes,
      defaultSort,
      defaultDensity,
    }),
    [
      filterFields,
      effectiveAllowedSortIds,
      defaultPage,
      defaultPerPage,
      allowedPageSizes,
      defaultSort,
      defaultDensity,
    ]
  );

  const controlledState = useMemo(
    () => (searchParams !== undefined ? parseTableSearchParams(searchParams, config) : null),
    [searchParams, config]
  );

  const [uncontrolledState, setUncontrolledState] = useState<ParsedTableUrlState>(() =>
    parseTableSearchParams(
      searchParams ?? (typeof window !== 'undefined' ? window.location.search : ''),
      config
    )
  );
  const [selectedRowIds, setSelectedRowIds] = useState<Record<string, boolean>>({});

  const urlState = controlledState ?? uncontrolledState;

  // Subscribe to browser popstate events when searchParams is not explicitly controlled
  useEffect(() => {
    if (searchParams !== undefined || typeof window === 'undefined' || !syncWithBrowserHistory) {
      return;
    }
    const handlePopState = () => {
      setUncontrolledState(parseTableSearchParams(window.location.search, config));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [searchParams, config, syncWithBrowserHistory]);

  const commitState = useCallback(
    (updater: (prev: ParsedTableUrlState) => ParsedTableUrlState) => {
      const next = updater(urlState);
      const queryString = serializeTableSearchParams(next, config, searchParams);
      const resolvedPathname =
        pathname || (typeof window !== 'undefined' ? window.location.pathname : '');
      const nextUrl = queryString ? `${resolvedPathname}?${queryString}` : resolvedPathname;

      setUncontrolledState(next);

      if (onUrlChange) {
        onUrlChange(nextUrl, next);
      } else if (syncWithBrowserHistory && typeof window !== 'undefined') {
        window.history.replaceState(null, '', nextUrl || '?');
      }
    },
    [config, onUrlChange, pathname, searchParams, syncWithBrowserHistory, urlState]
  );

  const resolveRowId = useCallback(
    (row: TData, index: number): string => {
      if (getRowId) {
        return getRowId(row, index);
      }
      const record = row as Record<string, unknown>;
      if (typeof record.id === 'string' || typeof record.id === 'number') {
        return String(record.id);
      }
      return String(index);
    },
    [getRowId]
  );

  const setPage = useCallback(
    (nextPage: number) => {
      const clamped = Math.max(1, Math.trunc(nextPage));
      commitState((prev) => ({
        ...prev,
        page: clamped,
        validationErrors: [],
      }));
    },
    [commitState]
  );

  const setPerPage = useCallback(
    (nextPerPage: number) => {
      if (!allowedPageSizes.includes(nextPerPage)) {
        return;
      }
      commitState((prev) => ({
        ...prev,
        page: 1,
        perPage: nextPerPage,
        validationErrors: [],
      }));
    },
    [allowedPageSizes, commitState]
  );

  const setSorting = useCallback(
    (nextSorting: SortingState) => {
      commitState((prev) => ({
        ...prev,
        page: 1,
        sorting: nextSorting,
        validationErrors: [],
      }));
    },
    [commitState]
  );

  const toggleColumnSort = useCallback(
    (columnId: string, explicitDesc?: boolean) => {
      commitState((prev) => {
        const existing = prev.sorting.find((s) => s.id === columnId);
        let nextSorting: SortingState;
        if (typeof explicitDesc === 'boolean') {
          nextSorting = [{ id: columnId, desc: explicitDesc }];
        } else if (!existing) {
          nextSorting = [{ id: columnId, desc: false }];
        } else if (!existing.desc) {
          nextSorting = [{ id: columnId, desc: true }];
        } else {
          nextSorting = [];
        }
        return {
          ...prev,
          page: 1,
          sorting: nextSorting,
          validationErrors: [],
        };
      });
    },
    [commitState]
  );

  const clearColumnSort = useCallback(
    (columnId: string) => {
      commitState((prev) => ({
        ...prev,
        page: 1,
        sorting: prev.sorting.filter((s) => s.id !== columnId),
        validationErrors: [],
      }));
    },
    [commitState]
  );

  const getFilterValue = useCallback(
    (columnId: string): string | string[] | undefined => {
      const found = urlState.columnFilters.find((f) => f.id === columnId);
      return found?.value;
    },
    [urlState.columnFilters]
  );

  const setFilterValue = useCallback(
    (columnId: string, value: string | string[] | undefined) => {
      commitState((prev) => {
        const remaining = prev.columnFilters.filter((f) => f.id !== columnId);
        let nextFilters = remaining;

        if (Array.isArray(value)) {
          const clean = value.map((v) => v.trim()).filter(Boolean);
          if (clean.length > 0) {
            nextFilters = [...remaining, { id: columnId, value: clean }];
          }
        } else if (typeof value === 'string' && value.trim().length > 0) {
          nextFilters = [...remaining, { id: columnId, value }];
        }

        return {
          ...prev,
          page: 1,
          columnFilters: nextFilters,
          validationErrors: [],
        };
      });
    },
    [commitState]
  );

  const resetFilters = useCallback(() => {
    commitState((prev) => ({
      ...prev,
      page: 1,
      columnFilters: [],
      sorting: defaultSort,
      validationErrors: [],
    }));
  }, [commitState, defaultSort]);

  const setColumnVisibility = useCallback(
    (columnId: string, visible: boolean) => {
      commitState((prev) => {
        const nextVisibility = { ...prev.columnVisibility };
        if (visible) {
          delete nextVisibility[columnId];
        } else {
          nextVisibility[columnId] = false;
        }
        return {
          ...prev,
          columnVisibility: nextVisibility,
        };
      });
    },
    [commitState]
  );

  const setDensity = useCallback(
    (nextDensity: TableDensity) => {
      commitState((prev) => ({
        ...prev,
        density: nextDensity,
      }));
    },
    [commitState]
  );

  const toggleRowSelected = useCallback((rowId: string, selected?: boolean) => {
    setSelectedRowIds((prev) => {
      const next = { ...prev };
      const shouldSelect = typeof selected === 'boolean' ? selected : !prev[rowId];
      if (shouldSelect) {
        next[rowId] = true;
      } else {
        delete next[rowId];
      }
      return next;
    });
  }, []);

  const toggleAllPageRowsSelected = useCallback(
    (selected?: boolean) => {
      setSelectedRowIds((prev) => {
        const pageRowIds = data.map((row, idx) => resolveRowId(row, idx));
        const allSelected = pageRowIds.length > 0 && pageRowIds.every((id) => Boolean(prev[id]));
        const targetState = typeof selected === 'boolean' ? selected : !allSelected;
        const next = { ...prev };
        for (const id of pageRowIds) {
          if (targetState) {
            next[id] = true;
          } else {
            delete next[id];
          }
        }
        return next;
      });
    },
    [data, resolveRowId]
  );

  const clearRowSelection = useCallback(() => {
    setSelectedRowIds({});
  }, []);

  const visibleColumns = useMemo(
    () => columns.filter((col) => urlState.columnVisibility[col.id] !== false),
    [columns, urlState.columnVisibility]
  );

  const isFiltered = useMemo(
    () => urlState.columnFilters.length > 0 || urlState.validationErrors.length > 0,
    [urlState.columnFilters.length, urlState.validationErrors.length]
  );

  const buildQueryString = useCallback(
    (overrides?: Partial<ParsedTableUrlState>) =>
      serializeTableSearchParams({ ...urlState, ...overrides }, config, searchParams),
    [urlState, config, searchParams]
  );

  return {
    data,
    columns,
    visibleColumns,
    pageCount: Math.max(1, pageCount),
    totalCount,
    page: urlState.page,
    perPage: urlState.perPage,
    pageSizeOptions: allowedPageSizes,
    sorting: urlState.sorting,
    columnFilters: urlState.columnFilters,
    columnVisibility: urlState.columnVisibility,
    density: urlState.density,
    selectedRowIds,
    validationErrors: urlState.validationErrors,
    isFiltered,
    getRowId: resolveRowId,
    setPage,
    setPerPage,
    setSorting,
    toggleColumnSort,
    clearColumnSort,
    getFilterValue,
    setFilterValue,
    resetFilters,
    setColumnVisibility,
    setDensity,
    toggleRowSelected,
    toggleAllPageRowsSelected,
    clearRowSelection,
    buildQueryString,
  };
}
